#!/usr/bin/env node
// anysite-mcp: let AI agents use any website through a real Chrome that is signed in as you.
// Each site gets its own Chrome profile, signed in once by hand. Tools find elements by accessible
// role and name (what a screen reader sees), never by CSS, so they survive redesigns. A sequence that
// works can be saved as a shortcut, which becomes a tool of its own.
// Usage: `anysite-mcp [site ...]` (MCP over stdio), `anysite-mcp login <site>` (one-time sign-in).
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { closest, describe, elements } from './lib/heal.js';
import { baseDomain, hostAllowed, readSettings, RISKY, SEARCHY, writeSiteSettings } from './lib/permissions.js';
import { addEvent, parametrize, recorderScript } from './lib/recorder.js';

const HOME = process.env.ANYSITE_HOME || join(homedir(), '.anysite-mcp');
const DOWNLOADS = process.env.ANYSITE_DOWNLOADS || join(homedir(), 'Downloads', 'anysite');
const PACK_DIRS = [join(HOME, 'sites'), fileURLToPath(new URL('./sites', import.meta.url))];
const MAX_TEXT = 40000;
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
// ANYSITE_HEADLESS=1 runs the automated Chrome without a window (sign-in always gets a window).
// ANYSITE_CHROME_ARGS adds Chrome flags, e.g. "--no-sandbox" when running as root in a container.
const HEADLESS = /^(1|true|yes)$/i.test(process.env.ANYSITE_HEADLESS || '');
const CHROME_ARGS = (process.env.ANYSITE_CHROME_ARGS || '').split(/\s+/).filter(Boolean);
const QUIT = process.platform === 'darwin' ? 'quit that window (Cmd+Q)' : 'close all of its windows';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every Chromium that Playwright has downloaded, newest revision first.
function playwrightChromes() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright')];
  const bins = ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome',
    'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  return roots.filter(r => r && existsSync(r)).flatMap(r => readdirSync(r)
    .filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])
    .flatMap(d => bins.map(b => join(r, d, b))));
}

// First existing of: $ANYSITE_CHROME, an installed Google Chrome or Chromium, a Playwright-downloaded Chromium.
const CHROME = [process.env.ANYSITE_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  ...[process.env.LOCALAPPDATA, process.env.PROGRAMFILES || 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)']
    .filter(Boolean).map(d => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  ...playwrightChromes()].find(p => p && existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Install Google Chrome, run `npx playwright install chromium`, or set ANYSITE_CHROME.');
  process.exit(1);
}

const launch = (site, extra) => spawn(CHROME, [`--user-data-dir=${site.profile}`, '--no-first-run',
  '--no-default-browser-check', ...CHROME_ARGS, ...extra], { stdio: 'ignore', detached: true }).unref();

// Sites. "gemini" names a pack (sites/gemini.js, or ~/.anysite-mcp/sites/gemini.js to add or override one);
// "github.com" or a URL is any site. The name keys the site's profile, tools and saved shortcuts.

const packNames = () => [...new Set(PACK_DIRS.filter(existsSync)
  .flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3))))];

const sites = new Map();
async function loadSite(arg) {
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(arg) ? 'http' : 'https';
  const url = /[.:/]/.test(arg) ? new URL(/^https?:\/\//.test(arg) ? arg : `${scheme}://${arg}`) : null;
  const name = url ? url.hostname.replace(/^www\./, '') : arg.toLowerCase();
  if (sites.has(name)) return sites.get(name);
  if (!url && !/^[a-z0-9_-]+$/.test(name)) throw new Error(`Bad site name "${arg}".`);
  const file = PACK_DIRS.map(d => join(d, `${name}.js`)).find(existsSync);
  const pack = file ? (await import(pathToFileURL(file).href)).default({ z, kit }) : {};
  if (!url && !pack.url) throw new Error(`No pack named "${arg}". Give a domain such as github.com, or one of: ${packNames().join(', ')}`);
  const site = { ...pack, name, url: url?.href || pack.url, profile: join(HOME, 'profiles', name),
    shortcutFile: join(HOME, 'sites', `${name}.json`), prefix: name.replace(/[^a-z0-9]+/g, '_') };
  mkdirSync(site.profile, { recursive: true });
  sites.set(name, site);
  return site;
}

// Chrome is started with a debugging port of its choosing, which it writes to the profile. Reconnect
// to it if it is still running (so tabs and state survive server restarts), else start it.
async function getPage(site) {
  if (site.page && !site.page.isClosed()) return site.page;
  const portFile = join(site.profile, 'DevToolsActivePort');
  const connect = async () => chromium.connectOverCDP(`http://127.0.0.1:${readFileSync(portFile, 'utf8').split('\n')[0]}`);
  let browser = await connect().catch(() => undefined);
  if (!browser) {
    rmSync(portFile, { force: true });
    launch(site, ['--remote-debugging-port=0', ...(HEADLESS ? ['--headless=new'] : []), site.url]);
    for (let i = 0; !browser && i < 40; i++) {
      await sleep(500);
      browser = await connect().catch(() => undefined);
    }
    if (!browser) throw new Error(`Could not start Chrome for ${site.name}. If its sign-in window is still open, ask the user to quit it, then retry.`);
  }
  site.browser = browser;
  const ctx = browser.contexts()[0];
  const host = new URL(site.url).hostname;
  site.page = ctx.pages().find(p => p.url().includes(host)) || ctx.pages()[0] || await ctx.newPage();
  if (!site.page.url().startsWith('http')) await site.page.goto(site.url);
  return site.page;
}

// Sign-in happens in a plain Chrome with no debugging port: Google and others refuse sign-in in visibly
// automated browsers. Close the automated one first, since one profile can only be open once.
async function login(site) {
  const portFile = join(site.profile, 'DevToolsActivePort');
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const browser = site.browser || await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    await browser?.newBrowserCDPSession().then(s => s.send('Browser.close')).catch(() => {});
    site.page = site.browser = undefined;
    // SingletonLock is a symlink to nowhere, so check it with lstat, not existsSync.
    for (let i = 0; i < 20 && lstatSync(join(site.profile, 'SingletonLock'), { throwIfNoEntry: false }); i++) await sleep(500);
  }
  launch(site, [site.url]);
}

