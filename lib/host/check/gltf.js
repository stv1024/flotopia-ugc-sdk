// Copied from the game (floating-city src/ugc/check/gltf.js, 0095669) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md): a package's glTF binaries (the SDK's docs/abi.md 2.2, the limits of 2.5), checked before
// three's GLTFLoader sees them: the GLB container, the JSON's references and ranges, the extensions, the
// materials, the images' sizes (from their bytes), the node tree, and what drawing it costs.
//   checkGlb(bytes, { shell, near }) -> { ok, errors, stats }
//   stats: { triangles, vertices, draws (primitives x instances), materials: [names], images: [{ width, height }],
//            gpuBytes (accessors decompressed + textures x 4 x 4/3), bytes }
//   shell: the far look (LIMITS.shell*: one material, vertex colours, no images); near: the near look's limits
// Pure: no DOM, no Node, no three (the loader, the sandbox worker and the SDK's CLI use it). The bytes are hostile:
// nothing is allocated from a size in them, nothing recurses on their depth.
import { CITY_MATERIALS, GLTF_EXTENSIONS, LIMITS } from '../abi.js';
import { imageSize } from './image.js';

const MAX_ERRORS = 40;
const MAX_JSON_DEPTH = 64;
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const MESHOPT_MODES = ['ATTRIBUTES', 'TRIANGLES', 'INDICES'];
const MESHOPT_FILTERS = ['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'];
const MIME = { 'image/png': 'png', 'image/jpeg': 'jpeg' };

const mb = (n) => `${+(n / 2 ** 20).toFixed(2)} MB`;
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const isUint = (x) => Number.isSafeInteger(x) && x >= 0;
const isPos = (x) => Number.isSafeInteger(x) && x > 0;
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));

class Errs {
  constructor() { this.list = []; this.keys = new Set(); this.more = 0; }
  add(code, message, path, key) {
    if (key) {
      if (this.keys.has(key)) return;
      this.keys.add(key);
    }
    if (this.list.length >= MAX_ERRORS) return void this.more++;
    this.list.push(path ? { code, message, path } : { code, message });
  }
  out() {
    if (this.more) this.list.push({ code: 'E_GLTF_MORE', message: `${this.more} more errors are not listed. Fix the ones above first.` });
    return this.list;
  }
}

function elemSize(type, comp) {
  const c = COMP[comp];
  if (type === 'MAT2' || type === 'MAT3' || type === 'MAT4') {
    const rows = +type[3];
    return Math.ceil((c * rows) / 4) * 4 * rows; // the columns start on 4-byte boundaries
  }
  return c * NCOMP[type];
}

function asBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return null;
}

// the GLB container: { json (text), bin (Uint8Array | null) } or an error
function container(b, E) {
  const bad = (why) => void E.add('E_GLB_FORMAT', `The file is not a valid GLB (glTF 2.0 binary): ${why}. Export it as .glb (binary glTF 2.0, everything in one file).`);
  if (b.length < 20) return bad('it is too short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return bad('it does not start with "glTF"');
  if (dv.getUint32(4, true) !== 2) return bad(`its version is ${dv.getUint32(4, true)}, not 2`);
  if (dv.getUint32(8, true) !== b.length) return bad(`its header says ${dv.getUint32(8, true)} bytes, the file has ${b.length}`);
  const len0 = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) return bad('its first chunk is not JSON');
  if (len0 > b.length - 20) return bad('its JSON chunk runs past the end');
  const json = b.subarray(20, 20 + len0);
  let p = 20 + len0, bin = null;
  if (p < b.length) {
    if (b.length - p < 8) return bad('it has bytes after the JSON chunk that are not a chunk');
    const len1 = dv.getUint32(p, true);
    if (dv.getUint32(p + 4, true) !== 0x004e4942) return bad('its second chunk is not BIN');
    if (len1 > b.length - p - 8) return bad('its BIN chunk runs past the end');
    bin = b.subarray(p + 8, p + 8 + len1);
    p += 8 + len1;
  }
  if (p !== b.length) return bad('it has more than a JSON and a BIN chunk');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(json);
  } catch {
    E.add('E_GLTF_JSON', 'The JSON chunk is not UTF-8 text.');
    return null;
  }
  return { text, bin };
}

