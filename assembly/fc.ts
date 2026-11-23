// flotopia-ugc/1: the host interface for AssemblyScript (docs/abi.md is the contract; this file only wraps it).
//
// Your entry file re-exports the three functions the host calls and writes init() and tick():
//
//   import * as fc from "flotopia-ugc/assembly/fc";
//   export { fc_alloc } from "flotopia-ugc/assembly/fc";
//   export function fc_init(seed: i32): void { ... }
//   export function fc_tick(inbox: usize, len: i32): void { const f = new fc.Inbox(inbox); ... }

// ------------------------------------------------------------------ the imports (module "fc")
// (exported too: call them yourself when the wrappers below do more than you want)

@external("fc", "log") export declare function _log(ptr: usize, len: i32): void;
@external("fc", "buffer") export declare function _buffer(ptr: usize, len: i32, dynamic: i32): i32;
@external("fc", "buffer_write") export declare function _buffer_write(id: i32, offset: i32, ptr: usize, len: i32): void;
@external("fc", "geometry") export declare function _geometry(json: usize, len: i32): i32;
@external("fc", "geometry_range") export declare function _geometry_range(geo: i32, start: i32, count: i32): i32;
@external("fc", "texture") export declare function _texture(path: usize, len: i32): i32;
@external("fc", "target") export declare function _target(json: usize, len: i32): i32;
@external("fc", "material") export declare function _material(json: usize, len: i32): i32;
@external("fc", "uniform") export declare function _uniform(mat: i32, name: usize, len: i32, values: usize, n: i32): void;
@external("fc", "uniform_tex") export declare function _uniform_tex(mat: i32, name: usize, len: i32, kind: i32, id: i32): void;
@external("fc", "mesh") export declare function _mesh(geo: i32, mat: i32, json: usize, len: i32): i32;
@external("fc", "mesh_matrix") export declare function _mesh_matrix(mesh: i32, ptr: usize): void;
@external("fc", "mesh_visible") export declare function _mesh_visible(mesh: i32, on: i32): void;
@external("fc", "node_visible") export declare function _node_visible(name: usize, len: i32, on: i32): void;
@external("fc", "pass") export declare function _pass(json: usize, len: i32): i32;
@external("fc", "pass_camera") export declare function _pass_camera(pass: i32, proj: usize, view: usize): void;
@external("fc", "pass_run") export declare function _pass_run(pass: i32): void;
@external("fc", "act") export declare function _act(json: usize, len: i32): i32;
@external("fc", "act_enable") export declare function _act_enable(act: i32, on: i32): void;
@external("fc", "focus") export declare function _focus(json: usize, len: i32): void;
@external("fc", "focus_camera") export declare function _focus_camera(eye: usize, target: usize): void;
@external("fc", "focus_cursor") export declare function _focus_cursor(kind: i32): void;
@external("fc", "focus_end") export declare function _focus_end(): void;
@external("fc", "panel") export declare function _panel(json: usize, len: i32): void;
@external("fc", "keepout") export declare function _keepout(json: usize, len: i32, grid: usize, bytes: i32): void;
@external("fc", "sleep") export declare function _sleep(interval: f32, wake: f32): void;

// ------------------------------------------------------------------ constants

export const INBOX_BYTES: i32 = 16384;

export namespace Flag {
  export const FOCUS: u32 = 1;
  export const PLAYER: u32 = 2;
  export const SUN: u32 = 4;
}

export namespace Mode {
  export const NONE: u32 = 0;
  export const WALK: u32 = 1;
  export const AIR: u32 = 2;
  export const FLY: u32 = 3;
  export const DOWN: u32 = 4;
  export const SWIM: u32 = 5;
  export const RIDE: u32 = 6;
  export const OTHER: u32 = 7;
}

export namespace Ev {
  export const ACT: u32 = 1;
  export const FOCUS_END: u32 = 2;
  export const POINTER_DOWN: u32 = 3;
  export const POINTER_MOVE: u32 = 4;
  export const POINTER_UP: u32 = 5;
  export const WHEEL: u32 = 6;
  export const KEY: u32 = 7;
  export const PANEL: u32 = 8;
  export const GAMEPAD: u32 = 9;
}

