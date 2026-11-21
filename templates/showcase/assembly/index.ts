// The showcase island: every capability of flotopia-ugc/1 in one small piece. A glass ball on a round deck:
//   shader + refract   it bends the picture behind it (fcScene), reflects the sky (fcEnv), catches the sun
//   target             two passes: the ball's back faces with the main camera (its thickness), a top-down map
//                      with a camera of its own (run now and then)
//   dynamic buffer     it wobbles when poked: positions written each tick while it moves
//   keepout            players walk up to it and lean on it; the camera's arm stops short of it
//   act + focus        at the act point: the camera round the ball, a panel (tint, wobble, a button, leave),
//                      the pointer pokes it or turns the view, the wheel zooms, B pokes, F leaves
//   sleep              still for 2 s: it ticks only twice a second, till something happens
import * as fc from "../../../assembly/fc";
export { fc_alloc } from "../../../assembly/fc";

const R: f32 = 2.0; // the ball's radius
const CY: f32 = 2.6; // its centre's height (the deck is at 0.5)
const SEG = 32, RING = 16;
const NV = (SEG + 1) * (RING + 1);
const rest = new Float32Array(NV * 3);
const dyn = new Float32Array(NV * 6); // this tick's positions, then normals (the dynamic buffer)
const M = new StaticArray<f32>(16), P = new StaticArray<f32>(16), V = new StaticArray<f32>(16);

let dynBuf: i32 = 0, glass: i32 = 0, topPass: i32 = 0;
let wobble: f32 = 0, quiet: f32 = 0, asleep = false, ticks: i32 = 0;
let focusing = false, dragging = false, az: f32 = 0.8, el: f32 = 0.35, dist: f32 = 12, lastX: f32 = 0, lastY: f32 = 0, amp: f32 = 1;
const TINTS: f32[] = [0.55, 0.8, 1.0, 1.0, 0.65, 0.5];

function identity(m: StaticArray<f32>): void { for (let i = 0; i < 16; i++) m[i] = i % 5 == 0 ? 1 : 0; }

function makeSphere(ib: Uint16Array): void {
  for (let r = 0; r <= RING; r++) for (let s = 0; s <= SEG; s++) {
    const t = <f32>Math.PI * <f32>r / <f32>RING, p = <f32>Math.PI * 2 * <f32>s / <f32>SEG, i = r * (SEG + 1) + s;
    const nx = Mathf.sin(t) * Mathf.cos(p), ny = Mathf.cos(t), nz = Mathf.sin(t) * Mathf.sin(p);
    rest[3 * i] = nx; rest[3 * i + 1] = ny; rest[3 * i + 2] = nz;
  }
  let k = 0;
  for (let r = 0; r < RING; r++) for (let s = 0; s < SEG; s++) {
    const a = r * (SEG + 1) + s, b = a + SEG + 1;
    ib[k++] = <u16>a; ib[k++] = <u16>(a + 1); ib[k++] = <u16>b;
    ib[k++] = <u16>(a + 1); ib[k++] = <u16>(b + 1); ib[k++] = <u16>b;
  }
}

// this tick's shape: the rest shape, rippled by the wobble (normals: the rest's; enough for a ripple)
function shape(time: f64): void {
  const w = <f32>(time * 8.0);
  for (let i = 0; i < NV; i++) {
    const nx = unchecked(rest[3 * i]), ny = unchecked(rest[3 * i + 1]), nz = unchecked(rest[3 * i + 2]);
    const k = R * (1 + wobble * amp * 0.1 * Mathf.sin(6 * ny + 3 * nx + w));
    unchecked(dyn[3 * i] = nx * k); unchecked(dyn[3 * i + 1] = ny * k); unchecked(dyn[3 * i + 2] = nz * k);
    unchecked(dyn[3 * NV + 3 * i] = nx); unchecked(dyn[3 * NV + 3 * i + 1] = ny); unchecked(dyn[3 * NV + 3 * i + 2] = nz);
  }
}

