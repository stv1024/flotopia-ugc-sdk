// check's warnings (lib/check-package.mjs): on a package made here with what a creator gets wrong. Also the
// reach of ground.json (lib/reach.mjs) and the panel's problems (lib/panel.mjs) on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkPackage } from '../lib/check-package.mjs';
import { reach } from '../lib/reach.mjs';
import { panelProblem } from '../lib/panel.mjs';
import { Shapes } from '../lib/shapes.mjs';
import { writeGlb } from '../lib/glb.mjs';
import { png } from '../lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const FP = { shape: 'rect', w: 20, d: 20 };
// a room 6 × 6 on a 20 × 20 deck, its door in the front wall (+z) unless `door` is false
function room(door = true) {
  const walls = [rect(-3, -3, 3, -2.8), rect(-3, -2.8, -2.8, 2.8), rect(2.8, -2.8, 3, 2.8)];
  if (door) walls.push(rect(-3, 2.8, -0.6, 3), rect(0.6, 2.8, 3, 3));
  else walls.push(rect(-3, 2.8, 3, 3));
  return { cells: [{ poly: rect(-10, -10, 10, 10), h: { const: 0.5 } }], colliders: walls.map((poly) => ({ poly, y0: 0.5, y1: 3.5 })), arrive: [0, 0.5, 7, Math.PI] };
}
const warns = (r, re) => r.warnings.filter((w) => re.test(w));

test('reach: a room with a door: nothing to say; walled up: its floor cannot be reached', () => {
  assert.deepEqual(reach(room(true), FP).warnings, []);
  const w = reach(room(false), FP).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /cell 0 \(y 0\.5\): [\d.]+ m² of it round \(0, -?0\) cannot be reached/);
});

test('reach: a step too high, a gap, a stair that works', () => {
  const g = room(true);
  g.cells.push({ poly: rect(5, 5, 7, 7), h: { const: 1.2 } }); // 0.7 over the deck: too high
  g.cells.push({ poly: rect(-9, 5, -8, 6), h: { const: 0.9 } }, { poly: rect(-9, 6, -8, 7), h: { const: 1.3 } }); // two steps of 0.4: fine
  const w = reach(g, FP).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /cell 1 \(y 1\.2\): no part of it/);
  // an island of a cell out in the sea, across a gap
  const s = { cells: [{ poly: rect(-5, -5, 5, 5), h: { const: 0.5 } }, { poly: rect(6, -1, 9, 1), h: { const: 0.5 } }], colliders: [], arrive: [0, 0.5, 0, 0] };
  assert.match(reach(s, FP).warnings.join(), /cell 1 .*no part of it/);
});

