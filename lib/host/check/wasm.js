// Copied from the game (floating-city src/ugc/check/wasm.js, a86282a) by its tools/ugc-sdk-sync.mjs: do not edit here.
// UGC (docs/技术/UGC.md「运行时代码」): a package's run-time code, flotopia-ugc/1 (the SDK's docs/abi.md 3.1, 3.2).
//   inspectWasm(bytes) -> { ok, errors, info }   decode every section and every instruction of every function
//       body, check the imports, the exports, the memory and the features against the contract
//   meterWasm(bytes, { init, exportName }) -> Uint8Array   the same module, counting fuel in an exported mutable
//       i64 global: charged at the start of every function body and every loop body (that region's own
//       instructions) and before the bulk operations by their length (memory.copy, .fill, .init: one unit per
//       64 bytes; table.copy, .fill, .init, .grow: per 8 entries); below 0 it traps (unreachable)
// Pure (no DOM, no Node; only abi.js): the loader on the main thread, the sandbox worker and the SDK's CLI use it.
// The bytes are hostile: every count read from them is checked against a limit before it is used, nothing
// recurses, a malformed module is an error (inspectWasm never throws). Custom sections: meterWasm keeps "name"
// (stack traces) and drops the rest (debug info would point at the wrong code after the inserts).
import { EXPORTS, FUEL, IMPORTS, LIMITS } from '../abi.js';

// the WebAssembly JS API's limits (the engines', not the contract's): the caps on the counts read from the input
const MAX = {
  types: 1000000, funcs: 1000000, imports: 100000, exports: 100000, globals: 1000000, tables: 100000, memories: 100,
  elems: 10000000, data: 100000, params: 1000, locals: 50000, bodyBytes: 7654321, brTable: 65520,
};
const MAX_ERRORS = 40;
const PAGE = 65536;

// the features not allowed: what it is, how to build without it
const FEATURES = {
  threads: ['threads (atomics, shared memory)', 'Build without threads: no shared memory, no atomics (clang: no -pthread / -matomics; Rust: no +atomics; AssemblyScript: no --enable threads).'],
  exceptions: ['exception handling (try, catch, throw, tags, exnref)', 'Build without WebAssembly exceptions (clang: -fno-exceptions, no -fwasm-exceptions; Rust: panic = "abort"; AssemblyScript: no --enable exception-handling).'],
  tailCalls: ['tail calls (return_call, return_call_indirect, return_call_ref)', 'Build without tail calls (clang: no -mtail-call; Rust: no +tail-call; wasm-opt: no --enable-tail-call).'],
  gc: ['typed function references or GC (call_ref, br_on_null, ref.as_non_null, (ref ...) types, struct/array types, the 0xFB instructions)', 'Build without GC and typed function references (no -mgc / --enable gc; wasm-GC targets of Kotlin, Dart or Java are not supported).'],
  relaxedSimd: ['relaxed SIMD (0xFD 0x100-0x113)', 'Use fixed-width SIMD only (clang/Rust: no -mrelaxed-simd / +relaxed-simd; AssemblyScript: no --enable relaxed-simd).'],
  memory64: ['memory64 (a 64-bit memory or table)', 'Build for wasm32 (a 32-bit memory), not wasm64.'],
  multiMemory: ['more than one memory', 'Use one memory, exported as "memory".'],
  extendedConst: ['extended constant expressions (i32.add/sub/mul, i64.add/sub/mul in a constant expression)', 'Build without extended-const (clang/Rust: no -mextended-const / +extended-const).'],
  pageSize: ['custom page sizes', 'Use the default 64 KiB pages.'],
  unknown: ['an instruction or encoding that flotopia-ugc/1 does not know', 'Build only with the features of docs/abi.md 3.1 (MVP, mutable globals, sign extension, non-trapping float-to-int, bulk memory, multi-value, reference types, fixed-width SIMD).'],
};

class Bad extends Error {} // malformed: the decoding cannot go on
const STOP = new Error('stop'); // a feature that is not allowed (reported): skip the rest of this section or body

const hex = (n) => `0x${n.toString(16)}`;
const show = (s) => JSON.stringify(s.length > 64 ? `${s.slice(0, 61)}...` : s);
const mb = (n) => `${+(n / 2 ** 20).toFixed(2)} MB`;

// the errors, at most MAX_ERRORS; the ones with a key are given once, with the number of places
class Errs {
  constructor() { this.list = []; this.by = new Map(); this.more = 0; }
  add(code, message, path, key) {
    if (key) {
      const e = this.by.get(key);
      if (e) return void e.n++;
    }
    if (this.list.length >= MAX_ERRORS) return void this.more++;
    const e = { code, message, n: 1 };
    if (path) e.path = path;
    this.list.push(e);
    if (key) this.by.set(key, e);
  }
  feature(key, where, at) {
    const [what, how] = FEATURES[key];
    this.add('E_WASM_FEATURE', `${where} uses ${what} (at byte ${hex(at)}), which flotopia-ugc/1 does not allow. ${how}`, where, key);
  }
  out() {
    const list = this.list.map(({ code, message, path, n }) => {
      const e = { code, message: n > 1 ? `${message} (${n} places in all; this is the first)` : message };
      if (path) e.path = path;
      return e;
    });
    if (this.more) list.push({ code: 'E_WASM_MORE', message: `${this.more} more errors are not listed. Fix the ones above first.` });
    return list;
  }
}

