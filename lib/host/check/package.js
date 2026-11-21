// Copied from the game (floating-city src/ugc/check/package.js, 0095669) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md): a package's JSON files, flotopia-ugc/1 (the SDK's docs/abi.md 2.1 ugc.json, 2.3
// ground.json, 2.4 things.json), and the files' hashes. Every check returns the errors as data, never throws on
// bad input, and gives a clean copy (only the known fields, the defaults filled in) when there is no error.
//   checkManifest(obj, { bytes }) -> { ok, errors, manifest }   bytes: the size of ugc.json itself
//   checkGround(obj, footprint) -> { ok, errors, ground }
//   checkThings(obj, footprint) -> { ok, errors, things }
//   inFootprint(x, z, footprint, margin = 0) -> bool
//   sha256Hex(bytes) -> Promise<string>   (lower-case hex)
// Pure: no DOM, no Node (the loader, the sandbox worker and the SDK's CLI use it).
import { CAPS, LIMITS, SCHEMA, SURFS, TREES } from '../abi.js';

const MARGIN = 0.01; // m: points this far outside the footprint still count as inside (rounding)
const MAX_ERRORS = 40;
const PATH_RE = /^[A-Za-z0-9._/-]+$/;
const SHA_RE = /^[0-9a-f]{64}$/;
// control characters and the bidirectional overrides (text that shows in the game's interface)
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const RUNTIME_EXT_RE = /\.(vert|frag|glsl)$/;

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const mb = (n) => `${+(n / 2 ** 20).toFixed(2)} MB`;
const json = (x) => {
  const s = JSON.stringify(x);
  return s === undefined ? String(x) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

class Errs {
  constructor(prefix) { this.prefix = prefix; this.list = []; this.more = 0; }
  add(code, message, path) {
    if (this.list.length >= MAX_ERRORS) return void this.more++;
    const e = { code: `${this.prefix}_${code}`, message };
    if (path) e.path = path;
    this.list.push(e);
  }
  // keys other than the known ones
  keys(o, known, path, what) {
    for (const k of Object.keys(o)) {
      if (!known.includes(k)) this.add('FIELD', `${what} has the field ${json(k)}, which flotopia-ugc/1 does not know (known: ${known.join(', ')}). Remove it, or check its spelling.`, path ? `${path}.${k}` : k);
    }
  }
  done(key, value) {
    if (this.more) this.list.push({ code: `${this.prefix}_MORE`, message: `${this.more} more errors are not listed. Fix the ones above first.` });
    const ok = !this.list.length;
    return { ok, errors: this.list, [key]: ok ? value : null };
  }
}

export function inFootprint(x, z, footprint, margin = 0) {
  const f = footprint;
  if (!isObj(f) || !num(x) || !num(z) || !num(margin)) return false;
  if (f.shape === 'circle') return num(f.r) && x * x + z * z <= (f.r + margin) ** 2;
  if (f.shape === 'rect') return num(f.w) && num(f.d) && Math.abs(x) <= f.w / 2 + margin && Math.abs(z) <= f.d / 2 + margin;
  return false;
}

function asBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return null;
}

