// Where a player can walk, from ground.json: the host's walking rules (docs/city.md 2) on a grid, for check's
// warnings. Not the host's code: an approximation on a grid of STEP m, so a warning says "look here", and a
// passage much narrower than STEP may be missed. Walk it in the UGC browser to be sure (flotopia-ugc play).
//
//   reach(ground, footprint, acts) → { warnings: [text], reached, ... }
//   acts: [{ x, y, z, r, dy, hint }] (the act points the code made)
//
// The rules: a walking player at feet L stands on the highest floor at their point whose top is ≤ L + 0.62
// (cells; collider tops within 0.5 m of them); a collider is a wall within 0.35 m of their axis where it overlaps
// L + 0.3 .. L + 1.9; with no floor ahead they fall (into the sea: not walkable); a drop of any height is fine.
export const STEP = 0.2;
const STEP_UP = 0.62, RADIUS = 0.35, ROOF = 0.5, BAND0 = 0.3, BAND1 = 1.9;

export function reach(ground, footprint, acts = []) {
  const cells = (ground.cells ?? []).map((c, i) => ({ i, poly: c.poly, bbox: bbox(c.poly), h: heightFn(c.h) }));
  const cols = (ground.colliders ?? []).map((c, i) => ({ i, poly: c.poly, bbox: bbox(c.poly), y0: c.y0, y1: c.y1 }));
  const half = footprint.shape === 'circle' ? [footprint.r, footprint.r] : [footprint.w / 2, footprint.d / 2];
  const nx = Math.ceil((2 * half[0]) / STEP) + 1, nz = Math.ceil((2 * half[1]) / STEP) + 1;
  const X = (ix) => -half[0] + ix * STEP, Z = (iz) => -half[1] + iz * STEP;

  // at each grid point: its floors [{ h, cell (index, or -1 a collider's top) }] and the colliders near it
  const floors = new Array(nx * nz), near = new Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = X(ix), z = Z(iz), k = iz * nx + ix, F = [], C = [];
    for (const c of cells) if (inBox(c.bbox, x, z, 0) && inPoly(c.poly, x, z)) F.push({ h: c.h(x, z), cell: c.i });
    for (const c of cols) {
      if (!inBox(c.bbox, x, z, ROOF)) continue;
      const d = inPoly(c.poly, x, z) ? 0 : distPoly(c.poly, x, z);
      if (d <= ROOF) F.push({ h: c.y1, cell: -1, col: c.i });
      if (d < RADIUS) C.push(c);
    }
    floors[k] = F;
    near[k] = C;
  }
  // the floor a player at feet L stands on at point k (null: none: they fall off)
  const ground1 = (k, L) => {
    let best = null;
    for (const f of floors[k]) if (f.h <= L + STEP_UP + 1e-6 && (best === null || f.h > best.h)) best = f;
    return best;
  };
  const blocked = (k, L) => near[k].some((c) => c.y1 > L + STEP_UP + 1e-6 && c.y1 >= L + BAND0 && c.y0 <= L + BAND1);

  const warnings = [];
  const a = ground.arrive;
  const reached = new Map(); // k → Set of levels (cm)
  const at = (x, z) => {
    const ix = Math.round((x + half[0]) / STEP), iz = Math.round((z + half[1]) / STEP);
    return ix >= 0 && iz >= 0 && ix < nx && iz < nz ? iz * nx + ix : -1;
  };
  if (!a) return { warnings: ['ground.json has no arrive: a player coming to the island stands at its centre'], reached };
  const k0 = at(a[0], a[2]);
  const onCell = cells.filter((c) => inPoly(c.poly, a[0], a[2]));
  if (!onCell.length) warnings.push(`arrive (${a[0]}, ${a[2]}) is on no cell: a player coming to the island falls into the sea`);
  else {
    // (as the host puts a player down: the highest cell top up to 10 m there)
    const tops = onCell.map((c) => c.h(a[0], a[2])).filter((h) => h <= 10);
    const L0 = Math.max(...tops);
    if (Math.abs(L0 - a[1]) > 0.05) warnings.push(`arrive's y is ${a[1]}, but a player there stands on the floor at ${r2(L0)} (the highest cell there: the host does not use arrive's y)`);
    if (k0 >= 0 && blocked(k0, L0)) warnings.push(`arrive (${a[0]}, ${a[2]}) is in a collider (or within ${RADIUS} m of one): a player there is stuck`);
    // walk: a flood over (point, feet level)
    const queue = [[k0, L0]];
    const seen = (k, L) => reached.get(k)?.has(Math.round(L * 100));
    const mark = (k, L) => { if (!reached.has(k)) reached.set(k, new Set()); reached.get(k).add(Math.round(L * 100)); };
    mark(k0, L0);
    while (queue.length) {
      const [k, L] = queue.pop();
      const ix = k % nx, iz = (k - ix) / nx;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx, f = ground1(j, L);
        if (!f || blocked(j, f.h) || seen(j, f.h)) continue;
        mark(j, f.h);
        queue.push([j, f.h]);
      }
    }
  }
  const reachedAt = (k, h) => reached.get(k)?.has(Math.round(h * 100));

  // the cells: their points where a player would stand on them (no other floor just above), not reached
  if (reached.size) {
    for (const c of cells) {
      const todo = new Set();
      let open = 0;
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        const x = X(ix), z = Z(iz);
        if (!inBox(c.bbox, x, z, 0) || !inPoly(c.poly, x, z)) continue;
        const k = iz * nx + ix, h = c.h(x, z);
        if (floors[k].some((f) => f.h > h + 1e-6 && f.h <= h + STEP_UP + 1e-6)) continue; // another floor takes the player up
        if (blocked(k, h)) continue; // in a wall, or too near one
        open++;
        if (!reachedAt(k, h)) todo.add(k);
      }
      if (!open || !todo.size) continue;
      // the unreached points in pieces (4-connected); a piece of 1 m² or more is worth a warning
      const pieces = [];
      for (const k of todo) {
        if (!todo.has(k)) continue;
        const piece = [k];
        todo.delete(k);
        for (let q = 0; q < piece.length; q++) {
          const p = piece[q], px = p % nx, pz = (p - px) / nx;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const j = (pz + dz) * nx + px + dx;
            if (px + dx >= 0 && px + dx < nx && todo.has(j)) { todo.delete(j); piece.push(j); }
          }
        }
        pieces.push(piece);
      }
      for (const piece of pieces) {
        const m2 = piece.length * STEP * STEP;
        if (m2 < 1 && piece.length !== open) continue;
        const cx = piece.reduce((s, k) => s + X(k % nx), 0) / piece.length, cz = piece.reduce((s, k) => s + Z(Math.floor(k / nx)), 0) / piece.length;
        const all = piece.length === open;
        warnings.push(`cell ${c.i} (y ${r2(c.h(cx, cz))}): ${all ? 'no part of it' : `${r2(m2)} m² of it round (${r2(cx)}, ${r2(cz)})`} can${all ? '' : 'not'} be reached on foot from arrive (walled in, no door? a step over 0.62 m? a gap?)`);
      }
    }
  }

  // the act points: a floor in reach (within r across, dy up or down) at all? reached on foot?
  acts.forEach((q, n) => {
    const name = `act point ${n}${q.hint?.en ? ` ("${q.hint.en}")` : ''} at (${r2(q.x)}, ${r2(q.y)}, ${r2(q.z)})`;
    let floor = false, got = false;
    const span = Math.ceil(q.r / STEP);
    const qk = at(q.x, q.z);
    if (qk < 0) { warnings.push(`${name} is outside the footprint`); return; }
    const qx = qk % nx, qz = (qk - qx) / nx;
    for (let dz = -span; dz <= span && !got; dz++) for (let dx = -span; dx <= span && !got; dx++) {
      const jx = qx + dx, jz = qz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || Math.hypot(X(jx) - q.x, Z(jz) - q.z) >= q.r) continue;
      const j = jz * nx + jx;
      for (const f of floors[j]) {
        if (Math.abs(f.h - q.y) >= q.dy || blocked(j, f.h)) continue;
        floor = true;
        if (reachedAt(j, f.h)) { got = true; break; }
      }
    }
    if (!floor) warnings.push(`${name}: no floor to stand on within r ${q.r} m across and dy ${q.dy} m of y: nobody can act there (y is the floor's height where the player stands)`);
    else if (!got && reached.size) warnings.push(`${name}: its floor cannot be reached on foot from arrive`);
  });
  return { warnings, reached, grid: { nx, nz, step: STEP } };
}