// ------------------------------------------------------------------ reading

const UTF8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
  constructor(b, p, end) { this.b = b; this.p = p; this.end = end; }
  byte() {
    if (this.p >= this.end) throw new Bad(`it ends early (at byte ${hex(this.p)})`);
    return this.b[this.p++];
  }
  peek() {
    if (this.p >= this.end) throw new Bad(`it ends early (at byte ${hex(this.p)})`);
    return this.b[this.p];
  }
  skip(n) {
    if (n > this.end - this.p) throw new Bad(`it ends early (at byte ${hex(this.p)})`);
    this.p += n;
  }
  u32() {
    const at = this.p;
    let v = 0;
    for (let i = 0, mul = 1; i < 5; i++, mul *= 128) {
      const x = this.byte();
      v += (x & 0x7f) * mul;
      if (x < 0x80) {
        if (i === 4 && x > 0x0f) break;
        return v;
      }
    }
    throw new Bad(`a bad LEB128 u32 at byte ${hex(at)}`);
  }
  // an unsigned LEB128 of up to 64 bits (memory64 limits, offsets): its value roughly
  u64() {
    const at = this.p;
    let v = 0;
    for (let i = 0, mul = 1; i < 10; i++, mul *= 128) {
      const x = this.byte();
      v += (x & 0x7f) * mul;
      if (x < 0x80) {
        if (i === 9 && x > 0x01) break;
        return v;
      }
    }
    throw new Bad(`a bad LEB128 u64 at byte ${hex(at)}`);
  }
  // a signed LEB128 of n bits, skipped (its value is not needed), checked as the engines do
  sleb(n) {
    const at = this.p;
    const last = Math.ceil(n / 7) - 1;
    for (let i = 0; i <= last; i++) {
      const x = this.byte();
      if (x < 0x80) {
        if (i === last) {
          const used = n - 7 * last; // the payload bits of the last byte; the ones above it repeat the sign
          const top = x >> (used - 1);
          if (top !== 0 && top !== 0x7f >> (used - 1)) break;
        }
        return;
      }
    }
    throw new Bad(`a bad LEB128 s${n} at byte ${hex(at)}`);
  }
  // a block type's s33
  s33() {
    const at = this.p;
    let v = 0;
    for (let i = 0, mul = 1; i < 5; i++, mul *= 128) {
      const x = this.byte();
      v += (x & 0x7f) * mul;
      if (x < 0x80) {
        if (i === 4 && x >> 4 !== 0 && x >> 4 !== 7) break;
        if (x & 0x40) v -= mul * 128;
        return v;
      }
    }
    throw new Bad(`a bad LEB128 s33 at byte ${hex(at)}`);
  }
  name() {
    const n = this.u32();
    if (n > this.end - this.p) throw new Bad(`a name at byte ${hex(this.p)} runs past the end of its section`);
    const s = this.p;
    this.p += n;
    try {
      return UTF8.decode(this.b.subarray(s, this.p));
    } catch {
      throw new Bad(`a name at byte ${hex(s)} is not UTF-8`);
    }
  }
  count(max, what) {
    const at = this.p;
    const n = this.u32();
    if (n > max) throw new Bad(`${n} ${what} at byte ${hex(at)} (the engines allow ${max})`);
    return n;
  }
}

// the value types: their letters (abi.js: i i32, f f32, d f64; and I i64, v v128, r funcref, e externref)
const VT = [];
Object.assign(VT, { 0x7f: 'i', 0x7e: 'I', 0x7d: 'f', 0x7c: 'd', 0x7b: 'v', 0x70: 'r', 0x6f: 'e' });
const VT_TEXT = { i: 'i32', I: 'i64', f: 'f32', d: 'f64', v: 'v128', r: 'funcref', e: 'externref' };
const sig = (p, r) => `(${[...p].map((c) => VT_TEXT[c]).join(', ')}) -> ${r ? [...r].map((c) => VT_TEXT[c]).join(', ') : 'nothing'}`;
const KIND = ['function', 'table', 'memory', 'global', 'tag'];

function vtype(r, E, where) {
  const at = r.p;
  const x = r.byte();
  const c = VT[x];
  if (c) return c;
  if (x === 0x69 || x === 0x74) E.feature('exceptions', where, at); // exnref, nullexnref
  else if (x >= 0x63 && x <= 0x73) E.feature('gc', where, at); // (ref ...), (ref null ...), anyref, eqref, i31ref ...
  else throw new Bad(`an unknown value type ${hex(x)} at byte ${hex(at)}`);
  throw STOP;
}

function heaptype(r, E, where) {
  const at = r.p;
  const x = r.peek();
  if (x === 0x70 || x === 0x6f) return void r.p++;
  E.feature(x === 0x69 || x === 0x74 ? 'exceptions' : 'gc', where, at); // another abstract heap type, or a type index
  throw STOP;
}

