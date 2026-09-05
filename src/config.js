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
  grade: { saturation: 1.02, contrast: 1.05, vignette: 0 },

  // ---- projectile impacts ----
  projectiles: {
    groundLifetime: 5,
    embedLifetime: 5,
    overtravelDistance: 0.14,
    missGravity: 4.8,
    submergedLifetime: 0.2,
    rippleLifetime: 0.8,

    // ---- release scatter ----
    // An arrow leaves the bow on a fixed line and never corrects, so the only
    // moment inaccuracy can enter is release. This is that moment's dial.
    //
    // ANGULAR, not absolute: the offset is a fraction of the flight distance.
    // Long shots scatter wide, point-blank ones barely at all, which is both
    // how bows behave and what keeps los.js honest -- the deviation is ZERO at
    // the muzzle and reaches its full value only at the target, so an arrow
    // never starts off-line and cannot clip the cliff its own tower stands
    // behind. That property is why the scatter is applied to the aim POINT and
    // not to the launch angle.
    //
    // Scale, against config.unit.hitRadius of 0.40: at a 6-tile shot, `spread`
    // 0.05 allows up to 0.30 tiles of lateral drift, and the distribution is
    // triangular, so most arrows land near the middle of that and the outliers
    // are what miss. Raise it and archers start looking incompetent; drop it to
    // 0 and you get the old behaviour, every shot a solved intercept.
    spread: 0.05,
    // Short-and-long drift, as a fraction of the lateral figure. Kept lower
    // because an arrow landing wide reads as a miss, while one landing short
    // mostly reads as the same shot arriving a moment early.
    spreadRangeFactor: 0.5
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
      cost: 15, hp: 100,
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
      cost: 10, hp: 150,
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

      // ---- the swing (TDD 10) ----
      // Damage no longer lands on the tick the cooldown expires. The blow is
      // wound up first and connects partway through, which is what lets the
      // animation carry weight: a hit that arrives before the arm has moved is
      // the reason instant melee reads as nothing happening.
      //
      // The cooldown still starts at the WINDUP, not at the landing, so the
      // rate of damage over time is unchanged -- only its phase moves, by one
      // windup, once, at the start of an engagement.
      attackWindup: 0.20,       // s, raise before the blow connects
      attackRecovery: 0.34,     // s, follow-through after it

      // Against BUILDINGS a grunt throws instead of swinging. Same cooldown,
      // same damage, same reach -- the range is deliberately NOT extended, since
      // letting grunts hit walls from further away would change how every
      // chokepoint on every level plays. This is presentation, not balance.
      molotov: {
        speed: 5.5,
        trajectory: 'arc'
      },
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
      pushRadius: 0.08,        //    tighter unit-to-unit clustering
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
      pushRadius: 0.08,
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

      // ---- the swing ----
      // It had none. Without an attackWindup the dispatch in enemies.js takes
      // the instant-damage branch, so the heaviest thing on the island hit for
      // 22 with its walk cycle still playing and never even fired the
      // `swingStart` sound. That is exactly backwards: the brute is the unit
      // whose whole read is weight.
      //
      // Nearly twice the grunt's windup, and it costs no DPS -- the cooldown
      // starts at the windup, not at the landing, so only the phase moves.
      // It does hand the player something real though: 0.38s in which a brute
      // that dies loses the blow, where before its damage could not be
      // prevented once the cooldown expired. Bursting one down mid-swing is
      // now a thing that works.
      //
      // 0.38 + 0.55 = 0.93 against a 1.5 interval, so it still comes to rest
      // for half a second between blows rather than windmilling.
      attackWindup: 0.38,
      attackRecovery: 0.55,

      // Heavier than the default in every axis: hauled further back, carried
      // further through, and the whole body goes in behind it. `raiseFrac` is
      // up too, so more of the longer windup is spent lifting -- a club is
      // heavy to raise, and the hang at the top is the telegraph the player
      // reads to decide whether to step in.
      swing: {
        raise: -1.25,
        contact: 1.05,
        follow: 1.75,
        twist: 0.42,
        raiseFrac: 0.52,
        lunge: 0.13,
        dip: 0.038
      },

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
    cliffAnticipation: 0.12,
    cliffAirTime: 0.32,
    cliffLanding: 0.18,
    cliffHopHeight: 0.16,
    cliffTakeoff: 0.38,       // tiles from the high tile centre; edge is at 0.5
    stairUpSpeed: 0.75,       // fraction of normal speed while climbing stairs
    walkAnimRate: 2,          // animation cadence only; does not alter movement speed
    towerHitboxHalfExtent: 0.28, // hero-only; arrow towers are fully pass-through
    houseHitboxHalfExtent: 0.31, // hero-only; visible house width is 0.62 tiles
    castleHitboxHalfExtent: 0.825, // hero-only; visible castle base is 1.65 tiles wide

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
    startGold: 50,             // two archer towers, with change; wave 1 is a real choice
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

  // ---- demolition (TDD 15) ----
  // Towers and barricades go out with a bang; houses leave a ruin and the castle
  // ends the level, so neither uses this. The shape deliberately mirrors
  // construction in reverse -- a building rises out of the ground shaking, with
  // dust at its feet, and it leaves the same way.
  demolition: {
    flash: 0.20,        // s, the blast. Yellow for the first 45%, red after.
    // World units. The red half expands to 1.35x this, so 0.75 puts the blast
    // at about two tiles across at its widest -- big for a one-tile tower
    // without swallowing the quarter of the island around it, which 1.35 did.
    ring: 0.75,
    sink: 0.55,         // s, from the blast to fully underground
    depth: 1.30,        // world units it drops
    shakeOffset: 0.05,  // world units of lateral judder while it goes down
    shakeRate: 46,      // Hz
    shakeTilt: 0.10,    // rad
    dustPuffs: 12
  },

  // ---- damage as fire (TDD 15) ----
  // Buildings report their health by burning instead of by wearing a gauge.
  // Ember count scales with damage taken, so a glance across the island says
  // which side of it is losing without reading a single number.
  flames: {
    max: 8,        // embers on a building at the point of collapse
    rate: 0.95,    // rise cycles per second, per ember, before its own jitter
    rise: 0.62,    // world units travelled over one cycle
    size: 0.20     // world units, the square at full size
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
    // Radians per second of the roll phase: 3.4 is about one full side-to-side
    // cycle every 1.9s -- a deliberate rock, not the tremble 8.5 produced.
    boatSwayRate: 3.4,
    bubbleInterval: 0.18,
    bubbleLifetime: 0.9,
    // Boat wakes: one instanced wave ring per hull, each breathing at its own
    // clock, so a landing party reads as water churning, not white stickers.
    wakePulseRate: 1.6,        // swell-and-relax cycles per second
    wakePulseDepth: 0.085,     // ring breathing, as a fraction of its footprint
    wakeBob: 0.003             // world units the ring rides each swell
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
    // Intensities track the daylight rig in renderer.js one for one. The evening
    // is a HUE shift, not a dimmer: the moment the two ends stop summing to the
    // same exposure, dusk stops reading as warm light and starts reading as a
    // scene that has simply gone dark.
    sun:     { color: 0xffa869, intensity: 0.52 },   // day: 0xfff6e4 @ 0.56
    rim:     { color: 0x8fa6d6, intensity: 0.20 },   // day: 0xbcdcef @ 0.20
    hemi:    { sky: 0xffc9a4, ground: 0xd8c3a2, intensity: 0.50 },  // day: 0xf2fbff / 0xdfe6d2 @ 0.50
    ambient: { color: 0xffdcc2, intensity: 0.30 },   // day: 0xfffdf8 @ 0.30
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
      top: 0x8b90c4,           // day: 0x93c9e7, the top of the frame
      bottom: 0xd6a184,        // day: 0x4f9ed2, toward the viewer
      pool: 0xb393a8           // day: 0x69b2da, the light pool around the island
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
      // A bottle leaving a hand: a short rising hiss, not the bowstring the
      // generic `shot` event would otherwise have given it.
      molotov:      { kind: 'noise', bus: 'sfx', freq: 240, sweepTo: 880,
                      duration: 0.22, gain: 0.13, cap: 3 },
      // The grunt's blade starting its arc. Quiet and low -- it is the tell that
      // a blow is coming, so it must not compete with the blow landing.
      swing:        { kind: 'noise', bus: 'sfx', freq: 520, sweepTo: 170,
                      duration: 0.11, gain: 0.055, cap: 4 },
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
    // ---- beaching damage ----
    // A hull grounding on a tile someone built on wrecks what is there. Scaled
    // AND flat, so it hurts a cheap wall and a expensive one in different ways:
    // the percentage keeps it relevant against high-HP upgrades, and the flat
    // part means a fresh Archer Tower does not shrug off being rammed.
    //
    // 55 is a little over half an Archer Tower's 100 HP, so one landing takes a
    // fresh one to 30 (15 + 55 = 70 damage) and a second finishes it. Against a
    // 150 HP barricade it is 77, about half. Against the castle, 118 of 420.
    //
    // HOUSES ARE EXEMPT. They are not the player's fortifications, they are the
    // thing being defended, and the loss condition already counts them -- a boat
    // deleting one on touchdown would take that decision away from the player
    // before they could answer it.
    beachDamageFraction: 0.15,
    beachDamageFlat: 55,

    // How far a disembarking raider may be placed from its boat's landing tile.
    // Beyond about this it stops reading as stepping ashore and starts reading
    // as teleporting -- which is exactly what it used to do when the beach was
    // walled off: it hunted outward over the whole board for a free tile.
    disembarkReach: 0.6,
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
        // 8 -- two boats of four grunts.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 2, units: ['grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 12 -- three boats of four grunts.
        { goldDropChance: 0.6,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 1.5, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, units: ['grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 16 -- four boats of four grunts.
        { goldDropChance: 0.55,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 1.5, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 4.5, units: ['grunt', 'grunt', 'grunt', 'grunt'] }] },
        // 20 -- five boats of four grunts.
        { goldDropChance: 0.5,
          boats: [{ delay: 0, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 1.5, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 3, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 4.5, units: ['grunt', 'grunt', 'grunt', 'grunt'] },
                  { delay: 6, units: ['grunt', 'grunt', 'grunt', 'grunt'] }] }
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
    // still easy to hit.      pushRadius: 0.08,        // unit-vs-unit separation only
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

    // Enemy legs cycle three times faster than the distance they cover would
    // imply. Presentation only: it does not move them any quicker, and the hero
    // has his own equivalent in hero.walkAnimRate. It makes a wave read as
    // scrambling up the beach rather than marching.
    //
    // Footfall events are derived from gait phase, so this trebles them too:
    // a grunt goes from 2.4 to 7.1 footfalls a second, and forty ashore from
    // roughly 95 to 285 triggers a second. That is deliberate -- the sound has
    // to land on the foot you can see -- and it is already absorbed: the
    // footstep voice is capped at 3 with a 0.05s duration, so no more than
    // about sixty a second can ever be sounding and the rest are dropped
    // quietly by claim(). It was designed as texture rather than as an event,
    // for exactly this reason. Nothing clips; the texture simply saturates.
    ENEMY_CADENCE: 3,

    // Render-only lift, in world units, applied to every enemy root. They sit
    // slightly proud of the ground rather than bedded into it, which reads
    // better against a contact blob that stays put on the floor. The blob does
    // NOT move with this -- a shadow under a lifted figure is the point.
    ENEMY_LIFT: 0.02,
    SPEAR_DAMP: 0.45,        // the weapon arm swings less, or the spear windmills

    // ---- gait profiles ----
    // Two, because the king and the raiders are doing different things and one
    // of them has no knees. The animator takes a profile rather than reading
    // these directly, so neither can drift into the other by accident.
    //
    // `stride` is the king: unchanged, and deliberately so. He is a knee-less
    // rig, and the exaggerated leg swing below would only scissor a straight
    // leg further -- which is precisely the mannequin-sliding look the raiders'
    // knees exist to break.
    stride: {
      LEG_SWING: 0.50,       // rad, peak, about the hip
      KNEE_FLEX: 0,          // no knee joints on this rig
      ARM_RATIO: 0.60,       // arm swing as a fraction of leg swing
      BOUNCE: 0.020,         // vertical, at 2x stride frequency: one per footfall
      LEAN: 0,               // he strides; he does not charge
      SWAY: 0.060,           // rad, roll into the planted leg
      YAW: 0.040             // rad, torso counter-rotation against the arms
    },

    // `run` is the raiders. A RUN, not a walk, and deliberately past what a real
    // body does: they are read at twenty-odd pixels from a high angle, where a
    // truthful gait is indistinguishable from standing still and sliding. The
    // exaggeration is what makes a wave look like it is charging.
    run: {
      LEG_SWING: 0.72,
      KNEE_FLEX: 0.75,       // rad of extra bend at the top of the recovery swing
      ARM_RATIO: 0.75,
      BOUNCE: 0.055,         // peak-to-peak vertical, centred: see applyGait
      LEAN: 0.16,            // rad, torso pitched into the run at reference speed
      SWAY: 0.085,
      YAW: 0.055,
      // Planted-foot polish (applyGait). A sine hip swing moves fastest
      // through the vertical, where a planted foot should be slowest; PLANT_HOLD
      // blends the swing toward a squared curve so the leg holds near contact
      // and snaps mid-stride. PLANT_DIP settles the body onto the support leg
      // at the passing moment, shaving the bounce's peak.
      PLANT_HOLD: 0.45,      // 0 = original sine, 1 = fully squared swing
      PLANT_DIP: 0.012       // world units of extra settle at the passing moment
    },

    // ---- the melee swing ----
    // The DEFAULT profile. An enemy spec may carry a partial `swing` block that
    // overrides any of these, the same way a gait takes a profile rather than
    // reading globals -- so a club and a sword can differ without either one
    // drifting into the other by accident.
    //
    // SIGNS MATTER, and they were once backwards. The weapon hangs entirely
    // ABOVE the shoulder pivot, so a POSITIVE rotation about x carries it
    // FORWARD and a negative one draws it back. `raise` must therefore be
    // negative -- blade back over the shoulder -- and `contact` positive.
    // See units.js: with these inverted the unit shoves the butt of its sword
    // at the wall.
    swing: {
      raise: -1.05,          // rad, weapon drawn back over the shoulder
      contact: 1.00,         // rad, where it is when the blow LANDS
      follow: 1.55,          // rad, where the follow-through carries it
      twist: 0.30,           // rad, torso counter-twist during the windup
      twistAfter: -0.22,     // rad, torso twist from contact onward
      raiseFrac: 0.45,       // of the windup spent drawing back
      followFrac: 0.28,      // of the recovery spent completing the arc
      lunge: 0.07,           // tiles, forward shove from the moment of contact
      dip: 0.022,             // world units the body drops through the blow
      impact: 0.08,           // rad torso compression on the contact beat
      impactDip: 0.018,       // world units of extra body drop on contact
      impactDuration: 0.12    // seconds for the contact accent
    },

    TURN_RATE: 7.0,          // rad/s, damped approach so units bank into turns
    IDLE_RATE: 1.35,         // rad/s breathing clock, independent of the gait
    IDLE_SCALE: 0.15,        // TDD: idle is the same rig at ~15%

    // ---- death: the launch, then the sink ----
    // A kill launches the body up and back along the line of the blow: the
    // figure snaps into a curled, slightly fetal pose on impact and rides a
    // constant-speed backward arc, never rotating or tumbling. DEATH_SINK_*
    // then pin the corpse in place and let it drain into the ground; world.js
    // sums the delay and duration for how long the corpse record is kept.
    DEATH_FLY: 0.6,           // s the corpse is airborne after the blow
    DEATH_FLY_HEIGHT: 0.45,   // world units at the apex, ~one grunt body height
    DEATH_FLY_BACK: 0.3,      // tiles the corpse is knocked back from the blow
    DEATH_FLY_SNAP: 0.12,     // fraction of the flight spent snapping into pose
    DEATH_FLY_HUNCH: 1.15,    // rad the torso folds forward over the knees
    DEATH_FLY_HIP: 0.5,       // rad the thighs tuck up toward the chest
    DEATH_FLY_TUCK: 0.6,      // rad of extra knee bend folded into the curl
    DEATH_FLY_ARM: 0.3,       // rad the weapon is drawn in over the chest
    DEATH_SINK_DELAY: 2,
    DEATH_SINK_DURATION: 2,
    DEATH_SINK_DEPTH: 0.7
  }
};
