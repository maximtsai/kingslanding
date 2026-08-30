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
//   GRUNT   stocky, slightly stooped, pauldrons, round shield, short sword.
//   ARCHER  slighter, stooped, bow held across the body -- reads as "not melee".
//   BRUTE   half again as tall and much wider, no helmet, a heavy club.
//
// All three share a long body over short, bent, splayed legs. The proportion is
// deliberate and it is not human: legs are stumps, torsos are tall, and the
// stance is braced. It reads as a crowd of thugs from above, where the legs are
// mostly hidden by the body anyway and the torso is doing all of the work.
//
// THE GRUNT IS BULK WITHOUT HEIGHT, and that is the whole trick of it. It has to
// separate from the archer (which it barely did -- 10.4 screen pixels against
// 9.9 at maximum zoom, half a pixel apart) WITHOUT drifting toward the brute,
// whose entire read is being the big one. So the grunt got wider and deeper and
// lost a little height doing it: stocky rather than large. Size order is
// preserved, aspect ratio is not.
//
// Four changes, in descending order of how far away they still work:
//
//   1. WIDE SHOULDERS. Pauldrons on the torso, not on the arm pivots, so they
//      are armour rather than something that windmills when it walks. The game
//      is played from a high angle, so shoulder span is most of the silhouette.
//   2. A ROUND SHIELD with a bright iron boss. Enemies are near-black (TDD 15),
//      which makes an unbroken dark blob the default failure. Weapons already
//      break that rule usefully -- the sword blade and the brute's club head are
//      both bright -- and a light disc off one side is legible at a size where
//      no amount of body shaping is. It is also the melee read: shield means
//      "walks at you", against the archer's upright bow.
//   3. A SLIGHT STOOP. Its own group between bob and torso, because every
//      animator path -- gait, hit reaction, death, disembark -- writes
//      torso.rotation ABSOLUTELY and would erase a pitch stored there. Kept
//      small: enough to lean into the walk, not enough to read as a crouch.
//   4. NO NECK. The head sinks between the pauldrons, which is most of what
//      separates a heavy man from a merely wide one.

// One dial for the size of every enemy, applied to the rig only -- the
// simulation's push and hit radii are authored separately in config and are NOT
// scaled by this. Raising it therefore changes how big raiders look without
// changing how they crowd, path or fight.
//
// WATCH THIS ONE. A grunt's visual shoulder half-width is 0.110 tiles while its
// push radius is 0.08, so two grunts pressed to the separation minimum sit 0.16
// apart with 0.220 of shoulder between them: they interpenetrate by 0.060 of a
// tile. Across the size bumps that has gone 0.016 -> 0.034 -> 0.072 -> 0.060
// (the last step being half the widening handed back), and it trends one way.
//
// At this figure it still passes as a shoulder-to-shoulder horde. It is the
// next increase that wants `config.unit.pushRadius` raised alongside it -- and
// that is a gameplay change, not an art one, since push radius sets how densely
// a wave packs into a chokepoint.
const UNIT_SIZE_MULTIPLIER = 1.3915;

// ---- the legs ----
//
// Two segments and a knee, on every type. The knee carries a fixed bend and the
// thigh a fixed outward splay, which together give the braced, slightly crouched
// stance of men who expect to be hit.
//
// Both live on their OWN groups rather than on the hip, because applyGait and
// applyDeathPose assign `hips[k].rotation` absolutely and would erase a stance
// stored there -- the same trap the torso stoop had to be lifted out of.
//
// The thigh is NOT tilted forward to compensate for the bend. It would cost a
// third group, and it would fight the gait: LEG_SWING is 0.50 rad peak, so a
// base tilt of any useful size makes the walk permanently lead with one
// direction. Bending at the knee alone leaves the foot about 0.017 behind the
// hip, which is under a centimetre at world scale and invisible.
// ARMS ARE OFF, by request. The shoulder pivots and the weapon they carry stay
// exactly where they were -- only the limb meshes are skipped -- so a weapon
// still swings on the walk cycle and still damps on the sword arm. Flip this
// back to true and the arms return with their original cant and proportions;
// `arm` and `armCant` are kept in every type below for exactly that reason
// rather than deleted as dead data.
//
// It also happens to be the cheapest thing in this file: two InstancedMeshes per
// type, six overall.
const SHOW_ARMS = false;

