// Hero TD -- the raiders.
//
// TDD section 10. Three types, three jobs: the grunt is volume, the archer
// outranges anything that cannot reach back, and the brute breaks a chokepoint.
//
// Two behavioural rules do most of the work, and neither is about stats:
//
//   CASTLE FIRST. Every enemy's objective is the castle. Towers and houses are
//   not objectives; they are things in the way, and an enemy engages one only
//   because it hurt them or because they walked close enough to notice it. This
//   is what stops a landing party fanning out across the island to chew on
//   whatever is nearest, and what makes the castle's placement matter.
//
//   TWO AGGRO PRIORITIES, in this order:
//     1. Retaliation. Something within aggroRange hurt me: engage it, and stay
//        engaged while it lives and stays within attentionRange.
//     2. Proximity. Nothing hurt me, but a building came within aggroRange.
//
//   The two ranges are deliberately a hair apart. aggroRange is what a unit
//   notices; attentionRange is slightly wider and exists only so a retaliation
//   target does not flicker on and off at the boundary.
//
//   THE KING IS NOT A PROXIMITY TARGET, BUT HE IS A RETALIATION ONE. Walking
//   past him provokes nothing -- proximity aggro sees buildings only. Shooting
//   somebody does: a unit the king has hurt will break off and come for him, and
//   will keep coming while he stays inside attentionRange.
//
//   That asymmetry is the whole hero design in one rule. He can walk through a
//   landing party untouched, but the moment he opens fire he owns the
//   consequences -- so his damage is not free, and kiting a wave away from the
//   castle is a real tactic with a real cost rather than an exploit.

import { config } from '../config.js';
import { lerpAngle, TAU } from './angles.js';
import { muzzleHeight, targetHeight } from './los.js';

