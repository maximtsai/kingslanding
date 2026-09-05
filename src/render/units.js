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

  // PLANTED-FOOT POLISH. A raw sine hip swing moves fastest through the
  // vertical -- exactly where a planted foot should be slowest, which is the
  // tell of a foot skating over the ground. Blending the swing toward a
  // squared curve (PLANT_HOLD) holds the leg near the crossing and lets it
  // snap mid-stride: identical amplitude at full extension, roughly half the
  // angular velocity at contact. PLANT_DIP (below) settles the body onto the
  // support leg at the same moment. Both scale out at rest, so a standing
  // figure is untouched.
  // Guarded with || 0: profiles that predate the polish (the king's `stride`,
  // or a partial per-enemy profile) simply keep the original sine swing.
  const plant = (G.PLANT_HOLD || 0) * speed01;
  const swingE = swing * (plant + (1 - plant) * Math.abs(swing));

  // Legs in opposition; arms counter-swing against the leg on their own side.
  // Positive hip rotation trails the leg BEHIND the body, so leg 0 is trailing
  // while sin(gait) > 0 and leading while it is negative.
  joints.hips[0].rotation.x = swingE * legAmp;
  joints.hips[1].rotation.x = -swingE * legAmp;
  joints.shoulders[0].rotation.x = -swingE * armAmp;
  joints.shoulders[1].rotation.x = swingE * armAmp * A.SPEAR_DAMP;

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
    Math.cos(gait * 2) * 0.5 * G.BOUNCE * speed01
    // The passing moment, when the support leg is vertical and taking the
    // weight: a shallow settle shaves the bounce's peak, so the body pushes
    // off the planted foot instead of riding on top of it.
    - (G.PLANT_DIP || 0) * speed01 * (1 - Math.abs(swing))
    + idle * G.BOUNCE * rest;
  joints.bob.rotation.z = swing * G.SWAY * speed01;

  // Torso counter-rotates against the arms, leans into the run, and breathes
  // when idle. The lean is positive because a figure faces +z at zero yaw, so
  // positive pitch about x carries the head forward -- into the direction of
  // travel. It rides on top of any fixed stoop the rig has, which lives in its
  // own group precisely so this can overwrite torso.rotation without erasing it.
  joints.torso.rotation.y = -swing * G.YAW * speed01;
  // Scaled per rig: the gait table is shared by every raider, but how far a
  // given figure pitches into it is part of that figure's posture. Absent, or
  // on the king's own rig, it is 1 and nothing changes.
  const lean = joints.leanScale === undefined ? 1 : joints.leanScale;
  joints.torso.rotation.x = idle * 0.12 * rest + G.LEAN * speed01 * lean;
}

