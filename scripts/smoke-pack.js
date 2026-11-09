// Packs the package as npm would publish it, checks what's inside, installs it into a temp folder and starts it:
// `--version`, then an MCP initialize and tools/list through the SDK client. Needs Chrome, as the CLI does.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Everything the package may contain. Anything else (types/, test/, scripts/, a stray file) fails the check.
const FILES = ['package.json', 'server.js', 'README.md', 'LICENSE', 'CHANGELOG.md'];
const FOLDERS = ['lib/', 'sites/'];
export const TOOLS = ['web_snapshot', 'web_open', 'web_click', 'web_type', 'web_select', 'web_press', 'web_upload',
  'web_read', 'web_extract', 'web_wait', 'web_download', 'web_screenshot', 'web_login', 'web_record',
  'web_save_shortcut', 'web_list_shortcuts', 'web_delete_shortcut'];

export function checkPackFiles(paths) {
  const problems = [];
  const unexpected = paths.filter(p => !FILES.includes(p) && !FOLDERS.some(f => p.startsWith(f)));
  if (unexpected.length) problems.push(`The package contains files it shouldn't:\n  ${unexpected.join('\n  ')}`);
  const missing = FILES.filter(f => !paths.includes(f));
  if (missing.length) problems.push(`The package is missing: ${missing.join(', ')}`);
  return problems;
}

export function checkTools(names) {
  const missing = TOOLS.filter(t => !names.includes(t));
  return missing.length ? [`tools/list is missing: ${missing.join(', ')}`] : [];
}

function fail(problems) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

async function main() {
  const root = new URL('..', import.meta.url);
  const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
  // npm run sets npm_execpath, which avoids npm.cmd and a shell on Windows.
  const npm = (args, cwd) => process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8' })
    : execFileSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  const tmp = mkdtempSync(join(tmpdir(), 'anysite-pack-'));
  try {
    const [pack] = JSON.parse(npm(['pack', '--json', '--pack-destination', tmp], root));
    const problems = checkPackFiles(pack.files.map(f => f.path));
    if (problems.length) fail(problems);
    console.log(`Packed ${pack.filename}: ${pack.files.length} files, all expected.`);

    const app = join(tmp, 'app');
    npm(['install', '--prefix', app, '--no-audit', '--no-fund', '--loglevel=error', join(tmp, pack.filename)], tmp);
    const serverJs = join(app, 'node_modules', 'anysite-mcp', 'server.js');
    const env = { ...process.env, ANYSITE_HOME: join(tmp, 'home') };

    const printed = execFileSync(process.execPath, [serverJs, '--version'], { env, encoding: 'utf8' }).trim();
    if (printed !== version) fail([`The installed server.js --version printed "${printed}", expected "${version}".`]);
    console.log(`Installed server.js --version: ${printed}.`);

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const client = new Client({ name: 'smoke-pack', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverJs], env, stderr: 'inherit' }));
    try {
      const info = client.getServerVersion();
      if (info?.version !== version) fail([`initialize reported version ${info?.version}, expected ${version}.`]);
      const { tools } = await client.listTools();
      const missing = checkTools(tools.map(t => t.name));
      if (missing.length) fail(missing);
      console.log(`MCP handshake OK: ${info.name} ${info.version}, ${tools.length} tools.`);
    } finally {
      await client.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