const clip = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n…[truncated]' : s);
const text = s => ({ content: [{ type: 'text', text: clip(s) }] });

// A ref from the latest snapshot is the quickest way to point at an element; role+name is what lasts (and
// what shortcuts store); text is a fallback for elements without a useful role.
const target = { ref: z.string().optional().describe('Element ref from the latest snapshot, e.g. e12. Refs last until the page changes; shortcuts must use role/name instead'),
  role: z.string().optional().describe('ARIA role from the snapshot, e.g. button, link, textbox, tab'),
  name: z.string().optional().describe('Accessible name from the snapshot'),
  text: z.string().optional().describe('Visible text, used when role/name do not match'),
  exact: z.boolean().optional(), nth: z.number().int().optional().describe('Pick the nth match (0-based) when several match'),
  within: z.string().optional().describe('Only look inside the last element with this role (the topmost dialog, for example), e.g. main, dialog, navigation') };
const hasTarget = a => a.ref || a.role || a.name || a.text;
const show = z.enum(['changes', 'full', 'none']).optional()
  .describe('What to return afterwards: only what changed on the page (default), the full snapshot, or nothing');

// `all` returns every match instead of the first (or nth).
function locate(p, { ref, role, name, text: t, exact, nth, within }, all = false) {
  if (ref) return p.getByRef(ref.replace(/^\[?(ref=)?|\]$/g, ''));
  const root = within ? p.getByRole(within).last() : p;
  const loc = role ? root.getByRole(role, name ? { name, exact } : {})
    : name ? root.getByLabel(name, { exact }).or(root.getByPlaceholder(name, { exact }))
    : t ? root.getByText(t, { exact }) : null;
  if (!loc) throw new Error('Give ref, role, name or text.');
  return all ? loc : nth === undefined ? loc.first() : loc.nth(nth);
}

