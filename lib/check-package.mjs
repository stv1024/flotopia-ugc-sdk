// flotopia-ugc check: every check the game makes on a package, and a trial run of its code in the game's own
// sandbox (lib/host/: copied from the game, the same code), twice, compared (determinism).
// where: a directory, or the URL of a ugc.json (then also CORS).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { checkManifest, checkGround, checkThings } from './host/check/package.js';
import { checkGlb } from './host/check/gltf.js';
import { imageSize } from './host/check/image.js';
import { sandbox } from './host/runtime/sandbox.js';
import { INBOX, INBOX_BYTES, EVENT_BYTES, FUEL, LIMITS, EV, MODE } from './host/abi.js';

const GAME_ORIGIN = 'https://stv1024.asia';

export async function checkPackage(where, { seed = 1, ticks = 120 } = {}) {
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
  const json = (name) => { try { return JSON.parse(new TextDecoder().decode(bytes[name])); } catch { E('E_JSON', `${name} is not JSON`, name); return null; } };
  if (bytes[M.ground]) {
    const g = json(M.ground);
    if (g) {
      const r = checkGround(g, M.footprint);
      for (const e of r.errors) E(e.code, `${M.ground}: ${e.message}`, M.ground);
      report.push(`${M.ground}: ${g.cells?.length ?? 0} cells, ${g.colliders?.length ?? 0} colliders`);
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
  }
  for (const w of warn) report.push(`warning: ${w}`);
  return { report, errors };
}

// the code in the sandbox: init, then ticks of a player walking up to the island's middle, pressing the act key
// at each act point, and, if it takes focus, the pointer, the wheel, its keys, its panel; then leaving focus
function trial({ wasm, seed, caps, files, shaders, M, ticks }) {
  const errors = [], logs = [], hash = createHash('sha256');
  let made = { meshes: 0, acts: [], focus: null, panel: [] };
  const box = sandbox({ wasm, seed, caps, files, shaders, screen: [1920, 1080] });
  const take = (r) => {
    for (const l of r.logs) { logs.push(l); if (/^error -\d/.test(l)) errors.push({ code: 'E_CALL', message: l }); }
    for (const c of r.cmds) {
      hash.update(c.op);
      hash.update(JSON.stringify(c, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? hex(v) : v)));
      if (c.op === 'mesh') made.meshes++;
      if (c.op === 'act') made.acts.push(c.id);
      if (c.op === 'focus') made.focus = c.desc.keys;
      if (c.op === 'panel') made.panel = panelIds(c.desc);
      if (c.op === 'fend') made.focus = null;
    }
  };
  let init = 0, tickMax = 0, n = 0;
  try {
    const r = box.init();
    if (!r) { errors.push({ code: 'E_WASM', message: box.fatal }); return { errors, logs, hash: '', init, tickMax, ticks: 0, made: '' }; }
    init = r.used;
    take(r);
    const R = M.runtime.activate, time0 = 1.8e9;
    for (n = 0; n < ticks; n++) {
      const ev = [];
      const k = n / ticks, d = Math.max(2, R * (1 - 1.4 * k)); // walking in from the activate edge
      if (n === Math.floor(ticks * 0.45)) for (const id of made.acts) ev.push([EV.ACT, id, []]);
      if (made.focus && n > ticks * 0.5 && n < ticks * 0.9) {
        const o = [0, 6, 20], dir = norm([0, -0.25, -1]), v = [...o, ...dir, 640, 360, 1];
        const j = n % 12;
        if (j === 0) ev.push([EV.POINTER_DOWN, 0, v]);
        else if (j < 6) ev.push([EV.POINTER_MOVE, 1, [...o, ...norm([0.02 * j, -0.25, -1]), 640 + 8 * j, 360, 1]]);
        else if (j === 6) ev.push([EV.POINTER_UP, 0, v]);
        else if (j === 7) ev.push([EV.WHEEL, 0, [120]]);
        else if (j === 8) made.focus.forEach((_, i) => ev.push([EV.KEY, i, []]));
        else if (j === 9) for (const id of made.panel) ev.push([EV.PANEL, id, [1]]);
      }
      if (made.focus && n === Math.floor(ticks * 0.9)) ev.push([EV.FOCUS_END, 0, []]);
      const r2 = box.tick(inbox(time0 + n / 60, 1 / 60, [0, 0.5, d], made.focus ? 1 : 0, ev));
      tickMax = Math.max(tickMax, r2.used);
      take(r2);
    }
  } catch (e) {
    errors.push({ code: 'E_TRAP', message: `the code trapped at ${n ? `tick ${n}` : 'init'}: ${e.message}${box.fuelLeft() < 0 ? ' (out of fuel)' : ''}` });
  }
  return { errors, logs, hash: hash.digest('hex'), init, tickMax, ticks: n, made: `${made.meshes} meshes, ${made.acts.length} act points${made.focus ? ', focus' : ''}` };
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
