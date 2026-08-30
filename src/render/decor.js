// Hero TD -- static set dressing.
//
// The banner the raiders are pushing toward and stains left on the grass. All of
// it is scenery: it never moves, never takes damage, and is batched statically.

const BLOOD = [[4, 7], [5, 7], [4, 8]];

export function buildDecor(ctx) {
  const { THREE, P, board, kit, props, rand, SINK } = ctx;
  const { at, px, topY } = board;
  const { mat } = kit;

  function banner(x, y, z, color) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 5), mat(0x765b3d));
    pole.position.y = 0.36;
    g.add(pole);
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
    g.add(new THREE.Mesh(flagGeo, mat(color)));
    g.position.set(x, y, z);
    props.add(g);
  }

  banner(px(3.1), topY(3, 7) - SINK, px(7.1), P.accent);

  // Blood stains are intentionally omitted; enemy landing spots are communicated
  // by the incoming UI rather than permanent red marks on the terrain.
}
