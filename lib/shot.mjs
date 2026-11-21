// A screenshot of the game (flotopia-ugc shot): Playwright's headless shell (never a full Chrome profile: on some
// Windows machines creating full Chrome profiles over and over locks the Windows account), the GPU on.
// The page's console lines from the UGC host ([ugc] ...) and its errors come back with it.
// evaluate: JS run in the page after the wait (e.g. __floating.ugc.act('WH-01', 0)), then `then` ms more
export async function screenshot(url, out, { wait = 4000, width = 1280, height = 720, evaluate = null, then = 2000 } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('shot needs playwright-core: npm i -D playwright-core && npx playwright-core install chromium --only-shell');
  }
  const gpu = process.platform === 'win32' ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] : ['--enable-gpu'];
  const browser = await chromium.launch({ headless: true, args: gpu });
  const log = [], errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (/\[ugc/.test(t)) log.push(t);
      // (the game's own console errors, e.g. a local game without its multiplayer room, are not the package's)
      if (m.type() === 'error' && /ugc/i.test(t)) errors.push(t);
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    // the game's first frame (window.__floating.loadTimes.firstFrame), then the wait
    await page.waitForFunction(() => window.__floating?.loadTimes?.firstFrame, null, { timeout: 300000, polling: 500 }).catch(() => {});
    await page.waitForTimeout(wait);
    // the host's report of each UGC island: its layers, the code's fuel and limits, the errors
    if (evaluate) {
      log.push(`[eval] ${JSON.stringify(await page.evaluate(evaluate).catch((e) => String(e)))}`);
      await page.waitForTimeout(then);
    }
    const rep = await page.evaluate(() => window.__floating?.ugc?.report?.() ?? null).catch(() => null);
    if (rep) for (const I of rep) log.push(`[ugc report] ${JSON.stringify(I)}`);
    await page.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', ...(out.endsWith('.png') ? {} : { quality: 88 }) });
  } finally {
    await browser.close();
  }
  return { log, errors };
}
