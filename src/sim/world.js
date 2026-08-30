// Hero TD -- the central state object.
//
// TDD section 17: systems talk through this rather than holding references to
// each other, and the renderer reads it but never writes to it. Nothing in this
// file touches three.js, the DOM, or audio -- it records that things happened
// into `events` and lets the presentation layer decide what to do about them.
//
// The world is built around ONE board and does not outlive it. P5 added a
// second and third level, and rather than teaching every system to forget its
// board, a level change tears the world down and builds another (see main.js).
// Levels change a handful of times per session and the whole construction costs
// a few milliseconds, so the alternative -- a reset path through nine systems,
// exercised twice a session and wrong in some corner of one of them -- would be
// paying real risk for nothing.

import { config } from '../config.js';

import { createFlow } from './flow.js';
import { createStructures } from './structures.js';
import { createCombat, stepTowers } from './combat.js';
import { createWaves } from './waves.js';
import { createHero } from './hero.js';
import { createEnemies } from './enemies.js';
import { createSeparation } from './separation.js';
import { createCoins } from './coins.js';
import { createIntro } from './intro.js';

// CASTLE is the opening beat of every level: before any tower may be bought, the
// king must site his castle (TDD 4). It is free and mandatory, so this is not a
// phase the player can skip or spend their way out of.
// INTRO is the arrival cutscene and exists only on a level that authors one
// (see sim/intro.js). Everywhere else the game still opens on CASTLE.
export const PHASE = { INTRO: 'INTRO', CASTLE: 'CASTLE', BUILD: 'BUILD', WAVE: 'WAVE', LOST: 'LOST', WON: 'WON' };

