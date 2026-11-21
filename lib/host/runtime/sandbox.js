// Copied from the game (floating-city src/ugc/runtime/sandbox.js, 43a3be3) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md「运行时代码」): the sandbox itself, without the worker around it. The package's wasm, metered
// (check/wasm.js: fuel), with the imports of the host interface (abi.js IMPORTS) and nothing else. Every call is
// checked here — its arguments, the capability it needs, the island's limits — and gets its id at once; what it
// asks for comes out as a list of commands after each call of the module (runtime/host.js makes the meshes). The
// module can reach nothing but these imports: no network, no DOM, no clock, no other memory.
// Used by the game's worker (worker.js) and by the SDK's `check` (Node): the same code, so what passes on a
// creator's computer is what the game does. No DOM, no Node built-ins.
//
// const box = sandbox({ wasm, seed, caps, files: { path: { bytes, w?, h? } }, shaders: { path: text }, screen })
//   box.init()       -> { cmds, transfer, used, logs, budget }, or null (box.fatal: why it cannot run); throws: a trap
//   box.tick(inbox)  -> the same (inbox: an ArrayBuffer of INBOX_BYTES); throws: a trap
import { IMPORTS, EXPORTS, CAP_OF, CAPS, INBOX_BYTES, FUEL, ERR, LIMITS, HOST_UNIFORMS, UNIFORM_TYPES, CITY_MATERIALS } from '../abi.js';
import { inspectWasm, meterWasm } from '../check/wasm.js';
import { checkGlsl } from '../check/glsl.js';

export function sandbox(m) {
  return {
    fatal: null,
    init() {
      W = null;
      const r = init(m);
      if (r) { this.fatal = r; return null; }
      return out();
    },
    tick(inbox) {
      tick(inbox);
      return out();
    },
    fuelLeft() {
      return W?.fuel ? W.fuel() : null;
    },
  };
}

let W = null; // the world of the sandbox, after init (one sandbox a worker, a Node run)

// ------------------------------------------------------------------ init

function init(m) {
  const bytes = new Uint8Array(m.wasm);
  if (bytes.length > LIMITS.runtimeBytes) return `island.wasm: ${bytes.length} bytes, more than ${LIMITS.runtimeBytes}`;
  const r = inspectWasm(bytes);
  if (!r.ok) return `island.wasm: ${r.errors.map((q) => `${q.code} ${q.message}`).join('; ')}`;
  let metered;
  try { metered = meterWasm(bytes, { init: FUEL.init, exportName: 'fc_fuel' }); } catch (e) { return `island.wasm: metering: ${e.message}`; }
  W = makeWorld(m);
  const mod = new WebAssembly.Module(metered);
  const inst = new WebAssembly.Instance(mod, imports());
  const ex = inst.exports;
  for (const k of Object.keys(EXPORTS)) if (typeof ex[k] !== 'function') return `island.wasm: no export ${k}`;
  W.ex = ex;
  W.memory = ex.memory;
  W.fuelG = ex.fc_fuel;
  W.fuel = () => Number(W.fuelG.value);
  W.fuelG.value = BigInt(FUEL.init);
  W.inbox = ex.fc_alloc(INBOX_BYTES) >>> 0;
  if (!inRange(W.inbox, INBOX_BYTES)) return `fc_alloc(${INBOX_BYTES}) gave ${W.inbox}, not memory of the module`;
  W.fuelG.value = BigInt(FUEL.init);
  W.budgetOf = FUEL.init;
  ex.fc_init(m.seed | 0);
  return null;
}

function tick(inbox) {
  const n = Math.min(inbox.byteLength, INBOX_BYTES);
  new Uint8Array(W.memory.buffer, W.inbox, n).set(new Uint8Array(inbox, 0, n));
  W.upload = 0;
  W.fuelG.value = BigInt(FUEL.tick);
  W.budgetOf = FUEL.tick;
  W.ex.fc_tick(W.inbox, n);
}

// what the last call made (and the fuel it used): taken out
function out() {
  const { cmds, transfer, logs } = W;
  const r = { cmds, transfer, logs, used: W.budgetOf - W.fuel(), budget: budget() };
  W.cmds = [];
  W.transfer = [];
  W.logs = [];
  return r;
}