function blocktype(r, m, E, where) {
  const at = r.p;
  const x = r.peek();
  if (x === 0x40 || VT[x]) return void r.p++;
  if (x >= 0x63 && x <= 0x74) {
    E.feature(x === 0x69 || x === 0x74 ? 'exceptions' : 'gc', where, at);
    throw STOP;
  }
  const t = r.s33();
  if (t < 0 || t >= m.types.length) throw new Bad(`a bad block type at byte ${hex(at)}`);
}

function limits(r, E, where) {
  const at = r.p;
  const f = r.byte();
  if (f > 0x0f) throw new Bad(`limits with the flags ${hex(f)} at byte ${hex(at)}`);
  const big = f & 4;
  const min = big ? r.u64() : r.u32();
  const max = f & 1 ? (big ? r.u64() : r.u32()) : null;
  if (f & 8) r.u32(); // the page size
  if (big) E.feature('memory64', where, at);
  if (f & 2) E.feature('threads', `${where} (shared)`, at);
  if (f & 8) E.feature('pageSize', where, at);
  return { flags: f, min, max };
}

function constExpr(r, E, where) {
  for (;;) {
    const at = r.p;
    const op = r.byte();
    switch (op) {
      case 0x0b: return;
      case 0x41: r.sleb(32); break;
      case 0x42: r.sleb(64); break;
      case 0x43: r.skip(4); break;
      case 0x44: r.skip(8); break;
      case 0x23: case 0xd2: r.u32(); break; // global.get, ref.func
      case 0xd0: heaptype(r, E, where); break;
      case 0xfd:
        if (r.u32() !== 12) throw new Bad(`${where}: a SIMD instruction that is not constant at byte ${hex(at)}`);
        r.skip(16);
        break;
      case 0x6a: case 0x6b: case 0x6c: case 0x7c: case 0x7d: case 0x7e:
        E.feature('extendedConst', where, at);
        break;
      case 0xfb: E.feature('gc', where, at); throw STOP;
      default: throw new Bad(`${where}: ${hex(op)} at byte ${hex(at)} is not a constant instruction`);
    }
  }
}

// ------------------------------------------------------------------ the instructions

// the immediates of the one-byte opcodes
const NONE = 1, BLOCK = 2, LOOP = 3, ELSE = 4, END = 5, IDX = 6, BR_TABLE = 7, CALL_IND = 8, MEMARG = 9, MEMIDX = 10,
  I32 = 11, I64 = 12, F32 = 13, F64 = 14, SELECT_T = 15, REF_NULL = 16, PFX_FC = 17, PFX_FD = 18, NO = 19;
const OP = new Uint8Array(256); // 0: unknown
const NO_WHY = {};
{
  const set = (a, b, k) => { for (let i = a; i <= b; i++) OP[i] = k; };
  set(0x00, 0x01, NONE); // unreachable, nop
  OP[0x02] = BLOCK; OP[0x03] = LOOP; OP[0x04] = BLOCK; OP[0x05] = ELSE; OP[0x0b] = END;
  set(0x0c, 0x0d, IDX); OP[0x0e] = BR_TABLE; OP[0x0f] = NONE; OP[0x10] = IDX; OP[0x11] = CALL_IND;
  set(0x1a, 0x1b, NONE); OP[0x1c] = SELECT_T;
  set(0x20, 0x26, IDX); // local.get/set/tee, global.get/set, table.get/set
  set(0x28, 0x3e, MEMARG);
  set(0x3f, 0x40, MEMIDX); // memory.size, memory.grow
  OP[0x41] = I32; OP[0x42] = I64; OP[0x43] = F32; OP[0x44] = F64;
  set(0x45, 0xc4, NONE); // numeric, sign extension
  OP[0xd0] = REF_NULL; OP[0xd1] = NONE; OP[0xd2] = IDX;
  OP[0xfc] = PFX_FC; OP[0xfd] = PFX_FD;
  const no = (ops, why) => { for (const o of ops) { OP[o] = NO; NO_WHY[o] = why; } };
  no([0x06, 0x07, 0x08, 0x09, 0x0a, 0x18, 0x19, 0x1f], 'exceptions'); // try catch throw rethrow throw_ref delegate catch_all try_table
  no([0x12, 0x13, 0x15], 'tailCalls'); // return_call, return_call_indirect, return_call_ref
  no([0x14, 0xd3, 0xd4, 0xd5, 0xd6, 0xfb], 'gc'); // call_ref, ref.eq, ref.as_non_null, br_on_null, br_on_non_null, GC
  no([0xfe], 'threads');
}
// the immediates of the 0xFD (SIMD) opcodes 0-255
const S_MEM = 1, S_16 = 2, S_LANE = 3, S_MEMLANE = 4;
const SIMD = new Uint8Array(256);
{
  for (let i = 0; i <= 11; i++) SIMD[i] = S_MEM; // v128.load ... v128.store
  SIMD[12] = S_16; SIMD[13] = S_16; // v128.const, i8x16.shuffle
  for (let i = 21; i <= 34; i++) SIMD[i] = S_LANE; // extract_lane, replace_lane
  for (let i = 84; i <= 91; i++) SIMD[i] = S_MEMLANE; // load*_lane, store*_lane
  SIMD[92] = S_MEM; SIMD[93] = S_MEM; // v128.load32_zero, v128.load64_zero
}

