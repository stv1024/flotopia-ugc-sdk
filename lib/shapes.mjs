// Simple shapes for a package's meshes, merged by material (one mesh, so one draw call, a material), for
// glb.mjs. Boxes, cylinders and cones, balls, prisms (a polygon pushed up), gable roofs, and your own triangles.
// Each face gets planar uv (its two axes most across it, in metres × the material's scale: the city's materials
// their own, docs/city.md 3; 1 a metre for your own) and the vertex colour you give; the triangles face out.
//
//   import { Shapes, mat4 } from 'flotopia-ugc/lib/shapes.mjs';
//   import { writeGlb } from 'flotopia-ugc/lib/glb.mjs';
//   const s = new Shapes();
//   s.box('fc:plaster', [-5, 0.5, -4], [5, 3.5, 4], { color: [0.95, 0.92, 0.86] });
//   s.roof('fc:hull', [-5.3, -4.3], [5.3, 4.3], 3.5, 2, { ridge: 'x', color: [0.55, 0.3, 0.22] });
//   s.cylinder('fc:wood', [3, 0.5, 6], 0.15, 2.4, { sides: 8 });
//   s.prism({ name: 'pond', color: [0.2, 0.4, 0.5, 0.8] }, [[0, 0], [3, 0], [2, 2]], 0.3, 0.45);
//   s.box('fc:wood', [-0.5, 0, -0.5], [0.5, 0.8, 0.5], { matrix: mat4.compose([2, 0.5, 7], 0.6) }); // turned 0.6 rad
//   writeFileSync('dist/near.glb', writeGlb(s.meshes(), { log: 'near.glb' }));
//
// Options of every shape: color [r, g, b] or [r, g, b, a] (the vertex colour, 0–1, default white), matrix (16
// numbers, column-major: the shape is made at its numbers, then moved by it), uvScale (uv a metre).
// A material: as glb.mjs takes it ('fc:paving', or { color, roughness, map, ... }): the same string or object
// (or an equal one) is the same mesh.

export const UV_SCALE = { paving: 0.25, plaza: 1 / 16, concrete: 0.25, plaster: 0.25, wood: 0.4, sand: 0.2, grass: 0.15, metal: 0.25, hull: 0.25, glow: 0.25, gloss: 0.25, fabric: 0.25 };

export class Shapes {
  constructor() {
    this.groups = new Map(); // key → { material, P, N, C, U, I }
  }

