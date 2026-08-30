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

// The gait itself. Pure: joints in, rotations out, no state of its own.
//
//   gait     radians, advanced by distance travelled (see sim/enemies.js)
//   speed01  0 at a standstill, 1 at reference walking speed
//   idleT    a slow independent clock, so a crowd standing still does not
//            breathe in unison
export function applyGait(joints, gait, speed01, idleT) {
  const swing = Math.sin(gait);
  const legAmp = A.LEG_SWING * speed01;
  const armAmp = legAmp * A.ARM_RATIO;

  // Legs in opposition; arms counter-swing against the leg on their own side.
  joints.hips[0].rotation.x = swing * legAmp;
  joints.hips[1].rotation.x = -swing * legAmp;
  joints.shoulders[0].rotation.x = -swing * armAmp;
  joints.shoulders[1].rotation.x = swing * armAmp * A.SPEAR_DAMP;

  // Bounce runs at twice stride frequency: one rise per footfall, not per stride.
  // Shaped as (1 - cos) so it sits on the ground rather than dipping below it.
  const idle = Math.sin(idleT);
  const rest = (1 - speed01) * A.IDLE_SCALE;
  joints.bob.position.y =
    (1 - Math.cos(gait * 2)) * 0.5 * A.BOUNCE * speed01 + idle * A.BOUNCE * rest;
  joints.bob.rotation.z = swing * A.SWAY * speed01;

  // Torso counter-rotates against the arms, and breathes when idle.
  joints.torso.rotation.y = -swing * A.YAW * speed01;
  joints.torso.rotation.x = idle * 0.12 * rest;
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
    joints.shoulders[0].rotation.x = joints.shoulders[1].rotation.x = 0;
    joints.shoulders[0].rotation.z = -1.25 * fall;
    joints.shoulders[1].rotation.z = 1.25 * fall;
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
          y,
          wz + reaction.dz * H.recoil * punch * board.TILE
        );
      } else {
        root.scale.setScalar(rigs.scaleOf(u.type));
        root.position.set(wx, y, wz);
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
      applyGait(kit.template.joints, gait, speed01, world.time * A.IDLE_RATE + u.id);
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
      if (u.alive && blobCount < BLOB_CAP) {
        const size = 0.24 * (rigs.scaleOf(u.type) / rigs.scaleOf('grunt'));
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