export function createEnemies(world, flowGround, combat) {
  const board = world.board;
  // Read lazily, never captured: createEnemies runs while the world object is
  // still being assembled, so world.structures is not set yet at this point.
  const structures = () => world.structures;

  function spawn(type, x, z) {
    const spec = config.enemies[type];
    // TDD 10 caps concurrency at 40 and says to design waves against that
    // ceiling. The guard is here so a bad wave table degrades rather than melts.
    let living = 0;
    for (const unit of world.units) if (unit.alive) living++;
    if (living >= config.MAX_ENEMIES) return null;

    const u = {
      id: world.nextId++,
      type,
      x, z, y: 0.16,
      px: x, pz: z, py: 0.16,
      safeX: x, safeZ: z,
      facing: 0, pFacing: 0,
      gaitPhase: (world.nextId * 2.399963) % TAU,   // TDD 15: never in lockstep
      pGait: 0,
      speed: spec.speed,
      hp: spec.hp, maxHp: spec.hp,
      pushRadius: spec.pushRadius || config.unit.pushRadius,
      hitRadius: spec.hitRadius || config.unit.hitRadius,
      alive: true,
      deathAge: 0,
      state: 'walking',
      target: null,          // the castle: the standing objective
      aggro: null,           // what interrupted the march, if anything
      aggroKind: null,       // 'retaliation' | 'proximity'
      // The tier this unit believes it is standing on. Changes on a ramp and
      // nowhere else; see board.walkElevation.
      tier: board.at(Math.round(x), Math.round(z)) || 1,
      onRamp: false,
      field: null,
      fieldGoal: null,       // id the current field routes to
      // The tile currently being walked to, held until it is reached. See the
      // note in step(): re-deciding this every frame is what makes a unit
      // oscillate across a tile boundary forever.
      waypoint: null,
      waypointFrom: null,
      cooldown: 0,
      heroCooldown: 0,
      moving: false,
      footfall: 0,
      boat: null,
      boatOffset: 0,
      boatTargetOffset: 0,
      disembark: null
    };
    u.losId = 'u' + u.id;
    u.pGait = u.gaitPhase;
    world.units.push(u);
    return u;
  }

  // Structures are measured to their footprint edge; the king is a point.
  const reach = (u, t) => t.isStructure
    ? structures().edgeDistance(u.x, u.z, t)
    : Math.hypot(t.x - u.x, t.z - u.z);

  // Fall back to the castle. TDD 10: the castle is the objective; everything
  // else is an interruption.
  function retarget(u) {
    // Deliberately does NOT clear aggro. `target` is the standing objective and
    // `aggro` is the interruption; they are separate concerns resolved in
    // priority order each frame. Clearing aggro here meant that any frame which
    // also needed to refresh the objective silently threw away a proximity
    // target acquired moments earlier in the same frame -- a unit would notice a
    // building, forget it, and walk on.
    u.target = structures().theCastle();
    u.field = u.target
      ? flowGround.routeTo(u.target, Math.round(u.x), Math.round(u.z))
      : null;
    // A passenger is still a passenger. Retargeting must never march someone off
    // a boat: the state only changes when the hull actually grounds (waves.js).
    if (u.state !== 'boat') u.state = u.target ? 'walking' : 'idle';
  }

  // Priority 1. Called from world.damageUnit when a building or the king lands a
  // hit. The attacker has to be inside aggroRange to provoke anything -- a tower
  // sniping from across the island does not pull a wave off the castle.
  function provoke(u, attacker) {
    if (!u.alive || !attacker || u.state === 'boat') return;
    if (!attacker.isStructure && !attacker.isHero) return;
    const spec = config.enemies[u.type];
    const distance = attacker.isStructure
      ? reach(u, attacker)
      : Math.hypot(attacker.x - u.x, attacker.z - u.z);
    if (distance > spec.aggroRange) return;
    // Already locked onto a live retaliation target: do not switch.
    if (u.aggroKind === 'retaliation' && u.aggro && u.aggro.alive) return;
    u.aggro = attacker;
    u.aggroKind = 'retaliation';
  }

  // Priority 2. Only consulted when there is no live retaliation target, and it
  // scans buildings only -- TDD 10 lists towers, barricades, bulwarks, houses and
  // the castle. The king is deliberately absent.
  function scanProximity(u, spec) {
    let best = null, bestD = Infinity;
    for (const s of structures().list) {
      if (!s.alive) continue;
      const d = reach(u, s);
      if (d > spec.aggroRange || d >= bestD) continue;
      best = s; bestD = d;
    }
    return best;
  }

  // TDD 10 target validity. A retaliation target is released only when it dies,
  // leaves attentionRange, or is unreachable; a proximity target when it dies,
  // leaves aggroRange, or is unreachable.
  function aggroStillValid(u, spec) {
    const a = u.aggro;
    if (!a || !a.alive) return false;
    const limit = u.aggroKind === 'retaliation' ? spec.attentionRange : spec.aggroRange;
    const distance = a.isStructure ? reach(u, a) : Math.hypot(a.x - u.x, a.z - u.z);
    return distance <= limit;
  }

  const muzzleOf = u => ({
    id: u.losId,
    x: u.x, z: u.z,
    y: targetHeight(board, u.x, u.z) + 0.12
  });

  function fireAt(u, spec, target) {
    u.cooldown = spec.attackInterval;
    combat.fire(muzzleOf(u), target, spec.damage, spec.projectileSpeed, u, spec.trajectory);
    world.events.push({ type: 'enemyShot', unit: u });
  }

  // Passengers still aboard are not passengers with nothing to do. TDD 11: enemy
  // archers shoot back during the approach, at shore-adjacent towers, which is
  // the tradeoff that makes building on the waterline interesting rather than
  // automatic. They have not landed and so have not committed to anything yet,
  // so this pass is opportunistic by design.
  function stepBoatArcher(u, spec, dt) {
    u.cooldown -= dt;
    const from = muzzleOf(u);
    if (!u.target || !u.target.alive || !combat.canHit(from, u.target, spec)) {
      u.target = combat.acquireStructure(from, spec);
    }
    if (!u.target) return;
    u.facing = Math.atan2(u.target.i - u.x, u.target.j - u.z);
    if (u.cooldown <= 0) fireAt(u, spec, u.target);
  }

  function step(u, dt) {
    if (!u.alive) { u.moving = false; return; }

    const spec = config.enemies[u.type];

    if (u.state === 'boat') {
      if (u.disembark) u.moving = false;
      if (spec.ranged && !u.disembark) stepBoatArcher(u, spec, dt);
      return;
    }

    // ---- resolve what this unit is engaging, in TDD 10's priority order ----
    if (u.aggro && !aggroStillValid(u, spec)) { u.aggro = null; u.aggroKind = null; }
    if (!u.aggro) {
      const near = scanProximity(u, spec);
      if (near) { u.aggro = near; u.aggroKind = 'proximity'; }
    }
    if (!u.target || !u.target.alive) retarget(u);

    // The castle is the objective; aggro is an interruption that outranks it.
    const engaged = u.aggro || u.target;
    if (!engaged) { u.moving = false; return; }

    let travelled = 0;
    const from = spec.ranged ? muzzleOf(u) : null;
    const inRange = spec.ranged
      ? combat.canHit(from, engaged, spec)
      : reach(u, engaged) <= spec.attackRange;

    if (inRange) {
      // TDD 10: an archer stops at range and fires. It does not close to melee,
      // which is exactly why an elevated tower gets ground down from outside its
      // own reach unless somebody walks over and stops it.
      u.state = 'attacking';
      // Drop the committed waypoint: whatever it was walking to was chosen for
      // a march it is no longer on, and holding it would send the unit back
      // there the instant its target dies.
      u.waypoint = null;
      // TDD 10: changing targets never resets or refills the attack cooldown.
      u.cooldown -= dt;
      if (u.cooldown <= 0) {
        if (spec.ranged) {
          fireAt(u, spec, engaged);
        } else {
          u.cooldown = spec.attackInterval;
          // The engaged thing may be a building or the king.
          if (engaged.isStructure) world.damageStructure(engaged, spec.damage, u);
          else world.damageUnit(engaged, spec.damage, u);
          world.events.push({ type: 'meleeHit', unit: u });
        }
      }
      u.facing = lerpAngle(u.facing, Math.atan2(engaged.x - u.x, engaged.z - u.z),
        Math.min(1, config.anim.TURN_RATE * dt));
    } else {
      u.state = 'walking';
      const here = [Math.round(u.x), Math.round(u.z)];
      // Route to whatever is being engaged. For a structure that is the two-pass
      // field of TDD 8. The king has no footprint and moves, so he is routed to
      // as a single tile, re-keyed whenever he steps to a new one -- which is
      // what makes the retaliation pursuit of TDD 10 actually follow him.
      const routeGoal = engaged;
      const chasingHero = !routeGoal.isStructure;
      const goalTile = chasingHero ? [Math.round(routeGoal.x), Math.round(routeGoal.z)] : null;
      const goalKey = chasingHero ? 'hero:' + goalTile[0] + ':' + goalTile[1] : 's' + routeGoal.id;
      if (!u.field || u.fieldGoal !== goalKey || u.field.generation !== flowGround.generation) {
        u.field = chasingHero
          ? flowGround.field(goalKey, [goalTile], undefined)
          : flowGround.routeTo(routeGoal, here[0], here[1]);
        u.fieldGoal = goalKey;
      }
      // COMMIT TO THE WAYPOINT until it is reached.
      //
      // The flow field answers per tile, and the unit walks in continuous space
      // toward the centre of the tile the field names. Those two facts fight
      // each other: the straight line to the next tile centre often leaves the
      // current tile before it arrives, and the tile it passes through has its
      // own answer -- which can point straight back. The unit then ping-pongs
      // across the boundary at a few thousandths of a tile per frame, alive and
      // never arriving, holding the wave open forever. Found on Twin Capes at
      // the (5,8)/(6,8) seam, where the two tiles' successors point at each
      // other across x = 5.5.
      //
      // So the field is consulted when there is no waypoint, when the route has
      // changed underneath it, or when the current waypoint has been reached --
      // and not once per frame. Committing also stops a crowd re-planning every
      // time separation nudges someone over a tile line, which is what turned
      // the single ramp on Twin Capes into a standing traffic jam.
      const stale = !u.waypoint ||
        u.waypointGoal !== goalKey ||
        u.waypointGeneration !== flowGround.generation ||
        Math.hypot(u.waypoint[0] - u.x, u.waypoint[1] - u.z) <= config.unit.waypointReached;

      if (stale) {
        const chosen = u.field.next(here[0], here[1], engaged.x - u.x, engaged.z - u.z);
        // TDD 10 retaliation pursuit: if there is no path to a retaliation
        // target, drop it and go back to the castle rather than standing still.
        if (!chosen && u.aggroKind === 'retaliation' && !isFinite(u.field.get(here[0], here[1]))) {
          u.aggro = null; u.aggroKind = null; u.field = null; u.fieldGoal = null;
        }
        u.waypoint = chosen || null;
        u.waypointFrom = here;
        u.waypointGoal = goalKey;
        u.waypointGeneration = flowGround.generation;
      }
      const next = u.waypoint;
      // No route left at all: walk straight at it and chew through whatever is
      // in the way. TDD 7 -- never allow a state where a unit has no valid action.
      const aim = next ? { x: next[0], z: next[1] } : { x: engaged.x, z: engaged.z };
      const dx = aim.x - u.x, dz = aim.z - u.z;
      const span = Math.hypot(dx, dz);
      if (span > 1e-6) {
        const stair = board.rampAt(u.x, u.z);
        const climbing = stair &&
          dx * (stair.ramp.hi - stair.ramp.li) + dz * (stair.ramp.hj - stair.ramp.lj) > 0;
        const speed = u.speed * (climbing ? config.unit.stairUpSpeed : 1);
        const move = Math.min(speed * dt, span);
        u.x += (dx / span) * move;
        u.z += (dz / span) * move;
        travelled = move;
        u.facing = lerpAngle(u.facing, Math.atan2(dx, dz),
          Math.min(1, config.anim.TURN_RATE * dt));
      }
    }

    // TDD 15: gait advances with distance travelled, never with wall-clock time.
    u.gaitPhase = (u.gaitPhase + (travelled / config.anim.STRIDE) * Math.PI) % TAU;
    u.moving = travelled > 1e-6;
    const beat = Math.floor(u.gaitPhase / Math.PI);
    if (beat !== u.footfall) { u.footfall = beat; world.events.push({ type: 'footstep', unit: u }); }
  }

  // Opportunistic only, and deliberately so -- see the header. An enemy that
  // happens to have the king inside its reach hits him; nothing here ever moves
  // a unit toward him or takes its target away.
  //
  // Reach uses the hit radii rather than the attack range, because this is a
  // body-to-body test rather than an approach: a brute is a big thing and should
  // connect from further away than a grunt does.
  function stepHeroAttacks(dt, heroControl) {
    const hero = world.hero;
    if (!hero.alive) return;
    for (const u of world.units) {
      if (!u.alive || u.state === 'boat') continue;
      const spec = config.enemies[u.type];
      // `range` for the ranged, and it matters: this is the second place the
      // archer's reach is read, so naming it attackRange here would have let it
      // shoot the king from across the island even after the spec was fixed.
      const reach = spec.ranged
        ? spec.range
        : u.hitRadius + config.unit.hitRadius + 0.35;
      if (Math.hypot(hero.x - u.x, hero.z - u.z) > reach) continue;
      u.heroCooldown -= dt;
      if (u.heroCooldown <= 0) {
        u.heroCooldown = spec.attackInterval;
        heroControl.damage(spec.damage);
        world.events.push({ type: 'heroHit', unit: u });
      }
    }
  }

  return { spawn, retarget, provoke, step, stepHeroAttacks, muzzleOf };
}