// The lines of `after` that are new since `before`, with their parent lines for context. Refs stay the same
// for the same element across snapshots, so unchanged elements give identical lines.
function changes(before, after) {
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
async function snapshot(site, p, a = {}, mode = 'full') {
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
const after = (s, p, mode = 'changes') => mode === 'none' ? 'Done.' : snapshot(s, p, {}, mode);

// Click like a mouse; if another element covers the target (common for styled radio buttons and
// checkboxes), operate it from the keyboard instead, as a screen-reader user would.
async function activate(loc) {
  try {
    await loc.click({ timeout: 5000 });
  } catch (e) {
    if (!/intercepts pointer events|Timeout/i.test(e.message)) throw e;
    const role = await loc.getAttribute('role') || await loc.evaluate(el => el.type || el.tagName.toLowerCase());
    await loc.focus({ timeout: 5000 });
    await loc.press(/radio|checkbox|switch/.test(role) ? 'Space' : 'Enter');
  }
}
// Helpers handed to packs.
const kit = {
  sleep,
  // Pages that render in stages lose input typed too early. Wait until the page text stops changing (max 15s).
  async settle(p) {
    let prev = -1, same = 0;
    for (let i = 0; i < 30 && same < 3; i++) {
      await sleep(500);
      const len = (await p.locator('body').innerText().catch(() => '')).length;
      same = len === prev ? same + 1 : 0;
      prev = len;
    }
  },
  // Close welcome/what's-new popups that block the page.
  async dismissPopups(p) {
    for (let i = 0; i < 3; i++) {
      const dialog = p.getByRole('dialog').last();
      if (!await dialog.isVisible().catch(() => false)) return;
      const close = dialog.getByRole('button', { name: /^(close|dismiss|got it|no thanks|ok|skip)/i }).first();
      if (await close.isVisible().catch(() => false)) await close.click(); else await p.keyboard.press('Escape');
      await sleep(500);
    }
  },
};

// Per-site permissions (lib/permissions.js). Checked by the page actions, so shortcuts obey them too.
const SETTINGS = join(HOME, 'settings.json');
const perms = site => ({ read_only: false, confirm: false, ...readSettings(SETTINGS).sites?.[site.name] });
const allowedDomains = site => perms(site).allowed_domains || [baseDomain(new URL(site.url).hostname)];

// Ask the user through the MCP client. Clients that can't ask make the action fail rather than go ahead.
async function confirmAction(site, what) {
  if (!server.server.getClientCapabilities()?.elicitation)
    throw new Error(`${site.name} is set to ask the user before the agent can ${what}, and this MCP client can't ask. ` +
      `Ask the user to do it by hand, or to run: anysite-mcp permissions ${site.name} --no-confirm`);
  const r = await server.server.elicitInput({ message: `Let the agent ${what} on ${site.name}?`,
    requestedSchema: { type: 'object', properties: {} } });
  if (r.action !== 'accept') throw new Error(`The user said no to: ${what}. Don't try another way.`);
}

// verb: click, submit (Enter in a field), upload, or write (a pack tool that changes things).
async function permit(site, verb, label = '') {
  const risky = verb === 'upload' || verb === 'write' || (verb === 'submit' ? !SEARCHY.test(label) : RISKY.test(label));
  if (!risky) return;
  const { read_only, confirm } = perms(site);
  const what = verb === 'write' ? label : `${verb}${label ? ` "${label.slice(0, 60)}"` : ''}`;
  if (read_only) throw new Error(`${site.name} is read-only, so the agent can't ${what}. ` +
    `The user can change that with: anysite-mcp permissions ${site.name} --read-write`);
  if (confirm) await confirmAction(site, what);
}

const labelOf = loc => loc.evaluate(e => (e.getAttribute('aria-label') || e.getAttribute('placeholder') ||
  e.innerText || e.value || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80)).catch(() => '');

// Page actions: each is a web_* tool and a step a shortcut can use. Each returns text.
const actions = {
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
    await permit(s, 'click', a.name || a.text || await labelOf(loc));
    await activate(loc);
    await sleep(800);
    return after(s, p, m);
  },
  type: async (p, { value, submit, show: m, ...a }, s) => {
    const loc = locate(p, a);
    if (submit) await permit(s, 'submit', `${a.role === 'searchbox' ? 'search ' : ''}${a.name || a.text || await labelOf(loc)}`);
    await loc.fill(value, { timeout: 10000 });
    if (submit) await loc.press('Enter');
    await sleep(800);
    return after(s, p, m);
  },
  select: async (p, { value, show: m, ...a }, s) => {
    await locate(p, a).selectOption(value, { timeout: 10000 });
    await sleep(500);
    return after(s, p, m);
  },
  press: async (p, { key, show: m }, s) => {
    if (/(^|\+)Enter$/.test(key)) await permit(s, 'submit', await labelOf(p.locator(':focus')));
    await p.keyboard.press(key);
    await sleep(500);
    return after(s, p, m);
  },
  upload: async (p, { paths, show: m, ...a }, s) => {
    const loc = locate(p, a);
    await permit(s, 'upload', a.name || a.text || await labelOf(loc));
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), loc.click()]);
    await chooser.setFiles(paths);
    await sleep(1500);
    return after(s, p, m);
  },
  read: async (p, a) => hasTarget(a) ? locate(p, a).innerText() : p.locator('body').innerText(),
  // Rows as JSON: one per element matching the target, with `fields` looked up inside each.
  extract: async (p, { fields, limit = 50, ...a }) => {
    const items = locate(p, a, true);
    const rows = [];
    for (let i = 0, n = Math.min(await items.count(), limit); i < n; i++) {
      const it = items.nth(i);
      if (!fields) {
        rows.push(await it.evaluate(e => {
          const link = e.matches('a[href]') ? e : e.querySelector('a[href]');
          return { text: e.innerText.replace(/\s+/g, ' ').trim(), ...(link ? { link: link.href } : {}) };
        }));
        continue;
      }
      const row = {};
      for (const [k, { attr, ...f }] of Object.entries(fields)) {
        const loc = hasTarget(f) ? locate(it, f) : it;
        row[k] = await loc.count() ? attr ? await loc.getAttribute(attr) : (await loc.innerText()).replace(/\s+/g, ' ').trim() : null;
      }
      rows.push(row);
    }
    return JSON.stringify(rows, null, 2);
  },
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
const stepNames = Object.keys(actions);

