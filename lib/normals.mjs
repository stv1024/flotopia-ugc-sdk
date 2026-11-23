// Vertex normals that are zero or not a number. The shader's normalize() of such a normal gives NaN; the bloom
// spreads that one pixel over the whole picture and the game's screen goes one colour. The game puts the faces'
// normals there (and says so in the console), but a package should not have them: writeGlb (lib/glb.mjs) mends
// them as it writes, check (lib/check-package.mjs) finds them in any .glb.
// three.js's computeVertexNormals() makes them: a vertex only on triangles of no area (two corners the same) gets
// a zero normal.
//
//   badNormals(normals) -> [vertex indices]: normals xyz (any array of numbers)
//   mendNormals(positions, normals, indices?) -> { normals, mended: [vertex indices] }: normals a new
//     Float32Array (the one given if none is bad). Each bad normal becomes the normal of the triangles it is on
//     (by their area), or straight up if they have none. The same as the game's (floating-city
//     src/ugc/normals.js).

export function badNormals(N) {
  const bad = [];
  for (let i = 0; 3 * i + 2 < N.length; i++) {
    const x = N[3 * i], y = N[3 * i + 1], z = N[3 * i + 2], l = x * x + y * y + z * z;
    if (!(l > 1e-12 && l < Infinity)) bad.push(i);
  }
  return bad;
}

export function mendNormals(P, N, I = null) {
  const mended = badNormals(N);
  if (!mended.length) return { normals: N, mended };
  const out = Float32Array.from(N);
  const n = N.length / 3, bad = new Uint8Array(n), acc = new Float64Array(3 * n);
  for (const i of mended) bad[i] = 1;
  const tris = I ? I.length : n;
  for (let t = 0; t + 2 < tris; t += 3) {
    const a = I ? I[t] : t, b = I ? I[t + 1] : t + 1, c = I ? I[t + 2] : t + 2;
    if (!bad[a] && !bad[b] && !bad[c]) continue;
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const ux = P[3 * b] - ax, uy = P[3 * b + 1] - ay, uz = P[3 * b + 2] - az;
    const vx = P[3 * c] - ax, vy = P[3 * c + 1] - ay, vz = P[3 * c + 2] - az;
    // the cross product: its length is twice the area
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (!Number.isFinite(cx + cy + cz)) continue;
    for (const v of [a, b, c]) if (bad[v]) { acc[3 * v] += cx; acc[3 * v + 1] += cy; acc[3 * v + 2] += cz; }
  }
  for (const i of mended) {
    const x = acc[3 * i], y = acc[3 * i + 1], z = acc[3 * i + 2], l = Math.hypot(x, y, z);
    out.set(l > 1e-20 ? [x / l, y / l, z / l] : [0, 1, 0], 3 * i);
  }
  return { normals: out, mended };
}

// "vertex 3, 7, 12 and 9 more"
export function someOf(list, k = 5) {
  return `${list.length === 1 ? 'vertex' : 'vertices'} ${list.slice(0, k).join(', ')}${list.length > k ? ` and ${list.length - k} more` : ''}`;
}