function budget() {
  return { draws: W.draws, tris: W.tris, gpu: W.gpu, targets: W.targetCount };
}

// ------------------------------------------------------------------ the world: ids, limits

function makeWorld(m) {
  return {
    seed: m.seed | 0,
    caps: new Set((m.caps ?? []).filter((c) => CAPS.includes(c))),
    files: m.files ?? {},
    shaders: m.shaders ?? {},
    screen: m.screen ?? [1920, 1080],
    next: 1,
    kind: new Map(), // id → 'buffer' | 'geometry' | 'material' | 'texture' | 'target' | 'mesh' | 'pass' | 'act'
    buffers: new Map(), // id → { bytes, dynamic, uses: 0 }
    geos: new Map(), // id → { tris, count, attrs: { name: { buffer, bytes } }, gpu }
    mats: new Map(), // id → { shader: bool, uniforms: { name: type }, layerOk }
    meshes: new Map(), // id → { geo, layer, inPass }
    targets: new Map(),
    passes: new Map(),
    acts: new Set(),
    textures: new Set(),
    draws: 0, tris: 0, gpu: 0, upload: 0, targetCount: 0, targetPixels: 0,
    cmds: [], transfer: [], logs: [], logTimes: [],
    focus: false,
  };
}

const err = (code, what) => {
  log(`error ${code}: ${what}`);
  return code;
};

function log(text) {
  const now = performance.now();
  const T = W.logTimes;
  while (T.length && now - T[0] > 1000) T.shift();
  if (T.length >= LIMITS.logsPerSecond) return;
  T.push(now);
  W.logs.push(String(text).slice(0, 500));
}

function newId(kind) {
  const id = W.next++;
  W.kind.set(id, kind);
  return id;
}

const isKind = (id, kind) => W.kind.get(id) === kind;

function need(name) {
  const cap = CAP_OF[name];
  return !cap || W.caps.has(cap) ? 0 : cap;
}

// ------------------------------------------------------------------ reading the module's memory

function inRange(ptr, len) {
  return Number.isInteger(ptr) && Number.isInteger(len) && ptr >= 0 && len >= 0 && ptr + len <= W.memory.buffer.byteLength;
}

