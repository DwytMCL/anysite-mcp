// Starts the server on example.com with a throwaway data dir, saves a shortcut, runs it, then closes Chrome.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'anysite-'));
const c = new Client({ name: 'selfcheck', version: '0' });
await c.connect(new StdioClientTransport({ command: 'node', args: [new URL('./server.js', import.meta.url).pathname, 'gemini', 'example.com'],
  env: { ...process.env, ANYSITE_HOME: home } }));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); assert(!r.isError, r.content[0].text); return r.content[0].text; };
try {
  const names = (await c.listTools()).tools.map(t => t.name);
  console.log(names.join(', '));
  for (const n of ['web_snapshot', 'web_save_shortcut', 'gemini_ask', 'gemini_list_chats']) assert(names.includes(n), n);
  assert.match(await call('web_open', { site: 'example.com' }), /link "Learn more"/);
  await call('web_save_shortcut', { site: 'example.com', name: 'first_link', description: 'Read the first link',
    params: { path: 'Page path' }, steps: [{ action: 'open', url: '{{path}}' }, { action: 'read', role: 'link' }] });
  assert((await c.listTools()).tools.some(t => t.name === 'example_com_first_link'));
  assert.equal(await call('example_com_first_link', { path: '/' }), 'Learn more');
  console.log('ok');
} finally {
  await c.close();
  const port = readFileSync(join(home, 'profiles/example.com/DevToolsActivePort'), 'utf8').split('\n')[0];
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  setTimeout(() => rmSync(home, { recursive: true, force: true }), 2000);
}
