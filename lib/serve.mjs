// A static server for a package directory, with the headers the game and the UGC browser need: CORS for any
// origin, Private Network Access (an https page asking this computer), no caching. flotopia-ugc serve and play.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.vert': 'text/plain; charset=utf-8', '.frag': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream',
};

// → a listening server; port 0: any free one (server.address().port)
export function servePackage(dir, port = 8787) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    const p = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!(p === root || p.startsWith(root + sep)) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
    res.writeHead(200);
    res.end(readFileSync(p));
  });
  return new Promise((ok, no) => {
    server.once('error', no);
    server.listen(port, () => ok(server));
  });
}
