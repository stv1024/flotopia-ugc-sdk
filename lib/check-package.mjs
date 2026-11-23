// flotopia-ugc check: every check the game makes on a package, and a trial run of its code in the game's own
// sandbox (lib/host/: copied from the game, the same code), twice, compared (determinism).
// where: a directory, or the URL of a ugc.json (then also CORS).
// Then warnings the game does not give but a player would find: act points out of reach, cells nobody can walk
// to (lib/reach.mjs), meshes past the footprint, normals that are zero (lib/normals.mjs), files nothing uses, node names the near look does not have, and
// where a panel's JSON goes wrong. → { report: [lines], errors: [{ code, message, path }], warnings: [text] }
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { checkManifest, checkGround, checkThings } from './host/check/package.js';
import { checkGlb } from './host/check/gltf.js';
import { imageSize } from './host/check/image.js';
import { sandbox } from './host/runtime/sandbox.js';
import { INBOX, INBOX_BYTES, EVENT_BYTES, FUEL, LIMITS, EV, MODE } from './host/abi.js';
import { reach } from './reach.mjs';
import { glbJson } from './glb.mjs';
import { panelProblem } from './panel.mjs';
import { badNormals, someOf } from './normals.mjs';

const GAME_ORIGIN = 'https://stv1024.asia';

