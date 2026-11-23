# AGENTS.md — making a UGC island for Flotopia

You are a coding agent making an island for **Flotopia**, a floating city in the browser (three.js). Your island
is a **package**: files at an https address your creator controls. When the platform has placed it on a slot,
every player who comes near downloads it, the game checks it, and runs its code in a sandbox.

Read [`docs/abi.md`](docs/abi.md) — the contract. This file is how to work with it.

## Two kinds of code

| | where it runs | what it may do |
|---|---|---|
| **Build-time code** | your computer | anything (Node, three.js, Blender, any language). It makes the package's files: glTF, JSON, images, the wasm |
| **Run-time code** | the player's browser, a WebAssembly sandbox | only what the host's imports give (docs/abi.md 3.4), within fuel and limits |

Most of the look is made at build time. Run time is for what moves and answers the player.

## The workflow

The shortest path, from nothing to a package you have walked through:

```sh
npm i -D flotopia-ugc assemblyscript playwright-core   # (or this repo, by path: file:../flotopia-ugc-sdk)
npx playwright-core install chromium --only-shell       # once: the browser of shot
# 1. build your files into dist/ (ugc.json and everything it names): your build script
node build.mjs
# 2. write the files' hashes into ugc.json (after every build: the game refuses a file whose hash is not there)
npx flotopia-ugc pack dist
# 3. every check the game makes, and a trial run of your code with a fake host
npx flotopia-ugc check dist
# 4. serve it (CORS on) and leave it running
npx flotopia-ugc serve dist --port 8787
# 5. look at it alone, play it: the UGC browser (below)
#    https://stv1024.asia/flotopia/editor/ugc/?ugc=http://localhost:8787/ugc.json
#    &play: walk it (WASD, F at act points, Esc out of focus); &debug=ground: see the cells, colliders, act points
# 6. pictures without a screen
npx flotopia-ugc shot "https://stv1024.asia/flotopia/editor/ugc/?ugc=http://localhost:8787/ugc.json&ui=0&cam=0,8,30,0,2,0" .tmp/front.jpg
# 7. put dist/ on your https host (CORS: Access-Control-Allow-Origin: *), check it there, give the platform its URL
npx flotopia-ugc check https://<your host>/ugc.json
```

