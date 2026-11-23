// Copied from the game (floating-city src/ugc/abi.js, 0095669+) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md): the contract between a UGC package and the game, flotopia-ugc/1, as data. The one
// source of the numbers and names: the checks (check/*.js), the sandbox worker (runtime/), the bridge on the
// main thread and the SDK (its abi.json is written from this file: tools/ugc-sdk-sync.mjs) read it. The
// words of the contract are the SDK's docs/abi.md. No imports: the worker and Node read it too.

export const SCHEMA = 'flotopia-ugc/1';

// the wasm value types of the imports and exports: i i32, f f32, d f64
// fc.*: the host interface (docs/abi.md 3.4); env.*: AssemblyScript's runtime
export const IMPORTS = {
  'fc.log': ['ii', ''],
  'fc.buffer': ['iii', 'i'],
  'fc.buffer_write': ['iiii', ''],
  'fc.geometry': ['ii', 'i'],
  'fc.geometry_range': ['iii', 'i'],
  'fc.texture': ['ii', 'i'],
  'fc.target': ['ii', 'i'],
  'fc.material': ['ii', 'i'],
  'fc.uniform': ['iiiii', ''],
  'fc.uniform_tex': ['iiiii', ''],
  'fc.mesh': ['iiii', 'i'],
  'fc.mesh_matrix': ['ii', ''],
  'fc.mesh_visible': ['ii', ''],
  'fc.node_visible': ['iii', ''],
  'fc.pass': ['ii', 'i'],
  'fc.pass_camera': ['iii', ''],
  'fc.pass_run': ['i', ''],
  'fc.act': ['ii', 'i'],
  'fc.act_enable': ['ii', ''],
  'fc.focus': ['ii', ''],
  'fc.focus_camera': ['ii', ''],
  'fc.focus_cursor': ['i', ''],
  'fc.focus_end': ['', ''],
  'fc.panel': ['ii', ''],
  'fc.keepout': ['iiii', ''],
  'fc.sleep': ['ff', ''],
  'env.abort': ['iiii', ''],
  'env.trace': ['iiddddd', ''],
  'env.seed': ['', 'd'],
};

// the exports the host calls (memory: exported, a maximum of at most MEMORY_PAGES)
export const EXPORTS = {
  fc_alloc: ['i', 'i'],
  fc_init: ['i', ''],
  fc_tick: ['ii', ''],
};

// which imports need which capability (runtime.caps); the rest need none
export const CAPS = ['shader', 'target', 'refract', 'keepout', 'focus'];
export const CAP_OF = {
  'fc.target': 'target',
  'fc.pass': 'target',
  'fc.pass_camera': 'target',
  'fc.pass_run': 'target',
  'fc.focus': 'focus',
  'fc.focus_camera': 'focus',
  'fc.focus_cursor': 'focus',
  'fc.focus_end': 'focus',
  'fc.panel': 'focus',
  'fc.keepout': 'keepout',
};

// the inbox (docs/abi.md 3.3): byte offsets
export const INBOX_BYTES = 16384;
export const INBOX = {
  time: 0, dt: 8, flags: 12, eye: 16, fwd: 28, feet: 40, vel: 52, mode: 64, sun: 68, night: 80, screen: 84, count: 92, events: 96,
};
export const EVENT_BYTES = 48;
export const MAX_EVENTS = Math.floor((INBOX_BYTES - INBOX.events) / EVENT_BYTES);
export const FLAG = { FOCUS: 1, PLAYER: 2, SUN: 4 };
export const MODE = { none: 0, walk: 1, air: 2, fly: 3, down: 4, swim: 5, ride: 6, other: 7 };
export const EV = { ACT: 1, FOCUS_END: 2, POINTER_DOWN: 3, POINTER_MOVE: 4, POINTER_UP: 5, WHEEL: 6, KEY: 7, PANEL: 8, GAMEPAD: 9 };
export const CURSOR = ['', 'grab', 'grabbing', 'pointer'];

// the errors a call returns (docs/abi.md 3.6)
export const ERR = { ARGS: -1, LIMIT: -2, CAP: -3, MISSING: -4 };

