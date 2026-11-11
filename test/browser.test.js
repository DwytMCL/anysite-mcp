import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPack, chromeCandidates, launchArgs, PACK_API } from '../lib/browser.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const none = () => [];

test('win32: the usual Chrome installs, with default Program Files folders', () => {
  const c = chromeCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
    home: 'C:\\Users\\me', listDir: none });
  assert.deepEqual(c, [
    'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]);
});

test('win32: PROGRAMFILES and PROGRAMFILES(X86) are used when set', () => {
  const c = chromeCandidates({ platform: 'win32', env: { PROGRAMFILES: 'D:\\Apps', 'PROGRAMFILES(X86)': 'D:\\Apps32' },
    home: 'C:\\Users\\me', listDir: none });
  assert.deepEqual(c, ['D:\\Apps\\Google\\Chrome\\Application\\chrome.exe', 'D:\\Apps32\\Google\\Chrome\\Application\\chrome.exe']);
});

test('win32: Playwright downloads under %LOCALAPPDATA%\\ms-playwright', () => {
  const root = 'C:\\Users\\me\\AppData\\Local\\ms-playwright';
  const c = chromeCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, home: 'C:\\Users\\me',
    listDir: d => d === root ? ['chromium-1200'] : [] });
  assert(c.includes(`${root}\\chromium-1200\\chrome-win64\\chrome.exe`), c.join('\n'));
});

test('darwin: /Applications and ~/Library/Caches/ms-playwright', () => {
  const root = '/Users/me/Library/Caches/ms-playwright';
  const c = chromeCandidates({ platform: 'darwin', env: {}, home: '/Users/me',
    listDir: d => d === root ? ['chromium-1100', 'chromium-1200', 'ffmpeg-1011'] : [] });
  assert.deepEqual(c.slice(0, 2), ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium']);
  const arm = rev => `${root}/chromium-${rev}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  assert(c.includes(arm(1200)) && c.includes(arm(1100)), c.join('\n'));
  assert(c.indexOf(arm(1200)) < c.indexOf(arm(1100)), 'newest revision first');
  assert(!c.some(p => p.includes('ffmpeg')));
  assert(!c.some(p => p.includes('\\')), 'POSIX paths');
});

test('linux: /usr/bin and ~/.cache/ms-playwright', () => {
  const root = '/home/me/.cache/ms-playwright';
  const c = chromeCandidates({ platform: 'linux', env: {}, home: '/home/me', listDir: d => d === root ? ['chromium-9', 'chromium-10'] : [] });
  assert.equal(c[0], '/usr/bin/google-chrome');
  assert(c.includes('/snap/bin/chromium'));
  assert(c.indexOf(`${root}/chromium-10/chrome-linux64/chrome`) < c.indexOf(`${root}/chromium-9/chrome-linux64/chrome`),
    'sorted by number, not as text');
});

test('ANYSITE_CHROME comes first, then PLAYWRIGHT_BROWSERS_PATH is searched', () => {
  const c = chromeCandidates({ platform: 'linux', env: { ANYSITE_CHROME: '/opt/my/chrome', PLAYWRIGHT_BROWSERS_PATH: '/pw' },
    home: '/home/me', listDir: d => d === '/pw' ? ['chromium-1'] : [] });
  assert.equal(c[0], '/opt/my/chrome');
  assert(c.includes('/pw/chromium-1/chrome-linux/chrome'));
});

test('launchArgs: own profile, and the field-trial testing config off so Chromium builds load their first page', () => {
  const args = launchArgs({ profile: '/data/profiles/shop' }, ['https://shop.test/']);
  assert.equal(args[0], '--user-data-dir=/data/profiles/shop');
  assert(args.includes('--disable-field-trial-config'));
  assert.equal(args.at(-1), 'https://shop.test/');
});

test('checkPack: no version means 1, and version 1 is accepted', () => {
  assert.equal(PACK_API, 1);
  const bare = { url: 'https://x.test/' };
  assert.equal(checkPack(bare, 'x.js'), bare);
  assert.equal(checkPack({ version: 1 }, 'x.js').version, 1);
});

test('checkPack: a later version is refused with the file named and an update hint', () => {
  assert.throws(() => checkPack({ version: 2 }, 'x.js'), /x\.js is pack API version 2, written for a newer anysite-mcp.*Update/);
});

test('checkPack: a bad version or a non-object is refused', () => {
  for (const p of [{ version: 0 }, { version: '1' }, { version: 1.5 }, null])
    assert.throws(() => checkPack(p, 'x.js'), /x\.js must return an object/);
});

test('the built-in packs declare version 1 and only the documented tool fields', async () => {
  const dir = fileURLToPath(new URL('../sites/', import.meta.url));
  const kit = new Proxy({}, { get: () => () => {} });
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const pack = checkPack((await import(pathToFileURL(dir + f).href)).default({ z, kit }), f);
    assert.equal(pack.version, 1, f);
    assert.match(pack.url, /^https:/, f);
    for (const [n, t] of Object.entries(pack.tools)) {
      assert.equal(typeof t.run, 'function', `${f} ${n}`);
      assert.equal(typeof t.description, 'string', `${f} ${n}`);
      for (const k of Object.keys(t)) assert(['description', 'input', 'run', 'readOnly', 'writes'].includes(k), `${f} ${n}: ${k}`);
    }
  }
});
