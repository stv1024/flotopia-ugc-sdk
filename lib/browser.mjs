// The browser of `shot` and `play`: Playwright's headless shell (never a full Chrome profile: on some Windows
// machines creating full Chrome profiles over and over locks the Windows account), the GPU on, allowed to load a
// package from this computer into an https page. And a driver for the page's window.__floating.ugc (AGENTS.md,
// "See it and play it"), for scripts:
//
//   const B = await launch({ width: 1280, height: 720 });
//   await B.open(url);              // the page, its first frame, the package loaded (near look shown, code ready)
//   const t = B.driver(outDir);     // t.walkTo(x, z), t.press('KeyF'), t.shot('door.jpg'), ...
//   ...; await B.close();           // B.log: the page's [ugc] lines; B.errors: its errors
export async function launch({ width = 1280, height = 720, headed = false } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('this needs playwright-core: npm i -D playwright-core && npx playwright-core install chromium --only-shell');
  }
  const gpu = process.platform === 'win32' ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] : ['--enable-gpu'];
  // an https page (the published UGC browser, the game) loading http://localhost: Chrome's local network access
  // check refuses it in a headless browser (one with a screen asks)
  const browser = await chromium.launch({ headless: !headed, args: [...gpu, '--disable-features=LocalNetworkAccessChecks'] });
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const B = { browser, page, log: [], errors: [] };
  page.on('console', (m) => {
    const t = m.text();
    if (/\[ugc/.test(t)) B.log.push(t);
    // (the game's own console errors, e.g. a local game without its multiplayer room, are not the package's)
    if (m.type() === 'error' && /ugc/i.test(t)) B.errors.push(t);
  });
  page.on('pageerror', (e) => B.errors.push(String(e)));
  B.open = (url, o) => open(page, url, o);
  B.driver = (dir) => driver(page, dir);
  B.close = () => browser.close();
  return B;
}

// open the page and wait: its first frame; then, if it has a UGC island, the near look shown (or failed) and the
// code ready (or stopped), at most `timeout` s. → the report of the island (null: no UGC island on the page)
async function open(page, url, { timeout = 90 } = {}) {
  // has the package code? (then wait for it too) From its ugc.json, if the page names it (?ugc=)
  let code = null;
  try {
    const pkg = new URL(url).searchParams.get('ugc');
    if (pkg) code = !!(await (await fetch(pkg)).json()).runtime;
  } catch { /* (the page will say) */ }
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__floating?.loadTimes?.firstFrame, null, { timeout: 300000, polling: 250 }).catch(() => {});
  const t0 = Date.now();
  let rep = null;
  while (Date.now() - t0 < timeout * 1000) {
    rep = await page.evaluate(() => {
      const r = window.__floating?.ugc?.report?.();
      // the game: the island tried with ?ugc (trying), else the first; the UGC browser: its one
      return r ? r.find((i) => i.trying) ?? r[0] ?? null : undefined;
    }).catch(() => undefined);
    if (rep === undefined && Date.now() - t0 > 15000) return null; // no UGC on this page
    if (rep) {
      const near = rep.near, rt = rep.runtime;
      const looks = near === 'shown' || near === 'failed' || rep.manifest === 'failed';
      const ran = rt ? rt.ready || rt.stopped : code !== true;
      if (looks && (ran || rep.manifest === 'failed' || rep.near === 'failed')) return rep;
    }
    await page.waitForTimeout(250);
  }
  return rep ?? null;
}

