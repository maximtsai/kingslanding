// Hero TD -- ghost (build overlay) view.
//
// Placement footprint marker and coverage overlay for the build system.
// Shares canHit with the simulation rather than reimplementing the rule.

import { config } from '../config.js';

export function createGhostView(THREE, board, dynamicRoot) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.42,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide
  });
  const coverage = new THREE.Mesh(geometry, material);
  coverage.renderOrder = 1;
  coverage.visible = false;
  dynamicRoot.add(coverage);

  const markerGroup = new THREE.Group();
  markerGroup.rotation.x = -Math.PI / 2;
  markerGroup.visible = false;
  dynamicRoot.add(markerGroup);

  const BORDER = 0.07;

  // Four bars around an empty middle, NOT a filled plate.
  //
  // The border used to be a solid quad the size of the whole tile, and the fill
  // sat 0.004 BELOW it -- so half of whatever colour the fill was got mixed with
  // near-black before the player saw it. Gold came out #656a44, a dark olive,
  // within dE 17 of the invalid state's dark brown: the two states were saying
  // the same thing. A ring leaves the fill alone, which is the only way the
  // fill colour means anything.
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x14202a, transparent: true, opacity: 0.5, depthTest: true, depthWrite: false
  });
  const ringBars = [];
  for (let k = 0; k < 4; k++) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMaterial);
    bar.renderOrder = 1;
    markerGroup.add(bar);
    ringBars.push(bar);
  }
  // The border keeps a constant world width at any span, so a 2x2 gets the same
  // line weight as a 1x1 rather than a doubled one.
  function sizeRing(outer) {
    const layout = [
      [outer, BORDER, 0,  (outer - BORDER) / 2],
      [outer, BORDER, 0, -(outer - BORDER) / 2],
      [BORDER, outer,  (outer - BORDER) / 2, 0],
      [BORDER, outer, -(outer - BORDER) / 2, 0]
    ];
    for (let k = 0; k < 4; k++) {
      const [w, h, x, y] = layout[k];
      ringBars[k].scale.set(w, h, 1);
      ringBars[k].position.set(x, y, 0);
    }
  }

  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthTest: true, depthWrite: false })
  );
  marker.position.z = -0.004;
  marker.renderOrder = 1;
  markerGroup.add(marker);

  // Cool for yes, warm for no.
  //
  // The old pair was gold #f2c14e against red #c2352f, which is two warm hues a
  // red-green colourblind player cannot tell apart at all -- and gold is
  // palette.crown, so a valid tile was wearing the king's own colour against the
  // rule that reserves saturated warm hues for him and the banners. Cyan is the
  // one hue the island does not already own: the grass is green, the stone is
  // grey-white, the sand is cream. Over grass these land dE 58 apart.
  const VALID_FILL = 0x4fd6e0, VALID_RING = 0x14202a;
  const DENIED_FILL = 0xe8402f, DENIED_RING = 0x3d0f0c;

  const COVERED = [1.0, 1.0, 1.0];
  const DEAD = [0.76, 0.21, 0.18];
  const BLIND = [0.16, 0.22, 0.26];

  const positions = [], colours = [];

  function quad(i, j, y, rgb) {
    const x = board.px(i), z = board.px(j), h = 0.47;
    const corners = [
      [x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h],
      [x - h, y, z - h], [x + h, y, z + h], [x - h, y, z + h]
    ];
    for (const c of corners) { positions.push(c[0], c[1], c[2]); colours.push(rgb[0], rgb[1], rgb[2]); }
  }

  return {
    show(i, j, valid, probe, span) {
      const size = span || 1;
      const y = Math.max(board.topY(i, j) + 0.025, 0.032);
      markerGroup.visible = true;
      markerGroup.position.set(board.px(i + (size - 1) / 2), y + 0.006, board.px(j + (size - 1) / 2));
      const fill = size - 0.06;
      marker.scale.set(fill, fill, 1);
      sizeRing(fill + BORDER * 2);
      marker.material.color.setHex(valid ? VALID_FILL : DENIED_FILL);
      // The two alphas differ on purpose, and the reason is the grass.
      //
      // Red laid over green desaturates toward brown, so alpha is what decides
      // whether a refusal still reads as RED. Measured over palette.grass: at
      // 0.50 this red composites to hue 24 and 38% saturation -- an orange-brown
      // that looks like a dirt patch. At 0.75 it holds hue 12 and 62%, which
      // reads as a refusal. Cyan has no such fight (green cannot drag it toward
      // brown) and stays clean at 0.50, where it still lets the tile show
      // through. The old 0.20 gave #97935f, an olive: not red at any reading.
      marker.material.opacity = valid ? 0.50 : 0.75;
      ringMaterial.opacity = 0.5;
      ringMaterial.color.setHex(valid ? VALID_RING : DENIED_RING);

      if (!valid || !probe) { coverage.visible = false; return; }

      positions.length = 0; colours.length = 0;
      for (let tj = 0; tj < board.N; tj++) {
        for (let ti = 0; ti < board.N; ti++) {
          if (!board.isLand(ti, tj)) continue;
          // The tower's own footprint is skipped. probeCoverage measures centre
          // to centre, so the tile being pointed at is distance 0 -- inside the
          // archer's 0.5 minRange -- and came back 'dead', painting RED under
          // the placement marker. That was the third of three layers turning a
          // valid tile brown, and it was never information anyone needed: no
          // tower shoots the square it stands on.
          if (ti >= i && ti < i + size && tj >= j && tj < j + size) continue;
          const verdict = probe(i, j, ti, tj);
          if (verdict === 'out') continue;
          const rgb = verdict === 'hit' ? COVERED : (verdict === 'dead' ? DEAD : BLIND);
          quad(ti, tj, board.topY(ti, tj) + 0.025, rgb);
        }
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.computeBoundingSphere();
      coverage.visible = positions.length > 0;
    },
    hide() {
      markerGroup.visible = false;
      coverage.visible = false;
    }
  };
}
