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

const HOME = process.env.ANYSITE_HOME || join(homedir(), '.anysite-mcp');
const DOWNLOADS = process.env.ANYSITE_DOWNLOADS || join(homedir(), 'Downloads', 'anysite');
const PACK_DIRS = [join(HOME, 'sites'), fileURLToPath(new URL('./sites', import.meta.url))];
const MAX_TEXT = 40000;
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
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ...playwrightChromes()].find(p => p && existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Install Google Chrome, run `npx playwright install chromium`, or set ANYSITE_CHROME.');
  process.exit(1);
}

const launch = (site, extra) => spawn(CHROME, [`--user-data-dir=${site.profile}`, '--no-first-run',
  '--no-default-browser-check', ...extra], { stdio: 'ignore', detached: true }).unref();

// Sites. "gemini" names a pack (sites/gemini.js, or ~/.anysite-mcp/sites/gemini.js to add or override one);
// "github.com" or a URL is any site. The name keys the site's profile, tools and saved shortcuts.

const packNames = () => [...new Set(PACK_DIRS.filter(existsSync)
  .flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3))))];

const sites = new Map();
async function loadSite(arg) {
  const url = /[.:/]/.test(arg) ? new URL(/^https?:\/\//.test(arg) ? arg : `https://${arg}`) : null;
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
    launch(site, ['--remote-debugging-port=0', site.url]);
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

// role+name is preferred; text is a fallback for elements without a useful role.
const target = { role: z.string().optional().describe('ARIA role from the snapshot, e.g. button, link, textbox, tab'),
  name: z.string().optional().describe('Accessible name from the snapshot'),
  text: z.string().optional().describe('Visible text, used when role/name do not match'),
  exact: z.boolean().optional(), nth: z.number().int().optional().describe('Pick the nth match (0-based) when several match') };
const hasTarget = a => a.role || a.name || a.text;

function locate(p, { role, name, text: t, exact, nth }) {
  const loc = role ? p.getByRole(role, name ? { name, exact } : {})
    : name ? p.getByLabel(name, { exact }).or(p.getByPlaceholder(name, { exact }))
    : t ? p.getByText(t, { exact }) : null;
  if (!loc) throw new Error('Give role, name or text.');
  return nth === undefined ? loc.first() : loc.nth(nth);
}

async function snapshot(site, p, a = {}) {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  const hint = /accounts\.google\.com|\/(log-?in|sign-?in|auth)\b/i.test(p.url())
    ? `\nThis looks like a sign-in page. Call web_login for "${site.name}" and ask the user to sign in.` : '';
  const root = hasTarget(a) ? locate(p, a) : p.locator('body');
  return `Site: ${site.name}\nURL: ${p.url()}\nTitle: ${await p.title()}${hint}\n\n${await root.ariaSnapshot()}`;
}

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

// Page actions: each is a web_* tool and a step a shortcut can use. Each returns text.
const actions = {
  snapshot: (p, a, s) => snapshot(s, p, a),
  open: async (p, { url }, s) => { await p.goto(url ? new URL(url, s.url).href : s.url); return snapshot(s, p); },
  click: async (p, a, s) => { await activate(locate(p, a)); await sleep(800); return snapshot(s, p); },
  type: async (p, { value, submit, ...a }, s) => {
    const loc = locate(p, a);
    await loc.fill(value, { timeout: 10000 });
    if (submit) await loc.press('Enter');
    await sleep(800);
    return snapshot(s, p);
  },
  press: async (p, { key }, s) => { await p.keyboard.press(key); await sleep(500); return snapshot(s, p); },
  upload: async (p, { paths, ...a }, s) => {
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), locate(p, a).click()]);
    await chooser.setFiles(paths);
    await sleep(1500);
    return snapshot(s, p);
  },
  read: async (p, a) => hasTarget(a) ? locate(p, a).innerText() : p.locator('body').innerText(),
  wait: async (p, { seconds, until_text }, s) => {
    if (until_text) await p.getByText(until_text).first().waitFor({ timeout: seconds * 1000 }).catch(() => {});
    else await sleep(seconds * 1000);
    return snapshot(s, p);
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

// Saved shortcuts: { name: { description, params: { param: description }, steps: [{ action, ...args }] } }.
// "{{param}}" in any step string is replaced by the argument.
const readShortcuts = site => existsSync(site.shortcutFile) ? JSON.parse(readFileSync(site.shortcutFile, 'utf8')) : {};

async function runSteps(site, steps, args) {
  const fill = v => typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => args[k] ?? '')
    : Array.isArray(v) ? v.map(fill) : v;
  const p = await getPage(site);
  const reads = [];
  let last = '';
  for (const [i, { action, ...a }] of steps.entries()) {
    try {
      if (!actions[action]) throw new Error(`unknown action "${action}"`);
      last = await actions[action](p, Object.fromEntries(Object.entries(a).map(([k, v]) => [k, fill(v)])), site);
    } catch (e) {
      throw new Error(`Step ${i + 1} (${action}) failed: ${e.message}\nThe site may have changed: do it with the web_* tools, then save the shortcut again.`);
    }
    if (action === 'read') reads.push(last);
  }
  return reads.length ? reads.join('\n\n') : last;
}

// MCP server.

const server = new McpServer({ name: 'anysite', version: '0.1.0' }, {
  instructions: 'Use websites through a real Chrome that is signed in as the user; each site has its own browser profile. ' +
    'Call web_snapshot first, then act on elements by role and name from it, and snapshot again after each action. ' +
    'Pass `site` as a site name or a domain: any domain works, not only the ones already set up. ' +
    'If a page asks the user to sign in, call web_login and wait for the user to say they are done. ' +
    'Prefer a site\'s own tools (named <site>_...) when one fits. When a sequence of steps works and is likely to be ' +
    'wanted again, save it with web_save_shortcut so it becomes one tool.' });