// Saved shortcuts: { name: { description, params, steps: [{ action, ...args, expect?, fallbacks? }] } }.
// A param is a description, or { description, type: string|number|boolean, optional, default }. "{{param}}" in any
// step string is replaced by its value. "expect" is text that must be on the page after the step. "fallbacks" are
// other ways to find the step's element, used when the site changes (lib/heal.js).
const readShortcuts = site => existsSync(site.shortcutFile) ? JSON.parse(readFileSync(site.shortcutFile, 'utf8')) : {};
function writeShortcuts(site, all) {
  mkdirSync(join(HOME, 'sites'), { recursive: true });
  writeFileSync(site.shortcutFile, JSON.stringify(all, null, 2) + '\n');
}
const updateShortcut = (site, name, steps) => {
  const all = readShortcuts(site);
  if (all[name]) writeShortcuts(site, { ...all, [name]: { ...all[name], steps } });
};

// Problems that would only show when the shortcut runs: unknown actions, refs, undeclared params.
function checkShortcut({ params = {}, steps }) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('A shortcut needs a list of steps.');
  steps.forEach(({ action, ...a }, i) => {
    const at = `Step ${i + 1} (${action})`;
    if (!actions[action]) throw new Error(`${at}: use one of ${stepNames.join(', ')}.`);
    if (a.ref) throw new Error(`${at}: refs like "${a.ref}" only last until the page changes. Use role and name instead.`);
    for (const [, k] of JSON.stringify(a).matchAll(/\{\{(\w+)\}\}/g))
      if (!(k in params)) throw new Error(`${at} uses {{${k}}}, which is not in params.`);
  });
}

const paramSpec = d => typeof d === 'string' ? { description: d } : d || {};
function fillFrom(params, args) {
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
const exists = (loc, ms) => loc.waitFor({ state: 'attached', timeout: ms }).then(() => true, () => false);

// null if the step's element is there; else a replacement target: a saved fallback, or the closest match.
async function findOrHeal(p, a, fallbacks = []) {
  if (await exists(locate(p, a), 5000)) return null;
  for (const f of fallbacks) if (await exists(locate(p, { ...f, within: a.within }), 500)) return f;
  const el = closest(a, elements(await p.ariaSnapshot({ mode: 'ai' })));
  const fix = el && { role: el.role, name: el.name, exact: true };
  if (fix && await exists(locate(p, { ...fix, within: a.within }), 1000)) return fix;
  throw new Error(`no element matches ${describe(a)}${a.within ? ` inside ${a.within}` : ''}, and nothing on the page is close enough to use instead`);
}

// Other ways to find an element, saved with the step so it can be found again after a redesign.
async function fallbacksFor(p, a) {
  const info = await locate(p, a).evaluate(e => ({
    label: e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || '',
    text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) }), undefined, { timeout: 2000 }).catch(() => null);
  if (!info) return [];
  return [info.label && info.label !== a.name && { name: info.label },
    info.text && info.text !== a.name && info.text !== a.text && { text: info.text }].filter(Boolean);
}

// Find a targeted step's element, healing the step (in `step`, which the caller may save) if it moved.
async function resolveStep(p, step, a, repairs, i) {
  const { action, expect, fallbacks, ...raw } = step;
  if (!TARGETED.has(action) || !hasTarget(a) || a.ref) return a;
  const fix = await findOrHeal(p, a, fallbacks);
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
async function runSteps(site, sc, args, { learn = false } = {}) {
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
      last = await actions[action](p, { show: 'none', ...a }, site);
      if (expect) await p.getByText(fill(expect)).first().waitFor({ timeout: 10000 }).catch(() => {
        throw new Error(`expected "${fill(expect)}" on the page, but it is not there (URL: ${p.url()})`);
      });
    } catch (e) {
      throw new Error(`Step ${i + 1} (${action}) failed: ${e.message}\nThe site may have changed: do it with the web_* tools, then save the shortcut again.`);
    }
    if (action === 'read' || action === 'extract') reads.push(last);
  }
  let text = reads.length ? reads.join('\n\n') : last === 'Done.' ? await snapshot(site, p) : last;
  if (repairs.length) text += `\n\n[The site has changed. Repaired ${repairs.join('; ')}.]`;
  return { text, steps, repaired: repairs.length > 0 };
}

// One call at a time per site: they share one tab, and two at once would act on each other's page.
function exclusive(site, fn) {
  const run = (site.lock || Promise.resolve()).then(fn);
  site.lock = run.catch(() => {});
  return run;
}

