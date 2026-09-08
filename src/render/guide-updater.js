// Hero TD -- level-one tutorial guide updater.
//
// Extracted from main.js render callback. Decides where the guide marker
// should point during onboarding: stairs (castle phase), recommended archer
// tile (first build), or incoming shoreline (wave preview).
//
// Pure logic: reads world/hud/board state and drives the guide view + label.

import { config } from '../config.js';
import { PHASE } from '../sim/world.js';

// The stairs the player actually climbs: the ramp whose FOOT is nearest the
// beach they come ashore on. Two hints key off this -- the opening marker up
// the steps, and where the first tower is suggested -- and they have to agree
// about which flight the tutorial means, so they read it from one place.
//
// The landing comes from the level rather than a constant. It was written here
// as 3, 7 twice over, which is right for level one and silently wrong for any
// level that ever wants this.
function landingRamp(board) {
  const landing = (board.level.intro && board.level.intro.land) || [3, 7];
  let best = null, bestD = Infinity;
  for (const [[li, lj], [hi, hj]] of board.level.ramps) {
    const d = Math.hypot(li - landing[0], lj - landing[1]);
    if (d < bestD) { bestD = d; best = { foot: [li, lj], head: [hi, hj] }; }
  }
  return best;
}

export function updateGuide({ levelId, world, hud, board, guide, guideLabel, view }) {
  // Find the best 2×2 flat site on tier 2 for the castle suggestion.
  // Walks the board once when needed and caches the result per level.
  let suggestSite = null;
  if (levelId === 'one' && world.phase === PHASE.CASTLE && world.hero.tier >= 2
      && hud.castleArming) {
    // Prefer the site closest to the player's current position.
    const hx = world.hero.x, hz = world.hero.z;
    let best = null, bestD = Infinity;
    for (let j = 0; j + 1 < board.N; j++) {
      for (let i = 0; i + 1 < board.N; i++) {
        const h = board.at(i, j);
        if (h < 2 || board.at(i+1,j) !== h || board.at(i,j+1) !== h || board.at(i+1,j+1) !== h) continue;
        if (world.structures.canPlaceCastleReason(i, j) !== null) continue;
        const cx = i + 0.5, cz = j + 0.5;
        const d = (cx - hx) * (cx - hx) + (cz - hz) * (cz - hz);
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
    }
    suggestSite = best;
  }

  if (levelId === 'one' && world.phase === PHASE.CASTLE && world.hero.tier < 2) {
    const ramp = landingRamp(board);
    if (ramp) {
      const [hi, hj] = ramp.head;
      const [li, lj] = ramp.foot;
      const nbs = [[hi-1,hj],[hi+1,hj],[hi,hj-1],[hi,hj+1]];
      const t = nbs.find(([ni,nj]) => board.at(ni,nj) >= 2 && (ni!==li || nj!==lj));
      if (t) guide.show(t[0] - 1, t[1]);
    }
    guide.hideSuggestion();
    guide.hideBuildSite();
  } else if (hud.dummyTutorial) {
    // He is on the plateau and the practice targets are still up. Nothing else
    // is on screen during this beat, so point at the nearest live dummy rather
    // than leaving the player on an empty island wondering what is expected.
    let best = null, bestD = Infinity;
    for (const s of world.structures.list) {
      if (!s.alive || s.kind !== 'trainingDummy') continue;
      const d = (s.x - world.hero.x) ** 2 + (s.z - world.hero.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) guide.show(best.i, best.j); else guide.hide();
    guide.hideSuggestion();
    guide.hideBuildSite();
  } else if (suggestSite) {
    guide.hide();
    guide.showSuggestion(suggestSite[0], suggestSite[1]);
    guide.hideBuildSite();
  } else if (hud.incomingTutorial) {
    const first = world.wavePreview && world.wavePreview[0];
    if (first && first.land) guide.show(first.land[0], first.land[1]);
    guide.hideSuggestion();
    guide.hideBuildSite();
  } else if (hud.defenseTutorial && !hud.arming) {
    const keep = world.structures.theCastle();
    const ramp = landingRamp(board);
    if (keep && keep.alive && ramp) {
      // The search walks out from the TOP OF THE STAIRS, not from the keep.
      // That is the corner of the map the opening has already taught: the
      // player lands on the beach below it, climbs it, and sites the castle
      // beside it. A tower there is the one they can see the point of.
      const [hi, hj] = ramp.head;
      let best = null, bestScore = Infinity;
      for (let dj = -3; dj <= 3; dj++) {
        for (let di = -3; di <= 3; di++) {
          const ci = hi + di, cj = hj + dj;
          // The plateau only. The stairs are the line between the beach and the
          // ground worth holding, and a first tower suggested at the bottom of
          // them teaches the wrong half of the island. board.at is bounds-safe
          // and returns 0 off the map, so this rejects the sea for free.
          if (board.at(ci, cj) < 2) continue;
          if (!world.structures.canPlace(ci, cj)) continue;
          // Beside the stairs FIRST, near the keep second -- weighted rather
          // than decided by either alone, which is what lands it in the corner
          // where both are true instead of hugging one and ignoring the other.
          // Distances are from the keep's CENTRE: keep.x and keep.z are the
          // 2x2's middle, and its origin corner is off by half a tile in both
          // axes.
          const sx = ci - hi, sz = cj - hj;
          const kx = ci - keep.x, kz = cj - keep.z;
          const score = 4 * (sx * sx + sz * sz) + (kx * kx + kz * kz);
          if (score < bestScore) { bestScore = score; best = [ci, cj]; }
        }
      }
      // A 1x1 placement square, NOT the ring and pointer. That pair means GO
      // HERE everywhere else in the game, and a marker that means two things
      // teaches neither -- so the build hint speaks the placement language the
      // castle suggestion already established, just one tile wide.
      if (best) guide.showBuildSite(best[0], best[1]); else guide.hideBuildSite();
    } else {
      guide.hideBuildSite();
    }
    // The ring is never the build hint, so it is put away here rather than left
    // showing whatever the previous frame pointed at.
    guide.hide();
    guide.hideSuggestion();
  } else {
    guide.hide();
    guide.hideSuggestion();
    guide.hideBuildSite();
  }
  guide.setPulse(hud.incomingTutorial);
  guide.sync(0);  // elapsed is passed by the caller's sync
}

export function updateGuideLabel({ hud, guide, board, view, guideLabel }) {
  const guideTarget = guide.target;
  // The dummy beat is the one place the marker stands alone. A word over a
  // practice target reads as a label for the target rather than as an
  // instruction, and the ring already says where to go -- so the marker points
  // and nothing speaks.
  if (guideTarget && !hud.incomingTutorial && !hud.dummyTutorial) {
    const guidePoint = view.screenPositionOf(
      guideTarget.i,
      guideTarget.j,
      board.topY(guideTarget.i, guideTarget.j) - config.board.SINK + 0.72
    );
    guideLabel.textContent = hud.defenseTutorial ? 'BUILD ARCHER TOWER' : 'CLICK HERE';
    guideLabel.style.display = 'block';
    guideLabel.style.left = `${guidePoint.x.toFixed(1)}px`;
    guideLabel.style.top = `${guidePoint.y.toFixed(1)}px`;
  } else {
    guideLabel.style.display = 'none';
  }
}
