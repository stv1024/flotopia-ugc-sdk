// flotopia-ugc shot: pictures of the game or the UGC browser, without a screen (lib/browser.mjs).
// It waits for the page's first frame and, with a UGC island, for its near look and its code; then `wait` ms
// more; then runs `evaluate` (JS in the page; a promise it gives is waited for) and the `script` (a module of
// yours, run here in Node: export default async function (t) { ... }, t: lib/browser.mjs driver()), then takes
// the picture `out`. Fails (ok: false) on a page error, a trap, the near look not shown, or the script throwing.
// A picture (its own or the script's) mostly one flat colour is a hint (`hints`), not a failure.
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, verdict } from './browser.mjs';

export async function screenshot(url, out, { wait = 1000, width = 1280, height = 720, evaluate = null, script = null, then = 500, hideUi = false, timeout = 90 } = {}) {
  if (hideUi) { const u = new URL(url); u.searchParams.set('ui', '0'); url = u.href; }
  const B = await launch({ width, height });
  const fails = [];
  let rep = null, t = null;
  try {
    rep = await B.open(url, { timeout });
    await B.page.waitForTimeout(wait);
    t = B.driver(dirname(resolve(out)));
    if (evaluate) {
      try {
        const v = await B.page.evaluate(evaluate);
        if (typeof v === 'undefined' && /=>|function/.test(evaluate) && !/\)\s*\(\s*\)\s*;?\s*$/.test(evaluate)) B.log.push('[eval] undefined (a function given, not called? write (async () => { ... })())');
        else B.log.push(`[eval] ${JSON.stringify(v)}`);
      } catch (e) { fails.push(`eval: ${e.message.split('\n')[0]}`); }
      await B.page.waitForTimeout(then);
    }
    if (script) {
      try {
        const mod = await import(pathToFileURL(resolve(script)).href);
        if (typeof mod.default !== 'function') throw new Error(`${script}: no default export (export default async function (t) { ... })`);
        await mod.default(t);
      } catch (e) { fails.push(`script: ${e.message.split('\n')[0]}`); }
    }
    rep = await B.page.evaluate(() => { const r = window.__floating?.ugc?.report?.(); return r ? r.find((i) => i.trying) ?? r[0] ?? null : null; }).catch(() => rep);
    await t.shot(resolve(out)).catch((e) => fails.push(`the picture: ${e.message}`));
  } finally {
    await B.close();
  }
  const v = verdict(rep, B.errors);
  return { log: [...B.log, ...v.lines], errors: [...v.bad, ...fails], hints: t?.hints ?? [], report: rep };
}
