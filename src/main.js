// Hero TD -- boot.
//
// P1 built the vertical slice: one level, one tower type, one enemy type, boats,
// the hero, and a working build -> wave -> build loop.
//
// P2 retired the two flagged risks. Targeting runs through real arc/flat line of
// sight with elevation-modified range (sim/los.js), and the build overlay asks
// that same predicate rather than drawing a circle that lies about cliffs.
//
// P5 made this file plural. A level owns a board, and a board is baked into the
// terrain mesh, the water shader, the flow fields, the picker and the batched
// scenery -- so changing level does not mean resetting nine systems, it means
// building a second everything and dropping the first. `startLevel` below is
// that construction, and the session it returns knows how to take itself apart.
// Levels change a handful of times per session and the whole build costs a few
// milliseconds; a reset path through nine systems, exercised twice a session,
// would be paying real risk to save nothing.
//
// This file only wires. The simulation never reaches into the renderer, the
// renderer never writes to the simulation, and the only things crossing between
// them are state read on one side and events drained on the other.

import * as THREE from 'three';

import { config } from './config.js';
import { LEVELS, LEVEL_ORDER, nextLevelId } from './sim/levels.js';
import { createBoard } from './sim/board.js';
import { createWorld, PHASE } from './sim/world.js';
import { createLoop } from './sim/loop.js';
import { createRenderer } from './render/renderer.js';
import { buildScene } from './render/scene.js';
import { createUnitView } from './render/units.js';
import { createPicker } from './render/picking.js';
import {
  createStructureView, createBoatView, createProjectileView,
  createHeroView, createGhostView, createCoinView
} from './render/views.js';
import { attachGestures } from './input/gestures.js';
import { muzzleHeight } from './sim/los.js';
import { createHud } from './ui/hud.js';
import { createAudio } from './audio.js';
import { createFeedback } from './feedback.js';

const SEED = 4471;                    // the diorama's seed; keeps the island identical

export async function boot() {
  const host = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const loading = document.getElementById('loading');

  // The audio context outlives any one level: it is expensive to build, a
  // browser will only start it from a user gesture, and there is no reason a
  // level change should cost the player their sound. So it is made once here
  // and handed down, while the feedback layer that drives it is per level,
  // because it holds a world and a camera.
  const audio = createAudio();

  // TDD 19: the context starts suspended and browsers will not start it any
  // other way. Capture phase, so it fires before anything can stopPropagation,
  // and on every kind of first contact a person might make.
  const wake = () => audio.resume();
  for (const kind of ['pointerdown', 'touchstart', 'keydown']) {
    stage.addEventListener(kind, wake, { capture: true, passive: true });
  }

  let session = null;

  function go(levelId) {
    if (session) session.dispose();
    audio.reset();
    session = startLevel({ THREE, host, stage, levelId, go, audio });
    window.game = session.game;
  }

  go(LEVEL_ORDER[0]);
  // Let the initialized scene reach the browser's render queue before fading
  // the cover; otherwise a fast machine can flash an unpainted viewport.
  requestAnimationFrame(() => loading.classList.add('ready'));
  return window.game;
}

