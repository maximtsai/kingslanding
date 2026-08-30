// Hero TD -- separation, hard collision and knockback.
//
// TDD section 8. Units move freely in continuous space; the grid is a navigation
// and building substrate, not a movement constraint. What stops them occupying
// the same point is this file.
//
// Two radii, and the gap between them is the whole design:
//
//   pushRadius  small. Unit-vs-unit only, so a landing party packs densely and
//               reads as a mob rather than a queue.
//   hitRadius   large. Projectiles and melee, so shots connect reliably.
//
// Structures are hard collision, not soft push: a unit never overlaps a tower or
// a house, however hard the crowd behind it shoves.

import { config } from '../config.js';

const S = config.separation;

export function createSeparation(board, structures) {

  // A position is only legal if a walker could stand on it. Separation can
  // otherwise shove a unit off a cliff or into the sea, which no amount of
  // pathing would have allowed -- so every push is provisional until this agrees.
  //
  // NOT simply `isLand` of the rounded tile. A unit halfway across a diagonal is
  // over a shoulder tile it could never stand in the middle of, and rounding
  // says no; it would then be shoved back onto the tile it came from every
  // frame, which is a deadlock and was one. board.isWalkable knows about the
  // crossing corridor, and is the same predicate groundYAt uses to decide how
  // high the ground is there.
  function legal(x, z) {
    return board.isWalkable(x, z);
  }

  // TDD 8: "for each overlapping pair, push both along the connecting axis by
  // half the overlap. Two iterations per frame is enough at 40 units."
  //
  // O(n^2) at n <= 40 is 780 pairs a pass. A spatial hash would be free to write
  // and would buy nothing measurable, so it is deliberately absent.
  function separate(units) {
    for (let pass = 0; pass < S.ITERATIONS; pass++) {
      for (let a = 0; a < units.length; a++) {
        const A = units[a];
        if (!A.alive || A.state === 'boat') continue;
        for (let b = a + 1; b < units.length; b++) {
          const B = units[b];
          if (!B.alive || B.state === 'boat') continue;

          let dx = B.x - A.x, dz = B.z - A.z;
          const minimum = A.pushRadius + B.pushRadius;
          let distance2 = dx * dx + dz * dz;
          if (distance2 >= minimum * minimum) continue;

          let distance = Math.sqrt(distance2);
          if (distance < 1e-6) {
            // Exactly coincident: pick a deterministic direction from their ids
            // rather than a random one, so a replay stays a replay.
            const angle = (A.id * 2.399963) % (Math.PI * 2);
            dx = Math.cos(angle); dz = Math.sin(angle);
            distance = 1;
          }
          const shove = (minimum - distance) / 2;
          const nx = (dx / distance) * shove, nz = (dz / distance) * shove;

          // Provisional: a push that would put a unit somewhere it could never
          // have walked is simply not taken.
          if (legal(A.x - nx, A.z - nz)) { A.x -= nx; A.z -= nz; }
          if (legal(B.x + nx, B.z + nz)) { B.x += nx; B.z += nz; }
        }
      }
    }
  }

  // Structures are solid. Treated as an axis-aligned square of half-extent 0.5
  // in tile space, grown by the unit's push radius, and resolved along whichever
  // axis is least penetrated -- which is what makes a unit slide along a wall
  // instead of sticking to it.
  function pushOutOfStructures(u) {
    const i = Math.round(u.x), j = Math.round(u.z);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const s = structures.at(i + di, j + dj);
        if (!s || !s.alive) continue;
        const half = 0.5 + u.pushRadius + S.STRUCTURE_CLEARANCE;
        const dx = u.x - s.i, dz = u.z - s.j;
        const overlapX = half - Math.abs(dx);
        const overlapZ = half - Math.abs(dz);
        if (overlapX <= 0 || overlapZ <= 0) continue;
        if (overlapX < overlapZ) u.x += (dx >= 0 ? 1 : -1) * overlapX;
        else u.z += (dz >= 0 ? 1 : -1) * overlapZ;
      }
    }
  }

  // The king can pass through Archer Towers so he never gets snagged by his own
  // firing line. Other tower types still block him, but their hero-only footprint
  // is narrower than the visual model; enemy collision remains unchanged above.
  function resolveHero(hero) {
    const i = Math.round(hero.x), j = Math.round(hero.z);
    const seen = new Set();
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const s = structures.at(i + di, j + dj);
        if (!s || !s.alive || seen.has(s.id)) continue;
        seen.add(s.id);
        if (s.kind !== 'tower' || s.type === 'archer' || s.type === 'barricade') continue;
        const half = config.hero.towerHitboxHalfExtent;
        const dx = hero.x - s.x, dz = hero.z - s.z;
        const overlapX = half - Math.abs(dx);
        const overlapZ = half - Math.abs(dz);
        if (overlapX <= 0 || overlapZ <= 0) continue;
        if (overlapX < overlapZ) hero.x += (dx >= 0 ? 1 : -1) * overlapX;
        else hero.z += (dz >= 0 ? 1 : -1) * overlapZ;
      }
    }
  }

  // TDD 8: a Spear Bunker hit pushes an enemy back roughly half a tile. The
  // bunker itself is a P4 tower; the mechanic lives here now because the cliff
  // rule below is the part that needed deciding, not the arithmetic.
  //
  // RESOLVED, as the TDD's own default: CLAMP at the edge. The unit is marched
  // outward in small steps and stops at the last legal footing, so knockback can
  // pin something against a cliff but never throws it off one. Falling would be
  // more fun and would rhyme with the hero's jump-down, but it needs a fall
  // damage path that does not exist -- and half of one is worse than neither.
  function knockback(u, dirX, dirZ, distance) {
    const length = Math.hypot(dirX, dirZ);
    if (length < 1e-6) return 0;
    const ux = dirX / length, uz = dirZ / length;

    let travelled = 0;
    let x = u.x, z = u.z;
    while (travelled < distance) {
      const stride = Math.min(S.KNOCKBACK_STEP, distance - travelled);
      const nx = x + ux * stride, nz = z + uz * stride;
      if (!legal(nx, nz)) break;                    // clamp at the edge
      if (structures.at(Math.round(nx), Math.round(nz))) break;   // and at walls
      x = nx; z = nz;
      travelled += stride;
    }
    u.x = x; u.z = z;
    return travelled;
  }

  // Nearest legal tile centre, searched outward. Only ever used to rescue a unit
  // that has ended up somewhere it could not have walked to.
  function nearestLand(x, z) {
    const ci = Math.round(x), cj = Math.round(z);
    for (let radius = 1; radius <= board.N; radius++) {
      let best = null, bestD = Infinity;
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== radius) continue;
          const i = ci + di, j = cj + dj;
          if (!board.isLand(i, j) || structures.at(i, j)) continue;
          const d = Math.hypot(i - x, j - z);
          if (d < bestD) { bestD = d; best = [i, j]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Run after everything has moved, before positions are read for rendering.
  function resolve(units) {
    separate(units);
    for (const u of units) {
      if (!u.alive || u.state === 'boat') continue;
      pushOutOfStructures(u);
      // Final guarantee: whatever the passes above did, a unit ends the frame on
      // ground it could legally stand on.
      if (legal(u.x, u.z)) { u.safeX = u.x; u.safeZ = u.z; continue; }

      // SLIDE BEFORE REVERTING. Taking back the whole move is what turns "this
      // step was illegal" into "this unit never moves again": it is put back
      // exactly where it was, decides on the same illegal step next frame, and
      // repeats forever -- alive, unreachable, holding the wave open. Keeping
      // whichever axis of the move was legal lets it graze along the shoreline
      // instead, which is both the right behaviour and an escape.
      //
      // TDD 6: never allow a state where a unit has no valid action.
      if (legal(u.x, u.safeZ)) { u.z = u.safeZ; u.safeX = u.x; continue; }
      if (legal(u.safeX, u.z)) { u.x = u.safeX; u.safeZ = u.z; continue; }

      if (legal(u.safeX, u.safeZ)) { u.x = u.safeX; u.z = u.safeZ; continue; }
      // Last resort. If even the remembered position is off the island, the unit
      // was never legally placed to begin with -- snap it to the nearest land
      // tile rather than leaving it stranded at sea, alive and unreachable,
      // where it would hold the wave open forever.
      const rescue = nearestLand(u.x, u.z);
      if (rescue) { u.x = rescue[0]; u.z = rescue[1]; u.safeX = u.x; u.safeZ = u.z; }
    }
  }

  return { resolve, resolveHero, separate, knockback, legal };
}
