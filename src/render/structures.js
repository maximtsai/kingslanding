// Hero TD -- hand-built structure geometry.
//
// Two jobs, deliberately separated.
//
// `createStructurePrefabs` returns the mesh builders and nothing else. Houses
// and towers are gameplay objects now -- they take damage, get destroyed and
// rebuilt, and towers are bought by the player rather than authored -- so they
// are constructed on demand into the dynamic root (see views.js), never batched.
//
// `buildStructures` does the static half: the decorative keep and the rock
// stairways, which never change and are folded into the static buffer. It also
// claims tiles in ctx.used so the vegetation pass does not plant a tree through
// a roof that is going to be built later.

import { flattenGroup } from './flatten.js';
import {
  STAIR_TREAD_STARTS, STAIR_HEIGHTS, STAIR_END, stairSurfaceY
} from '../stairs.js';

export function createStructurePrefabs(ctx) {
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

  // RESTORED, not authored. A recent commit deleted this function but left the
  // two references to it -- the export below and buildStructures -- so the game
  // did not boot at all. Put back verbatim; if the deletion was intentional the
  // correct completion is to remove those two references instead. Note it still
  // wears P.accent, which is the section 15 red-band violation on the open list.
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

  // ---------------- the castle: a 2x2 keep with four corner turrets ----------
  // Built about its own centre, so the view can drop it straight onto the middle
  // of its footprint. Deliberately the tallest thing a player can put on the
  // island: it is the objective, and it should be findable from any camera angle
  // without hunting.
  //
  // Muted blue roofs and heraldry add colour without borrowing the pure red
  // reserved for gameplay and the king's cape.
  function castle() {
    const g = new THREE.Group();
    const stone = P.rockTop, shade = P.rockSide;
    const castleBlue = 0x607f91, castleGold = 0xd2ad55;

    // Extend the footprint by an imperceptible amount so the base stays above
    // the terrain cap instead of z-fighting along its edges.
    const base = bevelBox(1.649, 1.649, 0.22, 0.05, shade);
    baseAO(base, 0.68);
    g.add(base);

    const hall = bevelBox(1.30, 1.30, 0.66, 0.05, stone);
    hall.position.y = 0.28;
    baseAO(hall, 0.74);
    g.add(hall);

    // Crenellated parapet: blocks sit squarely along the hall's four edges,
    // rather than tracing a circular ring around it.
    const merlon = 0.17;
    const edge = 0.60;
    const edgePositions = [
      [-0.27, edge, 0], [0.27, edge, 0],
      [-0.27, -edge, 0], [0.27, -edge, 0],
      [edge, -0.27, Math.PI / 2], [edge, 0.27, Math.PI / 2],
      [-edge, -0.27, Math.PI / 2], [-edge, 0.27, Math.PI / 2]
    ];
    for (const [x, z, rotation] of edgePositions) {
      const block = bevelBox(merlon, merlon, 0.14, 0.02, stone);
      block.position.set(x, 0.92, z);
      block.rotation.y = rotation;
      g.add(block);
    }

    // Four corner turrets, each a shade darker so the mass reads in silhouette.
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
      const turret = bevelBox(0.40, 0.40, 1.24, 0.04, stone);
      turret.position.set(sx * 0.66, 0, sz * 0.66);
      baseAO(turret, 0.70);
      g.add(turret);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.34, 4), mat(castleBlue));
      roof.position.set(sx * 0.66, 1.42, sz * 0.66);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), mat(castleGold));
      finial.position.set(sx * 0.66, 1.62, sz * 0.66);
      g.add(finial);
    });

    // One small heraldic pennant per face. The shallow boxes remain readable
    // after the rigid prefab is flattened, unlike texture-sized ornament.
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([sx, sz]) => {
      const sideFace = sx !== 0;
      const pennant = bevelBox(
        sideFace ? 0.025 : 0.18,
        sideFace ? 0.18 : 0.025,
        0.24, 0.008, castleBlue
      );
      pennant.position.set(sx * 0.666, 0.58, sz * 0.666);
      g.add(pennant);
      const badge = bevelBox(
        sideFace ? 0.018 : 0.07,
        sideFace ? 0.07 : 0.018,
        0.07, 0, castleGold
      );
      badge.position.set(sx * 0.682, 0.66, sz * 0.682);
      g.add(badge);
    });

    const gate = bevelBox(0.30, 0.04, 0.34, 0, 0x6b5942);
    gate.position.set(0, 0.30, 0.66);
    g.add(gate);
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

  // Chiseled routes between tiers. Tread boundaries stay deterministic so the
  // simulation can follow them; width, skew and chipped corners vary per flight.
  function rockStairway(lowI, lowJ, highI, highJ) {
    const g = new THREE.Group();
    const steps = STAIR_HEIGHTS.length;
    const dx = highI - lowI, dz = highJ - lowJ;
    const low = topY(lowI, lowJ);
    const high = topY(highI, highJ);
    const angle = Math.atan2(dx, dz);
    for (let k = 0; k < steps; k++) {
      const t = k / (steps - 1);
      const start = STAIR_TREAD_STARTS[k];
      const end = k + 1 < steps ? STAIR_TREAD_STARTS[k + 1] : STAIR_END;
      const along = ((start + end) / 2 - 0.5) * TILE;
      const width = TILE * (0.94 - t * 0.08 + (rand() - 0.5) * 0.045);
      const depth = (end - start) * TILE;
      const skew = (rand() - 0.5) * 0.055;
      const x0 = -width / 2 + skew, x1 = width / 2 + skew;
      const z0 = -depth / 2, z1 = depth / 2;
      const chipA = 0.025 + rand() * 0.065, chipB = 0.025 + rand() * 0.065;
      const backA = 0.015 + rand() * 0.045, backB = 0.015 + rand() * 0.045;
      const frontSkew = (rand() - 0.5) * 0.045;
      const bottom = low - 0.05;
      const top = stairSurfaceY(low, high, STAIR_HEIGHTS[k]);
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
      step.rotation.y = angle;
      g.add(step);
    }
    g.position.set((px(lowI) + px(highI)) / 2, 0, (px(lowJ) + px(highJ)) / 2);
    props.add(g);
  }

  // ---------------- the tower tree, as a visual grammar ---------------------
  //
  // TDD 5: across the whole tree, upgrades read the same way -- WIDER means more
  // projectiles per volley, TALLER means more range and more HP. A player should
  // be able to read any tower's build at a glance without a tooltip, and it means
  // two mesh variants per line rather than eight bespoke models.
  //
  // So these are the T1 shapes parameterised, not new models: `wide` fattens the
  // platform and doubles the firing slots, `tall` adds a storey and narrows.
  function archerVariant(spec) {
    const g = new THREE.Group();
    const width = spec.width, storeys = spec.storeys;
    const timber = 0x7a5f3e, brace = 0x6b5335;
    const legHeight = 0.62 * storeys, spreadBase = 0.22 * width, spreadTop = 0.17 * width;
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
    // A waist band per storey, so a taller frame reads as braced rather than spindly.
    for (let s = 1; s <= storeys; s++) {
      const t = (s - 0.54) / storeys;
      corners.forEach(([sx, sz], k) => {
        const [nx, nz] = corners[(k + 1) % 4];
        g.add(strut(legPoint(sx, sz, t), legPoint(nx, nz, t), 0.026, brace));
      });
    }
    g.add(strut(legPoint(1, -1, 0.06), legPoint(1, 1, 0.88), 0.022, brace));
    g.add(strut(legPoint(-1, 1, 0.06), legPoint(-1, -1, 0.88), 0.022, brace));

    const deck = bevelBox(0.5 * width, 0.5 * width, 0.05, 0.012, timber);
    deck.position.y = legHeight;
    g.add(deck);

    const cabinBase = legHeight + 0.05;
    const cabin = bevelBox(0.42 * width, 0.42 * width, 0.3, 0.025, P.wall);
    cabin.position.y = cabinBase;
    baseAO(cabin, 0.74);
    g.add(cabin);

    // Firing slits: one per face at T1, doubled on a wide platform. This is the
    // count the player is meant to read as "more projectiles".
    const slots = spec.slots || 1;
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([sx, sz]) => {
      for (let k = 0; k < slots; k++) {
        const offset = slots === 1 ? 0 : (k - (slots - 1) / 2) * 0.15 * width;
        const slit = sx
          ? bevelBox(0.022, 0.03, 0.13, 0, 0x3b3f36)
          : bevelBox(0.03, 0.022, 0.13, 0, 0x3b3f36);
        slit.position.set(
          sx * 0.207 * width + (sx ? 0 : offset),
          cabinBase + 0.09,
          sz * 0.207 * width + (sz ? 0 : offset)
        );
        g.add(slit);
      }
    });

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.35 * width, 0.19, 4), mat(P.roof));
    roof.position.y = cabinBase + 0.3 + 0.065;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);

    // The ballista line mounts a visible engine on the roof, so a flat-trajectory
    // tower never gets mistaken for an arcing one.
    if (spec.engine) {
      for (let k = 0; k < spec.engine; k++) {
        const offset = spec.engine === 1 ? 0 : (k - 0.5) * 0.22 * width;
        const bow = bevelBox(0.46 * width, 0.05, 0.05, 0, 0x6b5335);
        bow.position.set(offset, cabinBase + 0.42, 0);
        g.add(bow);
        const shaft = bevelBox(0.05, 0.34, 0.05, 0, 0xc7b58a);
        shaft.position.set(offset, cabinBase + 0.40, 0);
        shaft.rotation.x = Math.PI / 2;
        g.add(shaft);
      }
    }
    return g;
  }

  // The barricade line: mass on the ground rather than a platform in the air.
  function barricade() {
    const g = new THREE.Group();
    const cornerTimber = [0xc4975f, 0xb88b55];
    const wallTimber = [0xa97d49, 0x9f7443, 0xb0834e];
    const rope = 0x5b4229;
    g.scale.y = 0.92;

    // Four shared corner logs plus three smaller posts between each pair gives
    // every wall five logs. The middle stays clear, so this reads as a hollow
    // stockade instead of a bundle of posts growing through one another.
    const corners = [
      [-0.34, -0.34, 0.66], [0.34, -0.34, 0.61],
      [-0.34, 0.34, 0.63], [0.34, 0.34, 0.68]
    ];
    const wallPosts = [
      [-0.17, -0.34, 0.53], [0, -0.34, 0.57], [0.17, -0.34, 0.51],
      [-0.17, 0.34, 0.55], [0, 0.34, 0.50], [0.17, 0.34, 0.56],
      [-0.34, -0.17, 0.52], [-0.34, 0, 0.58], [-0.34, 0.17, 0.54],
      [0.34, -0.17, 0.57], [0.34, 0, 0.51], [0.34, 0.17, 0.55]
    ];
    const addPost = (x, z, height, k, corner) => {
      const tones = corner ? cornerTimber : wallTimber;
      const color = tones[k % tones.length];
      const radius = (corner ? 0.09 : 0.062) * 0.9;
      const sides = corner ? 7 : 5;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius, height, sides), mat(color));
      shaft.position.set(x, height / 2, z);
      g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.08, corner ? 0.17 : 0.13, sides), mat(color));
      tip.position.set(x, height + (corner ? 0.085 : 0.065), z);
      g.add(tip);
    };
    corners.forEach(([x, z, height], k) => addPost(x, z, height, k, true));
    wallPosts.forEach(([x, z, height], k) => addPost(x, z, height, k + corners.length, false));

    // Dark cross-ties cinch the four walls together just below the sharpened tops.
    [-1, 1].forEach(side => {
      const rail = bevelBox(0.7, 0.045, 0.055, 0, rope);
      rail.position.set(0, 0.34, side * 0.325);
      g.add(rail);
      const tie = bevelBox(0.045, 0.7, 0.055, 0, rope);
      tie.position.set(side * 0.325, 0.34, 0);
      g.add(tie);
    });
    return g;
  }

  function wall(spec) {
    const g = new THREE.Group();
    const height = spec.height, width = spec.width;
    const body = bevelBox(0.84 * width, 0.5, height, 0.04, P.rockSide);
    baseAO(body, 0.66);
    g.add(body);
    // Timber capping, so it reads as built rather than as a lump of terrain.
    const cap = bevelBox(0.9 * width, 0.56, 0.07, 0.02, 0x6b5335);
    cap.position.y = height;
    g.add(cap);

    if (spec.slits) {
      [-1, 1].forEach(side => {
        const slit = bevelBox(0.09, 0.06, 0.12, 0, 0x3b3f36);
        slit.position.set(side * 0.22 * width, height * 0.6, 0.26);
        g.add(slit);
        // Spear tips showing through, which is the read for "this one kills".
        const spear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 4), mat(0xc7b58a));
        spear.position.set(side * 0.22 * width, height * 0.6, 0.4);
        spear.rotation.x = Math.PI / 2;
        g.add(spear);
      });
    }
    if (spec.spikes) {
      for (let k = 0; k < 7; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 4), mat(0x8e9299));
        spike.position.set(-0.36 * width + k * 0.12 * width, height + 0.1, 0.2);
        spike.rotation.x = 0.5;
        g.add(spike);
      }
    }
    if (spec.arm) {
      // Catapult: a raked throwing arm and a counterweight, unmistakable from above.
      const frame = bevelBox(0.5, 0.5, 0.22, 0.03, 0x6b5335);
      frame.position.y = height;
      g.add(frame);
      const arm = bevelBox(0.07, 0.07, 0.66, 0.01, 0xc7b58a);
      arm.position.set(0, height + 0.2, 0);
      arm.rotation.x = -0.9;
      g.add(arm);
      const bucket = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 5), mat(0x4e535a));
      bucket.position.set(0, height + 0.72, -0.32);
      g.add(bucket);
    }
    return g;
  }

  // One entry per tower type. The renderer asks for a type and gets a silhouette
  // that already encodes what the thing does.
  const TOWER_SHAPES = {
    archer:       () => archerVariant({ width: 1.0, storeys: 1, slots: 1 }),
    fortified:    () => archerVariant({ width: 1.25, storeys: 1, slots: 1 }),
    ballista:     () => archerVariant({ width: 1.0, storeys: 1.55, slots: 1, engine: 1 }),
    garrison:     () => archerVariant({ width: 1.5, storeys: 1, slots: 2 }),
    watchtower:   () => archerVariant({ width: 1.0, storeys: 1.9, slots: 1 }),
    twinBallista: () => archerVariant({ width: 1.5, storeys: 1.55, slots: 2, engine: 2 }),
    siegeTower:   () => archerVariant({ width: 1.05, storeys: 2.4, slots: 1, engine: 1 }),
    barricade:    barricade,
    bulwark:      () => wall({ width: 1.15, height: 0.62 }),
    spearBunker:  () => wall({ width: 1.0, height: 0.5, slits: true }),
    spikes:       () => wall({ width: 1.15, height: 0.62, spikes: true }),
    catapult:     () => wall({ width: 1.0, height: 0.34, arm: true })
  };

  const towerOfType = type => (TOWER_SHAPES[type] || TOWER_SHAPES.archer)();

  return { house, keep, castle, arrowTower, ballistaTower, towerOfType, rockStairway };
}