// the helpers of a script (shot --script, play): each prints what it did, and the player's state after it
export function driver(page, dir = '.') {
  const say = (s) => console.log(s);
  const U = (fn, ...args) => page.evaluate(([f, a]) => {
    const u = window.__floating?.ugc;
    if (!u) throw new Error('no UGC island on the page (window.__floating.ugc is null)');
    // eslint-disable-next-line no-new-func
    return new Function('U', 'args', `return (${f})(U, ...args)`)(u, a);
  }, [fn.toString(), args]);
  const need = async (name) => {
    if (!(await page.evaluate((n) => typeof window.__floating?.ugc?.[n] === 'function', name))) {
      throw new Error(`this page has no __floating.ugc.${name}(): use the UGC browser, https://stv1024.asia/flotopia/editor/ugc/`);
    }
  };
  const fmt = (p) => (p ? `at [${p.pos.map((v) => v.toFixed(2)).join(', ')}] ${p.mode}${p.surf ? ` on ${p.surf}` : ''}` : 'not playing');
  const t = {
    page,
    U,
    hints: [], // the pictures mostly one flat colour (shot)
    wait: (ms) => page.waitForTimeout(ms),
    report: () => U((u) => u.report()[0]),
    player: () => U((u) => u.player()),
    acts: () => U((u) => (u.acts ? u.acts() : [])),
    // start playing at arrive (or at { x, z, h }); the camera behind the player
    async play(at = null) {
      const p = await U((u, a) => u.play(a), at);
      say(`play ${at ? JSON.stringify(at) : 'from arrive'}: ${fmt(p)}`);
      return p;
    },
    stop: () => U((u) => u.stop()),
    // walk to (x, z) as a player (the host's walkTo). → its result; throws when not there, unless o.may
    async walkTo(x, z, o = {}) {
      await need('walkTo');
      const w = await U((u, a, b, c) => u.walkTo(a, b, c), x, z, { timeout: o.timeout ?? 15, r: o.r ?? 0.35, run: !!o.run });
      const at = w.at ? `[${w.at.map((v) => v.toFixed(2)).join(', ')}]` : '?';
      if (w.ok) say(`walk to ${x}, ${z}: there, ${at}, ${w.secs?.toFixed(1)} s`);
      else {
        const b = w.blocker;
        const why = b?.kind === 'collider' ? `collider ${b.index ?? '(not the package\'s)'} (y ${b.y0} .. ${b.y1}) in the way`
          : b?.kind === 'step' ? `cell ${b.index} too high (${b.from} → ${b.to}: more than 0.62 m)` : b?.kind === 'edge' ? 'no ground ahead' : '';
        const msg = `walk to ${x}, ${z}: not there (${w.why}), stopped at ${at}, ${w.left?.toFixed(2)} m short${why ? `: ${why}` : ''}`;
        if (!o.may) throw new Error(msg);
        say(msg);
      }
      if (o.y !== undefined) {
        // (stepping down is eased: give the feet up to 1 s to settle)
        let y = w.at?.[1];
        for (let i = 0; i < 10 && !(Math.abs(y - o.y) <= (o.dy ?? 0.1)); i++) { await page.waitForTimeout(100); y = (await U((u) => u.player()))?.pos[1]; }
        if (!(Math.abs(y - o.y) <= (o.dy ?? 0.1))) throw new Error(`walk to ${x}, ${z}: the feet at y ${y?.toFixed(2)}, not ${o.y}`);
      }
      return w;
    },
    // a key down for `hold` s and up, as a player's (the host's press: F acts only within reach). → its result
    async press(code, o = {}) {
      await need('press');
      const r = await U((u, c, h) => u.press(c, { hold: h }), code, o.hold ?? 0.1);
      say(`press ${code}: ${r.acted?.length ? `acted ${r.acted.join(', ')}` : 'nothing acted'}${r.focus ? ', focus' : ''}; ${fmt(r.player)}`);
      return r;
    },
    // a key held ms (Playwright's keyboard: e.g. 'KeyW' to walk on, 'Space' to jump)
    async key(code, ms = 100) {
      await page.keyboard.down(code);
      await page.waitForTimeout(ms);
      await page.keyboard.up(code);
      const p = await U((u) => u.player()).catch(() => null);
      say(`key ${code} ${ms} ms: ${fmt(p)}`);
      return p;
    },
    // wait till the package's focus is on (true) or off (false), at most s seconds. Throws if not
    async focus(on = true, s = 3) {
      const t0 = Date.now();
      while (Date.now() - t0 < s * 1000) {
        if (!!(await U((u) => u.report()[0].runtime?.focus)) === on) { say(`focus ${on ? 'on' : 'off'}`); return true; }
        await page.waitForTimeout(100);
      }
      throw new Error(`the focus is not ${on ? 'on' : 'off'} after ${s} s`);
    },
    // walk to act point n (0: the first the code made) till within its reach, press F: it must act
    async act(n = 0, o = {}) {
      const list = (await t.acts()).sort((a, b) => a.id - b.id);
      const a = list[n];
      if (!a) throw new Error(`act point ${n}: there are ${list.length}`);
      await t.walkTo(a.x, a.z, { r: Math.max(0.3, a.r * 0.7), ...o });
      const r = await t.press('KeyF');
      if (!r.acted.includes(a.id)) {
        const now = (await t.acts()).find((q) => q.id === a.id);
        throw new Error(`act point ${n} ("${a.hint?.en}"): F did nothing: ${now?.why ?? '?'} (distance ${now?.dist?.toFixed(2)} of r ${a.r}, height ${now?.dh?.toFixed(2)} of dy ${a.dy})`);
      }
      return r;
    },
    view: (v) => U((u, a) => u.view(a), v),
    lookAt: (x, y, z) => U((u, a, b, c) => u.lookAt(a, b, c), x, y, z),
    setCam: (c) => U((u, a) => u.setCam(a), c),
    cam: () => U((u) => u.cam()),
    // JS in the page (a string; a promise it gives is waited for)
    eval: (js) => page.evaluate(js),
    // a picture: a file name (into the out directory) or a path
    async shot(name) {
      const { join, isAbsolute, dirname } = await import('node:path');
      const { mkdirSync } = await import('node:fs');
      const path = isAbsolute(name) ? name : join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      const img = await page.screenshot({ path, type: /\.png$/i.test(path) ? 'png' : 'jpeg', ...(/\.png$/i.test(path) ? {} : { quality: 88 }) });
      const p = await U((u) => u.player?.()).catch(() => null);
      say(`shot ${path}${p ? `: ${fmt(p)}` : ''}`);
      const f = await oneColour(page, img);
      if (f) {
        const h = `${path} is ${Math.round(f.share * 100)}% one colour (${f.hex}): a NaN in the picture (a zero normal: check warns of them; the bloom spreads one bad pixel over the screen and the page behind shows), the camera inside a mesh, or nothing in view`;
        t.hints.push(h);
        say(`  hint: ${h}`);
      }
      return path;
    },
    assert(ok, msg = 'assertion failed') {
      if (!ok) throw new Error(msg);
      say(`ok: ${msg}`);
    },
  };
  return t;
}

