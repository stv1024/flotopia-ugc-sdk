#!/usr/bin/env node
// flotopia-ugc: tools for making a UGC island (docs/abi.md).
//   pack <dir>                      write the files' SHA-256 and sizes into <dir>/ugc.json
//   check <dir | url>               every check the game makes, and a trial run of the code
//   serve <dir> [--port 8787]       serve the package with CORS, for the game to load (?ugc=...)
//   shot <game-url> <out.jpg> [--wait ms] [--size WxH] [--eval js] [--then ms]   a screenshot of the game (headless)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const [cmd, ...rest] = process.argv.slice(2);
const opts = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) opts[a.slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else pos.push(a);
}

const NOT_PACKAGE = new Set(['ugc.json', '_headers', '_redirects']);
const COMMANDS = { pack, check, serve, shot };
if (!COMMANDS[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 6).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
await COMMANDS[cmd]();

// ------------------------------------------------------------------ pack

// every file under dir is a file of the package, but ugc.json, dotfiles and a static host's own config
// (_headers, _redirects: Cloudflare, Netlify: NOT_PACKAGE, at the top)
function filesOf(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => !NOT_PACKAGE.has(f)).sort();
}

async function pack() {
  const dir = resolve(pos[0] ?? '.');
  const path = join(dir, 'ugc.json');
  if (!existsSync(path)) fail(`no ugc.json in ${dir}`);
  const m = JSON.parse(readFileSync(path, 'utf8'));
  m.files = {};
  for (const f of filesOf(dir)) {
    const bytes = readFileSync(join(dir, f));
    m.files[f] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  const text = JSON.stringify(m, null, 2) + '\n';
  writeFileSync(path, text);
  const sha = createHash('sha256').update(text).digest('hex');
  console.log(`ugc.json: ${Object.keys(m.files).length} files, ${Object.values(m.files).reduce((s, f) => s + f.bytes, 0)} bytes`);
  console.log(`sha256 of ugc.json: ${sha}`);
}

// ------------------------------------------------------------------ check

async function check() {
  const { checkPackage } = await import('../lib/check-package.mjs');
  const where = pos[0] ?? '.';
  const r = await checkPackage(where, { seed: +(opts.seed ?? 1), ticks: +(opts.ticks ?? 600) });
  for (const line of r.report) console.log(line);
  if (r.errors.length) {
    console.log(`\n${r.errors.length} error(s):`);
    for (const e of r.errors) console.log(`  ${e.code}${e.path ? ` [${e.path}]` : ''}: ${e.message}`);
    process.exit(1);
  }
  console.log('\nOK');
}

// ------------------------------------------------------------------ serve

const TYPES = {
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.vert': 'text/plain; charset=utf-8', '.frag': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream',
};

async function serve() {
  const dir = resolve(pos[0] ?? '.'), port = +(opts.port ?? 8787);
  const server = createServer((req, res) => {
    // CORS for the game (any origin; an https page asking a local address: Private Network Access)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    const p = resolve(dir, '.' + decodeURIComponent(url.pathname));
    if (!p.startsWith(dir) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
    res.writeHead(200);
    res.end(readFileSync(p));
  });
  server.listen(port, () => {
    const u = `http://localhost:${port}/ugc.json`;
    console.log(`serving ${dir}`);
    console.log(`  the package:      ${u}`);
    console.log(`  in the game:      https://stv1024.asia/flotopia/?ugc=${encodeURIComponent(u)}`);
    console.log('  (put it on a slot: &ugcslot=<id>; stand somewhere: &at=x,z)');
  });
}

// ------------------------------------------------------------------ shot

async function shot() {
  const { screenshot } = await import('../lib/shot.mjs');
  const [url, out] = pos;
  if (!url || !out) fail('shot <game-url> <out.jpg> [--wait ms] [--size WxH] [--eval js] [--then ms]');
  const [w, h] = String(opts.size ?? '1280x720').split('x').map(Number);
  const r = await screenshot(url, out, { wait: +(opts.wait ?? 4000), width: w, height: h, evaluate: opts.eval ?? null, then: +(opts.then ?? 2000) });
  for (const line of r.log) console.log(line);
  console.log(`${out}${r.errors.length ? `, ${r.errors.length} page error(s)` : ''}`);
  for (const e of r.errors) console.log(`  ${e}`);
  if (r.errors.length) process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
