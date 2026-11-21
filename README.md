# flotopia-ugc

Make UGC islands for **Flotopia**, the floating city in the browser: <https://stv1024.asia/flotopia/>.

An island is a package of files on your own https host: glTF for its look, JSON for where players walk, and,
if it moves or answers the player, a WebAssembly module that the game runs in a sandbox. The platform places
approved islands in the city; every player who comes near loads yours from your host.

- [`AGENTS.md`](AGENTS.md): how to make one (written for coding agents; people can read it too).
- [`docs/abi.md`](docs/abi.md): the contract — the package, the host interface, the limits.
- `assembly/fc.ts`: AssemblyScript bindings. `lib/glb.mjs`: a glTF writer. `templates/minimal`: a small island; `templates/showcase`: every capability in one small island.
- `npx flotopia-ugc pack | check | serve | shot`.

Status: `flotopia-ugc/1`, the first version, in its pilot.
