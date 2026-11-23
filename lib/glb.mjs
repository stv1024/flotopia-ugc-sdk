// A small glTF binary (.glb) writer for Node or the browser, no dependencies (three.js's GLTFExporter needs a DOM).
// Enough for a package's shell and near look: meshes of triangles with positions, normals, vertex colours, two uv
// sets, one material each (a city material by name, or a PBR one with embedded textures), in nodes with names,
// optionally instanced (EXT_mesh_gpu_instancing: one draw call for many copies).
//
//   import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
//   const bytes = writeGlb([
//     { name: 'deck', material: 'fc:paving', positions, normals, colors, uvs, indices },
//     { name: 'glass', material: { color: [0.8, 0.9, 1, 0.3], roughness: 0.05 }, positions, normals },   // BLEND
//     { name: 'floor', material: { map: { image: pngBytes }, roughness: 0.7 }, positions, normals, uvs },
//     { name: 'lamp', material: 'fc:glow', positions, normals, colors, instances: [{ position: [1, 0, 2] }, { position: [4, 0, 2], yaw: 0.5 }] },
//   ], { log: 'near.glb' });   // prints: near.glb: 4 draws, 1200 triangles, 1 image, 85.1 KB
//
// A mesh:
//   positions, normals: Float32Array (xyz). colors: Float32Array, rgb or rgba, 0..1 (linear), stored as
//   normalised u8 RGBA. uvs, uvs1: Float32Array (uv): TEXCOORD_0 and TEXCOORD_1. indices: Uint16Array or
//   Uint32Array (optional: then every three vertices are a triangle). matrix: 16 numbers, column-major (optional).
//   instances (optional): [{ position: [x, y, z], rotation?: [qx, qy, qz, qw] or yaw?: rad (about +y),
//   scale?: s or [sx, sy, sz] }]: the mesh drawn at each, in the node's frame; one draw call for all of them
//   (its triangles count once an instance).
// A mesh's material: a string ('fc:paving': the city's material, docs/abi.md 2.2 and docs/city.md 3) or
//   { name?, color: [r, g, b, a?], roughness, metalness, emissive: [r, g, b], emissiveStrength (> 1:
//     KHR_materials_emissive_strength), doubleSided, envMapIntensity (0–4, 0.35 without it: docs/abi.md 2.2),
//     alphaMode: 'OPAQUE' | 'MASK' | 'BLEND' (default: BLEND if color's alpha < 1, else OPAQUE), alphaCutoff (MASK),
//     map: a texture (the base colour; its alpha is the alpha), emissiveMap: a texture }
//   A texture: PNG or JPEG bytes (Uint8Array), or { image: bytes, texCoord: 0 | 1, wrap: 'repeat' | 'clamp' |
//   'mirror' }. The same bytes (the same Uint8Array) are stored once. A vertex colour's alpha counts only with
//   BLEND or MASK too.
// options: { log: a name }: print what drawing it costs (draws as the host counts them: one a primitive,
// instanced or not).
//
// glbInfo(bytes) → { draws, triangles, vertices, images, materials: [names], instanced, bytes }: of any .glb.

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UNSIGNED_BYTE = 5121, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125;
const WRAP = { repeat: 10497, clamp: 33071, mirror: 33648 };
const LINEAR = 9729, LINEAR_MIPMAP_LINEAR = 9987;

