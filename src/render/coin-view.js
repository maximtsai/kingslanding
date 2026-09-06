// Hero TD -- coin view.
//
// Spinning gold coin instances for dropped and auto-collected pickups.

import { config } from '../config.js';
import { palette } from './palette.js';

export function createCoinView(THREE, board, dynamicRoot) {
  const CAP = 128;
  const geometry = new THREE.CylinderGeometry(0.117, 0.117, 0.0325, 7);
  const material = new THREE.MeshLambertMaterial({ color: palette.crown });
  const mesh = new THREE.InstancedMesh(geometry, material, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  dynamicRoot.add(mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);

  function sync(world, alpha) {
    let count = 0;
    for (const coin of world.coins.list) {
      if (count >= CAP) break;
      const x = coin.px + (coin.x - coin.px) * alpha;
      const z = coin.pz + (coin.z - coin.pz) * alpha;
      const lift = 0.12 + Math.sin(coin.hop * Math.PI) * config.economy.coin.hopHeight;
      position.set(board.px(x), board.groundYAt(x, z) + lift, board.px(z));
      euler.set(Math.PI / 2, world.time * 3.2 + coin.id, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, one);
      mesh.setMatrixAt(count++, matrix);
    }
    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  }

  return { sync };
}
