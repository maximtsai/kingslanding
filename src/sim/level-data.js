// Hero TD -- level data.
//
// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// This file is machine-owned. tools/level-editor.html overwrites it wholesale
// through the dev server's save endpoint, so hand edits made here are lost on
// the next save. Everything that explains WHY a level is shaped the way it is
// lives in levels.js, which imports this and is never written by the tool.
//
// If you are reading this to find out how a level works, you are in the wrong
// file. Open levels.js.
//
// SCHEMA
//
// Each entry is keyed by its own id, and carries:
//
//   id             the key again -- board.validate() names it in error messages
//   name           display name
//   heights        square int array, indexed [j][i] (row then column) so the
//                  array as written reads like the island looks from above.
//                  0 = water, 1..3 = land tier
//   ramps          [[lowI, lowJ], [highI, highJ]] pairs. Both ends are named
//                  explicitly: inferring a ramp's direction from neighbour
//                  heights is ambiguous the moment it touches two tiers at
//                  once. Validated at load -- see board.js, which throws if a
//                  pair is not orthogonally adjacent or does not span exactly
//                  one tier.
//   houses         author-placed house tiles
//   shoreFallback  where a landing party comes ashore. P0 used these as walker
//                  spawns; P1 replaced them with boat landing resolution (TDD
//                  11) and keeps them only as the authored fallback that
//                  guarantees a wave can never fail to spawn. Boats normally
//                  pick from the beaches landing.js enumerates, so this list is
//                  the floor rather than the usual path -- and every tile in it
//                  must be tier-1 land.
//   reserved       optional. Tiles kept clear of structures.
//   intro          optional arrival cutscene, { from, land }. `from` is in tile
//                  coordinates and deliberately off the board; `land` is the
//                  beach it grounds against. A level without this block opens
//                  straight on castle siting -- only level one has it, because
//                  you arrive at the realm once.
//   heroSpawn      starting tile
//   notes          optional free text. Round-tripped by the editor and ignored
//                  by the game -- somewhere to leave a remark next to a level
//                  without touching levels.js.

export const LEVEL_DATA = {

  one: {
    id: 'one',
    name: 'Level One',
    heights: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0, 0],
      [0, 1, 1, 2, 2, 1, 1, 0],
      [0, 1, 2, 2, 2, 2, 1, 0],
      [0, 1, 2, 2, 2, 2, 1, 0],
      [0, 1, 1, 2, 2, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 1, 1, 0, 0]
    ],
    ramps: [
      [[3, 6], [3, 5]],
      [[1, 4], [2, 4]]
    ],
    houses: [[2, 3], [2, 6], [5, 5]],
    shoreFallback: [[1, 6], [3, 6], [4, 6], [3, 7], [4, 7]],
    intro: { from: [1.3, 11.2], land: [3, 7] },
    heroSpawn: [3, 3]
  },

  two: {
    id: 'two',
    name: 'Twin Capes',
    heights: [
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 2, 2, 1, 1, 0, 0],
      [0, 1, 1, 2, 2, 2, 2, 1, 1, 0],
      [1, 1, 2, 2, 2, 2, 2, 1, 1, 0],
      [1, 1, 1, 1, 3, 3, 1, 1, 1, 1],
      [1, 1, 1, 1, 3, 3, 1, 1, 1, 1],
      [0, 1, 1, 2, 2, 2, 2, 2, 1, 1],
      [0, 1, 1, 2, 2, 2, 2, 2, 1, 0],
      [0, 0, 1, 1, 2, 2, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0]
    ],
    ramps: [
      [[1, 3], [2, 3]],
      [[8, 7], [7, 7]],
      [[5, 3], [5, 4]],
      [[4, 6], [4, 5]]
    ],
    houses: [[5, 1], [3, 5], [6, 4], [3, 7]],
    shoreFallback: [[4, 0], [8, 2], [9, 4], [0, 5], [4, 9]],
    heroSpawn: [4, 4]
  },

  three: {
    id: 'three',
    name: 'The Crown',
    heights: [
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 2, 2, 1, 1, 0, 0],
      [0, 1, 1, 2, 2, 2, 2, 1, 1, 0],
      [1, 1, 2, 2, 3, 3, 2, 2, 1, 1],
      [1, 1, 2, 2, 3, 3, 2, 2, 1, 1],
      [1, 1, 2, 2, 3, 3, 2, 2, 1, 1],
      [1, 1, 2, 2, 2, 2, 2, 2, 1, 1],
      [0, 1, 1, 2, 2, 2, 2, 1, 1, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0]
    ],
    ramps: [
      [[3, 1], [3, 2]],
      [[1, 4], [2, 4]],
      [[8, 5], [7, 5]],
      [[6, 8], [6, 7]],
      [[3, 3], [4, 3]],
      [[6, 5], [5, 5]]
    ],
    houses: [[2, 3], [7, 6], [4, 8], [9, 5]],
    shoreFallback: [[4, 0], [1, 2], [9, 3], [0, 6], [7, 8], [5, 9]],
    heroSpawn: [4, 6]
  }
};

// Play order. The WON phase advances along this list; the last entry ends the
// run (TDD 18: three tuned levels, not a generator). Editable by the tool,
// because a level the order does not name is a level nobody can reach.
export const LEVEL_ORDER = ['one', 'two', 'three'];
