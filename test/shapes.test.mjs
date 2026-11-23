// lib/shapes.mjs: the shapes face out, merge by material, get the material's uv scale; mat4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shapes, mat4, earcut, area, UV_SCALE } from '../lib/shapes.mjs';
import { writeGlb } from '../lib/glb.mjs';
import { checkGlb } from '../lib/host/check/gltf.js';

// every triangle of a mesh faces away from the point `inside`, and its normal agrees with its vertices' normals
function facesOut(m, inside) {
  const P = m.positions, N = m.normals, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...n) < 1e-9) continue;
    const ctr = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const vn = [0, 1, 2].map((k) => N[3 * I[t] + k] + N[3 * I[t + 1] + k] + N[3 * I[t + 2] + k]);
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] <= 0) return `triangle ${t / 3} against its normals`;
    if (inside && n[0] * (ctr[0] - inside[0]) + n[1] * (ctr[1] - inside[1]) + n[2] * (ctr[2] - inside[2]) <= 0) return `triangle ${t / 3} faces in`;
  }
  return null;
}
const one = (s) => { const m = s.meshes(); assert.equal(m.length, 1); return m[0]; };

test('box: 12 triangles facing out, uv planar × the city material\'s scale', () => {
  const m = one(new Shapes().box('fc:wood', [0, 0, 0], [2, 1, 4], { color: [0.5, 0.4, 0.3] }));
  assert.equal(m.indices.length / 3, 12);
  assert.equal(facesOut(m, [1, 0.5, 2]), null);
  assert.equal(m.name, 'wood');
  assert.equal(UV_SCALE.wood, 0.4);
  assert.ok(Math.abs(Math.max(...m.uvs) - 4 * 0.4) < 1e-6); // the 4 m side
  assert.deepEqual([...m.colors.slice(0, 3)].map((v) => +v.toFixed(3)), [0.5, 0.4, 0.3]);
});

test('cylinder, cone, ball, roof face out', () => {
  assert.equal(facesOut(one(new Shapes().cylinder('fc:metal', [0, 0, 0], 1, 3, { sides: 12 })), [0, 1.5, 0]), null);
  assert.equal(facesOut(one(new Shapes().cylinder('fc:metal', [0, 0, 0], 1, 2, { top: 0 })), [0, 0.5, 0]), null);
  assert.equal(facesOut(one(new Shapes().sphere('fc:gloss', [1, 2, 3], 1.5)), [1, 2, 3]), null);
  // a gable roof with no underside: every face out from a point under the ridge
  for (const ridge of ['x', 'z']) assert.equal(facesOut(one(new Shapes().roof('fc:hull', [-2, -1], [2, 1], 3, 1, { ridge, under: false })), [0, 3.2, 0]), null);
  const r = one(new Shapes().roof('fc:hull', [-2, -1], [2, 1], 3, 1, { overhang: 0.5 }));
  assert.ok(Math.min(...r.positions.filter((_, i) => i % 3 === 1)) < 3); // the overhang goes on down
});

test('prism: a concave polygon, either winding, faces out', () => {
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]; // an L
  for (const poly of [L, [...L].reverse()]) {
    const m = one(new Shapes().prism('fc:grass', poly, 0, 0.5));
    assert.equal(facesOut(m, null), null);
    // the top's triangles cover the L's area (7 m²)
    let top = 0;
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const ys = [I[t], I[t + 1], I[t + 2]].map((i) => P[3 * i + 1]);
      if (ys.every((y) => y === 0.5)) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => [P[3 * i], P[3 * i + 2]]);
        top += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      }
    }
    assert.ok(Math.abs(top - 7) < 1e-9, `top ${top}`);
  }
  assert.equal(earcut([[0, 0], [2, 0], [2, 2], [1, 0.5], [0, 2]]).length, 3);
  assert.ok(area([[0, 0], [1, 0], [0, 1]]) > 0);
});

test('merged by material: one mesh each; the host checks the glb clean', () => {
  const s = new Shapes();
  s.box('fc:plaster', [0, 0, 0], [1, 1, 1]).box('fc:plaster', [2, 0, 0], [3, 1, 1]);
  s.box({ name: 'glass', color: [1, 1, 1, 0.3] }, [0, 2, 0], [1, 3, 1]);
  s.box({ name: 'glass', color: [1, 1, 1, 0.3] }, [2, 2, 0], [3, 3, 1]); // an equal description: the same mesh
  const ms = s.meshes();
  assert.equal(ms.length, 2);
  assert.equal(s.size.triangles, 48);
  const r = checkGlb(writeGlb(ms), { shell: false, near: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.draws, 2);
});

test('matrix: a shape moved and turned; mat4 composes', () => {
  const M = mat4.compose([10, 0, 5], Math.PI / 2);
  const m = one(new Shapes().box('fc:plaster', [0, 0, 0], [2, 1, 1], { matrix: M }));
  const xs = m.positions.filter((_, i) => i % 3 === 0), zs = m.positions.filter((_, i) => i % 3 === 2);
  // +x turned to −z by a quarter turn: x 10..11, z 3..5
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((v) => +v.toFixed(6)), [10, 11, 3, 5]);
  assert.equal(facesOut(m, mat4.apply(M, [1, 0.5, 0.5])), null);
  const a = mat4.multiply(mat4.translate(1, 2, 3), mat4.rotateY(0.3)), b = mat4.compose([1, 2, 3], 0.3);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12));
  // a heading h faces (sin h, 0, cos h): rotateY(h) takes +z there
  const d = mat4.applyDir(mat4.rotateY(0.7), [0, 0, 1]);
  assert.ok(Math.abs(d[0] - Math.sin(0.7)) < 1e-12 && Math.abs(d[2] - Math.cos(0.7)) < 1e-12);
});