const KNEE_BEND = 0.30;         // radians, shin swept back from the thigh
const LEG_SPLAY = 0.10;         // radians, thigh cast outward from the hip
const LIMB_DARK = 0x2e2124;     // warm near-black, matched in luminance to the old cool one

// hipY for each type below is `thigh + shin * cos(KNEE_BEND)`, times
// `cos(LEG_SPLAY)`: the height a bent, splayed leg actually reaches, so the feet
// land on the ground rather than in it or above it. Change either angle and
// every hipY has to be recomputed.
const TYPES = {
  grunt: {
    scale: 0.45 * UNIT_SIZE_MULTIPLIER,
    // Wide and long-bodied over short legs. The torso does the bulk and the legs
    // are stumps under it, which is what reads as heavy rather than merely big.
    body: [0.227, 0.152, 0.247], bodyY: 0.162,
    // A SMALL HEAD UNDER A WIDE HELMET. The head box is untextured skin tone on
    // every face, so at any size it is a pale block from every angle -- the
    // brightest thing on a figure that is supposed to be dark. Shrinking it and
    // dropping an OVERHANGING helmet over it leaves a thin band of face and,
    // from the high camera the game is played at, turns the top of the
    // silhouette into a dark plate rather than a light cube.
    // Bigger than it was. 0.105 was sized for a small box tucked under a WIDE
    // overhanging box helmet, and that overhang is gone -- the dome is only
    // 1.12x the head now, so the old value left a pin head on a very wide body.
    head: 0.122, headY: 0.390,
    thigh: [0.070, 0.083, 0.062], shin: [0.062, 0.076, 0.057],
    // Purely cosmetic: both leg meshes are drawn this much longer than the
    // segment they represent, growing TOWARD each other across the knee. The
    // hip, the knee and the foot do not move, so the gait, the foot contact and
    // every hipY calculation are untouched -- the legs simply overlap at the
    // joint instead of butting exactly, which fills the wedge of daylight that
    // a bent knee opens on its outside edge.
    legOverlap: 0.011,
    hipX: 0.085, hipY: 0.116,
    arm: [0.055, 0.066, 0.185], shoulderX: 0.128, shoulderY: 0.384,
    armCant: 0.20,
    // Radians of forward pitch. 17 degrees read as a crouch rather than a
    // posture; 3.4 is a stoop you notice without the figure looking folded.
    // The sword counter-rotates by whatever this is (see below), so the two
    // cannot drift apart.
    hunch: 0.06,
    pauldron: [0.095, 0.128, 0.066], // [width, depth, height], one per shoulder
    // No shield. It was carried for its iron boss -- "one bright speck on an
    // otherwise near-black figure" -- and the silver helm took that job away
    // from it, so it was paying two draw calls for a mark that no longer marked
    // anything. The build path below is intact: give this a radius again and the
    // shield and its boss come straight back.
    shield: 0,
    weapon: 'sword'
  },
  archer: {
    scale: 0.43 * UNIT_SIZE_MULTIPLIER,
    body: [0.149, 0.098, 0.276], bodyY: 0.165,
    head: 0.125, headY: 0.422,
    thigh: [0.049, 0.064, 0.069], shin: [0.044, 0.058, 0.063],
    hipX: 0.059, hipY: 0.129,
    arm: [0.044, 0.054, 0.185], shoulderX: 0.102, shoulderY: 0.411,
    armCant: 0.10,              // arms tucked in: he is holding a bow, not a spear
    weapon: 'bow'
  },
  brute: {
    scale: 0.62 * UNIT_SIZE_MULTIPLIER,
    body: [0.255, 0.162, 0.345], bodyY: 0.187,
    head: 0.15, headY: 0.510,
    thigh: [0.078, 0.095, 0.089], shin: [0.069, 0.085, 0.081],
    hipX: 0.090, hipY: 0.166,
    arm: [0.066, 0.081, 0.235], shoulderX: 0.158, shoulderY: 0.492,
    armCant: 0.26,              // arms hang wide off a heavy frame
    weapon: 'club'
  }
};