// the nesting of a JSON text (outside strings), stopping past the cap
function jsonDepth(s, cap) {
  let d = 0, max = 0, str = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (str) {
      if (c === 92) i++; // backslash
      else if (c === 34) str = false;
    } else if (c === 34) str = true;
    else if (c === 91 || c === 123) {
      if (++d > max && (max = d) > cap) return max;
    } else if (c === 93 || c === 125) d--;
  }
  return max;
}

export function checkGlb(bytes, { shell = false, near = true } = {}) {
  const E = new Errs();
  const stats = { triangles: 0, vertices: 0, draws: 0, materials: [], images: [], gpuBytes: 0, bytes: 0 };
  const done = () => {
    const errors = E.out();
    return { ok: !errors.length, errors, stats };
  };
  const b = asBytes(bytes);
  if (!b) {
    E.add('E_GLB_FORMAT', 'The glTF file is not bytes (an ArrayBuffer or a Uint8Array).');
    return done();
  }
  stats.bytes = b.length;
  const cap = shell ? LIMITS.shellBytes : LIMITS.nearBytes;
  if (b.length > cap) {
    E.add('E_GLB_SIZE', `The ${shell ? 'shell' : 'near look'} is ${mb(b.length)}; the limit is ${mb(cap)} (docs/abi.md 2.5). ${shell ? 'Simplify it (fewer triangles, no textures).' : 'Compress it (gltfpack -cc: meshopt, quantization) and use smaller textures.'}`);
    return done();
  }
  const c = container(b, E);
  if (!c) return done();
  if (jsonDepth(c.text, MAX_JSON_DEPTH) > MAX_JSON_DEPTH) {
    E.add('E_GLTF_JSON', `The JSON is nested more than ${MAX_JSON_DEPTH} deep. A glTF exporter does not write that; re-export the file.`);
    return done();
  }
  let g;
  try {
    g = JSON.parse(c.text);
  } catch (e) {
    E.add('E_GLTF_JSON', `The JSON chunk does not parse: ${e.message}. Re-export the file.`);
    return done();
  }
  if (!isObj(g)) {
    E.add('E_GLTF_JSON', 'The JSON is not an object. Re-export the file.');
    return done();
  }
  try {
    checkJson(g, c.bin, E, stats, shell);
  } catch (e) {
    E.add('E_GLTF_JSON', `The glTF could not be checked (${e && e.message}). Re-export the file with a standard exporter.`);
    return done();
  }
  if (near) {
    if (stats.triangles > LIMITS.nearTris) E.add('E_GLTF_TRIS', `It draws ${stats.triangles} triangles; the near look may have at most ${LIMITS.nearTris} (docs/abi.md 2.5). Simplify the meshes or use a coarser LOD.`);
    if (stats.draws > LIMITS.nearDraws) E.add('E_GLTF_DRAWS', `It makes ${stats.draws} draw calls (primitives x instances); the near look may have at most ${LIMITS.nearDraws}. Merge meshes that share a material (one primitive per material), or use EXT_mesh_gpu_instancing for repeated meshes.`);
  }
  if (stats.gpuBytes > LIMITS.nearGpu) E.add('E_GLTF_GPU', `It needs about ${mb(stats.gpuBytes)} of GPU memory (vertex data decompressed, textures with mipmaps); the limit is ${mb(LIMITS.nearGpu)}. Quantize the vertices (KHR_mesh_quantization), use smaller textures.`);
  return done();
}