// Record mode (lib/recorder.js).
const REC_TOKEN = Math.random().toString(36).slice(2);
async function startRecording(site) {
  const p = await getPage(site);
  const ctx = p.context();
  site.recording = [{ action: 'open', url: p.url() }];
  if (!site.recorder) {
    await ctx.exposeBinding('__anysiteRecord', (_source, ev) => {
      if (site.recording && ev?.token === REC_TOKEN) addEvent(site.recording, ev);
    });
    await ctx.addInitScript(recorderScript(REC_TOKEN));
    site.recorder = true;
  }
  for (const page of ctx.pages()) await page.evaluate(recorderScript(REC_TOKEN)).catch(() => {});
  await p.bringToFront().catch(() => {});
}
function stopRecording(site, name, description) {
  if (!site.recording) throw new Error(`Not recording on ${site.name}. Start with action "start".`);
  const { params, steps } = parametrize(site.recording);
  site.recording = null;
  if (steps.length < 2) throw new Error('Nothing was recorded: no clicks or typing happened in the window.');
  const sc = { description, ...(Object.keys(params).length ? { params } : {}), steps };
  checkShortcut(sc);
  writeShortcuts(site, { ...readShortcuts(site), [name]: sc });
  addShortcut(site, name, sc);
  return sc;
}

// Check a site's shortcuts without changing anything: follow each one while its steps only open and read pages,
// and stop at the first step that would act (it is only checked that its element is there). Heals what it can.
async function doctor(site) {
  const all = readShortcuts(site);
  const p = await getPage(site);
  const lines = [];
  let broken = 0, changed = false;
  for (const [n, sc] of Object.entries(all)) {
    const params = sc.params || {};
    const fill = fillFrom(params, Object.fromEntries(Object.keys(params).map(k => [k, paramSpec(params[k]).default ?? 'test'])));
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
      lines.push(`${repairs.length ? '~' : '✓'} ${site.prefix}_${n}${scope}${repairs.length ? `: repaired ${repairs.join('; ')}` : ''}`);
    } catch (e) {
      broken++;
      lines.push(`✗ ${site.prefix}_${n}: ${e.message}`);
    }
  }
  if (changed) writeShortcuts(site, all);
  return { lines, broken };
}