Start from a template: `templates/minimal` (a disc and a pillar), `templates/house` (two storeys, a stair,
doors: [`docs/ground.md`](docs/ground.md)), `templates/showcase` (every capability), `templates/reference` (the
city's materials and trees: [`docs/city.md`](docs/city.md)).

## See it and play it: the UGC browser

The UGC browser shows one package alone, without the city, and lets you play it as a player. Use it for all of
your looking and testing; the city (below) only at the end.

| | address |
|---|---|
| the published one (use this) | `https://stv1024.asia/flotopia/editor/ugc/` (with the last `/`) |
| a game you run yourself (`npm run dev`) | `http://localhost:5173/editor/ugc/` (the port Vite prints) |

It loads a package from any `https://` address, or from `http://localhost` / `http://127.0.0.1`: serve it with
`flotopia-ugc serve` (it sends the CORS headers the published page needs; a Vite dev server does not).
- Chrome or Edge ask once to let the page reach devices on your local network: allow it. Safari may refuse a
  local package from an https page: use Chrome.
- A headless Chrome refuses it without asking (the browser's panel: `could not fetch (is CORS on?)`). `shot`
  allows it; your own Playwright tools: launch with `--disable-features=LocalNetworkAccessChecks`.
- If nothing comes from your `serve`, another program may answer on that port: try another `--port`.

**URL parameters** (after `?ugc=<the URL of ugc.json>`):

| | |
|---|---|
| `&play` | start playing (when the near look is there): the player at the package's `arrive`, the camera behind them |
| `&at=x,z[,heading]` | with `play`: start there instead. **Island coordinates** (the island is at the origin, not turned). The game's `?at=` is in world coordinates: not the same |
| `&cam=x,y,z,tx,ty,tz` | the free camera there, looking at `(tx, ty, tz)` |
| `&tod=<hour>` | the time of day: `0`–`24`, `21:30`, or `dawn` (6.2), `day` (9.0), `dusk` (17.8), `night` (20), `late` (4.5). Default 15 |
| `&debug=ground` | draw the ground: cells yellow, colliders orange, act points as rings (green: F works now; magenta: on but out of reach; grey: off) |
| `&ui=0` | no UI of the browser's own (for clean pictures). Your focus panel and the game's "F …" hint still show |

**Keys**: free camera: drag to turn, middle button to pan, wheel to zoom; no keys (WASD does nothing there).
**I** switches between the free camera and playing. Playing: WASD / arrows, Shift runs, Space jumps, click to
lock the mouse, **F** at an act point; in focus your keys, and **Esc** gives the camera back.

The panel (top right) shows the loading (`清单` manifest, `外壳` shell, `近景` near look: `shown`), the
runtime (ready, fuel, draws, traps with the last trap's reason and wasm stack) and, while playing, the nearest
act point: its distance against `r`, the height against `dy`, and why F does not work if it does not.

**The script interface**, for `shot` and your own tools: `U = window.__floating.ugc` (`null` till a package is
loaded). Coordinates are island coordinates.

```js
U.report()               // → [report]: [0].manifest, .shell, .near ('loading' | 'shown' | 'failed'), .runtime
                         //   ({ ready, stopped, asleep, focus, ticks, fuel, traps, lastTrap, budget }), .errors
U.play({ x, z, h })      // start playing (no argument: at arrive). → the player's state
U.stop()                 // back to the free camera
U.player()               // playing: { pos: [x, y, z], heading, mode, surf, speed, indoor, fp }, else null
await U.walkTo(x, z, { timeout = 15, r = 0.35, run = false })
                         // walk there as a player: the player's own walking, the real cells and colliders. A straight
                         // line, no path finding: go round things in legs.
                         // → { ok, why: 'arrived' | 'stuck' | 'timeout' | 'mode' | 'stopped' | 'not playing',
                         //     at: [x, y, z], left, secs, mode, blocker }
                         // blocker (when not there): { kind: 'collider', index, y0, y1 } (index in ground.json's
                         // colliders), { kind: 'step', index, from, to } (a cell more than 0.62 m up), { kind: 'edge' }
await U.press(code, { hold = 0.1 })
                         // a key down and up (KeyboardEvent.code: 'KeyF', 'Escape', 'KeyB', 'Space'), as a player's:
                         // F only works within an act point's reach. → { code, acted: [act ids], focus, player }
U.acts()                 // every act point, the nearest first: { id, x, y, z, r, dy, hint, on, dist, dh, can, at, why }
                         // why (when it cannot): 'far', 'height', 'off', 'focus', 'not ready', 'mode <mode>'
U.debug('ground')        // the ground drawing on (false: off)
U.cam()                  // → [x, y, z, tx, ty, tz]
U.setCam([x, y, z, tx, ty, tz])   // the free camera there (leaves playing)
U.lookAt(x, y, z)        // free camera: look there; playing: turn the view there from the player's eyes
U.view({ yaw, pitch, fp })        // playing: the follow camera (yaw: behind a player facing yaw − π; fp: first person)
U.teleport(x, z, h, y)   // playing: put the player there. Through walls: for pictures only, never to test
U.act('PREVIEW', n)      // fire act point n without the distance check: never to test
U.event('PREVIEW', kind, a, v)    // put an event into the inbox (3.3)
```

**Test as a player.** `teleport` goes through walls and `act()` skips the reach: a test with them passes with a
door walled up or an act point out of reach (it happened in the pilot). Walk with `walkTo`, act with
`press('KeyF')`, and look at `blocker` and `acts()` when it fails:

```js
const U = window.__floating.ugc;
U.play();                                                   // at arrive
let w = await U.walkTo(0, 3);                               // to the door
if (!w.ok) throw new Error(`not at the door: ${JSON.stringify(w)}`);
const a = U.acts()[0];
w = await U.walkTo(a.x, a.z + 1);                           // in, to the act point
const p = await U.press('KeyF');
if (!p.acted.includes(a.id)) throw new Error(`F did nothing: ${JSON.stringify(U.acts()[0])}`);
await new Promise((r) => setTimeout(r, 300));               // the package takes the focus a tick later
if (!U.report()[0].runtime.focus) throw new Error('no focus');
await U.press('Escape');                                    // and out
```

Run it in the browser's console, or with `shot --eval` (below; the page waits for a promise it returns).

## In the city

Last, see it among the city: `https://stv1024.asia/flotopia/?ugc=http://localhost:8787/ugc.json`
(a game you run yourself: `http://localhost:5173/?ugc=...`).

- `&ugcslot=<id>` puts your package on that slot in place of what is there (only on your screen). Without it
  the game puts it on open water near the player.
- `&at=x,z` starts the player there, in **world** coordinates. The game's console (and `shot`'s output) has your
  `fc.log` lines and every error a call returned, with its code and why.

## Build time: the files

- `lib/glb.mjs` writes glTF binaries from typed arrays (no DOM needed): `writeGlb([{ name, material,
  positions, normals, colors, uvs, indices, matrix }])`. Use the city's materials (`'fc:paving'`, `'fc:plaster'`,
  …: docs/abi.md 2.2) where you can: the island then looks like part of the city, at night too. What each looks
  like, by day and night, its uv scale, and how bright an emissive should be: [`docs/city.md`](docs/city.md).
- **Design to the city's sizes** (docs/city.md 2): the player is 1.75 m tall and 0.7 m wide, steps up 0.62 m,
  jumps about 1.2 m; a door needs 1.9 m of height and about 1 m of width. `+z` is the island's front.
- The **shell** is what players see from far away (up to kilometres): one material, vertex colours, at most
  2 000 triangles. The silhouette and the main colours; nothing small.
- The **near look**: everything static, finest LOD first. Shadows are on.
- `ground.json`: where players can walk (cells with heights) and what they bump into (colliders). Without
  cells, players fall into the sea. Steps are separate cells, each with a constant height. Cells are floors (one
  storey over another is fine), walls are colliders, a low collider is a step. Make the meshes and the ground
  from the same numbers, so that a door in a wall's mesh is a gap in its colliders: [`docs/ground.md`](docs/ground.md)
  (a two-storey house, `templates/house`).
- Keep everything inside the footprint.

## Run time: the code

Any language that compiles to a core wasm module with the features of docs/abi.md 3.1. The SDK has bindings for
**AssemblyScript** (`assembly/fc.ts`):

```ts
import * as fc from "flotopia-ugc/assembly/fc";
export { fc_alloc } from "flotopia-ugc/assembly/fc";

export function fc_init(seed: i32): void { /* make meshes, materials, act points */ }
export function fc_tick(inbox: usize, len: i32): void {
  const f = new fc.Inbox(inbox);
  for (let e = 0; e < f.count; e++) { /* f.kind(e), f.a(e), f.v(e, k) */ }
}
```

Build: `npx asc assembly/index.ts -O3 --runtime incremental --maximumMemory 1024 -o dist/island.wasm`.

Rules that matter:

- **Fuel.** `fc_init` has 4 000 M units of fuel, each `fc_tick` 400 M. Running out kills the instance. Split
  heavy work over ticks; a tick should take a few ms. Fuel counts code size, not instructions run (abi.md 3.2):
  a function's whole body is charged when it is entered, a loop's whole body each pass. Keep hot loops small,
  use `unchecked()` or raw `load`/`store`, and do not call `Math.sin` and the like in them when a table will do.
- **One tick at a time**, about one a frame; what you do shows one frame later. `dt` is the time since your last
  tick (it may be large after a pause: clamp it).
- **Sleep** when nothing moves: `fc.sleep(0.5, 1.0)` ticks only every 0.5 s till an event or the player comes
  near your keep-out. It saves the player's battery. Only those wake it, not the code, not `flags`: abi.md 3.2.
- **Materials**: `uniform()` is for shader materials only; a `city` or `standard` material does not change
  after it is made (show another mesh or node instead).
- **Keys in focus**: `focus.keys` are `KeyboardEvent.code`s (`KeyB`); a panel button's `key` is only its label
  (abi.md 3.7). Esc is always the host's: it ends the focus.
- **Same for every player.** No clock but `time`, no randomness but `seed`. A player's own effect may stay local
  if it is small and goes back after a while.
- **No allocation in the tick loop** if you can help it (AssemblyScript: preallocate; use `unchecked()` in hot loops;
  names you pass every tick, a uniform's or a node's: `new fc.Name("uTime")` once, then pass that).
- **Ids** from the host are ≥ 1; < 0 is an error (docs/abi.md 3.6). Log it.
- **Uploads**: `bufferWrite` at most 1 MB a tick. Write only what moved.
- **Shaders** (`shader` capability): written like three.js `ShaderMaterial`; only constant-bound `for` loops;
  the host's light (`fcSunDir`, `fcEnv()`, …) and frame (`fcToLocal`) uniforms: docs/abi.md 3.5. Do not declare
  the host's uniforms yourself; do declare your own (the ones in the material's `uniforms`).