export function writeGlb(meshes, { log = null } = {}) {
  const json = { asset: { version: '2.0', generator: 'flotopia-ugc glb.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const used = new Set();
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

  // images and textures: one image a Uint8Array, one texture an (image, sampler)
  const images = new Map(), samplers = new Map(), textures = new Map();
  const texture = (t, what) => {
    const T = t instanceof Uint8Array ? { image: t } : t;
    if (!T || !(T.image instanceof Uint8Array)) throw new Error(`glb: ${what}: a texture is PNG or JPEG bytes (Uint8Array), or { image, texCoord, wrap }`);
    const mimeType = mimeOf(T.image);
    if (!mimeType) throw new Error(`glb: ${what}: the image is not a PNG or JPEG (glTF in a package: PNG or JPEG only)`);
    if (!images.has(T.image)) {
      json.images ??= [];
      json.images.push({ bufferView: view(T.image), mimeType });
      images.set(T.image, json.images.length - 1);
    }
    const wrap = WRAP[T.wrap ?? 'repeat'];
    if (!wrap) throw new Error(`glb: ${what}: wrap is 'repeat', 'clamp' or 'mirror'`);
    if (!samplers.has(wrap)) {
      json.samplers ??= [];
      json.samplers.push({ magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: wrap, wrapT: wrap });
      samplers.set(wrap, json.samplers.length - 1);
    }
    const key = `${images.get(T.image)}/${samplers.get(wrap)}`;
    if (!textures.has(key)) {
      json.textures ??= [];
      json.textures.push({ source: images.get(T.image), sampler: samplers.get(wrap) });
      textures.set(key, json.textures.length - 1);
    }
    const info = { index: textures.get(key) };
    if (T.texCoord) info.texCoord = T.texCoord;
    return info;
  };

  const materials = new Map();
  const material = (m, what) => {
    if (materials.has(m)) return materials.get(m);
    let mat;
    if (typeof m === 'string') mat = { name: m, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } };
    else {
      const c = m.color ?? [1, 1, 1, 1], alpha = c[3] ?? 1;
      mat = { name: m.name ?? what ?? 'pbr', pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], alpha], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 0.8 } };
      if (m.map) mat.pbrMetallicRoughness.baseColorTexture = texture(m.map, `${what}: map`);
      if (m.emissive) mat.emissiveFactor = m.emissive.slice(0, 3);
      if (m.emissiveMap) {
        mat.emissiveTexture = texture(m.emissiveMap, `${what}: emissiveMap`);
        mat.emissiveFactor ??= [1, 1, 1];
      }
      if (m.emissiveStrength !== undefined && m.emissiveStrength !== 1) {
        mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.emissiveStrength } };
        used.add('KHR_materials_emissive_strength');
      }
      const mode = m.alphaMode ?? (alpha < 1 ? 'BLEND' : 'OPAQUE');
      if (!['OPAQUE', 'MASK', 'BLEND'].includes(mode)) throw new Error(`glb: ${what}: alphaMode is 'OPAQUE', 'MASK' or 'BLEND'`);
      if (mode !== 'OPAQUE') mat.alphaMode = mode;
      if (mode === 'MASK' && m.alphaCutoff !== undefined) mat.alphaCutoff = m.alphaCutoff;
      if (m.doubleSided) mat.doubleSided = true;
      if (m.envMapIntensity !== undefined) mat.extras = { envMapIntensity: m.envMapIntensity };
    }
    json.materials.push(mat);
    materials.set(m, json.materials.length - 1);
    return json.materials.length - 1;
  };
  // the same material object, or the same name, or an equal description: one glTF material
  const keyed = new Map();
  const materialOf = (m, what) => {
    const key = typeof m === 'string' ? m : JSON.stringify(m, (k, v) => (v instanceof Uint8Array ? `#img${imageKey(v)}` : v));
    if (!keyed.has(key)) keyed.set(key, material(m, what));
    return keyed.get(key);
  };
  const imgKeys = new Map();
  const imageKey = (v) => { if (!imgKeys.has(v)) imgKeys.set(v, imgKeys.size); return imgKeys.get(v); };

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
    const vec = (a, k, what) => {
      if (!(a instanceof Float32Array) || a.length !== k * n) throw new Error(`glb: ${m.name}: ${what} must be a Float32Array of ${k} × ${n}`);
      return a;
    };
    if (m.normals) attributes.NORMAL = accessor(vec(m.normals, 3, 'normals'), ARRAY_BUFFER, FLOAT, 'VEC3', n);
    if (m.colors) {
      const k = m.colors.length / n, c = new Uint8Array(4 * n);
      if (k !== 3 && k !== 4) throw new Error(`glb: ${m.name}: colors must be rgb or rgba for each of the ${n} vertices`);
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) c[4 * i + j] = j < k ? Math.round(Math.min(1, Math.max(0, m.colors[k * i + j])) * 255) : 255;
      attributes.COLOR_0 = accessor(c, ARRAY_BUFFER, UNSIGNED_BYTE, 'VEC4', n, { normalized: true });
    }
    if (m.uvs) attributes.TEXCOORD_0 = accessor(vec(m.uvs, 2, 'uvs'), ARRAY_BUFFER, FLOAT, 'VEC2', n);
    if (m.uvs1) attributes.TEXCOORD_1 = accessor(vec(m.uvs1, 2, 'uvs1'), ARRAY_BUFFER, FLOAT, 'VEC2', n);
    const prim = { attributes, mode: 4, material: materialOf(m.material ?? 'fc:plaster', m.name) };
    if (m.indices) {
      const I = m.indices, big = I instanceof Uint32Array || n > 65535;
      for (let i = 0; i < I.length; i++) if (I[i] >= n) throw new Error(`glb: ${m.name}: index ${I[i]} past the ${n} vertices`);
      const idx = big ? (I instanceof Uint32Array ? I : Uint32Array.from(I)) : (I instanceof Uint16Array ? I : Uint16Array.from(I));
      prim.indices = accessor(idx, ELEMENT_ARRAY_BUFFER, big ? UNSIGNED_INT : UNSIGNED_SHORT, 'SCALAR', idx.length);
    }
    json.meshes.push({ name: m.name, primitives: [prim] });
    const node = { name: m.name, mesh: json.meshes.length - 1 };
    if (m.matrix) node.matrix = Array.from(m.matrix);
    if (m.instances) {
      node.extensions = { EXT_mesh_gpu_instancing: { attributes: instanceAttributes(m.instances, m.name, accessor) } };
      used.add('EXT_mesh_gpu_instancing');
    }
    json.nodes.push(node);
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  json.buffers.push({ byteLength: length });
  if (used.size) json.extensionsUsed = [...used];

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
  if (log) {
    const s = glbInfo(out);
    console.log(`${log}: ${s.draws} draws, ${s.triangles} triangles, ${s.images} image${s.images === 1 ? '' : 's'}, ${(s.bytes / 1024).toFixed(1)} KB`);
  }
  return out;
}

