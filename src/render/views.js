// Hero TD -- the dynamic views.
//
// Everything that can change lives here: towers (they upgrade and die), houses
// (they are destroyed and rebuilt), boats, projectiles and the hero. All of it
// goes into dynamicRoot and none of it is ever handed to the static batcher,
// which flattens its input and discards the object references these need.
//
// Every view reads world state and writes nothing back (TDD 17).

import { config } from '../config.js';
import { lerpAngle } from '../sim/angles.js';
import { applyGait } from './units.js';
import { palette } from './palette.js';
import { flattenGroup } from './flatten.js';

const A = config.anim;

// ---------------------------------------------------------------- structures
// Towers, houses and the castle are rigid, so each prefab is baked once into a
// single vertex-coloured geometry (flatten.js) and every structure of that kind
// is one instanced draw. Ten towers went from a hundred and forty draw calls to
// one, and it costs nothing at build time because a prefab is only ever baked
// the first time that kind is placed.
export function createStructureView(THREE, board, prefabs, soft, dynamicRoot, scenery) {
  const CAP = 64;
  const DUST_CAP = 128;
  const C = config.construction;
  // Keyed by tower TYPE rather than by kind: a garrison and a barricade are both
  // "tower" to the simulation but two entirely different silhouettes here, and
  // each one is its own instanced draw.
  const kinds = new Map();          // key -> { mesh, count }
  const bars = new Map();           // structure id -> { bar, fill }
  const construction = new Map();   // structure id -> visual construction age
  const liveStructures = new Set();

  const barGeo = new THREE.PlaneGeometry(0.62, 0.075);
  const barBackMat = new THREE.MeshBasicMaterial({ color: 0x1b2226, transparent: true, opacity: 0.72, depthTest: false });
  const barFillMat = new THREE.MeshBasicMaterial({ color: palette.accent, depthTest: false });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const blobQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const blobScale = new THREE.Vector3();
  const structureScale = new THREE.Vector3(1, 1, 1);

  // Opaque, low-poly puffs: large enough to hide the ground intersection while
  // a building rises, but still one draw regardless of how many are active.
  const dustMaterial = new THREE.MeshLambertMaterial({ color: 0xc8b58c });
  dustMaterial.flatShading = true;
  dustMaterial.needsUpdate = true;
  const dustMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.18, 0), dustMaterial, DUST_CAP
  );
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dustMesh.frustumCulled = false;
  dustMesh.count = 0;
  dynamicRoot.add(dustMesh);
  const dust = Array.from({ length: DUST_CAP }, () => ({ active: false }));
  let dustCursor = 0;
  const dustQuat = new THREE.Quaternion();
  const dustScale = new THREE.Vector3();

  function dustValue(id, puff, salt) {
    const value = Math.sin(id * 91.7 + puff * 37.1 + salt * 17.3) * 43758.5453;
    return value - Math.floor(value);
  }

  function startDustPuff(s, wx, groundY, k) {
    const footprint = s.kind === 'castle' ? 1.05 : 0.52;
    const puff = dust[dustCursor++ % DUST_CAP];
    const angle = dustValue(s.id, k, 1) * Math.PI * 2;
    const radius = footprint * (0.12 + dustValue(s.id, k, 2) * 0.82);
    puff.active = true;
    puff.age = 0;
    puff.duration = C.dustDuration * (0.82 + dustValue(s.id, k, 3) * 0.36);
    puff.x = wx + Math.cos(angle) * radius;
    puff.z = board.px(s.z) + Math.sin(angle) * radius;
    puff.y = groundY + 0.04;
    puff.angle = angle;
    puff.travel = 0.18 + dustValue(s.id, k, 4) * 0.3;
    puff.lift = 0.14 + dustValue(s.id, k, 5) * 0.2;
    puff.size = (s.kind === 'castle' ? 1.25 : 0.95) *
      (0.72 + dustValue(s.id, k, 6) * 0.65);
  }

  function updateDust(dt) {
    let count = 0;
    for (const puff of dust) {
      if (!puff.active) continue;
      puff.age += dt;
      const t = Math.min(1, puff.age / puff.duration);
      if (t >= 1) { puff.active = false; continue; }
      const spread = puff.travel * (1 - Math.pow(1 - t, 2));
      const endScale = t < 0.82 ? 1 : (1 - t) / 0.18;
      const size = puff.size * (0.85 + Math.sin(Math.PI * t) * 0.7) * endScale;
      position.set(
        puff.x + Math.cos(puff.angle) * spread,
        puff.y + Math.sin(Math.PI * t) * puff.lift,
        puff.z + Math.sin(puff.angle) * spread
      );
      dustScale.setScalar(size);
      matrix.compose(position, dustQuat, dustScale);
      dustMesh.setMatrixAt(count++, matrix);
    }
    dustMesh.count = count;
    if (count) dustMesh.instanceMatrix.needsUpdate = true;
  }

  function kindFor(key, structure) {
    const existing = kinds.get(key);
    if (existing) return existing;
    const prefab = structure.kind === 'house' ? prefabs.house(0, 0, 0, 1)
                 : structure.kind === 'castle' ? prefabs.castle()
                 : prefabs.towerOfType(structure.type);
    const baked = flattenGroup(THREE, prefab);
    const mesh = new THREE.InstancedMesh(baked.geometry, baked.material, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    dynamicRoot.add(mesh);
    const entry = { mesh, count: 0 };
    kinds.set(key, entry);
    return entry;
  }

  // Contact pools, one instanced draw for every structure on the island.
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), soft.blobMat, CAP);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.frustumCulled = false;
  blobs.count = 0;
  dynamicRoot.add(blobs);

  // Damage feedback stays as real objects: only a hurt structure shows one, so
  // this is a handful of draws at worst and they have to face the camera.
  function barFor(s) {
    let entry = bars.get(s.id);
    if (entry) return entry;
    const bar = new THREE.Mesh(barGeo, barBackMat);
    const fill = new THREE.Mesh(barGeo, barFillMat);
    bar.renderOrder = 5; fill.renderOrder = 6;
    fill.position.z = 0.001;
    bar.add(fill);
    bar.visible = false;
    dynamicRoot.add(bar);
    entry = { bar, fill };
    bars.set(s.id, entry);
    return entry;
  }

  // ---- occlusion (TDD 15) -------------------------------------------------
  //
  // A structure is faded when a unit or the king is BEHIND it from where the
  // camera is standing. Behind is a question about the camera, not the world, so
  // it is asked in view space: transform the structure's bounding box and every
  // unit into the camera's frame, and a unit is hidden when it lands inside the
  // box's screen rectangle at a greater depth.
  //
  // View space rather than a raycast because there are up to forty units and a
  // dozen structures every frame, and this is two matrix transforms each. A
  // raycast per unit per structure is the same answer for a hundred times the
  // work -- and it would have to run against the batched scenery, which no
  // longer has the object references a raycast needs (TDD 17).
  //      // The faded ones are simply left out of their instanced batch and drawn as
  // individual meshes instead. That costs one draw call per occluder, and there
  // are rarely more than two.
  const OCC = config.occlusion;
  const sceneryList = scenery || [];
  const viewMatrix = new THREE.Matrix4();
  const boxPoint = new THREE.Vector3();
  const fades = new Map();          // structure id -> current fade, 0..1
  const ghosts = new Map();         // structure id -> the transparent mesh
  const ghostPool = [];
  const occluders = new Set();

  function ghostMaterial(source) {
    const material = source.clone();
    const coverage = { value: 1 };
    material.isGhostMaterial = true;
    material.userData.occlusionCoverage = coverage;
    // Alpha blending counts every overlapping castle part. A hall behind a
    // turret therefore becomes opaque faster than an exposed roof. Screen-door
    // coverage keeps one opacity for the complete flattened structure and lets
    // the depth buffer resolve its parts normally.
    material.transparent = false;
    material.depthWrite = true;
    material.onBeforeCompile = shader => {
      shader.uniforms.occlusionCoverage = coverage;
      shader.fragmentShader = 'uniform float occlusionCoverage;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `float occlusionNoise = fract(52.9829189 * fract(dot(
          gl_FragCoord.xy, vec2(0.06711056, 0.00583715)
        )));
        if (occlusionCoverage <= occlusionNoise) discard;
        #include <dithering_fragment>`
      );
    };
    material.customProgramCacheKey = () => 'structure-occlusion-screen-door-v1';
    material.needsUpdate = true;
    return material;
  }

  function ghostFor(entry) {
    const mesh = ghostPool.pop() || new THREE.Mesh();
    mesh.geometry = entry.mesh.geometry;

    // One material per ghost: opacity is per-structure, so it cannot be shared
    // with the instanced batch or with another ghost. `isGhostMaterial` marks
    // the ones already cloned, rather than testing the material TYPE -- a
    // pooled ghost's material is Lambert too, so a type test skips the setup on
    // every reuse and leaves whatever flags the last user left behind.
    if (!mesh.material || !mesh.material.isGhostMaterial) {
      mesh.material = ghostMaterial(entry.mesh.material);
    }
    mesh.material.userData.occlusionCoverage.value = 1;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.visible = true;
    dynamicRoot.add(mesh);
    return mesh;
  }

  function releaseGhost(id) {
    const mesh = ghosts.get(id);
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.visible = false;
    ghostPool.push(mesh);
    ghosts.delete(id);
  }

  // Everything the player must be able to see. Four numbers each: where it
  // lands on screen (view x, y) and where it stands on the ground (world x, z).
  //
  // THE TWO ARE ASKED DIFFERENT QUESTIONS, and mixing them is what made an
  // earlier version fade a building the player was standing IN FRONT of. Depth
  // was taken from the nearest corner of the structure's bounding box in view
  // space -- but the camera is pitched, so "higher up" and "nearer the camera"
  // are the same axis, and a tall tower's ROOF corner is nearer than somebody
  // standing on the ground in front of its door. The tower then counted as being
  // between the camera and the player and faded, which is precisely backwards.
  //
  // So depth is now measured in the HORIZONTAL PLANE along the camera's
  // ground-projected forward direction, where a building's height cannot
  // contribute at all. The screen rectangle still answers the separate question
  // of whether the silhouette actually covers the subject.
  const subjects = [];
  let forwardX = 0, forwardZ = 1;

  function gatherSubjects(world, camera) {
    subjects.length = 0;
    boxPoint.set(0, 0, -1).applyMatrix4(camera.matrixWorld).sub(camera.position);
    boxPoint.y = 0;
    const span = Math.hypot(boxPoint.x, boxPoint.z) || 1;
    forwardX = boxPoint.x / span;
    forwardZ = boxPoint.z / span;

    const add = (tileX, tileZ, y) => {
      const wx = board.px(tileX), wz = board.px(tileZ);
      boxPoint.set(wx, y, wz).applyMatrix4(viewMatrix);
      subjects.push(boxPoint.x, boxPoint.y, wx, wz);
    };
    for (const u of world.units) {
      if (!u.alive || u.state === 'boat') continue;
      add(u.x, u.z, u.y + 0.25);
    }
    const hero = world.hero;
    if (hero && hero.alive) add(hero.x, hero.z, hero.y + 0.3);
  }

  // Distance along the camera's forward axis, in the horizontal plane. Larger is
  // further from the camera.
  const depthOf = (wx, wz) => wx * forwardX + wz * forwardZ;

  // Does this structure stand between the camera and anybody who matters?
  function occludes(entry, wx, wy, wz) {
    const box = entry.mesh.geometry.boundingBox;
    if (!box) return false;

    // The silhouette, as a screen-space rectangle.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      boxPoint.set(
        (k & 1 ? box.max.x : box.min.x) + wx,
        (k & 2 ? box.max.y : box.min.y) + wy,
        (k & 4 ? box.max.z : box.min.z) + wz
      ).applyMatrix4(viewMatrix);
      if (boxPoint.x < minX) minX = boxPoint.x;
      if (boxPoint.x > maxX) maxX = boxPoint.x;
      if (boxPoint.y < minY) minY = boxPoint.y;
      if (boxPoint.y > maxY) maxY = boxPoint.y;
    }
    minX -= OCC.padding; maxX += OCC.padding;
    minY -= OCC.padding; maxY += OCC.padding;

    // Its near face, in the horizontal plane. A subject at or beyond this is
    // inside the footprint or behind it; anything nearer is in front of it and
    // is not being hidden by anything.
    const centreX = wx + (box.min.x + box.max.x) / 2;
    const centreZ = wz + (box.min.z + box.max.z) / 2;
    const halfX = (box.max.x - box.min.x) / 2;
    const halfZ = (box.max.z - box.min.z) / 2;
    const support = halfX * Math.abs(forwardX) + halfZ * Math.abs(forwardZ);
    const nearFace = depthOf(centreX, centreZ) - support;

    for (let k = 0; k < subjects.length; k += 4) {
      if (depthOf(subjects[k + 2], subjects[k + 3]) <= nearFace) continue;  // in front
      const x = subjects[k], y = subjects[k + 1];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      return true;
    }
    return false;
  }

  function sync(world, camera, elapsed) {
    for (const entry of kinds.values()) entry.count = 0;
    let blobCount = 0;
    liveStructures.clear();

    // matrixWorldInverse is only refreshed inside renderer.render, which has not
    // run yet this frame, so it is derived here rather than trusted.
    camera.updateMatrixWorld();
    viewMatrix.copy(camera.matrixWorld).invert();
    if (OCC.enabled) gatherSubjects(world, camera); else subjects.length = 0;
    occluders.clear();

    for (const s of world.structures.list) {
      liveStructures.add(s.id);
      if (!s.alive) {
        const existing = bars.get(s.id);
        if (existing) existing.bar.visible = false;
        continue;
      }

      // An upgrade changes the type on a live record, so the key has to follow
      // the type rather than the id -- otherwise a tower keeps its old body.
      const entry = kindFor(s.kind === 'tower' ? 'tower:' + s.type : s.kind, s);
      const wx = board.px(s.x), wz = board.px(s.z);
      const wy = board.topY(s.i, s.j) - config.board.SINK;
      let build = construction.get(s.id);
      if (!build) {
        const animate = s.kind !== 'house';
        build = { age: animate ? 0 : C.duration, dustSpawned: 0 };
        construction.set(s.id, build);
      }
      build.age = Math.min(C.duration, build.age + (world.paused ? 0 : elapsed));
      const progress = Math.min(1, build.age / C.duration);
      const rise = 1 - Math.pow(1 - progress, 3);
      const riseDepth = s.kind === 'castle' ? C.castleRiseDepth : C.towerRiseDepth;
      const dustTotal = s.kind === 'castle' ? C.castleDustPuffs : C.towerDustPuffs;
      const dustWindow = Math.max(0.001, C.duration - C.dustStopBeforeEnd);
      const dustTarget = s.kind === 'house' ? 0 :
        Math.min(dustTotal, Math.floor(dustTotal * Math.min(1, build.age / dustWindow)));
      while (build.dustSpawned < dustTarget) {
        startDustPuff(s, wx, board.topY(s.i, s.j), build.dustSpawned++);
      }

      const shakeEnvelope = Math.sin(Math.PI * progress);
      const shakePhase = build.age * C.shakeRate + s.id * 2.17;
      const shakeX = Math.sin(shakePhase) * C.shakeOffset * shakeEnvelope;
      const shakeZ = Math.cos(shakePhase * 1.31) * C.shakeOffset * shakeEnvelope;
      const shakeTiltX = Math.sin(shakePhase * 0.83) * C.shakeTilt * shakeEnvelope;
      const shakeTiltZ = Math.cos(shakePhase * 1.07) * C.shakeTilt * shakeEnvelope;

      // TDD 7 keeps a rotation field on every tower even though only the
      // renderer reads it today; honouring it now is what makes directional
      // towers a later tuning change rather than a refactor.
      euler.set(shakeTiltX, s.kind === 'tower' ? s.rotation : 0, shakeTiltZ);
      quaternion.setFromEuler(euler);
      position.set(wx + shakeX, wy - riseDepth * (1 - rise), wz + shakeZ);
      structureScale.set(0.94 + rise * 0.06, 1, 0.94 + rise * 0.06);
      matrix.compose(position, quaternion, structureScale);

      // TDD 15. Houses and the castle occlude just as readily as a tower does,
      // so nothing is exempt -- the castle is in fact the worst offender,
      // because the king starts the level standing at its gate.
      const hidingSomething = OCC.enabled && progress >= 1 &&
        occludes(entry, position.x, position.y, position.z);
      const previous = fades.get(s.id) || 0;
      const step = Math.min(1, (world.paused ? 0 : elapsed) * OCC.fadeRate);
      const fade = previous + ((hidingSomething ? 1 : 0) - previous) * step;
      if (fade > 0.01) fades.set(s.id, fade); else fades.delete(s.id);

      if (fade > 0.01) {
        // Out of the batch, into its own dark outlined draw. Keep the ghost alive
        // through the first visible frame so every part begins at the same opacity.
        occluders.add(s.id);
        let ghost = ghosts.get(s.id);
        if (!ghost || ghost.geometry !== entry.mesh.geometry) {
          if (ghost) releaseGhost(s.id);
          ghost = ghostFor(entry);
          ghosts.set(s.id, ghost);
        }
        ghost.position.copy(position);
        ghost.quaternion.copy(quaternion);
        ghost.scale.copy(structureScale);
        // One coverage value drives the complete flattened structure, so roofs,
        // walls and turrets dissolve at the same rate regardless of overlap.
        const opacity = 1 - fade * (1 - OCC.opacity);
        ghost.material.userData.occlusionCoverage.value = opacity;
      } else if (entry.count < CAP) {
        entry.mesh.setMatrixAt(entry.count++, matrix);
      }

      if (blobCount < CAP) {
        const size = s.kind === 'house' ? 1.25 : s.kind === 'castle' ? 2.5
                   : s.line === 'barricade' ? 0.95 : 1.1;
        position.set(wx, board.topY(s.i, s.j) + 0.012, wz);
        blobScale.set(size, size, size);
        matrix.compose(position, blobQuat, blobScale);
        blobs.setMatrixAt(blobCount++, matrix);
      }

      // Only bother with a bar on something that has actually been hurt.
      const hurt = progress >= 1 && s.hp < s.maxHp;
      const view = hurt ? barFor(s) : bars.get(s.id);
      if (view) {
        view.bar.visible = hurt;
        if (hurt) {
          const height = board.topY(s.i, s.j) +
            (s.kind === 'house' ? 1.05 : s.kind === 'castle' ? 2.05 : 1.55);
          view.bar.position.set(wx, height, wz);
          view.bar.quaternion.copy(camera.quaternion);      // always face the viewer
          const ratio = Math.max(0, s.hp / s.maxHp);
          view.fill.scale.x = ratio;
          // Shrink from the left edge rather than the centre.
          view.fill.position.x = -0.62 * (1 - ratio) / 2;
        }
      }
    }

    for (const entry of kinds.values()) {
      entry.mesh.count = entry.count;
      if (entry.count) entry.mesh.instanceMatrix.needsUpdate = true;
    }
    blobs.count = blobCount;
    if (blobCount) blobs.instanceMatrix.needsUpdate = true;
    updateDust(world.paused ? 0 : elapsed);

    // A removed structure (sold, or wiped by a restart) leaves the instance
    // buffers automatically, since those are rebuilt from scratch each frame.
    // Only its health bar is a real object and has to be taken out of the scene.
    //
    // No size guard here: `bars` holds an entry only for structures that have
    // ever been hurt, so it is a sparse subset of the list and comparing the two
    // sizes never fired. That left a dead bar hanging in mid-air over the sea.
    for (const [id, view] of bars) {
      if (liveStructures.has(id)) continue;
      if (view.bar.parent) view.bar.parent.remove(view.bar);
      bars.delete(id);
    }
    for (const id of construction.keys()) {
      if (!liveStructures.has(id)) construction.delete(id);
    }
    for (const id of [...ghosts.keys()]) {
      if (!occluders.has(id)) releaseGhost(id);
    }
    for (const id of [...fades.keys()]) {
      if (!liveStructures.has(id)) fades.delete(id);
    }

    // Scenery: standalone meshes rather than instances, so fading one is a
    // material change and needs no ghost at all.
    for (const mesh of sceneryList) {
      const hiding = OCC.enabled &&
        occludes({ mesh }, mesh.position.x, mesh.position.y, mesh.position.z);
      const previous = mesh.userData.fade || 0;
      const step = Math.min(1, (world.paused ? 0 : elapsed) * OCC.fadeRate);
      const fade = previous + ((hiding ? 1 : 0) - previous) * step;
      mesh.userData.fade = fade;
      const opaque = fade <= 0.01;
      if (mesh.material.transparent === opaque) {
        mesh.material.transparent = !opaque;
        mesh.material.depthWrite = opaque;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = 1 - fade * (1 - OCC.opacity);
      if (!opaque) occluders.add('scenery:' + mesh.id);
    }
  }

  return {
    sync,
    // For tests and the dev overlay: what is currently being seen through.
    get occluding() { return new Set(occluders); }
  };
}