// a picture mostly one flat colour (at least `min` of its pixels within `tol` of one colour, in each of r, g, b)?
// → { share, hex } or null. A NaN frame is the page behind, flat to the last bit (the UGC browser's panels on it:
// about 74 % at 1280 × 720); the city's skies are gradients (at most 28 %, at night). Decoded in the page (no
// image decoder in Node)
export async function oneColour(page, img, min = 0.6, tol = 1) {
  const r = await page.evaluate(async ([b64, png, tol]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bm = await createImageBitmap(new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }));
    const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
    g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data, n = d.length / 4;
    // the commonest colour, in bins of 16 a channel; then its pixels' mean, and how many are near it
    const bins = new Uint32Array(4096);
    for (let i = 0; i < d.length; i += 4) bins[((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)]++;
    let top = 0;
    for (let k = 1; k < 4096; k++) if (bins[k] > bins[top]) top = k;
    const m = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) if ((((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)) === top) for (let k = 0; k < 3; k++) m[k] += d[i + k];
    for (let k = 0; k < 3; k++) m[k] = Math.round(m[k] / bins[top]);
    let near = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - m[0]) <= tol && Math.abs(d[i + 1] - m[1]) <= tol && Math.abs(d[i + 2] - m[2]) <= tol) near++;
    return { share: near / n, hex: `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}` };
  }, [Buffer.from(img).toString('base64'), img[0] === 0x89, tol]).catch(() => null);
  return r && r.share >= min ? r : null;
}

// what went wrong with the package on the page, from its report: [lines], and whether it fails
export function verdict(rep, pageErrors) {
  const lines = [], bad = [];
  if (rep) {
    if (rep.manifest === 'failed') bad.push('the manifest failed to load');
    if (rep.near === 'failed') bad.push('the near look failed to load');
    else if (rep.near !== 'shown') bad.push(`the near look is not shown (${rep.near})`);
    const rt = rep.runtime;
    if (rt) {
      if (!rt.ready && !rt.stopped) bad.push('the code is not ready');
      if (rt.traps) bad.push(`the code trapped ${rt.traps} time(s)${rt.lastTrap ? `: ${rt.lastTrap.why} in ${rt.lastTrap.in}${rt.lastTrap.where ? ` at ${[].concat(rt.lastTrap.where).join(' < ')}` : ''}` : ''}`);
      lines.push(`code: ${rt.ready ? 'ready' : rt.stopped ? 'stopped' : 'loading'}, ${rt.ticks ?? 0} ticks, fuel a tick up to ${((rt.fuelMax ?? 0) / 1e6).toFixed(1)} M, ${rt.budget?.draws ?? 0} draws, traps ${rt.traps ?? 0}`);
    }
    for (const e of rep.errors ?? []) lines.push(`error (logged by the host): ${e}`);
  }
  for (const e of pageErrors) bad.push(`page error: ${e}`);
  return { lines, bad };
}