export async function sha256Hex(bytes) {
  const b = asBytes(bytes);
  if (!b) throw new TypeError('sha256Hex: not bytes (an ArrayBuffer or a Uint8Array)');
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

// why a file's path is not allowed (null: it is)
function badPath(p) {
  if (typeof p !== 'string' || !p) return 'is not a file name';
  if (!PATH_RE.test(p)) return 'has characters other than A-Z a-z 0-9 . _ / -';
  if (p.startsWith('/')) return 'starts with "/" (paths are relative to ugc.json)';
  const parts = p.split('/');
  if (parts.some((x) => !x)) return 'has an empty part ("//" or a "/" at the end)';
  if (parts.some((x) => x === '.' || x === '..')) return 'has a "." or ".." part';
  return null;
}

// ------------------------------------------------------------------ ugc.json

export function checkManifest(obj, { bytes } = {}) {
  const E = new Errs('E_MANIFEST');
  const m = { schema: SCHEMA, title: null, footprint: null, cover: null, shell: null, lods: [], ground: null, things: null, runtime: null, files: {} };
  if (bytes !== undefined && !(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= LIMITS.manifestBytes)) {
    E.add('SIZE', `ugc.json is ${json(bytes)} bytes; it may be at most ${LIMITS.manifestBytes} (${mb(LIMITS.manifestBytes)}).`, '');
  }
  if (!isObj(obj)) {
    E.add('JSON', 'ugc.json is not a JSON object. See docs/abi.md 2.1 for its fields.', '');
    return E.done('manifest', m);
  }
  E.keys(obj, Object.keys(m), '', 'ugc.json');

  if (obj.schema !== SCHEMA) E.add('SCHEMA', `schema is ${json(obj.schema)}; it must be ${json(SCHEMA)}.`, 'schema');

  // title
  const t = obj.title;
  if (!isObj(t)) E.add('TITLE', `title must be an object { "zh": "...", "en": "..." } (each 1-${LIMITS.titleChars} characters).`, 'title');
  else {
    E.keys(t, ['zh', 'en'], 'title', 'title');
    m.title = {};
    for (const k of ['zh', 'en']) {
      const s = t[k], n = typeof s === 'string' ? [...s].length : 0;
      if (typeof s !== 'string' || n < 1 || n > LIMITS.titleChars || !s.trim()) {
        E.add('TITLE', `title.${k} must be a text of 1-${LIMITS.titleChars} characters (it is ${json(s)}).`, `title.${k}`);
      } else if (CONTROL_RE.test(s)) {
        E.add('TITLE', `title.${k} has control or bidirectional-override characters; remove them.`, `title.${k}`);
      } else m.title[k] = s;
    }
  }

  // footprint
  const f = obj.footprint;
  const max = LIMITS.footprintMax;
  if (!isObj(f) || (f.shape !== 'circle' && f.shape !== 'rect')) {
    E.add('FOOTPRINT', 'footprint must be { "shape": "circle", "r": <m> } or { "shape": "rect", "w": <m>, "d": <m> }.', 'footprint');
  } else if (f.shape === 'circle') {
    E.keys(f, ['shape', 'r'], 'footprint', 'footprint');
    if (!num(f.r) || f.r <= 0 || f.r > max) E.add('FOOTPRINT', `footprint.r is ${json(f.r)}; it must be a number of metres above 0, at most ${max}.`, 'footprint.r');
    else m.footprint = { shape: 'circle', r: f.r };
  } else {
    E.keys(f, ['shape', 'w', 'd'], 'footprint', 'footprint');
    if (!num(f.w) || !num(f.d) || f.w <= 0 || f.d <= 0 || Math.max(f.w, f.d) / 2 > max) {
      E.add('FOOTPRINT', `footprint.w and .d are ${json(f.w)} and ${json(f.d)}; they must be numbers of metres above 0, half the longer at most ${max}.`, 'footprint');
    } else m.footprint = { shape: 'rect', w: f.w, d: f.d };
  }

  // the files it names
  const named = []; // [path in ugc.json, file]
  const file = (v, path, optional) => {
    if (v === undefined && optional) return null;
    const why = badPath(v);
    if (why) {
      E.add('PATH', `${path} (${json(v)}) ${why}. Name a file of the package, e.g. "shell.glb".`, path);
      return null;
    }
    named.push([path, v]);
    return v;
  };
  m.cover = file(obj.cover, 'cover', true); // optional: the platform's catalog wants one, a package being tried may have none
  m.shell = file(obj.shell, 'shell');
  m.ground = file(obj.ground, 'ground');
  m.things = file(obj.things, 'things', true);

  // lods: finest first; every one but the last says until where it is used, farther each time
  const lods = obj.lods;
  if (!Array.isArray(lods) || lods.length < 1 || lods.length > LIMITS.lods) {
    E.add('LODS', `lods must be a list of 1-${LIMITS.lods} entries { "file": "near.glb", "until": <m> }, finest first.`, 'lods');
  } else {
    let last = 0;
    lods.forEach((l, i) => {
      const path = `lods[${i}]`;
      if (!isObj(l)) return void E.add('LODS', `${path} must be an object { "file", "until"? }.`, path);
      E.keys(l, ['file', 'until'], path, path);
      const lod = { file: file(l.file, `${path}.file`) };
      if (l.until === undefined) {
        if (i < lods.length - 1) E.add('LODS', `${path} has no "until": only the last LOD may go without (the next one would never be used).`, `${path}.until`);
      } else if (!num(l.until) || l.until <= last) {
        E.add('LODS', `${path}.until is ${json(l.until)}; it must be a distance in metres, farther than the LOD before's (${last}).`, `${path}.until`);
      } else {
        lod.until = l.until;
        last = l.until;
      }
      m.lods.push(lod);
    });
  }

  // runtime
  const r = obj.runtime;
  if (r !== undefined) {
    if (!isObj(r)) E.add('RUNTIME', 'runtime must be an object { "wasm", "activate", "release", "caps" }.', 'runtime');
    else {
      E.keys(r, ['wasm', 'activate', 'release', 'caps'], 'runtime', 'runtime');
      const rt = { wasm: file(r.wasm, 'runtime.wasm'), activate: r.activate, release: r.release, caps: [] };
      if (!num(r.activate) || !num(r.release) || r.activate <= 0 || r.activate >= r.release || r.release > LIMITS.activateMax) {
        E.add('RUNTIME', `runtime.activate (${json(r.activate)}) and runtime.release (${json(r.release)}) must be distances in metres with 0 < activate < release <= ${LIMITS.activateMax}.`, 'runtime');
      }
      if (r.caps !== undefined) {
        if (!Array.isArray(r.caps)) E.add('CAPS', `runtime.caps must be a list of capabilities (${CAPS.join(', ')}).`, 'runtime.caps');
        else r.caps.forEach((c, i) => {
          if (!CAPS.includes(c)) E.add('CAPS', `runtime.caps[${i}] is ${json(c)}; the capabilities are ${CAPS.join(', ')}.`, `runtime.caps[${i}]`);
          else if (rt.caps.includes(c)) E.add('CAPS', `runtime.caps has ${json(c)} twice.`, `runtime.caps[${i}]`);
          else rt.caps.push(c);
        });
      }
      m.runtime = rt;
    }
  }

  // files: every file of the package but ugc.json, with its hash and size
  const files = obj.files;
  if (!isObj(files)) E.add('FILES', 'files must be an object { "<path>": { "sha256": "<64 hex>", "bytes": <n> } } (flotopia-ugc pack writes it).', 'files');
  else {
    const names = Object.keys(files);
    if (names.length > LIMITS.files) E.add('FILES', `files lists ${names.length} files; a package may have at most ${LIMITS.files}.`, 'files');
    else for (const name of names) {
      const path = `files[${json(name)}]`;
      const why = badPath(name);
      const v = files[name];
      if (why) E.add('PATH', `The file name ${json(name)} ${why}.`, path);
      else if (name === 'ugc.json') E.add('FILES', 'files lists ugc.json itself; leave it out (it cannot hold its own hash).', path);
      else if (!isObj(v)) E.add('FILES', `${path} must be { "sha256": "<64 hex>", "bytes": <n> }.`, path);
      else {
        E.keys(v, ['sha256', 'bytes'], path, path);
        if (typeof v.sha256 !== 'string' || !SHA_RE.test(v.sha256)) E.add('FILES', `${path}.sha256 must be 64 lower-case hex digits (the file's SHA-256).`, `${path}.sha256`);
        else if (!Number.isSafeInteger(v.bytes) || v.bytes <= 0) E.add('FILES', `${path}.bytes must be the file's size, a positive integer.`, `${path}.bytes`);
        else m.files[name] = { sha256: v.sha256, bytes: v.bytes };
      }
    }
    for (const [path, name] of named) {
      if (!Object.hasOwn(files, name)) E.add('FILES', `${path} names ${json(name)}, which is not in files. List every file with its sha256 and bytes (flotopia-ugc pack does).`, path);
    }
    // what is downloaded: the shell; the run-time code (the wasm, the shaders); the rest
    const size = (n) => (Object.hasOwn(m.files, n) ? m.files[n].bytes : 0);
    if (m.shell && size(m.shell) > LIMITS.shellBytes) {
      E.add('BYTES', `The shell (${m.shell}) is ${mb(size(m.shell))}; it may be at most ${mb(LIMITS.shellBytes)} (docs/abi.md 2.5).`, 'shell');
    }
    let run = 0, rest = 0;
    for (const n of Object.keys(m.files)) {
      if (n === m.shell) continue;
      if (n === m.runtime?.wasm || RUNTIME_EXT_RE.test(n)) run += size(n);
      else rest += size(n);
    }
    if (run > LIMITS.runtimeBytes) E.add('BYTES', `The run-time code (the wasm and the shaders) is ${mb(run)}; it may be at most ${mb(LIMITS.runtimeBytes)}.`, 'files');
    if (rest > LIMITS.nearBytes) E.add('BYTES', `The files but the shell and the run-time code are ${mb(rest)}; they may be at most ${mb(LIMITS.nearBytes)}.`, 'files');
  }
  return E.done('manifest', m);
}

// ------------------------------------------------------------------ ground.json, things.json

function footprintOk(fp) {
  return isObj(fp) && ((fp.shape === 'circle' && num(fp.r) && fp.r > 0) || (fp.shape === 'rect' && num(fp.w) && num(fp.d) && fp.w > 0 && fp.d > 0));
}

// a list of at most max items (null: not a list, or too long; reported)
function list(E, code, v, path, max, what) {
  if (!Array.isArray(v)) {
    E.add(code, `${path} must be a list of ${what}.`, path);
    return null;
  }
  if (v.length > max) {
    E.add(code, `${path} has ${v.length} ${what}; at most ${max} (docs/abi.md 2.3, 2.4).`, path);
    return null;
  }
  return v;
}

// a polygon [[x, z], ...] inside the footprint: its clean copy, or null
function polygon(E, v, path, fp) {
  if (!Array.isArray(v) || v.length < 3 || v.length > LIMITS.polyPoints) {
    E.add('POLY', `${path} must be a list of 3-${LIMITS.polyPoints} points [x, z].`, path);
    return null;
  }
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) {
      E.add('POLY', `${path}[${i}] must be a point [x, z] of two finite numbers.`, `${path}[${i}]`);
      return null;
    }
    if (fp && !inFootprint(p[0], p[1], fp, MARGIN)) {
      E.add('OUTSIDE', `${path}[${i}] (${p[0]}, ${p[1]}) is outside the footprint; everything of the island stays inside it (docs/abi.md 2.1).`, `${path}[${i}]`);
      return null;
    }
    out.push([p[0], p[1]]);
  }
  return out;
}

