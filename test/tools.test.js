import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
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

test('the server speaks the 2025-11-25 protocol revision', () => {
  assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
});

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

// Frozen under SDK v1 (v2 only moved $schema to 2020-12): a change in how zod becomes JSON Schema would change what clients see.
test('tool input schemas: frozen JSON Schema for a shortcut and a pack tool', async () => {
  mkdirSync(join(home, 'sites'), { recursive: true });
  writeFileSync(join(home, 'sites', 'example.org.json'), JSON.stringify({
    snap: { description: 'S', params: { q: 'Query', n: { description: 'How many', type: 'number', default: 3 },
      all: { description: 'All', type: 'boolean', optional: true } }, steps: [{ action: 'read' }] } }));
  await useSite('example.org');
  await useSite('gemini');
  assert.deepEqual((await toolNamed('example_org_snap')).inputSchema, {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['q'],
    properties: { q: { type: 'string', description: 'Query' }, n: { type: 'number', description: 'How many (default: 3)' },
      all: { type: 'boolean', description: 'All' } } });
  assert.deepEqual((await toolNamed('gemini_ask')).inputSchema, {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      chat: { type: 'string', description: 'Continue a chat: "current" for the open one, or a chat title (or part), id or URL' },
      files: { type: 'array', items: { type: 'string' }, description: 'Local files to attach' },
      model: { type: 'string', description: 'Model from the mode picker, e.g. "Pro", "Flash", "Flash-Lite"' },
      tool: { type: 'string', description: 'Tool to switch on first, e.g. "Create image", "Create video", "Deep Research"' },
      timeout_seconds: { type: 'number', minimum: 10, maximum: 900 } } });
});

test('tool annotations: every hint is set explicitly', async () => {
  await useSite('gemini');
  writeFileSync(join(home, 'sites', 'example.net.json'), JSON.stringify({
    look: { description: 'Look', steps: [{ action: 'open', url: '/' }, { action: 'read' }] },
    act: { description: 'Act', steps: [{ action: 'open', url: '/' }, { action: 'click', role: 'button', name: 'Go' }] } }));
  await useSite('example.net');
  const hints = async n => (await toolNamed(n)).annotations;
  assert.deepEqual(await hints('web_click'), { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(await hints('web_extract'), { readOnlyHint: true, openWorldHint: true });
  assert.deepEqual(await hints('web_download'), { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(await hints('web_save_shortcut'),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(await hints('web_list_shortcuts'), { readOnlyHint: true, openWorldHint: false });
  assert.deepEqual(await hints('web_delete_shortcut'), { readOnlyHint: false, destructiveHint: true, openWorldHint: false });
  assert.deepEqual(await hints('gemini_list_chats'), { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(await hints('gemini_ask'), { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(await hints('example_net_look'), { readOnlyHint: true, openWorldHint: true });
  assert.deepEqual(await hints('example_net_act'), { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
});

test('tool annotations: pack tools follow writes and readOnly', async () => {
  await useSite('notebooklm');
  assert.deepEqual((await toolNamed('notebooklm_add_source')).annotations,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual((await toolNamed('notebooklm_list_notebooks')).annotations,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
});

test('web_list_shortcuts: structured output matches its outputSchema', async () => {
  const t = await toolNamed('web_list_shortcuts');
  assert.deepEqual(t.outputSchema.required, ['site', 'file', 'shortcuts']);
  writeFileSync(join(home, 'sites', 'example.edu.json'), JSON.stringify({
    find: { description: 'Find', params: { q: 'Query' }, steps: [{ action: 'open', url: '/?q={{q}}' }] },
    other: { description: 'Other', steps: [{ action: 'read' }] } }));
  const one = await client.callTool({ name: 'web_list_shortcuts', arguments: { site: 'example.edu', name: 'find' } });
  assert.ok(!one.isError);
  assert.deepEqual(one.structuredContent, { site: 'example.edu', file: join(home, 'sites', 'example.edu.json'), shortcuts: [
    { name: 'find', tool: 'example_edu_find', description: 'Find', params: { q: 'Query' }, steps: [{ action: 'open', url: '/?q={{q}}' }] }] });
  const all = await client.callTool({ name: 'web_list_shortcuts', arguments: { site: 'example.edu' } });
  assert.deepEqual(/** @type {any} */ (all.structuredContent).shortcuts.map(s => s.name), ['find', 'other']);
  const none = await client.callTool({ name: 'web_list_shortcuts', arguments: { site: 'example.biz' } });
  assert.ok(!none.isError);
  assert.match(/** @type {{ text: string }} */ (none.content[0]).text, /No shortcuts saved for example\.biz yet/);
  assert.deepEqual(/** @type {any} */ (none.structuredContent).shortcuts, []);
});

test('web_extract declares its outputSchema', async () => {
  const t = await toolNamed('web_extract');
  assert.deepEqual(t.outputSchema.required, ['rows']);
  assert.equal(/** @type {any} */ (t.outputSchema.properties).rows.type, 'array');
});

test('pack tools get progress(done, total, message), sent only when the client asks', async () => {
  writeFileSync(join(home, 'sites', 'slowpack.js'), `export default () => ({ url: 'https://slow.test/',
    tools: { run: { description: 'Slow', run: async (p, a, site, { progress }) => {
      await progress(1, 2, 'half'); await progress(2, 2, 'done'); return 'ran'; } } } });`);
  const site = await useSite('slowpack');
  site.page = { isClosed: () => false }; // skip starting Chrome: this tool never touches the page
  const updates = [];
  const r = await client.callTool({ name: 'slowpack_run', arguments: {} }, { onprogress: u => updates.push(u) });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.deepEqual(updates, [{ progress: 1, total: 2, message: 'half' }, { progress: 2, total: 2, message: 'done' }]);
  assert.ok(!(await client.callTool({ name: 'slowpack_run', arguments: {} })).isError, 'no progressToken: no updates, no error');
});
