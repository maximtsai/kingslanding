// Hero TD -- line of sight and elevation.
//
// TDD section 9, and the second of the two risks the build order says to retire
// before anything depends on them.
//
// There are two trajectories and they need two separate code paths:
//
//   ARCING   archer, fortified, catapult, hero, enemy archers. Parabolic, and
//            it clears terrain between shooter and target.
//   NEAR-FLAT ballista. Nearly straight. Blocked by terrain an arc would clear.
//
// The flat path is what makes the ballista a real choice rather than a stat
// block: a ballista on tier 1 firing at tier 3 is stopped by the cliff face an
// archer would simply lob over, so it wants high ground and open water. No tower
// in the game uses it yet -- the ballista is a P4 upgrade -- but the TDD is
// explicit that this gets decided at implementation time rather than bolted on
// afterwards, and it is tested here on that basis.
//
// THE ONE RULE THAT MATTERS: the curve LOS tests must be the same curve the
// projectile actually flies. If the two drift apart, arrows visibly clip through
// cliffs that LOS swore were clear, and the player learns not to trust the game.
// Both come from `arcY`/`apexFor` below, and neither has its own copy.

import { config } from '../config.js';

const L = config.los;

// Ground height under a continuous point, in world units. Tiles are large and
// flat-topped, so nearest-tile sampling is exactly right here -- interpolating
// between tile centres would invent ramps that the terrain mesh does not have.
export function heightAt(board, x, z) {
  return board.topY(Math.round(x), Math.round(z));
}

export const muzzleHeight = (board, i, j) => board.topY(i, j) + L.MUZZLE_HEIGHT;
export const targetHeight = (board, x, z) => heightAt(board, x, z) + L.TARGET_HEIGHT;

// Apex of the arc, in world units. Scales with span so a short lob and a long
// one read as the same weapon rather than the short one going nearly vertical.
export function apexFor(fromY, toY, span) {
  return Math.max(fromY, toY) + L.ARC_APEX_BASE + span * L.ARC_APEX_PER_TILE;
}

// Quadratic Bezier through fromY at t=0 and toY at t=1, peaking at apexY.
// Solving (y0 + 2C + y1)/4 = apex for the control point gives C below.
export function arcY(fromY, toY, apexY, t) {
  const control = (4 * apexY - fromY - toY) / 2;
  const u = 1 - t;
  return u * u * fromY + 2 * u * t * control + t * t * toY;
}

// Near-flat path: a straight line with just enough lift to read as a projectile
// rather than a laser. FLAT_ARC_LIFT is deliberately small -- large enough to
// see, far too small to clear a tier.
export function flatY(fromY, toY, t) {
  return fromY + (toY - fromY) * t + L.FLAT_ARC_LIFT * Math.sin(Math.PI * t);
}

export function hasArcLOS(board, from, to) {
  const span = Math.hypot(to.x - from.x, to.z - from.z);
  const apex = apexFor(from.y, to.y, span);
  for (let i = 1; i < L.ARC_SAMPLES; i++) {
    const t = i / L.ARC_SAMPLES;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (arcY(from.y, to.y, apex, t) < heightAt(board, x, z) + L.EPSILON) return false;
  }
  return true;
}

export function hasFlatLOS(board, from, to) {
  for (let i = 1; i < L.FLAT_SAMPLES; i++) {
    const t = i / L.FLAT_SAMPLES;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (flatY(from.y, to.y, t) < heightAt(board, x, z) + L.EPSILON) return false;
  }
  return true;
}

export function hasLOS(board, from, to, trajectory) {
  return trajectory === 'flat' ? hasFlatLOS(board, from, to) : hasArcLOS(board, from, to);
}

// TDD 9: height advantage cuts both ways. A shooter above its target reaches
// further; a shooter below reaches less far. A tower on tier 3 therefore
// outranges an enemy archer on tier 1 twice over, which is the pressure that
// makes the walk up from the ramp worth taking.
export function elevationBonus(board, fromX, fromZ, toX, toZ) {
  const difference = board.at(Math.round(fromX), Math.round(fromZ)) -
                     board.at(Math.round(toX), Math.round(toZ));
  const bonus = difference * L.RANGE_PER_TIER;
  return Math.max(-L.RANGE_CAP, Math.min(L.RANGE_CAP, bonus));
}

// TDD 9: "Do not run LOS per frame per shooter per target. Cache per (shooter,
// target) pair, invalidate when the target crosses a tile boundary."
//
// Terrain is static for the whole level and the shooter never moves for a tower,
// so the target's tile is the only thing that can change the answer. The hero
// does move, which is why his tile is part of the key too.
export function createLosCache() {
  const cache = new Map();
  let hits = 0, misses = 0;

  return {
    test(board, shooterId, from, targetId, to, trajectory) {
      const key = shooterId + '>' + targetId;
      const fi = Math.round(from.x), fj = Math.round(from.z);
      const ti = Math.round(to.x), tj = Math.round(to.z);
      const entry = cache.get(key);
      if (entry && entry.fi === fi && entry.fj === fj && entry.ti === ti && entry.tj === tj) {
        hits++;
        return entry.result;
      }
      misses++;
      const result = hasLOS(board, from, to, trajectory);
      cache.set(key, { fi, fj, ti, tj, result });
      return result;
    },
    // Entries are keyed by ids that are never reused, so a cleared wave leaves
    // dead keys behind. Cheap to drop wholesale between waves.
    clear() { cache.clear(); },
    get stats() { return { size: cache.size, hits, misses }; }
  };
}
