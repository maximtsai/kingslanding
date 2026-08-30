// Island diorama -- everything built by hand.
//
// Houses, the keep, the two watchtowers and the stairways between tiers. All of
// it is opaque flat-shaded Lambert on cached materials, which is what lets the
// batcher fold the lot into one draw call later.
//
// Tiles claimed here are added to ctx.used so the vegetation pass does not plant
// a tree through a roof.
(function () {
  const D = window.Diorama || (window.Diorama = {});

  // Where each structure stands. Tiles must exist on the map; a missing one is
  // skipped rather than throwing, so an edited map degrades quietly.
  const HOUSES = [[2, 3], [7, 5], [3, 8], [8, 4]];
  const KEEP = [5, 2];
  const ARROW_TOWER = [1, 4];
  const BALLISTA_TOWER = [5, 6];

  D.buildStructures = function (ctx) {
    const { THREE, P, board, kit, soft, props, rand, used, K, SINK } = ctx;
    const { at, px, topY, TILE, STAIRS } = board;
    const { mat, bevelBox, baseAO, strut } = kit;

    function house(x, y, z, scale) {
      const g = new THREE.Group();
      const wall = bevelBox(0.62 * scale, 0.48 * scale, 0.46 * scale, 0.03, P.wall);
      baseAO(wall, 0.72);
      g.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.49 * scale, 0.33 * scale, 4), mat(P.roof));
      roof.position.y = 0.61 * scale;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const door = bevelBox(0.12 * scale, 0.015 * scale, 0.22 * scale, 0, 0x6b5942);
      door.position.set(0, 0.02, 0.246 * scale);
      g.add(door);
      [-1, 1].forEach(side => {
        const window = new THREE.Mesh(new THREE.CircleGeometry(0.055 * scale, 5), mat(0x8eb9bd));
        window.position.set(side * 0.22 * scale, 0.31 * scale, 0.246 * scale);
        g.add(window);
      });
      const chimney = bevelBox(0.1 * scale, 0.1 * scale, 0.16 * scale, 0, P.rockSide);
      chimney.position.set(-0.2 * scale, 0.56 * scale, -0.08 * scale);
      g.add(chimney);
      g.position.set(x, y, z);
      return g;
    }

    function keep() {
      const g = new THREE.Group();
      const tower = bevelBox(0.56, 0.56, 0.82, 0.05, P.rockTop);
      baseAO(tower, 0.72);
      g.add(tower);
      const band = bevelBox(0.6, 0.6, 0.1, 0.03, P.accent);
      band.position.y = 0.76; g.add(band);
      const cap = bevelBox(0.48, 0.48, 0.14, 0.03, P.wall);
      cap.position.y = 0.86; g.add(cap);
      return g;
    }

    // ---------------- arrow tower: an enclosed lookout on four log stilts -------
    function arrowTower() {
      const g = new THREE.Group();
      const timber = 0x7a5f3e, brace = 0x6b5335;
      const legHeight = 0.62, spreadBase = 0.22, spreadTop = 0.17;
      // Legs lean in as they rise, which is what stops a stilted frame from
      // reading as four loose posts.
      const legPoint = (sx, sz, t) => [
        sx * (spreadBase + (spreadTop - spreadBase) * t),
        legHeight * t,
        sz * (spreadBase + (spreadTop - spreadBase) * t)
      ];
      const tilt = Math.atan2(spreadBase - spreadTop, legHeight);
      const legGeo = new THREE.CylinderGeometry(0.03, 0.042, legHeight * 1.02, 6);
      const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
      corners.forEach(([sx, sz]) => {
        const leg = new THREE.Mesh(legGeo, mat(timber));
        leg.position.set(sx * (spreadBase + spreadTop) / 2, legHeight / 2, sz * (spreadBase + spreadTop) / 2);
        leg.rotation.z = sx * tilt;
        leg.rotation.x = -sz * tilt;
        g.add(leg);
      });
      // A waist band all the way round, plus a diagonal on two opposing faces.
      corners.forEach(([sx, sz], k) => {
        const [nx, nz] = corners[(k + 1) % 4];
        g.add(strut(legPoint(sx, sz, 0.46), legPoint(nx, nz, 0.46), 0.026, brace));
      });
      g.add(strut(legPoint(1, -1, 0.06), legPoint(1, 1, 0.88), 0.022, brace));
      g.add(strut(legPoint(-1, 1, 0.06), legPoint(-1, -1, 0.88), 0.022, brace));

      const deck = bevelBox(0.5, 0.5, 0.05, 0.012, timber);
      deck.position.y = legHeight;
      g.add(deck);
      // The cabin overhangs the frame it stands on -- the silhouette that reads
      // as "watchtower" from across the island.
      const cabinBase = legHeight + 0.05;
      const cabin = bevelBox(0.42, 0.42, 0.3, 0.025, P.wall);
      cabin.position.y = cabinBase;
      baseAO(cabin, 0.74);
      g.add(cabin);
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([sx, sz]) => {
        const slit = sx
          ? bevelBox(0.022, 0.03, 0.13, 0, 0x3b3f36)
          : bevelBox(0.03, 0.022, 0.13, 0, 0x3b3f36);
        slit.position.set(sx * 0.207, cabinBase + 0.09, sz * 0.207);
        g.add(slit);
      });
      // Radius is to the corners, so the eaves at the middle of each face sit at
      // r*cos45 -- it has to clear the 0.21 half-width to overhang at all.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.19, 4), mat(P.roof));
      roof.position.y = cabinBase + 0.3 + 0.065;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      return g;
    }

    // ---------------- ballista tower: stone shaft under a mounted engine -------
    function ballistaTower(aim) {
      const g = new THREE.Group();
      const wood = 0x6b5335, iron = 0x4e535a;
      const plinth = bevelBox(0.56, 0.56, 0.09, 0.03, P.rockSide);
      baseAO(plinth, 0.7);
      g.add(plinth);
      const shaft = bevelBox(0.46, 0.46, 0.7, 0.04, P.rockTop);
      shaft.position.y = 0.06;
      baseAO(shaft, 0.74);
      g.add(shaft);
      const deckBase = 0.76;
      const deck = bevelBox(0.6, 0.6, 0.08, 0.025, P.wall);
      deck.position.y = deckBase;
      g.add(deck);
      const deckTop = deckBase + 0.08;
      [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([sx, sz]) => {
        const merlon = bevelBox(0.11, 0.11, 0.1, 0.02, P.wall);
        merlon.position.set(sx * 0.235, deckTop, sz * 0.235);
        g.add(merlon);
      });

      // The engine, built pointing down +z and then turned to aim. Deliberately
      // chunky and high-contrast: a scale-accurate ballista collapses into a
      // tangle of matchsticks at diorama size, so the parts are exaggerated and
      // the stock is lifted clear of the parapet on twin posts.
      const engine = new THREE.Group();
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.06, 8), mat(P.rockSide));
      engine.add(pivot);
      [-1, 1].forEach(side => {
        const post = bevelBox(0.045, 0.075, 0.12, 0, iron);
        post.position.set(side * 0.065, 0.05, 0);
        engine.add(post);
      });
      // Everything above the posts lives in its own group so the weapon can sit
      // nose-up on its mount without tilting the turntable under it.
      const arm = new THREE.Group();
      arm.position.y = 0.19;
      arm.rotation.x = -0.2;
      engine.add(arm);
      const rail = bevelBox(0.075, 0.56, 0.055, 0.014, 0x8a6b42);
      rail.position.set(0, -0.0275, 0.07);
      arm.add(rail);
      // Prod and bolt ride on top of the stock, not inside it, and the string is
      // drawn right back to the nock. That long triangle is the shape that reads
      // as "ballista" from across the island.
      const deckLine = 0.0275, prodY = deckLine + 0.019;
      const hub = [0, prodY, 0.18], sweep = 1.4, reach = 0.32;
      [1, -1].forEach(side => {
        const tip = [side * Math.sin(sweep) * reach, prodY, hub[2] + Math.cos(sweep) * reach];
        arm.add(strut(hub, tip, 0.044, wood));
        arm.add(strut(tip, [0, prodY, -0.07], 0.017, 0x24272b));
      });
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 6), mat(0xd8cba6));
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(0, prodY, 0.14);
      arm.add(bolt);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 4), mat(iron));
      head.rotation.x = Math.PI / 2;
      head.position.set(0, prodY, 0.43);
      arm.add(head);
      engine.position.y = deckTop;
      engine.rotation.y = aim;
      g.add(engine);
      return g;
    }

    // Chiseled routes between tiers. Every step is nudged by the shared PRNG, so
    // no two flights read as copies of each other.
    function rockStairway(lowI, lowJ, highI, highJ) {
      const g = new THREE.Group();
      const steps = 6;
      const run = TILE * 0.612;
      const dx = highI - lowI, dz = highJ - lowJ;
      const low = topY(lowI, lowJ) + 0.006;
      const high = topY(highI, highJ) - 0.035;
      const angle = Math.atan2(dx, dz);
      const progress = [0];
      const heights = [0];
      for (let k = 1; k < steps - 1; k++) {
        progress.push(k / (steps - 1) + (rand() - 0.5) * 0.045);
        heights.push(k / (steps - 1) + (rand() - 0.5) * 0.035);
      }
      progress.push(1);
      heights.push(1);
      for (let k = 0; k < steps; k++) {
        const t = progress[k];
        const along = -TILE / 2 - TILE * 0.18 + t * run + (k === steps - 1 ? TILE * 0.04 : 0);
        const width = TILE * (0.94 - t * 0.08 + (rand() - 0.5) * 0.045);
        const depth = run / (steps - 1) * (0.94 + rand() * 0.22) + 0.04 + (k === steps - 1 ? 0.11 : 0);
        const skew = (rand() - 0.5) * 0.055;
        const x0 = -width / 2 + skew, x1 = width / 2 + skew;
        const z0 = -depth / 2, z1 = depth / 2;
        const chipA = 0.025 + rand() * 0.065, chipB = 0.025 + rand() * 0.065;
        const backA = 0.015 + rand() * 0.045, backB = 0.015 + rand() * 0.045;
        const frontSkew = (rand() - 0.5) * 0.045;
        const bottom = low - 0.05;
        const top = low + (high - low) * heights[k];
        // Eight-sided footprint with chipped front corners, lofted to a single
        // apex vertex so the tread reads as a rough-hewn slab.
        const footprint = [
          [x0 + chipA, z0], [x0, z0 + chipA], [x0, z1 - backA], [x0 + backA, z1],
          [x1 - backB, z1 - (k === steps - 1 ? backB * 0.7 : 0)], [x1, z1 - backB],
          [x1, z0 + chipB], [x1 - chipB, z0 + frontSkew]
        ];
        const positions = [];
        footprint.forEach(p => positions.push(p[0], bottom, p[1]));
        footprint.forEach(p => positions.push(p[0], top, p[1]));
        positions.push(skew, top, (z0 + z1) / 2);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const indices = [];
        for (let p = 0; p < footprint.length; p++) indices.push(16, 8 + p, 8 + (p + 1) % 8);
        for (let p = 0; p < footprint.length; p++) {
          const n = (p + 1) % 8;
          indices.push(p, n, 8 + n, p, 8 + n, 8 + p);
        }
        geometry.setIndex(indices);
        geometry.addGroup(0, 24, 0);      // tread
        geometry.addGroup(24, 48, 1);     // riser
        geometry.computeVertexNormals();
        const step = new THREE.Mesh(geometry, [mat(P.rockTop), mat(P.rockSide)]);
        step.position.set(along * dx, 0, along * dz);
        step.rotation.y = angle + (rand() - 0.5) * 0.025;
        g.add(step);
      }
      g.position.set((px(lowI) + px(highI)) / 2, 0, (px(lowJ) + px(highJ)) / 2);
      props.add(g);
    }

    // Placement helper: claim the tile, seat the group on it, add a contact pool.
    // build and turn are thunks so a structure on a missing tile costs nothing --
    // and, more to the point, does not draw from the shared PRNG and shift every
    // random decision made after it.
    function place(i, j, build, turn, shade) {
      if (!at(i, j)) return;
      used.add(K(i, j));
      const group = build();
      group.position.set(px(i), topY(i, j) - SINK, px(j));
      group.rotation.y = turn ? turn() : 0;
      props.add(group);
      soft.blob(px(i), topY(i, j), px(j), shade);
    }

    HOUSES.forEach(([i, j]) => place(i, j, () => house(0, 0, 0, 1), () => (rand() - 0.5) * 0.4, 1.25));
    place(KEEP[0], KEEP[1], keep, null, 1.15);
    // West shore lookout, and an engine on the south terrace laid on the longships.
    place(ARROW_TOWER[0], ARROW_TOWER[1], arrowTower, () => 0.34, 1.1);
    place(BALLISTA_TOWER[0], BALLISTA_TOWER[1],
      () => ballistaTower(Math.atan2(px(4.4) - px(BALLISTA_TOWER[0]), px(11) - px(BALLISTA_TOWER[1]))),
      null, 1.2);

    STAIRS.forEach(([[li, lj], [hi, hj]]) => rockStairway(li, lj, hi, hj));
  };
})();