export async function checkPackage(where, { seed = 1, ticks = 600 } = {}) {
  const report = [], errors = [], warn = [];
  const E = (code, message, path) => errors.push({ code, message, path });
  const url = /^https?:\/\//.test(where);
  const base = url ? new URL('.', where).href : resolve(where);
  const read = async (name) => {
    if (url) {
      const res = await fetch(new URL(name, base), { headers: { Origin: GAME_ORIGIN } });
      if (!res.ok) throw new Error(`${res.status}`);
      const acao = res.headers.get('access-control-allow-origin');
      if (acao !== '*' && acao !== GAME_ORIGIN) E('E_CORS', `${name}: the server does not send Access-Control-Allow-Origin: * (got ${acao ?? 'none'}); the game cannot read it`, name);
      return new Uint8Array(await res.arrayBuffer());
    }
    const p = join(base, name);
    if (!existsSync(p)) throw new Error('no such file');
    return new Uint8Array(readFileSync(p));
  };

  // the manifest
  let mbytes;
  try { mbytes = await read(url ? where.slice(base.length) || 'ugc.json' : 'ugc.json'); } catch (e) { E('E_MANIFEST', `ugc.json: ${e.message}`); return { report, errors }; }
  let obj;
  try { obj = JSON.parse(new TextDecoder().decode(mbytes)); } catch { E('E_MANIFEST', 'ugc.json is not JSON'); return { report, errors }; }
  const mr = checkManifest(obj, { bytes: mbytes.length });
  errors.push(...mr.errors);
  if (!mr.ok) return { report, errors };
  const M = mr.manifest;
  report.push(`${M.title.en} / ${M.title.zh}: footprint ${JSON.stringify(M.footprint)}, ${Object.keys(M.files).length} files`);
  report.push(`sha256 of ugc.json: ${createHash('sha256').update(mbytes).digest('hex')}`);

  // every file: there, its size, its hash
  const bytes = {};
  for (const [name, f] of Object.entries(M.files)) {
    let b;
    try { b = await read(name); } catch (e) { E('E_FILE', `${name}: ${e.message}`, name); continue; }
    const h = createHash('sha256').update(b).digest('hex');
    if (b.length !== f.bytes) E('E_FILE_BYTES', `${name}: ${b.length} bytes, the manifest says ${f.bytes} (run flotopia-ugc pack)`, name);
    if (h !== f.sha256) E('E_FILE_HASH', `${name}: its SHA-256 is not the manifest's (run flotopia-ugc pack)`, name);
    bytes[name] = b;
  }
  const runtimeFiles = new Set(Object.keys(M.files).filter((n) => n === M.runtime?.wasm || /\.(vert|frag|glsl)$/.test(n)));
  const sum = (pred) => Object.entries(M.files).filter(([n]) => pred(n)).reduce((s, [, f]) => s + f.bytes, 0);
  const statics = sum((n) => !runtimeFiles.has(n) && n !== M.shell), runtime = sum((n) => runtimeFiles.has(n));
  report.push(`download: shell ${kb(M.files[M.shell]?.bytes ?? 0)}, near and the rest ${kb(statics)}, code and shaders ${kb(runtime)}`);
  // files nothing names (pack puts every file of the directory in the package): see below, after the code ran
  const used = new Set([M.shell, ...M.lods.map((l) => l.file), M.ground, M.things, M.cover, M.runtime?.wasm].filter(Boolean));
  if (statics > LIMITS.nearBytes) E('E_LIMIT_BYTES', `the static files are ${statics} bytes, more than ${LIMITS.nearBytes}`);
  if (runtime > LIMITS.runtimeBytes) E('E_LIMIT_BYTES', `the wasm and shaders are ${runtime} bytes, more than ${LIMITS.runtimeBytes}`);

  // the looks
  const glb = (name, opts) => {
    if (!bytes[name]) return;
    const r = checkGlb(bytes[name], opts);
    for (const e of r.errors) E(e.code, `${name}: ${e.message}`, name);
    if (r.stats) report.push(`${name}: ${r.stats.triangles} triangles, ${r.stats.draws} draws, ${(r.stats.materials ?? []).join(' ')}, GPU ${kb(r.stats.gpuBytes ?? 0)}`);
  };
  glb(M.shell, { shell: true, near: false });
  for (const l of M.lods) glb(l.file, { shell: false, near: true });
  // the meshes inside the footprint? (the game checks the cells, colliders and keep-out; a mesh past it overlaps
  // the next slot's water)
  const nodeNames = new Set();
  for (const name of [M.shell, ...M.lods.map((l) => l.file)]) {
    if (!bytes[name]) continue;
    try {
      const x = extent(bytes[name]), f = M.footprint;
      if (name !== M.shell) for (const n of x.names) nodeNames.add(n);
      const over = f.shape === 'circle' ? x.r - f.r : Math.max(x.x - f.w / 2, x.z - f.d / 2);
      if (over > 0.01) warn.push(`${name}: its meshes reach ${over.toFixed(2)} m past the footprint (${f.shape === 'circle' ? `${x.r.toFixed(2)} m from the centre, r ${f.r}` : `|x| up to ${x.x.toFixed(2)}, |z| up to ${x.z.toFixed(2)}; w ${f.w}, d ${f.d}`}${x.rough ? '; from the bounds of compressed meshes' : ''})`);
    } catch (e) { warn.push(`${name}: could not measure its meshes (${e.message})`); }
    // normals that are zero or not a number: NaN in the shader, the whole screen one colour (lib/normals.mjs)
    try {
      const r = zeroNormals(bytes[name]);
      for (const m of r.bad) warn.push(`${name}: mesh "${m.mesh}": ${m.list.length} of ${m.count} normals are zero or not a number (${someOf(m.list)}): the shader's normalize() gives NaN there and the bloom spreads it over the player's whole screen. The game mends them (the normals of their triangles), but mend them in your build (writeGlb does, lib/glb.mjs; zero normals come from triangles of no area)`);
      if (r.unread.length) report.push(`${name}: normals not checked in ${r.unread.join(', ')} (compressed)`);
    } catch (e) { warn.push(`${name}: could not read its normals (${e.message})`); }
  }
  const json = (name) => { try { return JSON.parse(new TextDecoder().decode(bytes[name])); } catch { E('E_JSON', `${name} is not JSON`, name); return null; } };
  let ground = null;
  if (bytes[M.ground]) {
    const g = json(M.ground);
    if (g) {
      const r = checkGround(g, M.footprint);
      for (const e of r.errors) E(e.code, `${M.ground}: ${e.message}`, M.ground);
      report.push(`${M.ground}: ${g.cells?.length ?? 0} cells, ${g.colliders?.length ?? 0} colliders`);
      if (!r.errors.length) ground = g;
    }
  }
  if (M.things && bytes[M.things]) {
    const t = json(M.things);
    if (t) for (const e of checkThings(t, M.footprint).errors) E(e.code, `${M.things}: ${e.message}`, M.things);
  }
  if (M.cover && bytes[M.cover]) {
    const s = imageSize(bytes[M.cover]);
    if (!s) E('E_COVER', `${M.cover}: not a PNG, JPEG or WebP`, M.cover);
    else if (s.width > LIMITS.coverSize || s.height > LIMITS.coverSize) E('E_COVER', `${M.cover}: ${s.width}×${s.height}, more than ${LIMITS.coverSize}`, M.cover);
  }

  // the code: two runs, the same?
  let acts = [];
  if (M.runtime && bytes[M.runtime.wasm]) {
    const files = {}, shaders = {};
    for (const [n, f] of Object.entries(M.files)) {
      const s = /\.(png|jpe?g|webp)$/.test(n) && bytes[n] ? imageSize(bytes[n]) : null;
      files[n] = { bytes: f.bytes, ...(s ? { w: s.width, h: s.height } : {}) };
      if (/\.(vert|frag|glsl)$/.test(n) && bytes[n]) shaders[n] = new TextDecoder().decode(bytes[n]);
    }
    const run = () => trial({ wasm: bytes[M.runtime.wasm], seed, caps: M.runtime.caps, files, shaders, M, ticks });
    const a = run(), b = run();
    for (const line of a.logs.slice(0, 40)) report.push(`  log: ${line}`);
    for (const e of a.errors) E(e.code, e.message);
    report.push(`code: init ${fuel(a.init)} fuel (of ${fuel(FUEL.init)}), ticks up to ${fuel(a.tickMax)} (of ${fuel(FUEL.tick)}), ${a.ticks} ticks run; ${a.made}`);
    if (a.init > FUEL.init * 0.5) warn.push(`init uses ${Math.round((a.init / FUEL.init) * 100)}% of its fuel: a slower build of the module may run out`);
    if (a.tickMax > FUEL.tick * 0.25) warn.push(`a tick uses ${Math.round((a.tickMax / FUEL.tick) * 100)}% of its fuel: spread the work over ticks`);
    if (!a.errors.length && a.hash !== b.hash) E('E_DETERMINISM', 'two runs with the same seed and inputs asked the host for different things (a clock or randomness not from the inbox or the seed?)');
    acts = a.acts;
    for (const p of a.files) used.add(p);
    for (const n of a.nodes) if (!nodeNames.has(n)) warn.push(`node_visible("${n}"): the near look has no node of that name (it has ${[...nodeNames].slice(0, 12).map((q) => JSON.stringify(q)).join(', ')}${nodeNames.size > 12 ? ', ...' : ''})`);
    for (const p of a.panels) { if (p.refused) E('E_PANEL', `panel() refused: ${p.why}`); else warn.push(`panel(): ${p.why}`); }
  }
  // where a player can walk, from arrive; the act points in reach
  if (ground) for (const w of reach(ground, M.footprint, acts).warnings) warn.push(`${M.ground}: ${w}`);
  for (const n of Object.keys(M.files)) if (!used.has(n)) warn.push(`${n}: nothing uses it (not named in ugc.json, not loaded by the code in the trial run); pack put it in because it is in the directory: delete it there`);
  return { report, errors, warnings: warn };
}

