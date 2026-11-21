// Copied from the game (floating-city src/ugc/check/glsl.js, 87688c3) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md): the rules of a package's shaders (the SDK's docs/abi.md 3.5 "Shaders"), checked before the
// host compiles them. A tokenizer and a light parser, not a GLSL grammar, built not to be fooled:
//   - comments go first; a backslash anywhere is an error (a line continuation would join lines the parser keeps
//     apart); a block comment may not span lines next to a directive
//   - the preprocessor is only `#define NAME <number>` and `#include <x>` (SHADER_INCLUDES): the tokens the
//     compiler sees are the tokens here with the defines put in, exactly as the preprocessor would
//   - loops are only `for (int i = A; i < B; i++)` and its kin with constant A, B, step; the counter is not
//     changed in the body. Each loop's count is computed; nested loops multiply; a call counts the callee's work
//     there (the call graph from main; recursion is an error)
//   - texture reads counted the same way; uniforms only the material's (same type) and the requested host groups'
//   checkGlsl(source, { stage, defines, uniforms, host }) -> { ok, errors, stats }
//   stats: { iterations, samples, uniforms, samplers, bytes } (iterations and samples: one invocation of main)
// Pure: no DOM, no Node (the loader, the sandbox worker and the SDK's CLI use it). Nothing recurses on the input's
// depth without a cap (MAX_NEST).
import { HOST_FUNCTIONS, HOST_STAGE, HOST_UNIFORMS, LIMITS, SHADER_INCLUDES, THREE_BUILTINS, UNIFORM_TYPES } from '../abi.js';

const MAX_ERRORS = 40;
const MAX_NEST = 64; // statements in statements without braces; constant expressions
const BIG = 1e15; // the counts stop growing here (no Infinity x 0)
const sat = (x) => (x > BIG ? BIG : x);

// the built-in texture reads (GLSL ES 3.00, and the names three.js #defines to them); textureSize is not a read
const TEXTURE = new Set([
  'texture', 'textureProj', 'textureLod', 'textureOffset', 'texelFetch', 'texelFetchOffset', 'textureProjOffset',
  'textureLodOffset', 'textureProjLod', 'textureProjLodOffset', 'textureGrad', 'textureGradOffset', 'textureProjGrad',
  'textureProjGradOffset', 'texture2D', 'texture2DProj', 'texture2DLod', 'texture2DProjLod', 'textureCube',
  'textureCubeLod', 'texture2DLodEXT', 'texture2DProjLodEXT', 'textureCubeLodEXT', 'texture2DGradEXT',
  'texture2DProjGradEXT', 'textureCubeGradEXT',
]);
const QUALIFIERS = new Set(['const', 'uniform', 'in', 'out', 'inout', 'attribute', 'varying', 'centroid', 'flat', 'smooth', 'invariant', 'highp', 'mediump', 'lowp', 'precision']);
const PRECISION = new Set(['highp', 'mediump', 'lowp']);
const TYPES = new Set([
  'void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4', 'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2',
  'mat4x3', 'mat4x4', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'samplerCubeShadow', 'sampler2DArray',
  'sampler2DArrayShadow', 'isampler2D', 'isampler3D', 'isamplerCube', 'isampler2DArray', 'usampler2D', 'usampler3D',
  'usamplerCube', 'usampler2DArray',
]);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
const CMP = new Set(['<', '<=', '>', '>=', '!=']);
const CLOSE = { ')': '(', ']': '[', '}': '{' };
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RE_SPACE = /[ \t\v\f\r]+/y;
const RE_ID = /[A-Za-z_][A-Za-z0-9_]*/y;
const RE_NUM = /0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]?|\d+[eE][+-]?\d+[fF]?|\d+[uU]?/y;
const RE_OP = /<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|\+=|-=|\*=|\/=|%=|&=|\^=|\|=|[-+*/%<>=!&|^~?:;,.(){}[\]]/y;
const HOW_LOOP = 'Write loops as for (int i = A; i < B; i++) (also <=, >, >=, !=; i--, i += C, i -= C) with A, B, C integer constants: numbers, #defines, or const int at file scope.';

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const isSampler = (type) => /^[iu]?sampler/.test(type);

class Errs {
  constructor() { this.list = []; this.keys = new Set(); this.more = 0; }
  add(code, message, line, key) {
    if (key) {
      if (this.keys.has(key)) return;
      this.keys.add(key);
    }
    if (this.list.length >= MAX_ERRORS) return void this.more++;
    this.list.push(line ? { code, message: `Line ${line}: ${message}`, path: `line ${line}` } : { code, message });
  }
  out() {
    if (this.more) this.list.push({ code: 'E_GLSL_MORE', message: `${this.more} more errors are not listed. Fix the ones above first.` });
    return this.list;
  }
}

class Syntax extends Error {
  constructor(message, line) { super(message); this.line = line; }
}
const NOT_CONST = new Error('not constant');