// PLACEHOLDER, by request: a knight is drawn as a grunt until it is given a
// silhouette of its own. `build` and `scaleOf` already fall back to the grunt
// for any type they do not recognise, so this alias changes no behaviour today
// -- it exists to say the sameness is deliberate, and to be the one line that
// gets replaced when the knight becomes its own thing.
//
// When that happens, note that units.js caches a kit per TYPE STRING, so a
// knight sharing the grunt's geometry still builds its own InstancedMeshes:
// identical draw calls, twice over. Worth normalising the key if a knight ships
// before it earns a distinct model.
TYPES.knight = TYPES.grunt;

export function createRigFactory(THREE, kit, P) {
  const { mat, bevelBox } = kit;

  // Geometry shared across every figure of a type. Built once.
  const swordShape = new THREE.Shape();
  swordShape.moveTo(-0.032, -0.22);
  swordShape.lineTo(-0.046, 0.11);
  swordShape.lineTo(0, 0.245);
  swordShape.lineTo(0.046, 0.11);
  swordShape.lineTo(0.032, -0.22);
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
  // ---- head and helm -------------------------------------------------------
  //
  // A BLACK BALL UNDER A SILVER SPECTACLE HELM, after the Gjermundbu type: a
  // domed skullcap with an ocular guard hung below its rim -- two eye openings
  // and a nasal between them.
  //
  // The face is a sphere and it is pure black, so it takes no light at all and
  // stays a void from every angle. That is the point: the only thing the eye
  // catches up there is the silver, and the holes read as holes because what is
  // behind them is genuinely nothing rather than a dark grey that lightens as
  // the unit turns.
  //
  // Built at a nominal head diameter of 1.0 and scaled per type by `head`, so
  // the three enemies share one set of geometry and one set of proportions.
  //
  // Non-indexed with recomputed normals, because MeshLambertMaterial shades
  // per-vertex and ignores flatShading (see kit.js) -- a shared-vertex sphere
  // comes out smooth and reads as plastic against everything else on screen.
  const headGeo = new THREE.SphereGeometry(0.5, 10, 7).toNonIndexed();
  headGeo.computeVertexNormals();

  // Dome radius 0.56 against a head radius of 0.5, so it sits over the skull
  // rather than in it. thetaLength 1.36 rad brings the rim down to y = +0.117,
  // just above the eye line -- low enough to be a helmet, high enough that it
  // does not swallow the ocular guard hanging below it.
  const domeGeo = new THREE.SphereGeometry(0.56, 10, 6, 0, Math.PI * 2, 0, 1.36).toNonIndexed();
  domeGeo.computeVertexNormals();

  // The ocular guard, as a genuine plate with genuine holes: an extruded Shape
  // with two circular holes punched through it, so the black sphere is visible
  // THROUGH the helm rather than merely beside it.
  //
  // Kept narrow on purpose -- +/-0.32 against a head radius of 0.5. The plate is
  // flat and the head is not, so the wider it gets the further its corners float
  // off the curve; at this width the worst gap is 0.076 of a head diameter,
  // which is under half a pixel at the size these are played at.
  const ocularGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.32, 0.15);
    s.lineTo(0.32, 0.15);
    s.lineTo(0.32, -0.06);
    s.lineTo(0.06, -0.06);
    s.lineTo(0.05, -0.26);      // the nasal, hanging between the eyes
    s.lineTo(-0.05, -0.26);
    s.lineTo(-0.06, -0.06);
    s.lineTo(-0.32, -0.06);
    s.closePath();
    for (const side of [-1, 1]) {
      const eye = new THREE.Path();
      eye.absarc(side * 0.175, 0.045, 0.085, 0, Math.PI * 2, false);
      s.holes.push(eye);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.055, bevelEnabled: false });
    g.translate(0, 0, -0.0275);
    return g;
  })();

  // Light silver, and deliberately NOT the cool blue-grey a helmet wants to be.
  // Section 15 gives the environment cool and the gameplay warm, and the raiders
  // were just moved to a warm near-black; a cold helm on a warm body reads as
  // two different games. This is a hair warm of neutral, which is as far toward
  // "silver" as the hue rule allows.
  const helmMat = mat(0xd2cfc9);

  // Eight-sided, to sit in the same faceted language as everything else -- a
  // smooth disc would read as imported from a different game. Laid flat in the
  // XY plane so it faces along local +z, which is the way the figure faces.
  const shieldGeo = new THREE.CylinderGeometry(1, 1, 0.055, 8);
  shieldGeo.rotateX(Math.PI / 2);
  // Big for a boss -- over half the shield's radius. At the size these are
  // actually played at, twenty-odd pixels tall, an accurate boss is one pixel
  // and therefore nothing. This is not jewellery, it is the grunt's one bright
  // mark, and it has to survive the zoom the game is played at rather than the
  // zoom it is modelled at.
  const shieldBossGeo = new THREE.CylinderGeometry(0.58, 0.44, 0.085, 6);
  shieldBossGeo.rotateX(Math.PI / 2);
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

    // The hunch lives in its OWN group between bob and torso. It cannot live on
    // the torso: applyGait, applyDeathPose and applyDisembarkPose all assign
    // torso.rotation.x absolutely, so a pitch stored there would be erased on
    // the first animated frame -- and only on the first, which is the kind of
    // bug that looks like a rendering glitch rather than a structural mistake.
    const stoop = new THREE.Group();
    stoop.rotation.x = T.hunch || 0;
    bob.add(stoop);

    const torso = new THREE.Group();
    stoop.add(torso);

    const body = bevelBox(T.body[0], T.body[1], T.body[2], 0, P.enemy);
    body.position.y = T.bodyY; torso.add(body);
    // `headY` is the BASE of the head, as it was when this was a box; the sphere
    // is centred half a diameter above it.
    //
    // Every headY was lowered slightly when the box became a ball. A box sitting
    // flush on the body top is a clean butt joint; a SPHERE touching a flat top
    // meets it at a single tangent point and leaves a notch of daylight all the
    // way round the neck. Each head is now sunk about 0.15 of its diameter into
    // the shoulders, which closes it.
    const headCentre = T.headY + T.head * 0.5;

    const head = new THREE.Mesh(headGeo, mat(0x000000));
    head.scale.setScalar(T.head);
    head.position.y = headCentre;
    torso.add(head);

    // Every enemy is helmed now. The brute used to go bare-headed as its own
    // silhouette cue; it is still half again the size of the others, which was
    // always the stronger half of that read.
    const dome = new THREE.Mesh(domeGeo, helmMat);
    dome.scale.setScalar(T.head);
    dome.position.y = headCentre;
    torso.add(dome);

    const ocular = new THREE.Mesh(ocularGeo, helmMat);
    ocular.scale.setScalar(T.head);
    // z = 0.48 of a head diameter puts the plate on the sphere's front at the
    // nose and a whisker proud of it at the outer corners. The slight pitch
    // tucks the nasal back toward the chin, which otherwise stands off the face
    // by a fifth of a head.
    ocular.position.set(0, headCentre, T.head * 0.48);
    ocular.rotation.x = 0.15;
    torso.add(ocular);

    // Pauldrons hang off the TORSO rather than the shoulder pivots, so they read
    // as plate strapped to the body instead of swinging with every stride. They
    // are also the single biggest thing this figure does for legibility: seen
    // from the game's high angle, shoulder span is most of what a silhouette is.
    if (T.pauldron) {
      [-1, 1].forEach(side => {
        const pad = bevelBox(T.pauldron[0], T.pauldron[1], T.pauldron[2], 0, 0x483c40);
        pad.position.set(side * T.shoulderX, T.shoulderY - T.pauldron[2] * 0.35, 0);
        pad.rotation.z = side * 0.22;
        torso.add(pad);
      });
    }

    // Round shield on the left. Also on the torso, and deliberately: a shield
    // carried in guard does not swing with the walk, and a steady shape is worth
    // more at distance than an accurate one. The left arm passes behind it.
    if (T.shield) {
      const shield = new THREE.Mesh(shieldGeo, mat(0x6b5236));
      shield.scale.set(T.shield, T.shield, 1);
      shield.position.set(-T.shoulderX - 0.05, T.shoulderY - 0.075, 0.045);
      // TILTED TOWARD THE SKY, not just outward, and that is the whole reason it
      // works. The game is watched from about forty degrees up while the camera
      // yaws freely, so a shield carried vertically is a disc only when its
      // owner happens to be side-on and a PLANK across the chest the rest of the
      // time. Pitching the face up means the disc is what the camera sees at
      // every yaw, which is the only version of this that survives the unit
      // turning a corner.
      shield.rotation.set(-0.72, -0.38, 0.12);
      torso.add(shield);

      // The boss is the point of the whole thing: one bright speck on an
      // otherwise near-black figure, which is what survives being four pixels
      // tall. Iron, matching the blade, so the grunt reads as one kit.
      const boss = new THREE.Mesh(shieldBossGeo, ironMat);
      boss.scale.set(T.shield, T.shield, 1);
      boss.position.copy(shield.position);
      boss.rotation.copy(shield.rotation);
      boss.translateZ(0.035);
      torso.add(boss);
    }

    const hips = [], knees = [], shoulders = [];
    [-1, 1].forEach((side, k) => {
      const hip = new THREE.Group();
      hip.position.set(side * T.hipX, T.hipY, 0);

      // hip -> thigh (splay) -> knee (bend) -> shin. The animator only ever
      // touches the hip, so the stance underneath it survives walking, being
      // hit, dying and jumping off a boat.
      const thigh = new THREE.Group();
      thigh.rotation.z = side * LEG_SPLAY;
      hip.add(thigh);

      // The meshes may be drawn longer than the segments they stand for. The
      // thigh keeps its top at the hip and reaches DOWN past the knee; the shin
      // keeps its base at the foot and reaches UP past the knee. Neither joint
      // moves, and in particular the foot does not, so nothing about the gait or
      // the ground contact changes.
      const grow = T.legOverlap || 0;

      const thighMesh = bevelBox(T.thigh[0], T.thigh[1], T.thigh[2] + grow, 0, LIMB_DARK);
      thighMesh.position.y = -(T.thigh[2] + grow);
      thigh.add(thighMesh);

      const knee = new THREE.Group();
      knee.position.y = -T.thigh[2];
      knee.rotation.x = KNEE_BEND;
      thigh.add(knee);
      knees[k] = knee;

      const shinMesh = bevelBox(T.shin[0], T.shin[1], T.shin[2] + grow, 0, LIMB_DARK);
      shinMesh.position.y = -T.shin[2];
      knee.add(shinMesh);

      bob.add(hip); hips[k] = hip;

      // The shoulder pivot exists whether or not anything hangs off it: the
      // animator swings it, and the weapon is parented to the right-hand one.
      const shoulder = new THREE.Group();
      shoulder.position.set(side * T.shoulderX, T.shoulderY, 0);
      if (SHOW_ARMS) {
        // The arm keeps its outward cant on the mesh rather than on the pivot,
        // so the swing composes with the splay instead of replacing it.
        const arm = bevelBox(T.arm[0], T.arm[1], T.arm[2], 0, P.enemy);
        arm.position.y = -T.arm[2];
        arm.rotation.z = side * T.armCant;
        shoulder.add(arm);
      }
      torso.add(shoulder); shoulders[k] = shoulder;
    });

    // The weapon rides the right shoulder, so it swings with the arm holding it.
    // The animator damps that arm (config.anim.SPEAR_DAMP) or it windmills.
    const right = shoulders[1];
    if (T.weapon === 'sword') {
      const sword = new THREE.Group();
      sword.position.set(0.025, -0.04, 0.015);
      // Counter-pitched against the hunch so the blade still stands UP. The
      // bright vertical stroke of a raised blade was the one part of the old
      // figure that read at distance, and leaning the torso forward without
      // this quietly laid it over and threw that away.
      sword.rotation.set(-(T.hunch || 0), 0, -0.28);
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

    // KNEE_BEND travels with the joints because the animator adds its flexion on
    // top of it and the death pose has to be able to put it back. A copied
    // constant in units.js would be a second source of truth for the stance.
    return { root, joints: { bob, torso, hips, knees, shoulders, kneeBase: KNEE_BEND }, type };
  }

  return {
    build,
    // Convenience constructor for callers that want the baseline figure.
    soldier: () => build('grunt'),
    scaleOf: type => (TYPES[type] || TYPES.grunt).scale
  };
}