function startLevel({ THREE, host, stage, levelId, go, audio }) {
  const level = LEVELS[levelId];
  if (!level) throw new Error(`unknown level "${levelId}"`);

  // ---- board ----
  const board = createBoard(level, config.board);
  // Throws loudly, with every problem it found rather than the first. See
  // sim/board.js: every check in there exists because the failure it catches is
  // invisible at runtime.
  board.validate(config.waves.spawnRadius);

  // ---- render ----
  const view = createRenderer(THREE, host, board);
  const scene = buildScene(THREE, view.scene, board, SEED);
  // The sky is a shader on the water plane, so the renderer can only tint it
  // once the scene has been built (see water.js).
  view.attachSky(scene.skyMaterial);

  // ---- simulation ----
  const world = createWorld(board);

  // ---- views ----
  const unitView = createUnitView(THREE, board, scene.soft, scene.rigs, scene.dynamicRoot);
  const structureView = createStructureView(THREE, board, scene.prefabs, scene.soft,
                                           scene.dynamicRoot, scene.scenery);
  const boatView = createBoatView(THREE, board, scene.kit, scene.soft, scene.rigs, scene.dynamicRoot);
  const projectileView = createProjectileView(THREE, board, scene.dynamicRoot);
  const heroView = createHeroView(THREE, board, scene.soft, scene.kingRig, scene.dynamicRoot);
  const coinView = createCoinView(THREE, board, scene.dynamicRoot);
  const ghost = createGhostView(THREE, board, scene.dynamicRoot);

  // The only consumer of world.events. Built after the views because it drives
  // them: a hit reaction is a thing the renderer does about something the
  // simulation reported, and this is the one place that translation happens.
  const feedback = createFeedback(world, audio, view, { unitView, heroView, structureView });

  // The build overlay asks the simulation the same question a tower asks, rather
  // than reimplementing range. TDD 16: a range circle that lies about cliffs
  // teaches the wrong model of the game, and the only way it cannot lie is if
  // there is exactly one implementation of "can this shoot that".
  function probeCoverage(towerI, towerJ, targetI, targetJ, typeOverride) {
    const spec = config.towers[typeOverride || (hud.pending && hud.pending.type)
                               || (hud.hovered && hud.hovered.type) || hud.selected || 'archer'];
    // Barricades have no range at all -- there is nothing to draw.
    if (!spec || !spec.range) return 'out';
    const from = {
      id: 'ghost',
      x: towerI, z: towerJ,
      y: muzzleHeight(board, towerI, towerJ)
    };
    const target = { id: 'probe', x: targetI, z: targetJ };
    const d = Math.hypot(targetI - towerI, targetJ - towerJ);
    if (d < (spec.minRange || 0)) return 'dead';
    if (d > world.combat.effectiveRange(spec, from, target)) return 'out';
    // In the band on paper: now ask whether the shot actually gets there.
    return world.combat.canHit(from, target, spec) ? 'hit' : 'blind';
  }

  // ---- input ----
  const pick = createPicker(THREE, board, view.camera);
  const rect = () => view.canvas.getBoundingClientRect();

  // A tap PROPOSES; it never buys. While something is armed on the build bar
  // the tap picks the tile and the confirm button in the HUD spends the gold
  // (TDD 16). With nothing armed the tap means what it has always meant.
  attachGestures(view.canvas, view, (clientX, clientY) => {
    // The cutscene is not interactive. Camera drag and zoom still work, because
    // taking the camera away as well would read as the game having frozen.
    if (world.phase === PHASE.INTRO) return;
    const hit = pick(clientX, clientY, rect());
    if (!hit) return;

    // A tap only places while something is ARMED -- including during castle
    // siting, which arrives disarmed. Before the castle button is pressed the
    // opening beat is walking around and reading the island, which is the
    // decision the siting is about; placement mode is entered deliberately.
    if (hud.arming && hud.propose(hit.i, hit.j)) return;

    if (world.phase === PHASE.BUILD) {
      // TDD 7: tapping a placed tower opens its upgrade panel. Tapping anywhere
      // else closes it -- which is also how the panel is dismissed, so there is
      // no modal state a player can get stuck inside.
      const standing = world.structures.at(hit.i, hit.j);
      if (hud.inspect(standing)) return;
      if (hud.inspecting) return;
    }
    world.moveHero(hit.i, hit.j, hit.x, hit.z);
  });

  // Desktop convenience: while something is armed and nothing has been tapped
  // yet, the footprint follows the cursor. Touch has no hover, so there it is
  // the tap that first puts a footprint on the ground -- which is exactly why
  // the tap only proposes and a separate button confirms.
  const onPointerMove = e => {
    if (!hud.arming || hud.pending) return;
    const hit = pick(e.clientX, e.clientY, rect());
    if (hit) hud.hover(hit.i, hit.j); else hud.clearHover();
  };
  view.canvas.addEventListener('pointermove', onPointerMove);
  // Leaving the canvas drops the preview rather than stranding it on the last
  // tile the cursor happened to cross.
  const onPointerLeave = () => hud.clearHover();
  view.canvas.addEventListener('pointerleave', onPointerLeave);

  // The ground preview shows a placement being CONSIDERED -- hovered, or tapped
  // and awaiting confirmation -- and nothing else. Outside those moments there
  // is no overlay on the board at all.
  //
  // It was briefly anchored to the king instead, which meant it was on for the
  // whole build phase -- and a permanent slab of UI parked on the character you
  // are trying to look at is worse than no preview. Coverage is wanted at the
  // moment of decision, not continuously.
  //
  // Rebuilding the coverage mesh means probing every land tile, so it is redone
  // only when the footprint actually moves. A hover that crosses fifty pixels
  // inside one tile costs nothing.
  let ghostKey = '';
  function updateGhost() {
    const spot = hud.pending || hud.hovered;
    if (!spot) { ghostKey = ''; ghost.hide(); return; }
    const key = `${spot.i}:${spot.j}:${spot.valid}:${spot.type}:${spot.span}`;
    if (key === ghostKey) return;
    ghostKey = key;
    // No coverage probe for the castle: its own guns are not what the siting
    // decision is about. Where it sits, and what can reach it, is.
    const probe = spot.type ? probeCoverage : null;
    ghost.show(spot.i, spot.j, spot.valid, probe, spot.span);
  }

  const loop = createLoop({
    hz: config.sim.HZ,
    maxCatchup: config.sim.MAX_CATCHUP,

    step(dt) {
      if (world.paused) return;
      world.step(dt);
    },

    render(alpha, elapsed) {
      // The sim records that things happened; the presentation layer decides
      // what to do about them. Drained exactly once per rendered frame, after
      // being read -- so an event emitted by any of the sim steps that ran since
      // the last frame is heard exactly once.
      feedback.consume(world.events);
      world.events.length = 0;

      // Thronefall carries its day/night rhythm in the light. Set every frame
      // rather than on the phase-change event, so the easing survives a pause,
      // a restart, or a level change without anything having to remember to
      // re-fire it.
      view.setEvening(world.phase === PHASE.WAVE);

      // The arrival opens hard on the king and pulls back to the normal framing.
      // Driven from the cutscene's own clock rather than from a tween here, so a
      // pause holds the shot instead of letting the camera run on without him.
      if (world.phase === PHASE.INTRO) {
        const I = config.intro;
        const t = Math.min(1, world.intro.elapsed / I.zoomSeconds);
        const eased = 1 - Math.pow(1 - t, 3);
        const magnification = I.startZoom + (1 - I.startZoom) * eased;
        view.setZoom(config.camera.FRUSTUM_START / magnification);
      }

      const blend = world.paused ? 1 : alpha;

      // The camera rides the king. Fed the same interpolated position the hero
      // view draws him at. Its stair height is deliberately continuous: the
      // figure follows each tread, while the camera makes one smooth climb over
      // the complete flight instead of bumping over every riser.
      const hero = world.hero;
      const heroX = hero.px + (hero.x - hero.px) * blend;
      const heroZ = hero.pz + (hero.z - hero.pz) * blend;
      const heroY = hero.py + (hero.y - hero.py) * blend;
      const stairCameraY = board.stairCameraYAt(heroX, heroZ);
      view.follow(
        heroX,
        heroZ,
        stairCameraY === null ? heroY : stairCameraY - config.board.SINK
      );

      unitView.sync(world, blend, elapsed);
      structureView.sync(world, view.camera, elapsed);
      boatView.sync(world, blend, world.paused ? 0 : elapsed);
      projectileView.sync(world, blend);
      coinView.sync(world, blend);
      heroView.sync(world, blend, elapsed);

      updateGhost();
      view.draw();
      hud.update(elapsed);
    }
  });

  const nextId = nextLevelId(levelId);

  const hud = createHud({
    stage, view, world, loop, audio, feedback,
    gridMesh: scene.gridMesh,
    unitView,
    onReady: () => world.ready(),
    hasNextLevel: !!nextId,
    onNextLevel: () => { if (nextId) go(nextId); },
    // Tile boundaries are on exactly while a placement is armed -- for towers
    // and for the castle alike. They answer "which square am I aiming at", so
    // they belong to placement mode rather than to the whole build phase, and
    // taking them away again is part of what makes disarming feel like putting
    // the map back down.
    onSelectTower: armed => { scene.gridMesh.visible = !!armed; }
  });

  // Off until placement is armed. The arrival opens on the island, not on a
  // worksheet.
  scene.gridMesh.visible = false;

  loop.start();

  return {
    game: {
      board, world, view, scene, loop, config, hud, pick, level,
      audio, feedback,
      next: nextId,
      // Jump straight to any level. The NEXT ISLAND button is the only path a
      // player has, but balance work needs to open level three without playing
      // twelve waves to reach it.
      goToLevel: go,
      views: { unitView, structureView, boatView, projectileView, coinView, heroView, ghost }
    },
    // Order matters: stop simulating before tearing down anything the render
    // callback reads, and drop the HUD before the renderer it holds a view of.
    dispose() {
      loop.stop();
      unitView.clearReactions();
      view.canvas.removeEventListener('pointermove', onPointerMove);
      view.canvas.removeEventListener('pointerleave', onPointerLeave);
      hud.dispose();
      view.dispose();
    }
  };
}
