// Copied from the game (floating-city src/ugc/check/image.js, 87688c3) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md): the size of an image from its header, without decoding it (the package's cover, the
// images in a glTF). PNG (IHDR), JPEG (the first SOF marker), WebP (VP8, VP8L, VP8X). Never reads past the end.
//   imageSize(bytes) -> { type: 'png' | 'jpeg' | 'webp', width, height } | null (not one of these, or cut short)
// Pure: no DOM, no Node (the loader, the sandbox worker and the SDK's CLI use it).

const be16 = (b, p) => (b[p] << 8) | b[p + 1];
const be32 = (b, p) => b[p] * 2 ** 24 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
const le16 = (b, p) => b[p] | (b[p + 1] << 8);
const le24 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
const tag = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const sized = (type, width, height) => (width > 0 && height > 0 ? { type, width, height } : null);

function png(b) {
  // the signature, then the first chunk: IHDR (length 13), width and height big-endian
  if (b.length < 24 || tag(b, 12) !== 'IHDR') return null;
  return sized('png', be32(b, 16), be32(b, 20));
}

// the start-of-frame markers: C0-CF but C4 (DHT), C8 (JPG) and CC (DAC)
const SOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpeg(b) {
  let p = 2;
  while (p + 1 < b.length) {
    if (b[p] !== 0xff) return null;
    let m = b[p + 1];
    // fill bytes
    while (m === 0xff && p + 2 < b.length) {
      p++;
      m = b[p + 1];
    }
    p += 2;
    if (m === 0xff) return null;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // no length
    if (m === 0xd9 || m === 0xda) return null; // the end, or the scan, before a frame
    if (p + 2 > b.length) return null;
    const len = be16(b, p);
    if (len < 2) return null;
    if (SOF(m)) {
      // length, precision, height, width
      if (len < 7 || p + 7 > b.length) return null;
      return sized('jpeg', be16(b, p + 5), be16(b, p + 3));
    }
    p += len;
  }
  return null;
}

function webp(b) {
  if (b.length < 30 || tag(b, 8) !== 'WEBP') return null;
  const chunk = tag(b, 12);
  if (chunk === 'VP8 ') {
    // the frame tag (3 bytes), the start code 9d 01 2a, then 14 bits of width and of height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized('webp', le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    // the signature 0x2f, then width - 1 and height - 1 in 14 bits each
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return sized('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    // flags (4 bytes), then the canvas's width - 1 and height - 1 in 24 bits each
    return sized('webp', le24(b, 24) + 1, le24(b, 27) + 1);
  }
  return null;
}

export function imageSize(bytes) {
  let b = null;
  if (bytes instanceof Uint8Array) b = bytes;
  else if (bytes instanceof ArrayBuffer) b = new Uint8Array(bytes);
  else if (ArrayBuffer.isView(bytes)) b = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!b || b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return b.length >= 8 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a ? png(b) : null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (tag(b, 0) === 'RIFF') return webp(b);
  return null;
}