  // a box from min to max (corners [x, y, z])
  box(material, min, max, o = {}) {
    const f = [];
    for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3, q = [];
      for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const p = [0, 0, 0];
        p[ax] = sg > 0 ? max[ax] : min[ax]; p[u] = a ? max[u] : min[u]; p[v] = b ? max[v] : min[v];
        q.push(p);
      }
      const n = [0, 0, 0]; n[ax] = sg;
      f.push({ q, n });
    }
    return this.faces(material, f, o);
  }

  // a cylinder standing on base [x, y, z]: radius r, height h. { sides: 16, top: r (a cone: smaller), caps: true }
  cylinder(material, base, r, h, o = {}) {
    const n = o.sides ?? 16, rt = o.top ?? r, [x, y, z] = base;
    if (!(n >= 3)) throw new Error('shapes: cylinder: sides ≥ 3');
    const P = [], N = [], I = [];
    const slope = (r - rt) / h; // the side's normal leans up by this
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), l = Math.hypot(1, slope);
      P.push([x + r * c, y, z + s * r], [x + rt * c, y + h, z + s * rt]);
      N.push([c / l, slope / l, s / l], [c / l, slope / l, s / l]);
    }
    for (let i = 0; i < n; i++) { const a = 2 * i; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.push(material, P, N, I, o);
    if (o.caps !== false) {
      const ring = (yy, rr) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [x + rr * Math.cos(a), yy, z + rr * Math.sin(a)]; });
      const f = [{ q: ring(y, r), n: [0, -1, 0] }];
      if (rt > 0) f.push({ q: ring(y + h, rt), n: [0, 1, 0] });
      this.faces(material, f, o);
    }
    return this;
  }

  // a ball: centre [x, y, z], radius r. { segments: 16 }
  sphere(material, centre, r, o = {}) {
    const n = o.segments ?? 16, [x, y, z] = centre, P = [], N = [], I = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= 2 * n; j++) {
      const t = (i / n) * Math.PI, f = (j / (2 * n)) * Math.PI * 2;
      const d = [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
      P.push([x + r * d[0], y + r * d[1], z + r * d[2]]);
      N.push(d);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
      const a = i * (2 * n + 1) + j, b = a + 2 * n + 1;
      if (i > 0) I.push(a, b, a + 1);
      if (i < n - 1) I.push(a + 1, b, b + 1);
    }
    return this.push(material, P, N, I, o);
  }

  // a prism: a polygon [[x, z], ...] (any simple one, either winding) from y0 up to y1. { caps: true }
  prism(material, poly, y0, y1, o = {}) {
    const ring = poly.map(([x, z]) => [x, z]);
    if (ring.length < 3) throw new Error('shapes: prism: a polygon of 3 points or more');
    if (area(ring) < 0) ring.reverse(); // counter-clockwise (area() > 0): the outward normal of an edge (dx, dz) is (dz, −dx)
    const f = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 1e-9) continue;
      f.push({ q: [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], n: [dz / l, 0, -dx / l] });
    }
    this.faces(material, f, o);
    if (o.caps !== false) {
      const tris = earcut(ring);
      const cap = (y, up) => {
        const P = ring.map(([x, z]) => [x, y, z]), N = ring.map(() => [0, up ? 1 : -1, 0]);
        this.push(material, P, N, tris.flat(), o);
      };
      cap(y1, true);
      if (o.bottom !== false) cap(y0, false);
    }
    return this;
  }

  // a gable roof over the rectangle [x0, z0] .. [x1, z1]: the eaves at y, the ridge h higher, along x or z
  // (ridge: 'x' | 'z', default along the longer side). { overhang: 0 (m, out past the rectangle on all sides,
  // the slope going on down), gables: true (the two triangular ends), under: true (the slopes' undersides) }
  roof(material, [x0, z0], [x1, z1], y, h, o = {}) {
    const ridge = o.ridge ?? (x1 - x0 >= z1 - z0 ? 'x' : 'z'), ov = o.overhang ?? 0;
    // made with the ridge along x, then turned for 'z' (swap x and z)
    const [a0, a1, b0, b1] = ridge === 'x' ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const half = (b1 - b0) / 2, mid = (b0 + b1) / 2, drop = (h / half) * ov;
    const A0 = a0 - ov, A1 = a1 + ov, B0 = b0 - ov, B1 = b1 + ov, ye = y - drop, yr = y + h;
    const sw = (p) => (ridge === 'x' ? p : [p[2], p[1], p[0]]);
    const nl = Math.hypot(h, half), f = [];
    const slope = (bEdge, sgn) => {
      const q = [[A0, ye, bEdge], [A1, ye, bEdge], [A1, yr, mid], [A0, yr, mid]].map(sw);
      const n = sw([0, half / nl, (sgn * h) / nl]);
      f.push({ q, n });
      if (o.under !== false) f.push({ q: [...q].reverse(), n: n.map((v) => -v) });
    };
    slope(B0, -1);
    slope(B1, 1);
    if (o.gables !== false) for (const [a, s] of [[a0, -1], [a1, 1]]) {
      f.push({ q: [[a, y, b0], [a, y, b1], [a, yr, mid]].map(sw), n: sw([s, 0, 0]) });
    }
    return this.faces(material, f, o);
  }

  // your own triangles: positions [[x, y, z], ...] or a Float32Array, normals the same, indices (optional)
  add(material, positions, normals, indices = null, o = {}) {
    const pts = (a) => (Array.isArray(a) ? a : Array.from({ length: a.length / 3 }, (_, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]]));
    const P = pts(positions), N = pts(normals);
    return this.push(material, P, N, indices ? Array.from(indices) : P.map((_, i) => i), o);
  }

  // the meshes for writeGlb: one a material, named by it (fc:paving → 'paving')
  meshes() {
    return [...this.groups.values()].map((g) => ({
      name: typeof g.material === 'string' ? g.material.replace(/^fc:/, '') : g.material.name ?? 'pbr',
      material: g.material,
      positions: new Float32Array(g.P), normals: new Float32Array(g.N), colors: new Float32Array(g.C), uvs: new Float32Array(g.U),
      indices: g.P.length / 3 > 65535 ? new Uint32Array(g.I) : new Uint16Array(g.I),
    }));
  }

  // how much: { triangles, vertices, meshes }
  get size() {
    let t = 0, v = 0;
    for (const g of this.groups.values()) { t += g.I.length / 3; v += g.P.length / 3; }
    return { triangles: t, vertices: v, meshes: this.groups.size };
  }

  // ---------------------------------------------------------------- inside

  // flat faces: { q: [points, a convex polygon], n: its outward normal }
  faces(material, list, o) {
    for (const { q, n } of list) {
      const P = q, N = q.map(() => n), I = [];
      for (let i = 1; i + 1 < q.length; i++) I.push(0, i, i + 1);
      this.push(material, P, N, I, o);
    }
    return this;
  }


  push(material, P, N, I, o) {
    const g = this.group(material), base = g.P.length / 3, M = o.matrix;
    const col = o.color ?? [1, 1, 1], k = col.length === 4 ? 4 : 3;
    if (g.k === undefined) g.k = k;
    if (g.k !== k) throw new Error('shapes: one material, one kind of colour (rgb or rgba)');
    const scale = o.uvScale ?? (typeof material === 'string' ? UV_SCALE[material.replace(/^fc:/, '')] ?? 0.25 : 1);
    const PP = P.map((p) => (M ? mat4.apply(M, p) : p));
    const NN = N.map((n) => (M ? norm(mat4.applyDir(M, n)) : n));
    for (let i = 0; i < PP.length; i++) {
      const p = PP[i], n = NN[i];
      g.P.push(p[0], p[1], p[2]); g.N.push(n[0], n[1], n[2]); g.C.push(...col.slice(0, k));
      // planar uv: drop the axis the normal is most along
      const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
      const [u, v] = ax === 0 ? [p[2], p[1]] : ax === 1 ? [p[0], p[2]] : [p[0], p[1]];
      g.U.push(u * scale, v * scale);
    }
    // each triangle facing its vertices' normals (counter-clockwise seen from outside)
    for (let t = 0; t + 2 < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const pa = PP[a], pb = PP[b], pc = PP[c];
      const cr = cross(sub(pb, pa), sub(pc, pa)), nn = add3(add3(NN[a], NN[b]), NN[c]);
      if (dot(cr, nn) < 0) g.I.push(base + a, base + c, base + b);
      else g.I.push(base + a, base + b, base + c);
    }
    return this;
  }

  group(material) {
    const key = typeof material === 'string' ? material : JSON.stringify(material, (k, v) => (v instanceof Uint8Array ? `#${v.byteLength}:${v.byteOffset}:${idOf(v)}` : v));
    if (!this.groups.has(key)) this.groups.set(key, { material, P: [], N: [], C: [], U: [], I: [] });
    return this.groups.get(key);
  }
}

