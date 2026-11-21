// A small glTF binary (.glb) writer for Node or the browser, no dependencies (three.js's GLTFExporter needs a DOM).
// Enough for a package's shell and near look: meshes of triangles with positions, normals, vertex colours, uv,
// one material each (a city material by name, or a PBR one), in nodes with names.
//
//   import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
//   const bytes = writeGlb([
//     { name: 'deck', material: 'fc:paving', positions, normals, colors, uvs, indices },
//     { name: 'statue', material: { color: [1, 1, 1], roughness: 0.16, metalness: 0 }, positions, normals, colors },
//   ]);
//
// positions, normals: Float32Array (xyz); colors: Float32Array, rgb or rgba, 0..1 (linear), stored as
// normalised u8 RGBA; uvs: Float32Array (uv); indices: Uint16Array or Uint32Array (optional: then every three
// vertices are a triangle). matrix: 16 numbers, column-major (optional). A mesh's `material` is a string
// ('fc:paving') or { name?, color: [r, g, b, a?], roughness, metalness, emissive: [r, g, b], doubleSided }.

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UNSIGNED_BYTE = 5121, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125;

export function writeGlb(meshes) {
  const json = { asset: { version: '2.0', generator: 'flotopia-ugc glb.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const parts = [];
  let length = 0;
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); length += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    parts.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    length += bytes.byteLength;
    return json.bufferViews.length - 1;
  };
  const accessor = (bytes, target, componentType, type, count, extra = {}) => {
    json.accessors.push({ bufferView: view(bytes, target), componentType, count, type, ...extra });
    return json.accessors.length - 1;
  };
  const materials = new Map();
  const material = (m) => {
    const key = typeof m === 'string' ? m : JSON.stringify(m);
    if (materials.has(key)) return materials.get(key);
    let mat;
    if (typeof m === 'string') mat = { name: m, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } };
    else {
      const c = m.color ?? [1, 1, 1, 1];
      mat = { name: m.name ?? 'pbr', pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], c[3] ?? 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 0.8 } };
      if (m.emissive) mat.emissiveFactor = m.emissive.slice(0, 3);
      if (m.doubleSided) mat.doubleSided = true;
    }
    json.materials.push(mat);
    materials.set(key, json.materials.length - 1);
    return json.materials.length - 1;
  };

  for (const m of meshes) {
    const P = m.positions;
    if (!(P instanceof Float32Array) || P.length % 3) throw new Error(`glb: ${m.name}: positions must be a Float32Array of xyz`);
    const n = P.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const v = P[3 * i + k];
      if (!Number.isFinite(v)) throw new Error(`glb: ${m.name}: position ${i} is not finite`);
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
    const attributes = { POSITION: accessor(P, ARRAY_BUFFER, FLOAT, 'VEC3', n, { min, max }) };
    if (m.normals) attributes.NORMAL = accessor(m.normals, ARRAY_BUFFER, FLOAT, 'VEC3', n);
    if (m.colors) {
      const k = m.colors.length / n, c = new Uint8Array(4 * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) c[4 * i + j] = j < k ? Math.round(Math.min(1, Math.max(0, m.colors[k * i + j])) * 255) : 255;
      attributes.COLOR_0 = accessor(c, ARRAY_BUFFER, UNSIGNED_BYTE, 'VEC4', n, { normalized: true });
    }
    if (m.uvs) attributes.TEXCOORD_0 = accessor(m.uvs, ARRAY_BUFFER, FLOAT, 'VEC2', n);
    const prim = { attributes, mode: 4, material: material(m.material ?? 'fc:plaster') };
    if (m.indices) {
      const I = m.indices, big = I instanceof Uint32Array || n > 65535;
      const idx = big ? (I instanceof Uint32Array ? I : Uint32Array.from(I)) : (I instanceof Uint16Array ? I : Uint16Array.from(I));
      prim.indices = accessor(idx, ELEMENT_ARRAY_BUFFER, big ? UNSIGNED_INT : UNSIGNED_SHORT, 'SCALAR', idx.length);
    }
    json.meshes.push({ name: m.name, primitives: [prim] });
    const node = { name: m.name, mesh: json.meshes.length - 1 };
    if (m.matrix) node.matrix = Array.from(m.matrix);
    json.nodes.push(node);
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  json.buffers.push({ byteLength: length });

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.length / 4) * 4, binLen = Math.ceil(length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen);
  let at = 20 + jsonLen;
  dv.setUint32(at, binLen, true);
  dv.setUint32(at + 4, 0x004e4942, true); // 'BIN'
  at += 8;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
