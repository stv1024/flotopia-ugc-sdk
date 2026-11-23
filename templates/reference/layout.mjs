// Where everything of the city reference stands (build.mjs makes it, shots.mjs labels it). Island frame, metres.
export const DECK = 0.5;
export const W = 96, D = 96; // the footprint (rect: w along x, d along z)

export const MATERIALS = ['paving', 'plaza', 'concrete', 'plaster', 'wood', 'sand', 'grass', 'metal', 'hull', 'glow', 'gloss', 'fabric'];
// a warm light colour: the emissive of the PBR boxes and the vertex colour of the fc:glow boxes, times a level
export const WARM = [1, 0.72, 0.42];
export const EMISSIVE = [0.05, 0.1, 0.2, 0.4, 0.7, 1];
export const GLOW = [0.2, 0.35, 0.5, 0.65, 0.8, 1];
// the vertex colour of the slabs in front of the material cubes
export const TINT = [0.85, 0.55, 0.35];
// trees, by size: [kind, the space it takes along x (m: about its crown)]
export const BIG_TREES = [['palmCoconut', 9], ['palmRoyal', 8], ['rainTree', 19], ['almond', 10], ['forestTree', 20], ['birch', 5]];
export const SMALL_TREES = [['frangipani', 6], ['treeFern', 5], ['shrub', 2.4], ['bougainvillea', 2.4], ['grass', 2.2], ['hedge', 3], ['fern', 3]];

// row A: the materials, a 2.2 m cube and a ball on it, faces +z; a slab with the TINT vertex colour in front
export const ROW_A = MATERIALS.map((m, i) => ({ label: m, x: (i - (MATERIALS.length - 1) / 2) * 2.8, z: 0 }));
// row B: emissive, faces +z: PBR (left) and fc:glow (right)
export const ROW_B = [
  ...EMISSIVE.map((e, i) => ({ label: `emissive ${e}`, level: e, glow: false, x: (i - 6 + 0.5) * 2.4, z: 32 })),
  ...GLOW.map((g, i) => ({ label: `glow ${g}`, level: g, glow: true, x: (i + 0.5) * 2.4, z: 32 })),
];
// a row of trees from x0 along +x, each in the middle of its space
const row = (list, x0, z) => {
  let x = x0;
  return list.map(([kind, w]) => { const t = { label: kind, kind, x: x + w / 2, z }; x += w; return t; });
};
export const ROW_BIG = row(BIG_TREES, -36, -38);
export const ROW_SMALL = row(SMALL_TREES, -36, -16);
// a 10 m post with 1 m bands at the start of each tree row
export const POSTS = [{ x: -38, z: -38 }, { x: -37.5, z: -16 }];

// the shots: [file, hour, camera [x, y, z, tx, ty, tz], the labelled things, dz: a label's point is at
// (x, DECK, z + dz), under the thing's front seen from the camera]
export const SHOTS = [
  ['materials-day', 15, [0, 5.5, 24, 0, 1.2, 0], ROW_A, 4.7],
  ['materials-night', 22, [0, 5.5, 24, 0, 1.2, 0], ROW_A, 4.7],
  ['emissive-day', 15, [0, 2.6, 46, 0, 1.3, 32], ROW_B, 1],
  ['emissive-night', 22, [0, 2.6, 46, 0, 1.3, 32], ROW_B, 1],
  ['trees-big', 15, [0, 10, -2, 0, 9, -38], ROW_BIG, 3],
  ['trees-small', 15, [-24, 3, -4, -24, 1.6, -16], ROW_SMALL, 1.6],
];