// an orthographic camera looking down at the ball (the top-down map): projection and view (island frame)
function topCamera(): void {
  const h: f32 = 4, n: f32 = 0.1, f: f32 = 40;
  for (let i = 0; i < 16; i++) { P[i] = 0; V[i] = 0; }
  P[0] = 1 / h; P[5] = 1 / h; P[10] = -2 / (f - n); P[14] = -(f + n) / (f - n); P[15] = 1;
  // from (0, 20, 0) down; up +z: camera x = +x, camera y = -z... (rows: right, up, back)
  V[0] = 1; V[6] = -1; V[9] = 1; V[14] = -20; V[15] = 1;
}

function poke(s: f32): void {
  wobble = Mathf.max(wobble, s);
  if (asleep) { asleep = false; quiet = 0; }
}

export function fc_init(seed: i32): void {
  const ib = new Uint16Array(SEG * RING * 6);
  makeSphere(ib);
  shape(0);
  dynBuf = fc.buffer(dyn, true);
  const ibuf = fc.buffer(ib);
  const geo = fc.geometry(`{"attributes":{"position":{"buffer":${dynBuf},"type":"f32","size":3,"count":${NV}},"normal":{"buffer":${dynBuf},"type":"f32","size":3,"offset":${NV * 12},"count":${NV}}},"index":{"buffer":${ibuf},"type":"u16","count":${ib.length}},"bounds":{"center":[0,0,0],"radius":${fc.num(R * 1.3)}}}`);
  glass = fc.material(`{"shader":{"vertex":"shaders/glass.vert","fragment":"shaders/glass.frag","uniforms":{"uTint":"vec3","uTop":"sampler2D","uBack":"sampler2D"},"host":["frame","light","refract"]}}`);
  const depthFront = fc.material(`{"shader":{"vertex":"shaders/depth.vert","fragment":"shaders/depth.frag"}}`);
  const depthBack = fc.material(`{"shader":{"vertex":"shaders/depth.vert","fragment":"shaders/depth.frag","side":"back"}}`);
  identity(M);
  M[13] = CY;
  const ball = fc.mesh(geo, glass, `{"layer":"refract","order":1}`);
  const topMesh = fc.mesh(geo, depthFront, `{"layer":"pass"}`);
  const backMesh = fc.mesh(geo, depthBack, `{"layer":"pass"}`);
  for (let i = 0; i < 3; i++) fc.meshMatrix(i == 0 ? ball : i == 1 ? topMesh : backMesh, M);
  const top = fc.target(`{"width":256,"height":256,"format":"r16f","depth":true}`);
  const back = fc.target(`{"screen":0.5,"format":"r16f","depth":true}`);
  topPass = fc.pass(`{"target":${top},"meshes":[${topMesh}],"camera":"own","stage":"frame","clear":[0,0,0,1]}`);
  fc.pass(`{"target":${back},"meshes":[${backMesh}],"camera":"main","stage":"refract","clear":[0,0,0,0]}`);
  topCamera();
  fc.passCamera(topPass, P, V);
  fc.passRun(topPass);
  fc.uniformTarget(glass, "uTop", top);
  fc.uniformTarget(glass, "uBack", back);
  fc.uniform3(glass, "uTint", TINTS[0], TINTS[1], TINTS[2]);
  // the keep-out: the ball as signed distances, 0.2 m cells
  const n = 31, c: f32 = 0.2, o: f32 = -3.0;
  const grid = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = o + c * <f32>x, py = CY + o + c * <f32>y, pz = o + c * <f32>z;
    grid[x + n * (y + n * z)] = Mathf.sqrt(px * px + (py - CY) * (py - CY) + pz * pz) - R;
  }
  fc.keepout(`{"origin":[${fc.num(o)},${fc.num(CY + o)},${fc.num(o)}],"cell":${fc.num(c)},"dims":[${n},${n},${n}],"keep":0.15,"arm":0.35,"radius":6}`, grid);
  fc.act(`{"x":0,"y":0.5,"z":${fc.num(R + 3)},"r":2.5,"dy":1.5,"hint":{"zh":"摸一摸玻璃球","en":"Touch the glass ball"}}`);
  fc.log("showcase: ready, seed " + seed.toString());
}

