// Stair geometry in tile-space. The flight extends into the lower approach and
// ends at the upper tile edge; both rendering and elevation sampling use these
// boundaries so a visible riser is also where a walker changes height.
export const STAIR_TREAD_STARTS = Object.freeze([-0.24, -0.12, 0, 0.12, 0.24, 0.36]);
// Fractions of the tier, per tread. The flight no longer starts flush with the
// lower ground or finish flush with the upper landing: it opens on a lip a third
// of a step high and stops a third of a step short at the top, which gives the
// bottom block a visible face and keeps the last one from merging into the tile
// it arrives at. The six treads are evenly spaced across what is left, so the
// risers are all 0.173 -- steadier than the 0.18-0.21 spread this replaces.
export const STAIR_HEIGHTS = Object.freeze([0.067, 0.24, 0.413, 0.587, 0.76, 0.933]);
export const STAIR_END = 0.5;
export const STAIR_BOTTOM_OFFSET = 0.006;
export const STAIR_TOP_OFFSET = -0.006;

// Bodies begin rising shortly before a riser and reach its new tread at the
// edge. This keeps feet out of the stone without turning the whole flight into
// a linear ramp.
const RISER_BLEND = 0.035;

// The lip at the bottom and the short drop at the top are risers like any other
// -- a walker climbs onto the first block and up off the last one -- so the
// ground and the upper landing are treads as far as elevation is concerned. They
// are added here rather than to the exported arrays, which place actual blocks.
const WALK_STARTS = [-Infinity, ...STAIR_TREAD_STARTS, STAIR_END];
const WALK_HEIGHTS = [0, ...STAIR_HEIGHTS, 1];

export function stairHeightAt(along, easeRisers = false) {
  if (along >= STAIR_END) return 1;

  let tread = 0;
  while (tread < WALK_STARTS.length - 1 &&
    along >= WALK_STARTS[tread + 1]) tread++;

  if (!easeRisers || tread === WALK_HEIGHTS.length - 1) return WALK_HEIGHTS[tread];

  const edge = WALK_STARTS[tread + 1];
  const blendStart = edge - RISER_BLEND;
  if (along <= blendStart) return WALK_HEIGHTS[tread];

  const t = (along - blendStart) / RISER_BLEND;
  const eased = t * t * (3 - 2 * t);
  return WALK_HEIGHTS[tread] +
    (WALK_HEIGHTS[tread + 1] - WALK_HEIGHTS[tread]) * eased;
}

export function stairSurfaceY(lowY, highY, height) {
  const bottom = lowY + STAIR_BOTTOM_OFFSET;
  const top = highY + STAIR_TOP_OFFSET;
  return bottom + (top - bottom) * height;
}