export function buildStructures(ctx) {
  const prefabs = createStructurePrefabs(ctx);
  const { board, props, soft, used, K, SINK } = ctx;
  const { at, px, topY, STAIRS, level } = board;

  // Houses are dynamic, but their tiles are spoken for from the start: nothing
  // should grow where one is going to stand.
  for (const [i, j] of level.houses) if (at(i, j)) used.add(K(i, j));

  // The keep is pure scenery -- no HP, no income, not a target. Its tile is
  // reserved in the level data so the player cannot build a tower through its
  // roof.
  //
  // It is nevertheless the TALLEST thing on most islands, and section 15 is
  // unconditional: "if a unit can be attacked, it must be visible. No
  // exceptions." Baked into the static batch it could never be faded, because
  // batching destroys the object references (TDD 17) -- so it is flattened to
  // one mesh and put in the dynamic root instead. One draw call per level is
  // the whole price of the rule applying to it.
  const scenery = [];
  for (const [i, j] of (level.reserved || [])) {
    if (!at(i, j)) continue;
    used.add(K(i, j));
    const group = prefabs.castle();
    const baked = flattenGroup(ctx.THREE, group);
    const mesh = new ctx.THREE.Mesh(baked.geometry, baked.material);
    mesh.position.set(px(i), topY(i, j) - SINK, px(j));
    mesh.frustumCulled = false;
    (ctx.dynamicRoot || props).add(mesh);
    scenery.push(mesh);
    soft.blob(px(i), topY(i, j), px(j), 1.15);
  }

  STAIRS.forEach(([[li, lj], [hi, hj]]) => prefabs.rockStairway(li, lj, hi, hj));
  prefabs.scenery = scenery;
  return prefabs;
}
