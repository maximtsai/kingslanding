// Hero TD -- targeting, projectiles and damage.
//
// TDD section 9. Every acquisition in the game goes through `canHit`, and
// `canHit` is three tests in a fixed order: the elevation-modified range band,
// the minimum-range dead zone, and line of sight along the shooter's own
// trajectory. Nothing shoots without passing all three.
//
// The projectile flies the curve `los.js` tested. That is not a nicety -- if the
// two ever diverge, arrows clip through cliffs the targeting swore were clear,
// and the player stops trusting what the range overlay tells them.

import { config } from '../config.js';
import {
  createLosCache, elevationBonus,
  apexFor, arcY, flatY, muzzleHeight, targetHeight
} from './los.js';

export function createCombat(world) {
  const projectiles = [];
  const ripples = [];
  const los = createLosCache();
  const board = world.board;
  const P = config.projectiles;
  let nextId = 1;

  // Effective range at this shooter/target pair. TDD 9: height advantage is
  // symmetric -- shooting downhill reaches further, uphill reaches less far.
  function effectiveRange(spec, from, to) {
    return spec.range + elevationBonus(board, from.x, from.z, to.x, to.z);
  }

  // Checked once, at construction, because the failure is silent at runtime.
  // effectiveRange is arithmetic on spec.range, and a missing one yields NaN --
  // which does not throw, does not warn, and makes every range comparison
  // false, so the shooter fires from any distance it can see. An enemy archer
  // shipped that way through two phases; the cost of catching it here is one
  // loop at boot.
  (function assertRangedSpecsHaveRange() {
    const broken = [];
    for (const [name, spec] of Object.entries(config.enemies)) {
      if (spec.ranged && !(spec.range > 0)) broken.push(`enemies.${name}`);
    }
    for (const [name, spec] of Object.entries(config.towers)) {
      // A barricade has neither range nor melee and is meant to have neither.
      if ((spec.arrowsPerVolley || spec.trajectory) && !(spec.range > 0)) {
        broken.push(`towers.${name}`);
      }
    }
    if (broken.length) {
      throw new Error('specs that shoot but have no numeric `range`: ' + broken.join(', '));
    }
  })();

  // The single seam every shooter passes through.
  //
  // `from` carries the muzzle (x, z in tile space, y in world units) and an id
  // for the LOS cache. `spec` carries range, minRange and trajectory.
  // Distance to the target's footprint edge. Units are points (halfExtent 0), a
  // tower is half a tile, the castle a full one -- so one formula serves all
  // three and a 2x2 objective is not treated as if it were a dot at its centre.
  function rangeTo(from, target) {
    if (!target.isStructure) return Math.hypot(target.x - from.x, target.z - from.z);
    return world.structures.edgeDistance(from.x, from.z, target);
  }

  function canHit(from, target, spec) {
    const d = rangeTo(from, target);
    if (d < (spec.minRange || 0)) return false;              // dead zone
    if (d > effectiveRange(spec, from, target)) return false; // range band
    const to = { x: target.x, z: target.z, y: targetHeight(board, target.x, target.z) };
    // losId keeps units and structures in separate key spaces. Both count from
    // their own id sequences, so raw ids would collide and one would silently
    // answer for the other.
    return los.test(board, from.id, from, target.losId || target.id, to, spec.trajectory || 'arc');
  }

  // TDD 9: acquire the nearest target with valid LOS and outside minimum range,
  // not simply the nearest. A target behind a cliff is not a target, and picking
  // it anyway would leave the tower standing idle with an enemy "selected".
  function acquire(from, spec) {
    let best = null, bestD = Infinity;
    for (const u of world.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - from.x, u.z - from.z);
      if (d >= bestD) continue;
      if (!canHit(from, u, spec)) continue;
      best = u; bestD = d;
    }
    return best;
  }

  // Nearest structure this shooter can actually hit. Used by enemy archers, who
  // shoot buildings rather than people. Deliberately opportunistic: it is only
  // called where the shooter has not committed to a target yet (from a boat), so
  // it does not undercut the commitment rule of TDD 10.
  function acquireStructure(from, spec) {
    let best = null, bestD = Infinity;
    for (const s of world.structures.list) {
      if (!s.alive) continue;
      const d = rangeTo(from, s);
      if (d >= bestD) continue;
      if (!canHit(from, s, spec)) continue;
      best = s; bestD = d;
    }
    return best;
  }

  const projectileTargetY = target => !target.isStructure && Number.isFinite(target.y)
    ? target.y + config.los.TARGET_HEIGHT
    : targetHeight(board, target.x, target.z);

  function setDirection(p, dx, dy, dz) {
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return;
    p.dirX = dx / length;
    p.dirY = dy / length;
    p.dirZ = dz / length;
  }

  function beginMiss(p) {
    p.state = 'miss';
    p.target = null;
    p.vx = p.dirX * p.speed;
    p.vy = p.dirY * p.speed;
    p.vz = p.dirZ * p.speed;
  }

  // Both ends of a shot's life are events: `impact` fires whether or not the
  // arrow found anybody, because a miss thudding into the dirt is a sound too,
  // and a volley that only makes noise when it connects reads as unresponsive.
  function impactEvent(x, z, hit, kind) {
    world.events.push({ type: 'impact', x, z, hit, kind: kind || 'arrow' });
  }

  function groundArrow(p, impactX, impactZ, surfaceY) {
    // `p` is the arrow centre. Pull it back from the impact point so its nose,
    // rather than its midpoint, appears planted in the terrain.
    p.state = 'grounded';
    p.life = P.groundLifetime;
    p.x = impactX - p.dirX * 0.18;
    p.z = impactZ - p.dirZ * 0.18;
    p.y = surfaceY + 0.02 - p.dirY * 0.18;
  }

  function enterWater(p) {
    p.state = 'submerged';
    p.life = P.submergedLifetime;
    p.y = 0;
    // Set the sink velocity HERE rather than inheriting the arrival one. Two
    // separate bugs came out of inheriting it. An arrow that simply ran out of
    // flight over open water has no velocity at all -- only beginMiss ever
    // assigned vx/vy/vz -- so the submerged step drove its position to NaN and
    // left a garbage instance on the surface. And an arrow that DID come in as
    // a miss arrived at full shaft speed, roughly 8 units/s, which fired it out
    // of sight within a couple of frames instead of sinking.
    p.vx = p.dirX * P.sinkDrift;
    p.vz = p.dirZ * P.sinkDrift;
    p.vy = -P.sinkSpeed;
    ripples.push({ x: p.x, z: p.z, age: 0, life: P.rippleLifetime });
  }

  function embedArrow(p) {
    const target = p.target;
    p.state = 'embedded';
    p.life = P.embedLifetime;
    if (!target) return;
    p.anchorX = p.x - target.x;
    p.anchorZ = p.z - target.z;
    p.anchorY = p.y - projectileTargetY(target);
  }

  function leadTarget(from, target, speed) {
    const dx = target.x - from.x, dz = target.z - from.z;
    const vx = target.isStructure ? 0 : (target.x - target.px) * config.sim.HZ;
    const vz = target.isStructure ? 0 : (target.z - target.pz) * config.sim.HZ;
    const a = vx * vx + vz * vz - speed * speed;
    const b = 2 * (dx * vx + dz * vz);
    const c = dx * dx + dz * dz;
    let time = Math.sqrt(c) / speed;

    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-6) {
        const candidate = -c / b;
        if (candidate > 0) time = candidate;
      }
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const first = (-b - root) / (2 * a);
        const second = (-b + root) / (2 * a);
        const candidate = [first, second].filter(t => t > 0).sort((x, z) => x - z)[0];
        if (candidate !== undefined) time = candidate;
      }
    }

    // Very close shots still have a readable minimum flight time, so lead over
    // that same duration rather than aiming at a point the arrow cannot reach.
    time = Math.max(0.18, time);
    // Deliberately underlead a little: perfectly solving the intercept makes
    // every archer feel unnaturally prescient, while 85% still rewards a target
    // continuing in the direction it was moving when the arrow was released.
    const lead = 0.85;
    return {
      x: target.x + vx * time * lead,
      z: target.z + vz * time * lead,
      y: projectileTargetY(target),
      duration: time
    };
  }

  // Nudge the aim point off the solved intercept, once, at release.
  //
  // leadTarget() returns a perfect firing solution, and a tower firing nothing
  // but perfect solutions reads as a turret rather than as archers. This is the
  // only randomness in a projectile's whole life: after it, the arrow is on a
  // fixed line to a fixed point and nothing -- not the target moving, not the
  // target dying -- ever adjusts it again.
  //
  // See config.projectiles.spread for the geometry and the numbers.
  function scatterAim(aim, from) {
    const dx = aim.x - from.x, dz = aim.z - from.z;
    const flight = Math.hypot(dx, dz);
    if (!(flight > 1e-6) || !(P.spread > 0)) return;

    // Triangular, not uniform: bounded, so no shot is ever wild, but clustered
    // around zero, so the common case is still close to where it was aimed.
    const jitter = () => Math.random() + Math.random() - 1;

    const ux = dx / flight, uz = dz / flight;          // along the shot
    const lateral = jitter() * P.spread * flight;      // perpendicular: -uz, ux
    const along = jitter() * P.spread * (P.spreadRangeFactor || 0) * flight;

    aim.x += -uz * lateral + ux * along;
    aim.z += ux * lateral + uz * along;
  }

  // The trajectory is fixed at release. A target killed by another shot turns
  // this one into a physical miss instead of making it disappear.
  function fire(from, target, damage, speed, source, trajectory, splash, kind) {
    const startY = from.y;
    const aim = leadTarget(from, target, speed);
    scatterAim(aim, from);
    const dx = aim.x - from.x, dz = aim.z - from.z;
    const span = Math.hypot(dx, dz) || 1;
    projectiles.push({
      id: nextId++,
      x: from.x, z: from.z, y: startY,
      px: from.x, pz: from.z, py: startY,
       startX: from.x, startZ: from.z, startY,
       target, damage, source,
       aimX: aim.x, aimZ: aim.z, aimY: aim.y,
       splash: splash || 0,
      // What is in the air, as opposed to how it flies. The view picks its
      // geometry off this; the simulation treats every kind identically.
      kind: kind || 'arrow',
      trajectory: trajectory || 'arc',
      state: 'flying',
      speed,
      dirX: dx / span, dirY: 0, dirZ: dz / span,
      t: 0,
       duration: aim.duration
    });
    // The release. Carries the trajectory because a bowstring and a ballista are
    // different sounds, and who fired it because a tower and a landing party's
    // archer should not be equally loud in the mix.
    world.events.push({
      type: 'shot', x: from.x, z: from.z,
      trajectory: trajectory || 'arc',
      kind: kind || 'arrow',
      fromStructure: !!(source && source.isStructure)
    });
  }

  function step(dt) {
    for (let k = ripples.length - 1; k >= 0; k--) {
      ripples[k].age += dt;
      if (ripples[k].age >= ripples[k].life) ripples.splice(k, 1);
    }

    for (let k = projectiles.length - 1; k >= 0; k--) {
      const p = projectiles[k];
      p.px = p.x; p.pz = p.z; p.py = p.y;

      if (p.state === 'grounded') {
        p.life -= dt;
        if (p.life <= 0) projectiles.splice(k, 1);
        continue;
      }

      if (p.state === 'embedded') {
        if (p.target && p.target.alive) {
          p.x = p.target.x + p.anchorX;
          p.z = p.target.z + p.anchorZ;
          p.y = projectileTargetY(p.target) + p.anchorY;
        }
        p.life -= dt;
        if (p.life <= 0) projectiles.splice(k, 1);
        continue;
      }

      if (p.state === 'submerged') {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) projectiles.splice(k, 1);
        continue;
      }

      if (p.state === 'miss') {
        p.vy -= P.missGravity * dt;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += p.vy * dt;
        setDirection(p, p.vx, p.vy, p.vz);

        const i = Math.round(p.x), j = Math.round(p.z);
        if (board.isLand(i, j)) {
          const surfaceY = board.groundYAt(p.x, p.z);
          if (p.y <= surfaceY + 0.01) { impactEvent(p.x, p.z, false); groundArrow(p, p.x, p.z, surfaceY); }
        } else if (p.y <= 0) {
          enterWater(p);
        }
        continue;
      }

      if (p.state === 'overtravel') {
        const distance = Math.min(p.overtravel, p.speed * dt);
        p.x += p.dirX * distance;
        p.y += p.dirY * distance;
        p.z += p.dirZ * distance;
        p.overtravel -= distance;
        if (p.overtravel <= 1e-6) embedArrow(p);
        continue;
      }

      if (!p.target.alive) {
        beginMiss(p);
        continue;
      }

      p.t += dt / p.duration;
      const t = Math.min(1, p.t);
      const tx = p.aimX, tz = p.aimZ, ty = p.aimY;
      p.x = p.startX + (tx - p.startX) * t;
      p.z = p.startZ + (tz - p.startZ) * t;

      // The same curves los.js tests against. One source of truth.
      const span = Math.hypot(tx - p.startX, tz - p.startZ);
      p.y = p.trajectory === 'flat'
        ? flatY(p.startY, ty, t)
        : arcY(p.startY, ty, apexFor(p.startY, ty, span), t);
      setDirection(p, p.x - p.px, p.y - p.py, p.z - p.pz);

      if (t >= 1) {
        const hit = p.target.isStructure ||
          Math.hypot(p.target.x - p.x, p.target.z - p.z) <=
            (p.target.hitRadius || config.unit.hitRadius);
        impactEvent(p.x, p.z, p.splash || hit, p.kind);
        if (p.target.isStructure) {
          world.damageStructure(p.target, p.damage, p.source);
        } else if (p.splash) {
          // The catapult lands on a point, not on a person. Everything inside
          // the blast takes it, the nominal target included.
          for (const u of world.units) {
            if (!u.alive || u.state === 'boat') continue;
            if (Math.hypot(u.x - p.x, u.z - p.z) > p.splash) continue;
            world.damageUnit(u, p.damage, p.source);
          }
          world.events.push({ type: 'splash', x: p.x, z: p.z, radius: p.splash });
        } else if (hit) {
          world.damageUnit(p.target, p.damage, p.source);
        }
        // A BOTTLE BREAKS. Arrows earn their afterlife -- they stick in the
        // target, plant in the ground, or overtravel -- but a molotov that has
        // arrived is glass and burning rag, and leaving it lodged in a wall as a
        // glowing box is the one way this effect could look broken. The fire it
        // started is on the building now (see the ember pool in views.js), which
        // is where the player should be looking anyway.
        if (p.kind === 'molotov' || p.splash) {
          projectiles.splice(k, 1);
        } else if (!hit) {
          const i = Math.round(p.x), j = Math.round(p.z);
          if (board.isLand(i, j)) groundArrow(p, p.x, p.z, board.groundYAt(p.x, p.z));
          else enterWater(p);
        } else {
          p.state = 'overtravel';
          p.overtravel = P.overtravelDistance;
        }
      }
    }
  }

  return {
    projectiles, ripples, acquire, acquireStructure, canHit, fire, step, effectiveRange, rangeTo,
    los,
    clear() { projectiles.length = 0; ripples.length = 0; los.clear(); }
  };
}

