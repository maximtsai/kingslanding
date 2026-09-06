// Hero TD -- structure view (towers, houses, castle).
//
// Extracted from views.js for maintainability. Handles instanced rendering,
// construction animation, demolition, health bars, occlusion, damage flames,
// contact shadows, and muzzle flashes for all structures.

import { config } from '../config.js';
import { flattenGroup } from './flatten.js';
import { muzzleHeight } from '../sim/los.js';

export function createStructureView(THREE, board, prefabs, soft, dynamicRoot, scenery) {
  const CAP = 64;
  const DUST_CAP = 128;
  const C = config.construction;
  const kinds = new Map();
  const bars = new Map();
  const construction = new Map();
  const repairPop = new Map();
  const hits = new Map();
  const liveStructures = new Set();

  const barGeo = new THREE.PlaneGeometry(0.62, 0.075);
  const barBackMat = new THREE.MeshBasicMaterial({ color: 0x1b2226, transparent: true, opacity: 0.72, depthTest: false });
  const barFillMat = new THREE.MeshBasicMaterial({ color: 0x49c96a, depthTest: false });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const blobQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const blobScale = new THREE.Vector3();
  const structureScale = new THREE.Vector3(1, 1, 1);

  const FLASH_CAP = 24;
  const flashGeo = new THREE.PlaneGeometry(0.17, 0.17);
  const flashBase = new THREE.MeshBasicMaterial({
    color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false,
    toneMapped: false
  });
  const flashes = Array.from({ length: FLASH_CAP }, () => {
    const mesh = new THREE.Mesh(flashGeo, flashBase.clone());
    mesh.visible = false;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    dynamicRoot.add(mesh);
    return { mesh, age: Infinity, x: 0, y: 0, z: 0 };
  });
  let flashCursor = 0;

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
    const prefab = key === 'house:ruined' ? prefabs.ruinedHouse()
                 : structure.kind === 'house' ? prefabs.house(0, 0, 0, 1)
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

  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), soft.buildingBlobMat, CAP);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const blobOpacity = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  blobs.geometry.setAttribute('instanceOpacity', blobOpacity);
  soft.buildingBlobMat.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float instanceOpacity; varying float vInstanceOpacity;\n' +
      shader.vertexShader.replace('#include <begin_vertex>',
        'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>');
    shader.fragmentShader = 'varying float vInstanceOpacity;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.a *= vInstanceOpacity;'
      );
  };
  soft.buildingBlobMat.customProgramCacheKey = () => 'building-shadow-construction-opacity-v1';
  soft.buildingBlobMat.needsUpdate = true;

  const selectionMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.82),
    new THREE.MeshBasicMaterial({ color: 0xffd21f, side: THREE.DoubleSide, depthWrite: false })
  );
  selectionMesh.rotation.x = -Math.PI / 2;
  selectionMesh.renderOrder = 3;
  selectionMesh.visible = false;
  dynamicRoot.add(selectionMesh);
  blobs.frustumCulled = false;
  blobs.count = 0;
  dynamicRoot.add(blobs);

  // Training dummies are a stake, not a building, so they get the units' small
  // round contact blob rather than the wide rounded-square footprint patch.
  const roundBlobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), soft.blobMat, CAP);
  roundBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  roundBlobs.frustumCulled = false;
  roundBlobs.count = 0;
  dynamicRoot.add(roundBlobs);

  const demolitions = new Map();
  const D = config.demolition;
  const DEMO_LIFE = Math.max(D.flash, D.sink);

  // Training dummies die by falling over rather than by being demolished, so
  // they get their own clock: { age, yaw }, keyed by structure id. See config
  // .dummyDeath for the timings and `toppleOf` below for the curve.
  const topples = new Map();
  const DUMMY = config.dummyDeath;
  const TOPPLE_LIFE = DUMMY.fall + DUMMY.settle + DUMMY.sink;
  // Its own Euler, in its own order. 'YXZ' means the tilt happens in the prop's
  // OWN frame and the yaw then swings that fall direction around the world --
  // which is the only way one angle and one heading describe a topple. The
  // shared `euler` is XYZ and is left alone.
  const toppleEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  // demolish() is called from the event pump, which does not carry the world.
  // The last frame's is close enough for "which way was the king standing".
  let lastWorld = null;

  // Where a toppling dummy is in its fall, as an angle from upright and a depth
  // below the ground. The group's origin sits at the centre of its foot, so
  // rotating about that origin pivots it exactly where a real post would hinge.
  function toppleOf(age) {
    const ft = Math.min(1, age / DUMMY.fall);
    // Gravity, not a lerp: it barely leans for the first third and then goes
    // over all at once, which is what sells the weight.
    let angle = (Math.PI / 2) * ft * ft;
    if (age > DUMMY.fall) {
      // It hits the ground and rocks back a little rather than sticking flat.
      const after = age - DUMMY.fall;
      angle -= DUMMY.rebound * Math.exp(-after * DUMMY.reboundDecay) *
               Math.sin(after * DUMMY.reboundRate);
    }
    const st = Math.max(0, Math.min(1,
      (age - DUMMY.fall - DUMMY.settle) / DUMMY.sink));
    // Ease IN: the ground accepts it slowly and then swallows it. The demolition
    // sink eases out, because a building is dropping rather than being taken.
    return { angle, sink: DUMMY.depth * st * st, sinkT: st };
  }

  const BLAST_CAP = 16;
  const blastGeo = new THREE.CircleGeometry(1, 12);
  const makeBlast = (colour, opacity) => {
    const m = new THREE.InstancedMesh(blastGeo, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity, depthWrite: false
    }), BLAST_CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 6;
    dynamicRoot.add(m);
    return m;
  };
  const blastYellow = makeBlast(0xffd23f, 0.92);
  const blastRed = makeBlast(0xff2a12, 0.80);
  const blastPos = new THREE.Vector3();
  const blastScale = new THREE.Vector3();

  const FLAME_CAP = 256;
  const F = config.flames;
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff3a17, transparent: true, opacity: 0.92, depthWrite: false
  });
  const flames = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), flameMat, FLAME_CAP);
  flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flames.frustumCulled = false;
  flames.count = 0;
  flames.renderOrder = 4;
  dynamicRoot.add(flames);

  const flamePos = new THREE.Vector3();
  const flameScale = new THREE.Vector3();

  const hash = (id, k) => {
    const v = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  function emberBase(s) {
    if (s.kind === 'house') return 0.62;
    if (s.kind === 'castle') return 1.55;
    return s.line === 'barricade' ? 0.35 : 1.05;
  }

  function emitFlames(s, wx, wz, baseY, damage, time, camera, start) {
    const count = Math.round(damage * F.max);
    let n = 0;
    for (let k = 0; k < count && start + n < FLAME_CAP; k++) {
      const a = hash(s.id, k), b = hash(s.id, k + 41), c = hash(s.id, k + 97);
      const phase = (time * F.rate * (0.75 + 0.5 * c) + a) % 1;
      const spread = s.kind === 'castle' ? 0.9 : 0.42;
      flamePos.set(
        wx + (a - 0.5) * spread + (b - 0.5) * 0.12 * phase,
        baseY + emberBase(s) + phase * F.rise,
        wz + (b - 0.5) * spread
      );
      const shrink = Math.min(1, (1 - phase) * 1.5);
      const size = F.size * (0.6 + 0.7 * c) * shrink;
      flameScale.set(size, size, size);
      matrix.compose(flamePos, camera.quaternion, flameScale);
      flames.setMatrixAt(start + n, matrix);
      n++;
    }
    return n;
  }

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

  const OCC = config.occlusion;
  const sceneryList = scenery || [];
  const viewMatrix = new THREE.Matrix4();
  const boxPoint = new THREE.Vector3();
  const fades = new Map();
  const ghosts = new Map();
  const ghostPool = [];
  const occluders = new Set();

  function ghostMaterial(source) {
    const material = source.clone();
    const coverage = { value: 1 };
    material.isGhostMaterial = true;
    material.userData.occlusionCoverage = coverage;
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

  const depthOf = (wx, wz) => wx * forwardX + wz * forwardZ;

  function occludes(entry, wx, wy, wz) {
    const box = entry.mesh.geometry.boundingBox;
    if (!box) return false;

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

    const centreX = wx + (box.min.x + box.max.x) / 2;
    const centreZ = wz + (box.min.z + box.max.z) / 2;
    const halfX = (box.max.x - box.min.x) / 2;
    const halfZ = (box.max.z - box.min.z) / 2;
    const support = halfX * Math.abs(forwardX) + halfZ * Math.abs(forwardZ);
    const nearFace = depthOf(centreX, centreZ) - support;

    for (let k = 0; k < subjects.length; k += 4) {
      if (depthOf(subjects[k + 2], subjects[k + 3]) <= nearFace) continue;
      const x = subjects[k], y = subjects[k + 1];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      return true;
    }
    return false;
  }

  function sync(world, camera, elapsed, selectedId = null) {
    lastWorld = world;
    for (const entry of kinds.values()) entry.count = 0;
    selectionMesh.visible = false;
    let blobCount = 0;
    let roundCount = 0;
    let flameCount = 0;
    let yellowCount = 0, redCount = 0;
    liveStructures.clear();

    camera.updateMatrixWorld();
    viewMatrix.copy(camera.matrixWorld).invert();
    if (OCC.enabled) gatherSubjects(world, camera); else subjects.length = 0;
    occluders.clear();

    for (const s of world.structures.list) {
      liveStructures.add(s.id);
      const ruinedHouse = !s.alive && s.kind === 'house';

      if (s.alive && demolitions.has(s.id)) demolitions.delete(s.id);
      if (s.alive && topples.has(s.id)) topples.delete(s.id);

      let demo = demolitions.get(s.id);
      if (demo !== undefined) {
        demo += world.paused ? 0 : elapsed;
        if (demo >= DEMO_LIFE) { demolitions.delete(s.id); demo = undefined; }
        else demolitions.set(s.id, demo);
      }

      let topple = topples.get(s.id);
      if (topple !== undefined) {
        topple.age += world.paused ? 0 : elapsed;
        if (topple.age >= TOPPLE_LIFE) { topples.delete(s.id); topple = undefined; }
      }

      if (!s.alive && !ruinedHouse && demo === undefined && topple === undefined) {
        const existing = bars.get(s.id);
        if (existing) existing.bar.visible = false;
        continue;
      }

      const entry = kindFor(ruinedHouse ? 'house:ruined'
        : s.kind === 'tower' ? 'tower:' + s.type : s.kind, s);
      const wx = board.px(s.x), wz = board.px(s.z);
      const wy = board.topY(s.i, s.j) - config.board.SINK;
      let build = construction.get(s.id);
      if (s.repaired) {
        s.repaired = false;
        repairPop.set(s.id, 0);
        for (let k = 0; k < 5; k++) startDustPuff(s, wx, board.topY(s.i, s.j), 100 + k);
      }
      const repairAge = repairPop.has(s.id) ? repairPop.get(s.id) + (world.paused ? 0 : elapsed) : Infinity;
      if (repairPop.has(s.id)) {
        if (repairAge >= 0.48) repairPop.delete(s.id);
        else repairPop.set(s.id, repairAge);
      }
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

      let shakeEnvelope = Math.sin(Math.PI * progress);
      let shakePhase = build.age * C.shakeRate + s.id * 2.17;
      let shakeAmp = C.shakeOffset, shakeTiltAmp = C.shakeTilt;
      let sink = 0;

      if (demo !== undefined) {
        const st = Math.min(1, demo / D.sink);
        sink = D.depth * (1 - (1 - st) * (1 - st));
        shakeEnvelope = 1 - st;
        shakePhase = demo * D.shakeRate + s.id * 2.17;
        shakeAmp = D.shakeOffset;
        shakeTiltAmp = D.shakeTilt;

        if (demo < D.flash) {
          const cut = D.flash * 0.45;
          let target = null, size = 0;
          if (demo < cut) {
            const k = demo / cut;
            size = D.ring * (0.30 + 0.70 * k * (2 - k));
            target = 'yellow';
          } else {
            const k = (demo - cut) / (D.flash - cut);
            size = D.ring * (1 + 0.35 * k) * (k < 0.7 ? 1 : (1 - k) / 0.3);
            target = 'red';
          }
          if (size > 0.001) {
            blastPos.set(wx, board.topY(s.i, s.j) + 0.45, wz);
            blastScale.set(size, size, size);
            matrix.compose(blastPos, camera.quaternion, blastScale);
            if (target === 'yellow') blastYellow.setMatrixAt(yellowCount++, matrix);
            else blastRed.setMatrixAt(redCount++, matrix);
          }
        }
      }

      const shakeX = Math.sin(shakePhase) * shakeAmp * shakeEnvelope;
      const shakeZ = Math.cos(shakePhase * 1.31) * shakeAmp * shakeEnvelope;
      const shakeTiltX = Math.sin(shakePhase * 0.83) * shakeTiltAmp * shakeEnvelope;
      const shakeTiltZ = Math.cos(shakePhase * 1.07) * shakeTiltAmp * shakeEnvelope;

      let hitA = 0;
      if (hits.has(s.id)) {
        const hAge = hits.get(s.id) + (world.paused ? 0 : elapsed);
        if (hAge >= 0.3) hits.delete(s.id);
        else { hits.set(s.id, hAge); hitA = Math.sin(Math.PI * hAge / 0.3); }
      }
      const hitPhase = s.id * 4.7;
      const hitJitter = 0.012 * hitA;
      const hitTilt = 0.018 * hitA;
      const hitSquash = 0.02 * hitA;

      const pop = repairPop.has(s.id) ? repairPop.get(s.id) : Infinity;
      const popT = pop === Infinity ? 0 : Math.min(1, pop / 0.48);
      const popHeight = pop === Infinity ? 0 : Math.sin(Math.PI * popT) * 0.16;

      const fall = topple === undefined ? null : toppleOf(topple.age);
      if (fall) {
        // A falling post has no shudder, no build rise and no hit squash left in
        // it. One tilt, one heading, one depth.
        toppleEuler.set(fall.angle, topple.yaw, 0, 'YXZ');
        quaternion.setFromEuler(toppleEuler);
        position.set(wx, wy - fall.sink, wz);
        structureScale.set(1, 1, 1);
      } else {
        euler.set(shakeTiltX + Math.sin(hitPhase) * hitTilt,
                  s.kind === 'tower' ? s.rotation : 0,
                  shakeTiltZ + Math.cos(hitPhase * 1.3) * hitTilt);
        quaternion.setFromEuler(euler);
        position.set(
          wx + shakeX + Math.sin(hitPhase * 0.9) * hitJitter,
          wy - riseDepth * (1 - rise) + popHeight - sink,
          wz + shakeZ + Math.cos(hitPhase) * hitJitter
        );
        structureScale.set(
          0.94 + rise * 0.06 - hitSquash,
          1 + (pop === Infinity ? 0 : Math.sin(Math.PI * popT) * 0.12) + hitSquash * 0.5,
          0.94 + rise * 0.06 - hitSquash
        );
      }
      matrix.compose(position, quaternion, structureScale);

      const hidingSomething = OCC.enabled && progress >= 1 &&
        occludes(entry, position.x, position.y, position.z);
      const previous = fades.get(s.id) || 0;
      const step = Math.min(1, (world.paused ? 0 : elapsed) * OCC.fadeRate);
      const fade = previous + ((hidingSomething ? 1 : 0) - previous) * step;
      if (fade > 0.01) fades.set(s.id, fade); else fades.delete(s.id);

      if (fade > 0.01) {
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
        const opacity = 1 - fade * (1 - OCC.opacity);
        ghost.material.userData.occlusionCoverage.value = opacity;
      } else if (entry.count < CAP) {
        entry.mesh.setMatrixAt(entry.count++, matrix);
      }

      if (selectedId === s.id && s.alive && s.kind === 'tower' &&
          progress >= 1 && s.type &&
          (config.towers[s.type]?.upgradesTo || []).length) {
        selectionMesh.position.set(wx, board.topY(s.i, s.j) + 0.025, wz);
        selectionMesh.visible = true;
      }

      if (s.kind === 'trainingDummy') {
        // The blob holds through the fall -- it is still lying on the ground --
        // and closes as the ground takes it.
        const shade = 0.52 * (fall ? 1 - fall.sinkT : 1);
        if (roundCount < CAP && shade > 0.001) {
          position.set(wx, board.topY(s.i, s.j) + 0.012, wz);
          blobScale.set(shade, shade, shade);
          matrix.compose(position, blobQuat, blobScale);
          roundBlobs.setMatrixAt(roundCount++, matrix);
        }
      } else if (blobCount < CAP) {
        const size = ruinedHouse ? 0.85 : s.kind === 'house' ? 1.05 : s.kind === 'castle' ? 2.8
                   : s.line === 'barricade' ? 1.15 : 1.1;
        position.set(wx, board.topY(s.i, s.j) + 0.012, wz);
        blobScale.set(size, size, size);
        matrix.compose(position, blobQuat, blobScale);
        blobOpacity.setX(blobCount, Math.max(0, Math.min(1, rise)));
        blobs.setMatrixAt(blobCount++, matrix);
      }

      // A dummy is meant to be shot to pieces, so a damaged one must not sit
      // there burning the way a damaged building does.
      if (s.alive && demo === undefined && progress >= 1 && s.hp < s.maxHp &&
          s.kind !== 'trainingDummy') {
        const damage = Math.min(1, 1 - s.hp / s.maxHp);
        flameCount += emitFlames(s, wx, wz, board.topY(s.i, s.j),
                                 damage, world.time, camera, flameCount);
      }

      const hurt = s.kind === 'castle' && s.alive && progress >= 1 && s.hp < s.maxHp;
      const view = hurt ? barFor(s) : bars.get(s.id);
      if (view) {
        view.bar.visible = hurt;
        if (hurt) {
          const height = board.topY(s.i, s.j) +
            (s.kind === 'house' ? 1.05 : s.kind === 'castle' ? 2.05 : 1.55);
          view.bar.position.set(wx, height, wz);
          view.bar.quaternion.copy(camera.quaternion);
          const ratio = Math.max(0, s.hp / s.maxHp);
          view.fill.scale.x = ratio;
          view.fill.position.x = -0.62 * (1 - ratio) / 2;
        }
      }
    }

    for (const entry of kinds.values()) {
      entry.mesh.count = entry.count;
      if (entry.count) entry.mesh.instanceMatrix.needsUpdate = true;
    }
    roundBlobs.count = roundCount;
    if (roundCount) roundBlobs.instanceMatrix.needsUpdate = true;
    blobs.count = blobCount;
    if (blobCount) {
      blobs.instanceMatrix.needsUpdate = true;
      blobOpacity.needsUpdate = true;
    }
    flames.count = flameCount;
    if (flameCount) flames.instanceMatrix.needsUpdate = true;
    blastYellow.count = yellowCount;
    if (yellowCount) blastYellow.instanceMatrix.needsUpdate = true;
    blastRed.count = redCount;
    if (redCount) blastRed.instanceMatrix.needsUpdate = true;

    const flashDt = world.paused ? 0 : elapsed;
    for (const f of flashes) {
      if (f.age === Infinity) continue;
      f.age += flashDt;
      const t = f.age / 0.14;
      if (t >= 1) { f.mesh.visible = false; f.age = Infinity; continue; }
      const k = t * t * (3 - 2 * t);
      f.mesh.material.opacity = 0.85 * (1 - t);
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.scale.set(0.5 + 0.9 * k, 0.5 + 0.9 * k, 1);
      f.mesh.visible = true;
    }

    updateDust(world.paused ? 0 : elapsed);

    for (const [id, view] of bars) {
      if (liveStructures.has(id)) continue;
      if (view.bar.parent) view.bar.parent.remove(view.bar);
      bars.delete(id);
    }
    for (const id of topples.keys()) {
      if (!liveStructures.has(id)) topples.delete(id);
    }
    for (const id of demolitions.keys()) {
      if (!liveStructures.has(id)) demolitions.delete(id);
    }
    for (const id of construction.keys()) {
      if (!liveStructures.has(id)) construction.delete(id);
    }
    for (const id of hits.keys()) {
      if (!liveStructures.has(id)) hits.delete(id);
    }
    for (const id of [...ghosts.keys()]) {
      if (!occluders.has(id)) releaseGhost(id);
    }
    for (const id of [...fades.keys()]) {
      if (!liveStructures.has(id)) fades.delete(id);
    }

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
    demolish(s) {
      if (!s) return;
      // A pell is a stake in the dirt: nothing in it to come apart, so it falls
      // over instead of blowing up. It goes down AWAY from whoever knocked it
      // down, which is the only force in the picture.
      if (s.kind === 'trainingDummy') {
        const hero = lastWorld && lastWorld.hero;
        topples.set(s.id, {
          age: 0,
          yaw: hero ? Math.atan2(s.x - hero.x, s.z - hero.z) : s.id * 2.399
        });
        return;
      }
      if (s.kind !== 'tower') return;
      demolitions.set(s.id, 0);
      const groundY = board.topY(s.i, s.j);
      for (let k = 0; k < D.dustPuffs; k++) {
        startDustPuff(s, board.px(s.x), groundY, 200 + k);
      }
    },
    hit(s) {
      if (!s) return;
      hits.set(s.id, 0);
    },
    flash(tileX, tileZ) {
      const f = flashes[flashCursor++ % FLASH_CAP];
      f.age = 0;
      f.x = board.px(tileX);
      f.y = muzzleHeight(board, Math.floor(tileX), Math.floor(tileZ));
      f.z = board.px(tileZ);
      f.mesh.visible = true;
    },
    get occluding() { return new Set(occluders); },
    get demolishing() { return new Set(demolitions.keys()); }
  };
}
