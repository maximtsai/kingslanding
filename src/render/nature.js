// Island diorama -- what grows on it.
//
// Groves, hedgerow scrub and a wildflower scatter. Runs after the structures so
// it can skip any tile they have already claimed.


// [centre i, centre j, radius in tiles]
const GROVES = [[2.2, 2.2, 1.5], [7.2, 2.6, 1.4], [2.0, 6.2, 1.5], [7.0, 6.5, 1.4]];
const TREES_PER_GROVE = 10;
const BUSHES_PER_GROVE = 16;
const LOOSE_SCRUB = 26;
const FLOWER_ATTEMPTS = 260;

export function buildNature(ctx) {
  const { THREE, board, kit, soft, props, rand, used, K, SINK } = ctx;
  const { N, at, px, topY } = board;
  const levelOneTierTwoBushes = board.level.id === 'one';
  const stairTiles = new Set((board.level.ramps || []).flatMap(([low, high]) => [low, high])
    .map(([i, j]) => K(i, j)));
  const { mat } = kit;

  // Canopies are built from tone-graded shells -- darkest at the trunk, lightest
  // at the crown -- which fakes soft self-occlusion with no shadow pass at all.
  const treeTones = [0x44683a, 0x486d3e, 0x4b7040, 0x507644].map(mat);
  const bushTones = [0x668c4e, 0x6a9052, 0x6e9454, 0x749a59].map(mat);
  const tone = (list, t) => list[Math.max(0, Math.min(list.length - 1, Math.floor(t * list.length)))];
  const treeTrunkGeo = new THREE.CylinderGeometry(0.045, 0.065, 0.42, 5);
  const foliageGeo = new THREE.IcosahedronGeometry(1, 0);

  function tree(x, y, z, hgt, simple = false) {
    if (simple) {
      bush(x, y, z, hgt * 0.32);
      return;
    }
    const trunk = new THREE.Mesh(treeTrunkGeo, mat(0x6d563c));
    trunk.scale.setScalar(hgt);
    trunk.position.set(x, y + hgt * 0.18 - SINK, z);
    props.add(trunk);
    const n = 5 + Math.floor(rand() * 3);
    const rBase = hgt * 0.19;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const r = rBase * (0.74 + rand() * 0.42) * (1 - t * 0.22);
      const s = new THREE.Mesh(foliageGeo, tone(treeTones, t * 0.98));
      s.scale.set(r * 1.08, r * (0.78 + rand() * 0.44), r * 1.08);
      s.position.set(x + (rand() - .5) * hgt * 0.26, y - SINK + hgt * (0.28 + 0.6 * t), z + (rand() - .5) * hgt * 0.26);
      s.rotation.y = rand() * 6.28;
      props.add(s);
    }
    soft.blob(x, y, z, hgt * 0.9);
  }

  function bush(x, y, z, r) {
    const s = new THREE.Mesh(foliageGeo, tone(bushTones, rand()));
    s.scale.set(r * 1.15, r * (0.72 + rand() * 0.34), r * 1.15);
    s.rotation.y = rand() * 6.28;
    s.position.set(x, y + r * 0.5 - SINK, z);
    props.add(s);
  }

  // Scatter a point inside a disc and report the tile under it, or null if that
  // tile is water or already spoken for.
  function pick(fi, fj) {
    const i = Math.round(fi), j = Math.round(fj);
    if (!at(i, j) || used.has(K(i, j)) || stairTiles.has(K(i, j))) return null;
    return { i, j };
  }

  GROVES.forEach(([gi, gj, gr]) => {
    for (let k = 0; k < TREES_PER_GROVE; k++) {
      const a = rand() * 6.28, d = gr * Math.sqrt(rand());
      const fi = gi + Math.cos(a) * d, fj = gj + Math.sin(a) * d;
      const hit = pick(fi, fj);
      if (hit) {
        const hgt = 0.58 + rand() * 0.32;
        const simple = levelOneTierTwoBushes && at(hit.i, hit.j) === 2;
        tree(px(fi), topY(hit.i, hit.j), px(fj), simple ? hgt * 0.62 : hgt, simple);
      }
    }
    // Bushes ring the grove rather than filling it, softening the edge.
    for (let k = 0; k < BUSHES_PER_GROVE; k++) {
      const a = rand() * 6.28, d = gr * (0.8 + rand() * 0.55);
      const fi = gi + Math.cos(a) * d, fj = gj + Math.sin(a) * d;
      const hit = pick(fi, fj);
      if (hit) bush(px(fi), topY(hit.i, hit.j), px(fj), 0.05 + rand() * 0.035);
    }
  });

  // Loose scrub keeps the open meadow from reading as bare paint.
  for (let k = 0; k < LOOSE_SCRUB; k++) {
    const fi = rand() * (N - 1), fj = rand() * (N - 1);
    const hit = pick(fi, fj);
    if (hit) bush(px(fi), topY(hit.i, hit.j), px(fj), 0.032 + rand() * 0.026);
  }

  // Hundreds of pale flecks across the meadow, emitted straight into one buffer
  // so the whole scatter costs a single unlit draw call.
  const positions = [], colors = [], petal = new THREE.Color();
  for (let k = 0; k < FLOWER_ATTEMPTS; k++) {
    const fi = rand() * (N - 1), fj = rand() * (N - 1);
    const hit = pick(fi, fj);
    if (!hit) continue;
    const x = px(fi), z = px(fj), y = topY(hit.i, hit.j) + 0.007;
    const r = 0.015 + rand() * 0.02;
    const a = rand() * 6.28, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    const corner = [[-ca - sa, -sa + ca], [ca - sa, sa + ca], [ca + sa, sa - ca], [-ca + sa, -sa - ca]];
    petal.setHSL(0.14 - rand() * 0.07, 0.14 + rand() * 0.14, 0.9 + rand() * 0.07);
    const add = n => {
      positions.push(x + corner[n][0], y, z + corner[n][1]);
      colors.push(petal.r, petal.g, petal.b);
    };
    add(0); add(1); add(2); add(0); add(2); add(3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  props.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true })));
}
