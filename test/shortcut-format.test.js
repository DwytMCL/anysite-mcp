import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const home = mkdtempSync(join(tmpdir(), 'anysite-format-'));
process.env.ANYSITE_HOME = home;
mkdirSync(join(home, 'sites'));
const { addShortcuts, checkShortcut, doctorArgs, parseShortcuts, readShortcuts, SHORTCUTS_SCHEMA, writeShortcuts } = await import('../lib/shortcuts.js');
const { STEP_NAMES } = await import('../lib/actions.js');
const { healthFor } = await import('../lib/library.js');
const { healthEntries, signInNames, fileHashes } = await import('../scripts/library-health.js');
const { indexEntries } = await import('../shortcuts-library/build.js');

const fixtures = fileURLToPath(new URL('./fixtures/shortcut-formats/', import.meta.url));
const fixture = n => readFileSync(join(fixtures, n), 'utf8');
// A site whose file is a copy of a fixture, so a test can write to it.
let n = 0;
const siteWith = name => {
  const shortcutFile = join(home, 'sites', `s${++n}.json`);
  copyFileSync(join(fixtures, name), shortcutFile);
  return { name: `s${n}`, shortcutFile };
};
const bak = site => site.shortcutFile.replace(/\.json$/, '.v0.bak');
const extra = { description: 'New', steps: [{ action: 'read' }] };

test('version 0: a plain map is read as it is', () => {
  assert.deepEqual(Object.keys(readShortcuts(siteWith('v0.json'))), ['find']);
});

test('version 0: a shortcut called "shortcuts" is still a version 0 file', () => {
  const site = siteWith('v0-named-shortcuts.json');
  assert.deepEqual(parseShortcuts(fixture('v0-named-shortcuts.json'), 'x').version, 0);
  assert.deepEqual(Object.keys(readShortcuts(site)), ['shortcuts']);
});

test('version 1: the envelope is unwrapped', () => {
  const sc = readShortcuts(siteWith('v1.json'));
  assert.deepEqual(Object.keys(sc), ['find']);
  assert.equal(sc.find.params.q.example, 'kiwi');
});

test('loading never rewrites a version 0 file or makes a backup', () => {
  const site = siteWith('v0.json');
  readShortcuts(site);
  assert.equal(readFileSync(site.shortcutFile, 'utf8'), fixture('v0.json'));
  assert.equal(existsSync(bak(site)), false);
});

test('the first write to a version 0 file keeps it as <name>.v0.bak and writes version 1', () => {
  const site = siteWith('v0.json');
  writeShortcuts(site, { ...readShortcuts(site), extra });
  assert.equal(readFileSync(bak(site), 'utf8'), fixture('v0.json'));
  const written = JSON.parse(readFileSync(site.shortcutFile, 'utf8'));
  assert.equal(written.version, 1);
  assert.equal(written.$schema, SHORTCUTS_SCHEMA);
  assert.deepEqual(Object.keys(written.shortcuts), ['find', 'extra']);
});

test('writing to a version 1 file makes no backup and keeps its content', () => {
  const site = siteWith('v1.json');
  writeShortcuts(site, { ...readShortcuts(site), extra });
  assert.equal(existsSync(bak(site)), false);
  assert.deepEqual(Object.keys(readShortcuts(site)), ['find', 'extra']);
});

test('a file with no content yet is written without a backup', () => {
  const shortcutFile = join(home, 'sites', 'fresh.json');
  writeShortcuts({ name: 'fresh', shortcutFile }, { extra });
  assert.equal(existsSync(bak({ shortcutFile })), false);
  assert.equal(JSON.parse(readFileSync(shortcutFile, 'utf8')).version, 1);
});

test('a newer version is refused when read, and never rewritten', () => {
  const site = siteWith('v2.json');
  assert.throws(() => readShortcuts(site), /version 2, written for a newer anysite-mcp/);
  assert.throws(() => writeShortcuts(site, { extra }), /written for a newer anysite-mcp/);
  assert.equal(readFileSync(site.shortcutFile, 'utf8'), fixture('v2.json'));
  assert.equal(existsSync(bak(site)), false);
});

test('a malformed envelope is refused with the file named', () => {
  for (const text of ['{"version":1}', '{"version":1,"shortcuts":[]}', '{"version":0,"shortcuts":{}}', '{"version":1.5,"shortcuts":{}}', '[]'])
    assert.throws(() => parseShortcuts(text, 'f.json'), /f\.json/);
});

test('add takes a version 0 map or a version 1 envelope as its source', async () => {
  for (const f of ['v0.json', 'v1.json']) {
    const site = { name: 'x', shortcutFile: join(home, 'sites', `add-${f}`) };
    const r = await addShortcuts(site, { from: join(fixtures, f), only: undefined, force: false });
    assert.deepEqual(r.added, ['find']);
    assert.deepEqual(Object.keys(readShortcuts(site)), ['find']);
  }
});

test('doctorArgs: an example comes before the default, and counts for an optional param too', () => {
  assert.deepEqual(doctorArgs({ a: { description: 'A', example: 'ex', default: 'dflt' }, b: { description: 'B', default: 'dflt' },
    c: { description: 'C', optional: true, example: 'kiwi' }, d: { description: 'D', optional: true }, e: 'E' }),
  { a: 'ex', b: 'dflt', c: 'kiwi', d: undefined, e: 'test' });
});

test('checkShortcut: needsSignIn must be a boolean', () => {
  assert.doesNotThrow(() => checkShortcut({ needsSignIn: true, steps: [{ action: 'read' }] }));
  assert.throws(() => checkShortcut({ needsSignIn: 'yes', steps: [{ action: 'read' }] }), /needsSignIn must be true or false/);
});

test('needsSignIn: unchecked in the health file, flagged in the index, "needs sign-in" in the badge', () => {
  const data = { a: { description: 'A', steps: [{ action: 'read' }] }, b: { description: 'B', needsSignIn: true, steps: [{ action: 'read' }, { action: 'snapshot' }] } };
  assert.deepEqual(signInNames(data), ['b']);
  const hashes = fileHashes(data);
  const entries = healthEntries('example.com', hashes, [{ name: 'a', status: 'ok', detail: '' }, { name: 'b', status: 'broken', detail: 'not signed in' }], undefined, ['b']);
  assert.equal(entries['example.com/b'].status, 'unchecked');
  assert.equal(entries['example.com/a'].status, 'ok');
  const failed = healthEntries('example.com', hashes, [], 'Could not start Chrome', ['b']);
  assert.equal(failed['example.com/b'].status, 'unchecked');
  const idx = indexEntries('example.com', data);
  assert.equal(idx[0].needsSignIn, undefined);
  assert.equal(idx[1].needsSignIn, true);
  const h = healthFor(idx[1], { checked: '2026-11-10T00:00:00Z', shortcuts: entries }, new Date('2026-11-11T00:00:00Z'));
  assert.deepEqual([h.status, h.label, h.checked], ['unchecked', 'needs sign-in, not checked', null]);
});

test('the JSON Schema lists the same actions as the code, and every fixture matches its shape', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/shortcuts.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.$defs.step.properties.action.enum, STEP_NAMES);
  assert.equal(schema.$id, SHORTCUTS_SCHEMA);
  assert.equal(schema.properties.version.const, 1);
  for (const f of readdirSync(fixtures).filter(f => f !== 'v2.json')) {
    const { shortcuts } = parseShortcuts(fixture(f), f);
    for (const sc of Object.values(shortcuts)) assert.doesNotThrow(() => checkShortcut(sc));
  }
});