function memarg(r, E, where, at) {
  const align = r.u32();
  if (align & 0x40) { E.feature('multiMemory', where, at); throw STOP; }
  r.u64(); // the offset (u32 for a 32-bit memory: the engine's validation checks it)
}

function memidx0(r, E, where, at) {
  if (r.u32() !== 0) { E.feature('multiMemory', where, at); throw STOP; }
}

// the bulk operations that do work in proportion to their length (the i32 on top of the stack): charged by it
// too, one unit per 2^shift: per 64 bytes of memory (memory.init, .copy, .fill), per 8 entries of a table
// (table.init, .copy, .grow, .fill)
const BULK_SHIFT = { 8: 6, 10: 6, 11: 6, 12: 3, 14: 3, 15: 3, 17: 3 };

// one function body's instructions, from r.p (after the locals) to r.end. rec (meterWasm): the regions to charge
// ({ at, n }: where its charge goes, its instructions) and the bulk operations ({ at, shift }), in byte order
function scanBody(r, m, E, where, rec) {
  let depth = 1;
  let region = null;
  const outer = [], loops = [];
  if (rec) {
    region = { at: r.p, n: 0 };
    rec.ins.push(region);
  }
  for (;;) {
    const at = r.p;
    const op = r.byte();
    switch (OP[op]) {
      case NONE: break;
      case BLOCK:
        blocktype(r, m, E, where);
        depth++;
        if (rec) loops.push(false);
        break;
      case LOOP:
        blocktype(r, m, E, where);
        depth++;
        if (rec) {
          region.n++;
          loops.push(true);
          outer.push(region);
          region = { at: r.p, n: 0 };
          rec.ins.push(region);
          continue;
        }
        break;
      case ELSE: continue;
      case END:
        if (--depth === 0) {
          if (r.p !== r.end) throw new Bad(`${where} has bytes after its end (at byte ${hex(r.p)})`);
          return;
        }
        if (rec && loops.pop()) region = outer.pop();
        continue;
      case IDX: r.u32(); break;
      case BR_TABLE: {
        const n = r.count(MAX.brTable, 'br_table targets');
        for (let i = 0; i <= n; i++) r.u32();
        break;
      }
      case CALL_IND: r.u32(); r.u32(); break;
      case MEMARG: memarg(r, E, where, at); break;
      case MEMIDX: memidx0(r, E, where, at); break;
      case I32: r.sleb(32); break;
      case I64: r.sleb(64); break;
      case F32: r.skip(4); break;
      case F64: r.skip(8); break;
      case SELECT_T: {
        const n = r.count(MAX.params, 'select types');
        for (let i = 0; i < n; i++) vtype(r, E, where);
        break;
      }
      case REF_NULL: heaptype(r, E, where); break;
      case PFX_FC: {
        const sub = r.u32();
        if (sub <= 7) break; // the saturating truncations
        if (sub === 8) { r.u32(); memidx0(r, E, where, at); } // memory.init
        else if (sub === 10) { memidx0(r, E, where, at); memidx0(r, E, where, at); } // memory.copy
        else if (sub === 11) memidx0(r, E, where, at); // memory.fill
        else if (sub === 12 || sub === 14) { r.u32(); r.u32(); } // table.init, table.copy
        else if (sub === 9 || sub === 13 || (sub >= 15 && sub <= 17)) r.u32(); // data.drop, elem.drop, table.grow/size/fill
        else { E.feature('unknown', `${where} (0xfc ${sub})`, at); throw STOP; }
        if (rec && BULK_SHIFT[sub]) {
          rec.ins.push({ at, shift: BULK_SHIFT[sub] });
          rec.bulk = true;
        }
        break;
      }
      case PFX_FD: {
        const sub = r.u32();
        if (sub > 0xff) { E.feature(sub <= 0x113 ? 'relaxedSimd' : 'unknown', where, at); throw STOP; }
        const k = SIMD[sub];
        if (k === S_MEM) memarg(r, E, where, at);
        else if (k === S_16) r.skip(16);
        else if (k === S_LANE) r.skip(1);
        else if (k === S_MEMLANE) { memarg(r, E, where, at); r.skip(1); }
        break;
      }
      case NO: E.feature(NO_WHY[op], where, at); throw STOP;
      default: E.feature('unknown', `${where} (opcode ${hex(op)})`, at); throw STOP;
    }
    if (rec) region.n++;
  }
}

// ------------------------------------------------------------------ the sections

// the order of the sections (custom: anywhere); 13 is the tag section (exceptions)
const RANK = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 13: 6, 6: 7, 7: 8, 8: 9, 9: 10, 12: 11, 10: 12, 11: 13 };
const SECTION = { 0: 'custom', 1: 'type', 2: 'import', 3: 'function', 4: 'table', 5: 'memory', 6: 'global', 7: 'export', 8: 'start', 9: 'element', 10: 'code', 11: 'data', 12: 'data count', 13: 'tag' };

