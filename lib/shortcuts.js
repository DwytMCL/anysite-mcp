// Saved shortcuts: checking, running and repairing them, checking up on them (doctor), and sharing them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from './config.js';
import { checkRole, closest, describe, elements } from './heal.js';
import { actions, STEP_NAMES } from './actions.js';
import { getPage } from './browser.js';
import { hasTarget, locate, snapshot } from './snapshot.js';

// Saved shortcuts: { name: { description, params, steps: [{ action, ...args, expect?, fallbacks? }] } }.
// A param is a description, or { description, type: string|number|boolean, optional, default }. "{{param}}" in any
// step string is replaced by its value. "expect" is text that must be on the page after the step. "fallbacks" are
// other ways to find the step's element, used when the site changes (lib/heal.js).
export const readShortcuts = site => existsSync(site.shortcutFile) ? JSON.parse(readFileSync(site.shortcutFile, 'utf8')) : {};
export function writeShortcuts(site, all) {
  mkdirSync(join(HOME, 'sites'), { recursive: true });
  writeFileSync(site.shortcutFile, JSON.stringify(all, null, 2) + '\n');
}
export const updateShortcut = (site, name, steps) => {
  const all = readShortcuts(site);
  if (all[name]) writeShortcuts(site, { ...all, [name]: { ...all[name], steps } });
};

// Problems that would only show when the shortcut runs: unknown actions, refs, undeclared params.
/** @param {{ params?: object, steps?: any }} shortcut */
export function checkShortcut({ params = {}, steps }) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('A shortcut needs a list of steps.');
  steps.forEach(({ action, ...a }, i) => {
    const at = `Step ${i + 1} (${action})`;
    if (!actions[action]) throw new Error(`${at}: use one of ${STEP_NAMES.join(', ')}.`);
    if (a.ref) throw new Error(`${at}: refs like "${a.ref}" only last until the page changes. Use role and name instead.`);
    try {
      checkRole(a.role);
      checkRole(a.within, 'within role');
      for (const f of Object.values(a.fields || {})) checkRole(f?.role, 'field role');
    } catch (e) { throw new Error(`${at}: ${e.message}`, { cause: e }); }
    for (const [, k] of JSON.stringify(a).matchAll(/\{\{(\w+)\}\}/g))
      if (!(k in params)) throw new Error(`${at} uses {{${k}}}, which is not in params.`);
  });
}

// Hints for the shortcut's tool: read-only if it only looks, destructive if it acts on the page (download is neither).
const LOOKS = new Set(['open', 'snapshot', 'read', 'extract', 'wait']);
const CHANGES = new Set(['click', 'type', 'select', 'press', 'upload']);
export const shortcutAnnotations = ({ steps = [] }) => steps.every(s => LOOKS.has(s.action)) ? { readOnlyHint: true }
  : { readOnlyHint: false, destructiveHint: steps.some(s => CHANGES.has(s.action)) };

export const paramSpec = d => typeof d === 'string' ? { description: d } : d || {};
export function fillFrom(params, args) {
  const value = k => {
    const d = paramSpec(params[k]);
    const v = args[k] ?? d.default;
    if (v !== undefined) return String(v);
    if (d.optional) return '';
    throw new Error(`missing argument "${k}"`);
  };
  const fill = v => typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => value(k))
    : Array.isArray(v) ? v.map(fill)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  return fill;
}

const TARGETED = new Set(['click', 'type', 'select', 'upload', 'read', 'download', 'extract']);
const TARGET_KEYS = ['ref', 'role', 'name', 'text', 'exact', 'nth'];
const onlyTarget = a => Object.fromEntries(TARGET_KEYS.filter(k => a[k] !== undefined).map(k => [k, a[k]]));
const exists = (loc, ms, state = 'attached') => loc.waitFor({ state, timeout: ms }).then(() => true, () => false);
// Elements the step acts on must be visible; ones it only reads may be anywhere in the page.
const INTERACTIVE = new Set(['click', 'type', 'select', 'upload', 'download']);

