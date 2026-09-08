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
  const effectScale = new THREE.Vector3();

  // Purely cosmetic pickups: the sim has already credited the gold and
  // dropped the coin from its own list by the time `collect` fires (see
  // coins.js), so these live only here and never feed back into gameplay.
  // It carries no position of its own -- every frame it just reads wherever
  // the king currently is, so it rides along with him rather than the spot
  // he happened to be standing when he picked it up.
  const C = config.economy.coin.collect;
  const effects = [];
  let nextEffectId = 1;

  function collect() {
    effects.push({ id: nextEffectId++, age: 0 });
  }

  function sync(world, alpha, elapsed) {
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

    if (effects.length) {
      // The ground plane is x/z here (y is height) -- blended the same way
      // main.js blends the king for the camera, so the coin tracks his actual
      // rendered position rather than lagging a sim step behind.
      const hero = world.hero;
      const heroX = hero.px + (hero.x - hero.px) * alpha;
      const heroZ = hero.pz + (hero.z - hero.pz) * alpha;
      for (let k = effects.length - 1; k >= 0; k--) {
        const fx = effects[k];
        fx.age += elapsed || 0;
        if (fx.age >= C.duration || count >= CAP) { effects.splice(k, 1); continue; }
        const progress = fx.age / C.duration;
        // Quick rise that eases into its peak. Independent of the shrink
        // timer below, so it keeps climbing through the hold.
        const riseEase = 1 - Math.pow(1 - progress, 2);
        const lift = C.headClearance * riseEase;
        // Holds full size until shrinkDelay, then shrinks over what is left
        // of the animation, accelerating toward the end.
        const shrinkProgress = Math.max(0, fx.age - C.shrinkDelay) / (C.duration - C.shrinkDelay);
        const scale = Math.max(0, 1 - shrinkProgress * shrinkProgress);
        // Only height (y) animates on its own; x/z is wherever the king is
        // THIS frame, not where he was when the coin was collected.
        position.set(board.px(heroX), board.groundYAt(heroX, heroZ) + lift, board.px(heroZ));
        euler.set(Math.PI / 2, world.time * C.spinSpeed + fx.id, 0);
        quaternion.setFromEuler(euler);
        effectScale.setScalar(scale);
        matrix.compose(position, quaternion, effectScale);
        mesh.setMatrixAt(count++, matrix);
      }
    }

    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  }

  return { sync, collect };
}
