// lib/glb.mjs and lib/png.mjs: what they write, and that the host's own glTF check takes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeGlb, glbInfo, glbJson } from '../lib/glb.mjs';
import { png } from '../lib/png.mjs';
import { checkGlb } from '../lib/host/check/gltf.js';
import { imageSize } from '../lib/host/check/image.js';

// a quad of two triangles
const quad = (x = 0) => ({
  positions: new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
});
const near = (b) => checkGlb(b, { shell: false, near: true });

test('png: the size the host reads; RGB without alpha, RGBA with', () => {
  const rgb = png(5, 3, () => [10, 20, 30]), rgba = png(4, 4, (x) => [0, 0, 0, x * 60]);
  assert.deepEqual(imageSize(rgb), { type: 'png', width: 5, height: 3 });
  assert.equal(rgb[25], 2); // colour type: RGB
  assert.equal(rgba[25], 6); // RGBA
  assert.throws(() => png(2, 2, new Uint8Array(3)));
});

test('a city material and a PBR one; the host checks it clean', () => {
  const b = writeGlb([{ name: 'deck', material: 'fc:paving', ...quad() }, { name: 'stone', material: { color: [0.5, 0.5, 0.5], roughness: 0.9 }, ...quad(2) }]);
  const r = near(b);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.draws, 2);
  const j = glbJson(b);
  assert.equal(j.materials[0].name, 'fc:paving');
  assert.equal(j.materials[1].alphaMode, undefined); // opaque
  assert.deepEqual(glbInfo(b).materials, ['fc:paving', 'stone']);
});

test('alphaMode: BLEND when the colour has alpha < 1, else as given', () => {
  const j = glbJson(writeGlb([
    { name: 'glass', material: { color: [0.8, 0.9, 1, 0.3] }, ...quad() },
    { name: 'leaves', material: { color: [1, 1, 1], alphaMode: 'MASK', alphaCutoff: 0.4 }, ...quad(2) },
    { name: 'solid', material: { color: [1, 1, 1, 0.5], alphaMode: 'OPAQUE' }, ...quad(4) },
  ]));
  assert.equal(j.materials[0].alphaMode, 'BLEND');
  assert.equal(j.materials[1].alphaMode, 'MASK');
  assert.equal(j.materials[1].alphaCutoff, 0.4);
  assert.equal(j.materials[2].alphaMode, undefined);
  assert.throws(() => writeGlb([{ name: 'x', material: { alphaMode: 'blend' }, ...quad() }]), /alphaMode/);
});

test('embedded textures: base colour and emissive, PNG and JPEG, stored once, a uv set each', () => {
  const img = png(8, 8, (x, y) => [x * 30, y * 30, 100]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // (only its kind is looked at here)
  const m = quad();
  const b = writeGlb([
    { name: 'floor', material: { map: img, emissiveMap: { image: img, texCoord: 1 }, emissive: [0.2, 0.1, 0], emissiveStrength: 2 }, ...m, uvs1: m.uvs },
    { name: 'wall', material: { map: { image: img, wrap: 'clamp' } }, ...quad(2) },
  ]);
  const j = glbJson(b);
  assert.equal(j.images.length, 1);
  assert.equal(j.images[0].mimeType, 'image/png');
  assert.equal(j.samplers.length, 2); // repeat, clamp
  assert.equal(j.textures.length, 2);
  assert.deepEqual(j.materials[0].pbrMetallicRoughness.baseColorTexture, { index: 0 });
  assert.deepEqual(j.materials[0].emissiveTexture, { index: 0, texCoord: 1 });
  assert.equal(j.materials[0].extensions.KHR_materials_emissive_strength.emissiveStrength, 2);
  assert.ok(j.extensionsUsed.includes('KHR_materials_emissive_strength'));
  assert.ok(j.meshes[0].primitives[0].attributes.TEXCOORD_1 !== undefined);
  const r = near(b);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats.images, [{ width: 8, height: 8 }]);
  assert.equal(glbJson(writeGlb([{ name: 'j', material: { map: jpeg }, ...quad() }])).images[0].mimeType, 'image/jpeg');
  assert.throws(() => writeGlb([{ name: 'w', material: { map: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]) }, ...quad() }]), /PNG or JPEG/);
});

test('instancing: one node, TRANSLATION/ROTATION/SCALE; one draw call a primitive, triangles for each', () => {
  const b = writeGlb([{ name: 'lamps', material: 'fc:glow', ...quad(), instances: [{ position: [0, 0, 5] }, { position: [2, 0, 5], yaw: Math.PI / 2, scale: 2 }, { position: [4, 0, 5] }] }]);
  const j = glbJson(b), a = j.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes;
  assert.deepEqual(Object.keys(a).sort(), ['ROTATION', 'SCALE', 'TRANSLATION']);
  assert.equal(j.accessors[a.TRANSLATION].count, 3);
  assert.ok(j.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
  const info = glbInfo(b), r = near(b);
  assert.deepEqual(r.errors, []);
  assert.equal(info.draws, 1);
  assert.equal(info.triangles, 6);
  assert.equal(info.draws, r.stats.draws); // as the host counts
  assert.equal(info.triangles, r.stats.triangles);
  // no rotation, no scale given: only TRANSLATION
  const k = glbJson(writeGlb([{ name: 'l', ...quad(), instances: [{ position: [1, 0, 0] }, { position: [2, 0, 0] }] }]));
  assert.deepEqual(Object.keys(k.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes), ['TRANSLATION']);
});

test('bad input is refused with the mesh named', () => {
  assert.throws(() => writeGlb([{ name: 'a', positions: [0, 0, 0] }]), /a: positions/);
  assert.throws(() => writeGlb([{ name: 'b', positions: new Float32Array([0, 0, 0, NaN, 0, 0]) }]), /not finite/);
  assert.throws(() => writeGlb([{ name: 'c', ...quad(), indices: new Uint16Array([0, 1, 9]) }]), /index 9/);
  assert.throws(() => writeGlb([{ name: 'd', ...quad(), uvs1: new Float32Array(3) }]), /uvs1/);
});
