// Hero TD -- guide view.
//
// Tutorial target marker: torus ring + floating triangle pointer with
// entrance bounce animation and optional pulsing.

import { config } from '../config.js';

export function createGuideView(THREE, board, dynamicRoot) {
  const SINK = config.board.SINK;
  const GUIDE_SCALE = 1.35;

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 4;
  dynamicRoot.add(group);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffff70, depthWrite: false, toneMapped: false
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.024, 5, 20),
    material
  );
  ring.rotation.x = Math.PI / 2;
  ring.scale.setScalar(GUIDE_SCALE);
  group.add(ring);

  const pointer = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.28, 3),
    material
  );
  pointer.rotation.x = Math.PI;
  pointer.position.y = 0.30;
  pointer.scale.setScalar(GUIDE_SCALE);
  group.add(pointer);

  // ---- 2x2 castle placement suggestion (level one) ----
  // A hollow square outline shown at the centre of the tier-2 area when the
  // player arms the castle button. It suggests a placement without blocking
  // the player from choosing elsewhere.
  const SUGGEST_SIZE = 2;     // 2×2 tiles
  const BORDER = 0.09;        // half-tile border width
  const suggestGroup = new THREE.Group();
  suggestGroup.visible = false;
  suggestGroup.rotation.x = -Math.PI / 2;
  suggestGroup.renderOrder = 4;
  dynamicRoot.add(suggestGroup);

  const suggestMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.45,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  });
  // Outer fill — faint white wash so the square reads at a glance.
  const suggestFill = new THREE.Mesh(
    new THREE.PlaneGeometry(SUGGEST_SIZE, SUGGEST_SIZE),
    suggestMat
  );
  suggestFill.position.z = -0.005;
  suggestGroup.add(suggestFill);
  // Hollow border — brighter, thinner ring that outlines the footprint.
  const suggestBorderMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.72,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  });
  const suggestBorder = new THREE.Group();
  for (const [w, h, x, y] of [
    [SUGGEST_SIZE, BORDER, 0,  (SUGGEST_SIZE - BORDER) / 2],
    [SUGGEST_SIZE, BORDER, 0, -(SUGGEST_SIZE - BORDER) / 2],
    [BORDER, SUGGEST_SIZE,  (SUGGEST_SIZE - BORDER) / 2, 0],
    [BORDER, SUGGEST_SIZE, -(SUGGEST_SIZE - BORDER) / 2, 0]
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), suggestBorderMat);
    m.position.set(x, y, 0);
    suggestGroup.add(m);
  }
  let suggestTime = 0;
  let shownSuggestI = null, shownSuggestJ = null;

  let guideTime = 0;
  let pulseTime = 0;
  let pulsing = false;
  let entranceAge = 1.25;
  let shownI = null;
  let shownJ = null;
  let currentTarget = null;
  const ENTRANCE = 1.25;

  return {
    show(targetI, targetJ) {
      const x = board.px(targetI);
      const z = board.px(targetJ);
      const y = board.topY(targetI, targetJ) - SINK + 0.02;
      const changed = !group.visible || shownI !== targetI || shownJ !== targetJ;
      group.position.set(x, y, z);
      group.visible = true;
      currentTarget = { i: targetI, j: targetJ };
      if (changed) {
        shownI = targetI;
        shownJ = targetJ;
        entranceAge = 0;
        guideTime = 0;
        group.scale.setScalar(0.04);
      }
    },
    hide() {
      group.visible = false;
      currentTarget = null;
    },
    setPulse(active) {
      pulsing = !!active;
      if (!pulsing) {
        pulseTime = 0;
        ring.scale.setScalar(GUIDE_SCALE);
        pointer.scale.setScalar(GUIDE_SCALE);
      }
    },
    sync(elapsed) {
      // ---- guide marker ----
      if (group.visible) {
        guideTime += elapsed;
        pulseTime += elapsed;
        entranceAge = Math.min(ENTRANCE, entranceAge + elapsed);
        const t = entranceAge / ENTRANCE;
        const bounce = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 4.5);
        group.scale.setScalar(Math.max(0.04, bounce));
        if (pulsing) {
          const pulse = 1 + (0.12 + 0.08 * Math.sin(pulseTime * 5.5)) *
            (0.5 + 0.5 * Math.sin(pulseTime * 4.2));
          ring.scale.setScalar(GUIDE_SCALE * pulse);
          pointer.scale.setScalar(GUIDE_SCALE * pulse);
        }
        pointer.position.y = 0.30 + Math.sin(guideTime * 3.2) * 0.07;
      }
      // ---- 2×2 castle suggestion highlight ----
      if (suggestGroup.visible) {
        suggestTime += elapsed;
        const pulse = 1 + 0.08 * Math.sin(suggestTime * 3.5);
        suggestGroup.scale.setScalar(pulse);
        suggestMat.opacity = 0.32 + 0.13 * Math.sin(suggestTime * 2.8);
        suggestBorderMat.opacity = 0.62 + 0.18 * Math.sin(suggestTime * 4.1);
      }
    },
    // ---- 2×2 castle suggestion highlight ----
    showSuggestion(ti, tj) {
      const cx = board.px(ti + 0.5);
      const cz = board.px(tj + 0.5);
      const y = board.topY(ti, tj) - SINK + 0.05;
      const changed = shownSuggestI !== ti || shownSuggestJ !== tj;
      suggestGroup.position.set(cx, y, cz);
      suggestGroup.visible = true;
      if (changed) {
        shownSuggestI = ti;
        shownSuggestJ = tj;
        suggestTime = 0;
      }
    },
    hideSuggestion() {
      suggestGroup.visible = false;
      shownSuggestI = null;
      shownSuggestJ = null;
    },
    get target() {
      return currentTarget;
    }
  };
}
