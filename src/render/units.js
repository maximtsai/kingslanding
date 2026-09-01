// Hero TD -- the dynamic unit view.
//
// Reads world state and never writes to it (TDD 17). Owns the procedural gait of
// TDD section 15 and the instanced draw path that keeps forty units affordable.
//
// INSTANCING, AND WHY IT LOOKS LIKE THIS
//
// A soldier is nine or ten little boxes. Drawn as objects that is ten draw calls
// per unit, and at the design ceiling of forty units the scene measured 656 draw
// calls -- most of them people. Section 15's performance note calls for one
// InstancedMesh per *body part* rather than fewer body parts, and that is what
// this is: all forty left legs are one draw, all forty helmets another.
//
// The trick that makes it cheap is that the animator was already computing a
// transform for every joint of every unit. Instancing only changes where that
// transform is written. So there is exactly ONE rig per enemy type -- a template
// that lives outside the scene graph -- and each frame it is posed once per unit,
// its world matrices are read out into the instance buffers, and it is posed
// again for the next unit. No per-unit scene nodes exist at all.

import { config } from '../config.js';
import { lerpAngle } from '../sim/angles.js';

const A = config.anim;

// Gait amplitude is expressed relative to a reference walking speed rather than
// in absolute tiles/second, so retuning one enemy's speed does not silently
// rescale everybody's animation.
const REFERENCE_SPEED = config.enemies.grunt.speed;

// Contact-blob size per unit of rig scale. The blob used to be a fixed 0.24 for
// a grunt, scaled between types by the RATIO of their rig scales -- which meant
// the global UNIT_SIZE_MULTIPLIER cancelled out of it entirely, and making every
// enemy larger left its shadow behind at the old size. Expressed against the
// absolute scale instead, the shadow follows the figure.
//
// 0.4638 is 0.24 / (0.45 * 1.15): the coefficient that reproduces exactly the
// blob every type had before, so this refactor changed nothing on its own.
const BLOB_PER_SCALE = 0.4638;

// The gait itself. Pure: joints in, rotations out, no state of its own.
//
//   gait     radians, advanced by distance travelled (see sim/enemies.js)
//   speed01  0 at a standstill, 1 at reference walking speed
//   idleT    a slow independent clock, so a crowd standing still does not
//            breathe in unison
export function applyGait(joints, gait, speed01, idleT, style) {
  const G = style || A.run;
  const swing = Math.sin(gait);
  const lift = Math.cos(gait);
  const legAmp = G.LEG_SWING * speed01;
  const armAmp = legAmp * G.ARM_RATIO;

  // Legs in opposition; arms counter-swing against the leg on their own side.
  // Positive hip rotation trails the leg BEHIND the body, so leg 0 is trailing
  // while sin(gait) > 0 and leading while it is negative.
  joints.hips[0].rotation.x = swing * legAmp;
  joints.hips[1].rotation.x = -swing * legAmp;
  joints.shoulders[0].rotation.x = -swing * armAmp;
  joints.shoulders[1].rotation.x = swing * armAmp * A.SPEAR_DAMP;

  // KNEES ARE WHAT MAKE IT A RUN. A leg that scissors straight through reads as
  // a mannequin sliding along; the tell of a run is the trailing leg folding up
  // under the body and snapping out again.
  //
  // Flexion is added ONLY over the recovery half -- the trailing-to-leading
  // transit -- and peaks as the leg passes underneath. For leg 0 that transit
  // runs gait pi/2 to 3pi/2, whose midpoint is where cos(gait) = -1, so
  // max(0, -cos) is exactly the window and exactly the shape. Leg 1 is the same
  // window half a cycle away. Clamping at zero leaves the stance half rigid,
  // which is what a leg carrying weight actually does.
  if (joints.knees && G.KNEE_FLEX) {
    const flex = G.KNEE_FLEX * speed01;
    const base = joints.kneeBase;
    joints.knees[0].rotation.x = base + Math.max(0, -lift) * flex;
    joints.knees[1].rotation.x = base + Math.max(0, lift) * flex;
  }

  // Bounce runs at twice stride frequency: one rise per footfall, not per stride.
  //
  // TWO THINGS ARE GOING ON HERE, and they were found by walking the cycle
  // through on paper rather than by looking at it.
  //
  // PHASE. This used to be (1 - cos(2*gait)), which peaks at gait pi/2 and
  // 3pi/2 -- the extremes of the leg swing, when the legs are at full split and
  // the hips are at their LOWEST. It lifted the body at exactly the moment it
  // should have been dropping. cos(2*gait) peaks at the passing positions
  // instead, where the support leg is straight and vertical and the hip
  // genuinely is highest.
  //
  // CENTRED, not all-positive. There is no foot IK: a foot's height is whatever
  // the hip and the leg pose put it at, so raising the body raises the feet with
  // it. An all-positive bounce that peaks at the passing position therefore
  // lifts the whole figure off the ground exactly when its support leg is
  // longest -- measured at 0.0096 world units, about 0.7 of a screen pixel at
  // play size, and it never plants at any point in the cycle. Centring the
  // oscillation on zero drops the split phase by as much as it raises the
  // passing phase, which brings the lowest foot to -0.0010 (0.08px, i.e.
  // planted) while keeping the corrected phase above.
  //
  // It costs nothing at rest, because the whole term is scaled by speed01: a
  // standing figure is not pulled down into the ground.
  const idle = Math.sin(idleT);
  const rest = (1 - speed01) * A.IDLE_SCALE;
  joints.bob.position.y =
    Math.cos(gait * 2) * 0.5 * G.BOUNCE * speed01 + idle * G.BOUNCE * rest;
  joints.bob.rotation.z = swing * G.SWAY * speed01;

  // Torso counter-rotates against the arms, leans into the run, and breathes
  // when idle. The lean is positive because a figure faces +z at zero yaw, so
  // positive pitch about x carries the head forward -- into the direction of
  // travel. It rides on top of any fixed stoop the rig has, which lives in its
  // own group precisely so this can overwrite torso.rotation without erasing it.
  joints.torso.rotation.y = -swing * G.YAW * speed01;
  joints.torso.rotation.x = idle * 0.12 * rest + G.LEAN * speed01;
}

