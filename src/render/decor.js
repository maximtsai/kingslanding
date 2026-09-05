// Hero TD -- static set dressing.
//
// The banner the raiders are pushing toward and stains left on the grass. All of
// it is scenery: it never moves, never takes damage.
//
// The banner must NOT go through the static batcher with the rest of the props:
// a batched mesh no longer exists as an object, and section 15's occlusion rule
// has to reach it. The king spends his early minutes beside this flag, so it is
// precisely the prop that ends up between the camera and him -- which is why it
// is built as standalone meshes in the static root and handed to the views as
// `scenery`, the same list the keep belongs to. structureView's occlusion pass
// then fades it exactly like a building that is hiding somebody: the pole and
// the cloth each fade out to the same floor as the keep's ghost when the king
// walks behind them.

export function buildDecor(ctx) {
  const { THREE, P, board, kit, scene, SINK } = ctx;
  const { at, px, topY } = board;
  const { mat } = kit;
  const scenery = [];

  function banner(x, y, z, color) {
    // Fadeable scenery cannot share the kit's cached materials: the occlusion
    // pass toggles transparent/opacity per mesh, and a shared material would
    // carry every other prop wearing this colour along with it.
    const poleMaterial = mat(0x765b3d).clone();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 5), poleMaterial);
    pole.position.set(x, y + 0.36, z);
    pole.geometry.computeBoundingBox();
    scene.add(pole);
    scenery.push(pole);

    // Cloth catching the wind rather than a flat card: the wave builds from the
    // hoist toward the fly and the free edge forks into a swallowtail. Emitted
    // with explicit back faces so the banner survives a full orbit and still
    // batches as FrontSide -- a DoubleSide material would cost its own draw call.
    const columns = 9, rows = 3, span = 0.4, height = 0.2;
    const grid = [];
    for (let row = 0; row < rows; row++) {
      const v = row / (rows - 1);
      grid.push([]);
      for (let column = 0; column < columns; column++) {
        const along = column / (columns - 1);
        const fork = Math.max(0, along - 0.74) / 0.26;
        const notch = fork * fork * 0.11 * (1 - Math.abs(v - 0.5) * 2);
        const wave = Math.sin(along * 5 - 1.2) * along * along * 0.055;
        grid[row].push([wave, 0.61 + height * (0.5 - v), 0.03 + along * span - notch]);
      }
    }
    const flagPositions = [];
    for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) {
      const a = grid[row][column], b = grid[row][column + 1];
      const d = grid[row + 1][column], c = grid[row + 1][column + 1];
      flagPositions.push(...a, ...d, ...c, ...a, ...c, ...b);
      flagPositions.push(...a, ...c, ...d, ...a, ...b, ...c);
    }
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(flagPositions, 3));
    flagGeo.computeVertexNormals();
    flagGeo.computeBoundingBox();
    const cloth = new THREE.Mesh(flagGeo, mat(color).clone());
    cloth.position.set(x, y, z);
    scene.add(cloth);
    scenery.push(cloth);
  }

  banner(px(3.1), topY(3, 7) - SINK, px(7.1), P.accent);

  return scenery;

  // Blood stains are intentionally omitted; enemy landing spots are communicated
  // by the incoming UI rather than permanent red marks on the terrain.
}
