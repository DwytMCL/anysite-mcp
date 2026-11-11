import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLicenses, licenseAllowed } from '../scripts/check-licenses.js';

const lock = packages => ({ lockfileVersion: 3, packages });

test('allowed licences pass and are counted', () => {
  assert.deepEqual(checkLicenses(lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/b/node_modules/c': { version: '2.0.0', license: 'ISC' } })), { checked: 2, problems: [] });
});

test('a licence that is not allowed is reported', () => {
  assert.deepEqual(checkLicenses(lock({ 'node_modules/a': { version: '1.0.0', license: 'GPL-3.0-only' } })).problems,
    ['a@1.0.0 is licensed "GPL-3.0-only", which isn\'t allowed.']);
});

test('a missing licence is reported', () => {
  assert.deepEqual(checkLicenses(lock({ 'node_modules/@s/a': { version: '1.0.0' } })).problems,
    ['@s/a@1.0.0 has no license.']);
});

test('dev-only packages and the root entry are skipped', () => {
  assert.deepEqual(checkLicenses(lock({ '': { name: 'root', version: '0.1.0' },
    'node_modules/a': { version: '1.0.0', license: 'GPL-3.0-only', dev: true } })), { checked: 0, problems: [] });
});

test('OR passes if any part is allowed, AND only if every part is', () => {
  assert.equal(licenseAllowed('(MIT OR GPL-3.0-only)'), true);
  assert.equal(licenseAllowed('GPL-2.0-only OR LGPL-2.1-only'), false);
  assert.equal(licenseAllowed('MIT AND ISC'), true);
  assert.equal(licenseAllowed('(MIT AND GPL-3.0-only)'), false);
  assert.equal(licenseAllowed('GPL-3.0-only OR MIT AND ISC'), true);
  assert.equal(licenseAllowed('(GPL-3.0-only OR MIT) AND CC-BY-4.0'), false);
  assert.equal(licenseAllowed('MIT OR'), false);
  assert.equal(licenseAllowed('Apache-2.0 WITH LLVM-exception'), false);
});
