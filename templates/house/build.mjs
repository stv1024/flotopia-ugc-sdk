// A two-storey house with a stair, a door and a balcony: the ground.json example of docs/ground.md.
// Every part is in ONE list (PARTS) and makes both its mesh and its ground: a 'solid' a box mesh and a collider,
// a 'floor' a box mesh and a cell on its top, a 'look' only a mesh, a 'collider' only a collider. So a door cut
// in the mesh is cut in the colliders too: they cannot disagree.
//   node build.mjs && npx flotopia-ugc pack dist && npx flotopia-ugc check dist
// Island frame: +z is the island's front (the door faces it), +x to the right seen from the front, +y up.
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';

const DECK = 0.5; // the deck's top (the city's decks are at 0.5)
const STOREY = 3.0; // floor to floor
const UP = DECK + STOREY; // the upper floor's top: 3.5
const SLAB = 0.2; // the upper floor's thickness
const T = 0.2; // wall thickness
const DOOR_W = 1.2, DOOR_H = 2.2; // the openings (the player: radius 0.35; needs 1.9 m of height)
const RISE = 0.25, RUN = 0.28, RISES = STOREY / RISE; // 12 rises: 11 steps, the 12th is the upper floor
const HX = 5, HZ = 4; // the house: x −5..5, z −4..4 (the walls' outer faces)
const W = 24, D = 24; // the footprint (rect: w along x, d along z)
const TOP = UP + STOREY; // the top of the upper walls: 6.5

export const PARTS = []; // { kind, x0, x1, y0, y1, z0, z1, mat, col }
const solid = (x0, x1, y0, y1, z0, z1, mat = 'fc:plaster', col = [0.95, 0.92, 0.86]) => PARTS.push({ kind: 'solid', x0, x1, y0, y1, z0, z1, mat, col });
const floor = (x0, x1, y0, y1, z0, z1, mat = 'fc:wood', col = [0.85, 0.7, 0.55]) => PARTS.push({ kind: 'floor', x0, x1, y0, y1, z0, z1, mat, col });
const look = (x0, x1, y0, y1, z0, z1, mat, col) => PARTS.push({ kind: 'look', x0, x1, y0, y1, z0, z1, mat, col });
const collider = (x0, x1, y0, y1, z0, z1) => PARTS.push({ kind: 'collider', x0, x1, y0, y1, z0, z1 });

// the deck: the whole footprint, one cell (inside the house too: the ground floor is the deck)
floor(-W / 2, W / 2, -3.5, DECK, -D / 2, D / 2, 'fc:paving', [0.9, 0.9, 0.88]);

// walls. A wall with no opening is ONE collider from the deck to the roof: a wall top at the upper floor's height
// (3.5) would hold up a player walking down the stair beside it (a collider's top within 0.62 m over the feet and
// 0.5 m of the player's centre is ground to stand on)
solid(-HX, HX, DECK, TOP, -HZ, -HZ + T); // back
solid(-HX, -HX + T, DECK, TOP, -HZ + T, HZ - T); // left (the stair runs along it)
solid(HX - T, HX, DECK, TOP, -HZ + T, HZ - T); // right
// the front wall (z = HZ − T .. HZ), a storey at a time: an opening is a gap between two pieces, and a lintel over it.
// The ground floor's door at x −0.6..0.6:
solid(-HX, -DOOR_W / 2, DECK, UP, HZ - T, HZ);
solid(DOOR_W / 2, HX, DECK, UP, HZ - T, HZ);
solid(-DOOR_W / 2, DOOR_W / 2, DECK + DOOR_H, UP, HZ - T, HZ); // the lintel: 2.7 .. 3.5, over the head (feet 0.5 + 1.9 = 2.4)
// the upper storey's, the balcony door at x 2..3.2:
const BX0 = 2, BX1 = 2 + DOOR_W;
solid(-HX, BX0, UP, TOP, HZ - T, HZ);
solid(BX1, HX, UP, TOP, HZ - T, HZ);
solid(BX0, BX1, UP + DOOR_H, TOP, HZ - T, HZ);
// the roof: a slab (a collider too: it keeps the follow camera's arm inside the upper room)
solid(-HX - 0.3, HX + 0.3, TOP, TOP + 0.25, -HZ - 0.3, HZ + 0.3, 'fc:hull', [0.55, 0.3, 0.22]);