function enterFocus(): void {
  focusing = true;
  fc.focus(`{"keys":["KeyB","KeyF"]}`);
  fc.panel(`{"title":{"zh":"玻璃球","en":"GLASS BALL"},"items":[` +
    `{"swatches":{"id":1,"value":0,"options":[{"colors":["#8cccff","#3f93ea"],"stops":[60],"title":{"zh":"冰蓝","en":"Ice"}},{"colors":["#ffb27f","#e8603c"],"stops":[60],"title":{"zh":"琥珀","en":"Amber"}}]}},` +
    `{"label":{"zh":"波动","en":"Wobble"}},{"slider":{"id":2,"min":0,"max":100,"value":50}},` +
    `{"buttons":[{"id":3,"key":"B","text":{"zh":"拍一下","en":"Poke"}}]},` +
    `{"leave":{"key":"F","text":{"zh":"离开","en":"Leave"}}}]}`);
}

// does the ray (island frame) hit the ball?
function hits(f: fc.Inbox, e: i32): bool {
  const ox = f.v(e, 0), oy = f.v(e, 1) - CY, oz = f.v(e, 2), dx = f.v(e, 3), dy = f.v(e, 4), dz = f.v(e, 5);
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - R * R;
  return b * b - c >= 0 && -b > 0;
}

export function fc_tick(inbox: usize, len: i32): void {
  const f = new fc.Inbox(inbox);
  const dt = Mathf.min(f.dt, 0.1);
  ticks++;
  for (let e = 0; e < f.count; e++) {
    const k = f.kind(e);
    if (k == fc.Ev.ACT) enterFocus();
    else if (k == fc.Ev.FOCUS_END) { focusing = false; dragging = false; }
    else if (k == fc.Ev.KEY) {
      if (f.a(e) == 0) poke(1);
      else { fc.focusEnd(); focusing = false; dragging = false; }
    } else if (k == fc.Ev.PANEL) {
      const id = f.a(e), v = f.v(e, 0);
      if (id == 1) { const t = <i32>v; fc.uniform3(glass, "uTint", TINTS[3 * t], TINTS[3 * t + 1], TINTS[3 * t + 2]); }
      else if (id == 2) amp = v / 50;
      else if (id == 3) poke(1);
    } else if (k == fc.Ev.POINTER_DOWN) {
      if (f.a(e) == 0 && hits(f, e)) { poke(1); fc.log("showcase: poked"); }
      else { dragging = true; lastX = f.v(e, 6); lastY = f.v(e, 7); }
    } else if (k == fc.Ev.POINTER_MOVE) {
      if (dragging) {
        az -= (f.v(e, 6) - lastX) * 0.006;
        el = Mathf.max(0.05, Mathf.min(1.3, el + (f.v(e, 7) - lastY) * 0.005));
        lastX = f.v(e, 6); lastY = f.v(e, 7);
      } else fc.focusCursor(hits(f, e) ? fc.Cursor.POINTER : fc.Cursor.DEFAULT);
    } else if (k == fc.Ev.POINTER_UP) dragging = false;
    else if (k == fc.Ev.WHEEL) dist = Mathf.max(6, Mathf.min(30, dist * Mathf.exp(f.v(e, 0) * 0.001)));
  }
  // a player leaning on it makes it shiver
  const fx = f.feet(0), fz = f.feet(2);
  if (f.mode == fc.Mode.WALK && fx * fx + fz * fz < (R + 0.6) * (R + 0.6)) poke(0.25);
  if (wobble > 0.001) {
    shape(f.time);
    fc.bufferWrite(dynBuf, dyn);
    wobble *= Mathf.exp(-1.5 * dt);
    quiet = 0;
  } else quiet += dt;
  if (ticks % 30 == 0 && f.has(fc.Flag.SUN)) fc.passRun(topPass);
  if (focusing) {
    const ce = Mathf.cos(el);
    fc.focusCamera(dist * Mathf.sin(az) * ce, CY + dist * Mathf.sin(el), dist * Mathf.cos(az) * ce, 0, CY, 0);
  }
  if (!asleep && !focusing && quiet > 2) { asleep = true; fc.sleep(0.5, 1.0); }
}