function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// a number token: its value, and whether it is a (signed) int
function numToken(text, line) {
  const t = { k: 'num', v: text, line, val: NaN, int: false };
  if (/^0[xX]/.test(text)) {
    t.val = parseInt(text.replace(/[uU]$/, ''), 16);
    t.int = !/[uU]$/.test(text);
  } else if (/[.eEfF]/.test(text)) t.val = parseFloat(text);
  else if (/[uU]$/.test(text)) t.val = parseInt(text, 10);
  else if (/^0[0-7]+$/.test(text)) {
    t.val = parseInt(text, 8);
    t.int = true;
  } else if (!/^0\d/.test(text)) {
    t.val = parseInt(text, 10);
    t.int = true;
  }
  if (t.int && t.val > 2 ** 31) t.int = false;
  return t;
}

export function checkGlsl(source, opts) {
  const E = new Errs();
  const stats = { iterations: 0, samples: 0, uniforms: 0, samplers: 0, bytes: 0 };
  const done = () => {
    const errors = E.out();
    return { ok: !errors.length, errors, stats };
  };
  const o = isObj(opts) ? opts : {};
  const { stage } = o;
  const defines = o.defines === undefined ? {} : o.defines;
  const uniforms = o.uniforms === undefined ? {} : o.uniforms;
  const host = o.host === undefined ? [] : o.host;

  if (typeof source !== 'string') {
    E.add('E_GLSL_SOURCE', 'The shader is not text.');
    return done();
  }
  stats.bytes = source.length > 4 * LIMITS.shaderBytes ? source.length : utf8Length(source);
  if (stats.bytes > LIMITS.shaderBytes) {
    E.add('E_GLSL_SIZE', `The shader is ${stats.bytes} bytes; a stage may have at most ${LIMITS.shaderBytes} (docs/abi.md 3.5). Make it shorter (move tables into a texture or a uniform array).`);
    return done();
  }
  if (stage !== 'vertex' && stage !== 'fragment') {
    E.add('E_GLSL_STAGE', `The stage is ${JSON.stringify(stage)}; it must be "vertex" or "fragment".`);
    return done();
  }
  const req = new Set();
  if (!Array.isArray(host)) E.add('E_GLSL_HOST', `The material's "host" must be a list of host uniform groups (${Object.keys(HOST_UNIFORMS).join(', ')}).`);
  else for (const g of host) {
    if (typeof g === 'string' && Object.hasOwn(HOST_UNIFORMS, g)) req.add(g);
    else E.add('E_GLSL_HOST', `${JSON.stringify(g)} is not a host uniform group; the groups are ${Object.keys(HOST_UNIFORMS).join(', ')} (docs/abi.md 3.5).`);
  }
  if (!isObj(uniforms)) E.add('E_GLSL_UNIFORM', 'The material\'s "uniforms" must be an object { "<name>": "<type>" }.');
  const mine = isObj(uniforms) ? uniforms : {}; // the package's own uniforms

  // the host's names: uniforms and functions, by group
  const hostName = new Map();
  for (const [g, us] of Object.entries(HOST_UNIFORMS)) for (const [n, type] of Object.entries(us)) hostName.set(n, { group: g, type, fn: null });
  for (const [g, fs] of Object.entries(HOST_FUNCTIONS)) for (const [n, fn] of Object.entries(fs)) hostName.set(n, { group: g, type: null, fn });
  const inStage = (h) => (!HOST_STAGE[h.group] || HOST_STAGE[h.group] === stage) && (!h.fn || h.fn.stage === stage);
  const avail = (h) => req.has(h.group) && inStage(h);

  // ---------------------------------------------------------------- comments, characters
  const bs = source.indexOf('\\');
  if (bs >= 0) {
    const line = source.slice(0, bs).split('\n').length;
    E.add('E_GLSL_CHAR', 'a backslash. Line continuations are not allowed (even in comments); remove it.', line);
    return done();
  }
  const parts = [];
  const startsIn = new Set(), endsIn = new Set(); // lines a block comment spans out of / into (1-based)
  {
    let i = 0, seg = 0, line = 1;
    const n = source.length;
    let badChar = 0;
    while (i < n) {
      const c = source.charCodeAt(i);
      if (c === 47 && source.charCodeAt(i + 1) === 47) {
        parts.push(source.slice(seg, i));
        while (i < n && source.charCodeAt(i) !== 10) i++;
        seg = i;
        continue;
      }
      if (c === 47 && source.charCodeAt(i + 1) === 42) {
        parts.push(source.slice(seg, i), ' ');
        const from = line;
        let j = i + 2;
        while (j < n && !(source.charCodeAt(j) === 42 && source.charCodeAt(j + 1) === 47)) {
          if (source.charCodeAt(j) === 10) {
            endsIn.add(line);
            line++;
            startsIn.add(line);
            parts.push('\n');
          }
          j++;
        }
        if (j >= n) {
          E.add('E_GLSL_SYNTAX', 'a /* comment that is not closed.', from);
          return done();
        }
        i = j + 2;
        seg = i;
        continue;
      }
      if (c === 10) line++;
      else if ((c > 126 || (c < 32 && c !== 9 && c !== 11 && c !== 12 && c !== 13)) && badChar++ < 3) {
        E.add('E_GLSL_CHAR', `the character ${JSON.stringify(source[i])} (outside a comment): GLSL source is ASCII outside comments.`, line);
      }
      i++;
    }
    parts.push(source.slice(seg));
  }
  const lines = parts.join('').split('\n');

  // ---------------------------------------------------------------- the preprocessor, the tokens
  const defs = new Map(); // name -> the tokens it stands for
  const lex = (s, line, out, subst) => {
    let p = 0;
    while (p < s.length) {
      RE_SPACE.lastIndex = p;
      if (RE_SPACE.test(s)) {
        p = RE_SPACE.lastIndex;
        continue;
      }
      RE_ID.lastIndex = p;
      let m = RE_ID.exec(s);
      if (m) {
        p = RE_ID.lastIndex;
        const d = subst && defs.get(m[0]);
        if (d) for (const t of d) out.push({ ...t, line });
        else out.push({ k: 'id', v: m[0], line });
        continue;
      }
      RE_NUM.lastIndex = p;
      m = RE_NUM.exec(s);
      if (m) {
        p = RE_NUM.lastIndex;
        out.push(numToken(m[0], line));
        continue;
      }
      RE_OP.lastIndex = p;
      m = RE_OP.exec(s);
      if (m) {
        p = RE_OP.lastIndex;
        out.push({ k: 'op', v: m[0], line });
        continue;
      }
      if (s[p] === '#') E.add('E_GLSL_PREPROC', 'a "#" that does not start its line: a directive must be on a line of its own.', line);
      else E.add('E_GLSL_CHAR', `the character ${JSON.stringify(s[p])} is not GLSL.`, line);
      p++;
    }
    return out;
  };
  // a number of a #define: its tokens ([num] or [sign, num]); null if it is not one number
  const number = (text, line) => {
    const t = lex(text, line, [], false);
    if (t.length === 1 && t[0].k === 'num') return t;
    if (t.length === 2 && (t[0].v === '-' || t[0].v === '+') && t[1].k === 'num') return t;
    return null;
  };
  const define = (name, value, line, where) => {
    if (!ID_RE.test(name)) return void E.add('E_GLSL_DEFINE', `${where}: ${JSON.stringify(name)} is not a name.`, line);
    if (name.startsWith('GL_') || name.includes('__')) return void E.add('E_GLSL_DEFINE', `${where}: ${name} is reserved by GLSL (GL_..., names with "__").`, line);
    if (name.startsWith('fc')) return void E.add('E_GLSL_RESERVED', `${where}: ${name}: names starting with "fc" are the host's. Rename it.`, line);
    if (defs.has(name)) return void E.add('E_GLSL_DEFINE', `${where}: ${name} is defined twice (a #define, or the material's "defines").`, line);
    const t = value === null ? null : number(value, line);
    if (!t) return void E.add('E_GLSL_DEFINE', `${where}: ${name} must stand for one number (an int or a float literal); it is ${JSON.stringify(value)}.`, line);
    defs.set(name, t);
  };
  if (!isObj(defines)) E.add('E_GLSL_DEFINE', 'The material\'s "defines" must be an object { "<NAME>": <number> }.');
  else for (const [k, v] of Object.entries(defines)) {
    define(k, typeof v === 'number' && Number.isFinite(v) ? (v < 0 ? `-${String(-v)}` : String(v)) : null, 0, `the material's define ${JSON.stringify(k)}`);
  }

  const T = [];
  lines.forEach((text, i) => {
    const line = i + 1;
    const d = /^[ \t\v\f\r]*#/.exec(text);
    if (!d) return void lex(text, line, T, true);
    if (startsIn.has(line) || endsIn.has(line)) {
      return void E.add('E_GLSL_PREPROC', 'a block comment that spans lines touches a directive. Put the directive on a line of its own, without /* */ comments across lines.', line);
    }
    const rest = text.slice(d[0].length);
    const w = /^[ \t\v\f\r]*([A-Za-z_][A-Za-z0-9_]*)?/.exec(rest);
    const after = rest.slice(w[0].length);
    if (w[1] === 'define') {
      const m = /^[ \t\v\f\r]+([A-Za-z_][A-Za-z0-9_]*)(\(?)(.*)$/.exec(after);
      if (!m) E.add('E_GLSL_PREPROC', '#define without a name.', line);
      else if (m[2]) E.add('E_GLSL_PREPROC', `#define ${m[1]}(...): macros with arguments are not allowed; write a function.`, line);
      else define(m[1], m[3].trim(), line, '#define');
    } else if (w[1] === 'include') {
      const m = /^[ \t\v\f\r]*<([A-Za-z_][A-Za-z0-9_]*)>[ \t\v\f\r]*$/.exec(after);
      if (!m || !SHADER_INCLUDES.includes(m[1])) {
        E.add('E_GLSL_PREPROC', `#include ${after.trim()}: only ${SHADER_INCLUDES.map((x) => `#include <${x}>`).join(', ')} is allowed.`, line);
      }
    } else {
      E.add('E_GLSL_PREPROC', `#${w[1] || ''} is not allowed: the only directives are #define NAME <number> and ${SHADER_INCLUDES.map((x) => `#include <${x}>`).join(', ')} (no #if, #ifdef, #version, #extension, #pragma, #undef, #line). The host adds #version and the precision.`, line);
    }
  });
  if (!T.length) {
    E.add('E_GLSL_MAIN', 'The shader has no code (no main()).');
    return done();
  }

  // ---------------------------------------------------------------- brackets
  const match = new Int32Array(T.length).fill(-1);
  {
    const st = [];
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (t.k !== 'op') continue;
      if (t.v === '(' || t.v === '[' || t.v === '{') st.push(i);
      else if (CLOSE[t.v]) {
        const open = st.pop();
        if (open === undefined || T[open].v !== CLOSE[t.v]) {
          E.add('E_GLSL_SYNTAX', `an unmatched "${t.v}".`, t.line);
          return done();
        }
        match[open] = i;
        match[i] = open;
      }
    }
    if (st.length) {
      E.add('E_GLSL_SYNTAX', `a "${T[st[st.length - 1]].v}" that is not closed.`, T[st[st.length - 1]].line);
      return done();
    }
  }
  const isOp = (i, v) => i >= 0 && i < T.length && T[i].k === 'op' && T[i].v === v;
  const text = (s, e) => {
    const x = T.slice(s, Math.min(e, s + 12)).map((t) => t.v).join(' ');
    return e - s > 12 ? `${x} ...` : x;
  };
  // the first token v in [s, e) outside brackets
  const top = (s, e, v) => {
    for (let k = s; k < e; k++) {
      if (T[k].k !== 'op') continue;
      if (T[k].v === '(' || T[k].v === '[' || T[k].v === '{') k = match[k];
      else if (T[k].v === v) return k;
    }
    return -1;
  };

  // ---------------------------------------------------------------- file scope
  const funcs = new Map(); // name -> [{ name, line, params: [{ name, out }], bs, be }]
  const consts = new Map(); // const int at file scope -> its value
  const decls = []; // uniform declarations: { name, type, arr, line }
  const structs = new Set();

  // an integer constant expression over [s, e): numbers, const ints, + - * / %, parentheses (null: not one)
  let shadowed = null;
  const evalInt = (s, e, locals) => {
    let p = s;
    shadowed = null;
    const prim = (d) => {
      if (d > MAX_NEST || p >= e) throw NOT_CONST;
      const t = T[p];
      if (t.k === 'op' && (t.v === '-' || t.v === '+')) {
        p++;
        const v = prim(d + 1);
        return t.v === '-' ? -v : v;
      }
      if (t.k === 'op' && t.v === '(') {
        const close = match[p];
        if (close >= e) throw NOT_CONST;
        p++;
        const v = sum(d + 1);
        if (p !== close) throw NOT_CONST;
        p++;
        return v;
      }
      if (t.k === 'num' && t.int) {
        p++;
        return t.val;
      }
      if (t.k === 'id' && consts.has(t.v)) {
        if (locals && locals.has(t.v)) {
          shadowed = t.v;
          throw NOT_CONST;
        }
        p++;
        return consts.get(t.v);
      }
      throw NOT_CONST;
    };
    const prod = (d) => {
      let v = prim(d);
      while (p < e && T[p].k === 'op' && (T[p].v === '*' || T[p].v === '/' || T[p].v === '%')) {
        const op = T[p++].v;
        const w = prim(d);
        if (op === '*') v *= w;
        else if (w === 0) throw NOT_CONST;
        else v = op === '/' ? Math.trunc(v / w) : v % w;
        if (Math.abs(v) > 2 ** 31) throw NOT_CONST;
      }
      return v;
    };
    const sum = (d) => {
      let v = prod(d);
      while (p < e && T[p].k === 'op' && (T[p].v === '+' || T[p].v === '-')) {
        const op = T[p++].v;
        const w = prod(d);
        v = op === '+' ? v + w : v - w;
        if (Math.abs(v) > 2 ** 31) throw NOT_CONST;
      }
      return v;
    };
    try {
      const v = sum(0);
      return p === e ? v : null;
    } catch (x) {
      if (x === NOT_CONST) return null;
      throw x;
    }
  };

  const arrSize = (k) => {
    const n = evalInt(k + 1, match[k], null);
    if (n === null || n < 1) {
      E.add('E_GLSL_SYNTAX', `the array size [${text(k + 1, match[k])}] is not a positive integer constant.`, T[k].line);
      return 1;
    }
    return n;
  };

  const uniformDecl = (k, e) => {
    const line = T[k].line;
    const bad = () => void E.add('E_GLSL_UNIFORM', `a uniform declaration that is not "uniform <type> <name>;" or "uniform <type> <name>[<n>];" (no initializers, no blocks): ${text(k, e)}.`, line);
    if (T[k].k !== 'id') return bad();
    const type = T[k++].v;
    let tArr = null;
    if (isOp(k, '[')) {
      tArr = arrSize(k);
      k = match[k] + 1;
    }
    for (;;) {
      if (k >= e || T[k].k !== 'id') return bad();
      const name = T[k++].v;
      let arr = tArr;
      if (k < e && isOp(k, '[')) {
        arr = arrSize(k);
        k = match[k] + 1;
      }
      decls.push({ name, type, arr, line });
      if (k === e) return;
      if (!isOp(k, ',')) return bad();
      k++;
    }
  };

  const constInts = (k, e) => {
    while (k < e) {
      if (T[k].k !== 'id' || !isOp(k + 1, '=')) return;
      const name = T[k].v;
      let x = k + 2;
      for (; x < e; x++) {
        if (isOp(x, '(') || isOp(x, '[')) x = match[x];
        else if (isOp(x, ',')) break;
      }
      const v = evalInt(k + 2, x, null);
      if (v !== null) consts.set(name, v);
      k = x + 1;
    }
  };

  const declaration = (s, e) => {
    let k = s;
    const q = new Set();
    while (k < e) {
      const v = T[k].v;
      if (v === 'layout' && isOp(k + 1, '(')) {
        k = match[k + 1] + 1;
        continue;
      }
      if (T[k].k !== 'id' || !QUALIFIERS.has(v)) break;
      q.add(v);
      k++;
    }
    if (k >= e || q.has('precision')) return;
    if (q.has('attribute') && stage === 'fragment') E.add('E_GLSL_STAGE', '"attribute" in a fragment shader: attributes are for the vertex stage (pass them on with varying / out).', T[s].line);
    if (q.has('uniform')) return uniformDecl(k, e);
    if (q.has('const') && T[k].v === 'int') constInts(k + 1, e);
  };

  const defineFunction = (nameTok, open, close, body) => {
    const params = [];
    let s = open + 1;
    for (let k = open + 1; k <= close; k++) {
      if (k < close && (isOp(k, '(') || isOp(k, '['))) {
        k = match[k];
        continue;
      }
      if (k !== close && !isOp(k, ',')) continue;
      if (k > s) {
        const toks = T.slice(s, k);
        let name = null;
        for (const t of toks) {
          if (t.v === '[') break;
          if (t.k === 'id' && !QUALIFIERS.has(t.v) && !TYPES.has(t.v) && !structs.has(t.v)) name = t.v;
        }
        params.push({ name, out: toks.some((t) => t.v === 'out' || t.v === 'inout') });
      }
      s = k + 1;
    }
    const f = { name: nameTok.v, line: nameTok.line, params, bs: body, be: match[body] };
    if (hostName.has(f.name)) E.add('E_GLSL_RESERVED', `a function named ${f.name}: that is the host's name. Rename it.`, f.line);
    if (funcs.has(f.name)) funcs.get(f.name).push(f);
    else funcs.set(f.name, [f]);
    return f;
  };

  for (let i = 0; i < T.length;) {
    let j = i, isStruct = false, fn = null;
    for (; j < T.length; j++) {
      const t = T[j];
      if (t.k !== 'op') {
        if (t.v === 'struct') {
          isStruct = true;
          if (T[j + 1]?.k === 'id') structs.add(T[j + 1].v);
        }
        continue;
      }
      if (t.v === '(' || t.v === '[') {
        j = match[j];
        continue;
      }
      if (t.v === ';') break;
      if (t.v === '{') {
        if (j - 1 > i && isOp(j - 1, ')') && match[j - 1] - 1 >= i && T[match[j - 1] - 1].k === 'id') {
          fn = defineFunction(T[match[j - 1] - 1], match[j - 1], j - 1, j);
          break;
        }
        if (!isStruct) E.add('E_GLSL_SYNTAX', 'a { } block at file scope that is not a function or a struct (interface blocks are not allowed).', t.line);
        j = match[j];
      }
    }
    if (fn) {
      i = fn.be + 1;
      continue;
    }
    if (j >= T.length) {
      E.add('E_GLSL_SYNTAX', 'the shader ends without a ";" after its last declaration.', T[T.length - 1].line);
      break;
    }
    declaration(i, j);
    i = j + 1;
  }

  // ---------------------------------------------------------------- functions: loops, reads, calls
  // the end (exclusive) of the statement that starts at s
  const stmtEnd = (s, d) => {
    if (d > MAX_NEST) throw new Syntax(`statements nested more than ${MAX_NEST} deep without braces.`, T[s]?.line);
    const t = T[s];
    if (!t) throw new Syntax('the shader ends inside a statement.', T[T.length - 1].line);
    if (t.k === 'op' && t.v === '{') return match[s] + 1;
    if (t.k === 'id') {
      if (t.v === 'for' || t.v === 'while' || t.v === 'switch') {
        if (!isOp(s + 1, '(')) throw new Syntax(`"${t.v}" without "(".`, t.line);
        return stmtEnd(match[s + 1] + 1, d + 1);
      }
      if (t.v === 'if') {
        for (let k = s; ;) {
          if (!isOp(k + 1, '(')) throw new Syntax('"if" without "(".', T[k].line);
          const end = stmtEnd(match[k + 1] + 1, d + 1);
          if (T[end]?.v !== 'else') return end;
          if (T[end + 1]?.v !== 'if') return stmtEnd(end + 1, d + 1);
          k = end + 1;
        }
      }
      if (t.v === 'do') {
        const end = stmtEnd(s + 1, d + 1);
        if (T[end]?.v !== 'while' || !isOp(end + 1, '(') || !isOp(match[end + 1] + 1, ';')) throw new Syntax('"do" without "while (...);".', t.line);
        return match[end + 1] + 2;
      }
    }
    for (let k = s; k < T.length; k++) {
      const x = T[k];
      if (x.k !== 'op') continue;
      if (x.v === '(' || x.v === '[' || x.v === '{') k = match[k];
      else if (x.v === ';') return k + 1;
      else if (x.v === '}') throw new Syntax('a statement without ";".', x.line);
    }
    throw new Syntax('the shader ends inside a statement.', T[T.length - 1].line);
  };

  // the names declared in a function (its parameters, its locals): a loop bound may not use them
  const localsOf = (f) => {
    const names = new Set(f.params.map((p) => p.name).filter(Boolean));
    for (let t = f.bs + 1; t < f.be; t++) {
      const tok = T[t];
      if (tok.k !== 'id' || !(TYPES.has(tok.v) || structs.has(tok.v))) continue;
      let k = t + 1;
      if (isOp(k, '[')) k = match[k] + 1;
      if (T[k]?.k !== 'id') continue;
      names.add(T[k].v);
      for (let x = k + 1; x < f.be; x++) {
        if (isOp(x, '(') || isOp(x, '[')) x = match[x];
        else if (isOp(x, ';') || isOp(x, ')') || isOp(x, '{') || isOp(x, '}')) break;
        else if (isOp(x, ',') && T[x + 1]?.k === 'id') names.add(T[x + 1].v);
      }
    }
    return names;
  };

  const constant = (s, e, locals, what, line) => {
    const v = s < e ? evalInt(s, e, locals) : null;
    if (v !== null) return v;
    if (shadowed) E.add('E_GLSL_LOOP', `the loop's ${what} uses ${shadowed}, which this function declares again (a parameter or a local): it is not the constant at file scope there. Rename one of them.`, line);
    else E.add('E_GLSL_LOOP', `the loop's ${what} (${text(s, e)}) is not an integer constant. ${HOW_LOOP}`, line);
    return null;
  };

  const iterations = (A, op, B, s) => {
    if (op === '!=') {
      const d = B - A;
      return d % s === 0 && d / s >= 0 ? d / s : null;
    }
    const up = op === '<' || op === '<=';
    const holds = op === '<' ? A < B : op === '<=' ? A <= B : op === '>' ? A > B : A >= B;
    if (!holds) return 0;
    if (up ? s < 0 : s > 0) return null; // away from the bound: it ends only when the int wraps
    const span = up ? B - A : A - B;
    return op === '<' || op === '>' ? Math.ceil(span / Math.abs(s)) : Math.floor(span / Math.abs(s)) + 1;
  };

  // the counter is not changed in the body [bs, be): assigned, ++/--, or passed as an out/inout argument
  const counterChanged = (name, bs, be) => {
    for (let t = bs; t < be; t++) {
      const tok = T[t];
      if (tok.k !== 'id') continue;
      if (tok.v === name) {
        const nx = T[t + 1], pv = T[t - 1];
        if ((nx?.k === 'op' && (ASSIGN.has(nx.v) || nx.v === '++' || nx.v === '--')) || (pv?.k === 'op' && (pv.v === '++' || pv.v === '--'))) return tok.line;
      } else if (funcs.has(tok.v) && isOp(t + 1, '(')) {
        const outs = new Set();
        for (const f of funcs.get(tok.v)) f.params.forEach((p, i) => p.out && outs.add(i));
        if (!outs.size) continue;
        const close = match[t + 1];
        let arg = 0, s = t + 2;
        for (let k = t + 2; k <= close; k++) {
          if (k < close && (isOp(k, '(') || isOp(k, '['))) {
            k = match[k];
            continue;
          }
          if (k !== close && !isOp(k, ',')) continue;
          let a = s, b = k;
          while (b - a >= 2 && isOp(a, '(') && match[a] === b - 1) { a++; b--; }
          if (outs.has(arg) && b - a === 1 && T[a].v === name) return tok.line;
          arg++;
          s = k + 1;
        }
      }
    }
    return 0;
  };

  const forLoop = (t, locals) => {
    const line = T[t].line;
    const bad = (why) => void E.add('E_GLSL_LOOP', `${why} ${HOW_LOOP}`, line);
    if (!isOp(t + 1, '(')) return bad('"for" without "(".');
    const close = match[t + 1];
    let k = t + 2;
    if (PRECISION.has(T[k].v)) k++;
    if (T[k]?.v !== 'int') return bad('the loop\'s counter must be declared as an int in the loop.');
    const ctr = T[k + 1];
    if (ctr?.k !== 'id' || !isOp(k + 2, '=')) return bad('the loop must start "int <counter> = <start>;".');
    const s1 = top(k + 3, close, ';');
    if (s1 < 0) return bad('the loop has no ";".');
    const A = constant(k + 3, s1, locals, 'start', line);
    if (A === null) return null;
    if (T[s1 + 1]?.v !== ctr.v || T[s1 + 2]?.k !== 'op' || !CMP.has(T[s1 + 2].v)) return bad(`the condition must be "${ctr.v} <op> <bound>", <op> one of < <= > >= !=.`);
    const op = T[s1 + 2].v;
    const s2 = top(s1 + 3, close, ';');
    if (s2 < 0) return bad('the loop has no second ";".');
    const B = constant(s1 + 3, s2, locals, 'bound', line);
    if (B === null) return null;
    const a = T[s2 + 1], b = T[s2 + 2];
    let step = null;
    if (a?.v === ctr.v && b?.k === 'op' && (b.v === '++' || b.v === '--') && s2 + 3 === close) step = b.v === '++' ? 1 : -1;
    else if (a?.k === 'op' && (a.v === '++' || a.v === '--') && b?.v === ctr.v && s2 + 3 === close) step = a.v === '++' ? 1 : -1;
    else if (a?.v === ctr.v && b?.k === 'op' && (b.v === '+=' || b.v === '-=')) {
      const C = constant(s2 + 3, close, locals, 'step', line);
      if (C === null) return null;
      step = b.v === '+=' ? C : -C;
    } else return bad(`the step must be ${ctr.v}++, ${ctr.v}--, ++${ctr.v}, --${ctr.v}, ${ctr.v} += C or ${ctr.v} -= C.`);
    if (step === 0) return bad('the step is 0: the loop never ends.');
    const n = iterations(A, op, B, step);
    if (n === null) return bad(`the loop never ends (${ctr.v} from ${A}, while ${ctr.v} ${op} ${B}, step ${step}).`);
    const be = stmtEnd(close + 1, 0);
    const changed = counterChanged(ctr.v, close + 1, be);
    if (changed) E.add('E_GLSL_LOOP', `the loop's counter ${ctr.v} is changed (or declared again) in its body; it may only be read there (x[${ctr.v}] = ... is fine).`, changed);
    return { n, close, be };
  };

  const analyze = (f) => {
    const locals = localsOf(f);
    const res = { iters: 0, samples: 0, calls: [] };
    const stack = [];
    let mult = 1;
    for (let t = f.bs + 1; t < f.be; t++) {
      while (stack.length && t >= stack[stack.length - 1].end) {
        stack.pop();
        mult = stack.length ? stack[stack.length - 1].mult : 1;
      }
      const tok = T[t];
      if (tok.k !== 'id') continue;
      const v = tok.v;
      if (v === 'while' || v === 'do') {
        E.add('E_GLSL_LOOP', `a "${v}" loop: only for loops are allowed. ${HOW_LOOP}`, tok.line);
        continue;
      }
      if (v === 'for') {
        const L = forLoop(t, locals);
        if (!L) continue;
        res.iters = sat(res.iters + sat(L.n * mult));
        mult = sat(mult * L.n);
        stack.push({ end: L.be, mult });
        t = L.close;
        continue;
      }
      if (!isOp(t + 1, '(')) continue;
      const h = hostName.get(v);
      if (TEXTURE.has(v)) res.samples = sat(res.samples + mult);
      else if (h && h.fn) {
        if (avail(h)) res.samples = sat(res.samples + mult * h.fn.samples);
      } else if (funcs.has(v)) res.calls.push([v, mult]);
    }
    return res;
  };

  const own = new Map();
  for (const fs of funcs.values()) {
    for (const f of fs) {
      try {
        own.set(f, analyze(f));
      } catch (x) {
        if (!(x instanceof Syntax)) throw x;
        E.add('E_GLSL_SYNTAX', x.message, x.line);
        own.set(f, { iters: 0, samples: 0, calls: [] });
      }
    }
  }

  // the totals by name, callees first (iteratively); a cycle is recursion. Overloads: the largest
  const total = new Map(), state = new Map();
  const callees = (name) => funcs.get(name).flatMap((f) => own.get(f).calls.map((c) => c[0]));
  for (const root of funcs.keys()) {
    if (state.has(root)) continue;
    state.set(root, 1);
    const st = [{ name: root, cs: callees(root), i: 0 }];
    while (st.length) {
      const top = st[st.length - 1];
      if (top.i < top.cs.length) {
        const c = top.cs[top.i++];
        const s = state.get(c);
        if (s === 1) {
          const cycle = [...st.slice(st.findIndex((x) => x.name === c)).map((x) => x.name), c].join(' -> ');
          E.add('E_GLSL_RECURSION', `recursion: ${cycle}. GLSL does not allow it; write it as a loop.`, funcs.get(c)[0].line, `rec:${c}`);
        } else if (!s) {
          state.set(c, 1);
          st.push({ name: c, cs: callees(c), i: 0 });
        }
        continue;
      }
      let iters = 0, samples = 0;
      for (const f of funcs.get(top.name)) {
        const o = own.get(f);
        let fi = o.iters, fs = o.samples;
        for (const [c, m] of o.calls) {
          const tc = total.get(c);
          if (!tc) continue;
          fi = sat(fi + sat(m * tc.iters));
          fs = sat(fs + sat(m * tc.samples));
        }
        iters = Math.max(iters, fi);
        samples = Math.max(samples, fs);
      }
      total.set(top.name, { iters, samples });
      state.set(top.name, 2);
      st.pop();
    }
  }
  const main = total.get('main');
  if (!main) E.add('E_GLSL_MAIN', 'The shader has no "void main()".');
  else {
    stats.iterations = main.iters;
    stats.samples = main.samples;
    if (main.iters > LIMITS.shaderIterations) {
      E.add('E_GLSL_ITERATIONS', `main runs ${main.iters >= BIG ? 'too many' : main.iters} loop iterations an invocation (nested loops multiply; a call counts the loops of the function it calls); the limit is ${LIMITS.shaderIterations} (docs/abi.md 3.5). Make the loops shorter, or spread the work over frames or over a texture.`);
    }
    if (main.samples > LIMITS.shaderSamples) {
      E.add('E_GLSL_SAMPLES', `main reads textures ${main.samples >= BIG ? 'too many' : main.samples} times an invocation (loops counted; ${[...hostName].filter(([, h]) => h.fn).map(([n, h]) => `${n}() counts ${h.fn.samples}`).join(', ')}); the limit is ${LIMITS.shaderSamples}. Take fewer samples.`);
    }
  }

  // ---------------------------------------------------------------- names: fc..., the host's groups
  const seen = new Set();
  for (const t of T) {
    if (t.k !== 'id' || !t.v.startsWith('fc') || seen.has(t.v)) continue;
    seen.add(t.v);
    const h = hostName.get(t.v);
    if (!h) E.add('E_GLSL_RESERVED', `${t.v}: names starting with "fc" are the host's (docs/abi.md 3.5). Rename it.`, t.line);
    else if (!req.has(h.group)) E.add('E_GLSL_HOST', `${t.v} is in the host group "${h.group}", which the material does not request. Add "${h.group}" to the material's "host".`, t.line);
    else if (!inStage(h)) E.add('E_GLSL_HOST', `${t.v} is only in the ${h.fn ? h.fn.stage : HOST_STAGE[h.group]} stage.`, t.line);
  }

  // ---------------------------------------------------------------- uniforms
  for (const d of decls) {
    const full = d.arr ? `${d.type}[${d.arr}]` : d.type;
    const h = hostName.get(d.name);
    if (h) {
      if (req.has(h.group)) E.add('E_GLSL_UNIFORM', `uniform ${d.name}: the host declares it (group "${h.group}"); remove the declaration.`, d.line);
      continue;
    }
    if (THREE_BUILTINS.includes(d.name)) continue;
    if (!Object.hasOwn(UNIFORM_TYPES, d.type)) {
      E.add('E_GLSL_UNIFORM', `uniform ${d.name} has the type ${d.type}, which the host cannot set; use one of ${Object.keys(UNIFORM_TYPES).join(', ')} (or an array of one).`, d.line);
    } else if (!Object.hasOwn(mine, d.name)) {
      E.add('E_GLSL_UNIFORM', `uniform ${d.name} is not in the material's "uniforms". Add "${d.name}": "${full}" there.`, d.line);
    } else if (mine[d.name] !== full) {
      E.add('E_GLSL_UNIFORM', `uniform ${d.name} is ${full} here but ${JSON.stringify(mine[d.name])} in the material's "uniforms". Make them the same.`, d.line);
    }
    if (isSampler(d.type)) stats.samplers += d.arr || 1;
    else stats.uniforms += d.arr || 1;
  }
  for (const [, h] of hostName) if (h.type && avail(h) && isSampler(h.type)) stats.samplers++;
  if (stats.uniforms > LIMITS.shaderUniforms) {
    E.add('E_GLSL_UNIFORMS', `The shader declares ${stats.uniforms} uniforms (arrays count their length); the limit is ${LIMITS.shaderUniforms}. Pack them into vectors or a texture.`);
  }
  if (stats.samplers > LIMITS.shaderSamplers) {
    E.add('E_GLSL_SAMPLERS', `The shader uses ${stats.samplers} samplers (the host's included); the limit is ${LIMITS.shaderSamplers}. Pack textures into an atlas.`);
  }
  return done();
}
