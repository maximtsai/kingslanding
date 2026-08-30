// Island diorama -- the raid in progress.
//
// Spearmen ashore, the longships that carried them, their wakes, the banner they
// are pushing toward, and the stains they have already left on the grass.
(function () {
  const D = window.Diorama || (window.Diorama = {});

  const LANDED = [[3, 7], [4, 7], [5, 7], [4, 8], [5, 8]];
  const PER_TILE = 3;
  const BOATS = 4;
  const BLOOD = [[4, 7], [5, 7], [4, 8]];
  const OBJECTIVE = [4, 4];             // the tile the raiders are advancing on

  D.buildActors = function (ctx) {
    const { THREE, P, scene, board, kit, soft, props, rand, SINK, fadeMaterial } = ctx;
    const { at, px, topY } = board;
    const { mat, bevelBox } = kit;

    const spearGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4);
    const spearTipGeo = new THREE.ConeGeometry(0.028, 0.1, 4);
    const spearMat = mat(0xc7b58a);

    function soldier() {
      const g = new THREE.Group();
      g.scale.setScalar(0.45);
      const body = bevelBox(0.16, 0.1, 0.25, 0, P.enemy);
      body.position.y = 0.2; g.add(body);
      const head = bevelBox(0.13, 0.12, 0.13, 0, 0xdac7a5);
      head.position.y = 0.45; g.add(head);
      const helmet = bevelBox(0.145, 0.135, 0.055, 0, 0x59616a);
      helmet.position.y = 0.555; g.add(helmet);
      [-1, 1].forEach(side => {
        const leg = bevelBox(0.052, 0.07, 0.16, 0, 0x24242a);
        leg.position.set(side * 0.05, 0, 0); g.add(leg);
        const arm = bevelBox(0.048, 0.06, 0.19, 0, P.enemy);
        arm.position.set(side * 0.11, 0.23, 0); arm.rotation.z = side * 0.18; g.add(arm);
      });
      const spear = new THREE.Mesh(spearGeo, spearMat);
      spear.position.set(0.11, 0.3, 0); spear.rotation.z = -0.24; g.add(spear);
      const tip = new THREE.Mesh(spearTipGeo, spearMat);
      tip.position.set(0.18, 0.6, 0); tip.rotation.z = -0.24; g.add(tip);
      return g;
    }

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

    // --- spearmen ashore ---
    LANDED.filter(([i, j]) => at(i, j) === 1).forEach(([i, j]) => {
      for (let k = 0; k < PER_TILE; k++) {
        const s = soldier();
        const x = px(i) + (rand() - .5) * 0.7, z = px(j) + (rand() - .5) * 0.7;
        s.position.set(x, topY(i, j) - SINK, z);
        // The raiders have landed and are pushing inland. Facing them at the king
        // (with a little scatter) lines their spears up, so the group reads as an
        // advancing body rather than a handful of figures milling about.
        s.rotation.y = Math.atan2(px(OBJECTIVE[0]) - x, px(OBJECTIVE[1]) - z) + (rand() - 0.5) * 0.55;
        props.add(s);
        soft.blob(x, topY(i, j), z, 0.24);
      }
    });

    banner(px(3.1), topY(3, 7) - SINK, px(7.1), P.accent);

    // --- longships ---
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -0.66, -0.23, 0, -0.34, -0.23, 0, 0.34, 0, 0, 0.66,
      0, 0.18, -0.66, -0.23, 0.1, -0.34, -0.23, 0.1, 0.34, 0, 0.18, 0.66
    ], 3));
    hullGeo.setIndex([0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7, 4,5,6, 4,6,7]);
    hullGeo.computeVertexNormals();
    const oarGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.68, 4);

    // Wakes: one tapered ribbon per boat, all in a single buffer. They give the
    // empty water a direction of travel and tie the raiders to the shore.
    const wakePositions = [], wakeFade = [];
    function wake(x, z, angle, length) {
      const dx = Math.sin(angle), dz = Math.cos(angle);
      const segments = 5;
      let prev = null;
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const spread = 0.07 + t * 0.34;
        const cx = x + dx * length * t, cz = z + dz * length * t;
        const node = {
          l: [cx - dz * spread, cz + dx * spread],
          r: [cx + dz * spread, cz - dx * spread],
          a: (1 - t) * (1 - t) * (s === 0 ? 0.55 : 1)
        };
        if (prev) {
          const push = (p, a) => { wakePositions.push(p[0], 0.03, p[1]); wakeFade.push(a); };
          push(prev.l, prev.a); push(prev.r, prev.a); push(node.r, node.a);
          push(prev.l, prev.a); push(node.r, node.a); push(node.l, node.a);
        }
        prev = node;
      }
    }

    for (let k = 0; k < BOATS; k++) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(hullGeo, mat(P.boat));
      hull.position.y = -0.1; g.add(hull);
      [-0.18, 0.18].forEach(z => {
        const bench = bevelBox(0.42, 0.06, 0.035, 0, P.rockTop);
        bench.position.set(0, 0.08, z); g.add(bench);
      });
      [-1, 1].forEach(s => {
        const oar = new THREE.Mesh(oarGeo, mat(0x9a754d));
        oar.position.set(s * 0.25, 0.08, 0); oar.rotation.z = s * Math.PI / 2.7; g.add(oar);
      });
      const x = px(2.8 + k * 1.3), z = px(10.3 + (k % 2) * 0.7);
      g.position.set(x, 0.06, z);            // waterline cuts the hull
      g.rotation.y = (rand() - 0.5) * 0.3;
      props.add(g);
      const f = soft.blob(x, 0.02, z, 1.5, soft.boatFoamMat);
      f.scale.set(0.8, 1.7, 1);
      f.rotation.z = -g.rotation.y;
      wake(x, z + 0.5, g.rotation.y, 3.4 + rand() * 1.6);
      for (let m = 0; m < 2; m++) {
        const s = soldier();
        s.scale.setScalar(0.42);
        s.position.set(x, 0.09, z - 0.25 + m * 0.5);
        s.rotation.y = g.rotation.y + (rand() - 0.5) * 0.3;  // squared up with the hull
        props.add(s);
      }
    }
    {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(wakePositions, 3));
      geometry.setAttribute('aFade', new THREE.Float32BufferAttribute(wakeFade, 1));
      const mesh = new THREE.Mesh(geometry, fadeMaterial(P.foam, 0.85));
      mesh.renderOrder = -1;
      scene.add(mesh);
    }

    // A stain that sinks into the grass, not a sticker laid on top of it.
    const bloodMat = new THREE.MeshBasicMaterial({ color: P.blood, transparent: true, opacity: 0.81, depthWrite: false });
    BLOOD.forEach(([i, j]) => {
      if (!at(i, j)) return;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.15 + rand() * 0.09, 7), bloodMat);
      d.rotation.x = -Math.PI / 2; d.rotation.z = rand() * 6.28;
      d.position.set(px(i) + (rand() - .5) * 0.5, topY(i, j) + 0.008, px(j) + (rand() - .5) * 0.5);
      props.add(d);
    });
  };
})();