export function createUnitView(THREE, board, soft, rigs, dynamicRoot) {
  // Living enemies remain capped at MAX_ENEMIES, but recently killed bodies can
  // overlap later spawns during their four-second presentation window.
  const UNIT_CAP = config.MAX_ENEMIES * 3;
  const BLOB_CAP = config.MAX_ENEMIES;
  const H = config.hit;

  // Hit reactions, keyed by unit id. Render-only state: the simulation says a
  // unit was hurt and this decides what that looks like, which is the same
  // division of labour as everywhere else (TDD 17). Entries expire on their own
  // and are dropped with the level, so a wave's casualties cannot accumulate.
  const reactions = new Map();

  // One kit per enemy type: a template rig kept out of the scene, plus an
  // InstancedMesh for each mesh the template contains.
  const kits = new Map();
  const scratch = new THREE.Matrix4();

  function kitFor(type) {
    const existing = kits.get(type);
    if (existing) return existing;

    const template = rigs.build(type);
    template.root.updateMatrixWorld(true);

    // Traversal order is stable (depth-first, insertion order), so node N of the
    // template always corresponds to instanced mesh N.
    const parts = [];
    template.root.traverse(node => {
      if (!node.isMesh) return;
      const instanced = new THREE.InstancedMesh(node.geometry, node.material, UNIT_CAP);
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The instances move every frame and the bounding sphere would have to be
      // recomputed to be worth anything; culling forty small figures is not.
      instanced.frustumCulled = false;
      instanced.count = 0;
      dynamicRoot.add(instanced);
      parts.push({ instanced, node });
    });

    const kit = { template, parts, count: 0 };
    kits.set(type, kit);
    return kit;
  }

  // Contact blobs, likewise one draw for the lot.
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), soft.blobMat, BLOB_CAP);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.frustumCulled = false;
  blobs.count = 0;
  dynamicRoot.add(blobs);

  const FLAT = new THREE.Euler(-Math.PI / 2, 0, 0);
  const flatQuat = new THREE.Quaternion().setFromEuler(FLAT);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  let drawn = 0;

  function applyDeathPose(root, joints, age, side) {
    const fallT = Math.min(1, age / A.DEATH_FALL);
    const fall = 1 - Math.pow(1 - fallT, 3);
    const sinkT = Math.max(0, Math.min(1,
      (age - A.DEATH_SINK_DELAY) / A.DEATH_SINK_DURATION
    ));
    const sink = sinkT * sinkT * (3 - 2 * sinkT);

    // Fall backward around the feet, briefly canting to alternating sides so a
    // group does not collapse in mechanical unison.
    root.rotation.x = -Math.PI / 2 * fall;
    root.rotation.z = Math.sin(fallT * Math.PI) * 0.1 * side;
    root.position.y -= A.DEATH_SINK_DEPTH * sink;

    joints.bob.position.y = 0;
    joints.bob.rotation.z = 0;
    joints.torso.rotation.x = 0;
    joints.torso.rotation.y = 0;
    joints.hips[0].rotation.x = joints.hips[1].rotation.x = 0;
    joints.hips[0].rotation.z = -0.12 * fall;
    joints.hips[1].rotation.z = 0.12 * fall;
    // Back to the rig's resting bend, or the corpse keeps whichever mid-stride
    // flexion the last live frame happened to leave in the joint.
    if (joints.knees) {
      joints.knees[0].rotation.x = joints.knees[1].rotation.x = joints.kneeBase;
    }
    joints.shoulders[0].rotation.x = joints.shoulders[1].rotation.x = 0;
    joints.shoulders[0].rotation.z = -1.25 * fall;
    joints.shoulders[1].rotation.z = 1.25 * fall;
  }

  // ---- the swing (TDD 10) --------------------------------------------------
  //
  // Wind up, strike, recover. `age` is the simulation's swing clock, so the
  // pose and the damage are driven by the same number and the blow lands on the
  // frame the arm arrives -- which is the entire point of giving the sim a
  // windup rather than animating one on top of instant damage.
  //
  // These units have no arm meshes, so the swing is carried by three things
  // that are visible: the weapon (parented to the right shoulder pivot), the
  // torso twisting against it, and the whole body lunging into the blow.
  // Returns how far forward to shove the root, since only the caller knows
  // where in the world the unit is.
  // SIGNS MATTER HERE, and they were backwards. The weapon hangs entirely ABOVE
  // the shoulder pivot, so a POSITIVE rotation about x carries it FORWARD and a
  // negative one draws it back. The windup must therefore be negative -- blade
  // back over the shoulder -- and the blow a positive sweep that brings the
  // blade forward and down through the target.
  //
  // With the old values (raise +1.25, follow -0.85) the blade went forward on
  // the windup and backward on the blow, which read exactly as it was: the unit
  // shoving the butt of its sword at the wall.
  const SWING_RAISE = -1.05;    // rad, blade drawn back over the shoulder
  const SWING_CONTACT = 1.00;   // rad, where the blade is when the blow LANDS
  const SWING_FOLLOW = 1.55;    // rad, where the follow-through carries it to
  const SWING_TWIST = 0.30;     // rad, torso counter-twist during the windup
  const SWING_RAISE_FRAC = 0.45; // of the windup spent drawing back
  const SWING_FOLLOW_FRAC = 0.28; // of the recovery spent completing the arc
  const SWING_LUNGE = 0.07;     // tiles, forward shove at the moment of contact

  // THE BLADE HAS TO BE THROUGH THE TARGET AT `attackWindup`, not starting for
  // it. The simulation lands damage at that instant, so if the pose only begins
  // its forward sweep there, the blow connects while the sword is still behind
  // the unit -- measured at 0.19 of a tile behind the hand at the frame the
  // building took the hit.
  //
  // So the windup is split: the draw-back occupies the first 62% of it and the
  // sweep runs through the remaining 38%, arriving forward exactly on contact.
  // The recovery then carries the arc past the target and settles.
  function applySwingPose(joints, age, spec) {
    const W = spec.attackWindup, R = spec.attackRecovery;
    const drawTo = W * SWING_RAISE_FRAC;
    let shoulder, twist, lunge = 0, drop = 0;

    if (age < drawTo) {
      // DRAW BACK. Ease-out, so the weapon comes up fast and then hangs at the
      // top for a beat -- the hang is what makes the strike read as a decision
      // rather than a twitch.
      const p = Math.min(1, age / drawTo);
      const raise = 1 - (1 - p) * (1 - p) * (1 - p);
      shoulder = SWING_RAISE * raise;
      twist = SWING_TWIST * raise;
    } else if (age < W) {
      // THE BLOW TRAVELLING. Mildly accelerating -- fastest at contact, but not
      // so back-loaded that the sword crosses from behind the unit to in front
      // of it inside a single frame, which a plain k*k did: the sweep window is
      // only a tenth of a second, so the curve has to spend it rather than
      // save it.
      const k = (age - drawTo) / (W - drawTo);
      const e = k * (0.4 + 0.6 * k);
      shoulder = SWING_RAISE + (SWING_CONTACT - SWING_RAISE) * e;
      twist = SWING_TWIST + (-0.22 - SWING_TWIST) * e;
      drop = e;
    } else {
      const q = Math.min(1, (age - W) / R);
      if (q < SWING_FOLLOW_FRAC) {
        // FOLLOW THROUGH past the target rather than stopping dead on it.
        const k = q / SWING_FOLLOW_FRAC;
        shoulder = SWING_CONTACT + (SWING_FOLLOW - SWING_CONTACT) * k * (2 - k);
        twist = -0.22;
        drop = 1;
      } else {
        // RECOVERY. Settles back to rest quadratically, slowest at the end.
        const r = (q - SWING_FOLLOW_FRAC) / (1 - SWING_FOLLOW_FRAC);
        shoulder = SWING_FOLLOW * (1 - r * r);
        twist = -0.22 * (1 - r * r);
        drop = 1 - r;
      }
      lunge = SWING_LUNGE * Math.max(0, 1 - q / 0.5);
    }

    // Written on top of whatever applyGait just put there, and only on the
    // weapon arm: the empty shoulder keeps walking.
    joints.shoulders[1].rotation.x = shoulder;
    joints.torso.rotation.y += twist;
    joints.bob.position.y -= 0.022 * drop;
    return lunge;
  }

  function applyDisembarkPose(joints, t) {
    const tuck = Math.sin(Math.PI * t);
    // Knees fold with the tuck: a jump with straight legs reads as a plank
    // being tipped off the boat.
    if (joints.knees) {
      const bend = joints.kneeBase + 0.7 * tuck;
      joints.knees[0].rotation.x = joints.knees[1].rotation.x = bend;
    }
    joints.hips[0].rotation.x = joints.hips[1].rotation.x = -0.5 * tuck;
    joints.shoulders[0].rotation.x = joints.shoulders[1].rotation.x = 0.28 * tuck;
    joints.torso.rotation.x = -0.16 * tuck;
    joints.bob.position.y -= 0.035 * tuck;
  }

  // alpha is the fraction of a sim step already elapsed (see sim/loop.js).
  function sync(world, alpha, elapsed) {
    for (const kit of kits.values()) kit.count = 0;
    let blobCount = 0;
    let unitCount = 0;

    if (!world.paused && reactions.size) {
      for (const [id, r] of reactions) {
        r.age += elapsed;
        if (r.age >= H.seconds) reactions.delete(id);
      }
    }

    for (const u of world.units) {
      const kit = kitFor(u.type);

      // Interpolate between the previous and current sim states.
      const x = u.px + (u.x - u.px) * alpha;
      const z = u.pz + (u.z - u.pz) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      const facing = lerpAngle(u.pFacing, u.facing, alpha);
      const gait = lerpAngle(u.pGait, u.gaitPhase, alpha);
      const wx = board.px(x), wz = board.px(z);

      // Pose the one template for this unit, then read it out.
      //
      // A unit that has just been hit swells and is shoved back along the line
      // of the blow. One arch over the reaction's life -- sin() rather than a
      // linear decay, so it returns to rest smoothly instead of snapping.
      const root = kit.template.root;
      const reaction = u.alive ? reactions.get(u.id) : null;
      if (reaction) {
        const punch = Math.sin(Math.PI * Math.min(1, reaction.age / H.seconds));
        root.scale.setScalar(rigs.scaleOf(u.type) * (1 + H.swell * punch));
        root.position.set(
          wx + reaction.dx * H.recoil * punch * board.TILE,
          y + A.ENEMY_LIFT,
          wz + reaction.dz * H.recoil * punch * board.TILE
        );
      } else {
        root.scale.setScalar(rigs.scaleOf(u.type));
        root.position.set(wx, y + A.ENEMY_LIFT, wz);
      }
      root.rotation.order = 'YXZ';
      root.rotation.set(0, facing, 0);
      for (const shoulder of kit.template.joints.shoulders) {
        shoulder.rotation.y = 0;
        shoulder.rotation.z = 0;
      }
      for (const hip of kit.template.joints.hips) {
        hip.rotation.y = 0;
        hip.rotation.z = 0;
      }

      // Amplitude scales with speed, so a brute at 0.6 reads as heavy rather
      // than as a grunt in slow motion. A unit that is not moving -- attacking,
      // or still riding a boat -- falls through to the idle pose.
      const speed01 = u.moving ? Math.min(1, u.speed / REFERENCE_SPEED) : 0;
      applyGait(kit.template.joints, gait, speed01, world.time * A.IDLE_RATE + u.id, A.run);

      // A blow in progress overrides the walk from the waist up. Backdated by
      // the un-elapsed part of the current sim step, the same way the death
      // clock is, so the strike does not land a frame early at high refresh.
      if (u.alive && u.swing) {
        const spec = config.enemies[u.type];
        const swingAge = Math.max(0, u.swing.t - (1 - alpha) / config.sim.HZ);
        const lunge = applySwingPose(kit.template.joints, swingAge, spec);
        if (lunge) {
          root.position.x += Math.sin(facing) * lunge * board.TILE;
          root.position.z += Math.cos(facing) * lunge * board.TILE;
        }
      }

      if (u.disembark) {
        const jumpAge = Math.max(0, u.disembark.elapsed - (1 - alpha) / config.sim.HZ);
        applyDisembarkPose(kit.template.joints,
          Math.min(1, jumpAge / config.waves.disembarkSeconds));
      }
      if (!u.alive) {
        const age = Math.max(0, u.deathAge - (1 - alpha) / config.sim.HZ);
        applyDeathPose(root, kit.template.joints, age, u.id % 2 ? 1 : -1);
      }
      root.updateMatrixWorld(true);

      const slot = kit.count;
      if (slot < UNIT_CAP) {
        for (const part of kit.parts) part.instanced.setMatrixAt(slot, part.node.matrixWorld);
        kit.count++;
        unitCount++;
      }

      // The blob sits on the ground, not on the bouncing body, so it stays put
      // while the figure rises off it.
      if (u.alive && !u.disembark && blobCount < BLOB_CAP) {
        const size = rigs.scaleOf(u.type) * BLOB_PER_SCALE;
        position.set(wx, y + config.board.SINK + 0.012, wz);
        scale.set(size, size, size);
        scratch.compose(position, flatQuat, scale);
        blobs.setMatrixAt(blobCount++, scratch);
      }
    }

    for (const kit of kits.values()) {
      for (const part of kit.parts) {
        part.instanced.count = kit.count;
        if (kit.count) part.instanced.instanceMatrix.needsUpdate = true;
      }
    }
    blobs.count = blobCount;
    if (blobCount) blobs.instanceMatrix.needsUpdate = true;
    drawn = unitCount;
  }

  return {
    sync,
    get count() { return drawn; },

    // Called by feedback.js when the simulation reports a unit taking damage.
    // `source` is whatever dealt it and may be absent -- splash has no single
    // direction, so it becomes a straight swell with no shove.
    hit(unit, source) {
      if (!unit || !unit.alive) return;
      let dx = 0, dz = 0;
      if (source && typeof source.x === 'number') {
        dx = unit.x - source.x; dz = unit.z - source.z;
        const span = Math.hypot(dx, dz);
        if (span > 1e-4) { dx /= span; dz /= span; } else { dx = 0; dz = 0; }
      }
      reactions.set(unit.id, { age: 0, dx, dz });
    },

    clearReactions() { reactions.clear(); }
  };
}
