import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'anysite-guard-'));
process.env.ANYSITE_HOME = home;
const { confirmRequest, permit, permitClick, permitEnter, setAsk } = await import('../lib/guard.js');
const { writeSiteSettings } = await import('../lib/permissions.js');

const site = { name: 'shop.test', url: 'https://shop.test/' };
const settings = s => writeSiteSettings(join(home, 'settings.json'), site.name, { read_only: null, confirm: null, ...s });
// A stand-in for a Playwright locator: effectOf only calls evaluate.
const el = fx => ({ evaluate: async () => ({ label: '', link: false, href: '', submits: false, post: false, ...fx }) });
const spy = (answer = { action: 'accept' }) => {
  const calls = [];
  const fn = async (s, what) => { calls.push(what); return answer; };
  return Object.assign(fn, { calls });
};

test('read-only blocks with the --read-write hint', async () => {
  settings({ read_only: true });
  await assert.rejects(permitClick(site, el({ label: 'Send message' })),
    /shop\.test is read-only, so the agent can't click "Send message"[\s\S]*--read-write/);
});

test('confirm calls the injected ask, and "no" stops the action', async () => {
  settings({ confirm: true });
  const yes = spy();
  setAsk(yes);
  await permitClick(site, el({ label: 'Send message' }));
  assert.deepEqual(yes.calls, ['click "Send message"']);
  setAsk(spy({ action: 'decline' }));
  await assert.rejects(permitClick(site, el({ label: 'Send message' })), /The user said no to: click "Send message"/);
});

test('risky clicks and Enter ask; safe ones do not', async () => {
  settings({ confirm: true });
  const ask = spy();
  setAsk(ask);
  await permitClick(site, el({ label: 'Continue', submits: true, post: true })); // a POST form, whatever its label
  await permitEnter(site, el({ label: 'Message' })); // Enter outside a form, not a search field
  await permitClick(site, el({ label: 'Delete everything', link: true, href: 'https://shop.test/about' })); // a plain link
  await permitEnter(site, el({ label: 'Keyword', submits: true, post: false })); // a GET search form
  await permitEnter(site, el({ label: 'Search products' }));
  await permitClick(site, el({ label: 'Leave', link: true, href: 'https://shop.test/logout' }));
  assert.deepEqual(ask.calls, ['click "Continue"', 'submit "Message"', 'click "Leave"']);
});

test('with no way to ask, confirm fails and never goes ahead', async () => {
  settings({ confirm: true });
  setAsk(null);
  await assert.rejects(permit(site, 'click "Buy"'), /this MCP client can't ask[\s\S]*--no-confirm/);
  setAsk(async () => null); // the client lacks elicitation
  await assert.rejects(permit(site, 'click "Buy"'), /this MCP client can't ask/);
});

test('a later setAsk replaces the earlier one', async () => {
  settings({ confirm: true });
  const first = spy(), second = spy();
  setAsk(first);
  setAsk(second);
  await permit(site, 'click "Buy"');
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, ['click "Buy"']);
});

test('confirmRequest is a yes/no form that asks for no input', () => {
  const r = confirmRequest(site, 'click "Buy"');
  assert.equal(r.mode, 'form');
  assert.equal(r.message, 'Let the agent click "Buy" on shop.test?');
  // Never add fields: sensitive input must not go through form elicitation (the MCP spec wants URL mode for that).
  assert.deepEqual(r.requestedSchema, { type: 'object', properties: {} });
  assert.deepEqual(Object.keys(r).sort(), ['message', 'mode', 'requestedSchema']);
});

test('pack tools marked writes: true name the tool when blocked', async () => {
  mkdirSync(join(home, 'sites'), { recursive: true });
  writeFileSync(join(home, 'sites', 'fakepack.js'), `export default () => ({ url: 'https://fake.test/',
    tools: { add_source: { description: 'Add a source', writes: true, run: async () => 'ran' } } });`);
  writeSiteSettings(join(home, 'settings.json'), 'fakepack', { read_only: true });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { server, useSite } = await import('../lib/tools.js');
  await useSite('fakepack');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const r = await client.callTool({ name: 'fakepack_add_source', arguments: {} });
    assert(r.isError);
    assert.match(r.content[0].text, /fakepack is read-only, so the agent can't use fakepack_add_source\./);
  } finally {
    await client.close();
  }
});
