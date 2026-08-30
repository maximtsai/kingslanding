// Hero TD -- animatable figure rigs.
//
// The diorama's soldier was a flat bag of meshes hung off one group, which is
// all a still pose needs. TDD section 15 requires limbs to rotate about their
// joints, and `bevelBox` builds upward from its own base -- so rotating a leg
// mesh directly spins it about its foot, and an arm about its hand. Both read as
// a broken puppet.
//
// The fix is structural: each limb hangs inside a pivot Group placed at the
// shoulder or hip, offset downward by its own length. The animator only ever
// touches the pivots.
//
//   root  -- world placement: position and facing
//    +- bob     -- vertical bounce and side-to-side roll
//        |- hip[2]      -- leg pivots
//        +- torso       -- counter-yaw and idle breathing
//            |- body, head, helmet
//            +- shoulder[2]  -- arm pivots; the right one carries the weapon
//
// Three silhouettes, and they have to be told apart instantly at maximum zoom
// out against yellow-green grass, in near-black (TDD 15 gives the environment
// cool and green and gameplay warm and dark, so enemies cannot use colour to
// separate themselves). That leaves shape and size to do all the work:
//
//   GRUNT   the baseline. One broad sword held high.
//   ARCHER  slighter, stooped, bow held across the body -- reads as "not melee".
//   BRUTE   half again as tall and much wider, no helmet, a heavy club.

const UNIT_SIZE_MULTIPLIER = 1.15;

const TYPES = {
  grunt: {
    scale: 0.45 * UNIT_SIZE_MULTIPLIER,
    body: [0.16, 0.10, 0.25], bodyY: 0.20,
    head: 0.13, headY: 0.45,
    helmet: [0.145, 0.135, 0.055], helmetY: 0.555,
    leg: [0.052, 0.07, 0.16], hipX: 0.05, hipY: 0.16,
    arm: [0.048, 0.06, 0.19], shoulderX: 0.11, shoulderY: 0.42,
    armCant: 0.18,
    weapon: 'sword'
  },
  archer: {
    scale: 0.43 * UNIT_SIZE_MULTIPLIER,
    body: [0.14, 0.095, 0.24], bodyY: 0.19,
    head: 0.125, headY: 0.43,
    helmet: [0.132, 0.126, 0.04], helmetY: 0.525,
    leg: [0.048, 0.065, 0.155], hipX: 0.047, hipY: 0.155,
    arm: [0.044, 0.055, 0.185], shoulderX: 0.10, shoulderY: 0.40,
    armCant: 0.10,              // arms tucked in: he is holding a bow, not a spear
    weapon: 'bow'
  },
  brute: {
    scale: 0.62 * UNIT_SIZE_MULTIPLIER,
    body: [0.24, 0.16, 0.30], bodyY: 0.22,
    head: 0.15, headY: 0.50,
    helmet: null,               // bare head: the silhouette is the read, not the kit
    leg: [0.075, 0.095, 0.20], hipX: 0.072, hipY: 0.20,
    arm: [0.070, 0.085, 0.235], shoulderX: 0.155, shoulderY: 0.48,
    armCant: 0.26,              // arms hang wide off a heavy frame
    weapon: 'club'
  }
};

