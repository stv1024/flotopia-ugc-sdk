// Builds the minimal island into dist/: the shell, the near look, the ground, the manifest. Then
// `npx asc ...` makes dist/island.wasm and `flotopia-ugc pack dist` writes the hashes (npm run build does all).
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeGlb } from '../../lib/glb.mjs';

const R = 12, DECK = 0.5, N = 48;
mkdirSync('dist', { recursive: true });

// a disc (top at y) with a skirt down to y0, vertex colour col
function disc(r, y, y0, col) {
  const P = [], C = [], I = [];
  P.push(0, y, 0); C.push(...col);
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; P.push(r * Math.cos(a), y, r * Math.sin(a)); C.push(...col); }
  for (let i = 0; i < N; i++) I.push(0, 1 + ((i + 1) % N), 1 + i);
  const b = P.length / 3;
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; P.push(r * Math.cos(a), y, r * Math.sin(a), r * Math.cos(a), y0, r * Math.sin(a)); C.push(...col, ...col.map((c) => c * 0.7)); }
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; I.push(b + 2 * i, b + 2 * j, b + 2 * i + 1, b + 2 * j, b + 2 * j + 1, b + 2 * i + 1); }
  const n = P.length / 3, Nn = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { const x = P[3 * i], z = P[3 * i + 2], top = i <= N; const l = Math.hypot(x, z) || 1; Nn.set(top ? [0, 1, 0] : [x / l, 0, z / l], 3 * i); }
  return { positions: new Float32Array(P), normals: Nn, colors: new Float32Array(C), indices: new Uint16Array(I) };
}

writeFileSync('dist/shell.glb', writeGlb([{ name: 'deck', material: { color: [1, 1, 1] }, ...disc(R, DECK, -1, [0.85, 0.84, 0.8]) }]));
writeFileSync('dist/near.glb', writeGlb([{ name: 'deck', material: 'fc:paving', ...disc(R, DECK, -3.5, [0.9, 0.9, 0.88]) }]));
const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => [+(r * Math.cos((i / n) * Math.PI * 2)).toFixed(3), +(r * Math.sin((i / n) * Math.PI * 2)).toFixed(3)]);
writeFileSync('dist/ground.json', JSON.stringify({
  cells: [{ poly: circle(R), h: { const: DECK }, surf: 'deck' }],
  colliders: [{ poly: circle(1.6, 8), y0: DECK, y1: 4.2 }],
  arrive: [0, DECK, 8, Math.PI],
}));
writeFileSync('dist/ugc.json', JSON.stringify({
  schema: 'flotopia-ugc/1',
  title: { zh: '最小的岛', en: 'Minimal Island' },
  footprint: { shape: 'circle', r: R },
  shell: 'shell.glb',
  lods: [{ file: 'near.glb' }],
  ground: 'ground.json',
  runtime: { wasm: 'island.wasm', activate: 120, release: 180, caps: [] },
  files: {},
}, null, 2));
console.log('dist/: shell.glb, near.glb, ground.json, ugc.json');