test('reach: arrive off the cells, in a collider, its y not the floor\'s', () => {
  const g = room(true);
  assert.match(reach({ ...g, arrive: [0, 0.5, 12, 0] }, { shape: 'rect', w: 30, d: 30 }).warnings.join(), /arrive .* is on no cell/);
  assert.match(reach({ ...g, arrive: [-2.9, 0.5, 0, 0] }, FP).warnings.join(), /is in a collider/);
  assert.match(reach({ ...g, arrive: [0, 2, 7, 0] }, FP).warnings.join(), /arrive's y is 2/);
});

test('reach: act points: in reach, in the air, behind a wall', () => {
  const acts = [
    { x: 0, y: 0.5, z: 6, r: 2, dy: 1.5, hint: { en: 'a' } },
    { x: 0, y: 4, z: 6, r: 1, dy: 0.5, hint: { en: 'b' } },
    { x: 0, y: 0.5, z: 0, r: 1, dy: 1.5, hint: { en: 'c' } },
  ];
  const w = reach(room(false), FP, acts).warnings;
  assert.equal(warns({ warnings: w }, /act point 0/).length, 0);
  assert.match(w.join('\n'), /act point 1 \("b"\).*no floor to stand on/);
  assert.match(w.join('\n'), /act point 2 \("c"\).*cannot be reached on foot/);
});

test('panel: where the JSON breaks; the field the host refuses; a key cap it drops', () => {
  const syntax = panelProblem('{"title":{"zh":"a","en":"a"},"items":[{"label":{"zh":"x","en":"x"}}]');
  assert.equal(syntax.refused, true);
  assert.match(syntax.why, /^not JSON .* at character \d+/);
  assert.match(panelProblem('{"title":{"zh":"","en":"a"},"items":[]}').why, /^title\.zh/);
  assert.match(panelProblem('{"title":{"zh":"a","en":"a"},"items":[{"slider":{"id":1,"min":5,"max":1,"value":2}}]}').why, /items\[0\]\.slider: max/);
  assert.match(panelProblem('{"title":{"zh":"a","en":"a"},"items":[{"swatches":{"id":1,"options":[{"colors":["red"],"title":{"zh":"a","en":"a"}}]}}]}').why, /colors\[0\]: "#rrggbb"/);
  const key = panelProblem('{"title":{"zh":"a","en":"a"},"items":[{"buttons":[{"id":1,"key":"KeyB","text":{"zh":"b","en":"b"}}]}]}');
  assert.equal(key.refused, false);
  assert.match(key.why, /buttons\[0\]\.key: "KeyB".*focus\.keys/);
  assert.equal(panelProblem('{"title":{"zh":"a","en":"a"},"items":[{"buttons":[{"id":1,"key":"B","text":{"zh":"b","en":"b"}}]},{"leave":{"text":{"zh":"走","en":"Go"}}}]}'), null);
});

test('check: the probe package: act point out of reach, node names, a file nobody uses, a mesh past the footprint, the panel', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-check-'));
  try {
    // the code
    const asc = (await import('assemblyscript/asc')).default;
    const out = join(dir, 'island.wasm');
    const r = await asc.main([join(HERE, 'fixtures/probe/index.ts'), '-O3', '--runtime', 'incremental', '--maximumMemory', '1024', '-o', out], { stdout: { write() {} }, stderr: { write() {} } });
    assert.equal(r.error, null, String(r.error));
    // the looks: the deck, and a bench whose mesh pokes 0.3 m out of the footprint (circle r 10)
    const near = new Shapes();
    near.cylinder('fc:paving', [0, -3.5, 0], 9.9, 4, { sides: 32 });
    near.box('fc:wood', [9, 0.5, -0.5], [10.3, 1, 0.5]);
    const ms = near.meshes();
    ms[0].name = 'deck';
    writeFileSync(join(dir, 'near.glb'), writeGlb(ms));
    writeFileSync(join(dir, 'shell.glb'), writeGlb(new Shapes().cylinder({ name: 'shell' }, [0, -1, 0], 9.9, 1.5).meshes()));
    writeFileSync(join(dir, 'ground.json'), JSON.stringify({ cells: [{ poly: Array.from({ length: 24 }, (_, i) => [9.8 * Math.cos(i / 3.82), 9.8 * Math.sin(i / 3.82)]), h: { const: 0.5 } }], colliders: [], arrive: [0, 0.5, 8, Math.PI] }));
    writeFileSync(join(dir, 'tex.png'), png(4, 4, () => [200, 200, 200]));
    writeFileSync(join(dir, 'old-cover.png'), png(4, 4, () => [0, 0, 0]));
    const files = {};
    for (const f of ['island.wasm', 'near.glb', 'shell.glb', 'ground.json', 'tex.png', 'old-cover.png']) {
      const b = readFileSync(join(dir, f));
      files[f] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
    }
    writeFileSync(join(dir, 'ugc.json'), JSON.stringify({
      schema: 'flotopia-ugc/1', title: { zh: '探针', en: 'Probe' }, footprint: { shape: 'circle', r: 10 },
      shell: 'shell.glb', lods: [{ file: 'near.glb' }], ground: 'ground.json',
      runtime: { wasm: 'island.wasm', activate: 100, release: 150, caps: ['focus'] }, files,
    }));
    const c = await checkPackage(dir, { ticks: 60 });
    const all = c.warnings.join('\n');
    assert.match(all, /near\.glb: its meshes reach 0\.31 m past the footprint \(10\.31 m from the centre, r 10\)/);
    assert.match(all, /node_visible\("lantern"\): the near look has no node of that name/);
    assert.doesNotMatch(all, /node_visible\("deck"\)/);
    assert.match(all, /it has "deck", "wood"\)/); // (the near look's nodes; not the shell's)
    assert.match(all, /old-cover\.png: nothing uses it/);
    assert.doesNotMatch(all, /tex\.png: nothing uses it/);
    assert.match(all, /act point 1 \("in the air"\).*no floor to stand on/);
    assert.doesNotMatch(all, /act point 0/);
    assert.match(all, /panel\(\): items\[0\]\.leave\.key: "Esc"/);
    const panel = c.errors.filter((e) => e.code === 'E_PANEL');
    assert.equal(panel.length, 1);
    assert.match(panel[0].message, /refused: not JSON .* at character \d+/);
    assert.equal(c.errors.filter((e) => /panel/.test(e.message) && e.code === 'E_CALL').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