const tool = (name, description, schema, fn) => server.registerTool(name, { description, inputSchema: schema },
  async args => {
    try { const r = await fn(args); return typeof r === 'string' ? text(r) : r; }
    catch (e) { return { ...text(`Error: ${e.message}`), isError: true }; }
  });

const shortcutTools = new Map();
function addShortcut(site, name, sc) {
  const key = `${site.prefix}_${name}`;
  shortcutTools.get(key)?.remove();
  shortcutTools.set(key, tool(key, `${sc.description} (saved shortcut for ${site.name})`,
    Object.fromEntries(Object.entries(sc.params || {}).map(([k, d]) => [k, z.string().describe(d)])),
    a => runSteps(site, sc.steps, a)));
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
      tool(`${site.prefix}_${n}`, t.description, t.input || {}, async a => t.run(await getPage(site), a, site));
    for (const [n, sc] of Object.entries(readShortcuts(site))) addShortcut(site, n, sc);
  }
  return site;
}

const siteArg = z.string().optional().describe('Site name or domain, e.g. gemini or github.com. Optional when only one site is in use.');
const web = (name, description, schema, fn) => tool(`web_${name}`, description, { site: siteArg, ...schema },
  async ({ site, ...a }) => { const s = await useSite(site); return fn(await getPage(s), a, s); });

web('snapshot', 'Accessibility tree of the site\'s current page: roles, names and text of every element. ' +
  'Give role/name to show only that part of the page.', target, actions.snapshot);
web('open', 'Go to a URL (absolute, or relative to the site; default: the site\'s home) and return the snapshot.',
  { url: z.string().optional() }, actions.open);
web('click', 'Click an element found by role/name (or text). Returns the new snapshot.', target, actions.click);
web('type', 'Fill a text field found by role/name (or label/placeholder), optionally pressing Enter.',
  { ...target, value: z.string(), submit: z.boolean().optional() }, actions.type);
web('press', 'Press a key or chord on the focused element, e.g. Enter, Escape, Tab.', { key: z.string() }, actions.press);
web('upload', 'Click an element that opens a file picker (e.g. an upload button) and give it local files.',
  { ...target, paths: z.array(z.string()) }, actions.upload);
web('read', 'Visible text of the page (or of one element), e.g. to read a full reply.', target, actions.read);
web('wait', 'Wait for the page to settle, e.g. while something is generating.',
  { seconds: z.number().min(0).max(120), until_text: z.string().optional().describe('Stop early once this text appears') },
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
    await login(s);
    return `A Chrome window opened on ${s.url}. Ask the user to sign in there, then quit that window ` +
      '(Cmd+Q on a Mac, close all its windows elsewhere) and tell you. The login is kept for next time.';
  });

const stepNames = Object.keys(actions);
tool('web_save_shortcut', 'Save a sequence of steps that worked as a new tool named <site>_<name>, available now and in ' +
  'later sessions. Each step is { action, ...arguments of the web_<action> tool }, e.g. ' +
  '{"action":"type","role":"textbox","name":"Search","value":"{{query}}","submit":true}. "{{param}}" is replaced by ' +
  'the argument. The tool returns the text of its "read" steps, or the last step\'s result if there are none. ' +
  'Saving under an existing name replaces it.',
  { site: z.string(), name: z.string().regex(/^[a-z][a-z0-9_]*$/), description: z.string(),
    params: z.record(z.string(), z.string()).optional().describe('Parameter name -> description'),
    steps: z.array(z.object({ action: z.enum(stepNames) }).catchall(z.any())).min(1)
      .describe(`Actions: ${stepNames.join(', ')}`) },
  async ({ site, name, ...sc }) => {
    const s = await useSite(site);
    const all = { ...readShortcuts(s), [name]: sc };
    mkdirSync(join(HOME, 'sites'), { recursive: true });
    writeFileSync(s.shortcutFile, JSON.stringify(all, null, 2) + '\n');
    addShortcut(s, name, sc);
    return `Saved ${s.prefix}_${name} in ${s.shortcutFile}.`;
  });

tool('web_delete_shortcut', 'Delete a saved shortcut.', { site: z.string(), name: z.string() }, async ({ site, name }) => {
  const s = await useSite(site);
  const all = readShortcuts(s);
  if (!all[name]) throw new Error(`No shortcut "${name}" for ${s.name}. Saved: ${Object.keys(all).join(', ') || 'none'}`);
  delete all[name];
  writeFileSync(s.shortcutFile, JSON.stringify(all, null, 2) + '\n');
  shortcutTools.get(`${s.prefix}_${name}`)?.remove();
  shortcutTools.delete(`${s.prefix}_${name}`);
  return `Deleted ${s.prefix}_${name}.`;
});

// CLI.

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '--help' || cmd === '-h') {
  console.log(`anysite-mcp [site ...]   Serve MCP over stdio. Sites are pack names (${packNames().join(', ')}) or domains.
                         With none, serves every site you have signed in to.
anysite-mcp login <site> Open the site in its own Chrome profile to sign in once.
Data: ${HOME}`);
  process.exit(0);
}
if (cmd === 'login') {
  if (!rest[0]) { console.error('Usage: anysite-mcp login <site>'); process.exit(1); }
  const site = await loadSite(rest[0]);
  await login(site);
  console.log(`Sign in to ${site.name} in the window that opened, then quit that window (Cmd+Q on a Mac).`);
  process.exit(0);
}
const profiles = join(HOME, 'profiles');
for (const s of cmd ? [cmd, ...rest] : existsSync(profiles) ? readdirSync(profiles).filter(d => !d.startsWith('.')) : [])
  await useSite(s);
await server.connect(new StdioServerTransport());
