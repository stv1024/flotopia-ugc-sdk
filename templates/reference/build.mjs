// The city reference (docs/city.md): every city material (fc:*), emissive levels and every tree kind of things.json,
// side by side, to look at in the UGC browser by day and by night. No code. Where everything is: layout.mjs.
//   node build.mjs && npx flotopia-ugc pack dist && npx flotopia-ugc serve dist --port 8787
//   node shots.mjs <UGC browser URL> <package URL> <out dir>    (the pictures of docs/city/, labelled)
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
import { DECK, W, D, WARM, TINT, ROW_A, ROW_B, ROW_BIG, ROW_SMALL, POSTS } from './layout.mjs';

// a box: centre (cx, cy, cz), size (sx, sy, sz); uv on each face from its two axes, metres × 0.25 (1 uv = 4 m)
function box(cx, cy, cz, sx, sy, sz, col = [1, 1, 1]) {
  const P = [], N = [], C = [], U = [], I = [];
  const c = [cx, cy, cz], s = [sx / 2, sy / 2, sz / 2];
  for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, b = P.length / 3;
    for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[ax] = c[ax] + sg * s[ax]; p[u] = c[u] + a * s[u]; p[v] = c[v] + bb * s[v]; n[ax] = sg;
      P.push(...p); N.push(...n); C.push(...col); U.push(p[u] * 0.25, p[v] * 0.25);
    }
    if (sg > 0) I.push(b, b + 1, b + 2, b, b + 2, b + 3); else I.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  return { P, N, C, U, I };
}

// a ball: centre, radius
function ball(cx, cy, cz, r, col = [1, 1, 1], n = 16) {
  const P = [], N = [], C = [], U = [], I = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= 2 * n; j++) {
    const t = (i / n) * Math.PI, f = (j / (2 * n)) * Math.PI * 2;
    const d = [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
    P.push(cx + r * d[0], cy + r * d[1], cz + r * d[2]); N.push(...d); C.push(...col); U.push((cx + r * d[0]) * 0.25, (cz + r * d[2]) * 0.25);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a = i * (2 * n + 1) + j, b = a + 2 * n + 1;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { P, N, C, U, I };
}

// parts with the same material go into one mesh (one draw call)
const groups = new Map();
function add(material, part) {
  const k = typeof material === 'string' ? material : material.name;
  if (!groups.has(k)) groups.set(k, { material, P: [], N: [], C: [], U: [], I: [] });
  const g = groups.get(k), b = g.P.length / 3;
  g.P.push(...part.P); g.N.push(...part.N); g.C.push(...part.C); g.U.push(...part.U); g.I.push(...part.I.map((i) => i + b));
}

// the deck: a mid grey PBR slab (0.18: a photographer's grey card), so the swatches stand out
add({ name: 'deck', color: [0.18, 0.18, 0.18], roughness: 0.9 }, box(0, DECK - 2, 0, W, 4, D));
for (const a of ROW_A) {
  add(`fc:${a.label}`, box(a.x, DECK + 1.1, a.z, 2.2, 2.2, 2.2));
  add(`fc:${a.label}`, ball(a.x, DECK + 2.2 + 0.7, a.z, 0.7));
  add(`fc:${a.label}`, box(a.x, DECK + 0.15, a.z + 3.5, 2.2, 0.3, 2.2, TINT));
}
for (const b of ROW_B) {
  const part = box(b.x, DECK + 0.8, b.z, 1.6, 1.6, 1.6, b.glow ? WARM.map((c) => c * b.level) : [1, 1, 1]);
  add(b.glow ? 'fc:glow' : { name: b.label, color: [0.3, 0.3, 0.3], roughness: 0.8, emissive: WARM.map((c) => c * b.level) }, part);
}
for (const p of POSTS) for (let k = 0; k < 10; k++) {
  add({ name: k % 2 ? 'band dark' : 'band light', color: k % 2 ? [0.05, 0.05, 0.05] : [0.9, 0.9, 0.9], roughness: 0.7 }, box(p.x, DECK + k + 0.5, p.z, 0.3, 1, 0.3));
}

mkdirSync('dist', { recursive: true });
const meshes = [...groups.values()].map((g) => ({
  name: typeof g.material === 'string' ? g.material.slice(3) : g.material.name, material: g.material,
  positions: new Float32Array(g.P), normals: new Float32Array(g.N), colors: new Float32Array(g.C), uvs: new Float32Array(g.U), indices: new Uint32Array(g.I),
}));
writeFileSync('dist/near.glb', writeGlb(meshes));
const s = box(0, DECK - 0.5, 0, W, 1, D, [0.2, 0.2, 0.2]);
writeFileSync('dist/shell.glb', writeGlb([{ name: 'deck', material: { color: [1, 1, 1] }, positions: new Float32Array(s.P), normals: new Float32Array(s.N), colors: new Float32Array(s.C), indices: new Uint16Array(s.I) }]));
const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
writeFileSync('dist/ground.json', JSON.stringify({ cells: [{ poly: rect(W, D), h: { const: DECK } }], colliders: [], arrive: [0, DECK, 12, Math.PI] }));
writeFileSync('dist/things.json', JSON.stringify({ trees: [...ROW_BIG, ...ROW_SMALL].map((t) => ({ kind: t.kind, x: t.x, y: DECK, z: t.z, rotY: 0, scale: 1 })) }));
writeFileSync('dist/ugc.json', JSON.stringify({
  schema: 'flotopia-ugc/1',
  title: { zh: '城市参考', en: 'City Reference' },
  footprint: { shape: 'rect', w: W, d: D },
  shell: 'shell.glb',
  lods: [{ file: 'near.glb' }],
  ground: 'ground.json',
  things: 'things.json',
  files: {},
}, null, 2));
console.log(`dist/: near.glb (${meshes.length} meshes), shell.glb, ground.json, things.json, ugc.json`);