export function createWorld(board) {
  const waveTable = config.waves.levels[board.level.id];
  if (!waveTable) {
    throw new Error(`no wave table in config.waves.levels for level "${board.level.id}"`);
  }

  const world = {
    board,
    phase: PHASE.CASTLE,
    paused: false,
    time: 0,
    waveIndex: 0,
    // The wave table belongs to the level, not to the game (TDD 11). Levels 2
    // and 3 escalate through simultaneous landings on opposite shores, which is
    // a property of where their shores are.
    waveTable,
    waveCount: waveTable.length,
    gold: config.economy.startGold,
    units: [],
    events: [],
    nextId: 1
  };

  // ---- systems ----
  const isBlocked = (i, j) => {
    const s = structures.at(i, j);
    return s && s.alive ? s : null;
  };
  const isHeroBlocked = (i, j) => {
    const s = structures.at(i, j);
    return s && s.alive && !(s.kind === 'tower' && (s.type === 'archer' || s.type === 'barricade')) ? s : null;
  };

  // Ground rules for everything that walks.
  const flowGround = createFlow(board, isBlocked, board.canStep);

  // The hero's rules add exactly one edge: he may drop to a strictly lower tile
  // at any cliff, never climb one (TDD 3).
  const flowHero = createFlow(board, isHeroBlocked, (ai, aj, bi, bj) => {
    if (board.canStep(ai, aj, bi, bj)) return true;
    if (!board.isLand(ai, aj) || !board.isLand(bi, bj)) return false;
    if (Math.abs(ai - bi) + Math.abs(aj - bj) !== 1) return false;
    return board.at(bi, bj) < board.at(ai, aj);
  });

  const structures = createStructures(board, flowGround);
  const combat = createCombat(world);
  const waves = createWaves(world);
  const heroControl = createHero(world, flowHero);
  const enemies = createEnemies(world, flowGround, combat);
  const separation = createSeparation(board, structures);
  const coins = createCoins(world);
  const intro = createIntro(world, board, heroControl);

  world.intro = intro;
  world.structures = structures;
  world.combat = combat;
  world.waves = waves;
  world.hero = heroControl.hero;
  world.flowGround = flowGround;
  world.flowHero = flowHero;
  world.separation = separation;
  world.coins = coins;

  for (const [i, j] of board.level.houses) {
    if (board.isLand(i, j)) structures.house(i, j);
  }

  // ---- enemies ----
  // Spawning, targeting and per-unit behaviour live in enemies.js. What stays
  // here is only what the rest of the world needs to reach: damage resolution,
  // which has to notify everything that was pointing at the casualty.

  function damageUnit(target, amount, source) {
    if (target.isHero) { heroControl.damage(amount); return; }
    if (!target.alive) return;
    target.hp -= amount;
    // Structures had `structureHit` from P1 and units had nothing but death, so
    // an enemy soaking four arrows looked identical to one standing still. The
    // source travels with it: a hit reaction wants to know which way to recoil.
    world.events.push({ type: 'unitHit', unit: target, amount, source });
    // TDD 10 priority 1: being hurt by a building or the king provokes
    // retaliation, if the attacker is close enough to have been noticed.
    if (source) enemies.provoke(target, source);
    if (target.hp > 0) return;
    target.alive = false;
    target.hp = 0;
    target.deathAge = 0;
    target.moving = false;
    // TDD 12: kill gold drops as a coin the king walks over, rather than landing
    // in the purse. What that buys is a reason to move during a lull -- and it
    // is never a requirement, because the wave-clear sweep collects the rest.
    //
    // Whether it drops at all is the per-wave dial of TDD 12, authored in
    // config.waves.levels. It is the primary pacing lever precisely because it
    // is per wave: the alternative is retuning every enemy's gold value, which
    // changes the relative worth of a brute and a grunt as a side effect of
    // wanting wave 5 to pay a little less.
    if (Math.random() < world.dropChance()) {
      coins.drop(target.x, target.z, config.enemies[target.type].gold);
    }
    world.events.push({ type: 'unitDied', unit: target });
  }

  function damageStructure(s, amount, source) {
    if (!s.alive) return;
    // TDD 6: spikes reflect damage to any enemy attacking in melee. Only melee
    // -- an archer shooting the wall from four tiles away is not impaled by it.
    const spec = s.kind === 'tower' ? config.towers[s.type] : null;
    if (spec && spec.reflect && source && !source.isStructure && !source.isHero) {
      const spearRange = config.enemies[source.type];
      if (spearRange && !spearRange.ranged) {
        damageUnit(source, spec.reflect, s);
        world.events.push({ type: 'reflect', structure: s, unit: source });
      }
    }
    s.hp -= amount;
    world.events.push({ type: 'structureHit', structure: s });
    if (s.hp > 0) return;
    structures.destroy(s);
    world.events.push({ type: 'structureDestroyed', structure: s });
    // Every enemy that was committed to it now needs somewhere else to go --
    // except the ones still aboard a boat. Path-distance targeting from a sea
    // tile is meaningless, and an archer aboard re-acquires opportunistically on
    // its next step anyway.
    for (const u of world.units) {
      if (!u.alive || u.target !== s) continue;
      if (u.state === 'boat') u.target = null;
      else enemies.retarget(u);
    }
  }

  // ---- phases ----
  function beginBuild() {
    world.phase = PHASE.BUILD;
    waves.stop();
    combat.clear();
    world.units.length = 0;
    // TDD 2: all towers repaired free including destroyed ones, at full tier.
    // Houses rebuilt. Hero to full HP, revive counter reset.
    structures.repairAll();
    heroControl.resetForWave();
    // TDD 12: house income pays at the START of the build phase, for houses that
    // survived. Because repairAll has already run, income is read from the count
    // recorded when the wave ended.
    world.gold += world.survivingHouses * config.economy.houseIncome;
    world.refreshPreview();
    world.events.push({ type: 'buildPhase' });
  }

  world.survivingHouses = board.level.houses.length;

  // The wave currently being fought, or the one about to be. Clamped, because
  // the WON phase leaves waveIndex one past the end of the table.
  world.currentWave = () => waveTable[Math.min(world.waveIndex, waveTable.length - 1)];

  // Roll the next wave's landings now, so the build phase can show them and the
  // wave itself uses exactly what was shown. Called on every route INTO a build
  // or castle phase; there are four of them and missing one leaves the player
  // looking at the previous wave's arrows.
  world.refreshPreview = function () {
    world.wavePreview = world.waveIndex < waveTable.length
      ? waves.preview(world.currentWave())
      : [];
    return world.wavePreview;
  };
  world.dropChance = () => {
    const chance = world.currentWave().goldDropChance;
    return chance === undefined ? 1 : chance;
  };

  // TDD 4: free, mandatory, and placed before anything else. The validator lives
  // in structures.js because the rule is about occupancy, not about phases.
  world.placeCastle = function (i, j) {
    if (world.phase !== PHASE.CASTLE) return false;
    if (!structures.canPlaceCastle(i, j)) return false;
    const keep = structures.castle(i, j);
    // Stand the king at the gate. Without this he spawns on his own castle's
    // floor, invisible inside two metres of stone.
    //
    // "Nearest the island's centre" rather than "first found": the raiders come
    // from the water, so the centre-facing side is the side he should be
    // watching from, and it is the side least likely to be hidden behind his own
    // keep. It cannot fix every camera angle -- only the occlusion rule in
    // section 15 can do that, and it is not built yet.
    const span = keep.span;
    const middle = (board.N - 1) / 2;
    let home = null, bestScore = Infinity;
    for (let dj = -1; dj <= span; dj++) {
      for (let di = -1; di <= span; di++) {
        const ci = i + di, cj = j + dj;
        if (ci >= i && ci < i + span && cj >= j && cj < j + span) continue;
        if (!board.isLand(ci, cj) || structures.at(ci, cj)) continue;
        // Prefer orthogonal neighbours over diagonal corners, then centre-ward.
        const diagonal = (di < 0 || di >= span) && (dj < 0 || dj >= span) ? 1 : 0;
        const score = diagonal * 10 + Math.hypot(ci - middle, cj - middle);
        if (score < bestScore) { bestScore = score; home = [ci, cj]; }
      }
    }
    const onCastleSpot = world.hero.x >= i && world.hero.x < i + span &&
      world.hero.z >= j && world.hero.z < j + span;
    if (onCastleSpot && home) heroControl.setHome(home[0], home[1]);
    world.phase = PHASE.BUILD;
    world.refreshPreview();
    takeSnapshot();
    world.events.push({ type: 'castlePlaced', i, j });
    return true;
  };

  world.ready = function () {
    if (world.phase !== PHASE.BUILD) return;
    // TDD 7: pressing READY snaps pending builds to complete. The 1.5s timer is
    // feel only, because the build phase is untimed.
    for (const t of structures.towers()) t.building = 0;
    world.phase = PHASE.WAVE;
    waves.start(world.currentWave());
    world.events.push({ type: 'waveStart', wave: world.waveIndex });
  };

  world.build = function (type, i, j) {
    if (world.phase !== PHASE.BUILD) return false;
    const spec = config.towers[type];
    // Only tier-1 entries are buyable from the build bar; everything else is
    // reached by upgrading something already standing.
    if (!spec || spec.tier !== 1) return false;
    if (world.gold < spec.cost) return false;
    if (!structures.canPlace(i, j)) return false;
    world.gold -= spec.cost;
    const built = structures.tower(type, i, j);
    world.events.push({ type: 'towerBuilt', structure: built, i, j });
    return true;
  };

  // TDD 7: build and upgrade only during the build phase, and zero tower
  // interaction during combat -- no repair, no upgrade, no sell.
  world.upgrade = function (record, toType) {
    if (world.phase !== PHASE.BUILD) return false;
    if (!record || record.kind !== 'tower' || !record.alive) return false;
    const spec = config.towers[toType];
    if (!spec || world.gold < spec.cost) return false;
    if (!structures.upgrade(record, toType)) return false;
    world.gold -= spec.cost;
    world.events.push({ type: 'towerUpgraded', structure: record, to: toType });
    return true;
  };

  // TDD 7: takedown refunds 50% of TOTAL INVESTED, not of base cost. A player
  // who has poured three upgrades into a tower gets half of all of it back,
  // which is what stops a misplaced T3 from being an unrecoverable mistake.
  world.sell = function (record) {
    if (world.phase !== PHASE.BUILD) return 0;
    if (!record || record.kind !== 'tower') return 0;
    const refund = structures.sell(record);
    world.gold += refund;
    world.events.push({ type: 'towerSold', refund });
    return refund;
  };

  // What the upgrade panel offers for a given tower: the next tier, with costs
  // and whether the purse currently covers them.
  world.upgradeOptions = function (record) {
    if (!record || record.kind !== 'tower') return [];
    const spec = config.towers[record.type];
    return (spec.upgradesTo || []).map(type => {
      const next = config.towers[type];
      return {
        type, name: next.name, cost: next.cost,
        shape: next.shape,
        affordable: world.gold >= next.cost
      };
    });
  };

  world.refundFor = record =>
    (record && record.kind === 'tower') ? Math.floor(record.invested * 0.5) : 0;

  // TDD 13: restart-wave is what makes a prototype finishable. It resumes from
  // the start of the wave with the layout and gold held on entering it.
  let snapshot = null;
  function takeSnapshot() {
    const keep = structures.theCastle();
    snapshot = {
      gold: world.gold,
      waveIndex: world.waveIndex,
      castle: keep ? { i: keep.i, j: keep.j } : null,
      // maxHp travels with the record because an upgraded barricade's ceiling is
      // derived from its parent, not from its own config entry.
      towers: structures.towers().map(t =>
        ({ type: t.type, i: t.i, j: t.j, invested: t.invested, maxHp: t.maxHp }))
    };
  }

  world.restartWave = function () {
    if (!snapshot) return;
    coins.clear();
    // The castle is never rebuilt in play (TDD 4), but restarting a wave rewinds
    // to before it fell, so it is re-sited exactly where the player put it.
    const keep = structures.theCastle();
    if (keep && !keep.alive && snapshot.castle) {
      structures.sell(keep);
      structures.castle(snapshot.castle.i, snapshot.castle.j);
    }
    // Every tower, alive or destroyed -- the wave is being rewound, so the
    // layout is rebuilt from the snapshot rather than repaired.
    for (const s of structures.list.slice()) if (s.kind === 'tower') structures.sell(s);
    for (const t of snapshot.towers) {
      const built = structures.tower(t.type, t.i, t.j, t.maxHp);
      built.invested = t.invested;
    }
    world.gold = snapshot.gold;
    world.waveIndex = snapshot.waveIndex;
    world.survivingHouses = board.level.houses.length;
    beginBuild();
  };

  world.restartLevel = function () {
    coins.clear();
    for (const s of structures.list.slice()) {
      if (s.kind === 'tower' || s.kind === 'castle') structures.sell(s);
    }
    world.gold = config.economy.startGold;
    world.waveIndex = 0;
    // No previous wave, so no house survived one: a restarted level must open on
    // exactly the purse a fresh one does. Without this, beginBuild pays income
    // for a wave that never happened and restarting quietly hands out 40 gold.
    world.survivingHouses = 0;
    snapshot = null;
    beginBuild();
    world.survivingHouses = board.level.houses.length;
    // Back to the opening beat: the castle has to be sited again before building.
    world.phase = PHASE.CASTLE;
    // ...and on a level that opens with the arrival, back to that.
    if (intro.available()) { world.phase = PHASE.INTRO; intro.begin(); }
  };

  // ---- the step ----
  world.step = function (dt) {
    world.time += dt;

    // The cutscene owns the hero completely while it runs -- it writes his
    // position directly during the sail, then hands him to the cliff jump for
    // the leap ashore. Nothing else steps.
    if (world.phase === PHASE.INTRO) {
      intro.step(dt, combat);
      if (intro.done) {
        world.phase = PHASE.CASTLE;
        world.events.push({ type: 'introFinished' });
      }
      return;
    }

    // CASTLE runs on the build rules rather than freezing everything. Siting is
    // ARMED, not automatic (TDD 4): until the castle button is pressed a tap
    // means move the king, so the opening beat is walking the island and reading
    // it -- which is the decision the siting is about. Towers and coins cannot
    // exist yet during CASTLE, so the rest of this branch is genuinely nothing.
    if (world.phase === PHASE.BUILD || world.phase === PHASE.CASTLE) {
      for (const t of structures.towers()) {
        if (t.building > 0) t.building = Math.max(0, t.building - dt);
      }
      heroControl.step(dt, combat);
      separation.resolveHero(world.hero);
      // The end-of-wave sweep is already paid; this only flies the coins home so
      // the player sees it happen.
      coins.step(dt);
      return;
    }
    if (world.phase !== PHASE.WAVE) return;

    // One authoritative previous transform per fixed step. Boat motion and
    // disembark arcs happen before enemy AI, so snapshotting inside enemies.step
    // erased those movements and left the renderer nothing to interpolate.
    for (const u of world.units) {
      u.px = u.x; u.pz = u.z; u.py = u.y;
      u.pFacing = u.facing; u.pGait = u.gaitPhase;
    }
    waves.step(dt);
    for (const u of world.units) enemies.step(u, dt);

    // TIER FIRST, then separation, then height. The order is load-bearing and
    // the middle step is why.
    //
    // Separation's legality test is tier-aware (a cliff face is ground, so
    // "is there land here" was letting units walk bodily into hillsides). That
    // makes it depend on a tier that is CURRENT: walkElevation is the thing that
    // notices a unit stepping off the top of a ramp, and if separation ran first
    // it would test the tile at the top of the stairs against the tier at the
    // bottom, reject it, and pin the unit to the ramp forever. The hero hit
    // exactly this bug when his clamp was ordered the other way round.
    for (const u of world.units) {
      if (!u.alive || u.state === 'boat') continue;
      // Remembered tier, not sampled ground -- see board.walkElevation.
      const e = board.walkElevation(u.x, u.z, u.tier, u.onRamp);
      u.tier = e.tier; u.onRamp = e.onRamp;
    }

    // TDD 8: separation runs after everything has moved and before anything
    // reads a position. Movement decides where a unit wants to be; this decides
    // where it may actually stand.
    separation.resolve(world.units);

    // Height last, because separation may have moved them since the pass above.
    for (const u of world.units) {
      if (!u.alive || u.state === 'boat') continue;
      const e = board.walkElevation(u.x, u.z, u.tier, u.onRamp);
      u.tier = e.tier; u.onRamp = e.onRamp;
      u.y = e.y - config.board.SINK;
    }

    stepTowers(world, combat, dt);
    heroControl.step(dt, combat);
    separation.resolveHero(world.hero);
    enemies.stepHeroAttacks(dt, heroControl);
    combat.step(dt);
    coins.step(dt);

    // Corpses are already non-targetable and non-colliding. Keep their records
    // just long enough for the knockdown, pause, and sink presentation.
    const corpseLifetime = config.anim.DEATH_SINK_DELAY + config.anim.DEATH_SINK_DURATION;
    for (let k = world.units.length - 1; k >= 0; k--) {
      const u = world.units[k];
      if (u.alive) continue;
      u.deathAge += dt;
      if (u.deathAge >= corpseLifetime) world.units.splice(k, 1);
    }

    // TDD 4 and 13: the wave is lost the instant the castle falls, regardless of
    // the hero, the towers or the houses. Losing everything else is survivable.
    if (structures.castleFallen()) {
      world.phase = PHASE.LOST;
      world.events.push({ type: 'lost' });
      return;
    }

    if (waves.complete()) {
      // TDD 12: on a cleared wave, everything still on the ground flies to him.
      coins.sweep();
      world.survivingHouses = structures.houses().length;
      world.waveIndex++;
      if (world.waveIndex >= world.waveCount) {
        world.phase = PHASE.WON;
        world.events.push({ type: 'won' });
        return;
      }
      takeSnapshot();
      beginBuild();
    }
  };

  // The opening castle phase is a build phase in every way that matters here:
  // the player is deciding where things go, so they get to see what is coming.
  world.wavePreview = [];
  world.refreshPreview();

  // A level that authors an intro opens on it; every other level opens on
  // castle siting, exactly as before.
  if (intro.available()) {
    world.phase = PHASE.INTRO;
    intro.begin();
  }

  world.spawnEnemy = enemies.spawn;
  world.retarget = enemies.retarget;
  world.enemies = enemies;
  world.damageUnit = damageUnit;
  world.damageStructure = damageStructure;
  world.moveHero = heroControl.moveTo;

  takeSnapshot();
  return world;
}