export function createRigFactory(THREE, kit, P) {
  const { mat, bevelBox } = kit;

  // Geometry shared across every figure of a type. Built once.
  const swordShape = new THREE.Shape();
  swordShape.moveTo(-0.038, -0.22);
  swordShape.lineTo(-0.055, 0.11);
  swordShape.lineTo(0, 0.245);
  swordShape.lineTo(0.055, 0.11);
  swordShape.lineTo(0.038, -0.22);
  swordShape.closePath();
  const swordBladeGeo = new THREE.ExtrudeGeometry(swordShape, {
    depth: 0.018, bevelEnabled: false
  });
  swordBladeGeo.translate(0, 0, -0.012);
  const swordGripGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5);
  const swordGuardGeo = new THREE.BoxGeometry(0.17, 0.035, 0.04);
  const swordPommelGeo = new THREE.OctahedronGeometry(0.035, 0);
  // Deliberately oversized. Measured at maximum zoom-in, a grunt stands 10.4
  // screen pixels tall and an archer 9.9 -- half a pixel apart, which is to say
  // identical. Size cannot separate them and colour is spoken for (TDD 15 gives
  // enemies near-black), so the read has to come from shape: a tall upright bow
  // that breaks the head line and is visible as a bar beside the body.
  const bowGeo = new THREE.TorusGeometry(0.165, 0.016, 3, 9, Math.PI * 1.25);
  const clubShaftGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.42, 5);
  const clubHeadGeo = new THREE.BoxGeometry(0.115, 0.13, 0.115);
  const woodMat = mat(0xc7b58a);
  const darkWoodMat = mat(0x6f5a3c);
  const ironMat = mat(0xd9e1e6);

  function build(type) {
    const T = TYPES[type] || TYPES.grunt;

    const root = new THREE.Group();
    root.scale.setScalar(T.scale);

    const bob = new THREE.Group();
    root.add(bob);
    const torso = new THREE.Group();
    bob.add(torso);

    const body = bevelBox(T.body[0], T.body[1], T.body[2], 0, P.enemy);
    body.position.y = T.bodyY; torso.add(body);
    const head = bevelBox(T.head, T.head - 0.01, T.head, 0, 0xdac7a5);
    head.position.y = T.headY; torso.add(head);
    if (T.helmet) {
      const helmet = bevelBox(T.helmet[0], T.helmet[1], T.helmet[2], 0, 0x59616a);
      helmet.position.y = T.helmetY; torso.add(helmet);
    }

    const hips = [], shoulders = [];
    [-1, 1].forEach((side, k) => {
      const hip = new THREE.Group();
      hip.position.set(side * T.hipX, T.hipY, 0);
      const leg = bevelBox(T.leg[0], T.leg[1], T.leg[2], 0, 0x24242a);
      leg.position.y = -T.leg[2];
      hip.add(leg); bob.add(hip); hips[k] = hip;

      // The arm keeps its outward cant on the mesh rather than on the pivot, so
      // the swing composes with the splay instead of replacing it.
      const shoulder = new THREE.Group();
      shoulder.position.set(side * T.shoulderX, T.shoulderY, 0);
      const arm = bevelBox(T.arm[0], T.arm[1], T.arm[2], 0, P.enemy);
      arm.position.y = -T.arm[2];
      arm.rotation.z = side * T.armCant;
      shoulder.add(arm); torso.add(shoulder); shoulders[k] = shoulder;
    });

    // The weapon rides the right shoulder, so it swings with the arm holding it.
    // The animator damps that arm (config.anim.SPEAR_DAMP) or it windmills.
    const right = shoulders[1];
    if (T.weapon === 'sword') {
      const sword = new THREE.Group();
      sword.position.set(0.025, -0.04, 0.015);
      sword.rotation.z = -0.28;
      const blade = new THREE.Mesh(swordBladeGeo, ironMat);
      sword.add(blade);
      const guard = new THREE.Mesh(swordGuardGeo, woodMat);
      guard.position.y = -0.235;
      sword.add(guard);
      const grip = new THREE.Mesh(swordGripGeo, darkWoodMat);
      grip.position.y = -0.32;
      sword.add(grip);
      const pommel = new THREE.Mesh(swordPommelGeo, ironMat);
      pommel.position.y = -0.405;
      sword.add(pommel);
      right.add(sword);
    } else if (T.weapon === 'bow') {
      // Stood on end alongside the body, reaching above the head. From directly
      // above a horizontal bow is a hoop and reads as nothing at all; upright,
      // it is a vertical stroke the eye separates from a spear instantly.
      const bow = new THREE.Mesh(bowGeo, darkWoodMat);
      bow.position.set(0.03, 0.01, 0.05);
      bow.rotation.set(0, Math.PI / 2, 0.12);
      right.add(bow);
      // Bowstring: one thin box closing the arc, which is what stops it reading
      // as a random curve.
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.30, 0.008), woodMat);
      string.position.set(0.03, 0.01, -0.10);
      right.add(string);
    } else if (T.weapon === 'club') {
      const shaft = new THREE.Mesh(clubShaftGeo, darkWoodMat);
      shaft.position.set(0.02, -0.16, 0.02); shaft.rotation.z = -0.3;
      right.add(shaft);
      const head2 = new THREE.Mesh(clubHeadGeo, ironMat);
      head2.position.set(0.10, -0.02, 0.02); head2.rotation.z = -0.3;
      right.add(head2);
    }

    return { root, joints: { bob, torso, hips, shoulders }, type };
  }

  return {
    build,
    // Convenience constructor for callers that want the baseline figure.
    soldier: () => build('grunt'),
    scaleOf: type => (TYPES[type] || TYPES.grunt).scale
  };
}