// Shared shortcuts: JSON files of { name: shortcut }, by default from library/<site>.json in this repository.
// They hold steps only, never code, so they can't do anything the web_* tools can't.
const LIBRARY = 'https://raw.githubusercontent.com/DwytMCL/anysite-mcp/main/library';
async function addShortcuts(site, { from, only, force }) {
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

// MCP server.

const server = new McpServer({ name: 'anysite', version: VERSION }, {
  instructions: 'Use websites through a real Chrome that is signed in as the user; each site has its own browser profile. ' +
    'Call web_snapshot first, then act on elements by their ref (e.g. e12) or role and name. After an action you get ' +
    'only what changed on the page; call web_snapshot when you need all of it. Use web_extract to get lists as JSON. ' +
    'Pass `site` as a site name or a domain: any domain works, not only the ones already set up. ' +
    'If a page asks the user to sign in, call web_login and wait for the user to say they are done. ' +
    'Prefer a site\'s own tools (named <site>_...) when one fits. When a sequence of steps works and is likely to be ' +
    'wanted again, save it with web_save_shortcut so it becomes one tool. If the user wants to show you how to do ' +
    'something, use web_record. Some sites are read-only or ask the user first; respect a refusal and do not work around it.' });

const tool = (name, description, schema, fn) => server.registerTool(name, { description, inputSchema: schema },
  async args => {
    try { const r = await fn(args); return typeof r === 'string' ? text(r) : r; }
    catch (e) { return { ...text(`Error: ${e.message}`), isError: true }; }
  });

const zodParam = d => {
  const p = paramSpec(d);
  const t = (p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string())
    .describe(`${p.description || ''}${p.default !== undefined ? ` (default: ${p.default})` : ''}`);
  return p.optional || p.default !== undefined ? t.optional() : t;
};

const shortcutTools = new Map();
function addShortcut(site, name, sc) {
  const key = `${site.prefix}_${name}`;
  shortcutTools.get(key)?.remove();
  shortcutTools.set(key, tool(key, `${sc.description} (saved shortcut for ${site.name})`,
    Object.fromEntries(Object.entries(sc.params || {}).map(([k, d]) => [k, zodParam(d)])),
    a => exclusive(site, async () => {
      const r = await runSteps(site, sc, a);
      if (r.repaired) { sc.steps = r.steps; updateShortcut(site, name, r.steps); }
      return r.text + (r.repaired ? ' The shortcut was updated to match.' : '');
    })));
}

const registered = new Set();
async function useSite(arg) {
  if (!arg) {
    if (sites.size === 1) return [...sites.values()][0];
    throw new Error(`Say which site: ${[...sites.keys()].join(', ') || 'any domain, e.g. github.com'}`);
  }
  const site = await loadSite(arg);
  if (!registered.has(site.name)) {
    registered.add(site.name);
    for (const [n, t] of Object.entries(site.tools || {}))
      tool(`${site.prefix}_${n}`, t.description, t.input || {}, a => exclusive(site, async () => {
        if (t.writes) await permit(site, 'write', `use ${site.prefix}_${n}`);
        return t.run(await getPage(site), a, site);
      }));
    for (const [n, sc] of Object.entries(readShortcuts(site))) addShortcut(site, n, sc);
  }
  return site;
}

const siteArg = z.string().optional().describe('Site name or domain, e.g. gemini or github.com. Optional when only one site is in use.');
const web = (name, description, schema, fn) => tool(`web_${name}`, description, { site: siteArg, ...schema },
  async ({ site, ...a }) => { const s = await useSite(site); return exclusive(s, async () => fn(await getPage(s), a, s)); });
const field = z.object({ role: z.string(), name: z.string(), text: z.string(), exact: z.boolean(), nth: z.number().int(),
  attr: z.string().describe('Return this attribute instead of the text, e.g. href') }).partial();

web('snapshot', 'Accessibility tree of the site\'s current page: roles, names and text of every element, each with a ' +
  'ref (e.g. [ref=e12]) to pass to other tools. Give ref or role/name to show only that part of the page, or depth ' +
  'to see only the top levels of a big page.',
  { ...target, depth: z.number().int().min(1).optional().describe('Only this many levels deep') }, actions.snapshot);
web('open', 'Go to a URL (absolute, or relative to the site; default: the site\'s home) and return the snapshot.',
  { url: z.string().optional(), show }, actions.open);
web('click', 'Click an element found by ref, role/name or text. Returns what changed on the page.',
  { ...target, show }, actions.click);
web('type', 'Fill a text field found by ref, role/name or label/placeholder, optionally pressing Enter. ' +
  'Returns what changed on the page.',
  { ...target, value: z.string(), submit: z.boolean().optional(), show }, actions.type);
web('select', 'Choose an option in a drop-down (<select>) found by ref, role/name or label.',
  { ...target, value: z.string().describe('The option\'s label or value'), show }, actions.select);
web('press', 'Press a key or chord on the focused element, e.g. Enter, Escape, Tab.', { key: z.string(), show }, actions.press);
web('upload', 'Click an element that opens a file picker (e.g. an upload button) and give it local files.',
  { ...target, paths: z.array(z.string()), show }, actions.upload);
web('read', 'Visible text of the page (or of one element), e.g. to read a full reply.', target, actions.read);
web('extract', 'Rows as JSON, one per element matching the target (e.g. role "row", "listitem" or "article"). ' +
  'Without fields each row is { text, link }. With fields, each field is found inside the row, e.g. ' +
  '{"title":{"role":"link"},"url":{"role":"link","attr":"href"},"score":{"text":"points"}}.',
  { ...target, fields: z.record(z.string(), field).optional(), limit: z.number().int().min(1).max(500).optional() },
  actions.extract);
web('wait', 'Wait for the page to settle, e.g. while something is generating. With until_text, fails if the text ' +
  'has not appeared in time.',
  { seconds: z.number().min(0).max(120), until_text: z.string().optional().describe('Stop early once this text appears'), show },
  actions.wait);
web('download', 'Click an element that downloads a file and save it. ' +
  `Saved to ${DOWNLOADS} unless save_dir is given. Returns the saved path.`,
  { ...target, save_dir: z.string().optional() }, actions.download);
web('screenshot', 'PNG screenshot of the current page, for when the snapshot is not enough.', {},
  async p => ({ content: [{ type: 'image', mimeType: 'image/png', data: (await p.screenshot()).toString('base64') }] }));

tool('web_login', 'Open a normal Chrome window on the site so the user can sign in by hand (automated browsers are ' +
  'often refused). Then ask the user to sign in and quit that window, and wait for them to say so before using the site.',
  { site: z.string() }, async ({ site }) => {
    const s = await useSite(site);
    await exclusive(s, () => login(s));
    return `A Chrome window opened on ${s.url}. Ask the user to sign in there, then ${QUIT}, ` +
      'and tell you. The login is kept for next time.';
  });

tool('web_record', 'Learn a job by watching the user do it. "start" brings the site\'s Chrome window to the front and ' +
  'records the user\'s clicks, typing and choices there; ask the user to do the job and to tell you when they are done. ' +
  '"stop" saves what they did as a shortcut tool named <site>_<name>, with each typed value as a parameter.',
  { site: z.string(), action: z.enum(['start', 'stop']), name: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    description: z.string().optional().describe('What the shortcut does, for stop') },
  async ({ site, action, name, description }) => {
    const s = await useSite(site);
    if (action === 'start') {
      await exclusive(s, () => startRecording(s));
      return `Recording on ${s.name}${HEADLESS ? ' (Chrome is headless here, so the user can\'t see it: unset ANYSITE_HEADLESS to record)' : ''}. ` +
        'Ask the user to do the job in that Chrome window and tell you when they are done. Then call web_record with ' +
        'action "stop", a name and a description.';
    }
    if (!name || !description) throw new Error('Give a name and a description to save the recording.');
    const sc = stopRecording(s, name, description);
    return `Saved ${s.prefix}_${name}:\n${JSON.stringify(sc, null, 2)}\nRead it over: if a step clicks a specific ` +
      'item that should change each time, edit it with web_save_shortcut to use a {{param}}.';
  });

tool('web_save_shortcut', 'Save a sequence of steps that worked as a new tool named <site>_<name>, available now and in ' +
  'later sessions. Each step is { action, ...arguments of the web_<action> tool }, e.g. ' +
  '{"action":"type","role":"textbox","name":"Search","value":"{{query}}","submit":true}. "{{param}}" is replaced by ' +
  'the argument. Find elements by role and name (refs do not last). Add "expect":"some text" to a step to make the ' +
  'shortcut fail if that text is not on the page afterwards. The tool returns the text of its "read" and "extract" ' +
  'steps, or the final page if there are none. The steps are run once with test_args before saving, so a broken ' +
  'shortcut is not saved; that run also notes other ways to find each element, so the shortcut can repair itself ' +
  'when the site changes. Saving under an existing name replaces it.',
  { site: z.string(), name: z.string().regex(/^[a-z][a-z0-9_]*$/), description: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.object({ description: z.string(),
      type: z.enum(['string', 'number', 'boolean']).optional(), optional: z.boolean().optional(),
      default: z.union([z.string(), z.number(), z.boolean()]).optional() })])).optional()
      .describe('Parameter name -> description, or { description, type, optional, default }'),
    steps: z.array(z.object({ action: z.enum(stepNames), expect: z.string().optional() }).catchall(z.any())).min(1)
      .describe(`Actions: ${stepNames.join(', ')}`),
    test_args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
      .describe('Values for params to use in the test run'),
    verify: z.boolean().optional().describe('Run the steps once before saving (default true). Set false only when ' +
      'running them again would do something twice, such as sending a message or buying something') },
  async ({ site, name, test_args = {}, verify = true, ...sc }) => {
    const s = await useSite(site);
    checkShortcut(sc);
    let note = '';
    if (verify) {
      const missing = Object.entries(sc.params || {}).map(([k, d]) => [k, paramSpec(d)])
        .filter(([k, d]) => test_args[k] === undefined && d.default === undefined && !d.optional).map(([k]) => k);
      if (missing.length) throw new Error(`Give test_args for ${missing.join(', ')} so the steps can be tried, or set verify: false.`);
      const r = await exclusive(s, () => runSteps(s, sc, test_args, { learn: true }));
      sc.steps = r.steps;
      note = ` Test run worked and returned:\n${r.text.slice(0, 500)}${r.text.length > 500 ? '…' : ''}`;
    }
    writeShortcuts(s, { ...readShortcuts(s), [name]: sc });
    addShortcut(s, name, sc);
    return `Saved ${s.prefix}_${name} in ${s.shortcutFile}.${note}`;
  });

