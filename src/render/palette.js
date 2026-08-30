// Island diorama -- colour.
//
// Muted maritime palette: cool near-white stone, sage grass, hazy sea.
// Saturated hues are reserved for banners and the king so they read instantly.
// This is the file to open when the look needs adjusting; nothing else hard-codes
// a scene colour except a handful of small material accents (timber, iron, cloth)
// that live next to the geometry they belong to.


export const palette = {
  water: 0x7cc0cd, shallow: 0x9dd2da, foam: 0xfbfcfc, sand: 0xece6d4,
  grass: 0xa8c676, grassShade: 0x84a85d, bush: 0x6e9454, tree: 0x4b7040,
  rockTop: 0xf8f6f2, rockSide: 0xe5e2dc, cliff: 0xf7f6f2, rockDeep: 0xcfcdc6,
  wall: 0xf2f0e5, roof: 0xc6c0a7,
  enemy: 0x2e2f35, boat: 0x6a3f49, blood: 0xa2464e,
  crown: 0xf2c14e, cape: 0xc2352f, king: 0x22436a, accent: 0xc2352f,
  skyTop: 0x6fb0c2, skyBottom: 0xc2d5d4, haze: 0x94c2cb,
  coolShade: 0x8bb6c4
};
