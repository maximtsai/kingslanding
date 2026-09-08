// Hero TD -- guide view.
//
// Two visual languages, deliberately kept apart:
//
//   * ring + floating triangle -- GO HERE. Reserved for movement, and for
//     nothing else. The moment it also means "build here" it stops meaning
//     anything precise.
//   * flat hollow square on the ground -- PUT A BUILDING HERE. The castle
//     suggestion is a 2x2 of these and the first-tower hint a single tile;
//     same marker, two sizes, so a player who has learned one has learned both.

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

  // ---- placement markers ----
  // A flat square laid on the ground: a faint white wash inside, a brighter
  // hollow border around it. It suggests a spot without blocking the player
  // from choosing elsewhere.
  //
  // BORDER is an ABSOLUTE width, not a fraction of the square. Line weight is
  // what makes two markers read as the same kind of thing, so the 1x1 gets a
  // proportionally heavier outline rather than a fainter one.
  const BORDER = 0.09;
  const CASTLE_SPAN = 2;      // the keep's footprint, in tiles
  const TOWER_SPAN = 1;       // a tower's

  function createSquareMarker(span) {
    const markerGroup = new THREE.Group();
    markerGroup.visible = false;
    markerGroup.rotation.x = -Math.PI / 2;
    markerGroup.renderOrder = 4;
    dynamicRoot.add(markerGroup);

    // Materials are per marker, not shared: sync() breathes their opacity, and
    // one clock driving both would tie the two markers together.
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.45,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(span, span), fillMat);
    fill.position.z = -0.005;
    markerGroup.add(fill);

    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    for (const [w, h, x, y] of [
      [span, BORDER, 0,  (span - BORDER) / 2],
      [span, BORDER, 0, -(span - BORDER) / 2],
      [BORDER, span,  (span - BORDER) / 2, 0],
      [BORDER, span, -(span - BORDER) / 2, 0]
    ]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), borderMat);
      bar.position.set(x, y, 0);
      markerGroup.add(bar);
    }
    return { group: markerGroup, fillMat, borderMat, span, time: 0, i: null, j: null };
  }

  // A footprint is anchored at its origin tile, so its CENTRE sits half a tile
  // further along for every tile of span past the first: a 2x2 is offset 0.5, a
  // 1x1 is offset none and sits exactly on the tile it names.
  // Positions a marker but does NOT reveal it. The build hint has to be put in
  // place while it is still waiting out its delay, so showing cannot be a side
  // effect of placing -- each caller says when its own marker is visible.
  function placeSquare(marker, ti, tj) {
    const offset = (marker.span - 1) / 2;
    marker.group.position.set(
      board.px(ti + offset),
      board.topY(ti, tj) - SINK + 0.05,
      board.px(tj + offset)
    );
    if (marker.i !== ti || marker.j !== tj) {
      marker.i = ti;
      marker.j = tj;
      marker.time = 0;
    }
  }

  function hideSquare(marker) {
    marker.group.visible = false;
    marker.i = null;
    marker.j = null;
  }

  function breatheSquare(marker, elapsed) {
    if (!marker.group.visible) return;
    marker.time += elapsed;
    marker.group.scale.setScalar(1 + 0.08 * Math.sin(marker.time * 3.5));
    marker.fillMat.opacity = 0.32 + 0.13 * Math.sin(marker.time * 2.8);
    marker.borderMat.opacity = 0.62 + 0.18 * Math.sin(marker.time * 4.1);
  }

  const castleSite = createSquareMarker(CASTLE_SPAN);
  const buildSite = createSquareMarker(TOWER_SPAN);

  let guideTime = 0;
  let pulseTime = 0;
  let pulsing = false;
  let entranceAge = 1.25;
  let shownI = null;
  let shownJ = null;
  let currentTarget = null;
  // The build-site square carries its own target rather than writing into
  // currentTarget. The two are hidden and shown by separate calls, and sharing
  // one field meant whichever ran last won -- which is how a label ends up
  // floating over nothing.
  let buildTarget = null;
  // The first-tower hint holds off for a beat. The build phase opens with the
  // castle landing, the build bar sliding in and the archer button starting to
  // pulse; a marker arriving in the middle of that is a fourth thing moving
  // while the player is still reading the first three. A second later it lands
  // on its own and is the only new thing on screen.
  const BUILD_SITE_DELAY = 1;
  let buildWanted = false;
  let buildDelay = 0;
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
      // ---- placement markers ----
      // The build hint serves its delay here rather than at the call site,
      // because this is the only thing holding a clock. The castle suggestion
      // has no delay and shows the moment it is asked for.
      if (buildWanted) {
        buildDelay = Math.min(BUILD_SITE_DELAY, buildDelay + elapsed);
        const ready = buildDelay >= BUILD_SITE_DELAY;
        buildSite.group.visible = ready;
        // The floating label reads `target`, so withholding it until the same
        // instant is what keeps the words and the square arriving together
        // instead of the caption turning up a second early over nothing.
        buildTarget = ready ? { i: buildSite.i, j: buildSite.j } : null;
      }
      breatheSquare(castleSite, elapsed);
      breatheSquare(buildSite, elapsed);
    },
    // ---- 2x2 castle placement suggestion (level one) ----
    showSuggestion(ti, tj) {
      placeSquare(castleSite, ti, tj);
      castleSite.group.visible = true;
    },
    hideSuggestion() {
      hideSquare(castleSite);
    },
    // ---- 1x1 first-tower suggestion (level one) ----
    showBuildSite(ti, tj) {
      // Says the hint is wanted and where. Whether it is actually on screen is
      // sync()'s call, once the delay has run.
      placeSquare(buildSite, ti, tj);
      buildWanted = true;
    },
    hideBuildSite() {
      hideSquare(buildSite);
      buildWanted = false;
      buildDelay = 0;
      buildTarget = null;
    },
    get target() {
      return currentTarget || buildTarget;
    }
  };
}