const PARSE = {
  0(r, m, E, sec) {
    sec.name = r.name();
    r.p = r.end;
  },
  1(r, m, E) {
    const n = r.count(MAX.types, 'types');
    for (let i = 0; i < n; i++) {
      const at = r.p;
      const form = r.byte();
      if (form !== 0x60) {
        if (form >= 0x4e && form <= 0x50 || form === 0x5e || form === 0x5f) E.feature('gc', 'the type section', at);
        else throw new Bad(`type ${i} has the form ${hex(form)} (not a function type)`);
        throw STOP;
      }
      const params = vtypes(r, E), results = vtypes(r, E);
      m.types.push({ params, results });
    }
  },
  2(r, m, E) {
    const n = r.count(MAX.imports, 'imports');
    for (let i = 0; i < n; i++) {
      const module = r.name(), name = r.name();
      const at = r.p;
      const kind = r.byte();
      const where = `import ${show(`${module}.${name}`)}`;
      m.imports.push({ module, name, kind, type: -1 });
      if (kind === 0) {
        const t = r.u32();
        if (t >= m.types.length) throw new Bad(`${where} has the type ${t}, past the type section`);
        m.imports[m.imports.length - 1].type = t;
        m.impFuncs.push(t);
      } else if (kind === 1) {
        vtype(r, E, where);
        limits(r, E, where);
      } else if (kind === 2) {
        limits(r, E, where);
        m.impMems++;
      } else if (kind === 3) {
        vtype(r, E, where);
        if (r.byte() > 1) E.feature('threads', `${where} (shared)`, at);
      } else if (kind === 4) {
        E.feature('exceptions', where, at);
        throw STOP;
      } else throw new Bad(`${where} has the kind ${kind}`);
    }
  },
  3(r, m) {
    const n = r.count(MAX.funcs, 'functions');
    for (let i = 0; i < n; i++) {
      const t = r.u32();
      if (t >= m.types.length) throw new Bad(`function ${m.impFuncs.length + i} has the type ${t}, past the type section`);
      m.funcs.push(t);
    }
  },
  4(r, m, E) {
    const n = r.count(MAX.tables, 'tables');
    for (let i = 0; i < n; i++) {
      const at = r.p;
      if (r.peek() === 0x40) { E.feature('gc', 'a table with an initializer', at); throw STOP; }
      const t = vtype(r, E, 'a table');
      if (t !== 'r' && t !== 'e') throw new Bad(`a table of ${VT_TEXT[t]} at byte ${hex(at)}`);
      limits(r, E, 'a table');
    }
  },
  5(r, m, E) {
    const at = r.p;
    const n = r.count(MAX.memories, 'memories');
    if (n + m.impMems > 1) E.feature('multiMemory', 'the memory section', at);
    for (let i = 0; i < n; i++) m.memories.push(limits(r, E, 'the memory'));
  },
  13(r, m, E) {
    E.feature('exceptions', 'the tag section', r.p);
    throw STOP;
  },
  6(r, m, E) {
    const n = r.count(MAX.globals, 'globals');
    for (let i = 0; i < n; i++) {
      vtype(r, E, `global ${i}`);
      const at = r.p;
      const mut = r.byte();
      if (mut > 1) {
        if (mut > 3) throw new Bad(`global ${i} has the mutability ${mut}`);
        E.feature('threads', `global ${i} (shared)`, at);
      }
      constExpr(r, E, `global ${i}'s initializer`);
      m.globals++;
    }
  },
  7(r, m, E) {
    const n = r.count(MAX.exports, 'exports');
    for (let i = 0; i < n; i++) {
      const name = r.name();
      const at = r.p;
      const kind = r.byte();
      const index = r.u32();
      if (kind === 4) { E.feature('exceptions', `export ${show(name)}`, at); throw STOP; }
      if (kind > 4) throw new Bad(`export ${show(name)} has the kind ${kind}`);
      m.exports.push({ name, kind, index });
    }
  },
  8(r, m) {
    m.start = r.u32();
  },
  9(r, m, E) {
    const n = r.count(MAX.elems, 'element segments');
    for (let i = 0; i < n; i++) {
      const at = r.p;
      const flags = r.u32();
      const where = `element segment ${i}`;
      if (flags > 7) throw new Bad(`${where} has the flags ${flags} (at byte ${hex(at)})`);
      if (flags & 2 && !(flags & 1)) r.u32(); // the table
      if (!(flags & 1)) constExpr(r, E, `${where}'s offset`); // active
      if (flags & 3) {
        if (flags & 4) {
          const t = vtype(r, E, where);
          if (t !== 'r' && t !== 'e') throw new Bad(`${where} has elements of ${VT_TEXT[t]}`);
        } else if (r.byte() !== 0) throw new Bad(`${where} has an unknown element kind`);
      }
      const k = r.count(MAX.elems, 'elements');
      for (let j = 0; j < k; j++) {
        if (flags & 4) constExpr(r, E, where);
        else r.u32();
      }
    }
  },
  12(r, m) {
    m.dataCount = r.count(MAX.data, 'data segments');
  },
  10(r, m, E) {
    const n = r.count(MAX.funcs, 'function bodies');
    if (n !== m.funcs.length) throw new Bad(`${n} function bodies for ${m.funcs.length} functions`);
    for (let i = 0; i < n; i++) {
      const size = r.u32();
      const fi = m.impFuncs.length + i;
      if (size > r.end - r.p) throw new Bad(`the body of function ${fi} runs past the code section`);
      if (size > MAX.bodyBytes) throw new Bad(`the body of function ${fi} is ${size} bytes (the engines allow ${MAX.bodyBytes})`);
      const f = { fi, start: r.p, end: r.p + size, entries: 0, expr: 0, nEntries: 0, nLocals: 0 };
      m.bodies.push(f);
      const where = `function ${fi}`;
      const br = new Reader(r.b, f.start, f.end);
      try {
        f.nEntries = br.u32();
        f.entries = br.p;
        let total = m.types[m.funcs[i]].params.length;
        for (let j = 0; j < f.nEntries; j++) {
          total += br.u32();
          if (total > MAX.locals) throw new Bad(`${where} has more than ${MAX.locals} locals`);
          vtype(br, E, `${where}'s locals`);
        }
        f.nLocals = total;
        f.expr = br.p;
        scanBody(br, m, E, where, null);
      } catch (e) {
        if (e !== STOP) throw e;
        f.cut = true;
      }
      r.p = f.end;
    }
  },
  11(r, m, E) {
    const n = r.count(MAX.data, 'data segments');
    for (let i = 0; i < n; i++) {
      const at = r.p;
      const flags = r.u32();
      const where = `data segment ${i}`;
      if (flags === 2) {
        if (r.u32() !== 0) E.feature('multiMemory', where, at);
      } else if (flags > 2) throw new Bad(`${where} has the flags ${flags}`);
      if (flags !== 1) constExpr(r, E, `${where}'s offset`);
      const len = r.u32();
      if (len > r.end - r.p) throw new Bad(`${where} runs past the data section`);
      r.p += len;
    }
  },
};

