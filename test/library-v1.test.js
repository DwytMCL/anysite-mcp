import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const home = mkdtempSync(join(tmpdir(), 'anysite-libv1-'));
process.env.ANYSITE_HOME = home;
mkdirSync(join(home, 'sites'));
const { build } = await import('../shortcuts-library/build.js');
const { fetchLibrary } = await import('../lib/library.js');
const { addShortcuts, readShortcuts, SHORTCUTS_SCHEMA } = await import('../lib/shortcuts.js');

const libDir = fileURLToPath(new URL('./fixtures/library-compat/', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'anysite-site-'));
build({ libDir, out, health: join(out, 'none.json') });
const lib = join(out, 'library');
const json = p => JSON.parse(readFileSync(p, 'utf8'));

test('the original URLs are unchanged: flat map files and an index with no version field', () => {
  assert.equal(readFileSync(join(lib, 'example.com.json'), 'utf8'), readFileSync(join(libDir, 'example.com.json'), 'utf8'));
  const index = json(join(lib, 'index.json'));
  assert.deepEqual(Object.keys(index), ['generated', 'sites', 'shortcuts']);
  assert.deepEqual(index.shortcuts.map(s => s.name), ['inbox', 'search']);
});

test('v1/ holds envelope files and an index with the same shortcuts', () => {
  assert.deepEqual(readdirSync(join(lib, 'v1')).sort(), ['example.com.json', 'index.json']);
  const file = json(join(lib, 'v1', 'example.com.json'));
  assert.equal(file.version, 1);
  assert.equal(file.$schema, SHORTCUTS_SCHEMA);
  assert.deepEqual(file.shortcuts, json(join(libDir, 'example.com.json')));
  const v1 = json(join(lib, 'v1', 'index.json')), old = json(join(lib, 'index.json'));
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.shortcuts, old.shortcuts);
  assert.equal(v1.shortcuts[0].needsSignIn, true);
});

test('fetchLibrary reads v1/index.json when it is there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anysite-libpick-'));
  mkdirSync(join(dir, 'v1'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ sites: ['old'], shortcuts: [] }));
  writeFileSync(join(dir, 'v1', 'index.json'), JSON.stringify({ version: 1, sites: ['new'], shortcuts: [] }));
  assert.deepEqual((await fetchLibrary(dir)).index.sites, ['new']);
});

test('add without --from reads v1/<site>.json from the library', async () => {
  process.env.ANYSITE_LIBRARY = lib;
  try {
    const site = { name: 'example.com', shortcutFile: join(home, 'sites', 'example.com.json') };
    const r = await addShortcuts(site, { from: undefined, only: undefined, force: false });
    assert.equal(r.src, join(lib, 'v1', 'example.com.json'));
    assert.deepEqual(r.added, ['inbox', 'search']);
    assert.equal(readShortcuts(site).search.params.q.example, 'kiwi');
  } finally { delete process.env.ANYSITE_LIBRARY; }
});
