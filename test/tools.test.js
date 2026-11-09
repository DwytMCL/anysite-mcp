import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

// config.js reads ANYSITE_HOME when it loads, so set it before importing tools.js.
const home = mkdtempSync(join(tmpdir(), 'anysite-tools-'));
process.env.ANYSITE_HOME = home;
const { addShortcut, server, useSite, zodParam } = await import('../lib/tools.js');

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'tools-test', version: '0' });
await server.connect(serverSide);
await client.connect(clientSide);
const names = async () => (await client.listTools()).tools.map(t => t.name);
const toolNamed = async n => (await client.listTools()).tools.find(t => t.name === n);

test('zodParam: types, optional, default and description', () => {
  assert.ok(zodParam({ description: 'N', type: 'number' }).safeParse(3).success);
  assert.ok(!zodParam({ description: 'N', type: 'number' }).safeParse('3').success);
  assert.ok(zodParam({ description: 'B', type: 'boolean' }).safeParse(true).success);
  assert.ok(!zodParam({ description: 'B', type: 'boolean' }).safeParse('yes').success);
  assert.ok(zodParam({ description: 'S' }).safeParse('x').success);
  assert.ok(!zodParam({ description: 'S' }).safeParse(undefined).success, 'required by default');
  assert.ok(zodParam({ description: 'S', optional: true }).safeParse(undefined).success);
  const withDefault = zodParam({ description: 'How many', type: 'number', default: 3 });
  assert.ok(withDefault.safeParse(undefined).success, 'a default makes it optional');
  assert.equal(z.toJSONSchema(withDefault).description, 'How many (default: 3)');
  assert.equal(z.toJSONSchema(zodParam('Query')).description, 'Query');
  assert.ok(!zodParam('Query').safeParse(undefined).success);
});

test('useSite: with no sites in use, asks which site', async () => {
  await assert.rejects(useSite(), /Say which site/);
});

test('useSite: a pack adds its tools once', async () => {
  const before = await names();
  assert.ok(before.includes('web_snapshot'));
  assert.ok(!before.some(n => n.startsWith('gemini_')));
  await useSite('gemini');
  const after = await names();
  const added = after.filter(n => n.startsWith('gemini_'));
  assert.ok(added.includes('gemini_ask') && added.includes('gemini_list_chats'), added.join(', '));
  await useSite('gemini');
  assert.deepEqual(await names(), after, 'a second useSite adds nothing');
});

test('useSite: saved shortcuts become <prefix>_<name> tools; re-adding replaces', async () => {
  mkdirSync(join(home, 'sites'), { recursive: true });
  writeFileSync(join(home, 'sites', 'example.com.json'), JSON.stringify({
    find: { description: 'Find a page', params: { q: 'Query', n: { description: 'N', type: 'number', default: 2 } },
      steps: [{ action: 'open', url: '/?q={{q}}' }, { action: 'read' }] } }));
  const site = await useSite('example.com');
  const t = await toolNamed('example_com_find');
  assert.ok(t, 'shortcut tool listed');
  assert.match(t.description, /Find a page \(saved shortcut for example\.com\)/);
  assert.deepEqual(t.inputSchema.required, ['q']);
  const props = /** @type {Record<string, any>} */ (t.inputSchema.properties);
  assert.equal(props.n.type, 'number');
  assert.equal(props.n.description, 'N (default: 2)');
  addShortcut(site, 'find', { description: 'Find it again', steps: [{ action: 'read' }] });
  const all = await names();
  assert.equal(all.filter(n => n === 'example_com_find').length, 1, 'replaced, not duplicated');
  assert.match((await toolNamed('example_com_find')).description, /Find it again/);
});