// the stair: along the left wall, going up toward −z. x −4.8..−3.8; the first step's front at z = 2.2
const SX0 = -HX + T, SX1 = SX0 + 1.0, SZ = 2.2;
const stairEnd = SZ - (RISES - 1) * RUN; // where the last step ends and the upper floor starts: −0.88
for (let k = 1; k < RISES; k++) {
  // step k: its top at DECK + k·RISE, z from SZ − (k−1)·RUN back to SZ − k·RUN. A cell each, a constant height
  floor(SX0, SX1, DECK, DECK + k * RISE, SZ - k * RUN, SZ - (k - 1) * RUN, 'fc:wood', [0.75, 0.58, 0.42]);
}
// the stair's open side: a rail from the deck to 1.1 m over the upper floor, only along the steps (the space in
// front of the first step, z 2.2 .. 3.8, stays open: the way onto the stair). Upstairs it fences the stairwell
solid(SX1, SX1 + 0.1, DECK, UP + 1.1, stairEnd, SZ, 'fc:metal', [0.3, 0.3, 0.32]);

// the upper floor: a cell has no holes, so the floor round the stairwell (x −4.8..−3.8, z −0.88..2.2) is three
// pieces: A right of it, all the depth; B behind it, past the stair's top; C in front of it, over the first step's
// landing (2.8 m of headroom under it)
const FLOORS = [
  [SX1 + 0.1, HX - T, -HZ + T, HZ - T], // A
  [SX0, SX1 + 0.1, -HZ + T, stairEnd], // B
  [SX0, SX1 + 0.1, SZ, HZ - T], // C
];
for (const [x0, x1, z0, z1] of FLOORS) {
  floor(x0, x1, UP - SLAB, UP, z0, z1);
  // the slab is a collider as well (y 3.3 .. 3.5): no wall downstairs (its bottom is over feet + 1.9); the follow
  // camera's arm stays under it; the player upstairs stands on its top and on the cells alike
  collider(x0, x1, UP - SLAB, UP, z0, z1);
}
// upstairs, the stairwell's front edge (over the first step): a rail from the upper floor up (y0 = 3.5: no wall
// for a player downstairs, whose head is at most 0.5 + 1.9 = 2.4)
solid(SX0, SX1, UP, UP + 1.1, SZ, SZ + 0.1, 'fc:metal', [0.3, 0.3, 0.32]);

// the balcony: a floor outside the upper door, a rail round it (1.1 m: more than a step, so a wall)
floor(1, 4.6, UP - SLAB, UP, HZ, HZ + 1.6);
collider(1, 4.6, UP - SLAB, UP, HZ, HZ + 1.6);
solid(1, 4.6, UP, UP + 1.1, HZ + 1.5, HZ + 1.6, 'fc:metal', [0.3, 0.3, 0.32]);
solid(1, 1.1, UP, UP + 1.1, HZ, HZ + 1.5, 'fc:metal', [0.3, 0.3, 0.32]);
solid(4.5, 4.6, UP, UP + 1.1, HZ, HZ + 1.5, 'fc:metal', [0.3, 0.3, 0.32]);

// outside: a bench you may stand on (0.45 m: under the step-up of 0.62) and a planter you may not (its
// collider is 1.9 m, more than a jump reaches, though its mesh is 0.8 m: a collider need not match its mesh)
solid(-4, -2, DECK, DECK + 0.45, 7, 7.5, 'fc:wood', [0.7, 0.5, 0.35]);
look(2, 4, DECK, DECK + 0.8, 7, 8, 'fc:concrete', [0.8, 0.8, 0.78]);
collider(2, 4, DECK, DECK + 1.9, 7, 8);