function vtypes(r, E) {
  const n = r.count(MAX.params, 'types in a signature');
  let s = '';
  for (let i = 0; i < n; i++) s += vtype(r, E, 'the type section');
  return s;
}

function decode(b, m, E) {
  if (b.length < 8 || b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) {
    throw new Bad('it does not start with "\\0asm": it is not a WebAssembly binary');
  }
  if (b[4] !== 1 || b[5] || b[6] || b[7]) throw new Bad(`its version is ${[...b.subarray(4, 8)].map(hex).join(' ')}, not 1: build a core module (not a component)`);
  let p = 8, last = 0;
  while (p < b.length) {
    const h = new Reader(b, p, b.length);
    const id = h.byte();
    const size = h.u32();
    const start = h.p, end = start + size;
    if (end > b.length) throw new Bad(`section ${id} at byte ${hex(p)} runs past the end of the file`);
    const rank = RANK[id];
    if (rank === undefined) throw new Bad(`an unknown section id ${id} at byte ${hex(p)}`);
    if (rank) {
      if (rank <= last) throw new Bad(`the ${SECTION[id]} section at byte ${hex(p)} is out of order or there twice`);
      last = rank;
    }
    const sec = { id, at: p, start, end, name: '' };
    m.sections.push(sec);
    const r = new Reader(b, start, end);
    try {
      PARSE[id](r, m, E, sec);
      if (r.p !== end) throw new Bad(`the ${SECTION[id]} section has ${end - r.p} bytes left over`);
    } catch (e) {
      if (e !== STOP) throw e;
      m.cut.add(id);
    }
    p = end;
  }
  if (m.funcs.length && !m.cut.has(10) && m.bodies.length !== m.funcs.length) throw new Bad(`${m.funcs.length} functions but no code section`);
}

// ------------------------------------------------------------------ the contract

function funcType(m, idx) {
  const t = idx < m.impFuncs.length ? m.impFuncs[idx] : m.funcs[idx - m.impFuncs.length];
  return t === undefined ? null : m.types[t];
}