function height(E, h, path) {
  if (!isObj(h)) {
    E.add('HEIGHT', `${path} must be { "const": y }, { "plane": [a, b, c] } or { "grid": { ... } }.`, path);
    return null;
  }
  const ks = Object.keys(h);
  if (ks.length !== 1) {
    E.add('HEIGHT', `${path} must have exactly one of "const", "plane", "grid" (it has ${ks.map(json).join(', ') || 'none'}).`, path);
    return null;
  }
  if (ks[0] === 'const') {
    if (num(h.const)) return { const: h.const };
    E.add('HEIGHT', `${path}.const must be a finite number (the height in metres).`, `${path}.const`);
  } else if (ks[0] === 'plane') {
    const p = h.plane;
    if (Array.isArray(p) && p.length === 3 && p.every(num)) return { plane: [p[0], p[1], p[2]] };
    E.add('HEIGHT', `${path}.plane must be 3 finite numbers [a, b, c] (y = a + b x + c z).`, `${path}.plane`);
  } else if (ks[0] === 'grid') {
    const g = h.grid, gp = `${path}.grid`;
    if (!isObj(g)) {
      E.add('HEIGHT', `${gp} must be { "x0", "z0", "step", "nx", "nz", "h" }.`, gp);
      return null;
    }
    E.keys(g, ['x0', 'z0', 'step', 'nx', 'nz', 'h'], gp, gp);
    if (!num(g.x0) || !num(g.z0) || !num(g.step) || g.step <= 0) {
      E.add('HEIGHT', `${gp}: x0 and z0 must be finite numbers, step a number above 0.`, gp);
    } else if (!Number.isSafeInteger(g.nx) || !Number.isSafeInteger(g.nz) || g.nx < 1 || g.nz < 1 || g.nx * g.nz > LIMITS.gridPoints) {
      E.add('HEIGHT', `${gp}: nx and nz must be positive integers with nx x nz at most ${LIMITS.gridPoints}.`, gp);
    } else if (!Array.isArray(g.h) || g.h.length !== g.nx * g.nz || !g.h.every(num)) {
      E.add('HEIGHT', `${gp}.h must be nx x nz = ${g.nx * g.nz} finite numbers (row by row along x).`, `${gp}.h`);
    } else return { grid: { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, h: g.h.slice() } };
  } else E.add('HEIGHT', `${path} has ${json(ks[0])}; it must be "const", "plane" or "grid".`, path);
  return null;
}

