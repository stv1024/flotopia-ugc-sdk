// flotopia-ugc/1: the host interface for AssemblyScript (docs/abi.md is the contract; this file only wraps it).
//
// Your entry file re-exports the three functions the host calls and writes init() and tick():
//
//   import * as fc from "flotopia-ugc/assembly/fc";
//   export { fc_alloc } from "flotopia-ugc/assembly/fc";
//   export function fc_init(seed: i32): void { ... }
//   export function fc_tick(inbox: usize, len: i32): void { const f = new fc.Inbox(inbox); ... }

// ------------------------------------------------------------------ the imports (module "fc")

@external("fc", "log") declare function _log(ptr: usize, len: i32): void;
@external("fc", "buffer") declare function _buffer(ptr: usize, len: i32, dynamic: i32): i32;
@external("fc", "buffer_write") declare function _buffer_write(id: i32, offset: i32, ptr: usize, len: i32): void;
@external("fc", "geometry") declare function _geometry(json: usize, len: i32): i32;
@external("fc", "geometry_range") declare function _geometry_range(geo: i32, start: i32, count: i32): i32;
@external("fc", "texture") declare function _texture(path: usize, len: i32): i32;
@external("fc", "target") declare function _target(json: usize, len: i32): i32;
@external("fc", "material") declare function _material(json: usize, len: i32): i32;
@external("fc", "uniform") declare function _uniform(mat: i32, name: usize, len: i32, values: usize, n: i32): void;
@external("fc", "uniform_tex") declare function _uniform_tex(mat: i32, name: usize, len: i32, kind: i32, id: i32): void;
@external("fc", "mesh") declare function _mesh(geo: i32, mat: i32, json: usize, len: i32): i32;
@external("fc", "mesh_matrix") declare function _mesh_matrix(mesh: i32, ptr: usize): void;
@external("fc", "mesh_visible") declare function _mesh_visible(mesh: i32, on: i32): void;
@external("fc", "node_visible") declare function _node_visible(name: usize, len: i32, on: i32): void;
@external("fc", "pass") declare function _pass(json: usize, len: i32): i32;
@external("fc", "pass_camera") declare function _pass_camera(pass: i32, proj: usize, view: usize): void;
@external("fc", "pass_run") declare function _pass_run(pass: i32): void;
@external("fc", "act") declare function _act(json: usize, len: i32): i32;
@external("fc", "act_enable") declare function _act_enable(act: i32, on: i32): void;
@external("fc", "focus") declare function _focus(json: usize, len: i32): void;
@external("fc", "focus_camera") declare function _focus_camera(eye: usize, target: usize): void;
@external("fc", "focus_cursor") declare function _focus_cursor(kind: i32): void;
@external("fc", "focus_end") declare function _focus_end(): void;
@external("fc", "panel") declare function _panel(json: usize, len: i32): void;
@external("fc", "keepout") declare function _keepout(json: usize, len: i32, grid: usize, bytes: i32): void;
@external("fc", "sleep") declare function _sleep(interval: f32, wake: f32): void;

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

export function log(s: string): void { const b = utf8(s); _log(changetype<usize>(b), b.byteLength); }

// bytes for geometry (a typed array: its bytes as they are)
export function buffer<T extends ArrayBufferView>(data: T, dynamic: bool = false): i32 {
  return _buffer(data.dataStart, data.byteLength, dynamic ? 1 : 0);
}
export function bufferWrite<T extends ArrayBufferView>(id: i32, data: T, offset: i32 = 0): void {
  _buffer_write(id, offset, data.dataStart, data.byteLength);
}
export function bufferWriteRaw(id: i32, offset: i32, ptr: usize, len: i32): void { _buffer_write(id, offset, ptr, len); }

export function geometry(json: string): i32 { const b = utf8(json); return _geometry(changetype<usize>(b), b.byteLength); }
export function geometryRange(geo: i32, start: i32, count: i32): i32 { return _geometry_range(geo, start, count); }
export function texture(path: string): i32 { const b = utf8(path); return _texture(changetype<usize>(b), b.byteLength); }
export function target(json: string): i32 { const b = utf8(json); return _target(changetype<usize>(b), b.byteLength); }
export function material(json: string): i32 { const b = utf8(json); return _material(changetype<usize>(b), b.byteLength); }

// a uniform: 1, 2, 3, 4, 9 or 16 floats
export function uniform(mat: i32, name: string, values: StaticArray<f32>): void {
  const b = utf8(name);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(values), values.length);
}
export function uniform1(mat: i32, name: string, x: f32): void {
  const b = utf8(name), v = scratch;
  unchecked(v[0] = x);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 1);
}
export function uniform3(mat: i32, name: string, x: f32, y: f32, z: f32): void {
  const b = utf8(name), v = scratch;
  unchecked(v[0] = x); unchecked(v[1] = y); unchecked(v[2] = z);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 3);
}
export function uniform4(mat: i32, name: string, x: f32, y: f32, z: f32, w: f32): void {
  const b = utf8(name), v = scratch;
  unchecked(v[0] = x); unchecked(v[1] = y); unchecked(v[2] = z); unchecked(v[3] = w);
  _uniform(mat, changetype<usize>(b), b.byteLength, changetype<usize>(v), 4);
}
const scratch = new StaticArray<f32>(16);

export function uniformTexture(mat: i32, name: string, tex: i32): void { const b = utf8(name); _uniform_tex(mat, changetype<usize>(b), b.byteLength, 0, tex); }
export function uniformTarget(mat: i32, name: string, target: i32): void { const b = utf8(name); _uniform_tex(mat, changetype<usize>(b), b.byteLength, 1, target); }

export function mesh(geo: i32, mat: i32, json: string = "{}"): i32 { const b = utf8(json); return _mesh(geo, mat, changetype<usize>(b), b.byteLength); }
// a matrix: 16 floats, column-major, island frame
export function meshMatrix(mesh: i32, m: StaticArray<f32>): void { _mesh_matrix(mesh, changetype<usize>(m)); }
export function meshVisible(mesh: i32, on: bool): void { _mesh_visible(mesh, on ? 1 : 0); }
export function nodeVisible(name: string, on: bool): void { const b = utf8(name); _node_visible(changetype<usize>(b), b.byteLength, on ? 1 : 0); }

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