export namespace Cursor {
  export const DEFAULT: i32 = 0;
  export const GRAB: i32 = 1;
  export const GRABBING: i32 = 2;
  export const POINTER: i32 = 3;
}

// ------------------------------------------------------------------ the inbox

let inbox: ArrayBuffer | null = null;

// called once by the host: memory for the inbox
export function fc_alloc(bytes: i32): usize {
  inbox = new ArrayBuffer(bytes);
  return changetype<usize>(inbox);
}

// the inbox of this tick (docs/abi.md 3.3)
export class Inbox {
  constructor(public p: usize) {}
  get time(): f64 { return load<f64>(this.p); }
  get dt(): f32 { return load<f32>(this.p + 8); }
  get flags(): u32 { return load<u32>(this.p + 12); }
  has(flag: u32): bool { return (this.flags & flag) != 0; }
  // camera position, forward; player feet, velocity; toward the sun: (i = 0, 1, 2 for x, y, z)
  eye(i: i32): f32 { return load<f32>(this.p + 16 + 4 * i); }
  fwd(i: i32): f32 { return load<f32>(this.p + 28 + 4 * i); }
  feet(i: i32): f32 { return load<f32>(this.p + 40 + 4 * i); }
  vel(i: i32): f32 { return load<f32>(this.p + 52 + 4 * i); }
  get mode(): u32 { return load<u32>(this.p + 64); }
  sun(i: i32): f32 { return load<f32>(this.p + 68 + 4 * i); }
  get night(): f32 { return load<f32>(this.p + 80); }
  get width(): f32 { return load<f32>(this.p + 84); }
  get height(): f32 { return load<f32>(this.p + 88); }
  get count(): i32 { return load<u32>(this.p + 92); }
  kind(e: i32): u32 { return load<u32>(this.p + 96 + 48 * e); }
  a(e: i32): u32 { return load<u32>(this.p + 100 + 48 * e); }
  v(e: i32, k: i32): f32 { return load<f32>(this.p + 104 + 48 * e + 4 * k); }
}

// ------------------------------------------------------------------ the calls

function utf8(s: string): ArrayBuffer { return String.UTF8.encode(s, false); }

// a name encoded once (a uniform's, a node's), for calls made every tick: no string encoded, nothing allocated
//   const U_TIME = new fc.Name("uTime");  ...  fc.uniform1(mat, U_TIME, t);
// (the calls that take a name take a string or a Name)
export class Name {
  readonly bytes: ArrayBuffer;
  constructor(s: string) { this.bytes = utf8(s); }
}
// @ts-ignore: decorator
@inline function nameBytes<N>(name: N): ArrayBuffer {
  if (isString<N>()) return utf8(changetype<string>(name));
  return changetype<Name>(name).bytes;
}

export function log(s: string): void { const b = utf8(s); _log(changetype<usize>(b), b.byteLength); }

// bytes for geometry: a typed array (Float32Array, Uint16Array, ...) or a StaticArray of numbers (StaticArray<f32>,
// e.g. vertices your build script wrote into a .ts file), their bytes as they are
export function buffer<T>(data: T, dynamic: bool = false): i32 {
  // @ts-ignore: compile-time
  if (isDefined(data.dataStart)) return _buffer(data.dataStart, data.byteLength, dynamic ? 1 : 0);
  // @ts-ignore: a StaticArray
  return _buffer(changetype<usize>(data), data.length * sizeof<valueof<T>>(), dynamic ? 1 : 0);
}
export function bufferWrite<T>(id: i32, data: T, offset: i32 = 0): void {
  // @ts-ignore: compile-time
  if (isDefined(data.dataStart)) { _buffer_write(id, offset, data.dataStart, data.byteLength); return; }
  // @ts-ignore: a StaticArray
  _buffer_write(id, offset, changetype<usize>(data), data.length * sizeof<valueof<T>>());
}
export function bufferWriteRaw(id: i32, offset: i32, ptr: usize, len: i32): void { _buffer_write(id, offset, ptr, len); }