tool('web_list_shortcuts', 'List the shortcuts saved for a site with their steps. With a name, return that one as ' +
  'JSON ready to share (other people add it with `anysite-mcp add <site> --from <file or URL>`).',
  { site: z.string(), name: z.string().optional() }, async ({ site, name }) => {
    const s = await useSite(site);
    const all = readShortcuts(s);
    if (name) {
      if (!all[name]) throw new Error(`No shortcut "${name}" for ${s.name}. Saved: ${Object.keys(all).join(', ') || 'none'}`);
      return JSON.stringify({ [name]: all[name] }, null, 2);
    }
    if (!Object.keys(all).length) return `No shortcuts saved for ${s.name} yet.`;
    return `Shortcuts for ${s.name} (${s.shortcutFile}):\n` + Object.entries(all).map(([n, sc]) =>
      `\n${s.prefix}_${n}: ${sc.description}\n${JSON.stringify({ params: sc.params || {}, steps: sc.steps }, null, 2)}`).join('\n');
  });

tool('web_delete_shortcut', 'Delete a saved shortcut.', { site: z.string(), name: z.string() }, async ({ site, name }) => {
  const s = await useSite(site);
  const all = readShortcuts(s);
  if (!all[name]) throw new Error(`No shortcut "${name}" for ${s.name}. Saved: ${Object.keys(all).join(', ') || 'none'}`);
  delete all[name];
  writeShortcuts(s, all);
  shortcutTools.get(`${s.prefix}_${name}`)?.remove();
  shortcutTools.delete(`${s.prefix}_${name}`);
  return `Deleted ${s.prefix}_${name}.`;
});

