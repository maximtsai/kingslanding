// Island diorama -- the level.
//
// Height per tile, 0 = open water. The board is square and its size is read back
// off the array, so swapping in a different map is the only edit a resize needs:
// N, the world-space tile helpers and the camera framing all follow from it.
(function () {
  const D = window.Diorama || (window.Diorama = {});

  D.MAP = [
    [0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 1, 1, 2, 2, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 3, 2, 1, 1, 0],
    [0, 1, 2, 2, 3, 3, 3, 2, 1, 0],
    [1, 1, 2, 3, 3, 3, 2, 2, 1, 1],
    [1, 2, 2, 2, 3, 2, 2, 1, 1, 1],
    [0, 1, 1, 2, 2, 2, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 0, 0, 0, 0]
  ];

  // Each entry is [[lowI, lowJ], [highI, highJ]]. The two tiles must be
  // orthogonally adjacent with exactly one tier of rise between them.
  D.STAIRS = [
    [[4, 7], [4, 6]],
    [[2, 6], [2, 5]],
    [[3, 5], [3, 4]],
    [[6, 4], [6, 3]]
  ];

  // TIER is the rise per height step, CAP the thin grass lip that overhangs each
  // cliff, DROP how far the whole island sits below the waterline datum.
  D.metrics = { TILE: 1, TIER: 0.6, CAP: 0.08, DROP: 0.55 };

  // Everything downstream asks the board for geometry rather than recomputing
  // index maths, which is what keeps the map size in exactly one place.
  D.createBoard = function (map, metrics) {
    const MAP = map || D.MAP;
    const { TILE, TIER, CAP, DROP } = metrics || D.metrics;
    const h = MAP.map(row => row.slice());
    const N = MAP.length;

    const at = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : h[j][i];
    return {
      MAP, STAIRS: D.STAIRS, N, TILE, TIER, CAP, DROP,
      MAX_H: Math.max(...h.flat()),
      FRAME: N * TILE,                              // world span, drives framing
      at,
      px: i => (i - (N - 1) / 2) * TILE,            // centre of tile i
      gridX: i => (i - N / 2) * TILE,               // corner between tiles
      topY: (i, j) => at(i, j) * TIER - DROP + CAP  // walkable surface of a tile
    };
  };
})();
