import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameUnreleased, setServerVersions } from '../scripts/prepare-release.js';

test('setServerVersions sets both versions and keeps the line endings', () => {
  const crlf = JSON.stringify({ name: 'x', version: '1.0.0', packages: [{ version: '1.0.0' }] }, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  const out = setServerVersions(crlf, '1.1.0-rc.0');
  assert.deepEqual(JSON.parse(out), { name: 'x', version: '1.1.0-rc.0', packages: [{ version: '1.1.0-rc.0' }] });
  assert.ok(out.endsWith('}\r\n'));
  assert.ok(!/[^\r]\n/.test(out));
  assert.ok(setServerVersions('{"version":"1","packages":[{}]}', '2.0.0').endsWith('}\n'));
  assert.throws(() => setServerVersions('{"version":"1"}', '2.0.0'), /no packages/);
});

test('renameUnreleased renames the Unreleased heading for a final release', () => {
  assert.equal(renameUnreleased('# C\n\n## Unreleased\n\n- x\n\n## 1.0.0\n', '1.1.0'), '# C\n\n## 1.1.0\n\n- x\n\n## 1.0.0\n');
  assert.equal(renameUnreleased('## Unreleased\r\n- x\r\n', '1.1.0'), '## 1.1.0\r\n- x\r\n');
});

test('renameUnreleased refuses a missing or empty Unreleased section', () => {
  assert.throws(() => renameUnreleased('## 1.0.0\n- x\n', '1.1.0'), /starts with "## 1\.0\.0"/);
  assert.throws(() => renameUnreleased('## Unreleased\n\n## 1.0.0\n- x\n', '1.1.0'), /empty/);
});

test('renameUnreleased leaves the changelog alone for a pre-release', () => {
  const log = '## Unreleased\n\n## 1.0.0\n';
  assert.equal(renameUnreleased(log, '1.1.0-rc.0'), log);
});
