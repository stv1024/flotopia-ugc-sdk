// What is wrong with a focus panel's JSON (docs/abi.md 3.7), said so you can find it: where the JSON breaks, or
// the path of the first field the host would refuse. The host's own check (lib/host/runtime/sandbox.js
// cleanPanel) says only "panel: see docs/abi.md 3.7". → null (the host takes it all) or { why, refused }:
// refused, the host shows no panel; else it drops only that part (a button, a key cap, a swatch).
const HEX = /^#[0-9a-fA-F]{6}$/, KEY = /^[A-Z0-9]$/;

export function panelProblem(text) {
  const r = diagnose(text);
  if (!r) return null;
  return typeof r === 'string' ? { why: r, refused: true } : r;
}

function diagnose(text) {
  if (text === null || text === undefined) return 'the JSON is not in memory';
  let d;
  try { d = JSON.parse(text); } catch (e) {
    const m = /position (\d+)/.exec(e.message), at = m ? +m[1] : -1;
    const where = at >= 0 ? ` at character ${at}: …${text.slice(Math.max(0, at - 30), at)}⟨here⟩${text.slice(at, at + 20)}…` : '';
    return `not JSON (${e.message.replace(/ in JSON at position.*$/, '').replace(/\s*\(line.*$/, '')})${where}`;
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fin = Number.isFinite;
  const text2 = (t, max, path) => {
    if (!isObj(t)) return `${path}: { "zh": "…", "en": "…" }`;
    for (const k of ['zh', 'en']) {
      if (typeof t[k] !== 'string' || !t[k].length) return `${path}.${k}: a text of 1–${max} characters`;
      if (t[k].length > max) return `${path}.${k}: ${t[k].length} characters, at most ${max}`;
    }
    return null;
  };
  let dropped = null;
  if (items0(d) > 24) dropped = `items: ${items0(d)}, the host shows the first 24`;
  if (!isObj(d)) return 'the panel is { "title": {...}, "items": [...] }';
  const p = text2(d.title, 40, 'title');
  if (p) return p;
  if (d.items !== undefined && !Array.isArray(d.items)) return 'items: a list';
  const items = d.items ?? [];
  for (let i = 0; i < Math.min(items.length, 24); i++) {
    const it = items[i], at = `items[${i}]`;
    if (!isObj(it)) return `${at}: an object with one of label, slider, swatches, buttons, leave`;
    if (it.label) { const q = text2(it.label, 80, `${at}.label`); if (q) return q; continue; }
    if (it.slider) {
      const s = it.slider;
      if (!Number.isInteger(s.id)) return `${at}.slider.id: an integer`;
      for (const k of ['min', 'max', 'value']) if (!fin(s[k])) return `${at}.slider.${k}: a number`;
      if (!(s.max > s.min)) return `${at}.slider: max must be more than min`;
      continue;
    }
    if (it.swatches) {
      const s = it.swatches;
      if (!Number.isInteger(s.id)) return `${at}.swatches.id: an integer`;
      if (!Array.isArray(s.options)) return `${at}.swatches.options: a list`;
      let bad = null;
      const ok = s.options.slice(0, 8).filter((o, j) => {
        const op = `${at}.swatches.options[${j}]`;
        if (!Array.isArray(o?.colors) || o.colors.length < 1 || o.colors.length > 4) { bad ??= `${op}.colors: 1–4 colours`; return false; }
        const c = o.colors.findIndex((q) => !HEX.test(q));
        if (c >= 0) { bad ??= `${op}.colors[${c}]: "#rrggbb", not ${JSON.stringify(o.colors[c])}`; return false; }
        const t = text2(o.title, 40, `${op}.title`);
        if (t) { bad ??= t; return false; }
        return true;
      });
      if (!ok.length) return bad ?? `${at}.swatches.options: none the host takes`;
      if (bad) dropped ??= `${bad} (the host drops this option)`;
      continue;
    }
    if (Array.isArray(it.buttons)) {
      const bs = it.buttons.slice(0, 4);
      for (let j = 0; j < bs.length; j++) {
        const b = bs[j], bp = `${at}.buttons[${j}]`;
        if (!Number.isInteger(b?.id)) { dropped ??= `${bp}.id: an integer (the host drops this button)`; continue; }
        const t = text2(b.text, 20, `${bp}.text`);
        if (t) { dropped ??= `${t} (the host drops this button)`; continue; }
        if (b.key !== undefined && !KEY.test(b.key)) dropped ??= `${bp}.key: ${JSON.stringify(b.key)}: the key cap is one capital letter or digit ("B"), and only a label: the key itself goes in focus.keys ("KeyB"); Esc needs none (the host drops this button)`;
      }
      continue;
    }
    if (it.leave) {
      const t = text2(it.leave.text, 20, `${at}.leave.text`);
      if (t) return t;
      if (it.leave.key !== undefined && !KEY.test(it.leave.key)) dropped ??= `${at}.leave.key: ${JSON.stringify(it.leave.key)}: one capital letter or digit, or none (Esc always leaves); the host shows no key cap`;
      continue;
    }
    return `${at}: ${JSON.stringify(Object.keys(it))}: not label, slider, swatches, buttons or leave (or an empty one)`;
  }
  return dropped ? { why: dropped, refused: false } : null;
}
const items0 = (d) => (Array.isArray(d?.items) ? d.items.length : 0);
