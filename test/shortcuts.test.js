import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ANYSITE_HOME = mkdtempSync(join(tmpdir(), 'anysite-sc-'));
const { checkShortcut, doctorArgs, fillFrom, paramSpec, readShortcuts, shortcutAnnotations } = await import('../lib/shortcuts.js');

test('checkShortcut: accepts a good shortcut', () => {
  assert.doesNotThrow(() => checkShortcut({ params: { q: 'Query' }, steps: [
    { action: 'open', url: '/' },
    { action: 'type', role: 'textbox', name: 'Search', value: '{{q}}', submit: true },
    { action: 'extract', role: 'listitem', fields: { title: { role: 'link' } } }] }));
});

test('checkShortcut: refuses what would only fail when run', () => {
  assert.throws(() => checkShortcut({ steps: [] }), /needs a list of steps/);
  assert.throws(() => checkShortcut({}), /needs a list of steps/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'eval', code: 'x' }] }), /Step 1 \(eval\): use one of snapshot, open, click/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'click', ref: 'e12' }] }), /refs like "e12" only last/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'click', role: 'buton' }] }), /Step 1 \(click\): unknown role "buton"; did you mean "button"/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'read', within: 'dialgo' }] }), /unknown within role/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'extract', role: 'row', fields: { a: { role: 'lnk' } } }] }), /unknown field role "lnk"/);
  assert.throws(() => checkShortcut({ steps: [{ action: 'open', url: '/' }, { action: 'type', role: 'textbox', value: '{{q}}' }] }),
    /Step 2 \(type\) uses \{\{q\}\}, which is not in params/);
});

test('paramSpec: a string is a description; an object is kept', () => {
  assert.deepEqual(paramSpec('Query'), { description: 'Query' });
  assert.deepEqual(paramSpec({ description: 'N', type: 'number' }), { description: 'N', type: 'number' });
  assert.deepEqual(paramSpec(undefined), {});
});

test('fillFrom: fills {{params}} everywhere, with defaults and optional params', () => {
  const fill = fillFrom({ q: 'Query', n: { description: 'N', default: 3 }, o: { description: 'O', optional: true } }, { q: 'kiwi' });
  assert.deepEqual(fill({ value: 'find {{q}} x{{n}}{{o}}', fields: [{ name: '{{q}}' }], nth: 1, exact: true }),
    { value: 'find kiwi x3', fields: [{ name: 'kiwi' }], nth: 1, exact: true });
  assert.equal(fillFrom({ n: { description: 'N', type: 'number' } }, { n: 0 })('{{n}}'), '0', 'falsy values count');
  assert.throws(() => fillFrom({ q: 'Query' }, {})('{{q}}'), /missing argument "q"/);
});

test('doctorArgs: optional params stay empty, so doctor opens the page a user gets by leaving them out', () => {
  const params = { q: 'Query', n: { description: 'How many', type: 'number', default: 5 }, language: { description: 'Language', optional: true } };
  assert.deepEqual(doctorArgs(params), { q: 'test', n: 5, language: undefined });
  assert.equal(fillFrom(params, doctorArgs(params))('https://github.com/trending/{{language}}?since=daily'), 'https://github.com/trending/?since=daily');
  assert.deepEqual(doctorArgs(undefined), {});
});

test('shortcutAnnotations: read-only if every step only looks, destructive if one acts on the page', () => {
  assert.deepEqual(shortcutAnnotations({ steps: [{ action: 'open', url: '/' }, { action: 'snapshot' }, { action: 'wait', seconds: 1 },
    { action: 'read' }, { action: 'extract', role: 'row' }] }), { readOnlyHint: true });
  for (const action of ['click', 'type', 'select', 'press', 'upload'])
    assert.deepEqual(shortcutAnnotations({ steps: [{ action: 'open' }, { action }] }),
      { readOnlyHint: false, destructiveHint: true }, action);
  assert.deepEqual(shortcutAnnotations({ steps: [{ action: 'open' }, { action: 'download', role: 'link' }] }),
    { readOnlyHint: false, destructiveHint: false });
  assert.deepEqual(shortcutAnnotations({ steps: [{ action: 'download' }, { action: 'click' }] }),
    { readOnlyHint: false, destructiveHint: true });
});

test('readShortcuts: a corrupt file is named in the error', () => {
  const shortcutFile = join(process.env.ANYSITE_HOME, 'broken.json');
  writeFileSync(shortcutFile, '{ not json');
  assert.throws(() => readShortcuts({ shortcutFile }), err => err instanceof Error && err.message.includes(shortcutFile) && /not valid JSON/.test(err.message));
  assert.deepEqual(readShortcuts({ shortcutFile: join(process.env.ANYSITE_HOME, 'missing.json') }), {});
});

test('cli: a failing command prints a message, not a stack trace', () => {
  const home = mkdtempSync(join(tmpdir(), 'anysite-cli-'));
  writeFileSync(join(home, 'settings.json'), '{ not json');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url)), 'permissions', 'example.com', '--read-only'],
    { env: { ...process.env, ANYSITE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.doesNotMatch(r.stderr, /\n\s+at \S/);
});
