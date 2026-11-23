// A PNG encoder for build scripts (Node): textures for glb.mjs, a cover. No dependencies.
//
//   import { png } from 'flotopia-ugc/lib/png.mjs';
//   const bytes = png(256, 256, (x, y) => [200, 180, 150, 255]);   // a function of the pixel → [r, g, b, a?]
//   const bytes2 = png(w, h, rgba);                                 // or the pixels: Uint8Array of w·h·4, row by row
//
// Colours are sRGB bytes (0–255), as an image editor shows them. With no alpha below 255 it is an RGB PNG.
import { deflateSync, crc32 } from 'node:zlib';

export function png(width, height, pixels) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error('png: width and height are whole numbers above 0');
  let rgba = pixels;
  if (typeof pixels === 'function') {
    rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const c = pixels(x, y), i = 4 * (y * width + x);
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = c[3] ?? 255;
    }
  }
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) throw new Error(`png: the pixels are a function or a Uint8Array of ${width}·${height}·4`);
  let alpha = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { alpha = true; break; }
  const k = alpha ? 4 : 3, row = width * k + 1, raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < k; c++) raw[y * row + 1 + x * k + c] = rgba[4 * (y * width + x) + c];
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
