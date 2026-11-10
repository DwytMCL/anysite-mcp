import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ANYSITE_HOME = mkdtempSync(join(tmpdir(), 'anysite-sc-'));
const { checkShortcut, doctorArgs, fillFrom, paramSpec } = await import('../lib/shortcuts.js');

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
