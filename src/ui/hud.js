// Hero TD -- DOM overlay.
//
// TDD section 16. Bottom-anchored and thumb-reachable, sized for 720x1280, and
// strictly phase-dependent: build UI exists only in the build phase, and combat
// has exactly one interaction, which is tapping the ground.
//
// The bottom third stays sparse during combat on purpose. TDD 13 settled that
// the hero has no abilities, so there is nothing to put there -- and putting
// something there anyway is how a positioning game quietly turns into a
// cooldown rotation.
//
// The upgrade panel REPLACES the build bar rather than sitting beside it. There
// is one thumb-reachable strip on a phone and it can only belong to one thing at
// a time; a tower is either selected or it is not.

import { config } from '../config.js';
import { PHASE } from '../sim/world.js';

export function createHud({ stage, view, world, loop, audio, feedback, gridMesh, unitView,
                            onReady, onSelectTower, onNextLevel, hasNextLevel }) {
  const $ = id => document.getElementById(id);

  // Everything this HUD attached to something it does not own. A level change
  // builds a second HUD over the same DOM, so anything that accumulates has to
  // be undoable -- see dispose(). Button handlers are `onclick` assignments and
  // overwrite cleanly; window listeners do not.
  const teardown = [];

  // ---- fit the fixed-size stage into the window ----
  function fit() {
    const scale = Math.min(window.innerWidth / 720, window.innerHeight / 1280);
    stage.style.setProperty('--stage-scale', scale);
  }
  window.addEventListener('resize', fit);
  teardown.push(() => window.removeEventListener('resize', fit));
  fit();

  // Every button makes the same small noise, so the UI has one voice. The
  // simulation never hears about a button being pressed -- a tap on ZOOM is not
  // a game event -- which is why this goes through feedback directly rather
  // than round-tripping an event through the world.
  const click = handler => event => { feedback.tap(); handler(event); };

  // ---- camera buttons ----
  // Eased, not instant: see renderer.js. Dragging stays 1:1 with the finger.
  $('btn-rotate').onclick = click(() => view.tweenRotate(Math.PI / 4));
  $('btn-zoom-in').onclick = click(() => view.zoom(-4));
  $('btn-zoom-out').onclick = click(() => view.zoom(4));

  // ---- options (TDD 14 and 19) ----
  // This button replaced the pause button, so OPENING IT PAUSES. Pause could not
  // simply be dropped with the button: section 14 is explicit that mobile
  // players get interrupted and pause is not optional. Closing restores whatever
  // the world was doing before, rather than blindly unpausing -- otherwise
  // opening options during an already-paused game would resume it on close.
  const optionsPanel = $('options-panel');
  const volumeSlider = $('opt-volume');
  const volumeValue = $('volume-value');
  let pausedBeforeOptions = false;

  function paintVolume() {
    const percent = Math.round(audio.volume * 100);
    volumeSlider.value = percent;
    volumeValue.textContent = percent + '%';
  }

  function setOptionsOpen(open) {
    optionsPanel.style.display = open ? 'grid' : 'none';
    if (open) {
      pausedBeforeOptions = world.paused;
      world.paused = true;
      paintVolume();
    } else {
      world.paused = pausedBeforeOptions;
    }
  }

  $('btn-options').onclick = () => { feedback.tap(); setOptionsOpen(true); };
  $('btn-close-options').onclick = () => { feedback.tap(); setOptionsOpen(false); };

  volumeSlider.oninput = () => {
    audio.setVolume(volumeSlider.value / 100);
    volumeValue.textContent = volumeSlider.value + '%';
  };
  // A slider you cannot hear is a slider you cannot set, so confirm on release
  // rather than on every input event -- dragging would fire dozens.
  volumeSlider.onchange = () => { if (audio.volume > 0) feedback.tap(); };
  paintVolume();

  // ---- build phase ----
  // Only tier-1 entries appear on the bar; everything deeper is reached by
  // upgrading something already standing (TDD 7).
  const buildButtons = [...document.querySelectorAll('[data-build]')];

  let selected = null;          // tower type queued for placement
  let inspecting = null;        // placed tower record whose panel is open

  function setSelected(type) {
    selected = selected === type ? null : type;
    if (selected) inspecting = null;
    for (const button of buildButtons) {
      button.classList.toggle('on', button.dataset.build === selected);
    }
    onSelectTower(selected);
    refreshPanels();
  }

  for (const button of buildButtons) {
    const type = button.dataset.build;
    button.onclick = () => {
      // Refusing a purchase is worth a sound too. A dead button that makes no
      // noise reads as a broken button.
      if (world.gold < config.towers[type].cost) { feedback.denied(); return; }
      feedback.tap();
      setSelected(type);
    };
  }

  $('btn-ready').onclick = click(() => {
    setSelected(null); inspecting = null; refreshPanels(); onReady();
  });

  // ---- the upgrade panel (TDD 5 and 7) ----
  const towerPanel = $('tower-panel');
  const towerName = $('tower-name');
  const towerTier = $('tower-tier');
  const towerHp = $('tower-hp');
  const towerOptions = $('tower-options');
  const takedown = $('btn-takedown');

  $('btn-close-tower').onclick = click(() => { inspecting = null; refreshPanels(); });

  takedown.onclick = () => {
    if (!inspecting) return;
    world.sell(inspecting);
    inspecting = null;
    refreshPanels();
  };

  // Rebuilt on open and after every purchase, because an upgrade changes the
  // record in place: the same tower is now a different type with different
  // options and a different refund.
  function drawTowerPanel() {
    if (!inspecting || !inspecting.alive) { inspecting = null; return; }
    const spec = config.towers[inspecting.type];
    towerName.textContent = spec.name;
    towerTier.textContent = 'T' + spec.tier;
    towerHp.textContent = `${Math.ceil(inspecting.hp)} / ${inspecting.maxHp} hp`;
    takedown.textContent = `TAKE DOWN  +${world.refundFor(inspecting)}`;

    towerOptions.textContent = '';
    const options = world.upgradeOptions(inspecting);
    if (!options.length) {
      const done = document.createElement('div');
      done.className = 'none';
      done.textContent = 'Fully upgraded.';
      towerOptions.appendChild(done);
      return;
    }
    for (const option of options) {
      const button = document.createElement('button');
      button.className = 'upgrade-button' + (option.affordable ? '' : ' poor');
      // TDD 5's grammar, said out loud. The silhouette carries it on the island;
      // the panel is where the player learns to read the silhouette.
      const shape = document.createElement('div');
      shape.className = 'shape';
      shape.textContent = option.shape ? option.shape.toUpperCase() : 'UPGRADE';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = option.name;
      const cost = document.createElement('div');
      cost.className = 'cost';
      cost.textContent = `${option.cost} gold`;
      button.append(shape, name, cost);
      button.onclick = () => {
        // The upgrade itself emits towerUpgraded, which feedback turns into the
        // rising blip -- so only the refusal needs a sound from here.
        if (world.upgrade(inspecting, option.type)) drawTowerPanel();
        else feedback.denied();
      };
      towerOptions.appendChild(button);
    }
  }

  // Which of the three bottom panels is showing. Called whenever anything that
  // decides it changes, rather than every frame.
  function refreshPanels() {
    const building = world.phase === PHASE.BUILD;
    const siting = world.phase === PHASE.CASTLE;
    // Nothing is shown during the arrival: no build bar, no castle prompt, no
    // incoming-wave badges. It is a shot, not a screen.
    const cutscene = world.phase === PHASE.INTRO;
    const inspectingNow = building && !!inspecting;
    const over = world.phase === PHASE.LOST || world.phase === PHASE.WON;
    // Settled here rather than only in update(), so a HUD built for a new level
    // does not inherit the previous one's win screen for a frame. The click that
    // advances the level happens inside that overlay, so the stale frame lands
    // squarely on top of the island the player is arriving at.
    overPanel.style.display = over ? 'flex' : 'none';
    // Shown whenever the player is deciding, which includes siting the castle --
    // knowing which shore the first wave lands on is exactly the information
    // that decision wants.
    previewBox.style.display = (building || siting) && !cutscene ? 'flex' : 'none';
    bottom.style.display = building || siting ? 'flex' : 'none';
    buildPanel.style.display = building && !inspectingNow ? 'flex' : 'none';
    towerPanel.style.display = inspectingNow ? 'flex' : 'none';
    castlePrompt.style.display = siting ? 'flex' : 'none';
    if (inspectingNow) drawTowerPanel();
  }

  // ---- failure recovery (TDD 13) ----
  $('btn-restart-wave').onclick = click(() => { inspecting = null; world.restartWave(); });
  $('btn-restart-level').onclick = click(() => { inspecting = null; world.restartLevel(); });
  const nextButton = $('btn-next-level');
  nextButton.onclick = click(() => onNextLevel());

  // ---- dev overlay ----
  const dev = $('dev');
  $('dev-toggle').onclick = () => dev.classList.toggle('hidden');
  for (const [id, key] of [['g-sat', 'saturation'], ['g-con', 'contrast'], ['g-vig', 'vignette']]) {
    const slider = $(id);
    slider.value = config.grade[key];
    slider.oninput = () => view.setGrade(key, parseFloat(slider.value));
  }
  const gridButton = $('t-grid');
  gridButton.onclick = () => {
    gridMesh.visible = !gridMesh.visible;
    gridButton.classList.toggle('on', gridMesh.visible);
  };

  // ---- incoming wave (the build-phase telegraph) --------------------------
  //
  // The simulation resolves the next wave's landings when the build phase
  // begins and the wave then uses exactly those (see waves.preview), so these
  // badges are a promise rather than an estimate. One per enemy TYPE per
  // landing: a boat carrying twelve grunts and two brutes is two badges, which
  // is the question the player is actually asking -- how much of what, and from
  // where.
  const previewBox = $('wave-preview');
  const threats = [];               // live badge elements, with their bearings
  let previewSignature = '';

  function buildPreview() {
    const preview = world.wavePreview || [];
    // Cheap identity for "is this the same wave laid out the same way".
    const signature = preview.map(b =>
      b.land.join(',') + ':' + Object.entries(b.counts).sort().map(e => e.join('x')).join('+')
    ).join('|');
    if (signature === previewSignature) return;
    previewSignature = signature;

    previewBox.textContent = '';
    threats.length = 0;
    if (!preview.length) return;

    const label = document.createElement('div');
    label.className = 'label';
    const total = preview.reduce((n, b) => n + b.total, 0);
    label.textContent = `INCOMING  ${total}`;
    previewBox.appendChild(label);

    // Earliest landing first, so the badges read in the order they will happen.
    for (const boat of [...preview].sort((a, b) => a.delay - b.delay)) {
      const types = Object.entries(boat.counts);
      let slot = 0;
      for (const [type, count] of types) {
        const badge = document.createElement('div');
        badge.className = 'threat';

        const arrow = document.createElement('div');
        arrow.className = 'threat-arrow';

        const body = document.createElement('div');
        body.className = 'threat-body';
        const icon = document.createElement('span');
        icon.className = 'eicon eicon-' + type;
        const number = document.createElement('span');
        number.className = 'threat-count';
        number.textContent = count;
        body.append(icon, number);

        badge.append(arrow, body);
        badge.title = `${count} ${type}${count === 1 ? '' : 's'}`;
        previewBox.appendChild(badge);
        // A boat carrying grunts AND brutes is two badges arriving from one
        // bearing. Without a slot they land on exactly the same pixel and the
        // second is invisible under the first.
        threats.push({ el: badge, arrow, spawn: boat.spawn,
                       slot: slot++, group: types.length,
                       aimed: null, placedX: null, placedY: null });
      }
    }
  }

  // Placed on the screen EDGE in the direction its boat comes from, and re-aimed
  // every frame because the camera orbits -- which way "north-east" points on
  // screen keeps changing.
  //
  // The ray starts at the island's centre AS PROJECTED, not at the middle of the
  // stage: the camera biases the island up the frame (config.camera.VIEW_OFFSET_Y)
  // so the two are ~150px apart, and using the stage centre would put every badge
  // slightly off the line the player reads it along.
  //
  // The rectangle it stops at is inset unevenly. The top has the phase badges and
  // the camera buttons, the bottom has the build bar; a badge landing under either
  // is a badge nobody sees.
  const EDGE = { left: 62, right: 658, top: 210, bottom: 1010 };
  const HALF = 40;                      // half the badge, so it centres on the edge
  const FAN = 88;                       // spacing when one landing needs two badges
  const MIN_GAP = 86;                   // and the floor between any two badges

  function aimPreview() {
    // Rays start at the king, because the camera now centres on him -- so the
    // badges radiate from the middle of the screen and read as "that way from
    // here". Before the camera followed him this was the island centre, which
    // was the same thing only by coincidence.
    const hero = world.hero;
    const origin = hero && hero.alive
      ? view.screenPositionOf(hero.x, hero.z, hero.y + 0.3)
      : view.screenPositionOf((world.board.N - 1) / 2, (world.board.N - 1) / 2);
    const cx = (EDGE.left + EDGE.right) / 2, cy = (EDGE.top + EDGE.bottom) / 2;
    const hw = (EDGE.right - EDGE.left) / 2, hh = (EDGE.bottom - EDGE.top) / 2;

    for (const threat of threats) {
      const point = view.screenPositionOf(threat.spawn.x, threat.spawn.z);
      let dx = point.x - origin.x, dy = point.y - origin.y;
      const span = Math.hypot(dx, dy);
      if (span < 1e-3) continue;
      dx /= span; dy /= span;

      // Where that ray leaves the inset rectangle.
      const tx = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity;
      const ty = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      let x = cx + dx * t, y = cy + dy * t;

      // Fan the badges of one landing sideways along the edge, centred on the
      // bearing, so two types from the same boat sit next to each other rather
      // than on top of one another. Perpendicular to the ray, which keeps the
      // group square-on to the direction it is reporting.
      if (threat.group > 1) {
        const offset = (threat.slot - (threat.group - 1) / 2) * FAN;
        x += -dy * offset;
        y += dx * offset;
      }


      // 0deg points up, clockwise positive -- and the badge sits ON the edge, so
      // the triangle points outward, off the screen, toward the open water the
      // boat is coming from.
      const angle = Math.atan2(dx, -dy) * 180 / Math.PI;

      if (threat.aimed === null || Math.abs(angle - threat.aimed) >= 0.75) {
        threat.aimed = angle;
        threat.arrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      }
      threat.x = x; threat.y = y;
    }

    // The per-landing fan only separates badges that share a bearing. Two
    // DIFFERENT landings can still arrive from bearings a few degrees apart --
    // at which point the badges overlap and the smaller number is unreadable.
    // Relaxation, the same shape as the unit separation in the simulation, and
    // for the same reason.
    //
    // The clamp is INSIDE the loop, not after it. Clamping last undoes the
    // separation: near a corner it pushes a badge straight back onto the
    // neighbour it was just moved away from, and the measured worst case was two
    // badges 44px apart with an 80px badge. Making the constraint part of the
    // iteration lets the two settle against each other instead.
    for (let pass = 0; pass < 6; pass++) {
      for (let a = 0; a < threats.length; a++) {
        for (let b = a + 1; b < threats.length; b++) {
          const A = threats[a], B = threats[b];
          let dx = B.x - A.x, dy = B.y - A.y;
          let span = Math.hypot(dx, dy);
          if (span >= MIN_GAP) continue;
          if (span < 1e-3) { dx = 0; dy = 1; span = 1; }   // deterministic split
          const push = (MIN_GAP - span) / 2;
          A.x -= (dx / span) * push; A.y -= (dy / span) * push;
          B.x += (dx / span) * push; B.y += (dy / span) * push;
        }
      }
      for (const t of threats) {
        t.x = Math.min(EDGE.right, Math.max(EDGE.left, t.x));
        t.y = Math.min(EDGE.bottom, Math.max(EDGE.top, t.y));
      }
    }

    for (const threat of threats) {
      const x = threat.x, y = threat.y;
      if (threat.placedX === Math.round(x) && threat.placedY === Math.round(y)) continue;
      threat.placedX = Math.round(x); threat.placedY = Math.round(y);
      threat.el.style.left = (x - HALF).toFixed(0) + 'px';
      threat.el.style.top = (y - HALF).toFixed(0) + 'px';
    }
  }

  const stats = $('dev-stats');
  let since = 0;
  let lastPhase = null;

  const buildPanel = $('build-panel');
  const bottom = $('bottom');
  const overPanel = $('over-panel');
  const castlePrompt = $('castle-prompt');
  const overTitle = $('over-title');
  const restartWave = $('btn-restart-wave');
  const goldValue = $('gold-value');
  const phaseLabel = $('phase-label');
  const phaseSub = $('phase-sub');
  let lastGold, lastWaveText, lastPoor;

  $('level-name').textContent = world.board.level.name;
  refreshPanels();

  return {
    get selected() { return selected; },
    clearSelection() { setSelected(null); },
    get inspecting() { return inspecting; },

    // Tapping a placed tower during the build phase opens its panel. Tapping
    // anywhere else closes it, which is why this also accepts null.
    inspect(record) {
      inspecting = (record && record.kind === 'tower' && record.alive) ? record : null;
      if (inspecting) setSelectedSilently(null);
      refreshPanels();
      return !!inspecting;
    },

    dispose() { for (const undo of teardown) undo(); },

    update(elapsed) {
      // Phase-dependent controls. TDD 7: zero tower interaction during combat.
      if (world.phase !== lastPhase) {
        lastPhase = world.phase;
        const building = world.phase === PHASE.BUILD;
        if (!building) { inspecting = null; setSelectedSilently(null); }
        refreshPanels();
        const won = world.phase === PHASE.WON;
        const over = won || world.phase === PHASE.LOST;
        phaseLabel.textContent =
          world.phase === PHASE.INTRO ? 'ARRIVAL' :
          world.phase === PHASE.CASTLE ? 'CASTLE' :
          world.phase === PHASE.BUILD ? 'BUILD' :
          world.phase === PHASE.WAVE ? 'WAVE' : world.phase;
        // Only written while the panel is actually up. Setting it on every phase
        // change means the losing title is sitting there, invisible, waiting for
        // the one frame that shows it before the winning one is written.
        if (over) {
          // TDD 18: three levels, and the last one ends the run rather than
          // wrapping. "ISLAND HELD" with nowhere to go is the end of the game.
          overTitle.textContent = won ? (hasNextLevel ? 'ISLAND HELD' : 'THE REALM STANDS') : 'THE ISLAND FELL';
          nextButton.style.display = won && hasNextLevel ? 'block' : 'none';
          // TDD 13: restart-wave is the default highlighted option.
          restartWave.style.display = won ? 'none' : 'block';
        }
      }

      // The preview is rebuilt on identity, so this is a string compare on most
      // frames and a DOM rebuild only when the wave actually changes.
      buildPreview();
      if (threats.length) aimPreview();

      if (world.gold !== lastGold) {
        lastGold = world.gold;
        goldValue.textContent = world.gold;
        // Affordability is drawn into the open panel, so it has to follow the
        // purse rather than only the selection.
        if (inspecting) drawTowerPanel();
      }
      const waveText = `${Math.min(world.waveIndex + 1, world.waveCount)} / ${world.waveCount}`;
      if (waveText !== lastWaveText) {
        lastWaveText = waveText;
        phaseSub.textContent = waveText;
      }

      // One flag character per buyable tower, so the whole bar's state is one
      // comparable string and the DOM is touched only when it flips.
      const poor = buildButtons
        .map(b => world.gold < config.towers[b.dataset.build].cost ? '1' : '0').join('');
      if (poor !== lastPoor) {
        lastPoor = poor;
        buildButtons.forEach((b, k) => b.classList.toggle('poor', poor[k] === '1'));
      }

      since += elapsed;
      if (since < 0.25) return;
      since = 0;
      stats.textContent = [
        `fps    ${loop.fps.toFixed(0).padStart(3)}`,
        `audio  ${audio.running ? (audio.muted ? 'muted' : 'on') : (audio.available ? 'suspended' : 'off')}`,
        `level  ${world.board.level.id}`,
        `phase  ${world.phase}`,
        `units  ${String(world.units.length).padStart(3)} (${unitView.count} drawn)`,
        `boats  ${world.waves.boats.length}  shots ${world.combat.projectiles.length}`,
        `towers ${world.structures.towers().length}  houses ${world.structures.houses().length}`,
        `castle ${(() => { const k = world.structures.theCastle();
           return k ? (k.alive ? Math.ceil(k.hp) + '/' + k.maxHp : 'FALLEN') : 'unplaced'; })()}`
      ].join('\n');
    }
  };

  // Clears the build-bar selection without the toggle semantics of setSelected,
  // which would turn "clear" into "re-select" when nothing was selected.
  function setSelectedSilently(type) {
    selected = type;
    for (const button of buildButtons) {
      button.classList.toggle('on', button.dataset.build === selected);
    }
    onSelectTower(selected);
  }
}