// --------------------------------------------------------------------- boats
export function createBoatView(THREE, board, kit, soft, rigs, dynamicRoot) {
  const views = new Map();
  const liveBoats = new Set();
  const { mat } = kit;

  // ---- the hull ------------------------------------------------------------
  //
  // ONE LOFTED SOLID, and a HOLLOW one. The first version was an eight-vertex
  // shell with a closed top, which caused every complaint about it at once: the
  // floor and benches were drawn INSIDE a sealed lid and never seen, the
  // gunwales floated above that lid with nothing joining them to it, and the
  // stem posts reached y=0.4 with finials hanging past the ends of the boat.
  // It read as a pile of parts because that is what it was.
  //
  // The second version fixed the assembly but capped it with a flat deck, so it
  // read as a slab: a boat is a BOWL, and the eye wants to see down into it.
  // Each section therefore carries four heights, not two --
  //
  //   keel    the outside of the bottom, below the waterline amidships
  //   sheer   the rim
  //   floor   the inside of the bottom, well below the rim
  //   w/wi    outer and inner half-beam, the gap between them being the planking
  //
  // -- and consecutive sections are skinned with an outer side, a bottom, a rim
  // band, an inner side and a floor. The interior pinches to nothing at the two
  // tips because `wi` clamps at zero there, which closes the ends without
  // needing a special case.
  const SECTIONS = [
    { z: -0.72, w: 0.026, keel:  0.062, sheer: 0.190, floor: 0.150 },
    { z: -0.46, w: 0.155, keel:  0.006, sheer: 0.122, floor: 0.060 },
    { z: -0.16, w: 0.230, keel: -0.022, sheer: 0.100, floor: 0.028 },
    { z:  0.16, w: 0.230, keel: -0.022, sheer: 0.100, floor: 0.028 },
    { z:  0.46, w: 0.155, keel:  0.006, sheer: 0.122, floor: 0.060 },
    { z:  0.72, w: 0.026, keel:  0.062, sheer: 0.190, floor: 0.150 }
  ];
  const WALL = 0.030;           // planking thickness at the rim
  const KEEL = 0.42;            // keel half-beam, as a fraction of the rim's
  const FLOORW = 0.55;          // floor half-beam, as a fraction of the inner rim

  const inner = s => Math.max(0, s.w - WALL);

  // Where the interior floor sits at any point along the hull, so anything
  // standing in the boat is placed from the numbers the boat was built from.
  function sectionAt(z) {
    for (let k = 0; k < SECTIONS.length - 1; k++) {
      const a = SECTIONS[k], b = SECTIONS[k + 1];
      if (z < a.z || z > b.z) continue;
      const t = (z - a.z) / (b.z - a.z);
      const lerp = key => a[key] + (b[key] - a[key]) * t;
      return { w: lerp('w'), keel: lerp('keel'), sheer: lerp('sheer'), floor: lerp('floor') };
    }
    return SECTIONS[z < 0 ? 0 : SECTIONS.length - 1];
  }

  // Built NON-INDEXED so no vertex is shared between faces: computeVertexNormals
  // then produces one hard normal per triangle, which is where the faceted look
  // comes from (see kit.js -- MeshLambertMaterial ignores flatShading).
  const hullGeo = (() => {
    const pos = [];
    const tri = (a, b, c) => pos.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const OL = s => [-s.w, s.sheer, s.z];                    // outer rim
    const OR = s => [ s.w, s.sheer, s.z];
    const IL = s => [-inner(s), s.sheer, s.z];               // inner rim
    const IR = s => [ inner(s), s.sheer, s.z];
    const FL = s => [-inner(s) * FLOORW, s.floor, s.z];      // floor edge
    const FR = s => [ inner(s) * FLOORW, s.floor, s.z];
    const BL = s => [-s.w * KEEL, s.keel, s.z];              // keel
    const BR = s => [ s.w * KEEL, s.keel, s.z];

    for (let k = 0; k < SECTIONS.length - 1; k++) {
      const a = SECTIONS[k], b = SECTIONS[k + 1];
      quad(BL(a), BL(b), OL(b), OL(a));    // port topside, outside
      quad(BR(a), OR(a), OR(b), BR(b));    // starboard topside, outside
      quad(BL(a), BR(a), BR(b), BL(b));    // bottom
      quad(OL(a), OL(b), IL(b), IL(a));    // rim band, port
      quad(IR(a), IR(b), OR(b), OR(a));    // rim band, starboard
      quad(IL(a), IL(b), FL(b), FL(a));    // port topside, inside
      quad(FR(b), IR(b), IR(a), FR(a));    // starboard topside, inside
      quad(FL(a), FL(b), FR(b), FR(a));    // floor
    }
    const bow = SECTIONS[0], stern = SECTIONS[SECTIONS.length - 1];
    quad(BL(bow), OL(bow), OR(bow), BR(bow));
    quad(BL(stern), BR(stern), OR(stern), OL(stern));

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();

  const oarGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.68, 4);
  oarGeo.translate(0, 0.23, 0);
  const finialGeo = new THREE.ConeGeometry(0.038, 0.075, 5);
  const foamGeo = new THREE.PlaneGeometry(1, 1);

  // The finished hull, baked to ONE geometry. Nothing on the boat articulates --
  // the oars are scenery -- so the whole vessel is rigid, and flattening it
  // turns twenty-two draw calls per boat into one. That matters here: boats are
  // not instanced, and a wave lands four of them.
  let baked = null;
  function make() {
    if (!baked) baked = flattenGroup(THREE, buildBoat());
    const group = new THREE.Mesh(baked.geometry, baked.material);
    group.frustumCulled = false;
    dynamicRoot.add(group);

    const foam = new THREE.Mesh(foamGeo, soft.boatFoamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.scale.set(1.32, 2.86, 1);
    dynamicRoot.add(foam);
    return { group, foam, beached: 0 };
  }

  function buildBoat() {
    const group = new THREE.Group();
    const darkWood = 0x4f3532, timber = 0x806044;

    group.add(new THREE.Mesh(hullGeo, mat(palette.boat)));

    // Gunwale: short segments laid ALONG the deck edge, section to section, so
    // the rail is centred on the rim it belongs to. The old one was a straight
    // strut at a fixed height, which is why it hung in the air over a curved
    // hull that had already closed itself off.
    for (const side of [-1, 1]) {
      for (let k = 0; k < SECTIONS.length - 1; k++) {
        const a = SECTIONS[k], b = SECTIONS[k + 1];
        group.add(kit.strut(
          [side * a.w, a.sheer, a.z],
          [side * b.w, b.sheer, b.z],
          0.034, darkWood
        ));
      }
    }

    // Cross-benches span the INNER beam and sit on the interior floor, so they
    // read as thwarts inside a boat rather than as slats laid over a lid.
    for (const z of [-0.30, 0.30]) {
      const s = sectionAt(z);
      const bench = kit.bevelBox(Math.max(0, s.w - WALL) * 2, 0.05, 0.024, 0, timber);
      bench.position.set(0, s.floor, z);
      group.add(bench);
    }

    // Oars, hung on the rail rather than floating beside it.
    for (const side of [-1, 1]) {
      for (const z of [-0.20, 0.20]) {
        const s = sectionAt(z);
        const oar = new THREE.Mesh(oarGeo, mat(0x9a754d));
        oar.position.set(side * (s.w - WALL * 0.5), s.sheer - 0.004, z);
        oar.rotation.z = side * Math.PI / 2.55;
        group.add(oar);
      }
    }

    // Stem and stern posts: they now START at the hull's own tip and rise a
    // little over a tenth of a unit, instead of launching from mid-hull to y=0.4
    // and carrying a finial out past the end of the boat.
    for (const end of [-1, 1]) {
      const tip = SECTIONS[end < 0 ? 0 : SECTIONS.length - 1];
      const top = [0, 0.225, end * 0.70];
      group.add(kit.strut([0, tip.sheer - 0.01, tip.z], top, 0.036, darkWood));
      const finial = new THREE.Mesh(finialGeo, mat(0xb99a62));
      finial.position.set(top[0], top[1] + 0.03, top[2]);
      group.add(finial);
    }

    group.scale.setScalar(1.1);
    return group;
  }

  const GROUND = config.waves.grounding;
  const GROUND_PITCH = GROUND.pitch * Math.PI / 180;

  function sync(world, alpha, elapsed) {
    liveBoats.clear();
    for (const boat of world.waves.boats) {
      liveBoats.add(boat.id);
      let view = views.get(boat.id);
      if (!view) { view = make(); views.set(boat.id, view); }
      const x = boat.px + (boat.x - boat.px) * alpha;
      const z = boat.pz + (boat.z - boat.pz) * alpha;

      // Beaching: the bow rides up the shelf. Eased rather than snapped, and
      // exponentially so it is frame-rate independent. Render-only -- the
      // simulation has no opinion about how a hull sits.
      const target = boat.landed ? 1 : 0;
      const k = elapsed ? 1 - Math.exp(-elapsed / GROUND.seconds) : 1;
      view.beached += (target - view.beached) * k;

      view.group.visible = true;
      view.foam.visible = true;
      view.group.position.set(
        board.px(x),
        config.waves.hullY + view.beached * GROUND.lift,
        board.px(z)
      );
      // YXZ so the pitch happens about the hull's OWN lateral axis and the
      // heading is applied after it; with the default order the two interact
      // and the boat yaws as it tilts. Negative pitch lifts local +z, which is
      // the direction of travel -- the bow.
      view.group.rotation.order = 'YXZ';
      view.group.rotation.set(-view.beached * GROUND_PITCH, boat.facing, 0);
      view.foam.position.set(board.px(x), 0.02, board.px(z));
      view.foam.rotation.z = -boat.facing;
    }
    for (const [id, view] of views) {
      if (liveBoats.has(id)) continue;
      view.group.visible = false;
      view.foam.visible = false;
    }
  }

  return { sync };
}

// --------------------------------------------------------------- projectiles
export function createProjectileView(THREE, board, dynamicRoot) {
  // A plain white line stays readable at maximum zoom-out without adding visual
  // detail to volleys. Every arrow shares one instanced draw.
  const CAP = 256;
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shaftGeometry = new THREE.BoxGeometry(0.022, 0.022, 0.36);
  const shaftMaterial = arrowMaterial;
  const shaft = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, CAP);

  const meshes = [shaft];
  for (const mesh of meshes) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    dynamicRoot.add(mesh);
  }

  // Water impacts are infrequent, so a small fixed pool gives each ring its own
  // fade without allocating effects during play.
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
    for (const p of world.combat.projectiles) {
      if (count >= CAP) break;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      const y = p.py + (p.y - p.py) * alpha;

      // Stored direction survives grounded and embedded states, where frame-to-
      // frame displacement is zero or follows the victim instead of the arrow.
      const dx = p.dirX, dz = p.dirZ, dy = p.dirY;
      const ground = Math.hypot(dx, dz);
      euler.set(-Math.atan2(dy, ground), Math.atan2(dx, dz), 0, 'YXZ');
      quaternion.setFromEuler(euler);
      position.set(board.px(x), y, board.px(z));
      matrix.compose(position, quaternion, one);
      for (const mesh of meshes) mesh.setMatrixAt(count, matrix);
      count++;
    }
    for (const mesh of meshes) {
      mesh.count = count;
      if (count) mesh.instanceMatrix.needsUpdate = true;
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

// --------------------------------------------------------------------- coins
export function createCoinView(THREE, board, dynamicRoot) {
  // One instanced draw for every coin on the island. They spin, which is most of
  // what makes a small gold disc read as a pickup rather than as scenery.
  const CAP = 128;
  const geometry = new THREE.CylinderGeometry(0.09, 0.09, 0.025, 7);
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
      // The hop is a settle, not a bounce: it eases out of the body and lands.
      const lift = 0.12 + Math.sin(coin.hop * Math.PI) * 0.22;
      position.set(board.px(x), board.groundYAt(x, z) + lift, board.px(z));
      euler.set(0, world.time * 3.2 + coin.id, 0.35);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, one);
      mesh.setMatrixAt(count++, matrix);
    }
    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  }

  return { sync };
}

