// Builds the showcase island into dist/: the shell, the near look, the ground, the shaders, the manifest. Then
// `npx asc ...` makes dist/island.wasm and `flotopia-ugc pack dist` writes the hashes (npm run build does all).
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
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
  // uv: planar, metres × 0.25 (the city's materials: 1 uv = 4 m)
  const uv = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { uv[2 * i] = P[3 * i] * 0.25; uv[2 * i + 1] = P[3 * i + 2] * 0.25; }
  return { positions: new Float32Array(P), normals: Nn, colors: new Float32Array(C), uvs: uv, indices: new Uint16Array(I) };
}

cpSync('shaders', 'dist/shaders', { recursive: true });
writeFileSync('dist/shell.glb', writeGlb([{ name: 'deck', material: { color: [1, 1, 1] }, ...disc(R, DECK, -1, [0.85, 0.84, 0.8]) }]));
writeFileSync('dist/near.glb', writeGlb([{ name: 'deck', material: 'fc:paving', ...disc(R, DECK, -3.5, [0.9, 0.9, 0.88]) }]));
const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => [+(r * Math.cos((i / n) * Math.PI * 2)).toFixed(3), +(r * Math.sin((i / n) * Math.PI * 2)).toFixed(3)]);
writeFileSync('dist/ground.json', JSON.stringify({
  cells: [{ poly: circle(R), h: { const: DECK }, surf: 'deck' }],
  colliders: [],
  arrive: [0, DECK, 8, Math.PI],
}));
// the cover (the catalog's picture): here a plain PNG; a real island's is a screenshot (flotopia-ugc shot)
writeFileSync('dist/cover.png', png(256, 256, (x, y) => (Math.hypot(x - 128, y - 130) < 70 ? [160, 210, 250] : y > 150 ? [40, 120, 200] : [150, 200, 240])));
writeFileSync('dist/ugc.json', JSON.stringify({
  schema: 'flotopia-ugc/1',
  title: { zh: '玻璃球', en: 'Glass Ball' },
  footprint: { shape: 'circle', r: R },
  cover: 'cover.png',
  shell: 'shell.glb',
  lods: [{ file: 'near.glb' }],
  ground: 'ground.json',
  runtime: { wasm: 'island.wasm', activate: 120, release: 180, caps: ['shader', 'target', 'refract', 'keepout', 'focus'] },
  files: {},
}, null, 2));
console.log('dist/: shell.glb, near.glb, ground.json, cover.png, ugc.json');

// a PNG of w × h, rgb(x, y) → [r, g, b]
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
