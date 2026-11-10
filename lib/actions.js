// Page actions: each is a web_* tool and a step a shortcut can use.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOWNLOADS, sleep } from './config.js';
import { checkRole, describe } from './heal.js';
import { baseDomain, hostAllowed } from './permissions.js';
import { activate, after, hasTarget, locate, snapshot } from './snapshot.js';
import { allowedDomains, effectOf, permit, permitClick, permitEnter } from './guard.js';

// Clicks and Enter can start loading a new page a moment later. If one starts, wait for it to load, so the next
// step doesn't read the old page or a blank one.
export async function settled(p, fn, ms = 800) {
  let navigated = false;
  const seen = f => { if (f === p.mainFrame()) navigated = true; };
  p.on('framenavigated', seen);
  try {
    await fn();
    await sleep(ms);
  } finally {
    p.off('framenavigated', seen);
  }
  if (navigated) {
    await p.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }
}

// A field of an extract row: the first match inside the row that has something to give (an icon link with no text
// is skipped in favour of the titled link after it), unless nth picks one.
export async function fieldValue(row, f, attr) {
  const read = async loc => attr ? loc.getAttribute(attr) : (await loc.innerText()).replace(/\s+/g, ' ').trim();
  if (!hasTarget(f)) return read(row);
  const matches = locate(row, f, true);
  if (f.nth !== undefined) return await matches.nth(f.nth).count() ? read(matches.nth(f.nth)) : null;
  const n = await matches.count();
  let firstValue = null;
  for (let i = 0; i < n; i++) {
    const v = await read(matches.nth(i)).catch(() => null);
    if (v && (attr || v.trim())) {
      if (attr) {
        // For an attribute, still prefer an element that has a name: the titled link, not the thumbnail.
        const named = (await matches.nth(i).innerText().catch(() => '')).trim() || await matches.nth(i).getAttribute('aria-label');
        if (named) return v;
        firstValue ??= v;
      } else return v;
    }
  }
  return firstValue ?? (n ? '' : null);
}

// Rows: one per element matching the target, with `fields` looked up inside each, plus a note when something looks off.
export async function extractRows(p, { fields, limit = 50, ...a }) {
  for (const f of Object.values(fields || {})) checkRole(f.role, 'field role');
  const items = locate(p, a, true);
  await items.first().waitFor({ timeout: 5000 }).catch(() => {}); // lists often arrive just after the page
  const rows = [];
  for (let i = 0, n = Math.min(await items.count(), limit); i < n; i++) {
    const it = items.nth(i);
    if (!fields) {
      rows.push(await it.evaluate(e => {
        const links = e.matches('a[href]') ? [e] : [...e.querySelectorAll('a[href]')];
        const link = links.find(l => l.innerText.trim()) || links[0]; // the titled link, not the thumbnail
        return { text: e.innerText.replace(/\s+/g, ' ').trim(), ...(link ? { link: link.href } : {}) };
      }));
      continue;
    }
    const row = {};
    for (const [k, { attr, ...f }] of Object.entries(fields)) row[k] = await fieldValue(it, f, attr);
    rows.push(row);
  }
  if (!rows.length) return { rows, note: `nothing matched ${describe(a)}. Check the page with web_snapshot.` };
  const empty = Object.keys(fields || {}).filter(k => rows.every(r => r[k] === null || r[k] === ''));
  return empty.length ? { rows, note: `${empty.map(k => `"${k}"`).join(', ')} came back empty on every row. ` +
    'Check its role and name with web_snapshot on one row (give ref or role/name).' } : { rows };
}
/** @param {{ rows: object[], note?: string }} r */
export const extractText = ({ rows, note }) => JSON.stringify(rows, null, 2) + (note ? `\n\nNote: ${note}` : '');

// Page actions: each is a web_* tool and a step a shortcut can use. Each returns text.
export const actions = {
  snapshot: (p, a, s) => snapshot(s, p, a),
  open: async (p, { url, show: m = 'full' }, s) => {
    const to = new URL(url || s.url, s.url);
    const domains = allowedDomains(s);
    if (!hostAllowed(to.hostname, domains)) throw new Error(`${to.hostname} is outside the domains allowed for ` +
      `${s.name} (${domains.join(', ')}). Use it as a site of its own (site: "${to.hostname}"), or the user can ` +
      `allow it with: anysite-mcp permissions ${s.name} --allow ${baseDomain(to.hostname)}`);
    await p.goto(to.href);
    return after(s, p, m);
  },
  click: async (p, { show: m, ...a }, s) => {
    const loc = locate(p, a);
    await permitClick(s, loc, a);
    await settled(p, () => activate(loc));
    return after(s, p, m);
  },
  type: async (p, { value, submit, show: m, ...a }, s) => {
    const loc = locate(p, a);
    if (submit) await permitEnter(s, loc, a);
    await loc.fill(value, { timeout: 10000 });
    await settled(p, () => submit && loc.press('Enter'));
    return after(s, p, m);
  },
  select: async (p, { value, show: m, ...a }, s) => {
    await settled(p, () => locate(p, a).selectOption(value, { timeout: 10000 }), 500);
    return after(s, p, m);
  },
  press: async (p, { key, show: m }, s) => {
    if (/(^|\+)Enter$/.test(key)) await permitEnter(s, p.locator(':focus'));
    await settled(p, () => p.keyboard.press(key), 500);
    return after(s, p, m);
  },
  upload: async (p, { paths, show: m, ...a }, s) => {
    const loc = locate(p, a);
    await permit(s, `upload files with "${(a.name || a.text || (await effectOf(loc)).label).slice(0, 60)}"`);
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), loc.click()]);
    await chooser.setFiles(paths);
    await sleep(1500);
    return after(s, p, m);
  },
  read: async (p, a) => hasTarget(a) ? locate(p, a).innerText() : p.locator('body').innerText(),
  // Rows as JSON.
  extract: async (p, a) => extractText(await extractRows(p, a)),
  wait: async (p, { seconds, until_text, show: m }, s) => {
    if (until_text) await p.getByText(until_text).first().waitFor({ timeout: seconds * 1000 }).catch(() => {
      throw new Error(`"${until_text}" did not appear within ${seconds} s.`);
    });
    else await sleep(seconds * 1000);
    return after(s, p, m);
  },
  download: async (p, { save_dir, ...a }) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), locate(p, a).click()]);
    const dir = save_dir || DOWNLOADS;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, dl.suggestedFilename());
    await dl.saveAs(file);
    return `Saved ${file}`;
  },
};
export const STEP_NAMES = Object.keys(actions);
