// Stair geometry in tile-space. The flight extends into the lower approach and
// ends at the upper tile edge; both rendering and elevation sampling use these
// boundaries so a visible riser is also where a walker changes height.
export const STAIR_TREAD_STARTS = Object.freeze([-0.24, -0.12, 0, 0.12, 0.24, 0.36]);
export const STAIR_HEIGHTS = Object.freeze([0, 0.18, 0.39, 0.60, 0.81, 1]);
export const STAIR_END = 0.5;
export const STAIR_BOTTOM_OFFSET = 0.006;
export const STAIR_TOP_OFFSET = -0.006;

// Bodies begin rising shortly before a riser and reach its new tread at the
// edge. This keeps feet out of the stone without turning the whole flight into
// a linear ramp.
const RISER_BLEND = 0.035;

export function stairHeightAt(along, easeRisers = false) {
  if (along <= STAIR_TREAD_STARTS[0]) return STAIR_HEIGHTS[0];
  if (along >= STAIR_END) return STAIR_HEIGHTS[STAIR_HEIGHTS.length - 1];

  let tread = 0;
  while (tread < STAIR_TREAD_STARTS.length - 1 &&
    along >= STAIR_TREAD_STARTS[tread + 1]) tread++;

  if (!easeRisers || tread === STAIR_HEIGHTS.length - 1) return STAIR_HEIGHTS[tread];

  const edge = STAIR_TREAD_STARTS[tread + 1];
  const blendStart = edge - RISER_BLEND;
  if (along <= blendStart) return STAIR_HEIGHTS[tread];

  const t = (along - blendStart) / RISER_BLEND;
  const eased = t * t * (3 - 2 * t);
  return STAIR_HEIGHTS[tread] +
    (STAIR_HEIGHTS[tread + 1] - STAIR_HEIGHTS[tread]) * eased;
}

export function stairSurfaceY(lowY, highY, height) {
  const bottom = lowY + STAIR_BOTTOM_OFFSET;
  const top = highY + STAIR_TOP_OFFSET;
  return bottom + (top - bottom) * height;
}
