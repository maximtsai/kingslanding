// Hero TD -- every tunable, in one place.
//
// TDD section 17: "Put every tunable in one config object at the top ... You will
// change these constantly." Nothing outside this file may hard-code a gameplay
// number. Render-only constants that describe the *art* rather than the *game*
// (material colours, mesh proportions) stay next to the geometry they belong to.
//
// Numbers here are placeholders in the TDD's sense: authored to make the loop
// playable, not balanced. What matters is the ordering and the gaps.

export const config = {

  // ---- simulation ----
  sim: {
    HZ: 60,                  // fixed timestep rate
    MAX_CATCHUP: 5           // steps per frame before we surrender and drop time
  },

  // ---- board ----
  // TILE/TIER/CAP/DROP describe how the integer height grid becomes geometry.
  // The renderer and the simulation must agree on these exactly, which is the
  // reason they live here rather than in the terrain builder.
  board: {
    TILE: 1,
    TIER: 0.6,               // world rise per height step
    CAP: 0.08,               // thin grass lip overhanging each cliff
    DROP: 0.55,              // how far the island sits below the waterline datum
    SINK: 0.02,              // how far props settle into the ground; nothing hovers
    // How far off the centre line of a diagonal crossing a walker may stray and
    // still be treated as ON the crossing -- both for its height and for whether
    // it may stand there at all.
    //
    // 0.10 was far too tight. A unit is pushed around by separation by roughly
    // its own push radius (0.18 to 0.26), so it fell out of the corridor
    // constantly, sampled the rounded tile underneath instead, and DROPPED A
    // TIER mid-stride. Wide enough to absorb that, and no wider: the corridor
    // also licenses standing over a water shoulder, and past about a third of a
    // tile the walker visibly hangs over the sea.
    CORNER_PATH_HALF_WIDTH: 0.30
  },

  // ---- camera ----
  camera: {
    PITCH: 35 * Math.PI / 180,   // TDD 14: shallower and cliffs lose screen space
    YAW_START: 0.62,
    DISTANCE: 50,                // orthographic, so this only has to clear the geometry
    // Default framing, in board FRAME multiples -- 1.2 means the view is about
    // one and a fifth islands tall. Was 3, which framed the whole island with
    // room around it: right for a fixed camera, far too wide once the camera
    // started riding the king.
    FRUSTUM_START: 1.2,
    // Per-60Hz-frame multiplier on the shake amplitude. 0.86 lands a jolt at
    // about a fifth of a second, which is long enough to feel and short enough
    // that two in a row do not smear into one continuous wobble.
    SHAKE_DECAY: 0.86,
    // The player's range, moved down with the default rather than left where it
    // was. ZOOM_MIN of 1.25 now sits ABOVE the default framing, so the first
    // press of either zoom button would jump the camera outward before doing
    // anything the player asked for.
    ZOOM_MIN: 0.8,
    ZOOM_MAX: 2.6,
    VIEW_OFFSET_Y: 0.0275,       // 25% of the original upward frame bias
    // The camera rides the king rather than the island (Thronefall), keeping him
    // centered in the visible viewport.
    FOLLOW: true,
    // Seconds to close most of the gap. SET IT TO 0 FOR A HARD LOCK -- the code
    // handles that, and he will then be pinned to the exact centre pixel.
    //
    // It is not zero by default because the camera would inherit every sudden
    // correction made to the king: the separation pass shoving him off a wall,
    // and above all the cliff jump, which moves him a whole tier in a few
    // frames and would throw the entire frame with him. At 0.09 he trails the
    // centre by about 35px at walking speed and sits exactly on it whenever he
    // stops, which is most of the time.
    FOLLOW_LAG: 0.09,
    // Vertical movement is damped separately. A little more lag keeps elevation
    // changes calm without adding noticeable delay to horizontal tracking.
    FOLLOW_Y_LAG: 0.16,
    // Keep the camera target at the king's feet; the follow target is centered
    // vertically by the viewport, so no extra lift is needed.
    FOLLOW_HEIGHT: 0.1375,       // 25% of the original follow lift
    DRAG_SPEED: 0.008,
    WHEEL_SPEED: 0.012,
    // Button-driven rotation eases instead of snapping. Dragging stays 1:1 with
    // the finger -- a tween on a drag feels like input lag, not like polish.
    TWEEN_SECONDS: 0.7
  },

  // ---- input (TDD 14) ----
  // Drag-to-rotate and tap-to-move share one finger. The threshold is distance,
  // never time, so a slow deliberate tap still issues a move order.
  gestures: {
    DRAG_THRESHOLD: 12,      // px before a pending tap becomes a rotation
    TAP_MAX_MS: 1200         // generous; a long press is still a tap, not a drag
  },

  // ---- line of sight and elevation (TDD 9) ----
  // Heights are world units; a tier is 0.6, which is the number to hold in mind
  // when reading the arc constants.
  los: {
    ARC_APEX_BASE: 0.34,     // lift on even the shortest lob
    ARC_APEX_PER_TILE: 0.16, // ...growing with span, so long shots visibly hang
    ARC_SAMPLES: 14,
    FLAT_ARC_LIFT: 0.10,     // enough to read as a projectile, far too little to clear a tier
    FLAT_SAMPLES: 14,
    EPSILON: 0.02,           // clearance required over the ground
    MUZZLE_HEIGHT: 0.9,      // above a tower's own tile: roughly the cabin slit
    TARGET_HEIGHT: 0.2,      // above a unit's tile: chest, not feet
    RANGE_PER_TIER: 0.75,    // TDD 9: +/- per tier of difference...
    RANGE_CAP: 1.5           // ...capped, so a tier-3 tower does not cover the sea
  },

  // ---- post grade ----
  grade: { saturation: 1.02, contrast: 1.05, vignette: 0.46 },

  // ---- projectile impacts ----
  projectiles: {
    groundLifetime: 5,
    embedLifetime: 5,
    overtravelDistance: 0.14,
    missGravity: 4.8,
    submergedLifetime: 0.2,
    rippleLifetime: 0.8
  },

  // ---- construction presentation ----
  construction: {
    duration: 1.58,
    dustDuration: 0.72,
    dustStopBeforeEnd: 0.4,
    towerRiseDepth: 1.55,
    castleRiseDepth: 2.35,
    towerDustPuffs: 14,
    castleDustPuffs: 24,
    shakeOffset: 0.018,
    shakeTilt: 0.016,
    shakeRate: 42
  },

  // ---- the castle (TDD 4) ----
  // Free, mandatory, placed once before any tower. A permanent objective: it
  // cannot be upgraded, moved, taken down or rebuilt, and the wave is lost the
  // instant it falls.
  castle: {
    name: 'Castle',
    footprint: 2,              // 2x2 tiles, all level, all empty
    hp: 420,
    range: 3.5,
    minRange: 0,               // TDD 4: explicitly none
    damage: 8,
    arrowsPerVolley: 2,
    fireInterval: 1.3,
    arrowSpeed: 8.5,
    trajectory: 'arc'
  },

  // ---- the tower tree (TDD 5 and 6) ----
  //
  // Two lines, three tiers, four endpoints each. T1 is the base, T2 picks a
  // specialisation, T3 picks a capstone within it.
  //
  // The visual grammar is a promise the renderer has to keep (TDD 5): WIDER
  // means more projectiles per volley, TALLER means more range and more HP. A
  // player should be able to read any tower's build across the island without a
  // tooltip.
  //
  // Every tier is one tile. Upgrades change stats and silhouette, never
  // footprint -- which is what lets an upgrade be a pure stat swap on a record
  // that is already placed.
  towers: {

    // ============================ ARCHER LINE ============================
    archer: {
      name: 'Archer Tower', line: 'archer', tier: 1,
      cost: 40, hp: 100,
      range: 3.0, minRange: 0.5,
      damage: 9, arrowsPerVolley: 2, fireInterval: 1.15,
      arrowSpeed: 8.5, trajectory: 'arc',
      buildTime: 1.5,
      upgradesTo: ['fortified', 'ballista']
    },

    // T2: never idle. It arcs at range and drops burning rocks on anything that
    // closes, both in the same tick -- which keeps the archer's dead zone as
    // character rather than as helplessness.
    fortified: {
      name: 'Fortified Tower', line: 'archer', tier: 2, shape: 'wide',
      cost: 50, hp: 220,
      range: 4.5, minRange: 0.5,
      damage: 9, arrowsPerVolley: 2, fireInterval: 1.15,
      arrowSpeed: 8.5, trajectory: 'arc',
      buildTime: 1.5,
      // Same damage as one arrow, fired simultaneously with the volley.
      burningRocks: { damage: 9, radius: 1.4 },
      upgradesTo: ['garrison', 'watchtower']
    },

    // T2: the flat trajectory is the real cost. Blind inside 1.5 tiles, blocked
    // by cliffs an arc would clear, and therefore hungry for high ground and
    // open water. Measured in P2: 23 covered tiles from the shore, 51 from the
    // summit.
    ballista: {
      name: 'Ballista Tower', line: 'archer', tier: 2, shape: 'tall',
      cost: 60, hp: 100,
      range: 8, minRange: 1.5,
      damage: 30, arrowsPerVolley: 1, fireInterval: 2.1,
      arrowSpeed: 13.5, trajectory: 'flat',
      buildTime: 1.5,
      upgradesTo: ['twinBallista', 'siegeTower']
    },

    // T3 Wide off Fortified: four arrows, same rhythm.
    garrison: {
      name: 'Garrison', line: 'archer', tier: 3, shape: 'wide',
      cost: 70, hp: 260,
      range: 4.5, minRange: 0.5,
      damage: 9, arrowsPerVolley: 4, fireInterval: 1.15,
      arrowSpeed: 8.5, trajectory: 'arc',
      buildTime: 1.5,
      burningRocks: { damage: 9, radius: 1.4 },
      upgradesTo: []
    },

    // T3 Tall off Fortified: fewer arrows, more reach and more wall.
    watchtower: {
      name: 'Watchtower', line: 'archer', tier: 3, shape: 'tall',
      cost: 70, hp: 320,
      range: 6.2, minRange: 0.5,
      damage: 11, arrowsPerVolley: 2, fireInterval: 1.15,
      arrowSpeed: 8.5, trajectory: 'arc',
      buildTime: 1.5,
      burningRocks: { damage: 9, radius: 1.4 },
      upgradesTo: []
    },

    // T3 Wide off Ballista: two bolts per volley. Deliberately NOT a faster gun
    // -- doubling the count keeps the slow heavy rhythm intact.
    twinBallista: {
      name: 'Twin Ballista', line: 'archer', tier: 3, shape: 'wide',
      cost: 80, hp: 140,
      range: 8, minRange: 1.5,
      damage: 30, arrowsPerVolley: 2, fireInterval: 2.1,
      arrowSpeed: 13.5, trajectory: 'flat',
      buildTime: 1.5,
      upgradesTo: []
    },

    // T3 Tall off Ballista: one bolt, further. Stacked with the elevation bonus
    // this covers most of the island from tier 3, which is what makes the ramp
    // up there the most valuable ground on the map.
    siegeTower: {
      name: 'Siege Tower', line: 'archer', tier: 3, shape: 'tall',
      cost: 80, hp: 190,
      range: 10, minRange: 1.5,
      damage: 36, arrowsPerVolley: 1, fireInterval: 2.1,
      arrowSpeed: 13.5, trajectory: 'flat',
      buildTime: 1.5,
      upgradesTo: []
    },

    // =========================== BARRICADE LINE ===========================
    // TDD 6: the barricade deals zero damage, so an archer tower is the
    // mandatory first purchase and this is what you buy alongside it. Priced so
    // it is always affordable.
    barricade: {
      name: 'Barricade', line: 'barricade', tier: 1, shape: 'wide',
      cost: 18, hp: 150,
      damage: 0, buildTime: 1.5,
      upgradesTo: ['bulwark', 'spearBunker']
    },

    // T2: reshapes where enemies walk. Still no attack.
    bulwark: {
      name: 'Bulwark', line: 'barricade', tier: 2, shape: 'wide',
      cost: 30, hp: 450,
      damage: 0, buildTime: 1.5,
      upgradesTo: ['spikes', 'catapult']
    },

    // T2: kills what walks past it. Every hit resets an attacker's approach, so
    // its effective durability against a packed group runs far above its 220 --
    // and against a single brute it is exactly 220. That gap is the point.
    spearBunker: {
      name: 'Spear Bunker', line: 'barricade', tier: 2, shape: 'tall',
      cost: 40, hp: 220,
      range: 1.1, minRange: 0,
      damage: 16, fireInterval: 1.0,
      melee: true, knockback: 0.5,
      buildTime: 1.5,
      upgradesTo: ['spikes', 'catapult']
    },

    // T3 off either T2. HP is a bonus on the parent rather than an absolute, so
    // one entry serves both branches -- a spiked Bulwark and a spiked Spear
    // Bunker are different end states with the same behaviour, which is exactly
    // how TDD 6 describes them.
    spikes: {
      name: 'Spikes', line: 'barricade', tier: 3, shape: 'wide',
      cost: 35, hpBonus: 60,
      damage: 0, buildTime: 1.5,
      reflect: 14,               // damage returned to anything meleeing it
      upgradesTo: []
    },

    // T3: cannot hit what is attacking it, so it needs cover. Pairing one behind
    // a bulwark is the obvious combination and being discoverable is the point.
    catapult: {
      name: 'Catapult', line: 'barricade', tier: 3, shape: 'tall',
      cost: 60, hpBonus: 40,
      range: 5.75, minRange: 2.0,
      damage: 26, arrowsPerVolley: 1, fireInterval: 3.2,
      arrowSpeed: 5.5, trajectory: 'arc',
      splash: 1.3,               // AOE radius on impact
      buildTime: 1.5,
      upgradesTo: []
    }
  },

  // ---- enemies (TDD 10) ----
  // Three jobs, not three stat lines: the grunt is volume, the archer outranges
  // anything that cannot reach back, and the brute breaks a chokepoint.
  enemies: {
    grunt: {
      hp: 40,
      speed: 1.0,
      damage: 7,
      attackInterval: 0.9,
      // Reach to a structure's EDGE, not its centre. A 2x2 castle has no useful
      // centre distance for a melee attacker, and edge distance makes one number
      // work for every footprint.
      //
      // MUST EXCEED THE HARD-COLLISION STANDOFF, which is
      // 0.5 + pushRadius + separation.STRUCTURE_CLEARANCE (here 0.72). A melee
      // range below that is unreachable by construction: the collision pass holds
      // the unit further out than its own arm, so it walks up to the wall and
      // stands there forever, looking like a pathing bug.
      attackRange: 0.90,
      aggroRange: 1.45,        // TDD 10: always slightly greater than attackRange
      attentionRange: 1.95,    // ...and slightly greater again, to stop a retaliation
      pushRadius: 0.10,        //    tighter unit-to-unit clustering
      hitRadius: 0.34,          // slightly smaller combat footprint
      hitRadius: 0.40,
      gold: 4                  // P1 stand-in for the coin drops of TDD 12
    },

    // Stops at range and fires. Outranges a spear bunker and will grind an
    // elevated tower down from outside its reach if left alone -- somebody has
    // to go and deal with that, and that somebody is the king (TDD 10).
    archer: {
      hp: 25,
      speed: 1.0,
      damage: 6,
      attackInterval: 1.6,
      // `range`, NOT `attackRange`. Everything that shoots goes through
      // combat.canHit, and canHit reads `range` -- so an archer carrying its
      // reach under the melee name has no range at all as far as the only code
      // that checks is concerned. `undefined + elevationBonus` is NaN, every
      // `d > NaN` is false, and the archer becomes a sniper with the whole
      // island in its sights. That is what this spec did for the whole of P3 and
      // P4, and it is why combat.js now refuses to build with a ranged spec that
      // has no range.
      range: 4.0,              // TDD 10, rescaled with the board like everything else
      aggroRange: 4.6,
      attentionRange: 5.1,
      minRange: 0,
      ranged: true,
      trajectory: 'arc',       // lobs, so cliffs do not protect a tower from it
      projectileSpeed: 7.5,
      pushRadius: 0.10,
      hitRadius: 0.32,
      gold: 5
    },

    // Slow and enormously durable. Against a single brute a spear bunker's
    // knockback buys nothing, which is exactly the gap that makes it interesting.
    brute: {
      hp: 200,
      speed: 0.6,
      damage: 22,
      attackInterval: 1.5,
      // Standoff is 0.5 + 0.26 + 0.04 = 0.80, so reach has to clear that.
      attackRange: 1.00,
      aggroRange: 1.55,
      attentionRange: 2.05,
      pushRadius: 0.14,        // tighter unit-to-unit clustering
      hitRadius: 0.44,
      gold: 14
    }
  },
  MAX_ENEMIES: 40,             // TDD 10: design waves against this ceiling

  // ---- separation and knockback (TDD 8) ----
  separation: {
    ITERATIONS: 2,             // TDD 8: two passes is enough at 40 units
    // Margin outside a structure's tile; nothing ever overlaps a building. Note
    // the coupling: every melee attackRange above must exceed
    // 0.5 + that unit's pushRadius + this, or the attacker can never reach.
    STRUCTURE_CLEARANCE: 0.04,
    // TDD 8 open item, resolved as the document's own default: knockback into a
    // cliff edge CLAMPS rather than dropping the unit. Falling is more fun and
    // fits the hero's jump-down, but it needs a fall-damage path that does not
    // exist, and a half-built one would be worse than neither.
    KNOCKBACK_CLIFF: 'clamp',
    KNOCKBACK_STEP: 0.08       // march resolution when clamping at an edge
  },

  // ---- hero (TDD 13) ----
  hero: {
    hp: 100,
    speed: 1.7,                // noticeably faster than a grunt, or he cannot respond
    range: 3.5,
    minRange: 0,               // TDD 13: he is never helpless up close
    trajectory: 'arc',         // he lobs, so cliffs do not blind him
    // TDD 13 asks for "grunts die in two shots". 13 took four, which quietly
    // made him a chip-damage dealer rather than the response force he is meant
    // to be. Brutes still take ten, which is the grind the section wants.
    damage: 20,
    fireInterval: 0.6,
    arrowSpeed: 10.5,
attackWindup: 0.26,   // draw takes most of the windup so the shot reads as loaded
    attackRecovery: 0.3,
    reviveDelay: 6,            // TDD 13: +2s per further death in the same wave
    reviveIncrement: 2,
    cliffAnticipation: 0.18,
    cliffAirTime: 0.46,
    cliffLanding: 0.22,
    cliffHopHeight: 0.24,
    cliffTakeoff: 0.38,       // tiles from the high tile centre; edge is at 0.5
    stairUpSpeed: 0.75,       // fraction of normal speed while climbing stairs
    walkAnimRate: 2,          // animation cadence only; does not alter movement speed
    towerHitboxHalfExtent: 0.28, // hero-only; arrow towers are fully pass-through

    // ---- tapping somewhere he cannot stand ----
    // A tap inside a house used to do nothing whatever, which reads as a dropped
    // input. It now walks him to the nearest spot he CAN stand, searched
    // outward from the tap.
    //
    // The radius is the whole design. moveTo's original note -- that sending him
    // to the nearest reachable tile "would look like the input was misread" --
    // is right about DISTANT snapping and wrong about local: walking to the edge
    // of the building you touched is obvious, walking across the island is not.
    // Beyond this many tiles the tap is still ignored.
    snapRadius: 3,
    // Ceiling on reachability tests per tap. Each one is a flow-field build, and
    // the first candidate succeeds essentially always; this only bounds the
    // pathological case of tapping into a sealed pocket.
    snapAttempts: 6,
    // How far into the destination tile the aim point is pulled from its edge.
    // Half a tile is 0.5, so 0.35 stands him 0.15 clear of the boundary -- close
    // to the side he tapped, without standing on the line.
    snapInset: 0.35
  },

  // ---- economy (TDD 12) ----
  economy: {
    startGold: 60,             // one archer tower, with change; wave 1 is a real choice
    houseIncome: 10,           // per surviving house, at the start of build phase
    // Coins drop where a unit died and the king picks them up by walking over
    // them. TDD 12 is explicit that this is a feel-good mechanic and a reason to
    // move during a lull, never a requirement -- so anything still on the ground
    // when the wave clears flies to him automatically.
    coin: {
      pickupRadius: 0.55,
      magnetRadius: 1.6,       // starts drifting toward him before he is on it
      magnetSpeed: 5.0,
      flySpeed: 14,            // the auto-collect sweep at end of wave
      scatter: 0.28            // how far a coin bounces from the body
    }
  },

  // ---- hit reactions ----
  // A unit that has just been hit swells and is shoved back along the line of
  // the blow, then settles. Deliberately a MATRIX effect rather than a colour
  // flash: three.js r128 wires InstancedMesh.setColorAt on the vertex side only
  // -- `color_pars_fragment` guards vColor on USE_COLOR and never on
  // USE_INSTANCING_COLOR -- so instance colours are computed, passed to a
  // varying the fragment shader does not declare, and silently discarded. The
  // fix upstream is a later revision; the fix here is to use the transform the
  // instancing already writes every frame.
  hit: {
    seconds: 0.16,
    swell: 0.22,               // peak scale bump, eased in and out
    recoil: 0.10,              // tiles, along the incoming direction
    heroSwell: 0.14,           // the king is bigger; the same bump reads louder
    heroSeconds: 0.20
  },

  // ---- the arrival cutscene (level one only) ----
  // Driven by an `intro` block in the level; a level without one opens straight
  // on castle siting. See sim/intro.js.
  intro: {
    sailSeconds: 3,            // spawn to grounding; slightly faster arrival
    // Magnification at the start, relative to the default framing, and well
    // inside ZOOM_MIN -- the cutscene is allowed past what the player may do.
    //
    // 3, not 6: the default framing is now two and a half times tighter than it
    // was, so keeping the ratio would open on a shot barely taller than the king
    // himself. This holds the opening close to what it was in absolute terms
    // while the pull-back still travels three times its own height.
    startZoom: 3,
    // Slightly SHORTER than the cutscene itself (sail 4.0 + leap ~0.86 + settle
    // 0.7 = about 5.6s), so the camera finishes its move, holds for a beat, and
    // only then hands over. Running past the handover would leave the player's
    // first frame of control still drifting, and freeze it a hair off the
    // default framing.
    zoomSeconds: 5.3,
    // The interior floor, matching waves.deckHeight -- it is the same hull. He
    // stands down in the boat with the rim crossing his shins, rather than on
    // top of a lid.
    deckHeight: 0.041,
    stopOffset: 0.30,          // how far short of the landing tile the hull grounds
    settleSeconds: 0.7,        // beat after the landing before control passes
    // The intro boat stays grounded until the king is clear, then reverses and sinks.
    boatGroundSeconds: 0.55,
    boatSlideBack: 0.465,
    boatSlideSeconds: 1.375,
    boatSubmergeSeconds: 6,
    boatSway: 0.13,
    boatSwayRate: 8.5,
    bubbleInterval: 0.18,
    bubbleLifetime: 0.9
  },

  // ---- evening (the wave phase) ----
  // Thronefall carries its whole day/night rhythm in the light, and pressing
  // READY here changed a badge from BUILD to WAVE and nothing else. This tints
  // toward evening while a wave is on the island and back to daylight when it
  // clears, so the phase is felt rather than read.
  //
  // DELIBERATELY SUBTLE. Not night: the enemy silhouettes are near-black by
  // TDD 15's hue rule, and dropping the ambient far enough to read as darkness
  // would lose them against the ground -- which is the one thing section 15
  // will not trade. Warmer and lower-contrast, with the fill barely moved.
  // HUE ONLY. Every intensity below is identical to the daylight value it
  // replaces, and the grade pass is not touched at all. That is not laziness,
  // it is the whole fix: the first version dimmed the key, lifted the vignette
  // and pulled saturation down, and the result read as haze rather than as
  // evening. Contrast is the ratio between the lit and unlit faces of a cliff,
  // so moving the key and the fill apart -- or desaturating on top -- is exactly
  // how a scene goes soft. Change what colour the light is, not how much.
  //
  // The fog is pushed FURTHER OUT in the evening, not pulled in. Distance fog is
  // the single largest contributor to a hazy read, and a warm evening wants less
  // of it than a bright day, not more.
  evening: {
    seconds: 2.2,              // eased both ways; a hard cut reads as a bug
    sun:     { color: 0xffa869, intensity: 0.34 },   // day: 0xfff2dc @ 0.34
    rim:     { color: 0x8fa6d6, intensity: 0.18 },   // day: 0xa8ccdf @ 0.18
    hemi:    { sky: 0xffc9a4, ground: 0xd8c3a2, intensity: 0.45 },  // day: 0xeaf4f8 / 0xd6cfc0 @ 0.45
    ambient: { color: 0xffdcc2, intensity: 0.35 },   // day: 0xfffdf8 @ 0.35
    // The backdrop carries most of the red. TDD 15 reserves saturated warm hues
    // for the king and the banners, so this stays a dusky rose rather than a
    // sunset orange -- far enough from the king's #c2352f that his cape still
    // wins, and complementary to the grass, which is what keeps it crisp.
    // The sky is a screen-vertical gradient on the water plane (see water.js),
    // NOT scene.background -- that plane covers the frame, so the clear colour
    // is never visible and setting it alone changed nothing.
    //
    // Cool overhead, warm at the horizon, which is both what an evening sky
    // actually does and what keeps the red off most of the frame. TDD 15
    // reserves saturated warm hues for the king and the banners; a warm band low
    // in the frame leaves his #c2352f cape the most saturated thing on screen,
    // where an all-over orange would not.
    water: {
      top: 0x6a6f9c,           // day: 0x6fb0c2, overhead
      bottom: 0xd6a184,        // day: 0xc2d5d4, toward the viewer
      pool: 0x9c7f92           // day: 0x7cc0cd, the light pool around the island
    },
    sky: 0xb2786c,             // the clear colour, kept in step even though the
                               // water plane hides it -- see above
    haze: 0xc08a76,
    fogNear: 62,               // day: 44
    fogFar: 150                // day: 118
  },

  // ---- occlusion (TDD 15) ----
  // "Fade or x-ray structures occluding units behind them", and "if a unit can
  // be attacked, it must be visible. No exceptions." The camera orbits, so this
  // is not an edge case -- there is always some yaw at which the castle stands
  // between the player and his own king.
  occlusion: {
    enabled: true,
    opacity: 0.28,           // what an occluding structure fades TO
    padding: 0.12,           // tiles of slack around the silhouette, so a unit
                             // grazing the edge fades it before it is hidden
    fadeRate: 9              // per second; ~0.11s in and out. Fast enough not to
                             // lag the camera, slow enough not to strobe when a
                             // crowd crosses behind a wall.
  },

  // ---- feedback (TDD 15 and 17) ----
  // What the presentation layer does about things the simulation reported.
  // Shake is in world units and is applied to the camera and its look-at target
  // together, so the view translates rather than swivelling.
  feedback: {
    // All amplitudes taken down 40% from the first pass. The ceiling scales with
    // them rather than staying put, or it would start binding on impacts it was
    // never meant to touch and quietly flatten the difference between a
    // catapult and a castle falling.
    shake: {
      max: 0.33,               // hard ceiling however much lands in one frame
      splash: 0.12,
      burningRock: 0.042,
      structureDestroyed: 0.144,
      castleDestroyed: 0.30,
      castlePlaced: 0.096,
      boatLanded: 0.03,
      heroHit: 0.054,
      heroDied: 0.18,
      lost: 0.33
    },
    // The wave-clear sweep pays every remaining coin at once. One chime each
    // would be forty voices; a short rising run reads as "all of them".
    sweepChimes: 5,
    sweepChimeGap: 0.055
  },

  // ---- audio (TDD 19) ----
  // Synthesized at runtime, no assets. Every sound names one of the four
  // primitives in audio.js and supplies its numbers, so retuning the game's
  // whole mix is editing this block and nothing else.
  //
  // `cap` is the concurrent-voice limit for that sound. Over it, a trigger is
  // dropped rather than queued. The numbers are not decoration: at the 40-unit
  // ceiling a single volley can emit a dozen impacts in one frame, and forty
  // deaths can land in the same tick when a catapult connects.
  audio: {
    // MEASURED, not guessed: at 0.55 the busiest wave on level one peaked at
    // 0.40 of full scale with a mean RMS of 0.031. 0.70 puts the peak near 0.51
    // and leaves ~6dB for the worst case -- a catapult splash, a castle
    // collapsing and a victory sting arriving together. Nothing clips at the
    // 40-unit ceiling. Whether it is pleasant at this level is an ear judgement
    // and this is the one number to turn.
    master: 0.70,
    buses: { sfx: 1.0, ui: 0.8, ambient: 0.5 },
    defaultVoiceCap: 4,
    pitchVariance: 0.05,       // +/-5%, TDD 19
    gainVariance: 0.10,        // +/-10%

    ambient: {
      enabled: true,
      gain: 0.30,
      cutoff: 520,             // surf is low and wide, not a hiss
      swellRate: 0.09,         // Hz; one swell every ~11 seconds
      swellDepth: 0.45
    },

    sounds: {
      // ---- combat ----
      // Bowstring: a struck tone, short and woody. The ballista is the same
      // gesture an octave down and slower, which is the whole read.
      bow:          { kind: 'tone',  bus: 'sfx', freq: 330, to: 250, partials: 2,
                      detune: 11, duration: 0.13, gain: 0.16, cap: 5 },
      ballista:     { kind: 'tone',  bus: 'sfx', freq: 165, to: 110, partials: 3,
                      detune: 14, duration: 0.22, gain: 0.24, cap: 3 },
      // Enemy fire is the same bow, quieter and duller, so a wave of archers
      // does not out-shout the player's own towers.
      enemyBow:     { kind: 'tone',  bus: 'sfx', freq: 300, to: 230, partials: 2,
                      detune: 9, duration: 0.12, gain: 0.09, cap: 4 },

      arrowHit:     { kind: 'noise', bus: 'sfx', freq: 2800, sweepTo: 900,
                      duration: 0.09, gain: 0.20, cap: 6 },
      arrowMiss:    { kind: 'noise', bus: 'sfx', freq: 1500, sweepTo: 420,
                      duration: 0.11, gain: 0.11, cap: 4 },
      meleeHit:     { kind: 'noise', bus: 'sfx', freq: 1100, sweepTo: 260,
                      duration: 0.12, gain: 0.20, cap: 5 },
      spearThrust:  { kind: 'noise', bus: 'sfx', freq: 1800, sweepTo: 380,
                      duration: 0.14, gain: 0.22, cap: 3 },
      burningRock:  { kind: 'thump', bus: 'sfx', freq: 140, to: 55,
                      duration: 0.16, gain: 0.24, cap: 3 },
      splash:       { kind: 'thump', bus: 'sfx', freq: 110, to: 34,
                      duration: 0.30, gain: 0.42, cap: 2 },
      unitDied:     { kind: 'noise', bus: 'sfx', freq: 700, sweepTo: 180,
                      duration: 0.17, gain: 0.13, cap: 4 },
      // Heavily capped and quiet on purpose. Forty walkers at two footfalls a
      // second is 80 triggers a second; this is texture, not an event.
      footstep:     { kind: 'noise', bus: 'sfx', freq: 620, sweepTo: 200,
                      duration: 0.05, gain: 0.035, cap: 3 },

      // ---- structures ----
      structureHit: { kind: 'noise', bus: 'sfx', freq: 900, sweepTo: 220,
                      duration: 0.10, gain: 0.12, cap: 4 },
      structureDown:{ kind: 'thump', bus: 'sfx', freq: 95, to: 32,
                      duration: 0.42, gain: 0.55, cap: 2 },
      reflect:      { kind: 'blip',  bus: 'sfx', wave: 'square', freq: 900, to: 1500,
                      duration: 0.07, gain: 0.10, cap: 3 },
      towerBuilt:   { kind: 'blip',  bus: 'ui',  freq: 420, to: 720,
                      duration: 0.16, gain: 0.26, cap: 2 },
      towerUpgraded:{ kind: 'blip',  bus: 'ui',  freq: 520, to: 980,
                      duration: 0.22, gain: 0.30, cap: 2 },
      towerSold:    { kind: 'blip',  bus: 'ui',  freq: 620, to: 260,
                      duration: 0.18, gain: 0.24, cap: 2 },
      castlePlaced: { kind: 'thump', bus: 'ui',  freq: 120, to: 44,
                      duration: 0.45, gain: 0.55, cap: 1 },

      // ---- economy ----
      // Rising pitch reads as positive (TDD 19), and every coin uses it.
      coin:         { kind: 'blip',  bus: 'ui',  freq: 880, to: 1320,
                      duration: 0.09, gain: 0.16, cap: 4 },

      // ---- the wave loop ----
      boatLanded:   { kind: 'thump', bus: 'sfx', freq: 130, to: 48,
                      duration: 0.34, gain: 0.34, cap: 3 },
      waveStart:    { kind: 'tone',  bus: 'ui',  wave: 'sawtooth', freq: 150, to: 148,
                      partials: 3, detune: 16, duration: 0.85, gain: 0.30, cap: 1 },
      waveCleared:  { kind: 'blip',  bus: 'ui',  freq: 560, to: 1120,
                      duration: 0.34, gain: 0.28, cap: 1 },

      // ---- the king ----
      heroHit:      { kind: 'noise', bus: 'sfx', freq: 1300, sweepTo: 300,
                      duration: 0.13, gain: 0.24, cap: 3 },
      heroDied:     { kind: 'tone',  bus: 'ui',  wave: 'sawtooth', freq: 220, to: 90,
                      partials: 3, detune: 18, duration: 0.7, gain: 0.34, cap: 1 },
      heroRevived:  { kind: 'blip',  bus: 'ui',  freq: 330, to: 880,
                      duration: 0.4, gain: 0.28, cap: 1 },

      // ---- endings ----
      defeat:       { kind: 'tone',  bus: 'ui',  wave: 'sawtooth', freq: 165, to: 62,
                      partials: 3, detune: 22, duration: 1.5, gain: 0.40, cap: 1 },
      victory:      { kind: 'tone',  bus: 'ui',  wave: 'triangle', freq: 392, to: 588,
                      partials: 3, detune: 10, duration: 1.1, gain: 0.36, cap: 1 },

      // ---- UI ----
      tap:          { kind: 'blip',  bus: 'ui',  freq: 640, to: 760,
                      duration: 0.05, gain: 0.14, cap: 3 },
      denied:       { kind: 'blip',  bus: 'ui',  wave: 'square', freq: 260, to: 160,
                      duration: 0.11, gain: 0.14, cap: 2 }
    }
  },

  // ---- waves (TDD 11) ----
  waves: {
    approachSeconds: 10,       // boat spawn to landfall
    spawnRadius: 9,            // tiles from board centre; beyond the island
    minSpawnArc: 0.6,          // radians between two boats' spawn angles
    // Where the hull itself floats. Lower than it was, so the keel sits under
    // the waterline amidships and the boat reads as displacing water rather
    // than resting on top of it.
    hullY: 0.01,
    // How far short of the water's edge a hull grounds, beyond the last water
    // sample the approach ray found. Boats used to nose right up to the
    // shoreline; a hull with any draught touches bottom before that.
    groundingPullBack: 0.18,
    // Beaching. The bow rides up on the shelf, so the boat tilts a few degrees
    // stern-down and lifts slightly rather than staying dead level.
    grounding: {
      pitch: 5.5,              // degrees, bow up
      lift: 0.014,             // world units, so the stern does not dip under
      seconds: 0.4             // eased, because a hull does not snap to an angle
    },
    // Where a passenger's feet sit: the INTERIOR FLOOR of the boat model in
    // views.js, with its scale and hullY applied -- the same number the arrival
    // cutscene stands the king on. They stand down inside the hull now, so the
    // rim crosses them around the knee. Change the hull and both move together.
    deckHeight: 0.041,
    disembarkSeconds: 0.42,    // time for one passenger to jump onto the beach
    disembarkJumpHeight: 0.28,
    disembarkInterval: 0.25,   // launch cadence; arcs overlap without shortening
    passengerAdvanceSpeed: 0.75,
    // TDD 11: two boats may land on the same TILE, since tiles are large, but
    // not on the same point. In tiles, continuous -- not a grid distance.
    minLandingSeparation: 1.1,

    // One table per level, keyed by the id in levels.js. A wave is a list of
    // boats; a boat is a delay, a passenger list, and optionally the compass
    // point it comes from. `from` is what makes simultaneous landings on
    // opposite shores (TDD 11) authored rather than accidental -- two boats at
    // delay 0 from N and S is the difficulty curve of a single-hero game
    // written down, because the player cannot be in two places.
    //
    // `goldDropChance` is the per-wave economy dial of TDD 12: the probability
    // that a kill drops its coin at all. It is the primary pacing lever and
    // deliberately not a global constant, because later waves are much larger
    // and paying full rate on all of them would flood the purse exactly when
    // the tower tree has run out of things to sell.
    //
    // Sized against the 40-unit ceiling of TDD 10 rather than well under it. An
    // earlier table peaked at 13 and the king cleared every wave single-handed
    // with one tower on the map, which made the whole economy decorative.
    levels: {

      // ---- ONE: one plateau, two ramps. Learn the loop. -------------------
      // The level the economy targets of TDD 12 are tuned against, and the only
      // one where the player is still working out what gold is for -- so it
      // keeps the most generous drop rate of the three.
      //
      // MEASURED: at a 1.0 drop rate a level-one run banks about 700 gold, and
      // three archer towers clear every wave. That is roughly four times what
      // the level asks for, and it made the entire tower tree economically
      // pointless -- 40 gold for a fourth tower always beat 50 to upgrade a
      // third, because there is no shortage of tiles to put it on (TDD 3 is
      // explicit that gold is the constraint, never space). Cutting the rate is
      // what makes TDD 12's "exactly one T3 by the final wave" a decision
      // instead of an accident.
      one: [
        // 12 -- one boat, one idea: they come, you shoot them.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 18 -- two landings, so standing in one place stops being enough.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 24 -- twenty-two grunts, followed by two brutes at the end.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2.5, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 8, units: ['brute', 'brute'] }] },
        // 30 -- twenty-five grunts, followed by five brutes at the end.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2, units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 8, units: ['brute', 'brute', 'brute', 'brute', 'brute'] }] }
      ],

      // ---- TWO: Twin Capes. The capes are north and south. ----------------
      // Every wave from the second onward lands on both of them at once, which
      // is the only thing this level is about.
      //
      // MEASURED, and it is the opposite of the obvious: splitting a wave
      // across two shores makes it EASIER for a defence that does not move,
      // because half as much arrives at once. Level two first shipped with waves
      // barely larger than level one and was comfortably the easiest of the
      // three -- two towers cleared it, against three for level one. The split
      // only costs anything if the player has to be somewhere, so each half has
      // to be worth answering on its own; these waves are sized so that half of
      // one is about a whole level-one wave.
      two: [
        // 6 -- south only, to establish which shore is which.
        { goldDropChance: 0.55,
          boats: [{ delay: 0, from: 'S', units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 14 -- north and south at the same instant. The thesis, stated plainly.
        { goldDropChance: 0.55,
          boats: [{ delay: 0, from: 'N', units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 20 -- archers, plus a third landing on the open east shore where the
        // exposed house is.
        { goldDropChance: 0.5,
          boats: [{ delay: 0, from: 'N', units: ['grunt', 'grunt', 'grunt', 'grunt', 'archer', 'archer', 'grunt'] },
                  { delay: 0, from: 'S', units: ['archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3.5, from: 'E', units: ['grunt', 'grunt', 'archer', 'grunt', 'grunt', 'grunt'] }] },
        // 26 -- a brute on each cape. Both chokepoints have to hold at once.
        { goldDropChance: 0.5,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, from: 'W', units: ['archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 5.5, from: 'E', units: ['archer', 'grunt', 'grunt'] }] },
        // 32 -- four landings, all four compass points.
        { goldDropChance: 0.45,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2.5, from: 'W', units: ['archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 5, from: 'E', units: ['archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 36 -- near the ceiling, and still split across both capes.
        { goldDropChance: 0.45,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2.5, from: 'W', units: ['archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 4.5, from: 'E', units: ['brute', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] }] }
      ],

      // ---- THREE: The Crown. Four ramps, no chokepoint. -------------------
      // Landings come from every compass point from wave two, because the
      // terrain no longer funnels anything. Difficulty here is carried by
      // BRUTES rather than by raw count: the wave sizes are capped by the
      // 40-unit concurrency ceiling of TDD 10, and a brute is five grunts of
      // health that a chokepoint cannot answer. The drop rate is the lowest of
      // the three, so the four buildable tiles on the peak are a decision about
      // what the player then cannot afford.
      three: [
        // 8 -- one landing, but the climb is already four ways in.
        { goldDropChance: 0.5,
          boats: [{ delay: 0, from: 'S', units: ['grunt', 'grunt', 'grunt', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 16 -- opposite shores.
        { goldDropChance: 0.5,
          boats: [{ delay: 0, from: 'W', units: ['brute', 'grunt', 'grunt', 'grunt', 'archer', 'archer', 'grunt', 'grunt'] },
                  { delay: 0, from: 'E', units: ['brute', 'grunt', 'grunt', 'grunt', 'archer', 'archer', 'grunt', 'grunt'] }] },
        // 23 -- three ramps under pressure at once.
        { goldDropChance: 0.45,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, from: 'E', units: ['brute', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 29 -- all four.
        { goldDropChance: 0.45,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'E', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2.5, from: 'S', units: ['archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt'] },
                  { delay: 4.5, from: 'W', units: ['brute', 'archer', 'archer', 'archer', 'grunt', 'grunt'] }] },
        // 33 -- three brutes a side, spread so no single kill zone answers them.
        { goldDropChance: 0.4,
          boats: [{ delay: 0, from: 'NW', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'SE', units: ['brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2.5, from: 'NE', units: ['brute', 'archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt'] },
                  { delay: 5, from: 'SW', units: ['brute', 'archer', 'archer', 'archer', 'grunt', 'grunt'] }] },
        // 36 -- the last wave of the last level, at the ceiling.
        { goldDropChance: 0.4,
          boats: [{ delay: 0, from: 'N', units: ['brute', 'brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 0, from: 'S', units: ['brute', 'brute', 'brute', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2, from: 'W', units: ['brute', 'archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 4.5, from: 'E', units: ['brute', 'archer', 'archer', 'archer', 'archer', 'grunt', 'grunt', 'grunt', 'grunt'] }] }
      ]
    }
  },

  // ---- units ----
  unit: {
    // How close a unit has to get to its committed waypoint before it asks the
    // flow field again. Large enough that the arrival test cannot be skipped
    // over in one frame at any unit speed (the fastest moves ~0.017 tiles per
    // step), small enough that the unit still visibly walks tile to tile.
    waypointReached: 0.22,
    // TDD 8: the gap between these two is a feel decision, not a bug.
    // Defaults; each enemy type overrides them above. TDD 8: the gap between
    // the two radii is a feel decision, not a bug -- units pack tightly and are
    // still easy to hit.
    pushRadius: 0.18,        // unit-vs-unit separation only
    hitRadius: 0.40,         // incoming projectiles and melee
    arriveEpsilon: 0.10,     // how close counts as reaching a tile centre
    stairUpSpeed: 0.40       // fraction of normal speed while climbing stairs
  },

  // ---- procedural animation (TDD 15) ----
  // Amplitudes are in rig-local units, where a soldier stands ~0.62 tall before
  // the rig's own scale. Phase is advanced by distance travelled, never by
  // wall-clock time, so a slowed unit does not moon-walk.
  anim: {
    STRIDE: 0.42,            // tiles per half-cycle; sets cadence against speed
    LEG_SWING: 0.50,         // rad, peak, about the hip
    ARM_RATIO: 0.60,         // arm swing as a fraction of leg swing
    SPEAR_DAMP: 0.45,        // the weapon arm swings less, or the spear windmills
    BOUNCE: 0.020,           // vertical, at 2x stride frequency: one rise per footfall
    SWAY: 0.060,             // rad, roll into the planted leg
    YAW: 0.040,              // rad, torso counter-rotation against the arms
    TURN_RATE: 7.0,          // rad/s, damped approach so units bank into turns
    IDLE_RATE: 1.35,         // rad/s breathing clock, independent of the gait
    IDLE_SCALE: 0.15,        // TDD: idle is the same rig at ~15%
    DEATH_FALL: 0.35,
    DEATH_SINK_DELAY: 2,
    DEATH_SINK_DURATION: 2,
    DEATH_SINK_DEPTH: 0.7
  }
};
