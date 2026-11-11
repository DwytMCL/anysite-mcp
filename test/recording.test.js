import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'anysite-rec-'));
process.env.ANYSITE_HOME = home;
test.after(() => rmSync(home, { recursive: true, force: true }));
const { startRecording, stopRecording } = await import('../lib/recording.js');
const { addEvent } = await import('../lib/recorder.js');

const fakePage = () => {
  const log = { binding: null, scripts: [], evaluated: 0, front: 0 };
  const page = { isClosed: () => false, url: () => 'https://shop.test/',
    evaluate: async () => { log.evaluated++; }, bringToFront: async () => { log.front++; },
    context: () => ({ exposeBinding: async (_n, fn) => { log.binding = fn; }, addInitScript: async s => { log.scripts.push(s); }, pages: () => [page] }) };
  return { page, log };
};
/** @returns {any} */
const newSite = () => ({ name: 'shop.test', prefix: 'shop_test', shortcutFile: join(home, 'sites', 'shop.test.json') });

test('startRecording begins at the current page and only accepts events carrying its token', async () => {
  const { page, log } = fakePage();
  const site = { ...newSite(), page };
  await startRecording(site);
  assert.deepEqual(site.recording, [{ action: 'open', url: 'https://shop.test/' }]);
  assert.equal(site.recorder, true);
  assert.equal(log.scripts.length, 1);
  assert.equal(log.evaluated, 1);
  assert.equal(log.front, 1);
  log.binding(null, { token: 'wrong', kind: 'click', role: 'button', name: 'Nope' });
  assert.equal(site.recording.length, 1, 'an event from another token is ignored');
  const token = /window.__anysiteRec = "([^"]+)"/.exec(log.scripts[0])?.[1];
  assert.ok(token, 'the init script carries a token');
  log.binding(null, { token, kind: 'click', role: 'button', name: 'Buy' });
  assert.equal(site.recording.length, 2);
  await startRecording(site);
  assert.equal(log.scripts.length, 1, 'the recorder is installed once per site');
});

test('stopRecording refuses when not recording, or when nothing was done', () => {
  assert.throws(() => stopRecording(newSite(), 'x', 'd'), /Not recording on shop\.test/);
  const site = { ...newSite(), recording: [{ action: 'open', url: '/' }] };
  assert.throws(() => stopRecording(site, 'x', 'd'), /Nothing was recorded/);
  assert.equal(site.recording, null);
});

test('stopRecording saves the shortcut with its params', () => {
  const site = { ...newSite(), recording: [{ action: 'open', url: 'https://shop.test/' }] };
  addEvent(site.recording, { kind: 'type', role: 'textbox', name: 'Search', value: 'kiwi', submit: true });
  const sc = stopRecording(site, 'find', 'Find things');
  assert.equal(sc.description, 'Find things');
  assert.equal(sc.steps.length, 2);
  assert.ok(sc.params, 'typed value became a param');
  assert.deepEqual(JSON.parse(readFileSync(site.shortcutFile, 'utf8')).find, sc);
});
