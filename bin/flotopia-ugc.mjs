#!/usr/bin/env node
// flotopia-ugc: tools for making a UGC island (docs/abi.md, AGENTS.md).
//   pack <dir>                       write the files' SHA-256 and sizes into <dir>/ugc.json
//   check <dir | url>                every check the game makes, a trial run of the code, warnings (reach, files, names)
//   serve <dir> [--port 8787]        serve the package with CORS, for the UGC browser and the game (?ugc=...)
//   play <dir | url> [steps.json]    play it in the UGC browser as a player: walk, press keys, focus; fails if it cannot
//        [--out .tmp/play] [--browser url] [--ui] [--headed] [--size WxH]
//   shot <page-url> <out.jpg>        a picture of the UGC browser or the game, when the package is loaded
//        [--script file.mjs] [--eval js] [--hide-ui] [--wait ms] [--size WxH] [--then ms]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const FLAGS = new Set(['hide-ui', 'ui', 'headed']); // switches: never take the next word
const [cmd, ...rest] = process.argv.slice(2);
const opts = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    opts[k] = FLAGS.has(k) || !rest[i + 1] || rest[i + 1].startsWith('--') ? true : rest[++i];
  } else pos.push(a);
}

const NOT_PACKAGE = new Set(['ugc.json', '_headers', '_redirects']);
const COMMANDS = { pack, check, serve, play, shot };
if (!COMMANDS[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
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
  if (r.warnings?.length) {
    console.log(`\n${r.warnings.length} warning(s):`);
    for (const w of r.warnings) console.log(`  ${w}`);
  }
  if (r.errors.length) {
    console.log(`\n${r.errors.length} error(s):`);
    for (const e of r.errors) console.log(`  ${e.code}${e.path ? ` [${e.path}]` : ''}: ${e.message}`);
    process.exit(1);
  }
  console.log('\nOK');
}

// ------------------------------------------------------------------ serve

async function serve() {
  const { servePackage } = await import('../lib/serve.mjs');
  const dir = resolve(pos[0] ?? '.'), port = +(opts.port ?? 8787);
  await servePackage(dir, port).catch((e) => fail(`port ${port}: ${e.message} (try another: --port)`));
  const u = `http://localhost:${port}/ugc.json`;
  console.log(`serving ${dir}`);
  console.log(`  the package:      ${u}`);
  console.log(`  alone, to play:   https://stv1024.asia/flotopia/editor/ugc/?ugc=${u}&play`);
  console.log(`  in the city:      https://stv1024.asia/flotopia/?ugc=${u}`);
  console.log('  (nothing comes? another program may have this port: --port)');
}

// ------------------------------------------------------------------ play

async function play() {
  const { play: run } = await import('../lib/play.mjs');
  if (!pos[0]) fail('play <dir | url of ugc.json> [steps.json] [--out .tmp/play] [--browser url] [--ui] [--headed] [--size WxH]');
  const [w, h] = String(opts.size ?? '1280x720').split('x').map(Number);
  const r = await run(pos[0], pos[1] ?? null, { browser: opts.browser, out: opts.out ?? '.tmp/play', width: w, height: h, ui: !!opts.ui, headed: !!opts.headed });
  if (!r.ok) {
    console.log(`\nFAILED (${r.fails.length}):`);
    for (const f of r.fails) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\nOK: played');
}

// ------------------------------------------------------------------ shot

async function shot() {
  const { screenshot } = await import('../lib/shot.mjs');
  const [url, out] = pos;
  if (!url || !out) fail('shot <page-url> <out.jpg> [--script file.mjs] [--eval js] [--hide-ui] [--wait ms] [--size WxH] [--then ms]');
  const [w, h] = String(opts.size ?? '1280x720').split('x').map(Number);
  const r = await screenshot(url, out, {
    wait: +(opts.wait ?? 1000), width: w, height: h, evaluate: opts.eval ?? null, script: opts.script ?? null,
    then: +(opts.then ?? 500), hideUi: !!opts['hide-ui'],
  });
  for (const line of r.log) console.log(line);
  console.log(`${out}${r.errors.length ? `, ${r.errors.length} problem(s)` : ''}`);
  for (const e of r.errors) console.log(`  ${e}`);
  if (r.errors.length) process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
