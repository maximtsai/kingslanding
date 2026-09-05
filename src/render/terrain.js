// Island diorama -- the land.
//
// Turns the integer height map into a single beveled mesh. The pipeline is:
//   tiles -> boundary edges per tier -> chained into closed loops -> corners
//   rounded -> walls extruded down and terrace tops triangulated inside them.
//
// The whole island ends up as one non-indexed buffer with baked vertex colours,
// so it draws in a single call and its facets shade flat for free.

import * as D from './util.js';


const SEABED = -0.9;    // where the lowest tier's wall stops, well under water

export function buildTerrain(ctx) {
  const { THREE, P, scene, board } = ctx;
  const { N, at, px, gridX, topY, TILE, TIER, CAP, DROP, MAX_H, STAIRS } = board;
  const { hash01, cross2, signedArea, pointInPolygon } = D;

  const pos = [], col = [];
  const C = new THREE.Color();
  const COOL = new THREE.Color(P.coolShade);

  // Occluded vertices lean toward a cool stone blue instead of simply going
  // darker, which is what keeps chalk cliffs reading as chalk in skylight.
  function tri(a, b, c, hex, ma, mb, mc) {
    C.set(hex);
    const push = (p, m) => {
      const k = Math.max(0, Math.min(0.4, (1 - m) * 1.7));
      pos.push(p[0], p[1], p[2]);
      col.push(
        (C.r + (COOL.r - C.r) * k) * m,
        (C.g + (COOL.g - C.g) * k) * m,
        (C.b + (COOL.b - C.b) * k) * m
      );
    };
    push(a, ma); push(b, mb); push(c, mc);
  }
  const quad = (a, b, c, d, hex, ma, mb, mc, md) => {
    tri(a, b, c, hex, ma, mb, mc); tri(a, c, d, hex, ma, mc, md);
  };

  // Corner darkening where a taller tile abuts this one, including the convex
  // corners that touch only diagonally.
  function vertexAO(i, j, fx, fz) {
    const hh = at(i, j);
    let ao = 1.0;
    if (at(i + 1, j) > hh) ao *= 1.0 - 0.20 * fx * fx;
    if (at(i - 1, j) > hh) ao *= 1.0 - 0.20 * (1.0 - fx) * (1.0 - fx);
    if (at(i, j + 1) > hh) ao *= 1.0 - 0.20 * fz * fz;
    if (at(i, j - 1) > hh) ao *= 1.0 - 0.20 * (1.0 - fz) * (1.0 - fz);
    if (at(i + 1, j + 1) > hh && at(i + 1, j) <= hh && at(i, j + 1) <= hh) ao *= 1.0 - 0.20 * fx * fx * fz * fz;
    if (at(i + 1, j - 1) > hh && at(i + 1, j) <= hh && at(i, j - 1) <= hh) ao *= 1.0 - 0.20 * fx * fx * (1.0 - fz) * (1.0 - fz);
    if (at(i - 1, j + 1) > hh && at(i - 1, j) <= hh && at(i, j + 1) <= hh) ao *= 1.0 - 0.20 * (1.0 - fx) * (1.0 - fx) * fz * fz;
    if (at(i - 1, j - 1) > hh && at(i - 1, j) <= hh && at(i, j - 1) <= hh) ao *= 1.0 - 0.20 * (1.0 - fx) * (1.0 - fx) * (1.0 - fz) * (1.0 - fz);
    return ao;
  }

  // Corners where a stairway lands are kept squarer, so the steps meet a flat
  // edge instead of a rounded one.
  const stairCorners = new Set();
  STAIRS.forEach(([[li, lj], [hi, hj]]) => {
    if (li !== hi) {
      const x = Math.max(li, hi);
      stairCorners.add(x + ':' + lj); stairCorners.add(x + ':' + (lj + 1));
    } else {
      const z = Math.max(lj, hj);
      stairCorners.add(li + ':' + z); stairCorners.add((li + 1) + ':' + z);
    }
  });
  function bevelWidth(x, z) {
    const rugged = TILE * (0.085 + hash01(x, z) * 0.075);
    return stairCorners.has(x + ':' + z) ? Math.min(rugged, TILE * 0.1) : rugged;
  }

  const key = p => p[0] + ':' + p[1];
  const direction = edge => [edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]];

  // Every tile edge where this tier meets something shorter, wound so the solid
  // side is on the left.
  function boundaryEdges(tier) {
    const edges = [];
    const solid = (i, j) => at(i, j) >= tier;
    const add = (a, b, inside, outside) => edges.push({ a, b, inside, outside });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!solid(i, j)) continue;
      if (!solid(i + 1, j)) add([i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j]);
      if (!solid(i, j + 1)) add([i + 1, j + 1], [i, j + 1], [i, j], [i, j + 1]);
      if (!solid(i - 1, j)) add([i, j + 1], [i, j], [i, j], [i - 1, j]);
      if (!solid(i, j - 1)) add([i, j], [i + 1, j], [i, j], [i, j - 1]);
    }
    return edges;
  }

  // Walk the loose edges into closed rings, always taking the sharpest available
  // left turn so touching corners separate rather than short-circuit.
  function chainEdges(edges) {
    const outgoing = new Map();
    edges.forEach((edge, index) => {
      const k = key(edge.a);
      if (!outgoing.has(k)) outgoing.set(k, []);
      outgoing.get(k).push(index);
    });
    const used = new Set(), loops = [];
    edges.forEach((start, startIndex) => {
      if (used.has(startIndex)) return;
      const loop = [];
      let index = startIndex;
      while (!used.has(index)) {
        used.add(index);
        const edge = edges[index];
        loop.push(edge);
        const candidates = (outgoing.get(key(edge.b)) || []).filter(n => !used.has(n));
        if (!candidates.length) break;
        const incoming = direction(edge);
        candidates.sort((a, b) => {
          const da = direction(edges[a]), db = direction(edges[b]);
          return cross2(incoming, db) - cross2(incoming, da) ||
            incoming[0] * db[0] + incoming[1] * db[1] - incoming[0] * da[0] - incoming[1] * da[1];
        });
        index = candidates[0];
      }
      if (loop.length > 2 && key(loop[loop.length - 1].b) === key(loop[0].a)) loops.push(loop);
    });
    return loops;
  }

  // Replace each square corner with a chamfer (convex) or a short quadratic
  // fillet (concave), and record which edge owns each emitted point so the wall
  // above it knows its own height.
  function roundedLoop(edges) {
    const corners = edges.map((edge, i) => {
      const previous = edges[(i + edges.length - 1) % edges.length];
      const p = edge.a, incoming = direction(previous), outgoing = direction(edge);
      const turn = cross2(incoming, outgoing);
      const b = bevelWidth(p[0], p[1]) * (turn < 0 ? 1.25 : 1);
      const before = [p[0] - incoming[0] * b, p[1] - incoming[1] * b];
      const after = [p[0] + outgoing[0] * b, p[1] + outgoing[1] * b];
      if (turn > 0) return [before, after];
      if (turn < 0) {
        const curve = t => {
          const a = (1 - t) * (1 - t), middle = 2 * (1 - t) * t, end = t * t;
          return [
            before[0] * a + p[0] * middle + after[0] * end,
            before[1] * a + p[1] * middle + after[1] * end
          ];
        };
        return [before, curve(1 / 3), curve(2 / 3), after];
      }
      return [p.slice()];
    });
    const points = [], owners = [];
    corners.forEach((corner, i) => {
      const previous = edges[(i + edges.length - 1) % edges.length];
      const owner = at(...previous.inside) >= at(...edges[i].inside) ? previous : edges[i];
      corner.forEach((p, n) => {
        points.push([gridX(p[0]), gridX(p[1])]);
        owners.push(n === corner.length - 1 ? edges[i] : owner);
      });
    });
    return { points, owners };
  }

  const footprints = Array.from({ length: MAX_H + 1 }, () => []);
  for (let tier = 1; tier <= MAX_H; tier++) {
    footprints[tier] = chainEdges(boundaryEdges(tier)).map(roundedLoop);
  }

  function cliffShade(high, low, y) {
    const base = low ? low * TIER - DROP + CAP : SEABED;
    const top = high * TIER - DROP;
    const drop = top - base;
    const dark = drop > 1.1 ? 0.86 : 0.83;
    const fadeTop = base + drop * 0.55;
    if (y >= fadeTop) return 0.97;
    const t = Math.max(0, Math.min(1, (y - base) / Math.max(0.001, fadeTop - base)));
    return dark + (0.97 - dark) * (t * t * (3 - 2 * t));
  }

  function tileTint(x, z) {
    const i = Math.floor(x / TILE + N / 2), j = Math.floor(z / TILE + N / 2);
    return 0.95 + hash01(i * 7 + 13, j * 7 + 29) * 0.08;
  }

  // Clip each tile against a contour without subdividing the whole terrace.
  // Interior tiles remain identical two-triangle squares, while only tiles at
  // rounded corners, divots, or upper-tier holes receive a few extra boundary
  // vertices. This keeps the grass consistent without filling in the authored
  // edge shapes or creating stretched triangulation fans.
  function clipPolygonToRect(points, x0, z0, x1, z1) {
    let clipped = points.slice();
    const planes = [
      [0, x0, true], [0, x1, false],
      [1, z0, true], [1, z1, false]
    ];
    for (const [axis, bound, greater] of planes) {
      if (!clipped.length) break;
      const next = [];
      const inside = point => greater ? point[axis] >= bound : point[axis] <= bound;
      for (let k = 0; k < clipped.length; k++) {
        const a = clipped[k], b = clipped[(k + 1) % clipped.length];
        const aInside = inside(a), bInside = inside(b);
        if (aInside !== bInside) {
          const delta = b[axis] - a[axis];
          const t = Math.abs(delta) > 1e-8 ? (bound - a[axis]) / delta : 0;
          next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        if (bInside) next.push(b.slice());
      }
      clipped = next;
    }
    return clipped;
  }

  function polygonArea(points) {
    return Math.abs(signedArea(points));
  }

  function polygonIntersectsRect(points, x0, z0, x1, z1) {
    const insideRect = point => point[0] >= x0 && point[0] <= x1 && point[1] >= z0 && point[1] <= z1;
    if (points.some(insideRect)) return true;
    if ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].some(point => pointInPolygon(point, points))) return true;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const intersects = (a, b, c, d) => {
      const abC = cross(a, b, c), abD = cross(a, b, d);
      const cdA = cross(c, d, a), cdB = cross(c, d, b);
      return (abC === 0 && abD === 0)
        ? Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
          Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
        : abC * abD <= 0 && cdA * cdB <= 0;
    };
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      for (let k = 0; k < 4; k++) {
        if (intersects(a, b, corners[k], corners[(k + 1) % 4])) return true;
      }
    }
    return false;
  }

  function emitGrassTile(i, j, tier, outer, holes) {
    const y = tier * TIER - DROP + CAP;
    const x0 = gridX(i), x1 = gridX(i + 1);
    const z0 = gridX(j), z1 = gridX(j + 1);
    const contour = clipPolygonToRect(outer.points, x0, z0, x1, z1);
    if (contour.length < 3 || polygonArea(contour) < 1e-5) return;
    const clippedHoles = holes.map(hole => clipPolygonToRect(hole.points, x0, z0, x1, z1))
      .filter(hole => hole.length >= 3 && polygonArea(hole) > 1e-5);
    const tint = tileTint(px(i), px(j)) * (0.985 + hash01(i * 19, j * 19) * 0.03);
    const shade = point => {
      const fx = Math.max(0, Math.min(1, (point[0] - x0) / TILE));
      const fz = Math.max(0, Math.min(1, (point[1] - z0) / TILE));
      return vertexAO(i, j, fx, fz) * tint;
    };
    const vertices = contour.concat(...clippedHoles);
    const contourVectors = contour.map(point => new THREE.Vector2(point[0], point[1]));
    const holeVectors = clippedHoles.map(hole => hole.map(point => new THREE.Vector2(point[0], point[1])));
    THREE.ShapeUtils.triangulateShape(contourVectors, holeVectors).forEach(face => {
      const a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
      const ma = shade(a), mb = shade(b), mc = shade(c);
      if (cross2([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]) > 0) {
        tri([a[0], y, a[1]], [c[0], y, c[1]], [b[0], y, b[1]], P.grass, ma, mc, mb);
      } else {
        tri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], P.grass, ma, mb, mc);
      }
    });
  }

  const gridLines = [];

  for (let tier = 1; tier <= MAX_H; tier++) {
    const rockTop = tier * TIER - DROP, top = rockTop + CAP;
    const lower = tier === 1 ? SEABED : (tier - 1) * TIER - DROP + CAP;

    footprints[tier].forEach(loop => {
      loop.points.forEach((a, i) => {
        const b = loop.points[(i + 1) % loop.points.length], edge = loop.owners[i];
        const high = at(...edge.inside), low = at(...edge.outside);
        const ownCap = high === tier;
        // A per-facet value jitter: weathered chalk never presents two adjacent
        // faces at exactly the same tone, and a dead-flat wall is the main thing
        // that reads as "untextured polygon" at this scale.
        const facet = 0.962 + hash01(Math.round(a[0] * 97), Math.round(a[1] * 89) + tier * 31) * 0.072;
        quad([a[0], rockTop, a[1]], [b[0], rockTop, b[1]], [b[0], lower, b[1]], [a[0], lower, a[1]], P.cliff,
          cliffShade(high, low, rockTop) * facet, cliffShade(high, low, rockTop) * facet,
          cliffShade(high, low, lower) * facet, cliffShade(high, low, lower) * facet);
        // Shallow chiseled stone panels over the structural face. All vertices
        // join this same terrain buffer; collision heights and contours stay exact.
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const visibleBottom = Math.max(lower, -0.08);
        const height = rockTop - visibleBottom;
        if (length > 0.08 && height > 0.03) {
          const nx = (b[1] - a[1]) / length, nz = -(b[0] - a[0]) / length;
          const rows = Math.max(1, Math.ceil(height / 0.27));
          const columns = Math.max(1, Math.ceil(length / 0.34));
          const step = length / columns;
          for (let row = 0; row < rows; row++) for (let cell = -1; cell < columns; cell++) {
            const offset = (row % 2) * step * 0.5;
            const start = Math.max(0.004, cell * step + offset + 0.004);
            const end = Math.min(length - 0.004, (cell + 1) * step + offset - 0.004);
            if (end - start < 0.025) continue;
            const y0 = visibleBottom + row * height / rows + 0.004;
            const y1 = visibleBottom + (row + 1) * height / rows - 0.004;
            const p = (u, y, lift) => [a[0] + (b[0]-a[0]) * u / length + nx * lift, y, a[1] + (b[1]-a[1]) * u / length + nz * lift];
            const bevel = Math.min(0.018, (end-start) * 0.12, (y1-y0) * 0.12);
            const outer = [p(start,y1,0.002),p(end,y1,0.002),p(end,y0,0.002),p(start,y0,0.002)];
            const inner = [p(start+bevel,y1-bevel,0.012),p(end-bevel,y1-bevel,0.012),p(end-bevel,y0+bevel,0.012),p(start+bevel,y0+bevel,0.012)];
            const tone = 0.91 + hash01(i * 13 + cell * 3, tier * 19 + row * 7) * 0.105;
            const hi = cliffShade(high,low,y1) * tone, lo = cliffShade(high,low,y0) * tone;
            quad(...inner, P.cliff, hi, hi, lo, lo);
            for (let k = 0; k < 4; k++) {
              const n = (k+1)%4;
              quad(outer[k],outer[n],inner[n],inner[k],P.cliff,lo,lo,hi,hi);
            }
          }
        }
        // The thin lip on top: grass where this tier owns the edge, stone where
        // it is really the skirt of a taller neighbour.
        quad([a[0], top, a[1]], [b[0], top, b[1]], [b[0], rockTop, b[1]], [a[0], rockTop, a[1]],
          ownCap ? P.grassShade : P.cliff, ownCap ? 1 : cliffShade(high, low, top), ownCap ? 1 : cliffShade(high, low, top),
          ownCap ? 0.93 : cliffShade(high, low, rockTop), ownCap ? 0.93 : cliffShade(high, low, rockTop));
      });
    });

    // Emit each authored tile through its local rounded contour. Open areas stay
    // regular; only tiles touching a contour or hole acquire extra triangles.
    const outer = footprints[tier].filter(loop => signedArea(loop.points) > 0);
    const naturalHoles = footprints[tier].filter(loop => signedArea(loop.points) < 0);
    const upper = tier < MAX_H ? footprints[tier + 1].filter(loop => signedArea(loop.points) > 0) : [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (at(i, j) !== tier) continue;
      const x0 = gridX(i), x1 = gridX(i + 1);
      const z0 = gridX(j), z1 = gridX(j + 1);
      const centre = [px(i), px(j)];
      const loop = outer.find(candidate => pointInPolygon(centre, candidate.points) ||
        polygonIntersectsRect(candidate.points, x0, z0, x1, z1));
      if (!loop) continue;
      const holes = naturalHoles.filter(hole => pointInPolygon(hole.points[0], loop.points));
      upper.filter(hole => pointInPolygon(hole.points[0], loop.points)).forEach(hole => holes.push(hole));
      emitGrassTile(i, j, tier, loop, holes);
    }

    // Retain the authored contour lines around divots and upper terraces.
    outer.forEach(loop => {
      loop.points.forEach((a, i) => {
        const b = loop.points[(i + 1) % loop.points.length];
        gridLines.push(a[0], top + 0.004, a[1], b[0], top + 0.004, b[1]);
      });
      const holes = naturalHoles.filter(hole => pointInPolygon(hole.points[0], loop.points));
      upper.filter(hole => pointInPolygon(hole.points[0], loop.points)).forEach(hole => holes.push(hole));
      holes.forEach(hole => hole.points.forEach((a, i) => {
        const b = hole.points[(i + 1) % hole.points.length];
        gridLines.push(a[0], top + 0.004, a[1], b[0], top + 0.004, b[1]);
      }));
    });
  }

  // Keep interior tile divisions while exposed boundaries follow the rounded contours.
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const hh = at(i, j); if (!hh) continue;
    const y = topY(i, j) + 0.004;
    if (at(i + 1, j) === hh) gridLines.push(gridX(i + 1), y, gridX(j), gridX(i + 1), y, gridX(j + 1));
    if (at(i, j + 1) === hh) gridLines.push(gridX(i), y, gridX(j + 1), gridX(i + 1), y, gridX(j + 1));
  }

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.computeVertexNormals();
  // Non-indexed triangles, so computeVertexNormals above already yields one
  // normal per face and the island shades flat without asking for it. (Lambert
  // ignores flatShading; see kit.js.)
  scene.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide
  })));

  const gl = new THREE.BufferGeometry();
  gl.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3));
  const gridMesh = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({
    color: 0x587642, transparent: true, opacity: 0.14, fog: false
  }));
  scene.add(gridMesh);

  return { footprints, gridMesh };
}
