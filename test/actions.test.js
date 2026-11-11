import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'anysite-actions-'));
process.env.ANYSITE_HOME = home;
test.after(() => rmSync(home, { recursive: true, force: true }));
const { actions, extractRows, extractText, fieldValue, settled, STEP_NAMES } = await import('../lib/actions.js');

/** @type {(v: any) => any} */
const any = v => v;
const site = { name: 'shop.test', url: 'https://shop.test/' };
// A stand-in for a locator over a list of values: count, nth, first and the reads actions use.
const many = (vals, attrs = {}) => ({
  count: async () => vals.length, first: () => many(vals.slice(0, 1), attrs), waitFor: async () => {},
  nth: i => ({ count: async () => (i < vals.length ? 1 : 0), innerText: async () => vals[i], getAttribute: async a => attrs[a] ?? null,
    evaluate: async () => vals[i] }),
  innerText: async () => vals[0],
});

test('every action is a step name', () => {
  assert.deepEqual(STEP_NAMES, ['snapshot', 'open', 'click', 'type', 'select', 'press', 'upload', 'read', 'extract', 'wait', 'download']);
});

test('settled waits for a page load only when the main frame navigated', async () => {
  const handlers = new Set(), waited = [];
  const frame = {};
  const p = { mainFrame: () => frame, on: (_e, f) => handlers.add(f), off: (_e, f) => handlers.delete(f),
    waitForLoadState: async s => { waited.push(s); } };
  await settled(p, async () => {}, 1);
  assert.deepEqual(waited, []);
  await settled(p, async () => { for (const h of handlers) h(frame); }, 1);
  assert.deepEqual(waited, ['load', 'networkidle']);
  assert.equal(handlers.size, 0, 'the listener is removed');
  await assert.rejects(settled(p, async () => { throw new Error('boom'); }, 1), /boom/);
  assert.equal(handlers.size, 0, 'and also when fn throws');
});

test('fieldValue: no target reads the row; nth picks; the first non-empty match wins', async () => {
  assert.equal(await fieldValue(many(['  a   b ']).nth(0), {}), 'a b');
  assert.equal(await fieldValue(many(['x']).nth(0), {}, 'href'), null);
  const row = vals => ({ getByRole: () => many(vals, { href: '/x' }) });
  assert.equal(await fieldValue(row(['', 'Title']), { role: 'link' }), 'Title');
  assert.equal(await fieldValue(row(['one', 'two']), { role: 'link', nth: 1 }), 'two');
  assert.equal(await fieldValue(row(['one']), { role: 'link', nth: 5 }), null);
  assert.equal(await fieldValue(row([]), { role: 'link' }), null);
  assert.equal(await fieldValue(row(['Title']), { role: 'link' }, 'href'), '/x');
});

test('extractRows: plain rows, field rows, limit, and the notes', async () => {
  const plain = { getByRole: () => many([{ text: 'a', link: 'u' }, { text: 'b' }, { text: 'c' }]) };
  assert.deepEqual(await extractRows(plain, any({ role: 'listitem', limit: 2 })), { rows: [{ text: 'a', link: 'u' }, { text: 'b' }] });
  const none = { getByRole: () => many([]) };
  assert.match((await extractRows(none, any({ role: 'listitem' }))).note, /nothing matched/);
  const withFields = { getByRole: () => ({ ...many(['r1']), nth: () => ({ getByRole: () => many(['']) }) }) };
  const r = await extractRows(withFields, { role: 'listitem', fields: { t: { role: 'link' } } });
  assert.match(r.note, /"t" came back empty on every row/);
  await assert.rejects(extractRows(plain, { role: 'listitem', fields: { t: { role: 'nonsense' } } }), /field role/);
});

test('extractText: JSON rows, with the note after them', () => {
  assert.equal(extractText({ rows: [{ a: 1 }] }), '[\n  {\n    "a": 1\n  }\n]');
  assert.match(extractText({ rows: [], note: 'hm' }), /\n\nNote: hm$/);
});

test('open: goes to an allowed URL and refuses one outside the allowed domains', async () => {
  const went = [];
  const p = { goto: async u => { went.push(u); }, url: () => 'https://shop.test/x', waitForLoadState: async () => {},
    getByRole: () => ({}), locator: () => ({ ariaSnapshot: async () => '- page' }), ariaSnapshot: async () => '- page' };
  await assert.rejects(actions.open(p, { url: 'https://evil.test/' }, site), /evil\.test is outside the domains allowed for shop\.test[\s\S]*permissions shop\.test --allow evil\.test/);
  assert.deepEqual(went, []);
  await actions.open(p, { url: '/a', show: 'none' }, site).catch(() => {});
  assert.deepEqual(went, ['https://shop.test/a']);
});

test('read: the body text, or the matched element', async () => {
  const body = { locator: s => (s === 'body' ? many(['whole page']) : null) };
  assert.equal(await actions.read(body, {}), 'whole page');
  const target = { getByRole: () => many(['bit']) };
  assert.equal(await actions.read(target, { role: 'main' }), 'bit');
});

test('wait: until_text fails with a clear message; seconds reports progress', async () => {
  const p = { getByText: () => ({ first: () => ({ waitFor: async () => { throw new Error('timeout'); } }) }) };
  await assert.rejects(actions.wait(p, any({ seconds: 1, until_text: 'Done' }), site), /"Done" did not appear within 1 s/);
});

test('download: saves under save_dir with the suggested name', async () => {
  const dir = join(home, 'dl');
  const saved = [];
  const p = { waitForEvent: async () => ({ suggestedFilename: () => 'a.pdf', saveAs: async f => { saved.push(f); } }),
    getByRole: () => ({ first: () => ({ click: async () => {} }) }) };
  assert.equal(await actions.download(p, { save_dir: dir, role: 'link', name: 'PDF' }), `Saved ${join(dir, 'a.pdf')}`);
  assert.deepEqual(saved, [join(dir, 'a.pdf')]);
  assert.ok(existsSync(dir));
});
