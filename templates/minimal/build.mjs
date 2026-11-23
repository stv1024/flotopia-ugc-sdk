// Builds the minimal island into dist/: the shell, the near look, the ground, the cover, the manifest.
// `npm run build` does this, then compiles assembly/ into dist/island.wasm and packs (package.json).
// Outside this repo: npm i -D github:stv1024/flotopia-ugc-sdk assemblyscript (and playwright-core for shot, play).
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
import { Shapes } from 'flotopia-ugc/lib/shapes.mjs';
import { png } from 'flotopia-ugc/lib/png.mjs';

const R = 12, DECK = 0.5;
mkdirSync('dist', { recursive: true });

// the near look: a round deck (its side down to the hull, −3.5) and a pillar the code's box turns over
const near = new Shapes();
near.cylinder('fc:paving', [0, -3.5, 0], R, DECK + 3.5, { sides: 48, color: [0.9, 0.9, 0.88] });
near.cylinder('fc:concrete', [0, DECK, 0], 1.5, 1.2, { sides: 24, color: [0.8, 0.8, 0.78] });
writeFileSync('dist/near.glb', writeGlb(near.meshes(), { log: 'near.glb' }));
// the shell: the same deck, simpler, one material with vertex colours
const shell = new Shapes();
shell.cylinder({ name: 'shell', color: [1, 1, 1] }, [0, -1, 0], R, DECK + 1, { sides: 32, color: [0.85, 0.84, 0.8] });
writeFileSync('dist/shell.glb', writeGlb(shell.meshes(), { log: 'shell.glb' }));

const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => [+(r * Math.cos((i / n) * Math.PI * 2)).toFixed(3), +(r * Math.sin((i / n) * Math.PI * 2)).toFixed(3)]);
writeFileSync('dist/ground.json', JSON.stringify({
  cells: [{ poly: circle(R), h: { const: DECK }, surf: 'deck' }],
  // the pillar and the box over it: one collider (the box turns in 1.6 m of the axis)
  colliders: [{ poly: circle(1.6, 8), y0: DECK, y1: 4.2 }],
  arrive: [0, DECK, 8, Math.PI],
}));
// the cover (the catalog's picture): here a plain one; a real island's is a picture of it (flotopia-ugc shot)
writeFileSync('dist/cover.png', png(256, 256, (x, y) => (Math.hypot(x - 128, y - 150) < 70 ? [235, 140, 50] : y > 150 ? [40, 120, 200] : [150, 200, 240])));
writeFileSync('dist/ugc.json', JSON.stringify({
  schema: 'flotopia-ugc/1',
  title: { zh: '最小的岛', en: 'Minimal Island' },
  footprint: { shape: 'circle', r: R },
  cover: 'cover.png',
  shell: 'shell.glb',
  lods: [{ file: 'near.glb' }],
  ground: 'ground.json',
  runtime: { wasm: 'island.wasm', activate: 120, release: 180, caps: [] },
  files: {},
}, null, 2));
