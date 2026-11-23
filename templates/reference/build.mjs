// The city reference (docs/city.md): every city material (fc:*), emissive levels and every tree kind of things.json,
// side by side, to look at in the UGC browser by day and by night. No code. Where everything is: layout.mjs.
//   node build.mjs && npx flotopia-ugc pack dist && npx flotopia-ugc serve dist --port 8787
//   node shots.mjs <UGC browser URL> <package URL> <out dir>    (the pictures of docs/city/, labelled)
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
import { Shapes } from 'flotopia-ugc/lib/shapes.mjs';
import { DECK, W, D, WARM, TINT, ROW_A, ROW_B, ROW_BIG, ROW_SMALL, POSTS } from './layout.mjs';

// parts with the same material go into one mesh (one draw call); the city's materials get their own uv scale
const s = new Shapes();
const box = (m, cx, cy, cz, sx, sy, sz, color = [1, 1, 1]) => s.box(m, [cx - sx / 2, cy - sy / 2, cz - sz / 2], [cx + sx / 2, cy + sy / 2, cz + sz / 2], { color });

// the deck: a mid grey PBR slab (0.18: a photographer's grey card), so the swatches stand out
box({ name: 'deck', color: [0.18, 0.18, 0.18], roughness: 0.9 }, 0, DECK - 2, 0, W, 4, D);
for (const a of ROW_A) {
  box(`fc:${a.label}`, a.x, DECK + 1.1, a.z, 2.2, 2.2, 2.2);
  s.sphere(`fc:${a.label}`, [a.x, DECK + 2.2 + 0.7, a.z], 0.7);
  box(`fc:${a.label}`, a.x, DECK + 0.15, a.z + 3.5, 2.2, 0.3, 2.2, TINT);
}
for (const b of ROW_B) {
  if (b.glow) box('fc:glow', b.x, DECK + 0.8, b.z, 1.6, 1.6, 1.6, WARM.map((c) => c * b.level));
  else box({ name: b.label, color: [0.3, 0.3, 0.3], roughness: 0.8, emissive: WARM.map((c) => c * b.level) }, b.x, DECK + 0.8, b.z, 1.6, 1.6, 1.6);
}
for (const p of POSTS) for (let k = 0; k < 10; k++) {
  box({ name: k % 2 ? 'band dark' : 'band light', color: k % 2 ? [0.05, 0.05, 0.05] : [0.9, 0.9, 0.9], roughness: 0.7 }, p.x, DECK + k + 0.5, p.z, 0.3, 1, 0.3);
}

mkdirSync('dist', { recursive: true });
writeFileSync('dist/near.glb', writeGlb(s.meshes(), { log: 'near.glb' }));
const shell = new Shapes();
shell.box({ name: 'shell', color: [1, 1, 1] }, [-W / 2, DECK - 1, -D / 2], [W / 2, DECK, D / 2], { color: [0.2, 0.2, 0.2] });
writeFileSync('dist/shell.glb', writeGlb(shell.meshes(), { log: 'shell.glb' }));
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