export function createUnitView(THREE, board, soft, rigs, dynamicRoot, boatView = null) {
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
  const boatQuaternion = new THREE.Quaternion();

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

  // ---- the death launch ----
  // A kill launches the body up and back along the line of the blow -- a brief
  // airborne knockback instead of a topple in place. The figure strikes the
  // curled, slightly fetal pose in the instant of death and then holds it
  // rigid for the whole flight: torso folded onto tucked knees, weapon drawn
  // in. The arc has CONSTANT horizontal speed and the body never rotates --
  // no forward pitch on the launch, no backward tumble on the fall -- so it
  // lands curled in the same pose and stays there until the sink drains it
  // (config.anim.DEATH_SINK_*).
  //
  // All of this is presentation: the corpse's sim record does not move, so
  // nothing on the sim side needs to know the body is airborne.
  //
  // `kx, kz` is the unit direction of the blow (away from whatever killed it,
  // or the figure's own facing when the damage had no source) and `jitter` is
  // a per-unit +-1 that varies the arc height slightly so a volley does not
  // pop in mechanical unison.
  function applyDeathPose(root, joints, age, kx, kz, jitter) {
    const p = Math.min(1, age / A.DEATH_FLY);
    // The curl is struck in the moment of death and then held: the ease-in
    // only spans DEATH_FLY_SNAP of the flight, so the last live frame does
    // not pop straight into the folded pose.
    const pose = Math.min(1, p / A.DEATH_FLY_SNAP);
    const poseE = pose * pose * (3 - 2 * pose);
    // Height profile of the flight: on the ground at launch and at landing,
    // at the apex halfway through.
    const rise = Math.sin(Math.PI * p);
    // Knockback along the blow at CONSTANT speed -- linear in flight time,
    // with no easing and no reversal, so the body never lurches then coasts.
    const back = p;
    const h = A.DEATH_FLY_HEIGHT * (1 + 0.07 * jitter);

    root.position.y += h * rise;
    root.position.x += kx * A.DEATH_FLY_BACK * back * board.TILE;
    root.position.z += kz * A.DEATH_FLY_BACK * back * board.TILE;
    // The body never rotates: it keeps the facing it died with the whole way
    // and lands curled rather than flipped onto its back.
    root.rotation.x = 0;
    root.rotation.z = 0;

    // The fetal curl, written absolutely over whatever mid-stride pose the
    // last live frame left behind. Once the snap-in completes, nothing about
    // this pose animates while the body flies -- it is one rigid shape.
    joints.bob.position.y = 0;
    joints.bob.rotation.z = 0;
    joints.torso.rotation.x = A.DEATH_FLY_HUNCH * poseE;
    joints.torso.rotation.y = 0;
    // Thighs drawn up toward the chest and shins folded under them -- the
    // fetal tuck -- so the whole body compacts into a ball instead of leaving
    // the legs dangling below the folded torso.
    joints.hips[0].rotation.x = joints.hips[1].rotation.x =
      -A.DEATH_FLY_HIP * poseE;
    joints.hips[0].rotation.z = 0;
    joints.hips[1].rotation.z = 0;
    if (joints.knees) {
      joints.knees[0].rotation.x = joints.knees[1].rotation.x =
        joints.kneeBase + A.DEATH_FLY_TUCK * poseE;
    }
    // The weapon is drawn in over the folded torso rather than flung back by
    // the blow; both shoulders fold together so nothing sticks out of the
    // curl.
    joints.shoulders[0].rotation.x = A.DEATH_FLY_ARM * poseE;
    joints.shoulders[1].rotation.x = A.DEATH_FLY_ARM * poseE;

    // Once on the ground, the corpse is pinned in place until the sink
    // swallows it (world.js keeps the record for DEATH_SINK_DELAY +
    // DEATH_SINK_DURATION).
    const sinkT = Math.max(0, Math.min(1,
      (age - A.DEATH_SINK_DELAY) / A.DEATH_SINK_DURATION
    ));
    const sink = sinkT * sinkT * (3 - 2 * sinkT);
    root.position.y -= A.DEATH_SINK_DEPTH * sink;
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
  //
  // The numbers themselves are a PROFILE now, config.anim.swing, which any
  // enemy spec may override in part. They used to be constants here, which
  // meant every melee attacker swung identically and a brute given a longer
  // windup would only have played the grunt's arc in slow motion. Resolved once
  // per spec and cached: this runs for every swinging unit every frame, and the
  // merge is not worth doing forty times a frame to get the same object back.
  const swingProfiles = new WeakMap();
  function swingProfile(spec) {
    let profile = swingProfiles.get(spec);
    if (!profile) {
      profile = { ...A.swing, ...(spec.swing || {}) };
      swingProfiles.set(spec, profile);
    }
    return profile;
  }

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
    const S = swingProfile(spec);
    const W = spec.attackWindup, R = spec.attackRecovery;
    const drawTo = W * S.raiseFrac;
    let shoulder, twist, lunge = 0, drop = 0;

    if (age < drawTo) {
      // DRAW BACK. Ease-out, so the weapon comes up fast and then hangs at the
      // top for a beat -- the hang is what makes the strike read as a decision
      // rather than a twitch.
      const p = Math.min(1, age / drawTo);
      const raise = 1 - (1 - p) * (1 - p) * (1 - p);
      shoulder = S.raise * raise;
      twist = S.twist * raise;
    } else if (age < W) {
      // THE BLOW TRAVELLING. Mildly accelerating -- fastest at contact, but not
      // so back-loaded that the sword crosses from behind the unit to in front
      // of it inside a single frame, which a plain k*k did: the sweep window is
      // only a tenth of a second, so the curve has to spend it rather than
      // save it.
      const k = (age - drawTo) / (W - drawTo);
      const e = k * (0.4 + 0.6 * k);
      shoulder = S.raise + (S.contact - S.raise) * e;
      twist = S.twist + (S.twistAfter - S.twist) * e;
      drop = e;
    } else {
      const q = Math.min(1, (age - W) / R);
      if (q < S.followFrac) {
        // FOLLOW THROUGH past the target rather than stopping dead on it.
        const k = q / S.followFrac;
        shoulder = S.contact + (S.follow - S.contact) * k * (2 - k);
        twist = S.twistAfter;
        drop = 1;
      } else {
        // RECOVERY. Settles back to rest quadratically, slowest at the end.
        const r = (q - S.followFrac) / (1 - S.followFrac);
        shoulder = S.follow * (1 - r * r);
        twist = S.twistAfter * (1 - r * r);
        drop = 1 - r;
      }
      lunge = S.lunge * Math.max(0, 1 - q / 0.5);
    }

    // Written on top of whatever applyGait just put there, and only on the
    // weapon arm: the empty shoulder keeps walking.
    joints.shoulders[1].rotation.x = shoulder;
    joints.torso.rotation.y += twist;
    joints.bob.position.y -= S.dip * drop;

    // A compact impact pulse makes the damage frame readable even when the
    // weapon is hidden by a wall or another unit. It compresses the torso and
    // then releases instead of adding a second hit event or changing timing.
    if (S.impactDuration) {
      const impactT = Math.max(0, Math.min(1, (age - W) / S.impactDuration));
      const impact = Math.sin(Math.PI * impactT);
      joints.torso.rotation.x += S.impact * impact;
      joints.bob.position.y -= S.impactDip * impact;
    }
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
      const aboard = u.state === 'boat' && !u.disembark && boatView &&
        boatView.poseOf(u, position, boatQuaternion);
      const reaction = u.alive ? reactions.get(u.id) : null;
      if (reaction) {
        const punch = Math.sin(Math.PI * Math.min(1, reaction.age / H.seconds));
        root.scale.setScalar(rigs.scaleOf(u.type) * (1 + H.swell * punch));
        if (!aboard) {
          position.set(
            wx + reaction.dx * H.recoil * punch * board.TILE,
            y + A.ENEMY_LIFT,
            wz + reaction.dz * H.recoil * punch * board.TILE
          );
        } else {
          position.x += reaction.dx * H.recoil * punch * board.TILE;
          position.z += reaction.dz * H.recoil * punch * board.TILE;
        }
      } else {
        root.scale.setScalar(rigs.scaleOf(u.type));
        if (!aboard) position.set(wx, y + A.ENEMY_LIFT, wz);
      }
      root.position.copy(position);
      if (aboard) {
        root.quaternion.copy(boatQuaternion);
      } else {
        root.rotation.order = 'YXZ';
        root.rotation.set(0, facing, 0);
      }
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
        // Launched away from whatever killed it. When the damage had no source
        // (splash), knock the body back the way it was facing -- the direction
        // it came from.
        const kx = typeof u.knockDx === 'number' ? u.knockDx : -Math.sin(facing);
        const kz = typeof u.knockDz === 'number' ? u.knockDz : -Math.cos(facing);
        applyDeathPose(root, kit.template.joints, age, kx, kz, u.id % 2 ? 1 : -1);
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
