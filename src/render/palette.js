// Island diorama -- colour.
//
// Bright maritime palette: clean white stone, fresh green grass, clear blue sea.
// Saturated hues are reserved for banners and the king so they read instantly.
// This is the file to open when the look needs adjusting; nothing else hard-codes
// a scene colour except a handful of small material accents (timber, iron, cloth)
// that live next to the geometry they belong to.


export const palette = {
  water: 0x5aa2b1, shallow: 0x8bbec5, foam: 0xeef4ee, sand: 0xe3dcc0,
  grass: 0x8cab6b, grassShade: 0x739159, bush: 0x428549, tree: 0x2d6b40,
  rockTop: 0xc9d0c2, rockSide: 0x98a195, cliff: 0x939c8e, rockDeep: 0x7d857b,
  // Stairs get their own pair rather than borrowing rockTop/rockSide. A
  // flight is a path the player is meant to read across the island, so it
  // stays bright while the cliff it is cut into goes darker around it.
  stairTop: 0xe7eae0, stairSide: 0xc3c9bc,
  wall: 0xf1eee2, roof: 0xd0c5a4,
  // Warm near-black, not the cool blue-black this used to be (0x2e2f35).
  // Section 15 gives gameplay warm-and-dark and forbids the environment any red
  // at all, so raiders leaning red is what the rule always asked for -- the old
  // value was quietly on the wrong side of it. Luminance is matched to within a
  // point, so they are exactly as dark as before and only the hue has moved.
  enemy: 0x3a2b2e, boat: 0x6a3f49, blood: 0xa2464e,
  crown: 0xf2c14e, cape: 0xc2352f, king: 0x22436a, accent: 0xc2352f,
  // The visible backdrop is a screen-vertical ramp on the water plane (water.js):
  // skyTop is the TOP of the frame and skyBottom the bottom, so a clear day runs
  // pale overhead into deeper blue toward the viewer -- not the other way round.
  skyTop: 0x64aab8, skyBottom: 0x529dac, haze: 0x80adb8,
  coolShade: 0x92bdcd
};
