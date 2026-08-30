// Hero TD -- coins.
//
// TDD section 12. Kill gold does not land in the purse; it drops where the body
// fell and the king collects it by walking over it.
//
// The design note that matters: "Manual pickup is a feel-good mechanic and a
// reason to move during lulls, never a requirement." So a coin is worth the same
// whether he walks to it or not -- anything still lying about when the wave
// clears flies to him automatically. What the drop buys is a pull toward the
// fighting during a quiet moment, not a tax on players who ignore it.

import { config } from '../config.js';

const C = config.economy.coin;

export function createCoins(world) {
  const list = [];
  let nextId = 1;

  function drop(x, z, value) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * C.scatter;
    list.push({
      id: nextId++,
      x: x + Math.cos(angle) * distance,
      z: z + Math.sin(angle) * distance,
      px: x, pz: z,
      value,
      // A coin bounces up out of the body and settles, which is what stops a
      // kill from just making a number change somewhere.
      hop: 1,
      flying: false
    });
  }

  function collect(coin, index) {
    world.gold += coin.value;
    world.events.push({ type: 'coinCollected', value: coin.value, x: coin.x, z: coin.z });
    list.splice(index, 1);
  }

  function step(dt) {
    const hero = world.hero;
    for (let k = list.length - 1; k >= 0; k--) {
      const coin = list[k];
      coin.px = coin.x; coin.pz = coin.z;
      if (coin.hop > 0) coin.hop = Math.max(0, coin.hop - dt * 2.2);

      if (!hero.alive) continue;
      const dx = hero.x - coin.x, dz = hero.z - coin.z;
      const distance = Math.hypot(dx, dz);

      if (distance <= C.pickupRadius) { collect(coin, k); continue; }

      // Drift toward him once he is close, so the pickup feels generous rather
      // than like threading a needle. The end-of-wave sweep uses the same path
      // at a much higher speed.
      const speed = coin.flying ? C.flySpeed : (distance <= C.magnetRadius ? C.magnetSpeed : 0);
      if (speed > 0) {
        const move = Math.min(speed * dt, distance);
        coin.x += (dx / distance) * move;
        coin.z += (dz / distance) * move;
      }
    }
  }

  return {
    list, drop, step,
    // Called when a wave clears. The gold is credited IMMEDIATELY -- that is
    // what makes manual pickup optional rather than a tax -- and the coin is
    // then set flying purely so the player sees where it went. Its value is
    // zeroed so arriving cannot pay twice.
    sweep() {
      for (const coin of list) {
        world.gold += coin.value;
        coin.value = 0;
        coin.flying = true;
      }
      world.events.push({ type: 'coinSweep', count: list.length });
    },
    // Between levels, or on a restart, uncollected gold simply ceases to exist.
    clear() { list.length = 0; },
    get pending() { return list.reduce((sum, c) => sum + c.value, 0); }
  };
}