// Tower firing. Kept out of the structure record so the data stays plain.
//
// Four behaviours share this loop, chosen by what the spec carries rather than
// by a type switch, so a new tower is a config entry and not a new branch:
//
//   nothing        no range and no melee -- barricades, bulwarks, spiked walls.
//                  They are obstacles, and obstacles do not take a turn.
//   melee          spear bunker: hits contact-range attackers and knocks them
//                  back half a tile.
//   projectile     everything in the archer line, plus the catapult.
//   burning rocks  fired SIMULTANEOUSLY with a fortified tower's arrow volley,
//                  covering the dead zone the arrows cannot reach.
export function stepTowers(world, combat, dt) {
  const board = world.board;

  const shooters = world.structures.towers();
  const keep = world.structures.theCastle();
  if (keep && keep.alive) shooters.push(keep);

  for (const tower of shooters) {
    const spec = tower.kind === 'castle' ? config.castle : config.towers[tower.type];

    if (tower.building > 0) { tower.building = Math.max(0, tower.building - dt); continue; }

    // Pure obstacles. TDD 6: the barricade deals zero damage and is a funnelling
    // tool, not an aggro sink.
    if (!spec.range && !spec.melee) continue;

    tower.cooldown -= dt;

    const muzzle = {
      id: 't' + tower.id,
      x: tower.x, z: tower.z,                       // footprint centre
      y: muzzleHeight(board, tower.i, tower.j)
    };

    // ---- spear bunker: contact range, knocks the approach apart ----
    if (spec.melee) {
      if (tower.cooldown > 0) continue;
      let best = null, bestD = Infinity;
      for (const u of world.units) {
        if (!u.alive || u.state === 'boat') continue;
        const d = world.structures.edgeDistance(u.x, u.z, tower);
        if (d > spec.range || d >= bestD) continue;
        best = u; bestD = d;
      }
      if (!best) continue;
      tower.cooldown = spec.fireInterval;
      world.damageUnit(best, spec.damage, tower);
      // TDD 8: roughly half a tile, clamped at cliff edges (see separation.js).
      if (spec.knockback && best.alive) {
        world.separation.knockback(best, best.x - tower.x, best.z - tower.z, spec.knockback);
      }
      world.events.push({ type: 'spearThrust', structure: tower, unit: best });
      continue;
    }

    // ---- everything that shoots ----
    // TDD 9: drop a target that has moved behind a cliff or into the dead zone,
    // then re-acquire. Holding one that cannot be hit is what makes a tower look
    // broken.
    if (tower.target && (!tower.target.alive || !combat.canHit(muzzle, tower.target, spec))) {
      tower.target = null;
    }
    if (!tower.target) tower.target = combat.acquire(muzzle, spec);

    // The fortified line drops burning rocks on anything inside its dead zone,
    // and does it whether or not it has an arrow target -- that simultaneity is
    // the whole point of the upgrade (TDD 5).
    if (spec.burningRocks && tower.cooldown <= 0) {
      for (const u of world.units) {
        if (!u.alive || u.state === 'boat') continue;
        if (world.structures.edgeDistance(u.x, u.z, tower) > spec.burningRocks.radius) continue;
        world.damageUnit(u, spec.burningRocks.damage, tower);
        world.events.push({ type: 'burningRock', structure: tower, unit: u });
      }
    }

    if (!tower.target) continue;
    if (tower.cooldown > 0) continue;
    tower.cooldown = spec.fireInterval;

    // A volley is N projectiles in one tick, not a faster gun. TDD 5's "wide"
    // upgrade doubles this count and deliberately leaves the rhythm alone.
    for (let n = 0; n < (spec.arrowsPerVolley || 1); n++) {
      if (!tower.target.alive) break;
      combat.fire(muzzle, tower.target, spec.damage, spec.arrowSpeed, tower,
                  spec.trajectory, spec.splash);
    }
  }
}
