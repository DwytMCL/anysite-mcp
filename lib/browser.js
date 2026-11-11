// Chrome: finding it, starting it with one profile per site, and connecting to it.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { CHROME_ARGS, HEADLESS, HOME, PACK_DIRS, sleep, VERSION } from './config.js';

// Where to look for Chrome, in order: $ANYSITE_CHROME, an installed Google Chrome or Chromium, then every Chromium
// that Playwright has downloaded, newest revision first. Takes the platform and environment so each OS can be tested.
export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir(),
  listDir = d => existsSync(d) ? readdirSync(d) : [] } = {}) {
  const { join } = platform === 'win32' ? win32 : posix;
  const installed = platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : platform === 'win32' ? [env.LOCALAPPDATA, env.PROGRAMFILES || 'C:\\Program Files',
      env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)']
      .filter(Boolean).map(d => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/snap/bin/chromium'];
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'ms-playwright')];
  const bins = ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome',
    'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  const downloaded = roots.filter(Boolean).flatMap(r => listDir(r)
    .filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(d => bins.map(b => join(r, d, b))));
  return [env.ANYSITE_CHROME, ...installed, ...downloaded].filter(Boolean);
}

// Looked up on first use, not at import, so the modules load (in tests, say) on a machine without Chrome.
let chrome;
export const findChrome = () => chrome ??= chromeCandidates().find(p => existsSync(p));
export const NO_CHROME = 'No Chrome found. Install Google Chrome, run `npx playwright install chromium`, or set ANYSITE_CHROME.';

// Chromium and Chrome for Testing builds apply a field-trial testing config that stops them loading the page they
// start on, so the connection never comes up. Playwright turns it off too; branded Chrome ignores the flag.
export const launchArgs = (site, extra) => [`--user-data-dir=${site.profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-field-trial-config', ...CHROME_ARGS, ...extra];
export const launch = (site, extra) => spawn(findChrome(), launchArgs(site, extra), { stdio: 'ignore', detached: true }).unref();

// Sites. "gemini" names a pack (sites/gemini.js, or ~/.anysite-mcp/sites/gemini.js to add or override one);
// "github.com" or a URL is any site. The name keys the site's profile, tools and saved shortcuts.

export const packNames = () => [...new Set(PACK_DIRS.filter(existsSync)
  .flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3))))];

// The pack API version this server speaks. A pack with no `version` is version 1.
export const PACK_API = 1;
export function checkPack(pack, file) {
  const v = pack?.version ?? 1;
  if (!pack || typeof pack !== 'object' || !Number.isInteger(v) || v < 1)
    throw new Error(`The pack ${file} must return an object, and its "version" (if any) a whole number from 1.`);
  if (v > PACK_API) throw new Error(`The pack ${file} is pack API version ${v}, written for a newer anysite-mcp than this one ` +
    `(${VERSION}, which reads up to version ${PACK_API}). Update: npx -y anysite-mcp@latest.`);
  return pack;
}

export const sites = new Map();
export async function loadSite(arg) {
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(arg) ? 'http' : 'https';
  const url = /[.:/]/.test(arg) ? new URL(/^https?:\/\//.test(arg) ? arg : `${scheme}://${arg}`) : null;
  const name = url ? url.hostname.replace(/^www\./, '') : arg.toLowerCase();
  if (sites.has(name)) return sites.get(name);
  if (!url && !/^[a-z0-9_-]+$/.test(name)) throw new Error(`Bad site name "${arg}".`);
  const file = PACK_DIRS.map(d => join(d, `${name}.js`)).find(existsSync);
  const pack = file ? checkPack((await import(pathToFileURL(file).href)).default({ z, kit }), file) : {};
  if (!url && !pack.url) throw new Error(`No pack named "${arg}". Give a domain such as github.com, or one of: ${packNames().join(', ')}`);
  const site = { ...pack, name, url: url?.href || pack.url, profile: join(HOME, 'profiles', name),
    shortcutFile: join(HOME, 'sites', `${name}.json`), prefix: name.replace(/[^a-z0-9]+/g, '_') };
  mkdirSync(site.profile, { recursive: true });
  sites.set(name, site);
  return site;
}

// Chrome is started with a debugging port of its choosing, which it writes to the profile. Reconnect
// to it if it is still running (so tabs and state survive server restarts), else start it.
export async function getPage(site) {
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
export async function login(site) {
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

// Helpers handed to packs.
export const kit = {
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