export function geometry(json: string): i32 { const b = utf8(json); return _geometry(changetype<usize>(b), b.byteLength); }
export function geometryRange(geo: i32, start: i32, count: i32): i32 { return _geometry_range(geo, start, count); }
export function texture(path: string): i32 { const b = utf8(path); return _texture(changetype<usize>(b), b.byteLength); }
export function target(json: string): i32 { const b = utf8(json); return _target(changetype<usize>(b), b.byteLength); }
export function material(json: string): i32 { const b = utf8(json); return _material(changetype<usize>(b), b.byteLength); }

// a uniform: 1, 2, 3, 4, 9 or 16 floats
export function uniform<N>(mat: i32, name: N, values: StaticArray<f32>): void {
  const b = nameBytes(name);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(values), values.length);
}
export function uniform1<N>(mat: i32, name: N, x: f32): void {
  const b = nameBytes(name), v = scratch;
  unchecked(v[0] = x);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 1);
}
export function uniform3<N>(mat: i32, name: N, x: f32, y: f32, z: f32): void {
  const b = nameBytes(name), v = scratch;
  unchecked(v[0] = x); unchecked(v[1] = y); unchecked(v[2] = z);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 3);
}
export function uniform4<N>(mat: i32, name: N, x: f32, y: f32, z: f32, w: f32): void {
  const b = nameBytes(name), v = scratch;
  unchecked(v[0] = x); unchecked(v[1] = y); unchecked(v[2] = z); unchecked(v[3] = w);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 4);
}
const scratch = new StaticArray<f32>(16);

export function uniformTexture<N>(mat: i32, name: N, tex: i32): void { const b = nameBytes(name); _uniform_tex(mat, changetype<usize>(b), b.byteLength, 0, tex); }
export function uniformTarget<N>(mat: i32, name: N, target: i32): void { const b = nameBytes(name); _uniform_tex(mat, changetype<usize>(b), b.byteLength, 1, target); }

export function mesh(geo: i32, mat: i32, json: string = "{}"): i32 { const b = utf8(json); return _mesh(geo, mat, changetype<usize>(b), b.byteLength); }
// a matrix: 16 floats, column-major, island frame
export function meshMatrix(mesh: i32, m: StaticArray<f32>): void { _mesh_matrix(mesh, changetype<usize>(m)); }
export function meshVisible(mesh: i32, on: bool): void { _mesh_visible(mesh, on ? 1 : 0); }
export function nodeVisible<N>(name: N, on: bool): void { const b = nameBytes(name); _node_visible(changetype<usize>(b), b.byteLength, on ? 1 : 0); }

export function pass(json: string): i32 { const b = utf8(json); return _pass(changetype<usize>(b), b.byteLength); }
export function passCamera(pass: i32, proj: StaticArray<f32>, view: StaticArray<f32>): void { _pass_camera(pass, changetype<usize>(proj), changetype<usize>(view)); }
export function passRun(pass: i32): void { _pass_run(pass); }

export function act(json: string): i32 { const b = utf8(json); return _act(changetype<usize>(b), b.byteLength); }
export function actEnable(act: i32, on: bool): void { _act_enable(act, on ? 1 : 0); }

export function focus(json: string): void { const b = utf8(json); _focus(changetype<usize>(b), b.byteLength); }
export function focusCamera(ex: f32, ey: f32, ez: f32, tx: f32, ty: f32, tz: f32): void {
  const e = scratch, t = scratch2;
  unchecked(e[0] = ex); unchecked(e[1] = ey); unchecked(e[2] = ez);
  unchecked(t[0] = tx); unchecked(t[1] = ty); unchecked(t[2] = tz);
  _focus_camera(changetype<usize>(e), changetype<usize>(t));
}
const scratch2 = new StaticArray<f32>(4);
export function focusCursor(kind: i32): void { _focus_cursor(kind); }
export function focusEnd(): void { _focus_end(); }
export function panel(json: string): void { const b = utf8(json); _panel(changetype<usize>(b), b.byteLength); }

