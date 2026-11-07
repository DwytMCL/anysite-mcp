// Serves a small test shop on localhost, starts the server on it with a throwaway data dir and a headless Chrome,
// and checks snapshots, refs, shortcuts (tested saving, self-repair, typed params), extract, permissions, record
// mode, `add` and `doctor`. Needs no network.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Version 2 of the shop is a "redesign": the search field is renamed and the Go button becomes a link.
let v2 = false;
const page = () => `<!doctype html><title>Test shop</title><h1>Test shop</h1>
<label>${v2 ? 'Product search' : 'Search products'} <input name="q"></label>
<${v2 ? 'a href="#"' : 'button'} onclick="document.querySelector('#out').textContent = 'Results for ' + document.querySelector('input').value">Go</${v2 ? 'a' : 'button'}>
<button onclick="document.querySelector('#out').textContent = 'Sent'">Send message</button>
<p id="out"></p><ul><li>Apples <a href="/apples">more</a></li><li>Pears <a href="/pears">more</a></li></ul><a href="/about">About</a>`;
const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url === '/about' ? '<title>About</title><main><p>About this shop</p></main>' : page());
}).listen(0, '127.0.0.1');
await new Promise(r => http.once('listening', r));
const site = `localhost:${http.address().port}`;

const home = mkdtempSync(join(tmpdir(), 'anysite-'));
const env = { ...process.env, ANYSITE_HOME: home, ANYSITE_HEADLESS: '1' };
const serverJs = fileURLToPath(new URL('./server.js', import.meta.url));
// Async, because this process also serves the test pages.
const cli = async (...args) => (await promisify(execFile)(process.execPath, [serverJs, ...args], { env })).stdout;
const settings = s => writeFileSync(join(home, 'settings.json'), JSON.stringify({ sites: { localhost: s } }));

let answer = 'accept';
const c = new Client({ name: 'selfcheck', version: '0' }, { capabilities: { elicitation: {} } });
c.setRequestHandler(ElicitRequestSchema, () => ({ action: answer }));
await c.connect(new StdioClientTransport({ command: process.execPath, args: [serverJs, 'gemini', site], env }));
const raw = (name, args) => c.callTool({ name, arguments: args });
const call = async (name, args) => { const r = await raw(name, args); assert(!r.isError, r.content[0].text); return r.content[0].text; };
const fails = async (name, args, re) => { const r = await raw(name, args); assert(r.isError, `${name} should fail`); assert.match(r.content[0].text, re); };
const step = (name, fn) => fn().then(() => console.log(`ok  ${name}`));

