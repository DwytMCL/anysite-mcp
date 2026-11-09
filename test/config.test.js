import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const home = mkdtempSync(join(tmpdir(), 'anysite-cfg-'));
const downloads = join(home, 'dl');
process.env.ANYSITE_HOME = home;
process.env.ANYSITE_DOWNLOADS = downloads;
const { DOWNLOADS, HOME, PACK_DIRS, SETTINGS, VERSION } = await import('../lib/config.js');

test('paths are built with path.join, so they use the right separators', () => {
  assert.equal(HOME, home);
  assert.equal(SETTINGS, join(home, 'settings.json'));
  assert.equal(PACK_DIRS[0], join(home, 'sites'));
});

test('the bundled packs folder is a real file path', () => {
  assert(!PACK_DIRS[1].startsWith('file:'), PACK_DIRS[1]);
  assert.equal(PACK_DIRS[1], fileURLToPath(new URL('../sites', import.meta.url)));
  assert(existsSync(join(PACK_DIRS[1], 'gemini.js')));
});

test('ANYSITE_DOWNLOADS is honoured, and the version comes from package.json', () => {
  assert.equal(DOWNLOADS, downloads);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});