// a solid the player and the camera keep out of (docs/abi.md 3.8): grid of nx·ny·nz signed distances (m)
export function keepout(json: string, grid: Float32Array): void {
  const b = utf8(json);
  _keepout(changetype<usize>(b), b.byteLength, grid.dataStart, grid.byteLength);
}

export function sleep(interval: f32, wake: f32): void { _sleep(interval, wake); }

// ------------------------------------------------------------------ small helpers

// a number for JSON (no NaN, no Infinity)
export function num(x: f64): string { return isFinite(x) ? x.toString() : "0"; }

// a string for JSON, in quotes
export function str(s: string): string {
  let o = "\"";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c == 34) o += "\\\"";
    else if (c == 92) o += "\\\\";
    else if (c < 32) o += c == 10 ? "\\n" : " ";
    else o += String.fromCharCode(c);
  }
  return o + "\"";
}

// ------------------------------------------------------------------ matrices
// 4 × 4, column-major, in a StaticArray<f32>(16) (meshMatrix, passCamera). They write into `m` (nothing allocated:
// fine every tick) and give it back.
//   const M = new StaticArray<f32>(16);
//   fc.meshMatrix(door, fc.Mat4.compose(M, 2, 0.5, 4, angle, 1));   // turned `angle` about +y, at (2, 0.5, 4)
export namespace Mat4 {
  export function identity(m: StaticArray<f32>): StaticArray<f32> {
    for (let i = 0; i < 16; i++) unchecked(m[i] = i % 5 == 0 ? 1 : 0);
    return m;
  }
  export function translate(m: StaticArray<f32>, x: f32, y: f32, z: f32): StaticArray<f32> {
    identity(m);
    unchecked(m[12] = x); unchecked(m[13] = y); unchecked(m[14] = z);
    return m;
  }
  // about +y, a radians: +x turns toward −z (as three.js rotation.y; a heading h faces (sin h, 0, cos h))
  export function rotateY(m: StaticArray<f32>, a: f32): StaticArray<f32> {
    identity(m);
    const c = Mathf.cos(a), s = Mathf.sin(a);
    unchecked(m[0] = c); unchecked(m[2] = -s); unchecked(m[8] = s); unchecked(m[10] = c);
    return m;
  }
  export function scale(m: StaticArray<f32>, x: f32, y: f32, z: f32): StaticArray<f32> {
    identity(m);
    unchecked(m[0] = x); unchecked(m[5] = y); unchecked(m[10] = z);
    return m;
  }
  // scale s, then turn yaw about +y, then move to (x, y, z): the matrix most meshes need
  export function compose(m: StaticArray<f32>, x: f32, y: f32, z: f32, yaw: f32, s: f32 = 1): StaticArray<f32> {
    const c = Mathf.cos(yaw) * s, n = Mathf.sin(yaw) * s;
    unchecked(m[0] = c); unchecked(m[1] = 0); unchecked(m[2] = -n); unchecked(m[3] = 0);
    unchecked(m[4] = 0); unchecked(m[5] = s); unchecked(m[6] = 0); unchecked(m[7] = 0);
    unchecked(m[8] = n); unchecked(m[9] = 0); unchecked(m[10] = c); unchecked(m[11] = 0);
    unchecked(m[12] = x); unchecked(m[13] = y); unchecked(m[14] = z); unchecked(m[15] = 1);
    return m;
  }
  // out = a × b (b first, then a). out may be a or b
  export function multiply(out: StaticArray<f32>, a: StaticArray<f32>, b: StaticArray<f32>): StaticArray<f32> {
    for (let c = 0; c < 4; c++) {
      const b0 = unchecked(b[c * 4]), b1 = unchecked(b[c * 4 + 1]), b2 = unchecked(b[c * 4 + 2]), b3 = unchecked(b[c * 4 + 3]);
      for (let r = 0; r < 4; r++) unchecked(tmp[c * 4 + r] = unchecked(a[r]) * b0 + unchecked(a[4 + r]) * b1 + unchecked(a[8 + r]) * b2 + unchecked(a[12 + r]) * b3);
    }
    for (let i = 0; i < 16; i++) unchecked(out[i] = tmp[i]);
    return out;
  }
  const tmp = new StaticArray<f32>(16);
}