// CLI.

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const flagValue = f => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--from', '--allow'].includes(rest[i - 1]));
const usage = `anysite-mcp [site ...]          Serve MCP over stdio. Sites are pack names (${packNames().join(', ')}) or domains.
                                With none, serves every site you have signed in to.
anysite-mcp login <site>        Open the site in its own Chrome profile to sign in once.
anysite-mcp record <site> <name>  Do a job by hand in the site's Chrome; it is saved as a shortcut.
anysite-mcp add <site>[/<name>] Add shared shortcuts from the library (or --from <file or URL>; --force replaces).
anysite-mcp doctor [site ...]   Check saved shortcuts without changing anything on the sites; repair what it can.
anysite-mcp permissions <site>  Show or set what the agent may do there:
                                --read-only | --read-write, --confirm | --no-confirm,
                                --allow <domain,...> | --allow-any | --allow-default
anysite-mcp --version           Print the version (${VERSION}).
Data: ${HOME}
Environment: ANYSITE_HOME, ANYSITE_CHROME, ANYSITE_CHROME_ARGS, ANYSITE_HEADLESS=1, ANYSITE_DOWNLOADS`;
const need = (ok, msg) => { if (!ok) { console.error(msg); process.exit(1); } };

if (cmd === '--version' || cmd === '-v') { console.log(VERSION); process.exit(0); }
if (cmd === '--help' || cmd === '-h') { console.log(usage); process.exit(0); }
if (cmd === 'login') {
  need(positional[0], 'Usage: anysite-mcp login <site>');
  const site = await loadSite(positional[0]);
  await login(site);
  console.log(`Sign in to ${site.name} in the window that opened, then ${QUIT}.`);
  process.exit(0);
}
if (cmd === 'record') {
  need(positional[1] && /^[a-z][a-z0-9_]*$/.test(positional[1]), 'Usage: anysite-mcp record <site> <name>   (name: lowercase letters, digits, _)');
  const site = await loadSite(positional[0]);
  await startRecording(site);
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`Recording in the Chrome window for ${site.name}. Do the job there, then press Enter here. `);
  const description = (await rl.question('What does it do? (one line, for the agent) ')).trim() || `Recorded on ${site.name}`;
  rl.close();
  const sc = stopRecording(site, positional[1], description);
  console.log(`Saved ${site.prefix}_${positional[1]} in ${site.shortcutFile}:\n${JSON.stringify(sc, null, 2)}`);
  process.exit(0);
}
if (cmd === 'add') {
  need(positional[0], 'Usage: anysite-mcp add <site>[/<name>] [--from <file or URL>] [--force]');
  const [siteArg_, only] = positional[0].split(/\/(?=[a-z][a-z0-9_]*$)/);
  const site = await loadSite(siteArg_);
  const r = await addShortcuts(site, { from: flagValue('--from'), only, force: flags.has('--force') });
  const all = readShortcuts(site);
  for (const n of r.added) console.log(`+ ${site.prefix}_${n}: ${all[n].description}`);
  for (const n of r.skipped) console.log(`  ${site.prefix}_${n} already exists (--force replaces it)`);
  console.log(r.added.length ? `Added from ${r.src}. They hold steps only, no code; see them with web_list_shortcuts.` : 'Nothing added.');
  process.exit(0);
}
if (cmd === 'doctor') {
  const dir = join(HOME, 'sites');
  const names = positional.length ? positional : existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
  if (!names.length) console.log('No saved shortcuts yet.');
  let broken = 0;
  for (const n of names) {
    const site = await loadSite(n);
    if (!Object.keys(readShortcuts(site)).length) continue;
    console.log(site.name);
    const r = await doctor(site);
    for (const l of r.lines) console.log(`  ${l}`);
    broken += r.broken;
  }
  process.exit(broken ? 1 : 0);
}
if (cmd === 'permissions') {
  need(positional[0], 'Usage: anysite-mcp permissions <site> [--read-only|--read-write] [--confirm|--no-confirm] [--allow <domain,...>|--allow-any|--allow-default]');
  const site = await loadSite(positional[0]);
  const change = {};
  if (flags.has('--read-only')) change.read_only = true;
  if (flags.has('--read-write')) change.read_only = null;
  if (flags.has('--confirm')) change.confirm = true;
  if (flags.has('--no-confirm')) change.confirm = null;
  if (flags.has('--allow')) change.allowed_domains = flagValue('--allow').split(',').map(d => d.trim()).filter(Boolean);
  if (flags.has('--allow-any')) change.allowed_domains = ['*'];
  if (flags.has('--allow-default')) change.allowed_domains = null;
  if (Object.keys(change).length) writeSiteSettings(SETTINGS, site.name, change);
  const pm = perms(site);
  console.log(`${site.name}: ${pm.read_only ? 'read-only' : 'read and write'}; ` +
    `${pm.confirm ? 'asks you before sending, buying, deleting and the like' : 'does not ask before acting'}; ` +
    `may open ${allowedDomains(site).join(', ')}${pm.allowed_domains ? '' : ' (default)'}.\nSettings: ${SETTINGS}`);
  process.exit(0);
}
const profiles = join(HOME, 'profiles');
for (const s of cmd ? [cmd, ...rest] : existsSync(profiles) ? readdirSync(profiles).filter(d => !d.startsWith('.')) : [])
  await useSite(s);
await server.connect(new StdioServerTransport());
