// Hero TD -- boat view.
//
// Handles hull rendering, beaching, retreat/submerge animation, wakes,
// and bubble effects for intro and wave boats.

import { config } from '../config.js';
import { applyGait } from './units.js';
import { flattenGroup } from './flatten.js';

const A = config.anim;

export function createBoatView(THREE, board, kit, rigs, dynamicRoot) {
  const views = new Map();
  const liveBoats = new Set();
  const { mat } = kit;

  const SECTIONS = [
    { z: -0.72, w: 0.026, keel:  0.062, sheer: 0.190, floor: 0.150 },
    { z: -0.46, w: 0.155, keel:  0.006, sheer: 0.122, floor: 0.060 },
    { z: -0.16, w: 0.230, keel: -0.022, sheer: 0.100, floor: 0.028 },
    { z:  0.16, w: 0.230, keel: -0.022, sheer: 0.100, floor: 0.028 },
    { z:  0.46, w: 0.155, keel:  0.006, sheer: 0.122, floor: 0.060 },
    { z:  0.72, w: 0.026, keel:  0.062, sheer: 0.190, floor: 0.150 }
  ];
  const WALL = 0.030;
  const KEEL = 0.42;
  const FLOORW = 0.55;

  const inner = s => Math.max(0, s.w - WALL);

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

  const hullGeo = (() => {
    const pos = [];
    const tri = (a, b, c) => pos.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const OL = s => [-s.w, s.sheer, s.z];
    const OR = s => [ s.w, s.sheer, s.z];
    const IL = s => [-inner(s), s.sheer, s.z];
    const IR = s => [ inner(s), s.sheer, s.z];
    const FL = s => [-inner(s) * FLOORW, s.floor, s.z];
    const FR = s => [ inner(s) * FLOORW, s.floor, s.z];
    const BL = s => [-s.w * KEEL, s.keel, s.z];
    const BR = s => [ s.w * KEEL, s.keel, s.z];

    // Track which quad slots are interior surfaces (floor + inner sides) so
    // their triangles can be given a lighter wood colour after normals are baked.
    const interiorQuads = new Set();
    let quadIdx = 0;

    for (let k = 0; k < SECTIONS.length - 1; k++) {
      const a = SECTIONS[k], b = SECTIONS[k + 1];
      quad(BL(a), BL(b), OL(b), OL(a));       // 0 port topside outside
      quad(BR(a), OR(a), OR(b), BR(b));       // 1 starboard topside outside
      quad(BL(a), BR(a), BR(b), BL(b));       // 2 bottom
      quad(OL(a), OL(b), IL(b), IL(a));       // 3 rim band port
      quad(IR(a), IR(b), OR(b), OR(a));       // 4 rim band starboard
      interiorQuads.add(quadIdx + 5);          // 5 port inner side
      quad(IL(a), IL(b), FL(b), FL(a));
      interiorQuads.add(quadIdx + 6);          // 6 starboard inner side
      quad(FR(b), IR(b), IR(a), FR(a));
      interiorQuads.add(quadIdx + 7);          // 7 floor
      quad(FL(a), FL(b), FR(b), FR(a));
      quadIdx += 8;
    }
    const bow = SECTIONS[0], stern = SECTIONS[SECTIONS.length - 1];
    quad(BL(bow), OL(bow), OR(bow), BR(bow));
    quad(BL(stern), BR(stern), OR(stern), OL(stern));

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();

    // Write per-vertex colours: each quad is 2 triangles (6 verts). Interior
    // quads (floor, inner sides) get a lighter wood; everything else keeps the
    // original hull colour.
    const VERTS_PER_TRI = 3;
    const TRIS_PER_QUAD = 2;
    const totalTris = pos.length / 9;
    const hullR = 0x6b / 255, hullG = 0x8f / 255, hullB = 0xa3 / 255;
    const innerR = 0xb8 / 255, innerG = 0x9c / 255, innerB = 0x6e / 255;
    const colors = new Float32Array(pos.length);
    for (let t = 0; t < totalTris; t++) {
      const q = (t / TRIS_PER_QUAD) | 0;    // which quad this triangle belongs to
      const isInner = interiorQuads.has(q);
      const r = isInner ? innerR : hullR;
      const gv = isInner ? innerG : hullG;
      const bv = isInner ? innerB : hullB;
      for (let v = 0; v < VERTS_PER_TRI; v++) {
        const i = (t * VERTS_PER_TRI + v) * 3;
        colors[i] = r; colors[i + 1] = gv; colors[i + 2] = bv;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  })();

  const oarGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.68, 4);
  oarGeo.translate(0, 0.23, 0);
  const finialGeo = new THREE.ConeGeometry(0.038, 0.075, 5);
  const bubbleGeo = new THREE.SphereGeometry(0.035, 6, 4);

  const WAKE_CAP = 24;
  const WAKE_WIDE = 1.32, WAKE_LONG = 2.86, WAKE_Y = 0.02;
  const wakeTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(128, 128);
    const d = img.data;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const r = Math.hypot(x - 63.5, y - 63.5) / 63.5;
        const i = (y * 128 + x) * 4;
        if (r >= 1) continue;
        const crest = Math.sin(r * Math.PI * 7) * 0.5 + 0.5;
        const fade = (1 - r) * (1 - r);
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(crest * crest * fade * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
  })();
  const wakeGeo = new THREE.PlaneGeometry(1, 1);
  wakeGeo.rotateX(-Math.PI / 2);
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.5, fog: false });
  const wakeMesh = new THREE.InstancedMesh(wakeGeo, wakeMat, WAKE_CAP);
  wakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wakeMesh.frustumCulled = false;
  wakeMesh.count = 0;
  dynamicRoot.add(wakeMesh);

  const wakeMatrix = new THREE.Matrix4();
  const wakePos = new THREE.Vector3();
  const wakeQuat = new THREE.Quaternion();
  const wakeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const wakeScale = new THREE.Vector3();
  function writeWake(i, x, z, heading, visible, phase) {
    const wave = Math.sin(phase);
    wakePos.set(x, WAKE_Y + wave * config.intro.wakeBob, z);
    wakeEuler.set(0, heading, 0);
    wakeQuat.setFromEuler(wakeEuler);
    const breath = 1 + wave * config.intro.wakePulseDepth;
    wakeScale.set(visible ? WAKE_WIDE * breath : 0, 1, visible ? WAKE_LONG * breath : 0);
    wakeMatrix.compose(wakePos, wakeQuat, wakeScale);
    wakeMesh.setMatrixAt(i, wakeMatrix);
  }

  let baked = null;
  function make() {
    if (!baked) baked = flattenGroup(THREE, buildBoat());
    const group = new THREE.Mesh(baked.geometry, baked.material);
    group.frustumCulled = false;
    dynamicRoot.add(group);

    const bubbleMaterial = new THREE.MeshBasicMaterial({ color: 0xdaf4ed, transparent: true, opacity: 0.7, depthWrite: false });
    const bubbles = Array.from({ length: 5 }, () => {
      const bubble = new THREE.Mesh(bubbleGeo, bubbleMaterial);
      bubble.visible = false;
      dynamicRoot.add(bubble);
      return { mesh: bubble, age: Infinity, seed: Math.random() };
    });
    return { group, beached: 0, bubbles, bubbleClock: 0, retreat: 0, submerge: 0, sway: 0 };
  }

  function buildBoat() {
    const group = new THREE.Group();
    const darkWood = 0x4f3532, timber = 0x806044;

    // The hull uses vertex colours written above, so flattenGroup picks up
    // the lighter interior faces automatically.
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x6b8fa3, vertexColors: true });
    group.add(new THREE.Mesh(hullGeo, hullMat));

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

    for (const z of [-0.30, 0.30]) {
      const s = sectionAt(z);
      const bench = kit.bevelBox(Math.max(0, s.w - WALL) * 2, 0.05, 0.024, 0, timber);
      bench.position.set(0, s.floor, z);
      group.add(bench);
    }

    for (const side of [-1, 1]) {
      for (const z of [-0.20, 0.20]) {
        const s = sectionAt(z);
        const oar = new THREE.Mesh(oarGeo, mat(0x9a754d));
        oar.position.set(side * (s.w - WALL * 0.5), s.sheer - 0.004, z);
        oar.rotation.z = side * Math.PI / 2.55;
        group.add(oar);
      }
    }

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
    let wakeCursor = 0;
    for (const boat of world.waves.boats) {
      liveBoats.add(boat.id);
      let view = views.get(boat.id);
      if (!view) { view = make(); views.set(boat.id, view); }
      const x = boat.px + (boat.x - boat.px) * alpha;
      const z = boat.pz + (boat.z - boat.pz) * alpha;
      const boatSeed = typeof boat.id === 'number' ? boat.id : 0;
      let wakeVisible = true;

      const landed = boat.introPhase === 'grounded' || boat.introPhase === 'retreating';
      const target = boat.landed || landed ? 1 : 0;
      const movingRoll = boat.landed || landed ? 0 : Math.sin((world.time + boatSeed * 0.17) * config.intro.boatSwayRate) * config.intro.boatSway * 0.55;
      const k = elapsed ? 1 - Math.exp(-elapsed / GROUND.seconds) : 1;
      view.beached += (target - view.beached) * k;

      if (boat.introPhase === 'retreating') {
        view.retreat = Math.min(1, view.retreat + elapsed / config.intro.boatSlideSeconds);
        view.submerge = Math.min(1, view.submerge + elapsed / config.intro.boatSubmergeSeconds);
        view.sway += elapsed;
        const eased = view.retreat * view.retreat * (3 - 2 * view.retreat);
        const retreatX = -Math.sin(boat.facing) * config.intro.boatSlideBack * eased;
        const retreatZ = -Math.cos(boat.facing) * config.intro.boatSlideBack * eased;
        view.group.position.set(board.px(x + retreatX), config.waves.hullY + view.beached * GROUND.lift - view.submerge * 0.48, board.px(z + retreatZ));
        view.group.rotation.order = 'YXZ';
        const rock = Math.sin(view.sway * config.intro.boatSwayRate) * config.intro.boatSway * 0.55 * view.submerge;
        view.group.rotation.set(-view.beached * GROUND_PITCH, boat.facing, rock);
        wakeVisible = view.submerge < 0.92;
        view.group.visible = view.submerge < 1;
        view.bubbleClock += elapsed;
        if (view.bubbleClock >= config.intro.bubbleInterval) {
          view.bubbleClock = 0;
          const bubble = view.bubbles.find(item => item.age === Infinity);
          if (bubble) { bubble.age = 0; bubble.life = config.intro.bubbleLifetime * (0.75 + bubble.seed * 0.4); bubble.mesh.visible = true; bubble.mesh.position.set(board.px(x + retreatX + (bubble.seed - 0.5) * 0.3), config.waves.hullY - view.submerge * 0.3, board.px(z + retreatZ + (bubble.seed - 0.5) * 0.3)); }
        }
        for (const bubble of view.bubbles) {
          if (bubble.age === Infinity) continue;
          bubble.age += elapsed;
          const bt = Math.min(1, bubble.age / bubble.life);
          bubble.mesh.position.y += elapsed * 0.18;
          bubble.mesh.scale.setScalar(0.7 + bt * 1.2);
          bubble.mesh.material.opacity = (1 - bt) * 0.7;
          if (bt >= 1) { bubble.age = Infinity; bubble.mesh.visible = false; }
        }
      } else {
        view.group.visible = true;
        wakeVisible = true;
        view.group.position.set(board.px(x), config.waves.hullY + view.beached * GROUND.lift, board.px(z));
        view.group.rotation.order = 'YXZ';
        view.group.rotation.set(-view.beached * GROUND_PITCH, boat.facing, movingRoll);
      }
      if (wakeCursor < WAKE_CAP) {
        writeWake(wakeCursor, board.px(x), board.px(z), boat.facing, wakeVisible, world.time * config.intro.wakePulseRate + boatSeed * 0.62);
      }
      wakeCursor++;
    }
    wakeMesh.count = Math.min(wakeCursor, WAKE_CAP);
    if (wakeMesh.count) wakeMesh.instanceMatrix.needsUpdate = true;
    for (const [id, view] of views) {
      if (liveBoats.has(id)) continue;
      view.group.visible = false;
    }
  }

  const poseOffset = new THREE.Vector3();
  function poseOf(unit, outPosition, outQuaternion) {
    const boat = unit && unit.boat;
    const view = boat && views.get(boat.id);
    if (!boat || !view || !view.group.visible) return false;
    poseOffset.set(0, unit.y - config.waves.hullY + A.ENEMY_LIFT, unit.boatOffset);
    outPosition.copy(poseOffset).multiply(view.group.scale)
      .applyQuaternion(view.group.quaternion).add(view.group.position);
    outQuaternion.copy(view.group.quaternion);
    return true;
  }

  return { sync, poseOf };
}
