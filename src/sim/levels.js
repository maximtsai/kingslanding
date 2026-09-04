// Hero TD -- levels.
//
// TDD section 3. A level is a square height array, an explicit list of ramp
// tile-pairs, and author-placed houses.
//
// The numbers themselves live in level-data.js, which is written by the level
// editor and must be treated as generated. THIS file is the human half: the
// argument for why each level is shaped the way it is, which no tool can
// regenerate and no tool is allowed to overwrite. Everything below is prose
// plus the three-line re-export at the bottom.
//
// If you are hand-editing a height array, you are editing level-data.js and
// should expect the editor to overwrite it. That is fine -- just do not put
// reasoning there.
//
// THE WATERLINE, AND WHAT A TIER-2 TILE ON IT MEANS
//
// A boat steers at the map centre and unloads onto the first land tile its ray
// meets, and TDD 11 will not unload onto anything above tier 1 -- a cliff face
// is not a beach. So a tier-2 tile on the waterline is COASTAL CLIFF: shoreline
// that reads as unclimbable and is never landed on. That is a legitimate thing
// to author, and a useful one -- it is how a level says "not here" without
// spending water on it.
//
// It costs nothing at runtime because the spawner does not guess. sim/landing.js
// enumerates every approach angle that ends at a real beach, once per level, and
// waves.js picks from that list; a cliff is not rejected on the tenth try, it is
// simply not on the menu. What board.validate() still refuses is a coast with
// almost no beach at all, because then there is nothing to pick from.
//
// THE THREE LEVELS
//
// Each one is built around a single terrain idea, and the idea is what the wave
// table in config.js escalates against:
//
//   one    One plateau, two ramps. The baseline: learn the loop.
//   two    Two plateaus, one ramp each, on opposite flanks. The king drops off a
//          cliff in an instant and has to walk all the way round to get back up,
//          so answering the far landing costs real time.
//   three  A tier-3 core with only four buildable tiles on it. The high ground
//          has the reach (TDD 9's elevation modifier) but the castle cannot fit
//          up there, so the enemy is never coming to it.
//
// ---------------------------------------------------------------------------
// ONE -- Level One.
//
// One plateau, two ramps, and the arrival cutscene. Nothing here is trying to
// be clever; it is the level the economy targets of TDD 12 are tuned against.
//
// THE APPROACH BEARING of the `intro` block sits BETWEEN the two earlier
// attempts. At the default yaw, tile (+1,+1) projects to almost straight
// screen-down and (-1,+1) to almost pure screen-left; the authored heading runs
// along roughly (-0.38, +0.93), so the boat enters from the lower left and
// travels up and to the right. Reason about the projection, never about the
// compass -- "south-west" written down is very nearly due LEFT once drawn.
//
// He lands on the southern point at (3,7): the house at (2,6) sits up-left of
// him and the stairway up-right, which is the framing the arrival was chosen
// for. About 4.5 tiles of sailing, for a short cutscene. Moving the landing
// tile without re-checking that framing is how you get a cutscene pointed at
// empty water.
//
// ---------------------------------------------------------------------------
// TWO -- Twin Capes.
//
// Two tier-2 plateaus, north-west and south-east, separated by a tier-1 band
// that runs the full width of the island. Each plateau has exactly ONE ramp,
// and the two ramps are on opposite flanks: the north one climbs from the west
// shore, the south one from the east.
//
// That asymmetry is the level. The king can leave a plateau anywhere -- he
// jumps down any cliff, which is his whole mobility advantage (TDD 3) -- but
// getting back up means walking to the one ramp. The fast half of the trip is
// free and the return is expensive, which is what makes a second landing on
// the far shore an actual problem rather than a short jog. Wave 2 lands north
// and south at the same instant and states that outright.
//
// Enemies have no such shortcut, so a single ramp is also a real chokepoint
// for whichever plateau holds the castle. The counter-pressure is the houses:
// one on each plateau and one out on the open east shore, so a landing party
// walking to the ramp eats the income on the way past (proximity aggro, TDD
// 10). Holding the choke and holding the economy are different problems.
//
// THE RAMPS are deliberately diagonally opposed: [[1,3],[2,3]] climbs the west
// shore onto the north cape, [[8,7],[7,7]] climbs the east shore onto the south
// cape. Putting them on the same flank collapses the whole premise.
//
// THE NORTH CAPE HOUSE is at [3,2] and deliberately NOT at [4,2]: a house there
// leaves fewer legal 2x2 sites, and a level whose premise is that either cape
// can be home has to let the castle sit on either cape. board.flatSquares(2) is
// the check.
//
// ---------------------------------------------------------------------------
// THREE -- The Crown.
//
// A tier-3 core ringed by a tier-2 terrace, ringed by a tier-1 shore, with
// four ramps up to the terrace spread around the compass and two more up to
// the peak. There is no chokepoint here: the landing party can start its climb
// from any side, which is the escalation over Twin Capes.
//
// The core is six tiles and two of them are ramp tiles, so FOUR are buildable
// and a 2x2 castle cannot fit (canPlaceCastle forbids straddling a ramp). That
// is the point, not an accident. Towers on the peak get the full two-tier
// elevation bonus of TDD 9 -- the longest reach in the game -- but the castle
// is always somewhere below them, so the enemy has no reason to walk into it.
// High ground you have to spend gold to make relevant is a more interesting
// decision than high ground that wins by being stood on.
//
// Four houses, and two of them are out on the open shore where they cannot be
// held. That is income you are meant to lose, at a time of your choosing.
//
// THE SIX RAMPS, in the order they appear in the data -- the first four ring
// the terrace, the last two climb the peak:
//
//   [[3,1],[3,2]]   north shore up to the terrace
//   [[1,4],[2,4]]   west
//   [[8,5],[7,5]]   east
//   [[6,8],[6,7]]   south
//   [[3,3],[4,3]]   terrace up to the peak, west face
//   [[6,5],[5,5]]   and east face
//
// THE EAST SHORE HOUSE is at [9,5] rather than [9,4] for the same reason as
// level two: at [9,4] the house eats the only 2x2 on the whole eastern shore.
// ---------------------------------------------------------------------------

import { LEVEL_DATA, LEVEL_ORDER } from './level-data.js';

export const LEVELS = LEVEL_DATA;
export { LEVEL_ORDER };

export function nextLevelId(id) {
  const at = LEVEL_ORDER.indexOf(id);
  return at >= 0 && at + 1 < LEVEL_ORDER.length ? LEVEL_ORDER[at + 1] : null;
}
