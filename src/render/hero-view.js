// Hero TD -- hero (king) view.
//
// King rig pose, hit reaction, cliff-jump poses, attack pose, landing dust,
// destination marker, and golden glow ring.

import { config } from '../config.js';
import { lerpAngle } from '../sim/angles.js';
import { applyGait } from './units.js';

const A = config.anim;

export function createHeroView(THREE, board, soft, kingRig, dynamicRoot) {
  const rig = kingRig;
  dynamicRoot.add(rig.root);

  const HIT = config.hit;
  const baseScale = rig.root.scale.x || 1;
  let hitAge = Infinity;

  const quad = new THREE.PlaneGeometry(1, 1);
  const contact = new THREE.Mesh(quad, soft.blobMat);
  contact.rotation.x = -Math.PI / 2;
  contact.scale.setScalar(0.3);
  dynamicRoot.add(contact);

  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.018, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0xf2c14e, transparent: true, opacity: 0.9,
      depthWrite: false, toneMapped: false, fog: false
    })
  );
  glow.rotation.x = Math.PI / 2;
  dynamicRoot.add(glow);

  // Health bar. Same vocabulary as the castle's (structure-view.js): a dark
  // backing plate with a green fill parented to it, depth-tested off so it is
  // never swallowed by the terrain he is standing behind, and billboarded to
  // the camera every frame. Shown only when he is hurt -- a permanent gauge
  // over the king turns the whole screen into a status readout.
  const HP_WIDTH = 0.44;
  // Clearance above the crown, whose tips reach 0.775 in rig space. Derived from
  // the rig's own scale rather than hard-coded, so resizing the king does not
  // silently leave his health bar floating a body-length over his head.
  const HP_HEIGHT = 0.775 * baseScale + 0.13;
  const hpGeo = new THREE.PlaneGeometry(HP_WIDTH, 0.07);
  const healthBar = new THREE.Mesh(hpGeo, new THREE.MeshBasicMaterial({
    color: 0x1b2226, transparent: true, opacity: 0.72, depthTest: false
  }));
  const healthFill = new THREE.Mesh(hpGeo, new THREE.MeshBasicMaterial({
    color: 0x49c96a, depthTest: false
  }));
  healthBar.renderOrder = 5; healthFill.renderOrder = 6;
  healthFill.position.z = 0.001;
  healthBar.add(healthFill);
  healthBar.visible = false;
  healthBar.frustumCulled = false;
  dynamicRoot.add(healthBar);

  const destination = new THREE.Group();
  const destinationMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff70, depthWrite: false, toneMapped: false
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.024, 5, 20),
    destinationMaterial
  );
  ring.rotation.x = Math.PI / 2;
  destination.add(ring);
  const pointer = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.28, 3),
    destinationMaterial
  );
  pointer.rotation.x = Math.PI;
  destination.add(pointer);
  destination.visible = false;
  destination.renderOrder = 4;
  dynamicRoot.add(destination);
  let destinationTime = 0;

  const dustGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const dust = Array.from({ length: 6 }, (_, k) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xcbbd9f, transparent: false, opacity: 1, depthWrite: true
    });
    const mesh = new THREE.Mesh(dustGeo, material);
    mesh.visible = false;
    dynamicRoot.add(mesh);
    return { mesh, age: Infinity, angle: k / 6 * Math.PI * 2, distance: 0.18 + (k % 2) * 0.07 };
  });
  let seenLanding = 0;

  function burstDust(x, y, z) {
    for (const puff of dust) {
      puff.age = 0;
      puff.life = 0.432 + Math.random() * 0.216;
      puff.startScale = 1.08 + Math.random() * 0.78;
      puff.x = x; puff.y = y + 0.025; puff.z = z;
      puff.mesh.position.set(puff.x, puff.y, puff.z);
      puff.mesh.scale.setScalar(puff.startScale);
      puff.mesh.material.opacity = 1;
      puff.mesh.visible = true;
    }
  }

  function updateDust(dt) {
    for (const puff of dust) {
      if (puff.age === Infinity) continue;
      puff.age += dt;
      const t = Math.min(1, puff.age / puff.life);
      const spread = puff.distance * (1 - Math.pow(1 - t, 2));
      puff.mesh.position.set(
        puff.x + Math.cos(puff.angle) * spread,
        puff.y + Math.sin(Math.PI * t) * 0.07,
        puff.z + Math.sin(puff.angle) * spread
      );
      puff.mesh.scale.setScalar(puff.startScale * (1 - t));
      puff.mesh.material.opacity = 1;
      if (t >= 1) { puff.mesh.visible = false; puff.age = Infinity; }
    }
  }

  function applyCliffPose(phase, t) {
    if (!phase) return;
    if (phase === 'anticipate') {
      const crouch = Math.sin(t * Math.PI / 2);
      rig.joints.bob.position.y -= 0.075 * crouch;
      rig.joints.torso.rotation.x = 0.16 * crouch;
      rig.joints.hips[0].rotation.x = rig.joints.hips[1].rotation.x = -0.34 * crouch;
      rig.joints.shoulders[0].rotation.x = rig.joints.shoulders[1].rotation.x = 0.22 * crouch;
      return;
    }
    if (phase === 'airborne') {
      const tuck = Math.sin(t * Math.PI);
      rig.joints.hips[0].rotation.x = -0.48 * tuck;
      rig.joints.hips[1].rotation.x = -0.32 * tuck;
      rig.joints.shoulders[0].rotation.x = 0.38 * tuck;
      rig.joints.shoulders[1].rotation.x = 0.25 * tuck;
      rig.joints.torso.rotation.x = -0.1 * tuck;
      return;
    }
    const crouch = 1 - t;
    rig.joints.bob.position.y -= 0.1 * crouch;
    rig.joints.torso.rotation.x = 0.24 * crouch;
    rig.joints.hips[0].rotation.x = rig.joints.hips[1].rotation.x = -0.5 * crouch;
    rig.joints.shoulders[0].rotation.x = rig.joints.shoulders[1].rotation.x = 0.25 * crouch;
  }

  function applyAttackPose(hero, facing) {
    const bow = rig.bow;
    const windup = config.hero.attackWindup;
    const recovery = config.hero.attackRecovery;

    if (hero.attackTime < 0) {
      bow.rotation.y = Math.PI / 2;
      rig.setBowDraw(0);
      return;
    }

    const aimDelta = Math.atan2(
      Math.sin(hero.attackAim - facing), Math.cos(hero.attackAim - facing)
    );

    let draw;
    if (hero.attackTime < windup) {
      const wt = Math.min(1, hero.attackTime / windup);
      if (wt < 0.38) {
        const r = wt / 0.38;
        draw = 0.55 * (1 - (1 - r) * (1 - r) * (1 - r));
      } else {
        const s = (wt - 0.38) / 0.62;
        draw = 0.55 + 0.45 * s * s;
      }
    } else {
      const rt = Math.min(1, (hero.attackTime - windup) / (recovery * 0.4));
      draw = (1 - rt) * (1 - rt);
    }

    rig.setBowDraw(draw);

    rig.joints.torso.rotation.y += Math.max(-1.0, Math.min(1.0, aimDelta)) * 1.15 * draw;
    rig.joints.torso.rotation.x -= 0.15 * draw;
    const releaseT = hero.attackTime < windup ? 0
      : Math.min(1, (hero.attackTime - windup) / Math.max(0.001, recovery * 0.22));
    rig.joints.torso.position.z = hero.attackTime < windup
      ? -0.035 * draw
      : 0.05 * Math.sin(Math.PI * releaseT);
    rig.joints.bob.position.y -= 0.018 * Math.sin(Math.PI * releaseT);
    rig.joints.shoulders[1].rotation.x -= 1.7 * draw;
    rig.joints.shoulders[1].rotation.z -= 0.3 * draw;
    rig.joints.shoulders[0].rotation.x -= 1.15 * draw;
    rig.joints.shoulders[0].rotation.y -= 1.4 * draw;
    rig.joints.shoulders[0].rotation.z += 0.35 * draw;

    bow.rotation.y = Math.PI / 2 + Math.max(-1.2, Math.min(1.2, aimDelta)) * 0.9 * draw;
  }

  function sync(world, alpha, elapsed, camera) {
    const hero = world.hero;
    rig.root.visible = hero.alive;
    const airborne = hero.jumpPhase === 'airborne';
    contact.visible = hero.alive && !airborne;
    glow.visible = hero.alive && !airborne;
    updateDust(world.paused ? 0 : elapsed);
    if (hero.goal) {
      destinationTime += elapsed;
      const goalTier = board.at(hero.goal.i, hero.goal.j);
      const targetY = board.walkElevation(hero.goal.x, hero.goal.z, goalTier, false).y;
      destination.visible = true;
      destination.position.set(board.px(hero.goal.x), targetY + 0.02, board.px(hero.goal.z));
      pointer.position.y = 0.30 + Math.sin(destinationTime * 3.2) * 0.055;
      pointer.rotation.y = destinationTime * 3.8;
    } else {
      destination.visible = false;
    }
    if (!hero.alive) { healthBar.visible = false; return; }

    const x = hero.px + (hero.x - hero.px) * alpha;
    const z = hero.pz + (hero.z - hero.pz) * alpha;
    const y = hero.py + (hero.y - hero.py) * alpha;
    const facing = world.phase === 'intro'
      ? hero.facing
      : lerpAngle(hero.pFacing, hero.facing, alpha);
    const gait = lerpAngle(hero.pGait, hero.gaitPhase, alpha);

    const wx = board.px(x), wz = board.px(z);
    if (!world.paused) hitAge += elapsed;
    if (hitAge < HIT.heroSeconds) {
      const punch = Math.sin(Math.PI * (hitAge / HIT.heroSeconds));
      rig.root.scale.setScalar(baseScale * (1 + HIT.heroSwell * punch));
    } else {
      rig.root.scale.setScalar(baseScale);
    }
    rig.root.position.set(wx, y, wz);
    rig.root.rotation.y = facing;
    const groundY = board.groundYAt(x, z);
    contact.position.set(wx, groundY + 0.012, wz);
    glow.position.set(wx, groundY + 0.016, wz);

    const hurt = hero.hp < hero.maxHp && world.phase !== 'INTRO';
    healthBar.visible = hurt;
    if (hurt && camera) {
      healthBar.position.set(wx, y + HP_HEIGHT, wz);
      healthBar.quaternion.copy(camera.quaternion);
      const ratio = Math.max(0, Math.min(1, hero.hp / hero.maxHp));
      healthFill.scale.x = ratio;
      // Scaling a centred plane eats both ends, so walk it back left by half of
      // what was lost and the bar drains from the right like the castle's.
      healthFill.position.x = -HP_WIDTH * (1 - ratio) / 2;
    }

    if (hero.landingSerial !== seenLanding) {
      seenLanding = hero.landingSerial;
      burstDust(wx, groundY, wz);
    }

    const speed01 = hero.moving ? Math.min(1, hero.speed / config.hero.speed) : 0;
    for (const shoulder of rig.joints.shoulders) {
      shoulder.rotation.y = 0;
      shoulder.rotation.z = 0;
    }
    applyGait(rig.joints, gait, speed01, world.time * A.IDLE_RATE, A.stride);
    rig.joints.bob.rotation.z *= 0.5;
    rig.joints.torso.position.z = 0;
    if (hero.jumpPhase) {
      rig.setBowDraw(0);
      applyCliffPose(hero.jumpPhase, hero.jumpT);
    } else applyAttackPose(hero, facing);
  }

  return {
    sync,
    hit() { hitAge = 0; },
  };
}
