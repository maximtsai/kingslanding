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

  // ---- PICK, PLACE, CONFIRM (TDD 16) ----
  //
  // Three steps, and each one answers exactly one question:
  //
  //   press a bar button   WHAT am I building        (arms `selected`)
  //   tap the ground       WHERE does it go          (sets `pending`)
  //   press the checkmark  am I SURE                 (spends the gold)
  //
  // The third step is the one that earns its keep. The tap that picks a tile is
  // the tap most likely to be wrong -- on a phone there is no hover to check a
  // spot with first, the finger hides the tile it is landing on, and the camera
  // is at an angle. So the tap only proposes; nothing is bought until a second,
  // deliberate press on a target that has already appeared on screen.
  //
  // It also buys back something the king-as-cursor version lost: the coverage
  // overlay is on ONLY while a placement is pending, so the build phase is not
  // spent looking at the king through a permanent slab of UI.
  let selected = null;          // tower type armed on the bar, or null
  let castleArming = false;     // the castle button is pressed in (CASTLE phase)
  let pending = null;           // { type, i, j, span, valid } -- a proposed spot
  let hovered = null;           // { i, j, valid } -- desktop hover, before any tap
  let inspecting = null;        // placed tower record whose panel is open

  // Placement is only live when something is ARMED. Nothing is armed on arrival,
  // so the first thing a player can do is walk around and look at the island --
  // which is the decision the castle siting is actually about.
  const arming = () => world.phase === PHASE.CASTLE ? castleArming : !!selected;

  const confirmLayer = $('place-confirm');
  const confirmButton = $('btn-confirm-place');
  const confirmLabel = $('place-confirm-label');
  const cancelPanel = $('place-cancel-panel');
  const cancelButton = $('btn-cancel-place');
  const deniedLayer = $('place-denied');
  const deniedText = $('place-denied-text');

  // A rejected spot says WHY out loud, very briefly, instead of only painting a
  // red footprint. Codes come from the simulation's placement predicates; this
  // map owns the wording.
  const PLACE_DENIED_TEXT = {
    water: 'CAN\u2019T PLACE ON WATER',
    stairs: 'CAN\u2019T PLACE ON STAIRS',
    cliff: 'CAN\u2019T PLACE ON CLIFF',
    obstruction: 'OBSTRUCTION',
    occupied: 'SPOT TAKEN',
    nopath: 'NO OPEN PATH'
  };

  function setSelected(type) {
    selected = selected === type ? null : type;
    // Arming something else abandons the pending spot rather than re-siting it:
    // a spot chosen for a barricade is not usually the spot for a ballista.
    clearPending();
    if (selected) inspecting = null;
    for (const button of buildButtons) {
      button.classList.toggle('on', button.dataset.build === selected);
    }
    onSelectTower(selected);
    refreshPanels();
  }

  function clearPending() {
    pending = null;
    hovered = null;
    confirmLayer.style.display = 'none';
  }

  // ---- siting the castle (TDD 4) ----
  // The same arm-tap-confirm shape as every tower, driven by one round button
  // instead of a bar of them. Once armed, the shared cancel button owns the
  // bottom bar until the castle is placed or placement is abandoned.
  const castleModeButton = $('btn-castle-mode');
  const castleHint = $('castle-hint');
  const CASTLE_HINT_IDLE = 'Choose the castle button, then pick a flat 2\u00d72 site.';
  const CASTLE_HINT_ARMED = 'Tap a flat 2\u00d72 of open ground, then confirm.';

  castleModeButton.onclick = () => {
    feedback.tap();
    castleArming = !castleArming;
    // Nothing has been bought yet; arming only hands control to the shared
    // placement/cancel flow.
    clearPending();
    castleModeButton.classList.toggle('on', castleArming);
    castleHint.textContent = castleArming ? CASTLE_HINT_ARMED : CASTLE_HINT_IDLE;
    onSelectTower(castleArming ? 'castle' : null);
    refreshPanels();
  };

  function cancelPlacement() {
    selected = null;
    castleArming = false;
    for (const button of buildButtons) button.classList.toggle('on', false);
    castleModeButton.classList.toggle('on', false);
    castleHint.textContent = CASTLE_HINT_IDLE;
    clearPending();
    onSelectTower(null);
    refreshPanels();
  }

  cancelButton.onclick = () => {
    feedback.tap();
    cancelPlacement();
  };

  // What is being placed right now, or null when nothing is armed.
  function armedFootprint() {
    if (world.phase === PHASE.CASTLE) {
      return castleArming ? { type: null, span: config.castle.footprint } : null;
    }
    if (world.phase !== PHASE.BUILD || !selected) return null;
    return { type: selected, span: 1 };
  }

  const placeReasonAt = (type, i, j) =>
    type ? world.structures.canPlaceReason(i, j) : world.structures.canPlaceCastleReason(i, j);
  const canPlaceAt = (type, i, j) => placeReasonAt(type, i, j) === null;

  // Desktop only: the footprint follows the cursor BEFORE the first tap, so the
  // spot can be shopped around without committing to one. It deliberately stops
  // once a placement is pending -- otherwise reaching for the confirm button
  // would drag the very footprint it is attached to out from under it.
  //
  // Touch has no hover at all, which is why the tap-then-confirm flow is the
  // real mechanism and this is only a convenience on top of it.
  function hover(i, j) {
    const armed = armedFootprint();
    if (!armed || pending) { hovered = null; return false; }
    if (hovered && hovered.i === i && hovered.j === j) return true;
    hovered = { i, j, span: armed.span, type: armed.type,
                valid: canPlaceAt(armed.type, i, j) };
    return true;
  }

  function clearHover() { hovered = null; }

  // Called by main on every tap that lands on the ground while something is
  // armed -- including taps on tiles that cannot take the building, because
  // "you cannot put it there" is information the player asked for and the red
  // footprint is how they get it. An invalid spot also says WHY for a moment;
  // there is simply no confirm button on one.
  function propose(i, j) {
    const armed = armedFootprint();
    if (!armed) return false;
    const { type, span } = armed;
    const reason = placeReasonAt(type, i, j);
    if (reason !== null) {
      // A rejected tap never becomes a pending proposal -- it only says why.
      // Were it stored, the desktop hover (and the ghost riding it) would lock
      // onto the tile the player already knows is wrong. It also means an
      // invalid tap elsewhere does not discard a valid proposal already up.
      feedback.denied();
      flashDenied(reason, i, j, span);
      return true;
    }
    const moved = !pending || pending.i !== i || pending.j !== j;
    pending = { type, i, j, span, valid: true };
    hovered = null;
    feedback.tap();
    if (type) {
      const spec = config.towers[type];
      confirmLabel.textContent = `${spec.name.toUpperCase()} - ${spec.cost} GOLD`;
      confirmButton.setAttribute('aria-label', `Build ${spec.name} for ${spec.cost} gold`);
    } else {
      confirmLabel.textContent = 'CASTLE - FREE';
      confirmButton.setAttribute('aria-label', 'Build castle here');
    }
    confirmLayer.style.display = 'block';
    placeConfirm();
    // Re-trigger the pop only when the target actually moves. Replaying it on
    // every tap of the same tile reads as a stutter rather than an arrival.
    if (moved) {
      confirmButton.classList.remove('pop');
      void confirmButton.offsetWidth;      // force the animation to restart
      confirmButton.classList.add('pop');
    }
    return true;
  }

  // The checkmark sits directly over the proposed footprint. It used to float
  // almost a hundred pixels above it, which weakened the visual connection
  // between the action and the tile being confirmed.
  const CONFIRM_LIFT = 12;
  const DENIED_LIFT = 6;
  const EDGE_PAD_X = 88;
  const EDGE_PAD_Y = 70;

  function anchorFor(i, j, span, lift) {
    const half = (span - 1) / 2;
    // Water tiles anchor on the water plane, not their below-sea topY, so a
    // "can't place on water" toast floats on the surface instead of under it.
    const anchor = view.screenPositionOf(
      i + half, j + half,
      Math.max(world.board.topY(i, j) + 0.08, 0.05)
    );
    // Clamped inside the stage: the camera rotates and zooms freely, and a
    // labelled button that has drifted off the edge is unfinishable (or useless).
    return {
      x: Math.min(720 - EDGE_PAD_X, Math.max(EDGE_PAD_X, anchor.x)),
      y: Math.min(1280 - EDGE_PAD_Y, Math.max(EDGE_PAD_Y, anchor.y - lift))
    };
  }

  function placeConfirm() {
    if (!pending || !pending.valid) return;
    const { x, y } = anchorFor(pending.i, pending.j, pending.span, CONFIRM_LIFT);
    confirmLayer.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // The rejection pops in over the rejected spot, holds a beat, then fades --
  // long enough to read, short enough to never become part of the background.
  function flashDenied(reason, i, j, span) {
    deniedText.textContent = PLACE_DENIED_TEXT[reason] || 'CAN\u2019T PLACE THERE';
    const { x, y } = anchorFor(i, j, span, DENIED_LIFT);
    deniedLayer.style.left = `${x.toFixed(1)}px`;
    deniedLayer.style.top = `${y.toFixed(1)}px`;
    deniedLayer.classList.remove('pop');
    void deniedLayer.offsetWidth;      // force the animation to restart
    deniedLayer.classList.add('pop');
  }

  confirmButton.onclick = () => {
    if (!pending || !pending.valid) return;
    if (world.phase === PHASE.CASTLE) {
      if (!world.placeCastle(pending.i, pending.j)) { feedback.denied(); return; }
      feedback.tap();
      castleArming = false;
      castleModeButton.classList.toggle('on', false);
      castleHint.textContent = CASTLE_HINT_IDLE;
      clearPending();
      onSelectTower(null);
      refreshPanels();
      return;
    }
    const type = pending.type;
    if (world.gold < config.towers[type].cost) { feedback.denied(); return; }
    if (!world.build(type, pending.i, pending.j)) { feedback.denied(); return; }
    feedback.tap();
    clearPending();
    // Disarm after every confirmed build so the bottom bar returns to the
    // three-option build panel (archer, barricade, ready) rather than staying
    // in placement mode. Each new build is a fresh deliberate choice.
    setSelected(null);
  };

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

  // ---- the tower menu (TDD 5 and 7) ----
  //
  // A RADIAL ANCHORED TO THE BUILDING, not a panel at the bottom of the screen.
  // A tower menu has a subject, and putting it on the subject means the player
  // never looks away from the thing to read its options, or has to work out
  // which of six towers a bottom panel is talking about.
  //
  // Three fixed seats: upgrades up-left and up-right, sell below. Fixed rather
  // than distributed around the circle, so the same choice is always in the same
  // place -- a tower with one upgrade leaves the second seat empty rather than
  // re-centring the first and moving the target under the player's thumb.
  const radial = $('tower-radial');
  const radialSeats = [$('radial-opt-a'), $('radial-opt-b')];
  const radialSell = $('radial-sell');

  // The menu OUTLIVES `inspecting` by the length of its close animation. The
  // record it is drawn for is held separately for exactly that reason: the
  // simulation-facing state clears the instant the player taps away, while the
  // visual shrinks out of the way over the next tenth of a second.
  let radialFor = null;
  let radialState = 'hidden';        // 'hidden' | 'open' | 'closing'
  let radialCloseAge = 0;
  const RADIAL_CLOSE = 0.14;         // seconds, matches the CSS animation

  function seatLabel(button, top, bottom) {
    button.textContent = '';
    if (top !== null) {
      const t = document.createElement('div');
      t.className = 'rb-shape';
      t.textContent = top;
      button.appendChild(t);
    }
    const b = document.createElement('div');
    b.className = 'rb-cost';
    b.textContent = bottom;
    button.appendChild(b);
  }

  // Rebuilt on open and after every purchase, because an upgrade changes the
  // record in place: the same tower is now a different type with different
  // options and a different refund.
  function drawRadial() {
    const record = radialFor;
    if (!record || !record.alive) return;
    const options = world.upgradeOptions(record);
    radialSeats.forEach((seat, k) => {
      const option = options[k];
      if (!option) { seat.style.display = 'none'; seat.onclick = null; return; }
      seat.style.display = 'grid';
      seat.classList.toggle('poor', !option.affordable);
      seat.title = `${option.name} -- ${option.cost} gold`;
      seatLabel(seat, option.shape ? option.shape.toUpperCase() : null, String(option.cost));
      seat.onclick = () => {
        // The upgrade itself emits towerUpgraded, which feedback turns into the
        // rising blip -- so only the refusal needs a sound from here.
        if (world.upgrade(record, option.type)) drawRadial();
        else feedback.denied();
      };
    });
    radialSell.title = `Take down for ${world.refundFor(record)} gold`;
    seatLabel(radialSell, null, '+' + world.refundFor(record));
    radialSell.onclick = () => {
      feedback.tap();
      world.sell(record);
      inspecting = null;
      refreshPanels();
    };
  }

  // Glued to the structure, so it holds station while the camera pans, orbits
  // and zooms underneath it.
  function placeRadial() {
    if (!radialFor) return;
    const span = radialFor.span || 1;
    const half = (span - 1) / 2;
    const p = view.screenPositionOf(
      radialFor.i + half, radialFor.j + half,
      world.board.topY(radialFor.i, radialFor.j) + 0.85
    );
    radial.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  function openRadial(record) {
    radialFor = record;
    radialState = 'open';
    radial.style.display = 'block';
    radial.classList.remove('closing');
    radial.classList.remove('opening');
    void radial.offsetWidth;                 // restart the pop
    radial.classList.add('opening');
    drawRadial();
    placeRadial();
  }

  function beginCloseRadial() {
    if (radialState !== 'open') return;
    radialState = 'closing';
    radialCloseAge = 0;
    radial.classList.remove('opening');
    radial.classList.add('closing');
  }

  // Called every frame. Finishing the close with display:none is the whole
  // point of animating it rather than snapping: a dismissed menu stops costing
  // layout and paint instead of lingering as an invisible but live subtree.
  function stepRadial(elapsed) {
    if (radialState === 'open') {
      if (!inspecting || inspecting !== radialFor || !radialFor.alive
          || world.phase !== PHASE.BUILD) {
        beginCloseRadial();
      } else {
        placeRadial();
      }
      return;
    }
    if (radialState !== 'closing') return;
    placeRadial();                            // keep it on the building as it shrinks
    radialCloseAge += elapsed;
    if (radialCloseAge < RADIAL_CLOSE) return;
    radialState = 'hidden';
    radialFor = null;
    radial.style.display = 'none';
    radial.classList.remove('closing');
    for (const seat of radialSeats) seat.onclick = null;
    radialSell.onclick = null;
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
    const placingNow = (building || siting) && arming();
    const over = world.phase === PHASE.LOST || world.phase === PHASE.WON;
    // Settled here rather than only in update(), so a HUD built for a new level
    // does not inherit the previous one's win screen for a frame. The click that
    // advances the level happens inside that overlay, so the stale frame lands
    // squarely on top of the island the player is arriving at.
    overPanel.style.display = over ? 'flex' : 'none';
    // Shown whenever the player is deciding, which includes siting the castle --
    // knowing which shore the first wave lands on is exactly the information
    // that decision wants.
    previewBox.style.display = building && !!world.structures.theCastle() && !cutscene ? 'flex' : 'none';
    bottom.style.display = building || siting ? 'flex' : 'none';
    // The build bar stays up while a tower menu is open: the menu floats over
    // the island rather than competing for the bottom strip, so there is no
    // longer a reason to take the bar away.
    buildPanel.style.display = building && !placingNow ? 'flex' : 'none';
    castlePrompt.style.display = siting && !placingNow ? 'flex' : 'none';
    cancelPanel.style.display = placingNow ? 'flex' : 'none';
    const nextBottomPanel = buildPanel.style.display !== 'none' ? buildPanel
      : castlePrompt.style.display !== 'none' ? castlePrompt
      : cancelPanel.style.display !== 'none' ? cancelPanel : null;
    if (nextBottomPanel !== shownBottomPanel) {
      if (shownBottomPanel) shownBottomPanel.classList.remove('bottom-panel-pop');
      shownBottomPanel = nextBottomPanel;
      if (shownBottomPanel) {
        shownBottomPanel.classList.remove('bottom-panel-pop');
        void shownBottomPanel.offsetWidth;
        shownBottomPanel.classList.add('bottom-panel-pop');
      }
    }
    if (inspectingNow && radialFor !== inspecting) openRadial(inspecting);
    // Driven from here rather than only from setSelected, because the grid
    // depends on the PHASE as much as on the selection -- and returning to the
    // build phase after a wave changes the phase without changing the
    // selection, which used to leave the lines switched off for the rest of it.
    onSelectTower(arming() ? (selected || 'castle') : null);
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
  const waveStartTitle = $('wave-start-title');
  let waveStartSerial = -1;
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
  let shownBottomPanel = null;

  refreshPanels();

  return {
    get selected() { return selected; },
    get inspecting() { return inspecting; },
    get inspectingId() { return inspecting ? inspecting.id : null; },
    // The proposed spot, or null. Read by main to drive the ground ghost.
    get pending() { return pending; },
    clearSelection() { setSelected(null); },

    // True while a placement is armed, so main knows a tap on the ground is a
    // proposal rather than a move order.
    get arming() { return arming(); },
    // The cursor footprint before any tap has been made, or null.
    get hovered() { return hovered; },

    // A tap on the ground while something is armed. Returns true if it was
    // consumed, so main knows not to treat the same tap as a move order.
    propose, hover, clearHover,

    // Tapping a placed tower during the build phase opens its panel. Tapping
    // anywhere else closes it, which is why this also accepts null.
    inspect(record) {
      inspecting = (record && record.kind === 'tower' && record.alive) ? record : null;
      if (inspecting) { setSelectedSilently(null); clearPending(); }
      refreshPanels();
      return !!inspecting;
    },

    dispose() { for (const undo of teardown) undo(); },

    update(elapsed) {
      // Phase-dependent controls. TDD 7: zero tower interaction during combat.
      if (world.phase !== lastPhase) {
        lastPhase = world.phase;
        if (world.phase === PHASE.WAVE && world.waveIndex !== waveStartSerial) {
          waveStartSerial = world.waveIndex;
          waveStartTitle.textContent = `WAVE ${world.waveIndex + 1}`;
          waveStartTitle.classList.remove('show');
          void waveStartTitle.offsetWidth;
          waveStartTitle.classList.add('show');
        }
        const building = world.phase === PHASE.BUILD;
        const siting = world.phase === PHASE.CASTLE;
        if (!building) { inspecting = null; setSelectedSilently(null); }
        // Neither a pending placement nor an armed castle survives the phase
        // that offered it.
        if (!siting && castleArming) {
          castleArming = false;
          castleModeButton.classList.toggle('on', false);
          castleHint.textContent = CASTLE_HINT_IDLE;
        }
        if (!building && !siting) clearPending();
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

      stepRadial(elapsed);

      // The confirm button is anchored to a tile, not to the screen, so it has
      // to be re-projected every frame -- the camera follows the king and can
      // be rotated and zoomed while a placement is still pending.
      if (pending && pending.valid) placeConfirm();

      // The preview is rebuilt on identity, so this is a string compare on most
      // frames and a DOM rebuild only when the wave actually changes.
      const showPreview = world.phase === PHASE.BUILD && !!world.structures.theCastle();
      previewBox.style.display = showPreview ? 'flex' : 'none';
      buildPreview();
      if (threats.length) aimPreview();

      if (world.gold !== lastGold) {
        lastGold = world.gold;
        goldValue.textContent = world.gold;
        // Affordability is drawn into the open panel, so it has to follow the
        // purse rather than only the selection.
        if (radialState === 'open') drawRadial();
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
