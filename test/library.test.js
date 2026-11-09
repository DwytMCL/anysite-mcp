import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractMarked, fetchLibrary, formatInfo, formatList, healthFor, searchShortcuts, stepsHash } from '../lib/library.js';

const steps = [{ action: 'open', url: '/?q={{q}}' }, { action: 'extract', role: 'listitem', fields: { a: { role: 'link', attr: 'href' } } }];
const sc = (site, name, description, s = steps) =>
  ({ site, name, tool: `${site.replace(/[^a-z0-9]+/g, '_')}_${name}`, description, params: { q: 'Query' }, steps: s, stepsHash: stepsHash(s) });
const index = { sites: ['example.com', 'github.com'], shortcuts: [
  sc('github.com', 'trending', 'Trending repositories'),
  sc('github.com', 'notifications', 'Your notifications', [{ action: 'open', url: '/notifications' }]),
  sc('example.com', 'search', 'Search Example pages')] };
const now = new Date('2026-11-10T12:00:00Z');
const health = (checked, entries) => ({ checked, shortcuts: entries });

test('stepsHash: key order does not matter, values and step order do', () => {
  const a = stepsHash([{ action: 'type', role: 'textbox', name: 'Q', fields: { x: { role: 'link', attr: 'href' } } }]);
  const b = stepsHash([{ fields: { x: { attr: 'href', role: 'link' } }, name: 'Q', role: 'textbox', action: 'type' }]);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(stepsHash([{ action: 'type', role: 'textbox', name: 'R' }]), stepsHash([{ action: 'type', role: 'textbox', name: 'Q' }]));
  assert.notEqual(stepsHash([{ action: 'read' }, { action: 'open' }]), stepsHash([{ action: 'open' }, { action: 'read' }]));
});

test('healthFor: unchecked, recorded status, changed steps and the 14-day rule', () => {
  const s = index.shortcuts[0];
  assert.equal(healthFor(s, null, now).status, 'unchecked');
  assert.equal(healthFor(s, health('2026-11-09T00:00:00Z', {}), now).status, 'unchecked');
  for (const status of ['ok', 'repaired', 'broken']) {
    const h = healthFor(s, health('2026-11-09T00:00:00Z', { 'github.com/trending': { status, detail: 'd', steps: s.stepsHash } }), now);
    assert.equal(h.status, status);
    assert.equal(h.checked, '2026-11-09T00:00:00Z');
    assert.equal(h.detail, 'd');
  }
  assert.equal(healthFor(s, health('2026-11-09T00:00:00Z', { 'github.com/trending': { status: 'ok', steps: 'aaaaaaaaaaaa' } }), now).status,
    'unchecked', 'an edited shortcut never shows an old result');
  const old = healthFor(s, health('2026-10-26T11:00:00Z', { 'github.com/trending': { status: 'ok', steps: s.stepsHash } }), now);
  assert.equal(old.status, 'stale');
  assert.equal(old.label, 'not recently checked');
  assert.equal(healthFor(s, health('2026-10-27T13:00:00Z', { 'github.com/trending': { status: 'ok', steps: s.stepsHash } }), now).status, 'ok');
  assert.equal(healthFor(s, health(undefined, { 'github.com/trending': { status: 'ok', steps: s.stepsHash } }), now).status, 'stale');
});

test('extractMarked: the text between the markers, whitespace normalized', () => {
  const a = 'x\n// HEALTH_FOR_START\nfunction f() {\n  return 1;\n}\n// HEALTH_FOR_END\ny';
  const b = 'z\r\n    // HEALTH_FOR_START\r\n    function f() {\r\n\r\n      return 1;\r\n    }\r\n    // HEALTH_FOR_END\r\n';
  assert.equal(extractMarked(a), 'function f() {\nreturn 1;\n}');
  assert.equal(extractMarked(a), extractMarked(b));
  assert.throws(() => extractMarked('nothing'), /HEALTH_FOR_START/);
});

test('searchShortcuts: every word must match site, name, description or tool', () => {
  assert.deepEqual(searchShortcuts(index, 'GITHUB trend').map(s => s.name), ['trending']);
  assert.deepEqual(searchShortcuts(index, ['github_com_notif']).map(s => s.name), ['notifications']);
  assert.deepEqual(searchShortcuts(index, 'search example').map(s => s.site), ['example.com']);
  assert.deepEqual(searchShortcuts(index, 'github nothing'), []);
  assert.equal(searchShortcuts(index, '').length, 3);
});

test('formatList and formatInfo: counts, badges and add commands', () => {
  const h = health('2026-11-09T00:00:00Z', { 'github.com/trending': { status: 'broken', detail: 'No link "x"', steps: index.shortcuts[0].stepsHash } });
  assert.match(formatList(index, h, undefined, now), /^example\.com {2}1 shortcut\ngithub\.com {3}2 shortcuts\n/);
  const site = formatList(index, h, 'github.com', now);
  assert.match(site, /✗ broken {11}github_com_trending: Trending repositories\n\s+npx -y anysite-mcp add github\.com\/trending/);
  assert.match(site, /– not checked yet {2}github_com_notifications/);
  assert.match(site, /All of them: npx -y anysite-mcp add github\.com$/);
  assert.throws(() => formatList(index, h, 'nope.org', now), /No shortcuts for nope\.org/);
  const info = formatInfo(index, h, 'github.com/trending', now);
  assert.match(info, /Health: ✗ broken \(checked 2026-11-09\): No link "x"/);
  assert.match(info, /Parameters:\n {2}q: Query/);
  assert.match(info, /Steps:\n {2}1\. \{"action":"open","url":"\/\?q=\{\{q\}\}"\}/);
  assert.match(info, /Add: npx -y anysite-mcp add github\.com\/trending$/);
  assert.equal(formatInfo(index, h, 'github.com', now).split('\n\n').length, 2, 'a site shows all of its shortcuts');
  assert.throws(() => formatInfo(index, h, 'github.com/nope', now), /No shortcut github\.com\/nope/);
});

test('fetchLibrary: a local folder, a missing health file, a missing index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anysite-lib-'));
  await assert.rejects(fetchLibrary(dir), /Couldn't load the Shortcut Library from .*anysite-lib-/);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  const r = await fetchLibrary(dir);
  assert.equal(r.index.shortcuts.length, 3);
  assert.equal(r.health, null);
  writeFileSync(join(dir, 'health.json'), JSON.stringify(health('2026-11-09T00:00:00Z', {})));
  assert.equal((await fetchLibrary(dir)).health.checked, '2026-11-09T00:00:00Z');
});

test('healthFor in shortcuts-library/app.js is the same as in lib/library.js', () => {
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(extractMarked(read('../shortcuts-library/app.js')), extractMarked(read('../lib/library.js')));
});
