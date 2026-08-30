// Hero TD -- tile picking.
//
// TDD 17: after the static batcher runs, the ground is one non-indexed buffer
// with no per-tile identity, so a raycast hit against it tells you nothing about
// which tile was hit. Picking is therefore analytic: march the camera ray
// against the integer height grid and report the first tile whose surface it
// crosses. This is cheaper than a raycast as well as being the only thing that
// actually works.
//
// The camera is orthographic, so every screen point maps to a parallel ray --
// there is no perspective divide to undo.

import { config } from '../config.js';

export function createPicker(THREE, board, camera) {
  const ndc = new THREE.Vector2();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();

  // Marching step. Fine enough that a 0.6-high tier is never stepped over, and
  // coarse enough that a full traverse is a few hundred iterations.
  const STEP = 0.04;
  const MAX_DISTANCE = 140;

  // Screen point -> { i, j, x, z } in tile-index space, or null for a miss.
  // `x`/`z` are the continuous hit point, so the hero stops exactly where the
  // player tapped rather than snapping to the tile centre.
  return function pick(clientX, clientY, rect) {
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    origin.set(ndc.x, ndc.y, -1).unproject(camera);
    camera.getWorldDirection(direction);

    // Convert world x/z back to continuous tile indices. px(i) = (i-(N-1)/2)*TILE
    const half = (board.N - 1) / 2;
    const toTile = v => v / board.TILE + half;

    for (let travelled = 0; travelled < MAX_DISTANCE; travelled += STEP) {
      const wx = origin.x + direction.x * travelled;
      const wy = origin.y + direction.y * travelled;
      const wz = origin.z + direction.z * travelled;

      const x = toTile(wx), z = toTile(wz);
      const i = Math.round(x), j = Math.round(z);
      if (i < 0 || j < 0 || i >= board.N || j >= board.N) continue;
      if (!board.isLand(i, j)) continue;

      // topY is the walkable surface; SINK is where props are seated on it.
      if (wy <= board.topY(i, j) - config.board.SINK) {
        return { i, j, x, z };
      }
    }
    return null;
  };
}