// ------------------------------------------------------------------ the panel (docs/abi.md 3.7)
// Its JSON written for you, the texts escaped:
//   const p = new fc.Panel("茶席", "TEA");
//   p.swatches(1, 0).option(["#f3c1c6"], "樱饼", "Sakura").option(["#9fc28a"], "团子", "Dango");
//   p.label("甜 — 淡", "Sweet — Plain").slider(2, 0, 100, 50);
//   p.button(3, "上茶", "Serve", "B").button(4, "收拾", "Clear");   // one row (up to 4)
//   p.leave("离开", "Leave");
//   fc.focus(`{"keys":["KeyB"]}`); p.show();
// A key ("B") is only the key cap drawn on the button: put its code ("KeyB") in focus.keys and act on its KEY event.
export class Panel {
  private items: string[] = [];
  private row: string[] | null = null;
  private opts: string[] | null = null;
  private swatch: string = "";
  constructor(private zh: string, private en: string) {}
  private text(zh: string, en: string): string { return `{"zh":${str(zh)},"en":${str(en)}}`; }
  private close(): void {
    if (this.row) { this.items.push(`{"buttons":[${this.row!.join(",")}]}`); this.row = null; }
    if (this.opts) { this.items.push(`{"swatches":{${this.swatch},"options":[${this.opts!.join(",")}]}}`); this.opts = null; }
  }
  label(zh: string, en: string): Panel { this.close(); this.items.push(`{"label":${this.text(zh, en)}}`); return this; }
  slider(id: i32, min: f64, max: f64, value: f64, step: f64 = 1): Panel {
    this.close();
    this.items.push(`{"slider":{"id":${id},"min":${num(min)},"max":${num(max)},"value":${num(value)},"step":${num(step)}}}`);
    return this;
  }
  // a row of swatches: then option() for each (up to 8)
  swatches(id: i32, value: i32 = 0): Panel { this.close(); this.swatch = `"id":${id},"value":${value}`; this.opts = []; return this; }
  // colours "#rrggbb" (1–4), stops (0–100, one fewer than the colours) or none
  option(colors: string[], zh: string, en: string, stops: f64[] | null = null): Panel {
    if (!this.opts) this.swatches(0);
    const cs: string[] = [];
    for (let i = 0; i < colors.length; i++) cs.push(str(colors[i]));
    let s = `{"colors":[${cs.join(",")}],"title":${this.text(zh, en)}`;
    if (stops) { const ss: string[] = []; const st = stops; for (let i = 0; i < st.length; i++) ss.push(num(st[i])); s += `,"stops":[${ss.join(",")}]`; }
    this.opts!.push(s + "}");
    return this;
  }
  // a button, in the row of buttons going on (a new row after 4, or after another kind of item)
  button(id: i32, zh: string, en: string, key: string = ""): Panel {
    if (this.opts) this.close();
    if (this.row && this.row!.length >= 4) this.close();
    if (!this.row) this.row = [];
    this.row!.push(`{"id":${id},"text":${this.text(zh, en)}${key.length ? `,"key":${str(key)}` : ""}}`);
    return this;
  }
  leave(zh: string, en: string, key: string = ""): Panel {
    this.close();
    this.items.push(`{"leave":{"text":${this.text(zh, en)}${key.length ? `,"key":${str(key)}` : ""}}}`);
    return this;
  }
  json(): string { this.close(); return `{"title":${this.text(this.zh, this.en)},"items":[${this.items.join(",")}]}`; }
  show(): void { panel(this.json()); }
}
