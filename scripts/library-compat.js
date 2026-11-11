// Builds the library site and checks it against the CLI people already have: the published anysite-mcp 0.6.0 must
// still list and add from it (the old URLs are unchanged), and this checkout's CLI must add every file, v1 or not.
// The fixture has the new fields (needsSignIn, example), which an old CLI has to accept. Needs the network (npm).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../shortcuts-library/build.js';

const OLD = '0.6.0';
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(root, 'test', 'fixtures', 'library-compat');
const tmp = mkdtempSync(join(tmpdir(), 'anysite-compat-'));
const problems = [];
const expect = (ok, what, out) => { if (!ok) problems.push(`${what}${out ? `\n${out}` : ''}`); };

const node = (server, args, env) => {
  try { return execFileSync(process.execPath, [server, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return `FAILED: ${e.message}\n${e.stdout}${e.stderr}`; }
};

try {
  const npm = process.env.npm_execpath
    ? (a, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...a], { cwd, stdio: 'inherit' })
    : (a, cwd) => execFileSync('npm', a, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  const oldDir = join(tmp, 'old');
  npm(['install', '--prefix', oldDir, '--no-audit', '--no-fund', `anysite-mcp@${OLD}`], tmp);
  const oldServer = join(oldDir, 'node_modules', 'anysite-mcp', 'server.js');

  const sites = { fixture: { libDir: fixtures, out: join(tmp, 'fixture-site'), site: 'example.com' },
    real: { libDir: join(root, 'library'), out: join(tmp, 'real-site'), site: 'github.com' } };
  for (const [label, s] of Object.entries(sites)) {
    build({ libDir: s.libDir, out: s.out, health: join(tmp, 'none.json') });
    const lib = join(s.out, 'library');
    const home = () => ({ ANYSITE_HOME: mkdtempSync(join(tmp, 'home-')), ANYSITE_LIBRARY: lib });
    for (const [who, server] of [[`${OLD} CLI`, oldServer], ['this CLI', join(root, 'server.js')]]) {
      const list = node(server, ['library', 'list'], home());
      expect(list.includes(s.site), `${who}: library list (${label}) does not show ${s.site}`, list);
      const files = readdirSync(lib).filter(f => f.endsWith('.json') && !['index.json', 'health.json'].includes(f));
      for (const f of files) {
        const out = node(server, ['add', f.slice(0, -5), '--from', join(lib, f)], home());
        expect(/Added from/.test(out), `${who}: add ${f} (${label}) from the original URL file failed`, out);
      }
    }
    // Only this CLI knows v1: every envelope file must add too.
    for (const f of readdirSync(join(lib, 'v1')).filter(f => f !== 'index.json')) {
      const out = node(join(root, 'server.js'), ['add', f.slice(0, -5), '--from', join(lib, 'v1', f)], home());
      expect(/Added from/.test(out), `this CLI: add v1/${f} (${label}) failed`, out);
    }
    // And with no --from, add reads v1/<site>.json from the library.
    const viaLib = node(join(root, 'server.js'), ['add', s.site], home());
    expect(viaLib.includes(join('v1', `${s.site}.json`)), `this CLI: add ${s.site} did not read v1/`, viaLib);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`Library compatibility OK: ${OLD} CLI and this CLI read the built library.`);