function checkAbi(m, E) {
  const ENV = Object.keys(IMPORTS).filter((k) => !k.startsWith('fc.')).join(', ');
  m.imports.forEach((im, i) => {
    const key = `${im.module}.${im.name}`, path = `imports[${i}]`;
    if (im.kind !== 0) {
      E.add('E_WASM_IMPORT', `Import ${show(key)} is a ${KIND[im.kind]}: flotopia-ugc/1 allows only function imports. Define the ${KIND[im.kind]} in the module (and export the memory as "memory") instead of importing it.`, path);
    } else if (!Object.hasOwn(IMPORTS, key)) {
      E.add('E_WASM_IMPORT', `Import ${show(key)} is not part of flotopia-ugc/1. The module may import only from module "fc" (docs/abi.md 3.4) and ${ENV}. Remove it (with AssemblyScript: do not use APIs the host would provide, e.g. Date or console; use fc.log).`, path);
    } else {
      const t = m.types[im.type], [wp, wr] = IMPORTS[key];
      if (t.params !== wp || t.results !== wr) {
        E.add('E_WASM_IMPORT', `Import ${show(key)} has the signature ${sig(t.params, t.results)}; flotopia-ugc/1 wants ${sig(wp, wr)} (docs/abi.md 3.4). Declare it with that signature (assembly/fc.ts of the SDK has it).`, path);
      }
    }
  });

  const exports = new Map(m.exports.map((e) => [e.name, e]));
  if (!m.cut.has(5)) {
    const ex = exports.get('memory');
    if (!m.memories.length) {
      if (!m.impMems) E.add('E_WASM_MEMORY', `The module has no memory. Define one (not imported) with a declared maximum of at most ${LIMITS.memoryPages} pages and export it as "memory".`, 'memory');
    } else {
      const mem = m.memories[0];
      const how = `AssemblyScript: --maximumMemory ${LIMITS.memoryPages}; clang/Rust: -Wl,--max-memory=${LIMITS.memoryPages * PAGE}`;
      if (mem.max === null) {
        E.add('E_WASM_MEMORY', `The memory has no declared maximum. Declare one of at most ${LIMITS.memoryPages} pages (${mb(LIMITS.memoryPages * PAGE)}): ${how}.`, 'memory');
      } else if (mem.max > LIMITS.memoryPages) {
        E.add('E_WASM_MEMORY', `The memory's declared maximum is ${mem.max} pages (${mb(mem.max * PAGE)}); the limit is ${LIMITS.memoryPages} pages (${mb(LIMITS.memoryPages * PAGE)}). Lower it: ${how}.`, 'memory');
      }
      if (!m.cut.has(7) && (!ex || ex.kind !== 2 || ex.index !== 0)) {
        E.add('E_WASM_MEMORY', 'The memory is not exported as "memory". Export it under that name: the host writes the inbox and reads your data through it.', 'exports.memory');
      }
    }
  }
  if (!m.cut.has(7)) {
    for (const [name, [wp, wr]] of Object.entries(EXPORTS)) {
      const ex = exports.get(name), path = `exports.${name}`;
      const t = ex && ex.kind === 0 ? funcType(m, ex.index) : null;
      if (!ex) {
        E.add('E_WASM_EXPORT', `The module does not export ${name} ${sig(wp, wr)}. The host calls ${Object.keys(EXPORTS).join(', ')} (docs/abi.md 3.1): export them (AssemblyScript: export { fc_alloc } from the SDK's assembly/fc.ts, and write fc_init and fc_tick).`, path);
      } else if (ex.kind !== 0) {
        E.add('E_WASM_EXPORT', `Export ${name} is a ${KIND[ex.kind]}; it must be a function ${sig(wp, wr)} (docs/abi.md 3.1).`, path);
      } else if (!t) {
        E.add('E_WASM_FORMAT', `Export ${name} names function ${ex.index}, which does not exist.`, path);
      } else if (t.params !== wp || t.results !== wr) {
        E.add('E_WASM_EXPORT', `Export ${name} has the signature ${sig(t.params, t.results)}; the host calls it as ${sig(wp, wr)} (docs/abi.md 3.1). Change the function's parameters and result.`, path);
      }
    }
  }
}

function asBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return null;
}

function analyze(bytes) {
  const E = new Errs();
  const info = { imports: [], exports: [], memory: null, functions: 0, bodyBytes: 0, hasStart: false };
  const m = { types: [], imports: [], impFuncs: [], impMems: 0, funcs: [], memories: [], globals: 0, exports: [], start: -1, dataCount: -1, sections: [], bodies: [], cut: new Set() };
  const b = asBytes(bytes);
  let whole = false;
  if (!b) {
    E.add('E_WASM_FORMAT', 'The run-time code is not bytes (an ArrayBuffer or a Uint8Array).');
  } else if (b.length > LIMITS.runtimeBytes) {
    E.add('E_WASM_SIZE', `The module is ${mb(b.length)} (${b.length} bytes); the run-time code (the wasm and the shaders) may be at most ${mb(LIMITS.runtimeBytes)} (docs/abi.md 2.5). Make it smaller: optimise for size (wasm-opt -Oz; AssemblyScript --optimize --shrinkLevel 2; clang/Rust -Oz, opt-level = "z") and strip debug info.`);
  } else {
    try {
      decode(b, m, E);
      whole = true;
    } catch (e) {
      const why = e instanceof Bad ? e.message : `the decoder failed: ${e && e.message}`;
      E.add('E_WASM_FORMAT', `The module is not a well-formed WebAssembly binary: ${why}. Rebuild it with a standard toolchain; a truncated or edited file fails here.`);
    }
  }
  info.imports = m.imports.map((im) => `${im.module}.${im.name}`);
  info.exports = m.exports.map((e) => e.name);
  if (m.memories.length) info.memory = { min: m.memories[0].min, max: m.memories[0].max };
  info.functions = m.funcs.length;
  info.bodyBytes = m.bodies.reduce((s, f) => s + f.end - f.start, 0);
  info.hasStart = m.start >= 0;
  if (whole) checkAbi(m, E);
  // what the decoder does not check (types of the operands, indices): the engine's validation
  if (whole && !E.list.length && typeof WebAssembly === 'object' && !WebAssembly.validate(b)) {
    E.add('E_WASM_INVALID', 'The module does not validate (WebAssembly.validate): an instruction has operands of the wrong type, or an index is out of range. Rebuild it with a standard toolchain; check it with wasm-validate or wasm-tools validate.');
  }
  const errors = E.out();
  return { ok: !errors.length, errors, info, m, b };
}

export function inspectWasm(bytes) {
  const { ok, errors, info } = analyze(bytes);
  return { ok, errors, info };
}

// ------------------------------------------------------------------ metering

