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

  const outline = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x14202a, transparent: true, opacity: 0.5, depthTest: true, depthWrite: false })
  );
  outline.renderOrder = 1;
  markerGroup.add(outline);

  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthTest: true, depthWrite: false })
  );
  marker.position.z = -0.004;
  marker.renderOrder = 1;
  markerGroup.add(marker);

  const BORDER = 0.07;

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
      outline.scale.set(fill + BORDER * 2, fill + BORDER * 2, 1);
      marker.material.color.setHex(valid ? 0xf2c14e : 0xc2352f);
      marker.material.opacity = valid ? 0.42 : 0.20;
      outline.material.opacity = 0.5;
      outline.material.color.setHex(valid ? 0x14202a : 0x3d0f0c);

      if (!valid || !probe) { coverage.visible = false; return; }

      positions.length = 0; colours.length = 0;
      for (let tj = 0; tj < board.N; tj++) {
        for (let ti = 0; ti < board.N; ti++) {
          if (!board.isLand(ti, tj)) continue;
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
