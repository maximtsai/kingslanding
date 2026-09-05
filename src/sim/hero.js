// Hero TD -- the king.
//
// TDD section 13. Tap the ground to move; he paths there and stops. Attack is
// fully automatic. That is the entire input surface -- no aim, no attack button,
// no target selection, and (settled in TDD 13) no abilities.
//
// Two rules do most of the design work here:
//
//   1. He can drop off any cliff, downward only. Enemies cannot. This is his
//      mobility advantage and the reason he reads as a king rather than a mobile
//      archer tower. It lives in the flow field he paths with, not here.
//
//   2. Enemies never pursue him (see world.retarget). He can wade into a cluster,
//      shoot, and walk out without dragging the wave behind him -- and equally,
//      he cannot tank for his towers by kiting, which keeps towers the primary
//      defence and him the response force.

import { config } from '../config.js';
import { lerpAngle } from './angles.js';
import { targetHeight } from './los.js';

export function createHero(world, flowHero) {
  const board = world.board;
  const H = config.hero;
  const [si, sj] = board.level.heroSpawn;

  // Where he starts a level and returns to after a death. Reassigned to the
  // castle's doorstep the moment one is sited (TDD 4 calls it his defensible
  // home) -- the authored tile is only the fallback for before that happens.
  const home = [si, sj];

  const hero = {
    x: si, z: sj,
    y: board.topY(si, sj) - config.board.SINK,
    px: si, pz: sj, py: board.topY(si, sj) - config.board.SINK,
    // The tier he believes he is standing on. This is the whole point: his
    // height comes from here, not from sampling the ground beneath him, so
    // standing on the corner of a plateau cannot drop him to the tile below.
    // It changes on a ramp and on a cliff landing, and nowhere else.
    tier: board.at(si, sj) || 1,
    onRamp: false,
    // Last position known to be on his own tier. The clamp below falls back to
    // it, exactly as separation does for units.
    safeX: si, safeZ: sj,
    facing: 0, pFacing: 0,
    gaitPhase: 0, pGait: 0,
    speed: H.speed,
    hp: H.hp, maxHp: H.hp,
    // Damage, projectiles and aggro address the hero exactly like a unit, so he
    // needs the same shape. Nothing checks `isHero` except the parts that must.
    isHero: true,
    id: 'hero',
    losId: 'hero',
    alive: true,
    reviveIn: 0,
    deathsThisWave: 0,
    cooldown: 0,
    target: null,
    attackTime: -1,
    attackTarget: null,
    attackReleased: false,
    attackAim: 0,
    field: null,
    goal: null,              // exact tapped point, so he stops where you tapped
    waypoint: null,          // held to its centre so rounding cannot turn him early
    pathDx: 0, pathDz: 0,
    cliffJump: null,
    jumpPhase: null,
    jumpT: 0,
    landingSerial: 0
  };

  function cancelAttack() {
    hero.attackTime = -1;
    hero.attackTarget = null;
    hero.attackReleased = false;
  }

  // TDD 13: tapping again replaces the current destination. A cliff jump still
  // runs to completion, but its landing point is used as the origin so a new
  // order can be validated and ready when the animation unlocks.
  // Structures he may not walk onto. Arrow towers and barricades are
  // deliberately pass-through for the king alone (see towerHitboxHalfExtent).
  //
  // Must agree with isHeroBlocked in world.js: that one decides where a path may
  // run, this one decides whether a destination is legal, and a disagreement
  // between them shows up as a tile he will accept an order for but cannot
  // actually route to.
  function blockedForHero(i, j, x = i, z = j) {
    const blocker = world.structures.at(i, j);
    if (!blocker || !blocker.alive) return false;
    if (blocker.kind === 'house') {
      return Math.abs(x - blocker.x) < H.houseHitboxHalfExtent &&
        Math.abs(z - blocker.z) < H.houseHitboxHalfExtent;
    }
    if (blocker.kind === 'castle') {
      return Math.abs(x - blocker.x) < H.castleHitboxHalfExtent &&
        Math.abs(z - blocker.z) < H.castleHitboxHalfExtent;
    }
    return !(blocker.kind === 'tower' && (blocker.type === 'archer' || blocker.type === 'barricade'));
  }

  function crossesBlocker(blocker, ax, az, bx, bz) {
    const half = blocker.kind === 'house' ? H.houseHitboxHalfExtent
      : blocker.kind === 'castle' ? H.castleHitboxHalfExtent : null;
    if (half === null) return true;
    let enter = 0, leave = 1;
    for (const [a, b, centre] of [[ax, bx, blocker.x], [az, bz, blocker.z]]) {
      const delta = b - a;
      const min = centre - half, max = centre + half;
      if (Math.abs(delta) < 1e-8) {
        if (a <= min || a >= max) return false;
        continue;
      }
      let first = (min - a) / delta, last = (max - a) / delta;
      if (first > last) [first, last] = [last, first];
      enter = Math.max(enter, first); leave = Math.min(leave, last);
      if (enter >= leave) return false;
    }
    return leave > 0 && enter < 1;
  }

  // One destination, taken literally. Fails rather than searching -- the search
  // is moveTo's job, and keeping the strict version separate means the
  // reachability test lives in exactly one place however many candidates get
  // tried against it.
  function commitTo(i, j, aimX, aimZ) {
    if (!hero.alive) return false;
    if (!board.isLand(i, j)) return false;
    if (blockedForHero(i, j, aimX, aimZ)) return false;

    // Houses and the castle are narrower than their occupied tiles. Keep those
    // tiles blocked in the flow field so routes never cross the structure, but
    // approach a legal clicked margin from the nearest outside tile.
    let routeI = i, routeJ = j;
    const targetBlocker = world.structures.at(i, j);
    if (targetBlocker && blockedForHero(i, j)) {
      const approaches = [];
      const span = targetBlocker.span || 1;
      for (let dj = -1; dj <= span; dj++) {
        for (let di = -1; di <= span; di++) {
          if (di >= 0 && di < span && dj >= 0 && dj < span) continue;
          const ci = targetBlocker.i + di, cj = targetBlocker.j + dj;
          if (!board.isLand(ci, cj) || blockedForHero(ci, cj)) continue;
          if (board.at(ci, cj) !== board.at(i, j)) continue;
          approaches.push({ i: ci, j: cj, d: Math.hypot(ci - aimX, cj - aimZ) });
        }
      }
      approaches.sort((a, b) => a.d - b.d);
      if (!approaches.length) return false;
      routeI = approaches[0].i; routeJ = approaches[0].j;
    }

    const field = flowHero.field(
      `hero:${i}:${j}:via:${routeI}:${routeJ}`, [[routeI, routeJ]], undefined
    );
    const originX = hero.cliffJump ? hero.cliffJump.toX : hero.x;
    const originZ = hero.cliffJump ? hero.cliffJump.toZ : hero.z;
    let originI = Math.round(originX), originJ = Math.round(originZ);
    let escape = null;
    const originBlocker = world.structures.at(originI, originJ);
    const directMargin = originBlocker && originBlocker === targetBlocker &&
      !crossesBlocker(originBlocker, originX, originZ, aimX, aimZ);
    if (originBlocker && blockedForHero(originI, originJ) && !directMargin) {
      // The visible house is narrower than its tile, so the king may legitimately
      // stand near its edge while rounding to the occupied cell. Start routing
      // from the nearest reachable perimeter tile and walk there first; treating
      // the occupied tile itself as open is what allowed paths through the house.
      const candidates = [];
      const span = originBlocker.span || 1;
      for (let dj = -1; dj <= span; dj++) {
        for (let di = -1; di <= span; di++) {
          const ci = originBlocker.i + di, cj = originBlocker.j + dj;
          if (di >= 0 && di < span && dj >= 0 && dj < span) continue;
          if (!board.isLand(ci, cj) || blockedForHero(ci, cj)) continue;
          if (!isFinite(field.get(ci, cj))) continue;
          const tierPenalty = board.at(ci, cj) === hero.tier ? 0 : 10;
          candidates.push({
            i: ci, j: cj,
            d: Math.hypot(ci - originX, cj - originZ) + tierPenalty
          });
        }
      }
      candidates.sort((a, b) => a.d - b.d);
      if (!candidates.length) return false;
      originI = candidates[0].i; originJ = candidates[0].j;
      escape = [originI, originJ];
    }
    if (!directMargin && !isFinite(field.get(originI, originJ))) return false;
    hero.field = field;
    hero.goal = { i, j, x: aimX, z: aimZ };
    hero.waypoint = escape;
    const dx = hero.goal.x - originX, dz = hero.goal.z - originZ;
    const span = Math.hypot(dx, dz) || 1;
    hero.pathDx = dx / span; hero.pathDz = dz / span;
    return true;
  }

  // The point inside a tile closest to where the player actually touched, pulled
  // clear of the tile boundary. This is what makes a tap on the north wall of a
  // house walk him to the north side of it rather than to the middle of some
  // neighbouring tile.
  function aimInside(i, j, clickX, clickZ) {
    const inset = H.snapInset;
    return {
      x: Math.min(i + inset, Math.max(i - inset, clickX)),
      z: Math.min(j + inset, Math.max(j - inset, clickZ))
    };
  }

  // Where a tap sends him.
  //
  // The tapped tile first, exactly as given. If he cannot stand there -- a
  // house, the castle, water -- rings outward from the tap for the nearest place
  // he can, ordered by distance from the POINT touched rather than from the
  // tile's centre, so the choice matches where the finger went.
  //
  // Bounded twice over: snapRadius caps how far the meaning of a tap may travel
  // (see the note in config), and snapAttempts caps how many reachability tests
  // one tap may cost. Each test is a flow-field build over a hundred tiles and
  // the first candidate succeeds essentially always, so this is one unit's worth
  // of pathing, once, on a tap.
  function moveTo(i, j, exactX, exactZ) {
    const clickX = exactX !== undefined ? exactX : i;
    const clickZ = exactZ !== undefined ? exactZ : j;

    let attempts = 1;
    if (commitTo(i, j, clickX, clickZ)) return true;
    // Nothing to search for if he cannot act at all.
    if (!hero.alive) return false;

    for (let radius = 1; radius <= H.snapRadius; radius++) {
      const ring = [];
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== radius) continue;   // the ring only
          const ci = i + di, cj = j + dj;
          if (!board.isLand(ci, cj) || blockedForHero(ci, cj)) continue;
          const aim = aimInside(ci, cj, clickX, clickZ);
          ring.push({ ci, cj, aim, d: Math.hypot(aim.x - clickX, aim.z - clickZ) });
        }
      }
      ring.sort((a, b) => a.d - b.d);
      for (const candidate of ring) {
        if (attempts++ > H.snapAttempts) return false;
        if (commitTo(candidate.ci, candidate.cj, candidate.aim.x, candidate.aim.z)) return true;
      }
    }
    return false;
  }

  function die() {
    hero.alive = false;
    hero.field = null;
    hero.goal = null;
    hero.waypoint = null;
    hero.target = null;
    cancelAttack();
    hero.cliffJump = null;
    hero.jumpPhase = null;
    // TDD 13: 6s, +2s per further death in the same wave. One death is a
    // setback, repeated deaths spiral, and the per-wave reset stops a bad wave
    // from poisoning the level.
    hero.reviveIn = H.reviveDelay + H.reviveIncrement * hero.deathsThisWave;
    hero.deathsThisWave++;
    world.events.push({ type: 'heroDied' });
  }

  function revive() {
    const [ri, rj] = home;
    hero.alive = true;
    hero.hp = hero.maxHp;
    hero.x = ri; hero.z = rj;
    hero.tier = board.at(ri, rj) || hero.tier;
    hero.onRamp = false;
    hero.safeX = hero.x; hero.safeZ = hero.z;
    hero.y = board.topY(ri, rj) - config.board.SINK;
    hero.px = hero.x; hero.pz = hero.z; hero.py = hero.y;
    hero.cliffJump = null;
    hero.jumpPhase = null;
    hero.waypoint = null;
    cancelAttack();
    world.events.push({ type: 'heroRevived' });
  }

  // Only the destination is named. Where he jumps FROM is his tier, not a tile
  // looked up by rounding -- see the note on cliffNext.
  //
  // `fromY` overrides that for the one case where he is not standing on the
  // terrain at all: stepping off the boat in the arrival cutscene, where the
  // start height is the deck.
  function beginCliffJump(toI, toJ, fromY) {
    cancelAttack();
    hero.cliffJump = {
      phase: 'anticipate', elapsed: 0,
      fromX: hero.x, fromZ: hero.z,
      toX: toI, toZ: toJ,
      fromY: fromY === undefined ? board.tierY(hero.tier) - config.board.SINK : fromY,
      toY: board.topY(toI, toJ) - config.board.SINK
    };
    hero.jumpPhase = 'anticipate';
    hero.jumpT = 0;
    hero.moving = false;
    hero.facing = Math.atan2(toI - hero.x, toJ - hero.z);
  }

  function stepCliffJump(dt) {
    const jump = hero.cliffJump;
    if (!jump) return false;
    jump.elapsed += dt;

    if (jump.phase === 'anticipate') {
      hero.jumpT = Math.min(1, jump.elapsed / H.cliffAnticipation);
      if (hero.jumpT >= 1) {
        jump.phase = 'airborne';
        jump.elapsed = 0;
        hero.jumpPhase = 'airborne';
        hero.jumpT = 0;
      }
      return true;
    }

    if (jump.phase === 'airborne') {
      const t = Math.min(1, jump.elapsed / H.cliffAirTime);
      hero.jumpT = t;
      hero.x = jump.fromX + (jump.toX - jump.fromX) * t;
      hero.z = jump.fromZ + (jump.toZ - jump.fromZ) * t;
      // Lift first, then accelerate downward. This still produces a visible hop
      // when dropping multiple tiers, unlike a parabola around the full drop.
      if (t < 0.3) {
        hero.y = jump.fromY + H.cliffHopHeight * Math.sin((t / 0.3) * Math.PI / 2);
      } else {
        const fall = (t - 0.3) / 0.7;
        hero.y = jump.fromY + H.cliffHopHeight +
          (jump.toY - jump.fromY - H.cliffHopHeight) * fall * fall;
      }
      if (t >= 1) {
        hero.x = jump.toX; hero.z = jump.toZ; hero.y = jump.toY;
        // The landing is one of exactly two places his tier may change.
        hero.tier = board.at(Math.round(jump.toX), Math.round(jump.toZ)) || hero.tier;
        hero.onRamp = false;
        hero.safeX = hero.x; hero.safeZ = hero.z;
        hero.waypoint = null;
        jump.phase = 'landing';
        jump.elapsed = 0;
        hero.jumpPhase = 'landing';
        hero.jumpT = 0;
        hero.landingSerial++;
      }
      return true;
    }

    hero.jumpT = Math.min(1, jump.elapsed / H.cliffLanding);
    if (hero.jumpT >= 1) {
      hero.cliffJump = null;
      hero.jumpPhase = null;
      hero.jumpT = 0;
    }
    return true;
  }

  function step(dt, combat) {
    hero.px = hero.x; hero.pz = hero.z; hero.py = hero.y;
    hero.pFacing = hero.facing; hero.pGait = hero.gaitPhase;

    if (!hero.alive) {
      hero.reviveIn -= dt;
      if (hero.reviveIn <= 0) revive();
      return;
    }

    // ---- movement ----
    let travelled = 0;
    let onStairs = false;
    const jumpLocked = stepCliffJump(dt);
    if (!jumpLocked && hero.goal) {
      const here = [Math.round(hero.x), Math.round(hero.z)];
      // Once he is standing IN the goal tile, that tile's own centre is not a
      // waypoint worth holding. Holding it made him walk past a tap near a tile
      // edge, all the way to the centre -- up to snapInset, 0.35 of a tile --
      // and then turn around and come back, because the waypoint only cleared
      // on exact arrival and `atGoalTile` could not be true until it did.
      //
      // Only the goal tile's OWN centre is dropped this way. An escape waypoint
      // (set when he starts inside a house's margin and has to walk out before
      // routing) points somewhere else and is left alone, or he would cut the
      // corner straight back through the structure it exists to get him around.
      if (hero.waypoint && here[0] === hero.goal.i && here[1] === hero.goal.j &&
        hero.waypoint[0] === hero.goal.i && hero.waypoint[1] === hero.goal.j) {
        hero.waypoint = null;
      }
      const atGoalTile = !hero.waypoint &&
        here[0] === hero.goal.i && here[1] === hero.goal.j;
      if (hero.waypoint && Math.hypot(hero.waypoint[0] - hero.x, hero.waypoint[1] - hero.z) < 1e-6) {
        hero.waypoint = null;
      }
      if (!atGoalTile && !hero.waypoint && hero.field) {
        hero.waypoint = hero.field.next(here[0], here[1], hero.pathDx, hero.pathDz);
        if (hero.waypoint) {
          hero.pathDx = hero.waypoint[0] - here[0];
          hero.pathDz = hero.waypoint[1] - here[1];
        }
      }
      const next = atGoalTile ? null : hero.waypoint;
      // Against hero.tier, NOT against the tile he rounds to. The rounded tile is
      // derived and can be wrong for a frame; the tier is the thing that decides
      // how high he is drawn, so it is the thing that should decide whether the
      // step in front of him is a drop.
      const cliffNext = next && board.at(next[0], next[1]) < hero.tier &&
        !board.rampBetween(here[0], here[1], next[0], next[1]);
      const aim = atGoalTile
        ? { x: hero.goal.x, z: hero.goal.z }
        : cliffNext ? {
            x: here[0] + (next[0] - here[0]) * H.cliffTakeoff,
            z: here[1] + (next[1] - here[1]) * H.cliffTakeoff
          }
        : next ? { x: next[0], z: next[1] } : { x: hero.goal.x, z: hero.goal.z };

      const dx = aim.x - hero.x, dz = aim.z - hero.z;
      const remaining = Math.hypot(dx, dz);
      const stair = board.rampAt(hero.x, hero.z);
      const climbing = stair &&
        dx * (stair.ramp.hi - stair.ramp.li) + dz * (stair.ramp.hj - stair.ramp.lj) > 0;
      onStairs = !!stair;
      if (remaining < config.unit.arriveEpsilon && atGoalTile) {
        hero.goal = null; hero.field = null; hero.waypoint = null;
      } else if (cliffNext && remaining < 1e-6) {
        beginCliffJump(next[0], next[1]);
      } else if (remaining > 1e-6) {
        const speed = hero.speed * (climbing ? H.stairUpSpeed : 1);
        const move = Math.min(speed * dt, remaining);
        hero.x += (dx / remaining) * move;
        hero.z += (dz / remaining) * move;
        travelled = move;
        hero.facing = lerpAngle(hero.facing, Math.atan2(dx, dz),
          Math.min(1, config.anim.TURN_RATE * dt));
      }
    }

    hero.gaitPhase = (hero.gaitPhase +
      (travelled / config.anim.STRIDE) * Math.PI * H.walkAnimRate) % (Math.PI * 2);
    hero.moving = travelled > 1e-6;

    // THE HERO'S ONLY COLLISION, and his elevation, in that order for a reason.
    //
    // He is not in world.units, so separation never sees him and nothing else
    // constrains where he ends a frame. Without the clamp he walks bodily into
    // cliffs: he stays at his own height, so he is inside the rock, and every
    // question answered by rounding his position then reports him a tier up --
    // including whether the tile ahead is a drop, which sent him into a cliff
    // jump from a ledge he was never standing on.
    //
    // ELEVATION RESOLVES FIRST. Stepping off the top of a ramp is the moment his
    // tier changes, and it is walkElevation that notices; clamping before it
    // tests the new tile against the tier he was on at the BOTTOM of the stairs,
    // rejects it, and pins him to the ramp forever. Found exactly that way.
    if (!hero.cliffJump) {
      let step = board.walkElevation(hero.x, hero.z, hero.tier, hero.onRamp);
      hero.tier = step.tier;
      hero.onRamp = step.onRamp;

      // Slide before reverting, for the same reason separation does: giving back
      // the whole move turns "that step was illegal" into "this thing is stuck
      // on a wall", where keeping the legal axis lets him graze along it.
      if (board.canStandOn(hero.x, hero.z, hero.tier)) {
        hero.safeX = hero.x; hero.safeZ = hero.z;
      } else {
        if (board.canStandOn(hero.x, hero.safeZ, hero.tier)) {
          hero.z = hero.safeZ; hero.safeX = hero.x;
        } else if (board.canStandOn(hero.safeX, hero.z, hero.tier)) {
          hero.x = hero.safeX; hero.safeZ = hero.z;
        } else {
          hero.x = hero.safeX; hero.z = hero.safeZ;
        }
        // He is somewhere else now, so the height has to be asked again.
        step = board.walkElevation(hero.x, hero.z, hero.tier, hero.onRamp);
        hero.tier = step.tier;
        hero.onRamp = step.onRamp;
      }

      const targetY = step.y - config.board.SINK;
      // On stairs the height genuinely changes under him, so it is taken
      // directly; everywhere else it is already his own tier and the ease only
      // ever smooths the one frame a ramp ends on.
      if (onStairs || step.onRamp) hero.y = targetY;
      else hero.y += (targetY - hero.y) * Math.min(1, 10 * dt);
    }

    // ---- attack ----
    // Fully automatic and layered over movement. Cliff jumps return before this
    // sequence advances, and beginCliffJump cancels an in-progress draw.
    hero.cooldown -= dt;
    if (hero.cliffJump) return;
    const muzzle = {
      id: 'hero',
      x: hero.x, z: hero.z,
      y: targetHeight(board, hero.x, hero.z) + 0.15
    };
    if (hero.target && (!hero.target.alive || !combat.canHit(muzzle, hero.target, H))) {
      hero.target = null;
    }

    if (hero.attackTime >= 0) {
      const target = hero.attackTarget;
      if (!hero.attackReleased && (!target || !target.alive || !combat.canHit(muzzle, target, H))) {
        if (hero.target === target) hero.target = null;
        cancelAttack();
        return;
      }

      hero.attackTime += dt;
      if (!hero.attackReleased) {
        hero.attackAim = Math.atan2(target.x - hero.x, target.z - hero.z);
        if (hero.attackTime >= H.attackWindup) {
          combat.fire(muzzle, target, H.damage, H.arrowSpeed, hero, H.trajectory);
          hero.cooldown = H.fireInterval;
          hero.attackReleased = true;
        }
      }
      if (hero.attackTime >= H.attackWindup + H.attackRecovery) cancelAttack();
      return;
    }

    if (!hero.target) hero.target = combat.acquire(muzzle, H);
    if (hero.target) {
      if (!hero.moving) {
        hero.facing = lerpAngle(hero.facing,
          Math.atan2(hero.target.x - hero.x, hero.target.z - hero.z),
          Math.min(1, config.anim.TURN_RATE * dt));
      }
      if (hero.cooldown <= 0) {
        hero.attackTime = 0;
        hero.attackTarget = hero.target;
        hero.attackReleased = false;
        hero.attackAim = Math.atan2(hero.target.x - hero.x, hero.target.z - hero.z);
      }
    }
  }

  return {
    hero, step, moveTo, die,
    // For the arrival cutscene: the same cliff jump, starting from the deck.
    leapTo(i, j, fromY) { beginCliffJump(i, j, fromY); },
    // Called when the castle is sited. Puts him at its gate rather than inside
    // its walls, where he was previously invisible behind two metres of stone.
    setHome(i, j) {
      home[0] = i; home[1] = j;
      hero.x = i; hero.z = j;
      hero.tier = board.at(i, j) || hero.tier;
      hero.onRamp = false;
      hero.safeX = hero.x; hero.safeZ = hero.z;
      hero.y = board.groundYAt(i, j) - config.board.SINK;
      hero.px = hero.x; hero.pz = hero.z; hero.py = hero.y;
      hero.goal = null; hero.field = null; hero.waypoint = null;
    },
    damage(amount) {
      if (!hero.alive) return;
      hero.hp -= amount;
      if (hero.hp <= 0) { hero.hp = 0; die(); }
    },
    // TDD 13: the revive counter resets each wave, and he returns to full HP.
    resetForWave() {
      hero.deathsThisWave = 0;
      hero.hp = hero.maxHp;
      if (!hero.alive) revive();
    }
  };
}
