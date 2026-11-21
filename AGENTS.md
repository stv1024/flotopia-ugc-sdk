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

```sh
npm i -D flotopia-ugc assemblyscript       # (or this repo, by path)
# 1. build your files into a directory, e.g. dist/ (ugc.json + everything it names)
# 2. write the files' hashes into ugc.json
npx flotopia-ugc pack dist
# 3. every check the game makes, and a trial run of your code with a fake host
npx flotopia-ugc check dist
# 4. see it in the game: serve it, open the game with ?ugc=
npx flotopia-ugc serve dist --port 8787
#    https://stv1024.asia/flotopia/?ugc=http://localhost:8787/ugc.json&ugcslot=<slot>&at=<x>,<z>
#    (a game you run yourself: http://localhost:5173/?ugc=...)
# 5. look at it without a screen
npx flotopia-ugc shot "<game url with ?ugc=...&ui=0>" .tmp/shot.jpg --wait 8000
# 6. put dist/ on your https host (CORS: Access-Control-Allow-Origin: *), give the platform the URL of ugc.json
```

- `?ugcslot=<id>` puts your package on that slot in place of what is there (only on your screen). Without it
  the game puts it on open water near the player.
- `?at=x,z` (world coordinates) starts the player there. The game's console (and `shot`'s output) has your
  `fc.log` lines and every error a call returned, with its code and why.
- `pack` after every build: the game refuses a file whose hash is not the one in ugc.json.

## Build time: the files

- `lib/glb.mjs` writes glTF binaries from typed arrays (no DOM needed): `writeGlb([{ name, material,
  positions, normals, colors, uvs, indices, matrix }])`. Use the city's materials (`'fc:paving'`, `'fc:plaster'`,
  …: docs/abi.md 2.2) where you can: the island then looks like part of the city, at night too.
- The **shell** is what players see from far away (up to kilometres): one material, vertex colours, at most
  2 000 triangles. The silhouette and the main colours; nothing small.
- The **near look**: everything static, finest LOD first. Shadows are on.
- `ground.json`: where players can walk (cells with heights) and what they bump into (colliders). Without
  cells, players fall into the sea. Steps are separate cells, each with a constant height.
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
  near your keep-out. It saves the player's battery.
- **Same for every player.** No clock but `time`, no randomness but `seed`. A player's own effect may stay local
  if it is small and goes back after a while.
- **No allocation in the tick loop** if you can help it (AssemblyScript: preallocate; use `unchecked()` in hot loops).
- **Ids** from the host are ≥ 1; < 0 is an error (docs/abi.md 3.6). Log it.
- **Uploads**: `bufferWrite` at most 1 MB a tick. Write only what moved.
- **Shaders** (`shader` capability): written like three.js `ShaderMaterial`; only constant-bound `for` loops;
  the host's light (`fcSunDir`, `fcEnv()`, …) and frame (`fcToLocal`) uniforms: docs/abi.md 3.5. Do not declare
  the host's uniforms yourself.
- **The player.** You do not move the player. A `keepout` grid keeps them out of a solid (and the camera's arm
  short of it); `focus` takes the camera for a while (Esc always gives it back).
- **Matrices** are column-major, island frame.

## Checking your work

- `check` must pass before you say you are done. It runs your code in Node with a fake host for some ticks,
  twice, and compares (determinism); it checks every shader your code loads.
- Look at it in the game: `shot` near, far, at night (`&tod=22`), in focus. Compare with what you meant.
- Watch the fuel numbers `check` prints: a tick near the limit will fail on a slow computer.

## Hosting

Any static https host with CORS: Cloudflare (Workers static assets or Pages; a `_headers` file with
`/*` → `Access-Control-Allow-Origin: *`; `pack` leaves `_headers` and `_redirects` out of the package),
GitHub Pages (sends `*` already), S3 with a CORS rule. Then `check <the URL of ugc.json>`: it reads every
file from there, as the game will. Name files by
content if you can (a new version's files next to the old ones): the game keeps using the approved version
till the platform approves the new one.
