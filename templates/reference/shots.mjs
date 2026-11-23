// The labelled pictures of the city reference (docs/city/*.jpg), taken in the UGC browser.
//   node shots.mjs <UGC browser URL> <package URL> <out dir>
//   e.g. node shots.mjs http://localhost:5173/editor/ugc/ http://localhost:8787/ugc.json ../../docs/city
// Each shot: the free camera at the shot's &cam, the hour's &tod; when the near look is shown, the page's own UI
// is hidden and each thing's name drawn under it (projected with the browser's camera: fov 55°, vertical).
import { chromium } from 'playwright-core';
import { DECK, SHOTS } from './layout.mjs';

const [browserUrl, pkgUrl, out] = process.argv.slice(2);
if (!browserUrl || !pkgUrl || !out) {
  console.log('node shots.mjs <UGC browser URL> <package URL> <out dir>');
  process.exit(1);
}
const WIDTH = 1600, HEIGHT = 720, FOV = (55 * Math.PI) / 180;

// a point of the island frame → CSS px, for the camera [x, y, z, tx, ty, tz] (the island is at the origin, not turned)
function project(cam, p) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const eye = cam.slice(0, 3), f = norm(sub(cam.slice(3), eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const d = sub(p, eye), z = dot(d, f), t = Math.tan(FOV / 2);
  return [WIDTH / 2 + (dot(d, r) / z / (t * (WIDTH / HEIGHT))) * (WIDTH / 2), HEIGHT / 2 - (dot(d, u) / z / t) * (HEIGHT / 2)];
}

const gpu = process.platform === 'win32' ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] : ['--enable-gpu'];
// (an https UGC browser loading a package from http://localhost: allowed, or headless Chrome refuses it)
const browser = await chromium.launch({ headless: true, args: [...gpu, '--disable-features=LocalNetworkAccessChecks'] });
try {
  for (const [name, tod, cam, items, dz] of SHOTS) {
    const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })).newPage();
    page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
    const u = new URL(browserUrl);
    u.searchParams.set('ugc', pkgUrl);
    u.searchParams.set('tod', String(tod));
    u.searchParams.set('cam', cam.join(','));
    await page.goto(u.href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__floating?.ugc?.report()[0].near === 'shown', null, { timeout: 120000, polling: 250 });
    const labels = items.map((it) => ({ text: it.label, at: project(cam, [it.x, DECK, it.z + dz]) }));
    await page.evaluate((labels) => {
      for (const el of document.body.children) if (el.tagName !== 'CANVAS') el.style.display = 'none';
      for (const { text, at } of labels) {
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = `position:fixed;left:${at[0]}px;top:${at[1] + 6}px;transform:translateX(-50%);font:600 13px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:1px 5px;border-radius:3px;white-space:nowrap;z-index:99`;
        document.body.append(d);
      }
    }, labels);
    await page.waitForTimeout(3000); // the trees' and the shadows' first frames
    await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
    console.log(`${out}/${name}.jpg`);
    await page.close();
  }
} finally {
  await browser.close();
}
