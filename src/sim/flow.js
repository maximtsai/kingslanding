// Hero TD -- flow fields.
//
// TDD section 8: with a 10x10 grid and 40 units, one tiny Dijkstra field per target
// beats per-unit A* by a wide margin, and it solves freeform movement cleanly --
// a unit samples a direction at any continuous position rather than chasing a
// chain of waypoints.
//
// A full field over 100 tiles costs essentially nothing, so the only thing worth
// being careful about is *when* they are rebuilt. They are cached per target and
// dropped wholesale whenever the passable set changes, which happens only when a
// structure is built or destroyed. Both are rare.

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

// `canStep` defaults to ground rules. The hero passes his own in, because TDD 3
// gives him one extra edge nothing else has: he may drop off any cliff, any
// number of tiers, downward only. That single asymmetry is most of what makes
// him read as a king rather than a mobile archer tower, and it is expressed here
// rather than as a special case inside the mover.
export function createFlow(board, isBlocked, canStep) {
  const N = board.N;
  const step = canStep || board.canStep;
  const cache = new Map();
  let generation = 0;

  // Passability for a *ground* unit. Every elevation change is a cliff; the only
  // edges between tiers are ramps (board.canStep). On top of that, structures are
  // solid -- except the goal itself, which units must be able to reach the edge
  // of in order to attack it.
  // `ignoreStructures` is the terrain-only fallback of TDD 8: when no route to
  // the castle exists with player buildings treated as solid, plan again over
  // terrain and ramps alone. This is PLANNING ONLY -- those buildings stay
  // physically solid, so the unit walks up to the first one in its way and
  // attacks it, opening the route instead of stalling or ghosting through it.
  function passable(i, j, goalKey, ignoreStructures) {
    if (!board.isLand(i, j)) return false;
    if (ignoreStructures) return true;
    const blocker = isBlocked(i, j);
    return !blocker || (goalKey !== undefined && blocker === goalKey);
  }

  // Dijkstra outward from the goal tiles. Concave fillets add a diagonal edge,
  // priced at sqrt(2), while cardinal steps cost 1. The board is only 100 tiles,
  // so a simple minimum scan is clearer and plenty fast.
  function build(goals, goalKey, ignoreStructures) {
    const dist = new Float64Array(N * N).fill(Infinity);
    const visited = new Uint8Array(N * N);
    for (const [gi, gj] of goals) {
      if (gi < 0 || gj < 0 || gi >= N || gj >= N || !board.isLand(gi, gj)) continue;
      dist[gj * N + gi] = 0;
    }
    for (let count = 0; count < N * N; count++) {
      let current = -1, currentD = Infinity;
      for (let k = 0; k < dist.length; k++) {
        if (!visited[k] && dist[k] < currentD) { current = k; currentD = dist[k]; }
      }
      if (current < 0) break;
      visited[current] = 1;
      const i = current % N, j = Math.floor(current / N);
      for (const [di, dj] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        // The search grows outward from the goal, but a unit travels inward toward
        // it: setting dist[ni,nj] = d asserts that a unit standing on ni,nj can
        // reach the goal by stepping to i,j. So the edge must be tested in that
        // direction, not this loop's.
        //
        // Ramps are symmetric and hid this for a long time. The hero's cliff
        // drop is not symmetric, and testing it backwards silently disabled the
        // single rule that defines how he moves.
        if (!step(ni, nj, i, j)) continue;
        if (!passable(ni, nj, goalKey, ignoreStructures)) continue;
        const nextD = currentD + Math.hypot(di, dj);
        if (nextD < dist[nj * N + ni]) dist[nj * N + ni] = nextD;
      }
    }
    return {
      generation,
      get: (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? Infinity : dist[j * N + i],
      // Steepest descent from a tile. Returns null at the goal or in a pocket.
      next(i, j, preferredX, preferredZ) {
        const here = this.get(i, j);
        if (!isFinite(here) || here === 0) return null;
        let best = null, bestD = here, bestHeading = -Infinity;
        for (const [di, dj] of DIRS) {
          const ni = i + di, nj = j + dj;
          if (!step(i, j, ni, nj)) continue;
          if (!passable(ni, nj, goalKey, ignoreStructures)) continue;
          const d = this.get(ni, nj) + Math.hypot(di, dj);
          const length = Math.hypot(di, dj);
          const heading = preferredX === undefined ? 0 :
            (di * preferredX + dj * preferredZ) / length;
          if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && heading > bestHeading)) {
            bestD = d; bestHeading = heading; best = [ni, nj];
          }
        }
        return best;
      }
    };
  }

  return {
    // Keyed by anything hashable. `goalKey` names the structure allowed to be
    // stood on, so a field toward a tower treats that tower's tile as reachable
    // and every other structure as solid.
    field(key, goals, goalKey, ignoreStructures) {
      const hit = cache.get(key);
      if (hit && hit.generation === generation) return hit;
      const made = build(goals, goalKey, ignoreStructures);
      cache.set(key, made);
      return made;
    },

    // TDD 8, the two passes in the order the spec gives them. Returns whichever
    // field can actually reach this unit: the primary one if a route exists with
    // player buildings solid, otherwise the terrain-only fallback for when the
    // player has walled every approach.
    routeTo(structure, fromI, fromJ) {
      const span = structure.span || 1;
      const goals = [];
      for (let dj = 0; dj < span; dj++) {
        for (let di = 0; di < span; di++) goals.push([structure.i + di, structure.j + dj]);
      }
      const primary = this.field('goal:' + structure.id, goals, structure);
      if (isFinite(primary.get(fromI, fromJ))) return primary;
      return this.field('open:' + structure.id, goals, structure, true);
    },

    // One-off, uncached: used for "which structure is nearest by path distance",
    // which is asked once per enemy on landing and again when a target dies.
    // TDD 10 specifies nearest by *path* distance, not by straight line -- a
    // tower across a cliff is far away even when it looks close.
    nearest(fromI, fromJ, candidates) {
      if (!candidates.length) return null;
      const goals = candidates.map(c => [c.i, c.j]);
      // Seed from every candidate at once: one weighted search answers "which is
      // closest" without building a separate field per candidate.
      const dist = new Float64Array(N * N).fill(Infinity);
      const visited = new Uint8Array(N * N);
      const owner = new Array(N * N).fill(null);
      candidates.forEach((c, index) => {
        const k = goals[index][1] * N + goals[index][0];
        if (!board.isLand(c.i, c.j)) return;
        dist[k] = 0; owner[k] = c;
      });
      for (let count = 0; count < N * N; count++) {
        let k = -1, currentD = Infinity;
        for (let n = 0; n < dist.length; n++) {
          if (!visited[n] && dist[n] < currentD) { k = n; currentD = dist[n]; }
        }
        if (k < 0) break;
        visited[k] = 1;
        const i = k % N, j = Math.floor(k / N);
        if (i === fromI && j === fromJ) return owner[k];
        for (const [di, dj] of DIRS) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = nj * N + ni;
          // Expansion runs outward from the goal, so the edge must be tested in
          // the direction a unit would really walk it: from the new tile back
          // toward this one. Ramps are symmetric today, but a one-way edge (a
          // hero cliff-drop) is not, and testing the wrong way round would let a
          // unit path up a drop it can only go down.
          if (!step(ni, nj, i, j)) continue;
          if (!board.isLand(ni, nj)) continue;
          // Other structures are solid, so a route may not pass through them.
          if (isBlocked(ni, nj) && !(ni === fromI && nj === fromJ)) continue;
          const nextD = currentD + Math.hypot(di, dj);
          if (nextD < dist[nk]) { dist[nk] = nextD; owner[nk] = owner[k]; }
        }
      }
      const direct = dist[fromJ * N + fromI];
      if (isFinite(direct)) return owner[fromJ * N + fromI];
      // TDD 7: never allow a state where a unit has no valid action. If nothing
      // is reachable, fall back to the nearest by straight line and let the unit
      // chew through whatever is in the way.
      let best = null, bestD = Infinity;
      for (const c of candidates) {
        const d = Math.hypot(c.i - fromI, c.j - fromJ);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    },

    // Called whenever the passable set changes. Cheap: the fields are rebuilt
    // lazily on next use, not here.
    invalidate() { generation++; },
    get generation() { return generation; }
  };
}
