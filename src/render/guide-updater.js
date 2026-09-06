// Hero TD -- level-one tutorial guide updater.
//
// Extracted from main.js render callback. Decides where the guide marker
// should point during onboarding: stairs (castle phase), recommended archer
// tile (first build), or incoming shoreline (wave preview).
//
// Pure logic: reads world/hud/board state and drives the guide view + label.

import { config } from '../config.js';
import { PHASE } from '../sim/world.js';

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
    // Landing tile from the level data.
    const landI = 3, landJ = 7;
    let best = null, bestD = Infinity;
    for (const [[li, lj], [hi, hj]] of board.level.ramps) {
      const d = Math.hypot(li - landI, lj - landJ);
      if (d < bestD) { bestD = d; best = [[li, lj], [hi, hj]]; }
    }
    if (best) {
      const [, [hi, hj]] = best;
      const [li, lj] = best[0];
      const nbs = [[hi-1,hj],[hi+1,hj],[hi,hj-1],[hi,hj+1]];
      const t = nbs.find(([ni,nj]) => board.at(ni,nj) >= 2 && (ni!==li || nj!==lj));
      if (t) guide.show(t[0] - 1, t[1]);
    }
    guide.hideSuggestion();
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
  } else if (suggestSite) {
    guide.hide();
    guide.showSuggestion(suggestSite[0], suggestSite[1]);
  } else if (hud.incomingTutorial) {
    const first = world.wavePreview && world.wavePreview[0];
    if (first && first.land) guide.show(first.land[0], first.land[1]);
    guide.hideSuggestion();
  } else if (hud.defenseTutorial && !hud.arming) {
    const keep = world.structures.theCastle();
    if (keep && keep.alive) {
      const cx = keep.x, cz = keep.z;
      let best = null, bestD = Infinity;
      for (let dj = -3; dj <= 3; dj++) {
        for (let di = -3; di <= 3; di++) {
          if (!di && !dj) continue;
          const ci = cx + di, cj = cz + dj;
          if (!world.structures.canPlace(ci, cj)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) { bestD = d; best = [ci, cj]; }
        }
      }
      if (best) guide.show(best[0], best[1]);
    }
    guide.hideSuggestion();
  } else {
    guide.hide();
    guide.hideSuggestion();
  }
  guide.setPulse(hud.incomingTutorial);
  guide.sync(0);  // elapsed is passed by the caller's sync
}

export function updateGuideLabel({ hud, guide, board, view, guideLabel }) {
  const guideTarget = guide.target;
  if (guideTarget && !hud.incomingTutorial) {
    const guidePoint = view.screenPositionOf(
      guideTarget.i,
      guideTarget.j,
      board.topY(guideTarget.i, guideTarget.j) - config.board.SINK + 0.72
    );
    guideLabel.textContent = hud.dummyTutorial ? 'ATTACK'
                           : hud.defenseTutorial ? 'BUILD DEFENSE' : 'CLICK HERE';
    guideLabel.style.display = 'block';
    guideLabel.style.left = `${guidePoint.x.toFixed(1)}px`;
    guideLabel.style.top = `${guidePoint.y.toFixed(1)}px`;
  } else {
    guideLabel.style.display = 'none';
  }
}
