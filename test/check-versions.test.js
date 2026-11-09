import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHeading, checkVersions, parseVersions } from '../scripts/check-versions.js';

const files = (v = '1.2.0', s = v, sp = v, heading = v) => ({ pkg: { version: v },
  server: { version: s, packages: [{ version: sp }] }, changelog: `# Changelog\n\nIntro\n\n## ${heading}\n\n- x\n\n## 1.1.0\n` });

test('parseVersions takes the first "## " heading', () => {
  assert.deepEqual(parseVersions(files('1.2.0', '1.2.0', '1.2.0', 'Unreleased')),
    { pkg: '1.2.0', server: '1.2.0', serverPackage: '1.2.0', heading: 'Unreleased' });
});

test('checkHeading', () => {
  assert.equal(checkHeading('Unreleased', '1.2.0'), null);
  assert.match(checkHeading('Unreleased', '1.2.0', { release: true }), /needs "## 1\.2\.0"/);
  assert.equal(checkHeading('1.2.0', '1.2.0'), null);
  assert.equal(checkHeading('1.2.0', '1.2.0', { release: true }), null);
  assert.match(checkHeading('1.1.0', '1.2.0'), /starts with "## 1\.1\.0"/);
  assert.match(checkHeading('1.1.0', '1.2.0', { release: true }), /needs "## 1\.2\.0"/);
});

test('checkVersions reports each server.json mismatch, and nothing when all match', () => {
  assert.deepEqual(checkVersions(parseVersions(files())), []);
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.1.0'))), ['server.json version is 1.1.0, package.json is 1.2.0.']);
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.1.0'))),
    ['server.json packages[0].version is 1.1.0, package.json is 1.2.0.']);
  assert.equal(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.2.0', 'Unreleased')), { release: true }).length, 1);
});
