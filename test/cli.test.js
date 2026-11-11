import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../server.js', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const home = mkdtempSync(join(tmpdir(), 'anysite-cli-'));
test.after(() => rmSync(home, { recursive: true, force: true }));

const lib = join(home, 'lib');
mkdirSync(lib);
const steps = [{ action: 'open', url: '/?q={{q}}' }, { action: 'read' }];
writeFileSync(join(lib, 'index.json'), JSON.stringify({ sites: ['example.com'], shortcuts: [
  { site: 'example.com', name: 'find', tool: 'example_com_find', description: 'Find a page', params: { q: 'Query' }, steps }] }));
const shared = join(home, 'shared.json');
writeFileSync(shared, JSON.stringify({ find: { description: 'Find a page', params: { q: 'Query' }, steps } }));

const run = (...args) => {
  const r = spawnSync(process.execPath, [server, ...args], { encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ANYSITE_HOME: home, ANYSITE_LIBRARY: lib } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('--version and -v print the version', () => {
  for (const f of ['--version', '-v']) assert.deepEqual([run(f).code, run(f).out.trim()], [0, version]);
});

test('--help and -h list every command and flag', () => {
  for (const f of ['--help', '-h']) {
    const { code, out } = run(f);
    assert.equal(code, 0);
    for (const w of ['login <site>', 'record <site> <name>', 'add <site>', '--from', '--force', 'library search', 'library list',
      'library info', 'doctor', 'permissions <site>', '--read-only', '--read-write', '--confirm', '--no-confirm', '--allow <domain',
      '--allow-any', '--allow-default', '--version', 'ANYSITE_HOME', 'ANYSITE_CHROME', 'ANYSITE_CHROME_ARGS', 'ANYSITE_HEADLESS',
      'ANYSITE_DOWNLOADS', 'ANYSITE_LIBRARY']) assert.ok(out.includes(w), `help mentions ${w}`);
  }
});

test('login and record without arguments exit 1 with usage', () => {
  assert.deepEqual([run('login').code, /Usage: anysite-mcp login/.test(run('login').err)], [1, true]);
  assert.match(run('record', 'example.com', 'Bad Name').err, /Usage: anysite-mcp record/);
  assert.equal(run('record', 'example.com', 'Bad Name').code, 1);
});

test('add --from adds, skips an existing shortcut, and --force replaces it', () => {
  let r = run('add', 'example.com', '--from', shared);
  assert.equal(r.code, 0);
  assert.match(r.out, /\+ example_com_find: Find a page/);
  r = run('add', 'example.com', '--from', shared);
  assert.match(r.out, /already exists \(--force replaces it\)/);
  assert.match(r.out, /Nothing added/);
  assert.match(run('add', 'example.com/find', '--from', shared, '--force').out, /\+ example_com_find/);
  const r2 = run('add', 'example.com/nope', '--from', shared);
  assert.equal(r2.code, 1);
  assert.equal(run('add').code, 1);
});

test('library list, search and info read ANYSITE_LIBRARY', () => {
  assert.match(run('library', 'list').out, /example\.com/);
  assert.match(run('library', 'list', 'example.com').out, /find/);
  assert.match(run('library', 'search', 'find').out, /example_com_find|example\.com/);
  assert.match(run('library', 'search', 'zzzz').out, /No shared shortcuts match "zzzz"/);
  assert.match(run('library', 'info', 'example.com/find').out, /find/);
  assert.equal(run('library').code, 1);
  assert.equal(run('library', 'search').code, 1);
  assert.equal(run('library', 'bogus').code, 1);
});

test('library exits 1 when the library cannot be read', () => {
  const r = spawnSync(process.execPath, [server, 'library', 'list'], { encoding: 'utf8',
    env: { ...process.env, ANYSITE_HOME: home, ANYSITE_LIBRARY: join(home, 'missing') } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Couldn't load the Shortcut Library/);
});

test('permissions shows, sets and clears each setting, and writes settings.json', () => {
  assert.equal(run('permissions').code, 1);
  assert.match(run('permissions', 'example.com').out, /read and write; does not ask before acting; may open example\.com \(default\)/);
  assert.match(run('permissions', 'example.com', '--read-only', '--confirm').out, /read-only; asks you before/);
  assert.match(run('permissions', 'example.com', '--allow', 'a.com, b.com').out, /may open a\.com, b\.com\./);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).sites['example.com'],
    { read_only: true, confirm: true, allowed_domains: ['a.com', 'b.com'] });
  assert.match(run('permissions', 'example.com', '--allow-any').out, /may open \*\./);
  assert.match(run('permissions', 'example.com', '--read-write', '--no-confirm', '--allow-default').out,
    /read and write; does not ask before acting; may open example\.com \(default\)/);
  assert.equal(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).sites?.['example.com'], undefined);
});
