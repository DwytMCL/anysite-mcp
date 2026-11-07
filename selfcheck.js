// Serves a small test page on localhost, starts the server on it with a throwaway data dir and a headless
// Chrome, and checks snapshots, refs, change-only results, shortcuts and their checks. Needs no network.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = `<!doctype html><title>Test shop</title><h1>Test shop</h1>
<label>Search <input name="q"></label>
<button onclick="document.querySelector('#out').textContent = 'Results for ' + document.querySelector('input').value">Go</button>
<p id="out"></p><ul><li>Apples</li><li>Pears</li></ul><a href="/about">About</a>`;
const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url === '/about' ? '<title>About</title><main><p>About this shop</p></main>' : PAGE);
}).listen(0, '127.0.0.1');
await new Promise(r => http.once('listening', r));
const site = `localhost:${http.address().port}`;

const home = mkdtempSync(join(tmpdir(), 'anysite-'));
const c = new Client({ name: 'selfcheck', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('./server.js', import.meta.url)), 'gemini', site],
  env: { ...process.env, ANYSITE_HOME: home, ANYSITE_HEADLESS: '1' } }));
const raw = (name, args) => c.callTool({ name, arguments: args });
const call = async (name, args) => { const r = await raw(name, args); assert(!r.isError, r.content[0].text); return r.content[0].text; };
const fails = async (name, args, re) => { const r = await raw(name, args); assert(r.isError, `${name} should fail`); assert.match(r.content[0].text, re); };

try {
  const names = (await c.listTools()).tools.map(t => t.name);
  for (const n of ['web_snapshot', 'web_save_shortcut', 'web_list_shortcuts', 'gemini_ask', 'gemini_list_chats']) assert(names.includes(n), n);

  // Full snapshot with refs, then a click by ref returns only what changed.
  const snap = await call('web_open', { site, url: '/' });
  assert.match(snap, /heading "Test shop"/);
  const ref = snap.match(/button "Go" \[ref=(\w*e\d+)\]/)[1];
  await call('web_type', { site, role: 'textbox', name: 'Search', value: 'kiwi' });
  const changed = await call('web_click', { site, ref });
  assert.match(changed, /Changed since the last snapshot/);
  assert.match(changed, /Results for kiwi/);
  assert.doesNotMatch(changed, /Pears/, 'unchanged lines are left out');

  // Loud failures.
  await fails('web_wait', { site, seconds: 1, until_text: 'Never shown' }, /did not appear/);
  await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'click', ref }] }, /refs/);
  await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'open', url: '/{{page}}' }] }, /not in params/);
  await fails('web_save_shortcut', { site, name: 'bad', description: 'x',
    steps: [{ action: 'open', url: '/', expect: 'Not on the page' }] }, /expected "Not on the page"/);
  assert(!(await c.listTools()).tools.some(t => t.name === 'localhost_bad'), 'failed test run saves nothing');

  // A shortcut is tried before saving, then works as its own tool.
  const saved = await call('web_save_shortcut', { site, name: 'search', description: 'Search the shop',
    params: { query: 'What to look for' }, test_args: { query: 'figs' },
    steps: [{ action: 'open', url: '/' }, { action: 'type', role: 'textbox', name: 'Search', value: '{{query}}' },
      { action: 'click', role: 'button', name: 'Go', expect: 'Results for {{query}}' }, { action: 'read', text: 'Results for' }] });
  assert.match(saved, /Test run worked/);
  assert.equal(await call('localhost_search', { query: 'plums' }), 'Results for plums');
  assert.match(await call('web_list_shortcuts', { site }), /localhost_search: Search the shop/);
  await call('web_delete_shortcut', { site, name: 'search' });
  console.log('ok');
} finally {
  await c.close();
  http.close();
  const port = readFileSync(join(home, 'profiles/localhost/DevToolsActivePort'), 'utf8').split('\n')[0];
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  setTimeout(() => rmSync(home, { recursive: true, force: true }), 2000);
}