// the instances' TRANSLATION, ROTATION, SCALE accessors
function instanceAttributes(list, name, accessor) {
  if (!Array.isArray(list) || !list.length) throw new Error(`glb: ${name}: instances must be a list of { position, rotation | yaw, scale }`);
  const n = list.length, T = new Float32Array(3 * n), R = new Float32Array(4 * n), S = new Float32Array(3 * n);
  let rot = false, scl = false;
  list.forEach((q, i) => {
    const p = q.position ?? [0, 0, 0];
    if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error(`glb: ${name}: instance ${i}: position is 3 numbers`);
    T.set(p, 3 * i);
    let r = q.rotation;
    if (!r && q.yaw) r = [0, Math.sin(q.yaw / 2), 0, Math.cos(q.yaw / 2)];
    if (r) {
      const l = Math.hypot(...r);
      if (r.length !== 4 || !(l > 0)) throw new Error(`glb: ${name}: instance ${i}: rotation is a quaternion [x, y, z, w]`);
      R.set(r.map((v) => v / l), 4 * i);
      rot = true;
    } else R.set([0, 0, 0, 1], 4 * i);
    const s = q.scale === undefined ? [1, 1, 1] : typeof q.scale === 'number' ? [q.scale, q.scale, q.scale] : q.scale;
    if (s.length !== 3 || !s.every(Number.isFinite)) throw new Error(`glb: ${name}: instance ${i}: scale is a number or 3 numbers`);
    if (s.some((v) => v !== 1)) scl = true;
    S.set(s, 3 * i);
  });
  const a = { TRANSLATION: accessor(T, ARRAY_BUFFER, FLOAT, 'VEC3', n) };
  if (rot) a.ROTATION = accessor(R, ARRAY_BUFFER, FLOAT, 'VEC4', n);
  if (scl) a.SCALE = accessor(S, ARRAY_BUFFER, FLOAT, 'VEC3', n);
  return a;
}

function mimeOf(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

// the JSON chunk of a .glb
export function glbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glTF binary');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

// what drawing a .glb costs, counted as the host counts it (draws: a primitive 1, an instanced one too;
// triangles and vertices: once an instance)
export function glbInfo(bytes) {
  const j = glbJson(bytes);
  const acc = j.accessors ?? [];
  let draws = 0, triangles = 0, vertices = 0, instanced = 0;
  const count = (node) => node.extensions?.EXT_mesh_gpu_instancing ? acc[Object.values(node.extensions.EXT_mesh_gpu_instancing.attributes)[0]]?.count ?? 1 : 1;
  for (const node of j.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const k = count(node);
    if (k > 1) instanced++;
    for (const p of j.meshes[node.mesh].primitives) {
      draws += 1;
      const nv = acc[p.attributes.POSITION]?.count ?? 0;
      vertices += nv * k;
      triangles += Math.floor((p.indices !== undefined ? acc[p.indices].count : nv) / 3) * k;
    }
  }
  return { draws, triangles, vertices, images: (j.images ?? []).length, materials: (j.materials ?? []).map((m) => m.name), instanced, bytes: bytes.byteLength };
}