export function checkGround(obj, footprint) {
  const E = new Errs('E_GROUND');
  const out = { cells: [], colliders: [], arrive: null };
  if (!isObj(obj)) {
    E.add('JSON', 'ground.json is not a JSON object { "cells", "colliders", "arrive" } (docs/abi.md 2.3).', '');
    return E.done('ground', out);
  }
  const fp = footprintOk(footprint) ? footprint : null;
  if (!fp) E.add('FOOTPRINT', 'The footprint is not valid (fix ugc.json first): nothing is checked against it.', '');
  E.keys(obj, ['cells', 'colliders', 'arrive'], '', 'ground.json');
  const cells = list(E, 'CELLS', obj.cells === undefined ? [] : obj.cells, 'cells', LIMITS.cells, 'cells');
  cells?.forEach((c, i) => {
    const path = `cells[${i}]`;
    if (!isObj(c)) return void E.add('CELLS', `${path} must be { "poly", "h", "surf"? }.`, path);
    E.keys(c, ['poly', 'h', 'surf'], path, path);
    const poly = polygon(E, c.poly, `${path}.poly`, fp);
    const h = height(E, c.h, `${path}.h`);
    const surf = c.surf === undefined ? 'deck' : c.surf;
    if (!SURFS.includes(surf)) E.add('SURF', `${path}.surf is ${json(c.surf)}; it must be one of ${SURFS.join(', ')}.`, `${path}.surf`);
    if (poly && h) out.cells.push({ poly, h, surf });
  });
  const cols = list(E, 'COLLIDERS', obj.colliders === undefined ? [] : obj.colliders, 'colliders', LIMITS.colliders, 'colliders');
  cols?.forEach((c, i) => {
    const path = `colliders[${i}]`;
    if (!isObj(c)) return void E.add('COLLIDERS', `${path} must be { "poly", "y0", "y1" }.`, path);
    E.keys(c, ['poly', 'y0', 'y1'], path, path);
    const poly = polygon(E, c.poly, `${path}.poly`, fp);
    if (!num(c.y0) || !num(c.y1) || c.y0 >= c.y1) return void E.add('COLLIDERS', `${path}: y0 (${json(c.y0)}) and y1 (${json(c.y1)}) must be finite numbers with y0 < y1.`, path);
    if (poly) out.colliders.push({ poly, y0: c.y0, y1: c.y1 });
  });
  const a = obj.arrive;
  if (!Array.isArray(a) || a.length !== 4 || !a.every(num)) {
    E.add('ARRIVE', 'arrive must be 4 finite numbers [x, y, z, heading]: where a player coming to the island stands, and the way they face (rad).', 'arrive');
  } else if (fp && !inFootprint(a[0], a[2], fp, MARGIN)) {
    E.add('OUTSIDE', `arrive (${a[0]}, ${a[2]}) is outside the footprint.`, 'arrive');
  } else out.arrive = [a[0], a[1], a[2], a[3]];
  return E.done('ground', out);
}

