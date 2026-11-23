// The smallest island with code: a box turns on a round deck; at the act point the player makes it turn faster.
import * as fc from "flotopia-ugc/assembly/fc";
export { fc_alloc } from "flotopia-ugc/assembly/fc";

let mesh: i32 = 0;
let speed: f32 = 0.5;
let angle: f64 = 0;
const m = new StaticArray<f32>(16);

// a box from -h to h, flat-shaded: positions and normals interleaved in two buffers
function box(h: f32): i32 {
  const P = new Float32Array(36 * 3), N = new Float32Array(36 * 3);
  const faces: f32[] = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
  let v = 0;
  for (let f = 0; f < 6; f++) {
    const nx = faces[3 * f], ny = faces[3 * f + 1], nz = faces[3 * f + 2];
    // two axes across the face
    const ux: f32 = ny != 0 || nz != 0 ? 1 : 0, uy: f32 = nx != 0 ? 1 : 0, uz: f32 = 0;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const cs: f32[] = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    for (let k = 0; k < 6; k++) {
      const a = cs[2 * k], b = cs[2 * k + 1];
      P[3 * v] = h * (nx + a * ux + b * wx); P[3 * v + 1] = h * (ny + a * uy + b * wy); P[3 * v + 2] = h * (nz + a * uz + b * wz);
      N[3 * v] = nx; N[3 * v + 1] = ny; N[3 * v + 2] = nz;
      v++;
    }
    // (winding: outward)
    const i0 = 3 * (v - 6);
    const ex = P[i0 + 3] - P[i0], ey = P[i0 + 4] - P[i0 + 1], ez = P[i0 + 5] - P[i0 + 2];
    const gx = P[i0 + 6] - P[i0], gy = P[i0 + 7] - P[i0 + 1], gz = P[i0 + 8] - P[i0 + 2];
    if ((ey * gz - ez * gy) * nx + (ez * gx - ex * gz) * ny + (ex * gy - ey * gx) * nz < 0) {
      for (let t = 0; t < 2; t++) for (let c = 0; c < 3; c++) {
        const j = 3 * (v - 6 + 3 * t + 1) + c, k = 3 * (v - 6 + 3 * t + 2) + c;
        const s = P[j]; P[j] = P[k]; P[k] = s;
      }
    }
  }
  const pb = fc.buffer(P), nb = fc.buffer(N);
  return fc.geometry(`{"attributes":{"position":{"buffer":${pb},"type":"f32","size":3,"count":36},"normal":{"buffer":${nb},"type":"f32","size":3,"count":36}},"bounds":{"center":[0,0,0],"radius":${fc.num(h * 1.8)}}}`);
}

export function fc_init(seed: i32): void {
  const geo = box(1.5);
  const mat = fc.material(`{"standard":{"color":[0.95,0.55,0.2],"roughness":0.5}}`);
  mesh = fc.mesh(geo, mat, `{"castShadow":true,"receiveShadow":true}`);
  fc.act(`{"x":0,"y":0.5,"z":6,"r":2.5,"dy":1.5,"hint":{"zh":"转快一点","en":"Spin faster"}}`);
  fc.log("minimal: ready, seed " + seed.toString());
}

export function fc_tick(inbox: usize, len: i32): void {
  const f = new fc.Inbox(inbox);
  for (let e = 0; e < f.count; e++) if (f.kind(e) == fc.Ev.ACT) { speed = speed > 3 ? 0.5 : speed * 2; fc.log("minimal: speed " + speed.toString()); }
  // the angle from the world clock: every player sees the same
  angle = f.time * <f64>speed;
  fc.meshMatrix(mesh, fc.Mat4.compose(m, 0, 2.6, 0, <f32>(angle % (2 * Math.PI))));
}
