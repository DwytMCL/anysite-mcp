import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { findChrome } from '../lib/browser.js';

const serverJs = fileURLToPath(new URL('../server.js', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'anysite-proto-'));
test.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

// Connects to a real server process over stdio, as the given kind of client, and returns the negotiated revision.
async function connect(serverEnv, mode) {
  const c = new Client({ name: 'proto-test', version: '0' }, { versionNegotiation: { mode } });
  const t = new StdioClientTransport({ command: process.execPath, args: [serverJs, 'example.com'], stderr: 'ignore',
    env: { ...process.env, ANYSITE_HOME: home, ...serverEnv } });
  try {
    await c.connect(t);
    const tools = (await c.listTools()).tools.map(x => x.name);
    return { version: c.getNegotiatedProtocolVersion(), tools };
  } finally { await c.close().catch(() => {}); }
}

test('the protocol revision depends on ANYSITE_PROTOCOL and on what the client asks for', { skip: !findChrome() && 'needs Chrome' }, async () => {
  const a = await connect({ ANYSITE_PROTOCOL: '' }, 'legacy');
  assert.equal(a.version, '2025-11-25');
  assert.ok(a.tools.includes('web_snapshot'));
  const b = await connect({ ANYSITE_PROTOCOL: '2026-07-28' }, 'legacy');
  assert.equal(b.version, '2025-11-25', 'a 2025 client is unaffected by the opt-in');
  const c = await connect({ ANYSITE_PROTOCOL: '2026-07-28' }, { pin: '2026-07-28' });
  assert.equal(c.version, '2026-07-28');
  assert.deepEqual(c.tools, b.tools, 'both revisions list the same tools');
  await assert.rejects(connect({ ANYSITE_PROTOCOL: '' }, { pin: '2026-07-28' }), /did not offer pinned protocol version/);
});

test('an unknown ANYSITE_PROTOCOL stops the server with a message', { skip: !findChrome() && 'needs Chrome' }, async () => {
  await assert.rejects(connect({ ANYSITE_PROTOCOL: '1999-01-01' }, 'legacy'));
});