// ---------------------------------------------------------------------- hero
export function createHeroView(THREE, board, soft, kingRig, dynamicRoot) {
  const rig = kingRig;
  dynamicRoot.add(rig.root);

  // The king's own hit reaction. Same shape as the enemies' (see units.js) but
  // slower and gentler: he is the largest figure on the island, so an identical
  // swell reads much louder on him.
  const HIT = config.hit;
  const baseScale = rig.root.scale.x || 1;
  let hitAge = Infinity;

  const quad = new THREE.PlaneGeometry(1, 1);
  const contact = new THREE.Mesh(quad, soft.blobMat);
  contact.rotation.x = -Math.PI / 2;
  contact.scale.setScalar(0.3);
  dynamicRoot.add(contact);

  // TDD 15: a crisp golden ring so he stays findable in a crowd. Nothing else
  // in the scene has one, which is the point. Sharp edges rather than a soft
  // halo, so it reads as a marker instead of mist.
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.018, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0xf2c14e, transparent: true, opacity: 0.9,
      depthWrite: false, toneMapped: false, fog: false
    })
  );
  glow.rotation.x = Math.PI / 2;
  dynamicRoot.add(glow);

  // A destination marker is intentionally separate from the king's warm glow:
  // the hollow ring pins the exact ground target while the rotating arrow remains
  // readable above crowds and uneven terrain.
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

  // One fixed dust pool for the king's landing. Low-poly puffs fit the scene's
  // visual language and avoid allocating particles in the render loop.
  const dustGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const dust = Array.from({ length: 6 }, (_, k) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xcbbd9f, transparent: true, opacity: 0, depthWrite: false
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
      puff.x = x; puff.y = y + 0.025; puff.z = z;
      puff.mesh.position.set(puff.x, puff.y, puff.z);
      puff.mesh.scale.setScalar(0.7);
      puff.mesh.material.opacity = 0.46;
      puff.mesh.visible = true;
    }
  }

  function updateDust(dt) {
    for (const puff of dust) {
      if (puff.age === Infinity) continue;
      puff.age += dt;
      const t = Math.min(1, puff.age / 0.45);
      const spread = puff.distance * (1 - Math.pow(1 - t, 2));
      puff.mesh.position.set(
        puff.x + Math.cos(puff.angle) * spread,
        puff.y + Math.sin(Math.PI * t) * 0.07,
        puff.z + Math.sin(puff.angle) * spread
      );
      puff.mesh.scale.setScalar(0.7 + t * 1.1);
      puff.mesh.material.opacity = (1 - t) * 0.46;
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

    // If the attack was cancelled (e.g. by a cliff jump) the bow must snap back
    // to rest; it is never left frozen mid-draw.
    if (hero.attackTime < 0) {
      bow.rotation.y = Math.PI / 2;
      return;
    }

    const aimDelta = Math.atan2(
      Math.sin(hero.attackAim - facing), Math.cos(hero.attackAim - facing)
    );

    let draw;
    if (hero.attackTime < windup) {
      // Two-stage draw: a fast, large raise gets the bow up, then a long
      // strain pulls slowly to full draw -- accelerating straight into the
      // release so the last frames read as maximum tension, not twitch.
      const wt = Math.min(1, hero.attackTime / windup);
      if (wt < 0.38) {
        const r = wt / 0.38;
        draw = 0.55 * (1 - (1 - r) * (1 - r) * (1 - r));
      } else {
        const s = (wt - 0.38) / 0.62;
        draw = 0.55 + 0.45 * s * s;
      }
    } else {
      // Fast release snap: an ease-in whip back over a short slice of recovery,
      // so it starts instantly and settles into rest.
      const rt = Math.min(1, (hero.attackTime - windup) / (recovery * 0.4));
      draw = (1 - rt) * (1 - rt);
    }

    // The lower body keeps its gait while the torso and arms throw the bow
    // around. The poses are oversized on purpose -- at this scale the king is
    // a few dozen pixels, and a subtle twist reads as a twitch.
    rig.joints.torso.rotation.y += Math.max(-1.0, Math.min(1.0, aimDelta)) * 1.15 * draw;
    rig.joints.torso.rotation.x -= 0.15 * draw;
    rig.joints.shoulders[1].rotation.x -= 1.7 * draw;
    rig.joints.shoulders[1].rotation.z -= 0.3 * draw;
    rig.joints.shoulders[0].rotation.x -= 1.15 * draw;
    rig.joints.shoulders[0].rotation.y -= 1.4 * draw;
    rig.joints.shoulders[0].rotation.z += 0.35 * draw;

    // The bow kicks around toward the target with the draw, so the string
    // visibly points at the enemy rather than the arm merely twisting.
    bow.rotation.y = Math.PI / 2 + Math.max(-1.2, Math.min(1.2, aimDelta)) * 0.9 * draw;
  }

  function sync(world, alpha, elapsed) {
    const hero = world.hero;
    rig.root.visible = hero.alive;
    const airborne = hero.jumpPhase === 'airborne';
    contact.visible = hero.alive && !airborne;
    glow.visible = hero.alive && !airborne;
    updateDust(world.paused ? 0 : elapsed);
    if (hero.goal) {
      destinationTime += elapsed;
      // Asked of walkElevation -- the SAME function that decides how high the
      // king himself stands -- rather than sampled with groundYAt. The two
      // disagree near a cliff edge, because groundYAt consults the diagonal
      // crossing corridors before it consults the tile, and a corridor between
      // two tier-1 tiles passes straight through the corner of the tier-2 tile
      // beside them. A tap resolving to the upper tile could then plant its
      // marker a full tier below, on ground the king will never stand on.
      //
      // Using walkElevation also keeps the one case where the tile's own height
      // is NOT where he ends up: a ramp, where his height is interpolated along
      // the stairs. Answering with the tile there put the marker at the bottom
      // of a flight he was going to stop halfway up.
      const goalTier = board.at(hero.goal.i, hero.goal.j);
      const targetY = board.walkElevation(hero.goal.x, hero.goal.z, goalTier, false).y;
      destination.visible = true;
      destination.position.set(board.px(hero.goal.x), targetY + 0.02, board.px(hero.goal.z));
      pointer.position.y = 0.30 + Math.sin(destinationTime * 3.2) * 0.055;
      pointer.rotation.y = destinationTime * 3.8;
    } else {
      destination.visible = false;
    }
    if (!hero.alive) return;

    const x = hero.px + (hero.x - hero.px) * alpha;
    const z = hero.pz + (hero.z - hero.pz) * alpha;
    const y = hero.py + (hero.y - hero.py) * alpha;
    // During the arrival cutscene the intro owns the hero pose. Avoid blending
    // against normal gameplay-facing state while the boat is moving or the
    // interpolation can briefly turn the king back toward the island.
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

    if (hero.landingSerial !== seenLanding) {
      seenLanding = hero.landingSerial;
      burstDust(wx, groundY, wz);
    }

    const speed01 = hero.moving ? Math.min(1, hero.speed / config.hero.speed) : 0;
    for (const shoulder of rig.joints.shoulders) {
      shoulder.rotation.y = 0;
      shoulder.rotation.z = 0;
    }
    applyGait(rig.joints, gait, speed01, world.time * A.IDLE_RATE);
    rig.joints.bob.rotation.z *= 0.5;
    if (hero.jumpPhase) applyCliffPose(hero.jumpPhase, hero.jumpT);
    else applyAttackPose(hero, facing);
  }

  return {
    sync,
    // Driven from the heroHit event by feedback.js.
    hit() { hitAge = 0; },
  };
}