function bytesAt(ptr, len) {
  ptr >>>= 0;
  len |= 0;
  if (!inRange(ptr, len)) return null;
  return new Uint8Array(W.memory.buffer, ptr, len);
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
function str(ptr, len, max = 64 * 1024) {
  if ((len | 0) > max) return null;
  const b = bytesAt(ptr, len);
  return b ? utf8.decode(b) : null;
}

function json(ptr, len) {
  const s = str(ptr, len);
  if (s === null) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function floats(ptr, n) {
  const b = bytesAt(ptr, n * 4);
  if (!b) return null;
  const out = new Float32Array(n);
  new Uint8Array(out.buffer).set(b);
  for (const v of out) if (!Number.isFinite(v)) return null;
  return out;
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const finArr = (a, n) => Array.isArray(a) && a.length === n && a.every(fin);
const text2 = (t, max = 40) => t && typeof t.zh === 'string' && typeof t.en === 'string' && t.zh.length && t.en.length && t.zh.length <= max && t.en.length <= max;

// ------------------------------------------------------------------ the imports

function imports() {
  const fc = {};
  const wrap = (name, fn) => {
    const [, res] = IMPORTS[`fc.${name}`];
    return (...a) => {
      const cap = need(`fc.${name}`);
      if (cap) {
        const r = err(ERR.CAP, `${name}: needs the "${cap}" capability (runtime.caps)`);
        return res === 'i' ? r : undefined;
      }
      return fn(...a);
    };
  };
  for (const [k, fn] of Object.entries(CALLS)) fc[k] = wrap(k, fn);
  const env = {
    abort(msg, file, line, col) {
      throw new Error(`abort: ${asString(msg) ?? '?'} at ${asString(file) ?? '?'}:${line}:${col}`);
    },
    trace(msg, n, ...a) {
      log(`trace: ${asString(msg) ?? ''} ${a.slice(0, n).join(', ')}`);
    },
    seed() {
      return W.seed;
    },
  };
  return { fc, env };
}

// an AssemblyScript string (UTF-16; its byte length 4 bytes before it)
function asString(ptr) {
  ptr >>>= 0;
  if (!ptr || !inRange(ptr - 4, 4)) return null;
  const n = new DataView(W.memory.buffer).getUint32(ptr - 4, true);
  if (n > 2000 || !inRange(ptr, n)) return null;
  return String.fromCharCode(...new Uint16Array(W.memory.buffer.slice(ptr, ptr + (n & ~1))));
}

const ATTR_TYPES = { f32: 4, u8: 1, u8n: 1, i8n: 1, u16: 2, u16n: 2, u32: 4 };
const LAYERS = ['scene', 'noReflect', 'refract', 'pass'];
const FORMATS = { r16f: 2, rgba8: 4, rgba16f: 8 };
const KEYS = /^(Key[A-Z]|Digit[0-9]|Space|Enter|Backspace|Tab|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Comma|Period|Slash|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Backquote|Backslash)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const CALLS = {
  log(ptr, len) {
    const s = str(ptr, len, 2000);
    if (s !== null) log(s);
  },

  buffer(ptr, len, dynamic) {
    const b = bytesAt(ptr, len);
    if (!b) return err(ERR.ARGS, 'buffer: not in memory');
    if (W.gpu + len > LIMITS.runGpu) return err(ERR.LIMIT, `buffer: GPU memory ${W.gpu + len} > ${LIMITS.runGpu}`);
    const id = newId('buffer'), copy = b.slice().buffer;
    W.buffers.set(id, { bytes: len, dynamic: !!dynamic });
    W.cmds.push({ op: 'buffer', id, bytes: copy, dynamic: !!dynamic });
    W.transfer.push(copy);
    return id;
  },

  buffer_write(id, offset, ptr, len) {
    const B = W.buffers.get(id);
    if (!B || !isKind(id, 'buffer')) return void err(ERR.MISSING, `buffer_write: no buffer ${id}`);
    if (!B.dynamic) return void err(ERR.ARGS, `buffer_write: buffer ${id} is not dynamic`);
    if (offset < 0 || len < 0 || offset + len > B.bytes) return void err(ERR.ARGS, `buffer_write: ${offset}+${len} past the buffer's ${B.bytes} bytes`);
    if (W.upload + len > LIMITS.uploadTick) return void err(ERR.LIMIT, `buffer_write: ${W.upload + len} bytes this tick > ${LIMITS.uploadTick}`);
    const b = bytesAt(ptr, len);
    if (!b) return void err(ERR.ARGS, 'buffer_write: not in memory');
    W.upload += len;
    const copy = b.slice().buffer;
    W.cmds.push({ op: 'write', id, offset, bytes: copy });
    W.transfer.push(copy);
  },

  geometry(ptr, len) {
    const d = json(ptr, len);
    if (!d || typeof d.attributes !== 'object') return err(ERR.ARGS, 'geometry: bad JSON');
    const attrs = {};
    let count = -1, gpu = 0;
    const view = (a, what, isIndex) => {
      const B = W.buffers.get(a?.buffer);
      if (!B || !isKind(a.buffer, 'buffer')) return `${what}: no buffer ${a?.buffer}`;
      const size = isIndex ? 1 : a.size, el = ATTR_TYPES[a.type];
      if (!el) return `${what}: type ${a.type}`;
      if (isIndex && a.type !== 'u16' && a.type !== 'u32') return `${what}: an index is u16 or u32`;
      if (!Number.isInteger(size) || size < 1 || size > 4) return `${what}: size ${size}`;
      const off = a.offset ?? 0, n = a.count;
      if (!Number.isInteger(off) || off < 0 || off % el) return `${what}: offset ${off} (a multiple of ${el})`;
      if (!Number.isInteger(n) || n < 1) return `${what}: count ${n}`;
      if (off + n * size * el > B.bytes) return `${what}: past its buffer (${off} + ${n}×${size}×${el} > ${B.bytes})`;
      gpu += n * size * el;
      return null;
    };
    for (const [name, a] of Object.entries(d.attributes)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name)) return err(ERR.ARGS, `geometry: attribute name ${name}`);
      const e = view(a, `geometry.${name}`, false);
      if (e) return err(ERR.ARGS, e);
      if (count >= 0 && a.count !== count) return err(ERR.ARGS, `geometry: ${name} has ${a.count} items, another ${count}`);
      count = a.count;
      attrs[name] = { buffer: a.buffer, type: a.type, size: a.size, offset: a.offset ?? 0, count: a.count };
    }
    if (!attrs.position) return err(ERR.ARGS, 'geometry: no position');
    if (Object.keys(attrs).length > 12) return err(ERR.ARGS, 'geometry: more than 12 attributes');
    let index = null, tris = count / 3;
    if (d.index) {
      const e = view(d.index, 'geometry.index', true);
      if (e) return err(ERR.ARGS, e);
      index = { buffer: d.index.buffer, type: d.index.type, offset: d.index.offset ?? 0, count: d.index.count };
      tris = index.count / 3;
    }
    const bd = d.bounds;
    if (!bd || !finArr(bd.center, 3) || !fin(bd.radius) || bd.radius < 0) return err(ERR.ARGS, 'geometry: bounds { center: [x, y, z], radius }');
    if (W.gpu + gpu > LIMITS.runGpu) return err(ERR.LIMIT, `geometry: GPU memory ${W.gpu + gpu} > ${LIMITS.runGpu}`);
    W.gpu += gpu;
    const id = newId('geometry');
    W.geos.set(id, { tris: Math.floor(tris), count, index: index?.count ?? 0 });
    W.cmds.push({ op: 'geometry', id, desc: { attributes: attrs, index, bounds: { center: bd.center, radius: bd.radius } } });
    return id;
  },

  geometry_range(geo, start, count) {
    const G = W.geos.get(geo);
    if (!G || !isKind(geo, 'geometry')) return err(ERR.MISSING, `geometry_range: no geometry ${geo}`);
    const n = G.index || G.count;
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > n) return err(ERR.ARGS, `geometry_range: ${start}+${count} past ${n}`);
    const id = newId('geometry');
    W.geos.set(id, { tris: Math.floor(count / 3), count: G.count, index: G.index, range: true });
    W.cmds.push({ op: 'range', id, geo, start, count });
    return id;
  },

  texture(ptr, len) {
    const path = str(ptr, len, 200);
    const f = path !== null && W.files[path];
    if (!f) return err(ERR.MISSING, `texture: no file ${path} in the package`);
    if (!f.w || !f.h) return err(ERR.ARGS, `texture: ${path} is not a PNG, JPEG or WebP`);
    if (f.w > LIMITS.textureSize || f.h > LIMITS.textureSize) return err(ERR.LIMIT, `texture: ${path} is ${f.w}×${f.h}, more than ${LIMITS.textureSize}`);
    const gpu = Math.ceil(f.w * f.h * 4 * 4 / 3);
    if (W.gpu + gpu > LIMITS.runGpu) return err(ERR.LIMIT, `texture: GPU memory ${W.gpu + gpu} > ${LIMITS.runGpu}`);
    W.gpu += gpu;
    const id = newId('texture');
    W.textures.add(id);
    W.cmds.push({ op: 'texture', id, path });
    return id;
  },

  target(ptr, len) {
    const d = json(ptr, len);
    if (!d) return err(ERR.ARGS, 'target: bad JSON');
    const bpp = FORMATS[d.format ?? 'rgba8'];
    if (!bpp) return err(ERR.ARGS, `target: format ${d.format}`);
    let px;
    if (d.screen !== undefined) {
      if (!fin(d.screen) || d.screen <= 0 || d.screen > 1) return err(ERR.ARGS, 'target: screen is a scale, 0 < s <= 1');
      px = W.screen[0] * W.screen[1] * d.screen * d.screen;
    } else {
      if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 1 || d.height < 1 || d.width > 4096 || d.height > 4096) return err(ERR.ARGS, 'target: width, height (1–4096)');
      px = d.width * d.height;
    }
    if (W.targetCount >= LIMITS.targets) return err(ERR.LIMIT, `target: more than ${LIMITS.targets}`);
    if (W.targetPixels + px > W.screen[0] * W.screen[1] + LIMITS.targetPixelsOver) return err(ERR.LIMIT, 'target: more pixels than the screen + 1024²');
    const gpu = px * (bpp + (d.depth ? 4 : 0));
    if (W.gpu + gpu > LIMITS.runGpu) return err(ERR.LIMIT, `target: GPU memory ${W.gpu + gpu} > ${LIMITS.runGpu}`);
    W.gpu += gpu;
    W.targetCount++;
    W.targetPixels += px;
    const id = newId('target');
    W.targets.set(id, d);
    W.cmds.push({ op: 'target', id, desc: { width: d.width, height: d.height, screen: d.screen, format: d.format ?? 'rgba8', depth: !!d.depth } });
    return id;
  },

  material(ptr, len) {
    const d = json(ptr, len);
    if (!d) return err(ERR.ARGS, 'material: bad JSON');
    if (d.city !== undefined) {
      if (typeof d.city !== 'string' || !CITY.has(d.city)) return err(ERR.ARGS, `material: no city material "${d.city}"`);
      const id = newId('material');
      W.mats.set(id, { shader: false });
      W.cmds.push({ op: 'material', id, desc: { city: d.city } });
      return id;
    }
    if (d.standard) {
      const s = d.standard, o = {};
      for (const k of ['color', 'emissive']) if (s[k] !== undefined) { if (!finArr(s[k], 3)) return err(ERR.ARGS, `material: standard.${k}`); o[k] = s[k]; }
      for (const k of ['roughness', 'metalness', 'envMapIntensity', 'opacity']) if (s[k] !== undefined) { if (!fin(s[k])) return err(ERR.ARGS, `material: standard.${k}`); o[k] = s[k]; }
      o.vertexColors = !!s.vertexColors;
      o.side = SIDES.includes(s.side) ? s.side : 'front';
      const id = newId('material');
      W.mats.set(id, { shader: false });
      W.cmds.push({ op: 'material', id, desc: { standard: o } });
      return id;
    }
    const s = d.shader;
    if (!s) return err(ERR.ARGS, 'material: one of city, standard, shader');
    if (!W.caps.has('shader')) return err(ERR.CAP, 'material: a shader needs the "shader" capability');
    const host = Array.isArray(s.host) ? s.host : [];
    if (!host.every((g) => HOST_UNIFORMS[g])) return err(ERR.ARGS, `material: host groups are ${Object.keys(HOST_UNIFORMS).join(', ')}`);
    if (host.includes('refract') && !W.caps.has('refract')) return err(ERR.CAP, 'material: the refract group needs the "refract" capability');
    const uniforms = s.uniforms ?? {};
    for (const [k, t] of Object.entries(uniforms)) if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(k) || !(t in UNIFORM_TYPES)) return err(ERR.ARGS, `material: uniform ${k}: ${t}`);
    const defines = {};
    for (const [k, v] of Object.entries(s.defines ?? {})) {
      if (!/^[A-Z_][A-Z0-9_]{0,31}$/.test(k) || !fin(v)) return err(ERR.ARGS, `material: define ${k} (a name in capitals, a number)`);
      defines[k] = v;
    }
    const src = {};
    for (const stage of ['vertex', 'fragment']) {
      const path = s[stage], code = W.shaders[path];
      if (typeof code !== 'string') return err(ERR.MISSING, `material: no shader file ${path} in the package (.vert, .frag, .glsl)`);
      const r = checkGlsl(code, { stage, defines, uniforms, host });
      if (!r.ok) return err(ERR.ARGS, `material: ${path}: ${r.errors.map((q) => `${q.code} ${q.message}`).join('; ')}`);
      src[stage] = code;
    }
    const id = newId('material');
    W.mats.set(id, { shader: true, uniforms, host });
    W.cmds.push({
      op: 'material', id,
      desc: {
        shader: {
          vertex: src.vertex, fragment: src.fragment, defines, uniforms, host,
          side: SIDES.includes(s.side) ? s.side : 'front', transparent: !!s.transparent,
          depthWrite: s.depthWrite !== false, depthTest: s.depthTest !== false,
          blend: BLENDS.includes(s.blend) ? s.blend : 'normal',
          polygonOffset: finArr(s.polygonOffset, 2) ? s.polygonOffset : null,
        },
      },
    });
    return id;
  },

  uniform(mat, nptr, nlen, vptr, n) {
    const M = W.mats.get(mat);
    if (!M || !isKind(mat, 'material')) return void err(ERR.MISSING, `uniform: no material ${mat}`);
    const name = str(nptr, nlen, 64);
    const type = M.shader ? M.uniforms[name] : undefined;
    if (!type) return void err(ERR.ARGS, `uniform: material ${mat} has no uniform ${name} (declare it in its JSON)`);
    if (UNIFORM_TYPES[type] !== n) return void err(ERR.ARGS, `uniform: ${name} is ${type}, ${UNIFORM_TYPES[type]} floats, not ${n}`);
    const v = floats(vptr, n);
    if (!v) return void err(ERR.ARGS, `uniform: ${name}: values not in memory, or not finite`);
    W.cmds.push({ op: 'uniform', mat, name, values: v });
  },

  uniform_tex(mat, nptr, nlen, kind, ref) {
    const M = W.mats.get(mat);
    const name = str(nptr, nlen, 64);
    if (!M?.shader || M.uniforms[name] !== 'sampler2D') return void err(ERR.ARGS, `uniform_tex: material ${mat} has no sampler2D ${name}`);
    if (kind === 0 ? !W.textures.has(ref) : kind === 1 ? !W.targets.has(ref) : true) return void err(ERR.MISSING, `uniform_tex: no ${kind === 1 ? 'target' : 'texture'} ${ref}`);
    W.cmds.push({ op: 'utex', mat, name, kind, ref });
  },

  mesh(geo, mat, ptr, len) {
    const G = W.geos.get(geo), M = W.mats.get(mat);
    if (!G || !isKind(geo, 'geometry')) return err(ERR.MISSING, `mesh: no geometry ${geo}`);
    if (!M || !isKind(mat, 'material')) return err(ERR.MISSING, `mesh: no material ${mat}`);
    const d = (len ? json(ptr, len) : {}) ?? null;
    if (!d) return err(ERR.ARGS, 'mesh: bad JSON');
    const layer = d.layer ?? 'scene';
    if (!LAYERS.includes(layer)) return err(ERR.ARGS, `mesh: layer ${layer}`);
    if (layer === 'refract' && !W.caps.has('refract')) return err(ERR.CAP, 'mesh: the refract layer needs the "refract" capability');
    if (layer !== 'pass') {
      if (W.draws + 1 > LIMITS.runDraws) return err(ERR.LIMIT, `mesh: more than ${LIMITS.runDraws} meshes`);
      if (W.tris + G.tris > LIMITS.runTris) return err(ERR.LIMIT, `mesh: ${W.tris + G.tris} triangles > ${LIMITS.runTris}`);
      W.draws++;
      W.tris += G.tris;
    }
    const id = newId('mesh');
    W.meshes.set(id, { geo, layer, inPass: false });
    W.cmds.push({ op: 'mesh', id, geo, mat, desc: { layer, order: fin(d.order) ? d.order : 0, castShadow: !!d.castShadow, receiveShadow: !!d.receiveShadow } });
    return id;
  },

  mesh_matrix(id, ptr) {
    if (!W.meshes.has(id)) return void err(ERR.MISSING, `mesh_matrix: no mesh ${id}`);
    const m = floats(ptr, 16);
    if (!m) return void err(ERR.ARGS, 'mesh_matrix: 16 finite floats');
    W.cmds.push({ op: 'matrix', id, m });
  },

  mesh_visible(id, on) {
    if (!W.meshes.has(id)) return void err(ERR.MISSING, `mesh_visible: no mesh ${id}`);
    W.cmds.push({ op: 'visible', id, on: !!on });
  },

  node_visible(ptr, len, on) {
    const name = str(ptr, len, 200);
    if (name === null) return void err(ERR.ARGS, 'node_visible: the name');
    W.cmds.push({ op: 'node', name, on: !!on });
  },

  pass(ptr, len) {
    const d = json(ptr, len);
    if (!d) return err(ERR.ARGS, 'pass: bad JSON');
    if (!W.targets.has(d.target)) return err(ERR.MISSING, `pass: no target ${d.target}`);
    const stage = d.stage ?? 'frame', camera = d.camera ?? 'own';
    if (stage !== 'frame' && stage !== 'refract') return err(ERR.ARGS, `pass: stage ${stage}`);
    if (camera !== 'main' && camera !== 'own') return err(ERR.ARGS, `pass: camera ${camera}`);
    if (stage === 'refract' && !W.caps.has('refract')) return err(ERR.CAP, 'pass: the refract stage needs the "refract" capability');
    if (!Array.isArray(d.meshes) || !d.meshes.length || d.meshes.length > 16) return err(ERR.ARGS, 'pass: meshes (1–16 ids)');
    for (const m of d.meshes) {
      const q = W.meshes.get(m);
      if (!q) return err(ERR.MISSING, `pass: no mesh ${m}`);
      if (q.layer !== 'pass') return err(ERR.ARGS, `pass: mesh ${m} is not on the "pass" layer`);
      if (q.inPass) return err(ERR.ARGS, `pass: mesh ${m} is in another pass already`);
    }
    if (W.passes.size >= 4) return err(ERR.LIMIT, 'pass: more than 4');
    for (const m of d.meshes) W.meshes.get(m).inPass = true;
    const clear = finArr(d.clear, 4) ? d.clear : [0, 0, 0, 0];
    const id = newId('pass');
    W.passes.set(id, { stage, camera });
    W.cmds.push({ op: 'pass', id, desc: { target: d.target, stage, camera, meshes: d.meshes, clear } });
    return id;
  },

  pass_camera(id, pptr, vptr) {
    const P = W.passes.get(id);
    if (!P || P.camera !== 'own') return void err(ERR.MISSING, `pass_camera: no pass ${id} with its own camera`);
    const proj = floats(pptr, 16), view = floats(vptr, 16);
    if (!proj || !view) return void err(ERR.ARGS, 'pass_camera: 16 + 16 finite floats');
    W.cmds.push({ op: 'pcam', id, proj, view });
  },

  pass_run(id) {
    const P = W.passes.get(id);
    if (!P || P.stage !== 'frame') return void err(ERR.MISSING, `pass_run: no frame-stage pass ${id}`);
    W.cmds.push({ op: 'prun', id });
  },

  act(ptr, len) {
    const d = json(ptr, len);
    if (!d || ![d.x, d.y, d.z, d.r].every(fin) || d.r <= 0 || d.r > 10 || !text2(d.hint)) return err(ERR.ARGS, 'act: { x, y, z, r (0–10), dy?, hint: { zh, en } }');
    if (W.acts.size >= 16) return err(ERR.LIMIT, 'act: more than 16');
    const id = newId('act');
    W.acts.add(id);
    W.cmds.push({ op: 'act', id, desc: { x: d.x, y: d.y, z: d.z, r: d.r, dy: fin(d.dy) ? Math.abs(d.dy) : 1.5, hint: { zh: d.hint.zh, en: d.hint.en } } });
    return id;
  },

  act_enable(id, on) {
    if (!W.acts.has(id)) return void err(ERR.MISSING, `act_enable: no act ${id}`);
    W.cmds.push({ op: 'actOn', id, on: !!on });
  },

  focus(ptr, len) {
    const d = (len ? json(ptr, len) : {}) ?? null;
    if (!d) return void err(ERR.ARGS, 'focus: bad JSON');
    const keys = Array.isArray(d.keys) ? d.keys : [];
    if (keys.length > 16 || !keys.every((k) => typeof k === 'string' && KEYS.test(k))) return void err(ERR.ARGS, 'focus: keys (up to 16 KeyboardEvent.code, not Escape)');
    W.cmds.push({ op: 'focus', desc: { keys } });
  },

  focus_camera(eptr, tptr) {
    const e = floats(eptr, 3), t = floats(tptr, 3);
    if (!e || !t) return void err(ERR.ARGS, 'focus_camera: 3 + 3 finite floats');
    W.cmds.push({ op: 'fcam', eye: e, target: t });
  },

  focus_cursor(kind) {
    W.cmds.push({ op: 'cursor', kind: kind >= 0 && kind <= 3 ? kind : 0 });
  },

  focus_end() {
    W.cmds.push({ op: 'fend' });
  },

  panel(ptr, len) {
    const d = json(ptr, len);
    const p = d && cleanPanel(d);
    if (!p) return void err(ERR.ARGS, 'panel: see docs/abi.md 3.7');
    W.cmds.push({ op: 'panel', desc: p });
  },

  keepout(ptr, len, gptr, gbytes) {
    const d = json(ptr, len);
    if (!d || !finArr(d.origin, 3) || !fin(d.cell) || d.cell <= 0 || !Array.isArray(d.dims) || d.dims.length !== 3 || !d.dims.every((v) => Number.isInteger(v) && v >= 2)) return void err(ERR.ARGS, 'keepout: { origin, cell, dims, keep, arm, radius, heights }');
    const n = d.dims[0] * d.dims[1] * d.dims[2];
    if (n > LIMITS.keepoutPoints) return void err(ERR.LIMIT, `keepout: ${n} points > ${LIMITS.keepoutPoints}`);
    if (gbytes !== n * 4) return void err(ERR.ARGS, `keepout: the grid is ${gbytes} bytes, dims say ${n * 4}`);
    const g = floats(gptr, n);
    if (!g) return void err(ERR.ARGS, 'keepout: the grid is not in memory, or not finite');
    const keep = fin(d.keep) ? Math.min(Math.max(d.keep, 0), 2) : 0.1, arm = fin(d.arm) ? Math.min(Math.max(d.arm, 0), 2) : 0.3;
    const heights = Array.isArray(d.heights) && d.heights.length && d.heights.length <= 8 && d.heights.every(fin) ? d.heights : [0.15, 0.55, 1.0, 1.5];
    const radius = fin(d.radius) && d.radius > 0 ? d.radius : 1e9;
    W.cmds.push({ op: 'keepout', desc: { origin: d.origin, cell: d.cell, dims: d.dims, keep, arm, heights, radius }, grid: g });
    W.transfer.push(g.buffer);
  },

  sleep(interval, wake) {
    if (!fin(interval) || !fin(wake)) return void err(ERR.ARGS, 'sleep: two finite numbers');
    W.cmds.push({ op: 'sleep', interval: Math.min(Math.max(interval, 0.05), 5), wake: Math.min(Math.max(wake, 0), 20) });
  },
};

