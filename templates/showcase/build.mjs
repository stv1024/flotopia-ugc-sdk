// Builds the showcase island into dist/: the shell, the near look, the ground, the shaders, the cover, the manifest.
// `npm run build` does this, then compiles assembly/ into dist/island.wasm and packs (package.json).
// Outside this repo: npm i -D github:stv1024/flotopia-ugc-sdk assemblyscript (and playwright-core for shot, play).
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
import { Shapes } from 'flotopia-ugc/lib/shapes.mjs';
import { png } from 'flotopia-ugc/lib/png.mjs';

const R = 12, DECK = 0.5;
mkdirSync('dist', { recursive: true });

cpSync('shaders', 'dist/shaders', { recursive: true });
// the near look: a round deck (its side down to the hull, −3.5); the glass ball is the code's
const near = new Shapes();
near.cylinder('fc:paving', [0, -3.5, 0], R, DECK + 3.5, { sides: 48, color: [0.9, 0.9, 0.88] });
writeFileSync('dist/near.glb', writeGlb(near.meshes(), { log: 'near.glb' }));
const shell = new Shapes();
shell.cylinder({ name: 'shell', color: [1, 1, 1] }, [0, -1, 0], R, DECK + 1, { sides: 32, color: [0.85, 0.84, 0.8] });
writeFileSync('dist/shell.glb', writeGlb(shell.meshes(), { log: 'shell.glb' }));

const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => [+(r * Math.cos((i / n) * Math.PI * 2)).toFixed(3), +(r * Math.sin((i / n) * Math.PI * 2)).toFixed(3)]);
writeFileSync('dist/ground.json', JSON.stringify({
  cells: [{ poly: circle(R), h: { const: DECK }, surf: 'deck' }],
  colliders: [], // the ball keeps the player out itself (keepout)
  arrive: [0, DECK, 8, Math.PI],
}));
// the cover (the catalog's picture): here a plain one; a real island's is a picture of it (flotopia-ugc shot)
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
