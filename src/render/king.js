// Hero TD -- the king.
//
// The one figure built with real care: a swept cloth cape, an ink outline pass,
// and a faceted crown. He is the focal point, so he gets the outlines and the
// warm ground glow that nothing else in the scene has.
//
// TDD 15 requires him to be findable in under a second at maximum zoom-out by
// scanning for red against yellow-green, which is what the cape is for.
//
// Rigged for animation on the same skeleton as rigs.js -- root, bob, hips and
// shoulders -- so one gait driver animates both him and the raiders. The cape,
// crown, belt and bow all ride the torso; the bow rides the right shoulder, so
// it swings with the arm that holds it.

export function createKingRig(THREE, kit, P) {
  const { mat, bevelBox } = kit;

  const root = new THREE.Group();
  const bob = new THREE.Group();
  root.add(bob);
  const torso = new THREE.Group();
  bob.add(torso);
  const hips = [], shoulders = [];

  // Everything that is not a limb hangs off the torso; `king` keeps the original
  // code below readable and unchanged.
  const king = torso;
  const outlineMat = new THREE.LineBasicMaterial({ color: 0x111014 });
  const addOutlined = (mesh, threshold, parent) => {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold || 18), outlineMat);
    outline.renderOrder = 2;
    mesh.add(outline);
    (parent || king).add(mesh);
    return mesh;
  };

  // Each row is an elliptical arc swept around the torso rather than a straight
  // span, so the cloth curves over the shoulders and closes toward the chest.
  // Down the length the ellipse widens, its wrap angle opens out, and the whole
  // sweep swings back -- pinned at the collar, hanging free at the hem.
  const capeGeo = new THREE.BufferGeometry();
  const capePositions = [], capeIndices = [];
  const capeRows = 11, capeColumns = 13;
  const blend = (a, b, k) => a + (b - a) * k;
  let capeShoulder = null;
  for (let row = 0; row < capeRows; row++) {
    const t = row / (capeRows - 1);
    const eased = t * t * (3 - 2 * t);
    const across = blend(0.113, 0.25, eased);  // ellipse semi-axis, left to right
    const around = blend(0.072, 0.1, eased);   // semi-axis, front to back
    const wrap = blend(1.45, 0.98, eased);     // how far the cloth reaches forward
    const swing = -0.012 - 0.135 * Math.pow(t, 1.8);
    const relief = 0.02 * Math.pow(t, 1.3);    // folds are pinned flat at the collar
    for (let column = 0; column < capeColumns; column++) {
      const u = column / (capeColumns - 1) * 2 - 1;
      const theta = u * wrap;
      const ripple = Math.cos(u * Math.PI * 3);
      // Displace folds along the arc's outward normal so they read as cloth
      // thickness, not as the sheet bending sideways.
      const fold = ripple * relief;
      // The hem eases in a swallow-tail: raised corners, and the bulge of each
      // fold hanging lower than the trough between them.
      const hem = (u * u * 0.022 - ripple * 0.012) * Math.pow(t, 3);
      const point = [
        across * Math.sin(theta) + fold * Math.sin(theta),
        0.5 - t * 0.48 + hem,
        swing - around * Math.cos(theta) - fold * Math.cos(theta)
      ];
      capePositions.push(point[0], point[1], point[2]);
      if (row === 0 && column === capeColumns - 1) capeShoulder = point;
    }
  }
  for (let row = 0; row < capeRows - 1; row++) for (let column = 0; column < capeColumns - 1; column++) {
    const a = row * capeColumns + column, b = a + 1;
    const d = (row + 1) * capeColumns + column, c = d + 1;
    capeIndices.push(a, d, c, a, c, b);
  }
  capeGeo.setAttribute('position', new THREE.Float32BufferAttribute(capePositions, 3));
  capeGeo.setIndex(capeIndices);
  capeGeo.computeVertexNormals();
  const cape = new THREE.Mesh(capeGeo, new THREE.MeshLambertMaterial({ color: P.cape, side: THREE.DoubleSide }));
  king.add(cape);

  // Trace the cape's silhouette by walking its border vertices in order.
  const capeBorderPositions = [];
  const addCapePoint = index => capeBorderPositions.push(
    capePositions[index * 3], capePositions[index * 3 + 1], capePositions[index * 3 + 2]
  );
  for (let column = 0; column < capeColumns; column++) addCapePoint(column);
  for (let row = 1; row < capeRows; row++) addCapePoint(row * capeColumns + capeColumns - 1);
  for (let column = capeColumns - 2; column >= 0; column--) addCapePoint((capeRows - 1) * capeColumns + column);
  for (let row = capeRows - 2; row > 0; row--) addCapePoint(row * capeColumns);
  const capeBorderGeo = new THREE.BufferGeometry();
  capeBorderGeo.setAttribute('position', new THREE.Float32BufferAttribute(capeBorderPositions, 3));
  const capeBorder = new THREE.LineLoop(capeBorderGeo, outlineMat);
  capeBorder.renderOrder = 2;
  king.add(capeBorder);

  const body = bevelBox(0.2, 0.13, 0.34, 0, P.king);
  body.position.y = 0.22; addOutlined(body);
  const head = bevelBox(0.16, 0.14, 0.16, 0, 0xdac7a5);
  head.position.y = 0.49; addOutlined(head);
  const hair = bevelBox(0.17, 0.055, 0.1, 0, 0x3b2b23);
  hair.position.set(0, 0.535, -0.06); addOutlined(hair);
  [-1, 1].forEach((side, k) => {
    // Hip and shoulder pivots sit at the top of each limb, so rotating them
    // swings the limb rather than spinning it about its foot or its hand. Rest
    // offsets stay on the meshes, which keeps the pose identical to the diorama.
    const hip = new THREE.Group();
    hip.position.set(side * 0.062, 0.18, 0);
    bob.add(hip); hips[k] = hip;
    const leg = bevelBox(0.065, 0.08, 0.18, 0, 0x24242a);
    leg.position.y = -0.18; addOutlined(leg, 18, hip);

    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.155, 0.49, 0);
    torso.add(shoulder); shoulders[k] = shoulder;
    const arm = bevelBox(0.055, 0.075, 0.24, 0, P.king);
    arm.position.y = -0.24; arm.rotation.z = side * 0.16; addOutlined(arm, 18, shoulder);
    const clasp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), new THREE.MeshBasicMaterial({ color: P.crown }));
    // Sit on the cape's own top corner so the pin reads as holding the cloth.
    clasp.position.set(side * capeShoulder[0], capeShoulder[1] - 0.012, capeShoulder[2] + 0.004);
    addOutlined(clasp, 24);
  });

  // Crown: a band, then six points built as separate front/back shells so the
  // spikes have thickness rather than being a folded ribbon.
  const crownMat = new THREE.MeshBasicMaterial({ color: P.crown, side: THREE.DoubleSide });
  const crownBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1125, 0.1125, 0.105, 12), crownMat);
  crownBase.position.y = 0.615;
  king.add(crownBase);
  const crownPositions = [], crownIndices = [], crownOutlinePositions = [];
  const points = 6, halfSector = Math.PI / points;
  for (let k = 0; k < points; k++) {
    const angle = k / points * Math.PI * 2;
    const left = angle - halfSector, right = angle + halfSector;
    const start = crownPositions.length / 3;
    crownPositions.push(
      Math.cos(left) * 0.1125, 0.665, Math.sin(left) * 0.1125,
      Math.cos(angle) * 0.108, 0.775, Math.sin(angle) * 0.108,
      Math.cos(right) * 0.1125, 0.665, Math.sin(right) * 0.1125,
      Math.cos(left) * 0.07, 0.665, Math.sin(left) * 0.07,
      Math.cos(angle) * 0.062, 0.746, Math.sin(angle) * 0.062,
      Math.cos(right) * 0.07, 0.665, Math.sin(right) * 0.07
    );
    crownIndices.push(
      start, start + 1, start + 2,
      start + 5, start + 4, start + 3,
      start, start + 3, start + 4, start, start + 4, start + 1,
      start + 1, start + 4, start + 5, start + 1, start + 5, start + 2
    );
    crownOutlinePositions.push(
      Math.cos(left) * 0.1135, 0.665, Math.sin(left) * 0.1135,
      Math.cos(angle) * 0.109, 0.777, Math.sin(angle) * 0.109
    );
  }
  const crownPointsGeo = new THREE.BufferGeometry();
  crownPointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(crownPositions, 3));
  crownPointsGeo.setIndex(crownIndices);
  crownPointsGeo.computeVertexNormals();
  king.add(new THREE.Mesh(crownPointsGeo, crownMat));
  const crownOutlineGeo = new THREE.BufferGeometry();
  crownOutlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(crownOutlinePositions, 3));
  const crownOutline = new THREE.LineLoop(crownOutlineGeo, outlineMat);
  crownOutline.renderOrder = 2;
  king.add(crownOutline);
  const crownBaseOutline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 12 }, (_, k) => {
      const angle = k / 12 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 0.1135, 0.5625, Math.sin(angle) * 0.1135);
    })),
    outlineMat
  );
  crownBaseOutline.renderOrder = 2;
  king.add(crownBaseOutline);

  const belt = bevelBox(0.215, 0.145, 0.045, 0, P.crown);
  belt.position.y = 0.3; addOutlined(belt);
  // Carried in the right hand, so it rides that shoulder rather than the torso.
  // Same construction fault the enemy archer's bow had: a torus arc starts at
  // +X and sweeps round, so standing it up with a bare rotation.y left the
  // belly pointing at the sky and the bow hooping over his head. Centre the arc
  // on +X, then swing +X to +Z -- the way he faces. See rigs.js for the long
  // version; this is the same fix on his own geometry.
  const KING_BOW_ARC = Math.PI * 1.1;
  const KING_BOW_CHORD_Z = 0.16 * Math.cos(KING_BOW_ARC / 2);
  const kingBowGeo = new THREE.TorusGeometry(0.16, 0.018, 3, 8, KING_BOW_ARC);
  kingBowGeo.rotateZ(-KING_BOW_ARC / 2);
  kingBowGeo.rotateY(-Math.PI / 2);
  const bow = new THREE.Mesh(kingBowGeo, mat(0x5c4a30));
  bow.position.set(-0.01, -0.19, 0.05); bow.rotation.z = 0.35;
  addOutlined(bow, 16, shoulders[1]);

  // A three-point string is enough to show tension at this scale. The centre
  // point pulls toward the bow hand during the draw, then returns on release;
  // unlike a scaled box it keeps both limbs anchored to the bow tips.
  const stringGeometry = new THREE.BufferGeometry();
  const stringPositions = new Float32Array([
    0, -0.15, KING_BOW_CHORD_Z,
    0, 0, KING_BOW_CHORD_Z,
    0, 0.15, KING_BOW_CHORD_Z
  ]);
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(stringPositions, 3));
  const bowString = new THREE.Line(stringGeometry, new THREE.LineBasicMaterial({ color: 0xd8c7a3 }));
  bowString.position.set(0, 0, 0);
  bow.add(bowString);
  const setBowDraw = draw => {
    stringPositions[5] = KING_BOW_CHORD_Z - 0.085 * Math.max(0, Math.min(1, draw));
    stringGeometry.attributes.position.needsUpdate = true;
  };
  setBowDraw(0);

  root.scale.setScalar(0.54 * 1.15);
  return { root, joints: { bob, torso, hips, shoulders }, bow, setBowDraw };
}
