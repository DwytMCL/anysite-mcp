// Serves a small test shop on localhost, starts the server on it with a throwaway data dir and a headless Chrome,
// and checks snapshots, refs, shortcuts (tested saving, self-repair, typed params), extract, permissions, record
// mode, `add` and `doctor`. Needs no network.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './shortcuts-library/build.js';

// Version 2 of the shop is a "redesign": the search field is renamed and the Go button becomes a link.
let v2 = false;
const page = () => `<!doctype html><title>Test shop</title><h1>Test shop</h1>
<label>${v2 ? 'Product search' : 'Search products'} <input name="q"></label>
<${v2 ? 'a href="#"' : 'button'} onclick="document.querySelector('#out').textContent = 'Results for ' + document.querySelector('input').value">Go</${v2 ? 'a' : 'button'}>
<button onclick="document.querySelector('#out').textContent = 'Sent'">Send message</button>
<p id="out"></p><ul><li>Apples <a href="/apples">more</a></li><li>Pears <a href="/pears">more</a></li></ul><a href="/about">About</a>`;
const fruit = `<ul>${['Apples', 'Pears'].map(f => `<li><a href="/img/${f}"><img alt="" src="data:,"></a>
  <a href="/${f}">${f}</a> fresh</li>`).join('')}</ul>`;
const pages = {
  '/about': '<title>About</title><main><p>About this shop</p></main>',
  // Like many sites, a search box that script hides and replaces with a combobox once the page has loaded.
  '/swap': `<title>Swap</title><input type="search" aria-label="Find"><p id="out"></p><script>
    const c = document.createElement('input'); c.setAttribute('role', 'combobox'); c.setAttribute('aria-label', 'Find');
    c.oninput = () => out.textContent = 'You typed ' + c.value;
    document.querySelector('[type=search]').style.display = 'none'; out.before(c);</script>`,
  '/fruit': `<title>Fruit</title>${fruit}`,
  // Choosing a sort order loads another page a moment later, and its list arrives a moment after that.
  '/sort': `<title>Sort</title><select aria-label="Sort" onchange="setTimeout(() => location.href = '/sorted', 300)">
    <option>Name</option><option>Price</option></select>`,
  '/sorted': `<title>Sorted</title><div id="list"></div><template id="later">${fruit}</template>
    <script>setTimeout(() => list.innerHTML = later.innerHTML, 700)</script>`,
  '/forms': `<title>Forms</title><a href="/signup">Create account</a><a href="/logout">Leave</a>
    <form method="post" action="/order"><button>Continue</button></form>
    <form action="/search"><input name="q" aria-label="Keyword"></form>`,
};
const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(pages[req.url.split('?')[0]] ?? page());
}).listen(0, '127.0.0.1');
await new Promise(r => http.once('listening', r));
// Listening on a port, so address() is an AddressInfo rather than a pipe name.
const site = `localhost:${/** @type {import('node:net').AddressInfo} */ (http.address()).port}`;

const home = mkdtempSync(join(tmpdir(), 'anysite-'));
const env = { ...process.env, ANYSITE_HOME: home, ANYSITE_HEADLESS: '1' };
const serverJs = fileURLToPath(new URL('./server.js', import.meta.url));
// Async, because this process also serves the test pages.
const cli = async (...args) => (await promisify(execFile)(process.execPath, [serverJs, ...args], { env })).stdout;
const settings = s => writeFileSync(join(home, 'settings.json'), JSON.stringify({ sites: { localhost: s } }));

