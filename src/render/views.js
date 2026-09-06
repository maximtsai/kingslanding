// Hero TD -- dynamic views barrel.
//
// Each view type now lives in its own file for maintainability.
// This barrel re-exports them all so existing imports continue to work.

export { createStructureView } from './structure-view.js';
export { createBoatView } from './boat-view.js';
export { createProjectileView } from './projectile-view.js';
export { createCoinView } from './coin-view.js';
export { createGuideView } from './guide-view.js';
export { createHeroView } from './hero-view.js';
export { createGhostView } from './ghost-view.js';
