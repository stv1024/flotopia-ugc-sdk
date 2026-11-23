// flotopia-ugc play: play a package in the UGC browser as a player and fail if it cannot be played.
// It opens the package (a directory: served here on a free port; or the URL of its ugc.json), starts playing at
// the package's arrive, and runs the steps: really walking (the host's walkTo: the player's own walking, the real
// cells and colliders; never a teleport), really pressing keys (F only acts within reach), into the focus and out.
// It records the page's errors and the code's traps. → { ok, fails: [why], log: [lines] }
//
// The steps (a JSON file: a list, or { "steps": [...] }), each one of:
//   { "walk": [x, z], "y"?: feet height expected (±0.1), "run"?: true, "r"?: m, "timeout"?: s }
//   { "act": n }                      walk to act point n (0: the first the code made) till in reach, press F: it must act
//   { "press": "KeyF", "acted"?: true | false, "hold"?: s }    a key (KeyboardEvent.code), as a player's
//   { "focus": true | false }         the package's focus must be on / off (within 3 s)
//   { "key": "KeyW", "ms": 500 }      a key held (the keyboard; e.g. Space to jump)
//   { "wait": ms }
//   { "shot": "upstairs.jpg" }        a picture into the out directory
//   { "view": { "yaw", "pitch", "fp" } }   { "look": [x, y, z] }   the follow camera
//   { "expect": { "y"?: n, "mode"?: "walk", "near"?: [x, z, r] } }  the player now
//   { "eval": "js" }                  JS in the page (must not throw; a promise is waited for)
// Without steps: start at arrive and check the player stands on a floor there, and nothing failed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, verdict } from './browser.mjs';
import { servePackage } from './serve.mjs';

export const UGC_BROWSER = 'https://stv1024.asia/flotopia/editor/ugc/';

export async function play(where, stepsFile = null, { browser = UGC_BROWSER, out = '.tmp/play', width = 1280, height = 720, ui = false, headed = false } = {}) {
  const log = [], fails = [];
  const say = (s) => { log.push(s); console.log(s); };
  let steps = [];
  if (stepsFile) {
    let j;
    try { j = JSON.parse(readFileSync(stepsFile, 'utf8')); } catch (e) { return { ok: false, fails: [`${stepsFile}: ${e.message}`], log }; }
    steps = Array.isArray(j) ? j : j.steps;
    if (!Array.isArray(steps)) return { ok: false, fails: [`${stepsFile}: a list of steps, or { "steps": [...] }`], log };
  }
  let server = null, pkg = where;
  if (!/^https?:\/\//.test(where)) {
    server = await servePackage(where, 0);
    pkg = `http://localhost:${server.address().port}/ugc.json`;
    say(`serving ${resolve(where)} at ${pkg}`);
  }
  const u = new URL(browser);
  u.searchParams.set('ugc', pkg);
  if (!ui) u.searchParams.set('ui', '0');
  const B = await launch({ width, height, headed });
  const t = B.driver(out);
  const origLog = console.log;
  console.log = (s) => { log.push(String(s)); origLog(s); };
  let rep = null;
  try {
    say(`open ${u.href}`);
    rep = await B.open(u.href);
    if (!rep) throw new Error('the page has no UGC island (is it the UGC browser?)');
    if (rep.near !== 'shown') throw new Error(`the near look is ${rep.near}: ${(rep.errors ?? []).slice(-3).join('; ')}`);
    const p = await t.play();
    if (!p || p.mode !== 'walk') throw new Error(`at arrive the player is ${p?.mode ?? 'nowhere'}, not walking: is arrive on a floor (a cell of ground.json)?`);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      try {
        await step(t, s);
      } catch (e) {
        throw new Error(`step ${i + 1} ${JSON.stringify(s)}: ${e.message.split('\n')[0]}`);
      }
    }
    await t.wait(500);
  } catch (e) {
    fails.push(e.message);
    await t.shot('fail.jpg').catch(() => {});
  } finally {
    rep = await B.page.evaluate(() => window.__floating?.ugc?.report?.()[0] ?? null).catch(() => rep);
    console.log = origLog;
    await B.close();
    server?.close();
  }
  const v = verdict(rep, B.errors);
  for (const l of B.log) log.push(l);
  for (const l of v.lines) say(l);
  fails.push(...v.bad.filter((b) => !fails.some((f) => f.includes(b))));
  return { ok: !fails.length, fails, log };
}

async function step(t, s) {
  if (s.walk) return t.walkTo(s.walk[0], s.walk[1], { y: s.y, run: s.run, r: s.r, timeout: s.timeout });
  if (s.act !== undefined) return t.act(s.act);
  if (s.press) {
    const r = await t.press(s.press, { hold: s.hold });
    if (s.acted === true && !r.acted.length) throw new Error('nothing acted');
    if (s.acted === false && r.acted.length) throw new Error(`acted ${r.acted.join(', ')}`);
    return r;
  }
  if (s.focus !== undefined) return t.focus(!!s.focus);
  if (s.key) return t.key(s.key, s.ms ?? 100);
  if (s.wait !== undefined) return t.wait(s.wait);
  if (s.shot) return t.shot(s.shot);
  if (s.view) return t.view(s.view);
  if (s.look) return t.lookAt(...s.look);
  if (s.eval) return t.eval(s.eval);
  if (s.expect) {
    const p = await t.player();
    if (!p) throw new Error('not playing');
    const e = s.expect;
    if (e.y !== undefined && Math.abs(p.pos[1] - e.y) > 0.1) throw new Error(`the feet at y ${p.pos[1]}, not ${e.y}`);
    if (e.mode && p.mode !== e.mode) throw new Error(`the player is ${p.mode}, not ${e.mode}`);
    if (e.near && Math.hypot(p.pos[0] - e.near[0], p.pos[2] - e.near[1]) > (e.near[2] ?? 0.5)) throw new Error(`the player at ${p.pos[0]}, ${p.pos[2]}, not within ${e.near[2] ?? 0.5} m of ${e.near[0]}, ${e.near[1]}`);
    console.log(`expect ${JSON.stringify(e)}: ok`);
    return p;
  }
  throw new Error('not a step (walk, act, press, focus, key, wait, shot, view, look, expect, eval)');
}
