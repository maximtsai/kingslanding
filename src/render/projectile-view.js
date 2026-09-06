// Hero TD -- projectile view.
//
// Arrow shafts, molotov bottles/halos, and water ripple effects.

import { config } from '../config.js';

export function createProjectileView(THREE, board, dynamicRoot) {
  const CAP = 256;
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shaftGeometry = new THREE.BoxGeometry(0.022, 0.022, 0.36);
  const shaftMaterial = arrowMaterial;
  const shaft = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, CAP);

  const bottleGeometry = new THREE.BoxGeometry(0.075, 0.11, 0.075);
  const bottle = new THREE.InstancedMesh(
    bottleGeometry, new THREE.MeshBasicMaterial({ color: 0xff5a22 }), CAP);
  const haloGeometry = new THREE.BoxGeometry(0.15, 0.19, 0.15);
  const halo = new THREE.InstancedMesh(
    haloGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xff2a08, transparent: true, opacity: 0.38, depthWrite: false
    }), CAP);

  const meshes = [shaft];
  const flameMeshes = [bottle, halo];
  for (const mesh of [...meshes, ...flameMeshes]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    dynamicRoot.add(mesh);
  }

  const rippleGeometry = new THREE.TorusGeometry(0.18, 0.012, 4, 24);
  const ripplePool = Array.from({ length: 12 }, () => {
    const group = new THREE.Group();
    const makeRing = () => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false
      });
      const ring = new THREE.Mesh(rippleGeometry, material);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      return ring;
    };
    const effect = { group, outer: makeRing(), inner: makeRing() };
    group.visible = false;
    group.renderOrder = 3;
    dynamicRoot.add(group);
    return effect;
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);

  function sync(world, alpha) {
    let count = 0;
    let lit = 0;
    for (const p of world.combat.projectiles) {
      if (count >= CAP) break;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      const y = p.py + (p.y - p.py) * alpha;

      if (p.kind === 'molotov') {
        if (lit >= CAP) continue;
        const spin = (world.time + p.id) * 9;
        euler.set(spin, spin * 0.6, 0, 'YXZ');
        quaternion.setFromEuler(euler);
        position.set(board.px(x), y, board.px(z));
        matrix.compose(position, quaternion, one);
        for (const mesh of flameMeshes) mesh.setMatrixAt(lit, matrix);
        lit++;
        continue;
      }
      const impactScale = p.state === 'grounded' || p.state === 'embedded' ? 0.5 : 1;

      const dx = p.dirX, dz = p.dirZ, dy = p.dirY;
      const ground = Math.hypot(dx, dz);
      euler.set(-Math.atan2(dy, ground), Math.atan2(dx, dz), 0, 'YXZ');
      quaternion.setFromEuler(euler);
      position.set(board.px(x), y, board.px(z));
      const arrowScale = new THREE.Vector3(impactScale, impactScale, impactScale);
      matrix.compose(position, quaternion, arrowScale);
      for (const mesh of meshes) mesh.setMatrixAt(count, matrix);
      count++;
    }
    for (const mesh of meshes) {
      mesh.count = count;
      if (count) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of flameMeshes) {
      mesh.count = lit;
      if (lit) mesh.instanceMatrix.needsUpdate = true;
    }

    let rippleCount = 0;
    for (const ripple of world.combat.ripples) {
      if (rippleCount >= ripplePool.length) break;
      const effect = ripplePool[rippleCount++];
      const t = Math.min(1, ripple.age / ripple.life);
      effect.group.visible = true;
      effect.group.position.set(board.px(ripple.x), 0.018, board.px(ripple.z));
      effect.outer.scale.setScalar(0.4 + t * 3.15);
      effect.outer.material.opacity = (1 - t) * (1 - t) * 0.68;
      const innerT = Math.max(0, (t - 0.16) / 0.84);
      effect.inner.visible = t >= 0.16;
      effect.inner.scale.setScalar(0.35 + innerT * 2.4);
      effect.inner.material.opacity = (1 - innerT) * (1 - innerT) * 0.42;
    }
    for (; rippleCount < ripplePool.length; rippleCount++) {
      ripplePool[rippleCount].group.visible = false;
    }
  }

  return { sync };
}
