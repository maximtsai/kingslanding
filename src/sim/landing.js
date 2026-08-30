// Hero TD -- where a boat comes ashore.
//
// TDD 11: every boat steers at the exact centre of the map, so the landing point
// is simply where that ray first meets land. That makes the whole approach
// solvable at spawn time instead of something to steer around during it.
//
// This lives on its own rather than inside waves.js because two callers need the
// *same* answer. waves.js asks it at spawn time; board.validate() asks it for
// every angle on the circle at load time, to catch a level whose waterline is a
// cliff face. A second implementation of the ray would let a level pass
// validation and still misbehave at runtime, which is the exact failure the
// check exists to prevent -- so `march` below is the only place the ray is
// walked, and both callers are thin wrappers around it.

// Angle convention, matching the spawn maths below: x is +i (east) and z is +j,
// which is the bottom of the height array as written. So angle 0 approaches from
// the south, and the compass runs clockwise through east at +PI/2.
export const SECTORS = {
  S: 0,
  SE: Math.PI / 4,
  E: Math.PI / 2,
  NE: Math.PI * 0.75,
  N: Math.PI,
  NW: -Math.PI * 0.75,
  W: -Math.PI / 2,
  SW: -Math.PI / 4
};

// Half-width of an authored sector. Narrower than the 45 degrees separating two
// compass points, so a "north" and a "north-east" landing cannot resolve onto
// the same stretch of beach.
export const SECTOR_HALF = Math.PI / 5;

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// March from a spawn point toward the centre until the tile underfoot is land.
// Reports the first land tile whatever its tier, plus the last water point --
// which is where the hull stops. Null only if the ray misses the island entirely.
export function march(board, angle, radius) {
  const centre = (board.N - 1) / 2;
  const sx = centre + Math.sin(angle) * radius;
  const sz = centre + Math.cos(angle) * radius;
  const dx = centre - sx, dz = centre - sz;
  const span = Math.hypot(dx, dz) || 1;
  const ux = dx / span, uz = dz / span;

  let lastWater = null;
  for (let travelled = 0; travelled <= span; travelled += 0.1) {
    const x = sx + ux * travelled, z = sz + uz * travelled;
    const i = Math.round(x), j = Math.round(z);
    if (board.isLand(i, j)) {
      return { sx, sz, ux, uz, angle, land: [i, j], tier: board.at(i, j), stop: lastWater || { x, z } };
    }
    lastWater = { x, z };
  }
  return null;
}

// The spawn-time question: is this a landing a boat may actually unload onto?
// TDD 11 rejects anything above tier 1 -- a cliff face is not a beach.
export function resolveLanding(board, angle, radius) {
  const hit = march(board, angle, radius);
  return hit && hit.tier === 1 ? hit : null;
}

// EVERY landing this board admits, resolved once.
//
// The spawner used to guess: pick a random angle, march it, and if the ray ended
// at a cliff throw it away and guess again, up to a bounded number of tries
// before giving up on the authored fallback. That works when almost the whole
// coast is beach and degrades exactly when it should not -- a level with a lot
// of tier-2 waterline is one where guessing is least likely to land, and it is
// also the level whose few real beaches matter most.
//
// A cliff coast is a legitimate thing to author. It reads as shoreline a boat
// cannot get up, and the spawner's job is simply never to choose it. So the
// choices are enumerated instead of sampled: every angle that resolves to a real
// beach, computed once per level, and the spawner picks from that list. It
// cannot pick a cliff because a cliff is not in it, and it cannot run out of
// tries because there is nothing to retry.
export function landingTable(board, radius, samples = 360) {
  const options = [];
  const beaches = new Set();
  for (let k = 0; k < samples; k++) {
    const angle = -Math.PI + (k / samples) * Math.PI * 2;
    const hit = resolveLanding(board, angle, radius);
    if (!hit) continue;
    options.push(hit);
    beaches.add(hit.land[0] + ':' + hit.land[1]);
  }
  return { options, beaches, samples };
}