export function checkThings(obj, footprint) {
  const E = new Errs('E_THINGS');
  const out = { trees: [] };
  if (!isObj(obj)) {
    E.add('JSON', 'things.json is not a JSON object { "trees": [...] } (docs/abi.md 2.4).', '');
    return E.done('things', out);
  }
  const fp = footprintOk(footprint) ? footprint : null;
  if (!fp) E.add('FOOTPRINT', 'The footprint is not valid (fix ugc.json first): nothing is checked against it.', '');
  E.keys(obj, ['trees'], '', 'things.json');
  const trees = list(E, 'TREES', obj.trees === undefined ? [] : obj.trees, 'trees', LIMITS.trees, 'trees');
  trees?.forEach((t, i) => {
    const path = `trees[${i}]`;
    if (!isObj(t)) return void E.add('TREES', `${path} must be { "kind", "x", "y", "z", "rotY"?, "scale"? }.`, path);
    E.keys(t, ['kind', 'x', 'y', 'z', 'rotY', 'scale'], path, path);
    const rotY = t.rotY === undefined ? 0 : t.rotY, scale = t.scale === undefined ? 1 : t.scale;
    if (!TREES.includes(t.kind)) return void E.add('KIND', `${path}.kind is ${json(t.kind)}; the kinds are ${TREES.join(', ')}.`, `${path}.kind`);
    if (!num(t.x) || !num(t.y) || !num(t.z) || !num(rotY)) return void E.add('TREES', `${path}: x, y, z (and rotY) must be finite numbers.`, path);
    if (!num(scale) || scale < LIMITS.treeScaleMin || scale > LIMITS.treeScaleMax) {
      return void E.add('TREES', `${path}.scale is ${json(t.scale)}; it must be ${LIMITS.treeScaleMin}-${LIMITS.treeScaleMax}.`, `${path}.scale`);
    }
    if (fp && !inFootprint(t.x, t.z, fp, MARGIN)) return void E.add('OUTSIDE', `${path} (${t.x}, ${t.z}) is outside the footprint.`, path);
    out.trees.push({ kind: t.kind, x: t.x, y: t.y, z: t.z, rotY, scale });
  });
  return E.done('things', out);
}