const ids = new WeakMap();
let nextId = 1;
const idOf = (v) => { if (!ids.has(v)) ids.set(v, nextId++); return ids.get(v); };

// 4 × 4 matrices, column-major arrays of 16 (as glTF, three.js, fc.meshMatrix)
export const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  // about +y, a radians: +x turns toward −z (as three.js rotation.y; a heading h faces (sin h, 0, cos h))
  rotateY: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  scale: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  // a × b (b first, then a)
  multiply: (a, b) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
    return r;
  },
  // scale s, then turn yaw about +y, then move to at
  compose: (at, yaw = 0, s = 1) => mat4.multiply(mat4.translate(...at), mat4.multiply(mat4.rotateY(yaw), typeof s === 'number' ? mat4.scale(s) : mat4.scale(...s))),
  apply: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
  applyDir: (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// the signed area of a polygon [[x, z]] (> 0: counter-clockwise in the x–z plane drawn with x right, z down)
export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

// triangles of a simple polygon (ear clipping), [[i, j, k], ...], for a polygon with area() > 0
export function earcut(poly) {
  const idx = poly.map((_, i) => i), out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (cr(a, b, c) <= 0) continue; // a reflex corner
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) throw new Error('shapes: the polygon crosses itself');
  }
  out.push([idx[0], idx[1], idx[2]]);
  return out;
}