/** @type {'accept' | 'decline' | 'cancel'} */
let answer = 'accept';
const c = new Client({ name: 'selfcheck', version: '0' }, { capabilities: { elicitation: {} } });
c.setRequestHandler('elicitation/create', () => ({ action: answer }));
let listChanged = 0;
c.setNotificationHandler('notifications/tools/list_changed', () => { listChanged++; });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [serverJs, 'gemini', site], env }));
const raw = (name, args) => c.callTool({ name, arguments: args });
const textOf = r => /** @type {{ text: string }} */ (r.content[0]).text;
const call = async (name, args) => { const r = await raw(name, args); assert(!r.isError, textOf(r)); return textOf(r); };
const fails = async (name, args, re) => { const r = await raw(name, args); assert(r.isError, `${name} should fail`); assert.match(textOf(r), re); };
const step = (name, fn) => fn().then(() => console.log(`ok  ${name}`));
// Run fn and check the server announced a changed tool list (notifications/tools/list_changed) for it.
const announces = async (what, fn) => {
  const before = listChanged;
  const r = await fn();
  for (const end = Date.now() + 2000; listChanged === before && Date.now() < end;) await new Promise(res => setTimeout(res, 50));
  assert(listChanged > before, `${what} sends notifications/tools/list_changed`);
  return r;
};

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
    const r = await raw('web_extract', { site, role: 'listitem' });
    assert.deepEqual(r.structuredContent, { rows: JSON.parse(textOf(r)) }, 'structured rows match the text');
    const none = await raw('web_extract', { site, role: 'row' });
    assert.match(String(/** @type {{ note?: string }} */ (none.structuredContent).note), /^nothing matched row\./);
  });

  // web_extract's exact text, frozen in test/fixtures, so clients that read the text see no change.
  await step('extract text is unchanged', async () => {
    await call('web_open', { site, url: '/fruit' });
    const got = {
      plain: await call('web_extract', { site, role: 'listitem' }),
      fields: await call('web_extract', { site, role: 'listitem', fields: { title: { role: 'link' }, url: { role: 'link', attr: 'href' } } }),
      empty_field: await call('web_extract', { site, role: 'listitem', fields: { buy: { role: 'button' } } }),
      no_match: await call('web_extract', { site, role: 'row' }),
    };
    const fixture = fileURLToPath(new URL('./test/fixtures/extract-text.json', import.meta.url));
    const text = JSON.stringify(got, null, 2).replaceAll(site, 'localhost:PORT') + '\n';
    if (process.env.UPDATE_FIXTURES) writeFileSync(fixture, text);
    assert.deepEqual(JSON.parse(text), JSON.parse(readFileSync(fixture, 'utf8')));
  });

  await step('extract fields skip empty matches and flag misspelled roles', async () => {
    await call('web_open', { site, url: '/fruit' });
    const rows = JSON.parse(await call('web_extract', { site, role: 'listitem',
      fields: { title: { role: 'link' }, url: { role: 'link', attr: 'href' } } }));
    assert.deepEqual(rows, [{ title: 'Apples', url: '/Apples' }, { title: 'Pears', url: '/Pears' }]);
    await fails('web_extract', { site, role: 'listitem', fields: { title: { role: 'lnk' } } }, /unknown field role "lnk"; did you mean "link"/);
    assert.match(await call('web_extract', { site, role: 'listitem', fields: { buy: { role: 'button' } } }), /"buy" came back empty on every row/);
  });

  await step('select waits for the page it loads', async () => {
    await call('web_open', { site, url: '/sort' });
    await call('web_select', { site, role: 'combobox', name: 'Sort', value: 'Price' });
    assert.equal(JSON.parse(await call('web_extract', { site, role: 'listitem' })).length, 2);
  });

  await step('loud failures', async () => {
    await fails('web_wait', { site, seconds: 1, until_text: 'Never shown' }, /did not appear/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'click', ref: 'e1' }] }, /refs/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x', steps: [{ action: 'open', url: '/{{page}}' }] }, /not in params/);
    await fails('web_save_shortcut', { site, name: 'bad', description: 'x',
      steps: [{ action: 'open', url: '/', expect: 'Not on the page' }] }, /expected "Not on the page"/);
    assert(!(await c.listTools()).tools.some(t => t.name === 'localhost_bad'), 'a failed test run saves nothing');
  });

  await step('web_wait reports progress', async () => {
    const updates = [];
    const r = await c.callTool({ name: 'web_wait', arguments: { site, seconds: 2, show: 'none' } }, { onprogress: u => updates.push(u) });
    assert(!r.isError, textOf(r));
    assert(updates.length >= 1, 'at least one progress update');
    assert.deepEqual(updates[0], { progress: 1, total: 2, message: 'Waited 1 s of 2' });
  });

  const search = { site, name: 'search', description: 'Search the shop',
    params: { query: 'What to look for', limit: { description: 'How many', type: 'number', default: 5 } }, test_args: { query: 'figs' },
    steps: [{ action: 'open', url: '/' }, { action: 'type', role: 'textbox', name: 'Search products', value: '{{query}}' },
      { action: 'click', role: 'button', name: 'Go', expect: 'Results for {{query}}' }, { action: 'read', text: 'Results for' }] };

  await step('shortcuts are tried before saving and become tools', async () => {
    assert.match(await announces('web_save_shortcut', () => call('web_save_shortcut', search)), /Test run worked/);
    assert.equal(await call('localhost_search', { query: 'plums' }), 'Results for plums');
    assert.match(await call('web_list_shortcuts', { site }), /localhost_search: Search the shop/);
    assert.match(await call('web_list_shortcuts', { site, name: 'search' }), /"search": \{/);
  });

  await step('shortcuts repair themselves after a redesign', async () => {
    v2 = true;
    const out = await call('localhost_search', { query: 'limes' });
    assert.match(out, /^Results for limes/);
    assert.match(out, /Repaired step 2: textbox "Search products" is now textbox "Product search"; step 3: button "Go" is now link "Go"/);
    const saved = JSON.parse(readFileSync(join(home, 'sites/localhost.json'), 'utf8')).shortcuts.search.steps;
    assert.equal(saved[2].role, 'link');
    assert.deepEqual(saved[2].fallbacks[0], { role: 'button', name: 'Go' });
    assert.equal(await call('localhost_search', { query: 'kiwis' }), 'Results for kiwis', 'no repair needed the second time');
  });

  await step('shortcuts repair elements that script replaces after loading', async () => {
    const swap = (name, target) => call('web_save_shortcut', { site, name, description: 'Type into Find', verify: false,
      params: { q: 'Text' }, steps: [{ action: 'open', url: '/swap' }, { action: 'type', ...target, value: '{{q}}' },
        { action: 'read', text: 'You typed' }] });
    await swap('find', { role: 'searchbox', name: 'Find' });
    const out = await call('localhost_find', { q: 'figs' });
    assert.match(out, /^You typed figs/);
    assert.match(out, /searchbox "Find" is now combobox "Find"/);
    await swap('find_by_role', { role: 'searchbox' });
    assert.match(await call('localhost_find_by_role', { q: 'nuts' }), /^You typed nuts[\s\S]*searchbox is now combobox "Find"/);
  });

  await step('doctor checks shortcuts without acting', async () => {
    assert.match(await cli('doctor', site), /✓ localhost_search \(checked steps 1–2/);
  });

  await step('permissions', async () => {
    await call('web_open', { site, url: '/' });
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
    // Read-only goes by what an element does: links open pages, POST forms change things whatever the label.
    settings({ read_only: true });
    await call('web_open', { site, url: '/forms' });
    assert.match(await call('web_click', { site, role: 'link', name: 'Create account' }), /signup/);
    await call('web_open', { site, url: '/forms' });
    await fails('web_click', { site, role: 'link', name: 'Leave' }, /read-only/);
    await fails('web_click', { site, role: 'button', name: 'Continue' }, /read-only/);
    await call('web_type', { site, role: 'textbox', name: 'Keyword', value: 'pears', submit: true });
    settings({});
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
    const saved = await announces('web_record stop',
      () => call('web_record', { site, action: 'stop', name: 'recorded', description: 'Search by hand' }));
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

  await step('library list reads a local library build', async () => {
    const out = join(home, 'site');
    build({ out, health: join(home, 'no-health.json') });
    const { stdout } = await promisify(execFile)(process.execPath, [serverJs, 'library', 'list', 'github.com'],
      { env: { ...env, ANYSITE_LIBRARY: join(out, 'library') } });
    assert.match(stdout, /– not checked yet {2}github_com_trending: [\s\S]*npx -y anysite-mcp add github\.com\/trending/);
  });

  await step('deleting a shortcut removes its tool', async () => {
    await announces('web_delete_shortcut', () => call('web_delete_shortcut', { site, name: 'search' }));
    assert(!(await c.listTools()).tools.some(t => t.name === 'localhost_search'));
  });
  console.log('all ok');
} finally {
  await c.close();
  http.close();
  const port = readFileSync(join(home, 'profiles/localhost/DevToolsActivePort'), 'utf8').split('\n')[0];
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  setTimeout(() => rmSync(home, { recursive: true, force: true }), 2000);
}
