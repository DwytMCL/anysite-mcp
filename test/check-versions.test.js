import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHeading, checkVersions, isPrerelease, parseVersions } from '../scripts/check-versions.js';

const files = (v = '1.2.0', s = v, sp = v, heading = v, l = v, lr = l) => ({ pkg: { version: v },
  lock: { version: l, packages: { '': { version: lr } } },
  server: { version: s, packages: [{ version: sp }] }, changelog: `# Changelog\n\nIntro\n\n## ${heading}\n\n- x\n\n## 1.1.0\n` });

test('parseVersions takes the first "## " heading and both lockfile versions', () => {
  assert.deepEqual(parseVersions(files('1.2.0', '1.2.0', '1.2.0', 'Unreleased')),
    { pkg: '1.2.0', lock: '1.2.0', lockRoot: '1.2.0', server: '1.2.0', serverPackage: '1.2.0', heading: 'Unreleased' });
});

test('isPrerelease', () => {
  assert.equal(isPrerelease('0.5.0-rc.0'), true);
  assert.equal(isPrerelease('0.5.0'), false);
});

test('checkHeading', () => {
  assert.equal(checkHeading('Unreleased', '1.2.0'), null);
  assert.match(checkHeading('Unreleased', '1.2.0', { release: true }), /needs "## 1\.2\.0"/);
  assert.equal(checkHeading('1.2.0', '1.2.0'), null);
  assert.equal(checkHeading('1.2.0', '1.2.0', { release: true }), null);
  assert.match(checkHeading('1.1.0', '1.2.0'), /starts with "## 1\.1\.0"/);
  assert.match(checkHeading('1.1.0', '1.2.0', { release: true }), /needs "## 1\.2\.0"/);
});

test('a pre-release may ship from Unreleased or its own heading, but not an older one', () => {
  assert.equal(checkHeading('Unreleased', '1.3.0-rc.0', { release: true }), null);
  assert.equal(checkHeading('1.3.0-rc.0', '1.3.0-rc.0', { release: true }), null);
  assert.match(checkHeading('1.2.0', '1.3.0-rc.0', { release: true }), /needs "## 1\.3\.0-rc\.0"/);
});

test('checkVersions reports each mismatch, and nothing when all match', () => {
  assert.deepEqual(checkVersions(parseVersions(files())), []);
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.1.0'))), ['server.json version is 1.1.0, package.json is 1.2.0.']);
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.1.0'))),
    ['server.json packages[0].version is 1.1.0, package.json is 1.2.0.']);
  assert.equal(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.2.0', 'Unreleased')), { release: true }).length, 1);
});

test('checkVersions reports a lockfile out of step with package.json', () => {
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.2.0', '1.2.0', '1.1.0', '1.2.0'))),
    ['package-lock.json version is 1.1.0, package.json is 1.2.0.']);
  assert.deepEqual(checkVersions(parseVersions(files('1.2.0', '1.2.0', '1.2.0', '1.2.0', '1.2.0', '1.1.0'))),
    ['package-lock.json packages[""].version is 1.1.0, package.json is 1.2.0.']);
});
