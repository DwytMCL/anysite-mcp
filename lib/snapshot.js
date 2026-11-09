// Snapshots of the page, and finding elements on it by ref, role and name, or text.
import { z } from 'zod';
import { checkRole } from './heal.js';

// A ref from the latest snapshot is the quickest way to point at an element; role+name is what lasts (and
// what shortcuts store); text is a fallback for elements without a useful role.
export const target = { ref: z.string().optional().describe('Element ref from the latest snapshot, e.g. e12. Refs last until the page changes; shortcuts must use role/name instead'),
  role: z.string().optional().describe('ARIA role from the snapshot, e.g. button, link, textbox, tab'),
  name: z.string().optional().describe('Accessible name from the snapshot'),
  text: z.string().optional().describe('Visible text, used when role/name do not match'),
  exact: z.boolean().optional(), nth: z.number().int().optional().describe('Pick the nth match (0-based) when several match'),
  within: z.string().optional().describe('Only look inside the last element with this role (the topmost dialog, for example), e.g. main, dialog, navigation') };
export const hasTarget = a => a.ref || a.role || a.name || a.text;
export const show = z.enum(['changes', 'full', 'none']).optional()
  .describe('What to return afterwards: only what changed on the page (default), the full snapshot, or nothing');

// `all` returns every match instead of the first (or nth).
export function locate(p, { ref, role, name, text: t, exact, nth, within }, all = false) {
  if (ref) return p.getByRef(ref.replace(/^\[?(ref=)?|\]$/g, ''));
  checkRole(role);
  checkRole(within, 'within role');
  const root = within ? p.getByRole(within).last() : p;
  const loc = role ? root.getByRole(role, name ? { name, exact } : {})
    : name ? root.getByLabel(name, { exact }).or(root.getByPlaceholder(name, { exact }))
    : t ? root.getByText(t, { exact }) : null;
  if (!loc) throw new Error('Give ref, role, name or text.');
  return all ? loc : nth === undefined ? loc.first() : loc.nth(nth);
}

// The lines of `after` that are new since `before`, with their parent lines for context. Refs stay the same
// for the same element across snapshots, so unchanged elements give identical lines.
export function changes(before, after) {
  const left = new Map();
  for (const l of before.split('\n')) left.set(l, (left.get(l) || 0) + 1);
  const lines = after.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => { const n = left.get(l); if (n) left.set(l, n - 1); else keep.add(i); });
  const removed = [...left.values()].reduce((a, b) => a + b, 0);
  if (!keep.size && !removed) return 'Nothing changed on the page. web_snapshot shows all of it.';
  if (keep.size > lines.length / 2) return after;
  const indent = l => l.match(/^ */)[0].length;
  for (const i of [...keep]) {
    let d = indent(lines[i]);
    for (let j = i - 1; j >= 0 && d > 0; j--) if (indent(lines[j]) < d) { keep.add(j); d = indent(lines[j]); }
  }
  const out = [];
  [...keep].sort((a, b) => a - b).forEach((i, k, all) => { if (k && i > all[k - 1] + 1) out.push('  …'); out.push(lines[i]); });
  return `Changed since the last snapshot (${removed} line${removed === 1 ? '' : 's'} gone; web_snapshot shows all):\n${out.join('\n')}`;
}

// Snapshots are Playwright's AI-mode accessibility tree: roles, names, text, and a [ref=eN] per element.
export async function snapshot(site, p, a = {}, mode = 'full') {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  const url = p.url();
  const hint = /accounts\.google\.com|\/(log-?in|sign-?in|auth)\b/i.test(url)
    ? `\nThis looks like a sign-in page. Call web_login for "${site.name}" and ask the user to sign in.` : '';
  const opts = { mode: 'ai', ...(a.depth ? { depth: a.depth } : {}) };
  let tree;
  if (hasTarget(a)) tree = await locate(p, a).ariaSnapshot(opts);
  else {
    tree = await p.ariaSnapshot(opts);
    const prev = site.last;
    if (!a.depth) site.last = { url, tree };
    if (mode === 'changes' && prev?.url === url) tree = changes(prev.tree, tree);
  }
  return `Site: ${site.name}\nURL: ${url}\nTitle: ${await p.title()}${hint}\n\n${tree}`;
}
export const after = (s, p, mode = 'changes') => mode === 'none' ? 'Done.' : snapshot(s, p, {}, mode);

// Click like a mouse; if another element covers the target (common for styled radio buttons and
// checkboxes), operate it from the keyboard instead, as a screen-reader user would.
export async function activate(loc) {
  try {
    await loc.click({ timeout: 5000 });
  } catch (e) {
    if (!/intercepts pointer events|Timeout/i.test(e.message)) throw e;
    const role = await loc.getAttribute('role') || await loc.evaluate(el => el.type || el.tagName.toLowerCase());
    await loc.focus({ timeout: 5000 });
    await loc.press(/radio|checkbox|switch/.test(role) ? 'Space' : 'Enter');
  }
}