- **The player.** You do not move the player. A `keepout` grid keeps them out of a solid (and the camera's arm
  short of it); `focus` takes the camera for a while (Esc always gives it back).
- **Matrices** are column-major, island frame.

## Checking your work

- `check` must pass before you say you are done. It runs your code in Node with a fake host for some ticks,
  twice, and compares (determinism); it checks every shader your code loads. It does not walk your ground and
  it does not see the picture.
- **Play it** in the UGC browser, as a player: from `arrive`, with `walkTo` (never `teleport`) through every
  door, up and down every stair, to every act point, `press('KeyF')` (never `act()`) there, into focus and out
  with `press('Escape')`. `&debug=ground` shows what blocks. Every act point must be reachable on foot.
- Look at it: `shot` near, far, at night (`&tod=22`), in focus. Compare with what you meant and with
  docs/city.md (sizes, materials).
- Watch the fuel numbers `check` prints: a tick near the limit will fail on a slow computer.

## Hosting

Any static https host with CORS: Cloudflare (Workers static assets or Pages; a `_headers` file with
`/*` → `Access-Control-Allow-Origin: *`; `pack` leaves `_headers` and `_redirects` out of the package),
GitHub Pages (sends `*` already), S3 with a CORS rule. Then `check <the URL of ugc.json>`: it reads every
file from there, as the game will. The files are hashed byte for byte: if they go through git, mark them
`-text` in `.gitattributes` (or git may change their line ends, and the game will refuse them). Name files by
content if you can (a new version's files next to the old ones): the game keeps using the approved version
till the platform approves the new one.
