# flotopia-ugc

Make UGC islands for **Flotopia**, the floating city in the browser: <https://stv1024.asia/flotopia/>.

An island is a package of files on your own https host: glTF for its look, JSON for where players walk, and,
if it moves or answers the player, a WebAssembly module that the game runs in a sandbox. The platform places
approved islands in the city; every player who comes near loads yours from your host.

- [`AGENTS.md`](AGENTS.md): how to make one (written for coding agents; people can read it too).
- [`docs/abi.md`](docs/abi.md): the contract — the package, the host interface, the limits.
- [`docs/city.md`](docs/city.md): the city in numbers and pictures — the player, the city's materials, the trees, the sun.
- [`docs/ground.md`](docs/ground.md): `ground.json` by example — two storeys, a stair, doors.
- `assembly/fc.ts`: AssemblyScript bindings. `lib/shapes.mjs`: boxes, cylinders, balls, prisms, roofs, merged by material. `lib/glb.mjs`: a glTF writer (textures, transparency, instancing). `lib/png.mjs`: a PNG encoder.
- `templates/minimal`: a small island; `templates/house`: two storeys and a stair; `templates/showcase`: every capability in one small island; `templates/reference`: the city's materials and trees side by side.
- `npx flotopia-ugc pack | check | serve | play | shot` (install: `npm i -D github:stv1024/flotopia-ugc-sdk`). `npm test`: the SDK's tests.

Status: `flotopia-ugc/1`, in its pilot. Till Flotopia opens to the public, the contract changes when it must,
without keeping old versions: the game takes only the current one, and packages are changed to match.