try {
  await step('tools are listed', async () => {
    const names = (await c.listTools()).tools.map(t => t.name);
    for (const n of ['web_snapshot', 'web_extract', 'web_select', 'web_record', 'web_save_shortcut', 'web_list_shortcuts', 'gemini_ask'])
      assert(names.includes(n), n);
  });

  await step('refs and change-only results', async () => {
    const snap = await call('web_open', { site, url: '/' });
    assert.match(snap, /heading "Test shop"/);
    const ref = snap.match(/button "Go" \[ref=(\w*e\d+)\]/)[1];
    await call('web_type', { site, role: 'textbox', name: 'Search', value: 'kiwi' });
    const changed = await call('web_click', { site, ref });
    assert.match(changed, /Changed since the last snapshot/);
    assert.match(changed, /Results for kiwi/);
    assert.doesNotMatch(changed, /Pears/, 'unchanged lines are left out');
  });

  await step('calls on one site run one at a time', async () => {
    const [a, b] = await Promise.all([call('web_read', { site, role: 'heading' }), call('web_read', { site, text: 'Apples' })]);
    assert.equal(a, 'Test shop');
    assert.match(b, /Apples/);
  });

  await step('extract returns rows', async () => {
    const plain = JSON.parse(await call('web_extract', { site, role: 'listitem' }));
    assert.deepEqual(plain.map(r => r.text), ['Apples more', 'Pears more']);
    assert.match(plain[0].link, /\/apples$/);
    const rows = JSON.parse(await call('web_extract', { site, role: 'listitem', fields: { url: { role: 'link', attr: 'href' } } }));
    assert.deepEqual(rows, [{ url: '/apples' }, { url: '/pears' }]);
  });

  await step('loud failures', async () => {
    await fails('web_wait', { site, seconds: 1, until_text: 'Never shown' }, /did not appear/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'click', ref: 'e1' }] }, /refs/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'open', url: '/{{page}}' }] }, /not in params/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x',
      steps: [{ action: 'open', url: '/', expect: 'Not on the page' }] }, /expected "Not on the page"/);
    assert(!(await c.listTools()).tools.some(t => t.name === 'localhost_bad'), 'a failed test run saves nothing');
  });

  const search = { site, name: 'search', description: 'Search the shop',
    params: { query: 'What to look for', limit: { description: 'How many', type: 'number', default: 5 } }, test_args: { query: 'figs' },
    steps: [{ action: 'open', url: '/' }, { action: 'type', role: 'textbox', name: 'Search products', value: '{{query}}' },
      { action: 'click', role: 'button', name: 'Go', expect: 'Results for {{query}}' }, { action: 'read', text: 'Results for' }] };

  await step('shortcuts are tried before saving and become tools', async () => {
    assert.match(await call('web_save_shortcut', search), /Test run worked/);
    assert.equal(await call('localhost_search', { query: 'plums' }), 'Results for plums');
    assert.match(await call('web_list_shortcuts', { site }), /localhost_search: Search the shop/);
    assert.match(await call('web_list_shortcuts', { site, name: 'search' }), /"search": \{/);
  });

  await step('shortcuts repair themselves after a redesign', async () => {
    v2 = true;
    const out = await call('localhost_search', { query: 'limes' });
    assert.match(out, /^Results for limes/);
    assert.match(out, /Repaired step 2: textbox "Search products" is now textbox "Product search"; step 3: button "Go" is now link "Go"/);
    const saved = JSON.parse(readFileSync(join(home, 'sites/localhost.json'), 'utf8')).search.steps;
    assert.equal(saved[2].role, 'link');
    assert.deepEqual(saved[2].fallbacks[0], { role: 'button', name: 'Go' });
    assert.equal(await call('localhost_search', { query: 'kiwis' }), 'Results for kiwis', 'no repair needed the second time');
  });

  await step('doctor checks shortcuts without acting', async () => {
    assert.match(await cli('doctor', site), /✓ localhost_search \(checked steps 1–2/);
  });

  await step('permissions', async () => {
    settings({ read_only: true });
    await fails('web_click', { site, role: 'button', name: 'Send message' }, /read-only/);
    await call('web_type', { site, role: 'textbox', name: 'Product search', value: 'x', submit: true });
    settings({ confirm: true });
    answer = 'decline';
    await fails('web_click', { site, role: 'button', name: 'Send message' }, /said no/);
    answer = 'accept';
    assert.match(await call('web_click', { site, role: 'button', name: 'Send message' }), /Sent/);
    settings({});
    await fails('web_open', { site, url: 'https://example.org/' }, /outside the domains allowed/);
    assert.match(await cli('permissions', site, '--read-only', '--allow', 'localhost,example.org'), /read-only.*may open localhost, example\.org/s);
    settings({});
  });

  await step('record mode turns what the user does into a shortcut', async () => {
    await call('web_record', { site, action: 'start' });
    // Play the user: drive the same Chrome over its debugging port.
    const port = readFileSync(join(home, 'profiles/localhost/DevToolsActivePort'), 'utf8').split('\n')[0];
    const user = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const tab = user.contexts()[0].pages().find(p => p.url().includes('localhost'));
    await tab.getByLabel('Product search').fill('nuts');
    await tab.getByLabel('Product search').press('Enter');
    await tab.getByRole('link', { name: 'Go' }).click();
    await new Promise(r => setTimeout(r, 300));
    const saved = await call('web_record', { site, action: 'stop', name: 'recorded', description: 'Search by hand' });
    assert.match(saved, /"product_search": \{\s*"description": "Value for Product search",\s*"default": "nuts"/);
    assert.match(saved, /"action": "click",\s*"role": "link",\s*"name": "Go"/);
    assert.match(await call('localhost_recorded', { product_search: 'dates' }), /Results for dates/);
  });

  await step('add shared shortcuts', async () => {
    const file = join(home, 'shared.json');
    writeFileSync(file, JSON.stringify({ about: { description: 'Read the About page', steps: [{ action: 'open', url: '/about' }, { action: 'read', role: 'main' }] } }));
    assert.match(await cli('add', site, '--from', file), /\+ localhost_about/);
    writeFileSync(file, JSON.stringify({ evil: { description: 'x', steps: [{ action: 'eval', code: 'boom' }] } }));
    await assert.rejects(cli('add', site, '--from', file, '--force'), /use one of/);
  });

  await step('library files are valid', async () => {
    const dir = fileURLToPath(new URL('./library/', import.meta.url));
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')))
      assert.match(await cli('add', f.slice(0, -5), '--from', join(dir, f)), /\+ /, f);
  });

  await call('web_delete_shortcut', { site, name: 'search' });
  console.log('all ok');
} finally {
  await c.close();
  http.close();
  const port = readFileSync(join(home, 'profiles/localhost/DevToolsActivePort'), 'utf8').split('\n')[0];
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  setTimeout(() => rmSync(home, { recursive: true, force: true }), 2000);
}