// fuel: about one unit an instruction (check/wasm.js meters the module)
export const FUEL = { init: 4e9, tick: 4e8 };

// the limits (docs/abi.md 2.5): per island
export const LIMITS = {
  // the package
  manifestBytes: 64 * 1024,
  files: 64,
  shellBytes: 0.3 * 2 ** 20,
  shellTris: 2000,
  nearBytes: 16 * 2 ** 20, // the near look and the rest of the static files, as stored
  runtimeBytes: 8 * 2 ** 20, // the wasm and the shaders
  coverSize: 1024,
  textureSize: 2048,
  titleChars: 40,
  aboutChars: 300, // ugc.json about: each language
  madeWith: 8, // ugc.json madeWith: entries
  madeWithChars: 40, // ugc.json madeWith: a harness's or a model's name
  footprintMax: 200, // m: the radius, or half the longer side
  activateMax: 400,
  lods: 4, // the near look's LODs (ugc.json lods)
  // the near look
  nearDraws: 30,
  nearTris: 500000,
  nearGpu: 64 * 2 ** 20,
  nodeDepth: 32, // a glTF's node tree
  // the run time, more
  runDraws: 30,
  runTris: 200000,
  runGpu: 64 * 2 ** 20,
  uploadTick: 2 ** 20,
  targets: 2,
  targetPixelsOver: 1024 * 1024, // past the screen's
  memoryPages: 1024,
  // ground, things
  cells: 256,
  polyPoints: 256,
  colliders: 512,
  gridPoints: 64 * 64,
  trees: 400,
  treeScaleMin: 0.2,
  treeScaleMax: 3,
  keepoutPoints: 4 * 2 ** 20,
  // shaders
  shaderBytes: 32 * 1024,
  shaderIterations: 1024,
  shaderSamples: 64,
  shaderUniforms: 32,
  shaderSamplers: 8,
  // logs
  logsPerSecond: 50,
};

export const GLTF_EXTENSIONS = [
  'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_materials_emissive_strength', 'EXT_mesh_gpu_instancing',
];
export const CITY_MATERIALS = ['paving', 'plaza', 'concrete', 'plaster', 'wood', 'sand', 'grass', 'metal', 'hull', 'glow', 'gloss', 'fabric'];
export const TREES = ['palmCoconut', 'palmRoyal', 'rainTree', 'frangipani', 'almond', 'shrub', 'bougainvillea', 'grass', 'hedge', 'forestTree', 'treeFern', 'fern', 'birch'];
export const SURFS = ['deck', 'grass', 'sand', 'wood', 'water'];

// shaders: the includes allowed, the host's uniform groups (docs/abi.md 3.5)
export const SHADER_INCLUDES = ['packing'];
export const HOST_UNIFORMS = {
  frame: { fcToLocal: 'mat4', fcToWorld: 'mat4', fcTime: 'float' },
  light: { fcSunDir: 'vec3', fcSunCol: 'vec3', fcHemiSky: 'vec3', fcHemiGround: 'vec3', fcEnvI: 'float', fcNight: 'float' },
  refract: { fcScene: 'sampler2D', fcDepth: 'sampler2D', fcScreen: 'vec2', fcCamFwd: 'vec3', fcNear: 'float', fcFar: 'float' },
};
// the groups the host declares in one stage only (the rest: in both)
export const HOST_STAGE = { refract: 'fragment' };
// the host's functions in a group: their stage, and the texture reads a call counts (check/glsl.js)
export const HOST_FUNCTIONS = { light: { fcEnv: { stage: 'fragment', samples: 2 } } };
// three.js's ShaderMaterial gives these (not the package's to declare)
export const THREE_BUILTINS = ['position', 'normal', 'uv', 'color', 'modelMatrix', 'viewMatrix', 'projectionMatrix', 'modelViewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic'];
export const UNIFORM_TYPES = { float: 1, vec2: 2, vec3: 3, vec4: 4, mat3: 9, mat4: 16, int: 1, sampler2D: 0 };
