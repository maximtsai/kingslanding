// Island diorama -- colour.
//
// Muted maritime palette: cool near-white stone, sage grass, hazy sea.
// Saturated hues are reserved for banners and the king so they read instantly.
// This is the file to open when the look needs adjusting; nothing else hard-codes
// a scene colour except a handful of small material accents (timber, iron, cloth)
// that live next to the geometry they belong to.


export const palette = {
  water: 0x518f9a, shallow: 0x82b4b8, foam: 0xe1e7d8, sand: 0xdcd3b6,
  grass: 0x9db55f, grassShade: 0x7e9850, bush: 0x688549, tree: 0x49653a,
  rockTop: 0xeee8d5, rockSide: 0xd4d2bf, cliff: 0xe3decb, rockDeep: 0xacae9e,
  wall: 0xe9e2cc, roof: 0xbcb294,
  // Warm near-black, not the cool blue-black this used to be (0x2e2f35).
  // Section 15 gives gameplay warm-and-dark and forbids the environment any red
  // at all, so raiders leaning red is what the rule always asked for -- the old
  // value was quietly on the wrong side of it. Luminance is matched to within a
  // point, so they are exactly as dark as before and only the hue has moved.
  enemy: 0x3a2b2e, boat: 0x6a3f49, blood: 0xa2464e,
  crown: 0xf2c14e, cape: 0xc2352f, king: 0x22436a, accent: 0xc2352f,
  skyTop: 0x315e6c, skyBottom: 0x75a5aa, haze: 0x6f9fa8,
  coolShade: 0x8bb6c4
};
