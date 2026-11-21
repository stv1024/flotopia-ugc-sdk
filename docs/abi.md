# flotopia-ugc/1 — the package and the host interface

This is the contract between a UGC island (a **package**) and the game (the **host**). The host is the
Flotopia game in the player's browser. Everything here is checked by the host; `flotopia-ugc check`
runs the same checks on your computer.

Machine-readable copy: [`abi.json`](../abi.json). AssemblyScript bindings: [`assembly/fc.ts`](../assembly/fc.ts).

## 1. Frames and units

- Metres, seconds, radians. Right-handed, `+y` up.
- **Island frame**: the origin is the centre of the island's slot at sea level (`y = 0` is the water),
  axes as the world's turned about `y` by the slot's rotation. Everything in the package and every
  position the host gives or takes is in the island frame.
- City constants: the city's decks are at `y = 0.5`; island hulls go down to `y = -3.5`.

## 2. The package

A package is a directory at an `https` address you control. The host reads only files listed in
`ugc.json`, and checks each against its SHA-256.

```
ugc.json        the manifest (below)
shell.glb       the far look (small, simple)
near.glb        the near look (one or more LODs)
ground.json     walkable surfaces, colliders, arrival spot
things.json     city things: trees (optional)
island.wasm     run-time code (optional)
*.vert *.frag   shaders (optional; need the "shader" capability)
cover.webp      2D cover
```