// a growing byte buffer
class W {
  constructor(n) { this.a = new Uint8Array(Math.max(16, n)); this.n = 0; }
  room(k) {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const a = new Uint8Array(c);
    a.set(this.a.subarray(0, this.n));
    this.a = a;
  }
  byte(x) { this.room(1); this.a[this.n++] = x; }
  bytes(arr) { this.room(arr.length); this.a.set(arr, this.n); this.n += arr.length; }
  copy(b, s, e) { this.room(e - s); this.a.set(b.subarray(s, e), this.n); this.n += e - s; }
  u32(v) { this.bytes(uleb(v)); }
  view() { return this.a.subarray(0, this.n); }
}

function uleb(v) {
  const out = [];
  do {
    let x = v & 0x7f;
    v >>>= 7;
    if (v) x |= 0x80;
    out.push(x);
  } while (v);
  return out;
}

// a non-negative number below 2^53, signed LEB128
function sleb(v) {
  const out = [];
  for (;;) {
    const x = v % 128;
    v = Math.floor(v / 128);
    if (v === 0 && !(x & 0x40)) return out.push(x), out;
    out.push(x | 0x80);
  }
}

function slebBig(v) {
  const out = [];
  for (;;) {
    const x = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && !(x & 0x40)) || (v === -1n && x & 0x40)) return out.push(x), out;
    out.push(x | 0x80);
  }
}

export function meterWasm(bytes, { init = FUEL.init, exportName = 'fc_fuel' } = {}) {
  const { ok, errors, m, b } = analyze(bytes);
  if (!ok) throw new Error(`meterWasm: the module does not pass inspectWasm: ${errors.map((e) => `${e.code}: ${e.message}`).join(' ')}`);
  let fuel;
  try {
    fuel = BigInt(init);
  } catch {
    throw new TypeError(`meterWasm: init (${init}) is not an integer`);
  }
  if (fuel !== BigInt.asIntN(64, fuel)) throw new RangeError(`meterWasm: init (${init}) is not an i64`);
  if (typeof exportName !== 'string' || !exportName) throw new TypeError('meterWasm: exportName is not a name');
  if (m.exports.some((e) => e.name === exportName)) throw new Error(`meterWasm: the module already exports ${show(exportName)}`);

  // the fuel: a new global after the module's (no imported globals: the imports are functions only)
  const G = uleb(m.globals);
  const CHECK = [0x23, ...G, 0x42, 0x00, 0x53, 0x04, 0x40, 0x00, 0x0b]; // global.get F; i64.const 0; i64.lt_s; if; unreachable; end
  const charge = (n) => [0x23, ...G, 0x42, ...sleb(n), 0x7d, 0x24, ...G, ...CHECK]; // F -= n
  const E = new Errs();

  const code = new W(b.length + (b.length >> 2));
  const body = new W(4096);
  code.u32(m.bodies.length);
  for (const f of m.bodies) {
    const rec = { ins: [], bulk: false };
    scanBody(new Reader(b, f.expr, f.end), m, E, `function ${f.fi}`, rec);
    body.n = 0;
    let bulk = null;
    if (rec.bulk) {
      // one more i32 local (appended: the indices of the others stay) for the length of a bulk operation
      if (f.nLocals + 1 > MAX.locals) throw new Error(`meterWasm: function ${f.fi} has no room for one more local`);
      const L = uleb(f.nLocals);
      // local.tee L; F -= i64(L) >> shift
      bulk = (shift) => [0x22, ...L, 0x23, ...G, 0x20, ...L, 0xad, 0x42, shift, 0x88, 0x7d, 0x24, ...G, ...CHECK];
      body.u32(f.nEntries + 1);
      body.copy(b, f.entries, f.expr);
      body.byte(1);
      body.byte(0x7f);
    } else body.copy(b, f.start, f.expr);
    let p = f.expr;
    for (const x of rec.ins) {
      body.copy(b, p, x.at);
      p = x.at;
      body.bytes(x.shift ? bulk(x.shift) : charge(Math.max(1, x.n)));
    }
    body.copy(b, p, f.end);
    code.u32(body.n);
    code.copy(body.a, 0, body.n);
  }

  const parts = [b.subarray(0, 8)];
  const section = (id, payload) => {
    const h = new W(8);
    h.byte(id);
    h.u32(payload.length);
    parts.push(h.view(), payload);
  };
  // append to a section's vector
  const append = (s, more) => {
    const r = new Reader(b, s.start, s.end);
    const n = r.u32();
    const w = new W(s.end - s.start + more.length + 8);
    w.u32(n + 1);
    w.copy(b, r.p, s.end);
    w.bytes(more);
    section(s.id, w.view());
  };
  const global = [0x7e, 0x01, 0x42, ...slebBig(fuel), 0x0b];
  const name = new TextEncoder().encode(exportName);
  const exp = [...uleb(name.length), ...name, 0x03, ...G];
  let globals = false;
  for (const s of m.sections) {
    if (s.id === 0) {
      if (s.name === 'name') parts.push(b.subarray(s.at, s.end));
      continue;
    }
    if (!globals && RANK[s.id] > RANK[6]) {
      section(6, new Uint8Array([1, ...global]));
      globals = true;
    }
    if (s.id === 6) {
      append(s, global);
      globals = true;
    } else if (s.id === 7) append(s, exp);
    else if (s.id === 10) section(10, code.view());
    else parts.push(b.subarray(s.at, s.end));
  }
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