// null if the step's element is there; else a replacement target: a saved fallback, or the closest match.
export async function findOrHeal(p, a, fallbacks = [], action = 'read', wait = 5000) {
  if (await exists(locate(p, a), wait, INTERACTIVE.has(action) ? 'visible' : 'attached')) return null;
  for (const f of fallbacks) if (await exists(locate(p, { ...f, within: a.within }), 500)) return f;
  const el = closest(a, elements(await p.ariaSnapshot({ mode: 'ai' })));
  const fix = el && { role: el.role, name: el.name, exact: true };
  if (fix && await exists(locate(p, { ...fix, within: a.within }), 1000)) return fix;
  throw new Error(`no element matches ${describe(a)}${a.within ? ` inside ${a.within}` : ''}, and nothing on the page is close enough to use instead`);
}

// Other ways to find an element, saved with the step so it can be found again after a redesign.
export async function fallbacksFor(p, a) {
  const info = await locate(p, a).evaluate(e => ({
    label: e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || '',
    text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) }), undefined, { timeout: 2000 }).catch(() => null);
  if (!info) return [];
  return [info.label && info.label !== a.name && { name: info.label },
    info.text && info.text !== a.name && info.text !== a.text && { text: info.text }].filter(Boolean);
}

// Find a targeted step's element, healing the step (in `step`, which the caller may save) if it moved.
export async function resolveStep(p, step, a, repairs, i, wait) {
  const { action, expect, fallbacks, ...raw } = step;
  if (!TARGETED.has(action) || !hasTarget(a) || a.ref) return a;
  const fix = await findOrHeal(p, a, fallbacks, action, wait);
  if (!fix) return a;
  repairs.push(`step ${i + 1}: ${describe(a)} is now ${describe(fix)}`);
  if (!/\{\{/.test(JSON.stringify(onlyTarget(raw)))) { // a target built from params can't be stored
    for (const k of TARGET_KEYS) delete step[k];
    Object.assign(step, fix, { fallbacks: [onlyTarget(raw), ...(fallbacks || [])].slice(0, 3) });
  }
  return { ...Object.fromEntries(Object.entries(a).filter(([k]) => !TARGET_KEYS.includes(k))), ...fix };
}

// Run a shortcut. Returns its text and its steps, which differ from sc.steps if a step was healed or `learn`
// recorded fallbacks for them.
export async function runSteps(site, sc, args, { learn = false } = {}) {
  const fill = fillFrom(sc.params || {}, args);
  const p = await getPage(site);
  const steps = sc.steps.map(s => ({ ...s }));
  const reads = [], repairs = [];
  let last = '';
  for (const [i, step] of steps.entries()) {
    const { action, expect, fallbacks, ...raw } = step;
    try {
      if (!actions[action]) throw new Error(`unknown action "${action}"`);
      const a = await resolveStep(p, step, fill(raw), repairs, i);
      if (learn && TARGETED.has(action) && hasTarget(a) && !fallbacks && !/\{\{/.test(JSON.stringify(onlyTarget(raw)))) {
        const fb = await fallbacksFor(p, a);
        if (fb.length) step.fallbacks = fb;
      }
      try {
        last = await actions[action](p, { show: 'none', ...a }, site);
      } catch (e) {
        // Many pages replace elements with script just after loading (a search box that becomes a combobox), so an
        // element found a moment ago can be gone by the time it is used. Look for it again, repairing if need be.
        if (!TARGETED.has(action) || !hasTarget(a) || a.ref || !/timeout|detached|not attached|not visible|no element/i.test(e.message)) throw e;
        await p.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        const again = await resolveStep(p, step, fill(raw), repairs, i, 1500);
        last = await actions[action](p, { show: 'none', ...again }, site);
      }
      if (expect) await p.getByText(fill(expect)).first().waitFor({ timeout: 10000 }).catch(() => {
        throw new Error(`expected "${fill(expect)}" on the page, but it is not there (URL: ${p.url()})`);
      });
    } catch (e) {
      throw new Error(`Step ${i + 1} (${action}) failed: ${e.message}\nThe site may have changed: do it with the web_* tools, then save the shortcut again.`, { cause: e });
    }
    if (action === 'read' || action === 'extract') reads.push(last);
  }
  let text = reads.length ? reads.join('\n\n') : last === 'Done.' ? await snapshot(site, p) : last;
  if (repairs.length) text += `\n\n[The site has changed. Repaired ${repairs.join('; ')}.]`;
  return { text, steps, repaired: repairs.length > 0 };
}

// One call at a time per site: they share one tab, and two at once would act on each other's page.
export function exclusive(site, fn) {
  const run = (site.lock || Promise.resolve()).then(fn);
  site.lock = run.catch(() => {});
  return run;
}

// Arguments doctor tries a shortcut with: each default, empty for optional params, else "test".
export const doctorArgs = params => Object.fromEntries(Object.entries(params || {}).map(([k, d]) => {
  const { default: v, optional } = paramSpec(d);
  return [k, v ?? (optional ? undefined : 'test')];
}));

// Check a site's shortcuts without changing anything: follow each one while its steps only open and read pages,
// and stop at the first step that would act (it is only checked that its element is there). Heals what it can.
export async function doctor(site) {
  const all = readShortcuts(site);
  const p = await getPage(site);
  const lines = [], results = [];
  let broken = 0, changed = false;
  for (const [n, sc] of Object.entries(all)) {
    const params = sc.params || {};
    const fill = fillFrom(params, doctorArgs(params));
    const steps = sc.steps.map(s => ({ ...s }));
    const repairs = [];
    let upTo = steps.length;
    try {
      for (const [i, step] of steps.entries()) {
        const { action, expect, fallbacks, ...raw } = step;
        const a = await resolveStep(p, step, fill(raw), repairs, i);
        if (action === 'open') await actions.open(p, { ...a, show: 'none' }, site);
        else if (action === 'wait') { if (a.until_text) await actions.wait(p, { ...a, show: 'none' }, site); }
        else if (!['read', 'extract', 'snapshot'].includes(action)) { upTo = i + 1; break; }
      }
      if (repairs.length) { all[n] = { ...sc, steps }; changed = true; }
      const scope = upTo < steps.length ? ` (checked steps 1–${upTo}; the rest depend on step ${upTo} running)` : '';
      results.push({ name: n, status: repairs.length ? 'repaired' : 'ok',
        detail: [scope.trim(), repairs.length ? `repaired ${repairs.join('; ')}` : ''].filter(Boolean).join(' ') });
      lines.push(`${repairs.length ? '~' : '✓'} ${site.prefix}_${n}${scope}${repairs.length ? `: repaired ${repairs.join('; ')}` : ''}`);
    } catch (e) {
      broken++;
      results.push({ name: n, status: 'broken', detail: e.message });
      lines.push(`✗ ${site.prefix}_${n}: ${e.message}`);
    }
  }
  if (changed) writeShortcuts(site, all);
  return { lines, broken, results };
}

// Shared shortcuts: JSON files of { name: shortcut }, by default from library/<site>.json in this repository.
// They hold steps only, never code, so they can't do anything the web_* tools can't.
const LIBRARY = 'https://raw.githubusercontent.com/DwytMCL/anysite-mcp/main/library';
export async function addShortcuts(site, { from, only, force }) {
  const src = from || `${LIBRARY}/${encodeURIComponent(site.name)}.json`;
  let body;
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`${src}: ${r.status} ${r.status === 404 ? `(no shared shortcuts for ${site.name} yet)` : r.statusText}`);
    body = await r.text();
  } else body = readFileSync(src, 'utf8');
  const incoming = JSON.parse(body);
  const mine = readShortcuts(site);
  const added = [], skipped = [];
  for (const [n, sc] of Object.entries(incoming)) {
    if (only && n !== only) continue;
    if (!/^[a-z][a-z0-9_]*$/.test(n) || typeof sc?.description !== 'string') throw new Error(`"${n}" is not a valid shortcut.`);
    checkShortcut(sc);
    if (mine[n] && !force) { skipped.push(n); continue; }
    mine[n] = sc;
    added.push(n);
  }
  if (only && !added.length && !skipped.length) throw new Error(`No shortcut "${only}" in ${src}.`);
  writeShortcuts(site, mine);
  return { added, skipped, src };
}