// a cell's height as a function of (x, z)
function heightFn(h) {
  if (h.const !== undefined) return () => h.const;
  if (h.plane) { const [a, b, c] = h.plane; return (x, z) => a + b * x + c * z; }
  const g = h.grid;
  return (x, z) => {
    const fx = Math.min(Math.max((x - g.x0) / g.step, 0), g.nx - 1), fz = Math.min(Math.max((z - g.z0) / g.step, 0), g.nz - 1);
    const ix = Math.min(Math.floor(fx), g.nx - 2 < 0 ? 0 : g.nx - 2), iz = Math.min(Math.floor(fz), g.nz - 2 < 0 ? 0 : g.nz - 2);
    const tx = g.nx > 1 ? fx - ix : 0, tz = g.nz > 1 ? fz - iz : 0;
    const H = (i, j) => g.h[Math.min(j, g.nz - 1) * g.nx + Math.min(i, g.nx - 1)];
    return (H(ix, iz) * (1 - tx) + H(ix + 1, iz) * tx) * (1 - tz) + (H(ix, iz + 1) * (1 - tx) + H(ix + 1, iz + 1) * tx) * tz;
  };
}

function bbox(poly) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of poly) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], z); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], z); }
  return b;
}
const inBox = (b, x, z, m) => x >= b[0] - m && x <= b[2] + m && z >= b[1] - m && z <= b[3] + m;

export function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distPoly(poly, x, z) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}

const r2 = (v) => Math.round(v * 100) / 100;