// ------------------------------------------------------------- build overlay
export function createGhostView(THREE, board, dynamicRoot) {
  // TDD 16 is blunt about this: the overlay "must account for real terrain LOS,
  // and for ballista it must reflect flat-trajectory blocking. A range circle
  // that lies about cliffs teaches the wrong model of the game."
  //
  // So this is not a circle. For every tile on the island it asks the same
  // question the targeting code asks -- elevation-modified range, minimum-range
  // dead zone, and line of sight along this tower's own trajectory -- and paints
  // the tiles that come back true. On flat ground it looks like a circle. Next
  // to a cliff it does not, and that difference is the whole point.
  //
  // It shares `canHit` with the simulation rather than reimplementing the rule,
  // which is what stops the two from drifting apart.
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.42,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide
  });
  const coverage = new THREE.Mesh(geometry, material);
  coverage.renderOrder = 1;
  coverage.visible = false;
  dynamicRoot.add(coverage);

  // The footprint marker, drawn as a FILL OVER AN OUTLINE: a slightly larger
  // dark plane underneath, and the tinted fill on top of it. The outline is
  // what makes this survive contact with the art -- 34% white on light grass,
  // which is what this used to be, is very close to invisible.
  //
  // It stopped being allowed to be subtle when the king became the build cursor
  // (TDD 16). It used to appear only while a mode was armed, so the player was
  // already hunting for it; now it is on for the whole build phase and it IS
  // the answer to "where will this go", so it has to be readable at a glance
  // over grass, stone and sand alike.
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
  marker.position.z = -0.004;      // toward the camera; the group is rotated flat
  marker.renderOrder = 1;
  markerGroup.add(marker);

  // Border width in tiles, held constant as the footprint grows: a 2x2 castle
  // preview should not get a border twice as thick as a 1x1 tower's.
  const BORDER = 0.07;

  const COVERED = [1.0, 1.0, 1.0];        // in range, in sight
  const DEAD = [0.76, 0.21, 0.18];        // inside the minimum-range dead zone
  const BLIND = [0.16, 0.22, 0.26];       // in range on paper, blocked by terrain

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
    // `probe(i, j, targetTile)` is supplied by main and closes over the real
    // combat predicate, so this file never learns the combat rules.
    // `span` is the footprint being previewed: 1 for a tower, 2 for the castle.
    show(i, j, valid, probe, span) {
      const size = span || 1;
      const y = board.topY(i, j) + 0.025;
      markerGroup.visible = true;
      // Anchored at (i, j), so a 2x2 preview covers the tiles it would occupy.
      markerGroup.position.set(board.px(i + (size - 1) / 2), y + 0.006, board.px(j + (size - 1) / 2));
      const fill = size - 0.06;
      marker.scale.set(fill, fill, 1);
      outline.scale.set(fill + BORDER * 2, fill + BORDER * 2, 1);
      // GOLD for a legal spot, not white. Gold is what every other affordance in
      // this HUD uses for "yours" and "spendable", and against green grass it
      // separates far better than a white wash does.
      marker.material.color.setHex(valid ? 0xf2c14e : 0xc2352f);
      marker.material.opacity = valid ? 0.42 : 0.5;
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
