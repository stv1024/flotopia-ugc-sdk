// play in the published UGC browser (network, a GPU, playwright-core's browser): only with FLOTOPIA_BROWSER=1,
// after building the house template (cd templates/house && npm i && npm run build).
//   FLOTOPIA_BROWSER=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { play } from '../lib/play.mjs';

const HOUSE = join(dirname(fileURLToPath(import.meta.url)), '../templates/house');
const skip = process.env.FLOTOPIA_BROWSER !== '1' ? 'set FLOTOPIA_BROWSER=1' : !existsSync(join(HOUSE, 'dist/ugc.json')) ? 'build templates/house first' : false;

test('play: the house walks; with its door walled up it fails, naming the collider', { skip, timeout: 300000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'fc-play-'));
  const ok = await play(join(HOUSE, 'dist'), join(HOUSE, 'play.json'), { out });
  assert.deepEqual(ok.fails, []);
  // the same house, the door walled up
  const dir = join(out, 'walled');
  cpSync(join(HOUSE, 'dist'), dir, { recursive: true });
  const g = JSON.parse(readFileSync(join(dir, 'ground.json'), 'utf8'));
  g.colliders.push({ poly: [[-0.6, 3.8], [0.6, 3.8], [0.6, 4], [-0.6, 4]], y0: 0.5, y1: 2.7 });
  writeFileSync(join(dir, 'ground.json'), JSON.stringify(g));
  const m = JSON.parse(readFileSync(join(dir, 'ugc.json'), 'utf8'));
  const b = readFileSync(join(dir, 'ground.json'));
  m.files['ground.json'] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
  writeFileSync(join(dir, 'ugc.json'), JSON.stringify(m));
  writeFileSync(join(out, 'door.json'), JSON.stringify([{ walk: [0, 2] }]));
  const bad = await play(dir, join(out, 'door.json'), { out });
  assert.equal(bad.ok, false);
  assert.match(bad.fails[0], /collider \d+ \(y 0\.5 \.\. 2\.7\) in the way/);
});
