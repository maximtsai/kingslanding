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
    const spec = config.towers[typeOverride || hud.selected || 'archer'];
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

  // One tap does one of three things depending on phase and on what is under it,
  // and nothing else.
  attachGestures(view.canvas, view, (clientX, clientY) => {
    // The cutscene is not interactive. Camera drag and zoom still work, because
    // taking the camera away as well would read as the game having frozen.
    if (world.phase === PHASE.INTRO) return;
    const hit = pick(clientX, clientY, rect());
    if (!hit) return;

    // TDD 4: siting the castle is the opening beat and nothing else is
    // available until it is done -- not building, not even moving the king.
    if (world.phase === PHASE.CASTLE) {
      if (world.placeCastle(hit.i, hit.j)) ghost.hide();
      return;
    }

    if (world.phase === PHASE.BUILD) {
      if (hud.selected) {
        const type = hud.selected;
        if (world.build(type, hit.i, hit.j)) {
          // Deselect once the purse can no longer cover another, so a stray
          // second tap does not spend gold the player did not mean to spend.
          if (world.gold < config.towers[type].cost) hud.clearSelection();
        }
        return;
      }
      // TDD 7: tapping a placed tower opens its upgrade panel. Tapping anywhere
      // else closes it -- which is also how the panel is dismissed, so there is
      // no modal state a player can get stuck inside.
      const standing = world.structures.at(hit.i, hit.j);
      if (hud.inspect(standing)) return;
      if (hud.inspecting) return;
    }
    world.moveHero(hit.i, hit.j, hit.x, hit.z);  });

  // Desktop convenience: preview the tile and its true coverage under the cursor.
  // On touch there is no hover, so the overlay only appears on the tap that
  // places -- one of several reasons TDD 14 insists this gets tested on a phone.
  const onPointerMove = e => {
    if (world.phase === PHASE.INTRO) { ghost.hide(); return; }
    const placingCastle = world.phase === PHASE.CASTLE;
    if (!placingCastle && (world.phase !== PHASE.BUILD || !hud.selected)) { ghost.hide(); return; }
    const hit = pick(e.clientX, e.clientY, rect());
    if (!hit) { ghost.hide(); return; }
    if (placingCastle) {
      // No coverage probe: the castle's own guns are not the point of the
      // decision. Where it sits, and what can reach it, is.
      ghost.show(hit.i, hit.j, world.structures.canPlaceCastle(hit.i, hit.j),
                 null, config.castle.footprint);
      return;
    }
    ghost.show(hit.i, hit.j, world.structures.canPlace(hit.i, hit.j), probeCoverage, 1);
  };
  view.canvas.addEventListener('pointermove', onPointerMove);

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
      boatView.sync(world, blend);
      projectileView.sync(world, blend);
      coinView.sync(world, blend);
      heroView.sync(world, blend, elapsed);

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
    // Tile boundaries show while placing, so buildable space is unambiguous
    // (TDD 16), and disappear the moment nothing is selected.
    onSelectTower: type => {
      scene.gridMesh.visible = !!type || world.phase === PHASE.CASTLE;
      if (!type) ghost.hide();
    }
  });

  // Tile boundaries are on from the start, because the first thing the player
  // does is site a 2x2 castle and they need to see the grid to do it.
  scene.gridMesh.visible = true;

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
      hud.dispose();
      view.dispose();
    }
  };
}