const SIDES = ['front', 'back', 'double'];
const BLENDS = ['normal', 'none', 'add', 'multiply'];
const CITY = new Set(CITY_MATERIALS);

// the panel as the host will draw it: only known items, short texts, colours as #rrggbb
function cleanPanel(d) {
  if (!text2(d.title, 40)) return null;
  const items = [];
  for (const it of Array.isArray(d.items) ? d.items.slice(0, 24) : []) {
    if (it.label && text2(it.label, 80)) items.push({ label: it.label });
    else if (it.slider && Number.isInteger(it.slider.id) && [it.slider.min, it.slider.max, it.slider.value].every(fin) && it.slider.max > it.slider.min) items.push({ slider: { id: it.slider.id, min: it.slider.min, max: it.slider.max, value: it.slider.value, step: fin(it.slider.step) ? it.slider.step : 1 } });
    else if (it.swatches && Number.isInteger(it.swatches.id) && Array.isArray(it.swatches.options)) {
      const options = it.swatches.options.slice(0, 8).filter((o) => Array.isArray(o.colors) && o.colors.length >= 1 && o.colors.length <= 4 && o.colors.every((c) => HEX.test(c)) && text2(o.title));
      if (!options.length) return null;
      const stops = (o) => (Array.isArray(o.stops) && o.stops.length === o.colors.length - 1 && o.stops.every((v) => fin(v) && v >= 0 && v <= 100) ? o.stops : null);
      items.push({ swatches: { id: it.swatches.id, value: Number.isInteger(it.swatches.value) ? it.swatches.value : 0, options: options.map((o) => ({ colors: o.colors, stops: stops(o), title: o.title })) } });
    } else if (Array.isArray(it.buttons)) {
      const bs = it.buttons.slice(0, 4).filter((b) => Number.isInteger(b.id) && text2(b.text, 20) && (b.key === undefined || /^[A-Z0-9]$/.test(b.key)));
      if (bs.length) items.push({ buttons: bs.map((b) => ({ id: b.id, key: b.key ?? null, text: b.text })) });
    } else if (it.leave && text2(it.leave.text, 20)) items.push({ leave: { key: /^[A-Z0-9]$/.test(it.leave.key ?? '') ? it.leave.key : null, text: it.leave.text } });
    else return null;
  }
  return { title: d.title, items };
}
