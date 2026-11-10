// Checks the MCP contract with a second client, the MCP Inspector CLI: the handshake, the tool list (with --strict
// schema portability checks) and one tool call. No browser actions: the Inspector starts a fresh server for every
// command, so it can't replay the self-check. Needs Chrome, as serving MCP does.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TOOLS } from './smoke-pack.js';

const INSPECTOR = '@modelcontextprotocol/inspector@2.14.0';
const serverJs = fileURLToPath(new URL('../server.js', import.meta.url));

// Run npx through node rather than npx.cmd, which Windows only starts through a shell that would mangle the JSON
// arguments. Under `npm run`, npm_execpath is npm-cli.js and npx-cli.js sits beside it.
const npxCmd = process.env.npm_execpath ? process.execPath : 'npx';
const npxPre = process.env.npm_execpath ? [join(dirname(process.env.npm_execpath), 'npx-cli.js')] : [];

const home = mkdtempSync(join(tmpdir(), 'anysite-inspector-'));
mkdirSync(join(home, 'sites'));
writeFileSync(join(home, 'sites', 'example.com.json'), JSON.stringify({
  find: { description: 'Find a page', params: { q: 'Query' }, steps: [{ action: 'open', url: '/?q={{q}}' }, { action: 'read' }] } }));
// The Inspector doesn't pass its own environment on to the server, so give the server what it needs with -e.
const env = { ANYSITE_HOME: home, ANYSITE_CHROME: process.env.ANYSITE_CHROME, ANYSITE_CHROME_ARGS: process.env.ANYSITE_CHROME_ARGS };
const envArgs = Object.entries(env).filter(([, v]) => v).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

async function inspect(...args) {
  const all = [...npxPre, '--yes', INSPECTOR, '--cli', ...envArgs, process.execPath, serverJs, 'example.com', ...args, '--format', 'json'];
  try {
    const { stdout } = await promisify(execFile)(npxCmd, all, { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Inspector ${args.join(' ')} failed (exit ${e.code}):\n${e.stderr || e.message}`, { cause: e });
  }
}

try {
  const init = await inspect('--method', 'initialize');
  assert.equal(init.result.protocolVersion, '2025-11-25');
  console.log(`initialize: ${init.result.serverInfo.name} ${init.result.serverInfo.version}, protocol ${init.result.protocolVersion}`);

  // --strict exits 6 on an error-severity schema finding; warnings are reported and allowed.
  const list = await inspect('--method', 'tools/list', '--strict');
  const tools = Object.fromEntries(list.result.tools.map(t => [t.name, t]));
  for (const n of [...TOOLS, 'example_com_find']) assert.ok(tools[n], `tools/list is missing ${n}`);
  assert.equal(tools.web_click.annotations?.destructiveHint, true, 'web_click is destructive');
  assert.ok(tools.web_extract.outputSchema, 'web_extract has an outputSchema');
  assert.equal(tools.example_com_find.annotations?.readOnlyHint, true, 'example_com_find is read-only');
  const findings = (list.schemaFindings || []).flatMap(t => t.findings.map(f => ({ tool: t.toolName, ...f })));
  assert.deepEqual(findings.filter(f => f.severity === 'error'), []);
  console.log(`tools/list --strict: ${list.result.tools.length} tools, ${findings.length} schema warning(s)`);
  for (const f of findings) console.log(`  ${f.tool} ${f.schema}.${f.path}: ${f.rule}`);

  const call = await inspect('--method', 'tools/call', '--tool-name', 'web_list_shortcuts', '--tool-args-json', '{"site":"example.com"}');
  assert.ok(!call.result.isError, JSON.stringify(call.result.content));
  assert.equal(call.result.structuredContent?.shortcuts?.[0]?.name, 'find');
  console.log('tools/call web_list_shortcuts: structuredContent lists "find"');
  console.log('Inspector check passed.');
} finally {
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