Your server must answer with `Access-Control-Allow-Origin: *` (or the game's origin) for every file.
The host fetches with `credentials: 'omit'` and no referrer.

### 2.1 `ugc.json`

```json
{
  "schema": "flotopia-ugc/1",
  "title": { "zh": "鲸冻", "en": "Jelly Whale" },
  "footprint": { "shape": "circle", "r": 40 },
  "cover": "cover.webp",
  "shell": "shell.glb",
  "lods": [{ "file": "near.glb" }],
  "ground": "ground.json",
  "things": "things.json",
  "runtime": { "wasm": "island.wasm", "activate": 170, "release": 280, "caps": ["shader", "target", "refract", "keepout", "focus"] },
  "files": { "shell.glb": { "sha256": "<64 hex>", "bytes": 12345 } }
}
```

| field | |
|---|---|
| `schema` | `"flotopia-ugc/1"` |
| `title` | `{ zh, en }`, each 1–40 characters |
| `footprint` | `{ "shape": "circle", "r" }` or `{ "shape": "rect", "w", "d" }` (metres, centred on the origin). Everything of the island stays inside it (cells, colliders, meshes' bounds, keep-out). The platform gives you a slot this big |
| `cover` | a PNG, JPEG or WebP, at most 1024 × 1024 |
| `shell` | glTF binary, the far look: one material, vertex colours, at most 2 000 triangles, no textures |
| `lods` | the near look: glTF binaries, finest first (`{ "file", "until"? }`: `until` m, the camera this far or more uses the next one) |
| `ground` | see 2.3 |
| `things` | see 2.4 (optional) |
| `runtime` | see 3 (optional): `wasm`, `activate` and `release` (m from the origin, `activate < release ≤ 400`), `caps` |
| `files` | every file of the package but `ugc.json`: `sha256` (lower-case hex) and `bytes`. `flotopia-ugc pack` writes this |

### 2.2 glTF

glTF 2.0 binary (`.glb`), buffers and images inside the file.

- Extensions allowed: `EXT_meshopt_compression`, `KHR_mesh_quantization`, `KHR_texture_transform`,
  `KHR_materials_emissive_strength`, `EXT_mesh_gpu_instancing`. Any other is an error.
- Materials:
  - named `fc:<name>`: the city's own material (its look, its night lights). Names: `paving`, `plaza`,
    `concrete`, `plaster`, `wood`, `sand`, `grass`, `metal`, `hull`, `glow`, `gloss`, `fabric`. They multiply
    the vertex colour (`COLOR_0`) and use planar uv in metres × about 0.25 (1 uv = 4 m). `glow` lights
    up at night by its vertex colour.
  - any other: glTF PBR (base colour, metallic, roughness, emissive, textures), drawn in the city's light.
- Node names are yours; `node_visible()` shows and hides a node of the near look by name.
- Shadows: the near look casts and takes shadows; the shell does neither.

### 2.3 `ground.json`

```json
{
  "cells": [
    { "poly": [[x, z], ...], "h": { "const": 0.5 }, "surf": "deck" },
    { "poly": [[x, z], ...], "h": { "plane": [a, b, c] } }
  ],
  "colliders": [{ "poly": [[x, z], ...], "y0": 0.5, "y1": 1.7 }],
  "arrive": [x, y, z, heading]
}
```

- A cell is a walkable surface over a polygon (3–256 points, either winding). Its height:
  `{ "const": y }`, `{ "plane": [a, b, c] }` (`y = a + b·x + c·z`), or
  `{ "grid": { "x0", "z0", "step", "nx", "nz", "h": [nx·nz numbers, row by row along x] } }`.
  `surf`: `deck` (default), `grass`, `sand`, `wood`, `water`. Cells go from their height down to the hull.
  A step is two cells.
- A collider is a prism: a polygon from `y0` to `y1`.
- `arrive`: where a player coming to the island stands, and the heading (rad) they face.
- At most 256 cells and 512 colliders.

### 2.4 `things.json`

```json
{ "trees": [{ "kind": "palmRoyal", "x": 1, "y": 0.5, "z": 2, "rotY": 0.3, "scale": 1.1 }] }
```

Tree kinds: `palmCoconut`, `palmRoyal`, `rainTree`, `frangipani`, `almond`, `shrub`, `bougainvillea`,
`grass`, `hedge`, `forestTree`, `treeFern`, `fern`, `birch`. At most 400.

### 2.5 Limits per island

| | near look | run time, more |
|---|---|---|
| draw calls (main pass) | 30 | 30 |
| triangles | 500 000 | 200 000 |
| GPU memory (buffers, textures, targets) | 64 MB | 64 MB |
| download (as stored) | shell 0.3 MB, the rest 16 MB | wasm + shaders 8 MB |
| upload a tick (`buffer_write`) | — | 1 MB |
| render targets | — | 2, together no more pixels than the screen + 1024² |
| texture size | 2048 × 2048 | |
| wasm memory | — | 64 MB (1024 pages) |

A call that would go over returns an error (section 3.6) and nothing is made.

## 3. Run-time code

### 3.1 The module

A core WebAssembly module, any language. The host runs it in a Web Worker of its own, only while
the player is within `activate` m (until `release` m). It can do nothing but call the imports below.

- Features: MVP, mutable globals, sign extension, non-trapping float-to-int, bulk memory,
  multi-value, reference types, fixed-width SIMD. **Not**: threads, shared memory, relaxed SIMD,
  exceptions, tail calls, GC, memory64, more than one memory.
- Memory: exported as `memory`, with a declared maximum of at most 1024 pages.
- Imports: only from module `fc` (3.4) and, for AssemblyScript's runtime, `env.abort`, `env.trace`,
  `env.seed`.
- Exports the host calls:

| export | |
|---|---|
| `fc_alloc(bytes: i32) -> i32` | once, right after instantiation: memory for the inbox (`INBOX_BYTES` = 16 384) |
| `fc_init(seed: i32)` | once. `seed` is the same for every player (from the package and the slot) |
| `fc_tick(inbox: i32, len: i32)` | every tick (about every frame), with the inbox filled (3.3) |

### 3.2 Fuel, ticks and sleep

- The host meters the module: each call has fuel, about one unit per instruction. `fc_init` gets
  4 000 M, each `fc_tick` 400 M. A call that runs out traps. Spread long work over ticks.
- A call that traps (out of fuel, `unreachable`, out of bounds, `abort`) ends the instance. The host
  makes a new one (from `fc_init`, at the world time of then) at most twice in 10 minutes, then gives up
  on this version on this device. The island's meshes from the package stay; what the code made goes.
- One tick at a time: the next one starts after this one returned and the host has drawn its output.
  The output of a tick shows one frame later.
- `sleep(interval, wake)`: tick only every `interval` s from now on, till something happens: an event,
  or the player moving within `wake` m of the keep-out surface (3.8), or into or out of that band.

### 3.3 The inbox

Little-endian, at the address `fc_alloc` gave.

| offset | type | field |
|---|---|---|
| 0 | f64 | `time`: the world clock, s (the same for every player) |
| 8 | f32 | `dt`: s since the last tick |
| 12 | u32 | `flags`: bit 0 focus on, bit 1 player within `activate` m, bit 2 sun above the horizon |
| 16 | f32 × 3 | camera position |
| 28 | f32 × 3 | camera forward (unit) |
| 40 | f32 × 3 | player's feet |
| 52 | f32 × 3 | player's velocity |
| 64 | u32 | player's mode: 0 none, 1 walking, 2 in the air (jump, fall, jetpack), 3 flying, 4 coming down, 5 swimming, 6 riding, 7 other |
| 68 | f32 × 3 | toward the sun (the moon at night) (unit) |
| 80 | f32 | `night`: 0 day … 1 night |
| 84 | f32 × 2 | the canvas size, CSS px |
| 92 | u32 | number of events |
| 96 | 48 × n | events |

An event: `u32 kind, u32 a, f32 v[10]`.

| kind | | `a` | `v` |
|---|---|---|---|
| 1 `ACT` | the player pressed the act key at an act point | act id | |
| 2 `FOCUS_END` | the host ended focus (Esc, panel's leave, range) | | |
| 3 `POINTER_DOWN` | (focus) a button went down | button: 0 left, 1 middle, 2 right | 0–2 ray origin, 3–5 ray direction, 6–7 pointer x, y (CSS px), 8 pointer id |
| 4 `POINTER_MOVE` | (focus) | buttons held (bit mask) | as above |
| 5 `POINTER_UP` | (focus) | button | as above |
| 6 `WHEEL` | (focus) | | 0 delta y (px) |
| 7 `KEY` | (focus) one of `focus.keys` went down | its index in `keys` | |
| 8 `PANEL` | (focus) the panel | control id | 0 value |
| 9 `GAMEPAD` | (focus, every tick a pad is there) | buttons (bit mask, standard mapping) | 0–3 axes, 4 left trigger, 5 right trigger |

### 3.4 Imports (module `fc`)

Strings and JSON are UTF-8: a pointer and a length in bytes. Matrices are 16 `f32`, column-major.
Calls that make something return its id (≥ 1) or an error (< 0, 3.6).

| import | |
|---|---|
| `log(ptr, len)` | a line to the developer console (at most 50 a second) |
| `buffer(ptr, len, dynamic) -> id` | bytes for geometry. `dynamic` 1: `buffer_write` may change it |
| `buffer_write(id, offset, ptr, len)` | change a dynamic buffer (counts to the upload limit) |
| `geometry(json, len) -> id` | 3.5 |
| `geometry_range(geo, start, count) -> id` | the same geometry, drawn over `count` indices from `start` |
| `texture(path, len) -> id` | an image file of the package |
| `target(json, len) -> id` | a render target: `{ "width", "height" }` or `{ "screen": scale }`; `"format"`: `"r16f"`, `"rgba8"`, `"rgba16f"`; `"depth"`: bool |
| `material(json, len) -> id` | 3.5 |
| `uniform(mat, name, len, values, n)` | set a uniform: `n` f32 (1, 2, 3, 4, 9 or 16) |
| `uniform_tex(mat, name, len, kind, id)` | a sampler: `kind` 0 a texture, 1 a target |
| `mesh(geo, mat, json, len) -> id` | `{ "layer": "scene" \| "noReflect" \| "refract" \| "pass", "order", "castShadow", "receiveShadow" }`. `pass`: only drawn by passes. `refract`: drawn after the water, can read the picture behind (needs `refract`) |
| `mesh_matrix(mesh, ptr)` | its matrix in the island frame |
| `mesh_visible(mesh, on)` | |
| `node_visible(name, len, on)` | a node of the near look |
| `pass(json, len) -> id` | draw meshes into a target: `{ "target", "meshes": [ids], "camera": "main" \| "own", "stage": "frame" \| "refract", "clear": [r, g, b, a] }`. `frame`: before the frame, when `pass_run`; `refract`: every frame, before the `refract` meshes, with the main camera |
| `pass_camera(pass, proj, view)` | an `own` camera: projection, and view (island frame → camera) |
| `pass_run(pass)` | run a `frame` pass once, before the next frame |
| `act(json, len) -> id` | an act point: `{ "x", "y", "z", "r", "dy", "hint": { "zh", "en" } }`. The player walking within `r` m (and `dy` m of `y`) sees the hint; the act key gives an `ACT` event |
| `act_enable(act, on)` | |
| `focus(json, len)` | take the camera and the pointer (needs `focus`): `{ "keys": ["KeyB", ...] }` (KeyboardEvent.code; Esc is always the host's). The player stands still |
| `focus_camera(eye, target)` | 3 f32 each: where the camera is and looks |
| `focus_cursor(kind)` | 0 default, 1 grab, 2 grabbing, 3 pointer |
| `focus_end()` | give the camera back |
| `panel(json, len)` | the focus panel (3.7) |
| `keepout(json, len, grid, bytes)` | a solid the player and the camera keep out of (needs `keepout`; 3.8) |
| `sleep(interval, wake)` | 3.2 |

### 3.5 Geometry and materials

```json
{
  "index": { "buffer": 3, "type": "u32", "offset": 0, "count": 9000 },
  "attributes": {
    "position": { "buffer": 1, "type": "f32", "size": 3, "offset": 0, "count": 5000 },
    "normal": { "buffer": 1, "type": "f32", "size": 3, "offset": 60000, "count": 5000 },
    "rest": { "buffer": 2, "type": "f32", "size": 3, "offset": 0, "count": 5000 }
  },
  "bounds": { "center": [0, 0.6, 0], "radius": 3.2 }
}
```

Types: `f32`, `u8`, `u8n`, `i8n`, `u16`, `u16n`, `u32` (`n`: normalised). Attributes are tightly packed.
`bounds` is in the geometry's own frame (before the mesh matrix).

A material is one of:

```json
{ "city": "paving" }
{ "standard": { "color": [1, 1, 1], "vertexColors": true, "roughness": 0.5, "metalness": 0, "envMapIntensity": 1, "emissive": [0, 0, 0], "side": "front" } }
{ "shader": {
    "vertex": "jelly.vert", "fragment": "jelly.frag",
    "defines": { "NTUB": 23 },
    "uniforms": { "uFlesh": "vec4", "uRough": "float", "uLightMap": "sampler2D", "uLightVP": "mat4" },
    "host": ["frame", "light", "refract"],
    "side": "front", "transparent": false, "depthWrite": true, "depthTest": true,
    "blend": "normal", "polygonOffset": [0, 0] } }
```

`side`: `front`, `back`, `double`. `blend`: `normal`, `none`, `add`, `multiply` (the colour times what is behind).

**Shaders** (need `shader`). GLSL ES 3.00, written as for three.js's `ShaderMaterial` (`void main()`,
`gl_FragColor`; three's `position`, `normal`, `uv`, `color`, `modelMatrix`, `viewMatrix`,
`projectionMatrix`, `modelViewMatrix`, `normalMatrix`, `cameraPosition` are there). Your own attributes:
`attribute <type> <name>;` with the geometry's attribute names. Rules, checked before compiling:

- Loops: only `for` with an `int` counter, a constant start and bound (numbers, `#define`d numbers,
  `const int`), `++`/`--`/`+= const`, the counter not changed in the body. No `while`, no `do`.
  Nested loops multiply: at most 1 024 iterations an invocation in all.
- Preprocessor: only `#define NAME <number>` and `#include <packing>`. No macros with arguments, no `#if`.
- Uniforms: only the ones in `uniforms` and the host's groups. At most 32 uniforms and 8 samplers.
  Texture reads (`texture`, `textureLod`, `texelFetch`): at most 64 an invocation, loops counted.
- At most 32 KB of source a stage.
- A shader that made the game lose its WebGL context is not used again on that device; the mesh gets a
  plain material in its place.

Host uniform groups (the host declares them; do not declare them yourself). Shaders work in the **world
frame** (three.js's `modelMatrix` takes a vertex to the world): the directions here are world directions;
`fcToLocal` takes a world point to the island frame (for matrices your code computed in the island frame,
e.g. a light map's camera).

| group | uniforms |
|---|---|
| `frame` | `mat4 fcToLocal` (world → island), `mat4 fcToWorld`, `float fcTime` (world clock, s) |
| `light` | `vec3 fcSunDir` (toward the sun, or the moon at night), `vec3 fcSunCol` (its colour × intensity / π), `vec3 fcHemiSky`, `vec3 fcHemiGround` (the hemisphere light, × intensity / π), `float fcEnvI` (the sky light's intensity: the scene's environment intensity, 0.35 on a clear day, more under cloud), `float fcNight` (0 day … 1 night); fragment: `vec3 fcEnv(vec3 dir, float roughness)` (the sky's light from a direction, not yet × `fcEnvI`) |
| `refract` | (fragment) `sampler2D fcScene` (the picture so far), `sampler2D fcDepth` (its depth), `vec2 fcScreen` (px), `vec3 fcCamFwd`, `float fcNear`, `float fcFar` |

### 3.6 Errors

| code | |
|---|---|
| -1 | bad arguments (JSON, types, ids of another kind) |
| -2 | over a limit (2.5) |
| -3 | a capability not in `runtime.caps` |
| -4 | no such id, or no such file in the package |

Each error is also logged with what was wrong (`flotopia-ugc preview` shows them).

### 3.7 The panel

```json
{ "title": { "zh": "鲸冻", "en": "JELLY WHALE" },
  "items": [
    { "swatches": { "id": 1, "value": 0, "options": [{ "colors": ["#3f93ea", "#1d5fc0", "#f3eee4"], "stops": [60, 75], "title": { "zh": "海蓝", "en": "Ocean" } }] } },
    { "label": { "zh": "软 — 硬", "en": "Soft — Firm" } },
    { "slider": { "id": 2, "min": 0, "max": 100, "value": 50 } },
    { "buttons": [{ "id": 3, "key": "B", "text": { "zh": "喷水", "en": "Blow" } }] },
    { "leave": { "key": "F", "text": { "zh": "离开", "en": "Leave" } } }
  ] }
```

The host draws it in the game's style, in the player's language. A control gives a `PANEL` event
(swatch: its index; slider: its value; button: 1). `leave` ends focus.

### 3.8 Keep-out

```json
{ "origin": [x0, y0, z0], "cell": 0.1, "dims": [nx, ny, nz], "keep": 0.12, "arm": 0.35, "radius": 16, "heights": [0.15, 0.55, 1.0, 1.5] }
```

`grid`: `nx·ny·nz` f32, the signed distance (m) to the solid at each grid point (x fastest, then y, then z),
from `origin` (island frame) by `cell` m. The host keeps the player's axis (at `heights` m over the feet)
`keep` m out of it, sideways only, and takes away the speed into it; the follow camera's arm stops `arm` m
short of it. Only within `radius` m of the origin, and not in focus. The grid is at most 4 M points.

## 4. Determinism

Every player sees the same island. Use `time` (the world clock) and `seed`; there is no other clock and
no random source. A player's own effect (a dent, a drop kicked away) may stay local, if it is small and
comes back to the shared state after a while.
