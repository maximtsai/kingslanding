// Hero TD -- the board.
//
// The integer height grid, the geometry helpers every other system derives its
// positions from, and passability. This is the single source of truth about
// where things are: the renderer asks it for surface heights, the simulation
// asks it what connects to what, and neither recomputes index maths locally.
//
// Grown out of the diorama's createBoard, which only ever needed the geometry
// half. Ramps, passability and validation are the simulation half.

import { landingTable } from './landing.js';
import {
  STAIR_TREAD_STARTS, STAIR_END, stairHeightAt, stairSurfaceY
} from '../stairs.js';

// A level needs somewhere for a wave to come ashore. Not much -- boats share
// tiles happily (TDD 11) -- but a board whose entire waterline is cliff has no
// landing at all, and every boat on it would fall through to the authored
// fallback forever. See validate().
const MIN_BEACH_TILES = 4;

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

export function createBoard(level, metrics) {
  const { TILE, TIER, CAP, DROP, CORNER_PATH_HALF_WIDTH = 0.1 } = metrics;
  const MAP = level.heights;
  const N = MAP.length;
  const h = MAP.map(row => row.slice());

  // Out of bounds reads as water, so edge cases at the island's rim need no
  // special-casing anywhere downstream.
  const at = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : h[j][i];

  // ---- ramps ----
  // Keyed both ways: passability asks "can I step from a to b" without caring
  // which end is uphill.
  const rampLinks = new Map();
  const ramps = [];
  const rampTiles = new Set();
  const key = (i, j) => i + ':' + j;
  const linkKey = (ai, aj, bi, bj) => key(ai, aj) + '>' + key(bi, bj);

  for (const [[li, lj], [hi, hj]] of level.ramps) {
    const step = Math.abs(li - hi) + Math.abs(lj - hj);
    const rise = at(hi, hj) - at(li, lj);
    // TDD 3: fail loudly. A bad ramp is a data error, and finding it at load
    // costs seconds where finding it through pathing bugs costs hours.
    if (step !== 1) {
      throw new Error(`ramp [${li},${lj}]->[${hi},${hj}] is not orthogonally adjacent`);
    }
    if (rise !== 1) {
      throw new Error(`ramp [${li},${lj}]->[${hi},${hj}] spans ${rise} tiers, must be exactly 1`);
    }
    const ramp = { li, lj, hi, hj };
    ramps.push(ramp);
    rampLinks.set(linkKey(li, lj, hi, hj), ramp);
    rampLinks.set(linkKey(hi, hj, li, lj), ramp);
    rampTiles.add(key(li, lj));
    rampTiles.add(key(hi, hj));
  }

  const isLand = (i, j) => at(i, j) > 0;
  const isRamp = (i, j) => rampTiles.has(key(i, j));
  const rampBetween = (ai, aj, bi, bj) => rampLinks.get(linkKey(ai, aj, bi, bj)) || null;

  // Two land tiles of the SAME height that touch at a corner can always be
  // walked between. Nothing about the shoulders matters.
  //
  // Earlier versions gated this on them -- a cliff on both sides blocked the
  // crossing, and later a water shoulder blocked it outright. Both were wrong,
  // and for the same reason: the shoulders describe what is *beside* the route,
  // not whether the route exists. A player looking at two touching pieces of
  // ground at the same level expects to walk between them, and does not care
  // that the outside of the bend is sea or that the inside is a cliff.
  //
  // The water shoulder was blocked because a crossing over one deadlocked --
  // separation would not let a unit stand near the corner, so it stepped on and
  // was shoved back forever. That was never this predicate's fault. It is fixed
  // where it belongs: `isWalkable` below now recognises the crossing corridor,
  // so the corner is somewhere a unit may legitimately be.
  function isDiagonalStep(ai, aj, bi, bj) {
    if (Math.abs(ai - bi) !== 1 || Math.abs(aj - bj) !== 1) return false;
    const height = at(ai, aj);
    return !!height && at(bi, bj) === height;
  }

  const cornerLinks = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    for (const [di, dj] of [[1, 1], [1, -1]]) {
      if (isDiagonalStep(i, j, i + di, j + dj)) {
        cornerLinks.push({ ai: i, aj: j, bi: i + di, bj: j + dj, height: at(i, j) });
      }
    }
  }

  // Ground traversal. Every elevation change is a cliff (TDD 3); the only way
  // between tiers is a declared ramp. Same-tier concave fillets add one narrow
  // diagonal edge through an otherwise orthogonal grid.
  // The hero's downward cliff jump is deliberately not modelled here -- it is a
  // hero-only affordance and belongs to HeroController (P1), not to the board.
  function canStep(ai, aj, bi, bj) {
    if (!isLand(ai, aj) || !isLand(bi, bj)) return false;
    const di = Math.abs(ai - bi), dj = Math.abs(aj - bj);
    if (di === 1 && dj === 1) return isDiagonalStep(ai, aj, bi, bj);
    if (di + dj !== 1) return false;
    const da = at(ai, aj), db = at(bi, bj);
    if (da === db) return true;
    return rampLinks.has(linkKey(ai, aj, bi, bj));
  }

  function neighbours(i, j) {
    const out = [];
    for (const [di, dj] of DIRS) {
      if (canStep(i, j, i + di, j + dj)) out.push([i + di, j + dj]);
    }
    return out;
  }

  // The rendered stair flight rises across the low tile and meets the upper
  // terrace at the shared edge. Sampling rounded tile heights makes walkers sink
  // into that flight, then pop up a full tier at the edge; the shared stepped
  // profile keeps their feet aligned with the rendered treads throughout.
  // The diagonal crossing a continuous position is on, if any.
  //
  // A corner crossing runs between two tile centres, and the middle of that line
  // passes through the SHOULDER tiles -- which may be a tier lower, or open sea.
  // Sampling the rounded tile there is what made walkers drop a level halfway
  // across, so both the height and the legality of a position have to know about
  // the corridor. One function, two callers, no chance of them disagreeing.
  function cornerAt(x, z) {
    for (const link of cornerLinks) {
      const dx = link.bi - link.ai, dz = link.bj - link.aj;
      const along = ((x - link.ai) * dx + (z - link.aj) * dz) / 2;
      if (along < 0 || along > 1) continue;
      const across = Math.abs((x - link.ai) * dz - (z - link.aj) * dx) / Math.SQRT2;
      if (across > CORNER_PATH_HALF_WIDTH) continue;
      return link;
    }
    return null;
  }

  // Somewhere a walker may stand: land under the rounded tile, or the corridor
  // of a diagonal crossing. Separation asks this rather than isLand, because a
  // unit halfway across a corner is legitimately over a tile it could not stand
  // in the middle of.
  function isWalkable(x, z) {
    return isLand(Math.round(x), Math.round(z)) || !!cornerAt(x, z);
  }

  // Somewhere a walker ON A GIVEN TIER may stand. Strictly stronger than
  // isWalkable, which only asks whether there is ground -- and a cliff face is
  // ground. That is the gap the hero was falling through: he could walk into a
  // tier-2 tile, remain at tier-1 height (inside the cliff), and from then on
  // every question answered by rounding his position said he was standing a
  // tier above where he actually was.
  //
  // Ramps and diagonal crossings are the two places a walker is legitimately
  // over a tile that is not simply "his tier", so both are allowed explicitly.
  function canStandOn(x, z, tier) {
    const r = rampAt(x, z);
    if (r) return tier === at(r.ramp.li, r.ramp.lj) || tier === at(r.ramp.hi, r.ramp.hj);
    const link = cornerAt(x, z);
    if (link) {
      if (link.height !== tier) return false;
      // A crossing may pass OVER a lower shoulder -- that is what it is for, and
      // he is above the drop. It may not pass INTO a higher one, which is
      // standing inside rock. The corridor is 0.3 of a tile wide, so without
      // this he can be a third of a tile inside a cliff and still be told he is
      // fine.
      return at(Math.round(x), Math.round(z)) <= tier;
    }
    return at(Math.round(x), Math.round(z)) === tier;
  }

  // The ramp corridor a continuous position is inside, and how far up it, or
  // null. One implementation, used by both height paths below.
  function rampAt(x, z) {
    for (const ramp of ramps) {
      const dx = ramp.hi - ramp.li, dz = ramp.hj - ramp.lj;
      const along = (x - ramp.li) * dx + (z - ramp.lj) * dz;
      const across = Math.abs((x - ramp.li) * dz - (z - ramp.lj) * dx);
      if (along < STAIR_TREAD_STARTS[0] || along > STAIR_END || across > 0.5) continue;
      return {
        ramp,
        along,
        t: (along - STAIR_TREAD_STARTS[0]) / (STAIR_END - STAIR_TREAD_STARTS[0])
      };
    }
    return null;
  }

  const tierY = tier => tier * TIER - DROP + CAP;

  // Terrain height by sampling. Correct for anything that asks about a POINT --
  // where to drop an arrow, where to put a marker -- and deliberately NOT what
  // a walker uses; see walkElevation.
  function groundYAt(x, z) {
    const r = rampAt(x, z);
    if (r) {
      const lowY = tierY(at(r.ramp.li, r.ramp.lj));
      return stairSurfaceY(lowY, lowY + TIER, stairHeightAt(r.along));
    }
    const link = cornerAt(x, z);
    if (link) return tierY(link.height);
    return tierY(at(Math.round(x), Math.round(z)));
  }

  // Presentation height for a camera following a walker. The figure follows
  // individual treads, but making the camera follow those same height impulses
  // turns every riser into a bump. One smoothstep across the complete flight has
  // zero slope at both landings and leaves non-stair movement untouched.
  function stairCameraYAt(x, z) {
    const r = rampAt(x, z);
    if (!r) return null;
    const t = r.t * r.t * (3 - 2 * r.t);
    const lowY = tierY(at(r.ramp.li, r.ramp.lj));
    return lowY + TIER * t;
  }

  // ELEVATION FOR SOMETHING THAT WALKS.
  //
  // A walker does not read its height off the ground under it -- it REMEMBERS
  // which tier it is standing on, and that only changes when it climbs a ramp or
  // jumps off a cliff. Sampling was the bug: the height of a continuous position
  // comes from the tile it rounds to, and near a corner it rounds to a
  // neighbour. Stand on the corner of a plateau and the nearest tile centre is
  // the one below, so the figure drops a full tier while standing still, then
  // pops back when it shifts a few centimetres.
  //
  // Widening the crossing corridor helped where two tiles were formally linked
  // and did nothing at every other corner, because the problem was never which
  // corners are walkable -- it was asking the terrain a question the walker
  // already knew the answer to.
  //
  // Pure: the caller owns `tier` and `onRamp` and assigns what comes back.
  function walkElevation(x, z, tier, onRamp) {
    const r = rampAt(x, z);
    if (r) {
      const lowY = tierY(at(r.ramp.li, r.ramp.lj));
      return {
        y: stairSurfaceY(lowY, lowY + TIER, stairHeightAt(r.along, true)),
        tier, onRamp: true
      };
    }
    // Stepping off the top or bottom of a ramp is the moment the tier changes,
    // and the only moment it changes without a cliff jump.
    if (onRamp) {
      const height = at(Math.round(x), Math.round(z));
      if (height) tier = height;
    }
    return { y: tierY(tier), tier, onRamp: false };
  }

  // BFS step-distance to a set of goal tiles, over passable edges only.
  // Unreachable tiles stay Infinity. P0 uses this to walk units to an objective;
  // P1 generalises it into the per-structure flow fields of TDD 8. The shape of
  // the answer is the same, which is why it lives here already.
  function distanceField(goals) {
    const dist = new Float64Array(N * N).fill(Infinity);
    const queue = [];
    for (const [gi, gj] of goals) {
      if (!isLand(gi, gj)) continue;
      dist[gj * N + gi] = 0;
      queue.push([gi, gj]);
    }
    for (let head = 0; head < queue.length; head++) {
      const [i, j] = queue[head];
      const d = dist[j * N + i];
      for (const [ni, nj] of neighbours(i, j)) {
        if (dist[nj * N + ni] > d + 1) {
          dist[nj * N + ni] = d + 1;
          queue.push([ni, nj]);
        }
      }
    }
    return { dist, get: (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? Infinity : dist[j * N + i] };
  }

  // Every square of `span` tiles that the *terrain* would admit a castle onto:
  // all land, all one tier, no ramp, nothing reserved, no author-placed house.
  //
  // Deliberately not the same predicate as structures.canPlaceCastle, which also
  // asks about live occupants and reachable neighbours -- that is a runtime
  // question about a board mid-game. This is the load-time question of whether
  // the level admits a castle *at all*, and a level with no answer is unplayable
  // before the player has done anything.
  function flatSquares(span) {
    const blocked = new Set();
    for (const [i, j] of level.houses) blocked.add(key(i, j));
    for (const [i, j] of (level.reserved || [])) blocked.add(key(i, j));

    const sites = [];
    for (let j = 0; j + span <= N; j++) {
      for (let i = 0; i + span <= N; i++) {
        const height = at(i, j);
        if (!height) continue;
        let ok = true;
        for (let dj = 0; dj < span && ok; dj++) {
          for (let di = 0; di < span && ok; di++) {
            const ci = i + di, cj = j + dj;
            ok = at(ci, cj) === height && !isRamp(ci, cj) && !blocked.has(key(ci, cj));
          }
        }
        if (ok) sites.push([i, j]);
      }
    }
    return sites;
  }

  // TDD 3: fail loudly at load. Every check here exists because the failure it
  // catches is silent at runtime -- an unreachable house looks like a pathing
  // bug, a cliff on the waterline looks like a spawning bug, and an orphaned
  // islet looks like nothing at all until a tower is built on it.
  //
  // `spawnRadius` is where boats appear (config.waves.spawnRadius). It is passed
  // in rather than imported so the board keeps knowing nothing about the wave
  // system.
  function validate(spawnRadius = N) {
    const problems = [];
    const field = distanceField(level.shoreFallback);

    // The authored fallback has to be a beach, or the guarantee that a wave can
    // never fail to spawn is not a guarantee.
    for (const [si, sj] of level.shoreFallback) {
      if (at(si, sj) !== 1) {
        problems.push(`shoreFallback [${si},${sj}] is tier ${at(si, sj)}, must be tier 1 land`);
      }
    }

    for (const [hi, hj] of level.houses) {
      if (!isLand(hi, hj)) { problems.push(`house [${hi},${hj}] is not on land`); continue; }
      if (isRamp(hi, hj)) problems.push(`house [${hi},${hj}] sits on a ramp tile`);
      if (!isFinite(field.get(hi, hj))) problems.push(`house [${hi},${hj}] is unreachable from the shore`);
    }

    for (const [ri, rj] of (level.reserved || [])) {
      if (!isLand(ri, rj)) problems.push(`reserved [${ri},${rj}] is not on land`);
      else if (isRamp(ri, rj)) problems.push(`reserved [${ri},${rj}] sits on a ramp tile`);
    }

    // Orphaned land. A tile no landing party can walk to is a tile the player
    // can garrison for free, and nothing in the game would ever tell either of
    // us about it.
    const orphans = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (isLand(i, j) && !isFinite(field.get(i, j))) orphans.push(`[${i},${j}]`);
      }
    }
    if (orphans.length) {
      problems.push(`${orphans.length} land tile(s) unreachable from the shore: ${orphans.join(' ')}`);
    }

    // Somewhere to land. Tier-2 waterline is a legitimate authoring choice --
    // it is coastal cliff, and a boat simply never chooses it (see landing.js
    // and waves.js, which pick from the enumerated beaches rather than guessing
    // an angle and hoping). So this asks only that enough real beach exists for
    // the spawner to have something to choose from.
    const table = landingTable({ N, at, isLand }, spawnRadius);
    if (table.beaches.size < MIN_BEACH_TILES) {
      problems.push(
        `only ${table.beaches.size} tile(s) on this coast can be landed on ` +
        `(need ${MIN_BEACH_TILES}): the waterline is almost all cliff`
      );
    }

    if (!flatSquares(2).length) problems.push('no 2x2 flat site anywhere: the castle cannot be placed');

    if (problems.length) {
      throw new Error(`level "${level.id || level.name}" failed validation:\n  ` + problems.join('\n  '));
    }
    return true;
  }

  return {
    level, MAP, N, TILE, TIER, CAP, DROP,
    // The diorama builders read STAIRS off the board; ramps are the same data.
    STAIRS: level.ramps,
    MAX_H: Math.max(...h.flat()),
    FRAME: N * TILE,                                 // world span, drives camera framing
    at,
    px: i => (i - (N - 1) / 2) * TILE,               // centre of tile i, and continuous
    gridX: i => (i - N / 2) * TILE,                  // corner between tiles
    topY: (i, j) => at(i, j) * TIER - DROP + CAP,    // walkable surface of a tile
    isLand, isRamp, rampBetween, isDiagonalStep, groundYAt, stairCameraYAt,
    canStep, neighbours, distanceField,
    cornerAt, isWalkable, canStandOn, rampAt, tierY, walkElevation, flatSquares, validate
  };
}