function checkJson(g, bin, E, stats, shell) {
  const list = (k) => {
    if (g[k] === undefined) return [];
    if (Array.isArray(g[k])) return g[k];
    E.add('E_GLTF_JSON', `"${k}" is not an array.`, k);
    return [];
  };
  const buffers = list('buffers'), views = list('bufferViews'), accessors = list('accessors'), meshes = list('meshes');
  const nodes = list('nodes'), scenes = list('scenes'), materials = list('materials'), textures = list('textures');
  const images = list('images'), samplers = list('samplers'), skins = list('skins'), animations = list('animations');
  const cameras = list('cameras');
  // a reference to an item of a list
  const ref = (v, arr, path, what) => {
    if (Number.isInteger(v) && v >= 0 && v < arr.length) return true;
    E.add('E_GLTF_INDEX', `${path} is ${JSON.stringify(v)}, not the index of one of the ${arr.length} ${what}. Re-export the file.`, path);
    return false;
  };
  const opt = (v, arr, path, what) => v === undefined || ref(v, arr, path, what);

  if (!isObj(g.asset) || g.asset.version !== '2.0') E.add('E_GLTF_ASSET', 'asset.version is not "2.0": only glTF 2.0 is read.', 'asset.version');

  // the extensions: declared, and every "extensions" object anywhere
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    const a = g[k];
    if (a === undefined) continue;
    if (!Array.isArray(a)) {
      E.add('E_GLTF_JSON', `"${k}" is not an array.`, k);
      continue;
    }
    for (const x of a) {
      if (!GLTF_EXTENSIONS.includes(x)) extension(E, x, k);
    }
  }
  {
    const stack = [g];
    while (stack.length) {
      const o = stack.pop();
      if (Array.isArray(o)) {
        for (const x of o) if (typeof x === 'object' && x !== null) stack.push(x);
        continue;
      }
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v !== 'object' || v === null) continue;
        if (k === 'extensions' && isObj(v)) {
          for (const x of Object.keys(v)) if (!GLTF_EXTENSIONS.includes(x)) extension(E, x, 'extensions');
        }
        if (k !== 'extras') stack.push(v);
      }
    }
  }

  // buffers: buffer 0 is the BIN chunk; EXT_meshopt_compression's fallback buffers have no bytes of their own
  const fallback = new Set();
  const bufLen = [];
  buffers.forEach((buf, i) => {
    const path = `buffers[${i}]`;
    bufLen[i] = 0;
    if (!isObj(buf)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (!isPos(buf.byteLength)) E.add('E_GLTF_BUFFER', `${path}.byteLength is not a positive integer.`, path);
    const mo = isObj(buf.extensions) && isObj(buf.extensions.EXT_meshopt_compression) ? buf.extensions.EXT_meshopt_compression : null;
    if (mo && mo.fallback === true) return void fallback.add(i);
    if (buf.uri !== undefined) {
      return void E.add('E_GLTF_URI', `${path} has a uri: everything must be in the GLB's BIN chunk (no other files, no data: URIs). Export as a single .glb.`, path);
    }
    if (i !== 0 || !bin) return void E.add('E_GLTF_BUFFER', `${path} has no uri and is not the BIN chunk (only buffer 0 can be). Export as a single .glb.`, path);
    if (buf.byteLength > bin.length) return void E.add('E_GLTF_BUFFER', `${path}.byteLength is ${buf.byteLength}, the BIN chunk has ${bin.length} bytes.`, path);
    bufLen[i] = buf.byteLength;
  });

  // buffer views; for a meshopt-compressed one, its own sizes are the decompressed data's
  const viewOf = [];
  let decoded = 0;
  views.forEach((v, i) => {
    const path = `bufferViews[${i}]`;
    viewOf[i] = null;
    if (!isObj(v)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (!ref(v.buffer, buffers, `${path}.buffer`, 'buffers')) return;
    const off = v.byteOffset === undefined ? 0 : v.byteOffset, len = v.byteLength;
    if (!isUint(off) || !isPos(len)) return void E.add('E_GLTF_BUFFER', `${path} has a bad byteOffset or byteLength.`, path);
    if (v.byteStride !== undefined && !(Number.isInteger(v.byteStride) && v.byteStride >= 4 && v.byteStride <= 252 && v.byteStride % 4 === 0)) {
      return void E.add('E_GLTF_BUFFER', `${path}.byteStride is ${JSON.stringify(v.byteStride)}; it must be a multiple of 4 from 4 to 252.`, path);
    }
    const mo = isObj(v.extensions) && isObj(v.extensions.EXT_meshopt_compression) ? v.extensions.EXT_meshopt_compression : null;
    if (mo) {
      const mp = `${path}.extensions.EXT_meshopt_compression`;
      if (!ref(mo.buffer, buffers, `${mp}.buffer`, 'buffers')) return;
      const mOff = mo.byteOffset === undefined ? 0 : mo.byteOffset;
      if (fallback.has(mo.buffer) || !bufLen[mo.buffer]) return void E.add('E_GLTF_BUFFER', `${mp}.buffer is not the BIN chunk.`, mp);
      if (!isUint(mOff) || !isPos(mo.byteLength) || mOff + mo.byteLength > bufLen[mo.buffer]) {
        return void E.add('E_GLTF_BUFFER', `${mp}: the compressed bytes (byteOffset ${mOff}, byteLength ${mo.byteLength}) are not within the BIN chunk (${bufLen[mo.buffer]} bytes).`, mp);
      }
      if (!isPos(mo.count) || !isPos(mo.byteStride) || !MESHOPT_MODES.includes(mo.mode) || (mo.filter !== undefined && !MESHOPT_FILTERS.includes(mo.filter))) {
        return void E.add('E_GLTF_BUFFER', `${mp} has a bad count, byteStride, mode or filter.`, mp);
      }
      const strideOk = mo.mode === 'ATTRIBUTES' ? mo.byteStride % 4 === 0 && mo.byteStride <= 256 : mo.byteStride === 2 || mo.byteStride === 4;
      if (!strideOk || (mo.mode === 'TRIANGLES' && mo.count % 3)) return void E.add('E_GLTF_BUFFER', `${mp}: byteStride ${mo.byteStride} or count ${mo.count} does not fit the mode ${mo.mode}.`, mp);
      if (mo.count * mo.byteStride < len) {
        return void E.add('E_GLTF_BUFFER', `${path}: the decompressed data (count ${mo.count} x byteStride ${mo.byteStride}) is shorter than the view.`, path);
      }
      decoded += mo.count * mo.byteStride;
    } else if (fallback.has(v.buffer)) {
      return void E.add('E_GLTF_BUFFER', `${path} reads a fallback buffer (EXT_meshopt_compression) but is not compressed.`, path);
    } else if (off + len > bufLen[v.buffer]) {
      return void E.add('E_GLTF_BUFFER', `${path} (byteOffset ${off}, byteLength ${len}) runs past its buffer (${bufLen[v.buffer]} bytes).`, path);
    }
    viewOf[i] = { off, len, stride: v.byteStride || 0, raw: !mo };
  });
  if (decoded > LIMITS.nearGpu) E.add('E_GLTF_GPU', `The meshopt-compressed views decompress to ${mb(decoded)}; the limit is ${mb(LIMITS.nearGpu)}.`, 'bufferViews');

  // accessors: within their views
  const accCount = [];
  let gpu = 0;
  const within = (viewIdx, off, stride, count, es, path) => {
    if (!ref(viewIdx, views, `${path}.bufferView`, 'buffer views')) return false;
    const v = viewOf[viewIdx];
    if (!v) return false;
    if (!isUint(off)) return void E.add('E_GLTF_ACCESSOR', `${path}.byteOffset is not a non-negative integer.`, path);
    const s = stride || v.stride || es;
    if (s < es) return void E.add('E_GLTF_ACCESSOR', `${path}: its view's byteStride (${s}) is smaller than an element (${es} bytes).`, path);
    const end = off + s * (count - 1) + es;
    if (end > v.len) return void E.add('E_GLTF_ACCESSOR', `${path} reads up to byte ${end} of its buffer view, which has ${v.len} bytes. Re-export the file.`, path);
    return true;
  };
  accessors.forEach((a, i) => {
    const path = `accessors[${i}]`;
    accCount[i] = 0;
    if (!isObj(a)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (!Object.hasOwn(COMP, a.componentType) || !Object.hasOwn(NCOMP, a.type) || !isPos(a.count)) {
      return void E.add('E_GLTF_ACCESSOR', `${path} has a bad componentType, type or count.`, path);
    }
    const es = elemSize(a.type, a.componentType);
    if (a.bufferView !== undefined) within(a.bufferView, a.byteOffset === undefined ? 0 : a.byteOffset, 0, a.count, es, path);
    if (a.sparse !== undefined) {
      const s = a.sparse, sp = `${path}.sparse`;
      if (!isObj(s) || !isPos(s.count) || s.count > a.count || !isObj(s.indices) || !isObj(s.values) || ![5121, 5123, 5125].includes(s.indices.componentType)) {
        E.add('E_GLTF_ACCESSOR', `${sp} is not a valid sparse accessor.`, sp);
      } else {
        within(s.indices.bufferView, s.indices.byteOffset === undefined ? 0 : s.indices.byteOffset, COMP[s.indices.componentType], s.count, COMP[s.indices.componentType], `${sp}.indices`);
        within(s.values.bufferView, s.values.byteOffset === undefined ? 0 : s.values.byteOffset, es, s.count, es, `${sp}.values`);
      }
    }
    accCount[i] = a.count;
    gpu += a.count * es;
  });

  // meshes
  const countOf = (v) => (Number.isInteger(v) && v >= 0 && v < accCount.length ? accCount[v] : 0);
  let allColor = true;
  const meshInfo = meshes.map((mesh, i) => {
    const path = `meshes[${i}]`;
    const info = { tris: 0, verts: 0, prims: 0 };
    if (!isObj(mesh) || !Array.isArray(mesh.primitives) || !mesh.primitives.length) {
      E.add('E_GLTF_JSON', `${path} has no primitives.`, path);
      return info;
    }
    mesh.primitives.forEach((p, j) => {
      const pp = `${path}.primitives[${j}]`;
      if (!isObj(p) || !isObj(p.attributes)) return void E.add('E_GLTF_JSON', `${pp} has no attributes.`, pp);
      info.prims++;
      for (const [k, v] of Object.entries(p.attributes)) ref(v, accessors, `${pp}.attributes.${k}`, 'accessors');
      if (p.attributes.COLOR_0 === undefined) allColor = false;
      opt(p.indices, accessors, `${pp}.indices`, 'accessors');
      opt(p.material, materials, `${pp}.material`, 'materials');
      if (p.mode !== undefined && !(Number.isInteger(p.mode) && p.mode >= 0 && p.mode <= 6)) E.add('E_GLTF_JSON', `${pp}.mode is not 0-6.`, pp);
      if (p.targets !== undefined) {
        if (!Array.isArray(p.targets)) E.add('E_GLTF_JSON', `${pp}.targets is not an array.`, pp);
        else p.targets.forEach((t, k) => {
          if (!isObj(t)) return void E.add('E_GLTF_JSON', `${pp}.targets[${k}] is not an object.`, pp);
          for (const [n, v] of Object.entries(t)) ref(v, accessors, `${pp}.targets[${k}].${n}`, 'accessors');
        });
      }
      const verts = countOf(p.attributes.POSITION);
      const n = p.indices === undefined ? verts : countOf(p.indices);
      const mode = p.mode === undefined ? 4 : p.mode;
      info.verts += verts;
      info.tris += mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
    });
    return info;
  });

  // nodes: a tree (one parent each, no cycles), not too deep; finite transforms; instancing
  const parent = new Int32Array(nodes.length).fill(-1);
  const inst = new Float64Array(nodes.length).fill(1);
  nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!isObj(n)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) E.add('E_GLTF_JSON', `${path}.children is not an array.`, path);
      else for (const c of n.children) {
        if (!ref(c, nodes, `${path}.children`, 'nodes')) continue;
        if (parent[c] !== -1) E.add('E_GLTF_NODE', `nodes[${c}] is a child of two nodes (or twice of one): the nodes must form trees. Re-export the file.`, `nodes[${c}]`);
        else parent[c] = i;
      }
    }
    if (n.matrix !== undefined && !finite(n.matrix, 16)) E.add('E_GLTF_NODE', `${path}.matrix is not 16 finite numbers.`, path);
    if (n.translation !== undefined && !finite(n.translation, 3)) E.add('E_GLTF_NODE', `${path}.translation is not 3 finite numbers.`, path);
    if (n.rotation !== undefined && !finite(n.rotation, 4)) E.add('E_GLTF_NODE', `${path}.rotation is not 4 finite numbers.`, path);
    if (n.scale !== undefined && !finite(n.scale, 3)) E.add('E_GLTF_NODE', `${path}.scale is not 3 finite numbers.`, path);
    if (n.weights !== undefined && !(Array.isArray(n.weights) && n.weights.every(Number.isFinite))) E.add('E_GLTF_NODE', `${path}.weights are not finite numbers.`, path);
    opt(n.mesh, meshes, `${path}.mesh`, 'meshes');
    opt(n.skin, skins, `${path}.skin`, 'skins');
    opt(n.camera, cameras, `${path}.camera`, 'cameras');
    const gi = isObj(n.extensions) ? n.extensions.EXT_mesh_gpu_instancing : undefined;
    if (gi !== undefined) {
      const gp = `${path}.extensions.EXT_mesh_gpu_instancing`;
      if (!isObj(gi) || !isObj(gi.attributes) || !Object.keys(gi.attributes).length) return void E.add('E_GLTF_JSON', `${gp} has no attributes.`, gp);
      let count = -1;
      for (const [k, v] of Object.entries(gi.attributes)) {
        if (!ref(v, accessors, `${gp}.attributes.${k}`, 'accessors')) continue;
        if (count >= 0 && accCount[v] !== count) E.add('E_GLTF_NODE', `${gp}: the attributes have different counts.`, gp);
        count = Math.max(count, accCount[v]);
      }
      if (count > 0) inst[i] = count;
    }
  });
  {
    const depth = new Int32Array(nodes.length);
    const queue = [];
    for (let i = 0; i < nodes.length; i++) if (parent[i] === -1) { depth[i] = 1; queue.push(i); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (depth[i] > LIMITS.nodeDepth) E.add('E_GLTF_NODE', `The node tree is more than ${LIMITS.nodeDepth} deep (at nodes[${i}]). Flatten the hierarchy.`, `nodes[${i}]`, 'depth');
      const ch = isObj(nodes[i]) && Array.isArray(nodes[i].children) ? nodes[i].children : [];
      for (const c of ch) {
        if (Number.isInteger(c) && parent[c] === i && !depth[c]) {
          depth[c] = depth[i] + 1;
          queue.push(c);
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!depth[i]) E.add('E_GLTF_NODE', `nodes[${i}] is in a cycle (a node is its own ancestor). Re-export the file.`, `nodes[${i}]`, 'cycle');
    }
  }
  nodes.forEach((n, i) => {
    if (!isObj(n) || !Number.isInteger(n.mesh) || !meshInfo[n.mesh]) return;
    const m = meshInfo[n.mesh];
    stats.draws += m.prims * inst[i];
    stats.triangles += m.tris * inst[i];
    stats.vertices += m.verts * inst[i];
  });

  scenes.forEach((s, i) => {
    const path = `scenes[${i}]`;
    if (!isObj(s)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (s.nodes !== undefined) {
      if (!Array.isArray(s.nodes)) E.add('E_GLTF_JSON', `${path}.nodes is not an array.`, path);
      else s.nodes.forEach((x, j) => ref(x, nodes, `${path}.nodes[${j}]`, 'nodes'));
    }
  });
  opt(g.scene, scenes, 'scene', 'scenes');

  skins.forEach((s, i) => {
    const path = `skins[${i}]`;
    if (!isObj(s) || !Array.isArray(s.joints)) return void E.add('E_GLTF_JSON', `${path} has no joints.`, path);
    s.joints.forEach((x, j) => ref(x, nodes, `${path}.joints[${j}]`, 'nodes'));
    opt(s.skeleton, nodes, `${path}.skeleton`, 'nodes');
    opt(s.inverseBindMatrices, accessors, `${path}.inverseBindMatrices`, 'accessors');
  });
  animations.forEach((a, i) => {
    const path = `animations[${i}]`;
    if (!isObj(a) || !Array.isArray(a.samplers) || !Array.isArray(a.channels)) return void E.add('E_GLTF_JSON', `${path} has no samplers or channels.`, path);
    a.samplers.forEach((s, j) => {
      if (!isObj(s)) return void E.add('E_GLTF_JSON', `${path}.samplers[${j}] is not an object.`, path);
      ref(s.input, accessors, `${path}.samplers[${j}].input`, 'accessors');
      ref(s.output, accessors, `${path}.samplers[${j}].output`, 'accessors');
    });
    a.channels.forEach((c, j) => {
      if (!isObj(c) || !isObj(c.target)) return void E.add('E_GLTF_JSON', `${path}.channels[${j}] has no target.`, path);
      ref(c.sampler, a.samplers, `${path}.channels[${j}].sampler`, 'samplers');
      opt(c.target.node, nodes, `${path}.channels[${j}].target.node`, 'nodes');
    });
  });

  // materials: fc:<name> is one of the city's
  materials.forEach((mat, i) => {
    const path = `materials[${i}]`;
    if (!isObj(mat)) {
      stats.materials.push('');
      return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    }
    const name = typeof mat.name === 'string' ? mat.name : '';
    stats.materials.push(name);
    if (name.startsWith('fc:') && !CITY_MATERIALS.includes(name.slice(3))) {
      E.add('E_GLTF_MATERIAL', `${path} is named ${JSON.stringify(name)}, but ${JSON.stringify(name.slice(3))} is not one of the city's materials (${CITY_MATERIALS.join(', ')}; docs/abi.md 2.2). Use one of them, or a name without "fc:" for a PBR material of your own.`, path);
    }
    const tex = (t, p) => {
      if (t === undefined) return;
      if (!isObj(t)) return void E.add('E_GLTF_JSON', `${p} is not an object.`, p);
      ref(t.index, textures, `${p}.index`, 'textures');
    };
    const pbr = isObj(mat.pbrMetallicRoughness) ? mat.pbrMetallicRoughness : {};
    tex(pbr.baseColorTexture, `${path}.pbrMetallicRoughness.baseColorTexture`);
    tex(pbr.metallicRoughnessTexture, `${path}.pbrMetallicRoughness.metallicRoughnessTexture`);
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) tex(mat[k], `${path}.${k}`);
  });
  textures.forEach((t, i) => {
    const path = `textures[${i}]`;
    if (!isObj(t)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    opt(t.source, images, `${path}.source`, 'images');
    opt(t.sampler, samplers, `${path}.sampler`, 'samplers');
  });

  // images: in the BIN chunk, PNG or JPEG, their size from their bytes
  let tex = 0;
  images.forEach((im, i) => {
    const path = `images[${i}]`;
    if (!isObj(im)) return void E.add('E_GLTF_JSON', `${path} is not an object.`, path);
    if (im.uri !== undefined) return void E.add('E_GLTF_URI', `${path} has a uri: images must be in the GLB's BIN chunk (bufferView and mimeType). Export as a single .glb with embedded images.`, path);
    if (!ref(im.bufferView, views, `${path}.bufferView`, 'buffer views')) return;
    const v = viewOf[im.bufferView];
    if (!v || !v.raw) return void E.add('E_GLTF_IMAGE', `${path}'s buffer view is not plain bytes of the BIN chunk.`, path);
    const s = imageSize(bin.subarray(v.off, v.off + v.len));
    if (!s || MIME[im.mimeType] !== s.type) {
      return void E.add('E_GLTF_IMAGE', `${path} is not a PNG or JPEG that matches its mimeType (${JSON.stringify(im.mimeType)}). Use PNG or JPEG images (KTX2 and WebP are not allowed).`, path);
    }
    if (s.width > LIMITS.textureSize || s.height > LIMITS.textureSize) {
      E.add('E_GLTF_IMAGE', `${path} is ${s.width} x ${s.height}; images may be at most ${LIMITS.textureSize} x ${LIMITS.textureSize} (docs/abi.md 2.5). Scale it down.`, path);
    }
    stats.images.push({ width: s.width, height: s.height });
    tex += (s.width * s.height * 4 * 4) / 3;
  });
  stats.gpuBytes = Math.round(gpu + tex);

  if (shell) {
    if (stats.triangles > LIMITS.shellTris) E.add('E_GLTF_SHELL', `The shell draws ${stats.triangles} triangles; it may have at most ${LIMITS.shellTris} (docs/abi.md 2.1). Simplify it (it is seen from far away).`, 'shell');
    if (materials.length > 1) E.add('E_GLTF_SHELL', `The shell has ${materials.length} materials; it may have one. Merge them and put the colours in COLOR_0.`, 'materials');
    if (images.length || textures.length) E.add('E_GLTF_SHELL', 'The shell has textures; it may have none. Bake the colours into the vertex colours (COLOR_0).', 'images');
    if (!allColor) E.add('E_GLTF_SHELL', 'A primitive of the shell has no vertex colours (COLOR_0). Give every primitive vertex colours: the shell has no textures.', 'meshes');
  }
}

function extension(E, name, path) {
  E.add('E_GLTF_EXTENSION', `The extension ${JSON.stringify(String(name))} is not allowed. Allowed: ${GLTF_EXTENSIONS.join(', ')} (docs/abi.md 2.2). Export without it (e.g. textures as PNG/JPEG, not KTX2/WebP; materials as plain PBR).`, path, `ext:${name}`);
}
