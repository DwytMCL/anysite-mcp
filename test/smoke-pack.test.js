import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPackFiles, checkTools, TOOLS } from '../scripts/smoke-pack.js';

const good = ['package.json', 'server.js', 'README.md', 'LICENSE', 'CHANGELOG.md', 'lib/cli.js', 'sites/gemini.js'];

test('checkPackFiles accepts exactly the allowlist', () => {
  assert.deepEqual(checkPackFiles(good), []);
});

test('checkPackFiles names unexpected files, including the page-globals types', () => {
  const [problem] = checkPackFiles([...good, 'types/page-globals.d.ts', 'selfcheck.js', 'library2/x.js']);
  assert.match(problem, /shouldn't/);
  for (const f of ['types/page-globals.d.ts', 'selfcheck.js', 'library2/x.js']) assert.ok(problem.includes(f), f);
  assert.ok(!problem.includes('lib/cli.js'));
});

test('checkPackFiles names missing files', () => {
  assert.deepEqual(checkPackFiles(good.filter(f => f !== 'server.js')), ['The package is missing: server.js']);
});

test('checkTools', () => {
  assert.deepEqual(checkTools([...TOOLS, 'gemini_ask']), []);
  assert.deepEqual(checkTools(TOOLS.filter(t => t !== 'web_open')), ['tools/list is missing: web_open']);
});