// ------------------------------------------------------------------ meshes (one a material) and ground.json
function box(p) {
  const P = [], N = [], C = [], U = [], I = [];
  const lo = [p.x0, p.y0, p.z0], hi = [p.x1, p.y1, p.z1];
  for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, b = P.length / 3;
    for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const q = [0, 0, 0], n = [0, 0, 0];
      q[ax] = sg > 0 ? hi[ax] : lo[ax];
      q[u] = a ? hi[u] : lo[u];
      q[v] = c ? hi[v] : lo[v];
      n[ax] = sg;
      P.push(...q); N.push(...n); C.push(...p.col); U.push(q[u] * 0.25, q[v] * 0.25); // planar uv, 1 uv = 4 m
    }
    if (sg > 0) I.push(b, b + 1, b + 2, b, b + 2, b + 3); else I.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  return { P, N, C, U, I };
}
function merge(parts) {
  const g = { P: [], N: [], C: [], U: [], I: [] };
  for (const p of parts) {
    const b = box(p), o = g.P.length / 3;
    g.P.push(...b.P); g.N.push(...b.N); g.C.push(...b.C); g.U.push(...b.U); g.I.push(...b.I.map((i) => i + o));
  }
  return { positions: new Float32Array(g.P), normals: new Float32Array(g.N), colors: new Float32Array(g.C), uvs: new Float32Array(g.U), indices: new Uint32Array(g.I) };
}

mkdirSync('dist', { recursive: true });
const shown = PARTS.filter((p) => p.kind !== 'collider');
const mats = [...new Set(shown.map((p) => p.mat))];
writeFileSync('dist/near.glb', writeGlb(mats.map((mat) => ({ name: mat.replace('fc:', ''), material: mat, ...merge(shown.filter((p) => p.mat === mat)) }))));
// the shell: the deck and the house as two boxes, one material, vertex colours
writeFileSync('dist/shell.glb', writeGlb([{ name: 'shell', material: { color: [1, 1, 1] }, ...merge([
  { x0: -W / 2, x1: W / 2, y0: -1, y1: DECK, z0: -D / 2, z1: D / 2, col: [0.85, 0.85, 0.83] },
  { x0: -HX, x1: HX, y0: DECK, y1: TOP + 0.25, z0: -HZ, z1: HZ, col: [0.93, 0.9, 0.84] },
]) }]));

const r3 = (v) => Math.round(v * 1000) / 1000;
const rect = (p) => [[r3(p.x0), r3(p.z0)], [r3(p.x1), r3(p.z0)], [r3(p.x1), r3(p.z1)], [r3(p.x0), r3(p.z1)]];
const ground = {
  cells: PARTS.filter((p) => p.kind === 'floor').map((p) => ({ poly: rect(p), h: { const: r3(p.y1) }, surf: p.mat === 'fc:wood' ? 'wood' : 'deck' })),
  colliders: PARTS.filter((p) => p.kind === 'solid' || p.kind === 'collider').map((p) => ({ poly: rect(p), y0: r3(p.y0), y1: r3(p.y1) })),
  arrive: [0, DECK, 9, Math.PI], // in front of the door, facing it (−z)
};
writeFileSync('dist/ground.json', JSON.stringify(ground, null, 1));
writeFileSync('dist/ugc.json', JSON.stringify({
  schema: 'flotopia-ugc/1',
  title: { zh: '两层小楼', en: 'Two-Storey House' },
  footprint: { shape: 'rect', w: W, d: D },
  shell: 'shell.glb',
  lods: [{ file: 'near.glb' }],
  ground: 'ground.json',
  files: {},
}, null, 2));
console.log(`dist/: near.glb (${mats.length} meshes), shell.glb, ground.json (${ground.cells.length} cells, ${ground.colliders.length} colliders), ugc.json`);