// how far a .glb's meshes reach in the island frame: { r: across from the centre, x: |x|, z: |z|, names: [nodes],
// rough: from the bounds (compressed meshes), not the vertices }
function extent(b) {
  const j = glbJson(b), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const jsonLen = dv.getUint32(12, true), binAt = 20 + jsonLen + 8;
  const acc = j.accessors ?? [], views = j.bufferViews ?? [];
  const out = { r: 0, x: 0, z: 0, names: [], rough: false };
  const floats = (ai, size) => {
    const a = acc[ai], v = a && views[a.bufferView];
    if (!a || !v || a.componentType !== 5126 || a.sparse || v.extensions || v.buffer !== 0) return null;
    const stride = v.byteStride ?? size * 4, at = binAt + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), o = [];
    for (let i = 0; i < a.count; i++) { const p = []; for (let k = 0; k < size; k++) p.push(dv.getFloat32(at + i * stride + 4 * k, true)); o.push(p); }
    return o;
  };
  const put = (m, p) => {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    out.x = Math.max(out.x, Math.abs(x)); out.z = Math.max(out.z, Math.abs(z)); out.r = Math.max(out.r, Math.hypot(x, z));
  };
  const visit = (ni, parent) => {
    const n = j.nodes[ni];
    if (n.name) out.names.push(n.name);
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      const gi = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
      let inst = [identity()];
      if (gi) {
        const T = gi.TRANSLATION !== undefined ? floats(gi.TRANSLATION, 3) : null, R = gi.ROTATION !== undefined ? floats(gi.ROTATION, 4) : null, S = gi.SCALE !== undefined ? floats(gi.SCALE, 3) : null;
        const count = acc[Object.values(gi)[0]]?.count ?? 1;
        inst = Array.from({ length: count }, (_, i) => trs(T?.[i], R?.[i], S?.[i]));
      }
      for (const p of j.meshes[n.mesh].primitives) {
        const pa = p.attributes.POSITION, pts = floats(pa, 3);
        let list = pts;
        if (!pts) {
          out.rough = true;
          const { min, max } = acc[pa];
          list = [];
          for (let k = 0; k < 8; k++) list.push([k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
        }
        for (const im of inst) { const w = mul(m, im); for (const q of list) put(w, q); }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  for (const ni of j.scenes?.[j.scene ?? 0]?.nodes ?? []) visit(ni, identity());
  return out;
}
// the normals of a .glb that are zero or not a number, mesh by mesh: { bad: [{ mesh, count, list: [vertices] }],
// unread: [meshes compressed: Draco, meshopt] }. Float normals and quantized ones (KHR_mesh_quantization:
// normalized bytes, shorts)
function zeroNormals(b) {
  const j = glbJson(b), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const binAt = 20 + dv.getUint32(12, true) + 8;
  const acc = j.accessors ?? [], views = j.bufferViews ?? [];
  const READ = { 5126: [4, (o) => dv.getFloat32(o, true)], 5120: [1, (o) => Math.max(dv.getInt8(o) / 127, -1)], 5122: [2, (o) => Math.max(dv.getInt16(o, true) / 32767, -1)] };
  const out = { bad: [], unread: [] }, seen = new Set();
  (j.meshes ?? []).forEach((mesh, mi) => {
    const prims = mesh.primitives ?? [];
    prims.forEach((p, pi) => {
      const ai = p.attributes?.NORMAL, a = acc[ai];
      if (ai === undefined || !a || seen.has(ai)) return;
      seen.add(ai);
      const what = `${mesh.name ?? `mesh ${mi}`}${prims.length > 1 ? `, primitive ${pi}` : ''}`;
      const v = views[a.bufferView], rd = READ[a.componentType];
      if (p.extensions?.KHR_draco_mesh_compression || v?.extensions || a.sparse || !rd || (v && v.buffer !== 0)) return void out.unread.push(`"${what}"`);
      // (no bufferView: all zeros)
      const N = new Float32Array(3 * a.count);
      if (v) {
        const stride = v.byteStride ?? 3 * rd[0], at = binAt + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) N[3 * i + k] = rd[1](at + i * stride + k * rd[0]);
      }
      const list = badNormals(N);
      if (list.length) out.bad.push({ mesh: what, count: a.count, list });
    });
  });
  return out;
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
  return r;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const local = (n) => (n.matrix ? n.matrix : trs(n.translation, n.rotation, n.scale));

// the code in the sandbox: init, then ticks of a player walking up to the island's middle, pressing the act key
// at each act point (30 ticks after the code made them), and, if it takes focus, the pointer, the wheel, its
// keys, its panel; then leaving focus. Ticks 70–80 % of the way: long frames (dt 1/20 s, a slow computer)
function trial({ wasm, seed, caps, files, shaders, M, ticks }) {
  const errors = [], logs = [], hash = createHash('sha256');
  let made = { meshes: 0, acts: [], focus: null, panel: [] };
  const box = sandbox({ wasm, seed, caps, files, shaders, screen: [1920, 1080] });
  // what the code asked for by name, read as it called (the sandbox gives only its verdict): the files of its
  // textures and shaders, the nodes it shows and hides, what is wrong with a panel the sandbox refused
  const asked = { files: new Set(), nodes: new Set(), panels: new Map(), acts: [] };
  const Real = WebAssembly.Instance;
  WebAssembly.Instance = function (mod, imp) {
    let inst = null;
    const text = (p, n) => { try { return new TextDecoder().decode(new Uint8Array(inst.exports.memory.buffer, p >>> 0, n >>> 0)); } catch { return null; } };
    const fc = { ...imp.fc };
    const wrap = (name, f) => { const g = fc[name]; fc[name] = (...a) => { try { f(...a); } catch { /* (only looking) */ } return g(...a); }; };
    wrap('texture', (p, n) => { const s = text(p, n); if (s) asked.files.add(s); });
    wrap('material', (p, n) => { try { const d = JSON.parse(text(p, n)); if (d?.shader) for (const k of ['vertex', 'fragment']) if (typeof d.shader[k] === 'string') asked.files.add(d.shader[k]); } catch { /* (the sandbox says why) */ } });
    wrap('node_visible', (p, n) => { const s = text(p, n); if (s !== null) asked.nodes.add(s); });
    wrap('panel', (p, n) => { const r = panelProblem(text(p, n)); if (r) asked.panels.set(r.why, r); });
    inst = new Real(mod, { ...imp, fc });
    return inst;
  };
  const take = (r) => {
    for (const l of r.logs) { logs.push(l); if (/^error -\d/.test(l) && !(/: panel: /.test(l) && [...asked.panels.values()].some((q) => q.refused))) errors.push({ code: 'E_CALL', message: l }); }
    for (const c of r.cmds) {
      hash.update(c.op);
      hash.update(JSON.stringify(c, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? hex(v) : v)));
      if (c.op === 'mesh') made.meshes++;
      if (c.op === 'act') { made.acts.push(c.id); asked.acts.push(c.desc); }
      if (c.op === 'focus') made.focus = c.desc.keys;
      if (c.op === 'panel') made.panel = panelIds(c.desc);
      if (c.op === 'fend') made.focus = null;
    }
  };
  let init = 0, tickMax = 0, n = 0, focusAt = -1, actAt = -1, time = 1.8e9;
  const result = (o) => ({ ...o, files: [...asked.files], nodes: [...asked.nodes], panels: [...asked.panels.values()], acts: asked.acts });
  try {
    let r;
    try { r = box.init(); } finally { WebAssembly.Instance = Real; }
    if (!r) { errors.push({ code: 'E_WASM', message: box.fatal }); return result({ errors, logs, hash: '', init, tickMax, ticks: 0, made: '' }); }
    init = r.used;
    take(r);
    const R = M.runtime.activate;
    for (n = 0; n < ticks; n++) {
      const ev = [];
      const k = n / ticks, d = Math.max(2, R * (1 - 1.4 * k)); // walking in from the activate edge
      const dt = k >= 0.7 && k < 0.8 ? 1 / 20 : 1 / 60;
      time += dt;
      if (actAt < 0 && made.acts.length) actAt = n + 30;
      if (n === actAt) for (const id of made.acts) ev.push([EV.ACT, id, []]);
      // in focus: the pointer down on the middle, dragged, up; the wheel; each panel control; then each key
      // (a key may end focus: last), then the host ends it
      if (made.focus && focusAt < 0) focusAt = n;
      if (focusAt >= 0 && made.focus) {
        const j = n - focusAt, o = [0, 6, 20], ray = (dx) => [...o, ...norm([dx, -0.25, -1]), 640 + 400 * dx, 360, 1];
        if (j === 2) ev.push([EV.POINTER_DOWN, 0, ray(0)]);
        else if (j > 2 && j < 8) ev.push([EV.POINTER_MOVE, 1, ray(0.02 * (j - 2))]);
        else if (j === 8) ev.push([EV.POINTER_UP, 0, ray(0.1)]);
        else if (j === 9) ev.push([EV.POINTER_DOWN, 2, ray(0.3)]);
        else if (j === 10) ev.push([EV.POINTER_MOVE, 4, ray(0.4)]);
        else if (j === 11) ev.push([EV.POINTER_UP, 2, ray(0.4)]);
        else if (j === 12) ev.push([EV.WHEEL, 0, [120]]);
        else if (j === 13) for (const id of made.panel) ev.push([EV.PANEL, id, [1]]);
        else if (j >= 16 && j - 16 < made.focus.length) ev.push([EV.KEY, j - 16, []]);
        else if (j === 16 + made.focus.length + 4) ev.push([EV.FOCUS_END, 0, []]);
      }
      const r2 = box.tick(inbox(time, dt, [0, 0.5, d], made.focus ? 1 : 0, ev));
      tickMax = Math.max(tickMax, r2.used);
      take(r2);
    }
  } catch (e) {
    errors.push({ code: 'E_TRAP', message: `the code trapped at ${n ? `tick ${n}` : 'init'}: ${e.message}${box.fuelLeft() < 0 ? ' (out of fuel)' : ''}` });
  }
  return result({ errors, logs, hash: hash.digest('hex'), init, tickMax, ticks: n, made: `${made.meshes} meshes, ${made.acts.length} act points${made.focus ? ', focus' : ''}` });
}

function inbox(time, dt, feet, focus, events) {
  const buf = new ArrayBuffer(INBOX_BYTES), dv = new DataView(buf);
  const f3 = (at, v) => v.forEach((x, i) => dv.setFloat32(at + 4 * i, x, true));
  dv.setFloat64(INBOX.time, time, true);
  dv.setFloat32(INBOX.dt, dt, true);
  dv.setUint32(INBOX.flags, 2 | 4 | (focus ? 1 : 0), true);
  f3(INBOX.eye, [feet[0], feet[1] + 3, feet[2] + 6]);
  f3(INBOX.fwd, norm([0, -0.3, -1]));
  f3(INBOX.feet, feet);
  f3(INBOX.vel, [0, 0, -1.4]);
  dv.setUint32(INBOX.mode, MODE.walk, true);
  f3(INBOX.sun, norm([0.4, 0.8, 0.3]));
  dv.setFloat32(INBOX.night, 0, true);
  f3(INBOX.screen, [1920, 1080]);
  dv.setUint32(INBOX.count, events.length, true);
  events.forEach(([kind, a, v], i) => {
    const at = INBOX.events + i * EVENT_BYTES;
    dv.setUint32(at, kind, true);
    dv.setUint32(at + 4, a, true);
    v.forEach((x, k) => dv.setFloat32(at + 8 + 4 * k, x, true));
  });
  return buf;
}

function panelIds(p) {
  const ids = [];
  for (const it of p.items) {
    if (it.slider) ids.push(it.slider.id);
    if (it.swatches) ids.push(it.swatches.id);
    if (it.buttons) ids.push(...it.buttons.map((b) => b.id));
  }
  return ids;
}

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const hex = (v) => createHash('sha256').update(new Uint8Array(v.buffer ?? v, v.byteOffset ?? 0, v.byteLength)).digest('hex');
const kb = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
const fuel = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} G` : `${(n / 1e6).toFixed(1)} M`);
