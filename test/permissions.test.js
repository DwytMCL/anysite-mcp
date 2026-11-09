import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseDomain, hostAllowed, readSettings, RISKY, RISKY_HREF, SEARCHY, writeSiteSettings } from '../lib/permissions.js';

test('baseDomain', () => {
  assert.equal(baseDomain('mail.google.com'), 'google.com');
  assert.equal(baseDomain('github.com'), 'github.com');
  assert.equal(baseDomain('bbc.co.uk'), 'bbc.co.uk');
  assert.equal(baseDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(baseDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(baseDomain('localhost'), 'localhost');
});

test('hostAllowed', () => {
  assert(hostAllowed('github.com', ['github.com']));
  assert(hostAllowed('gist.github.com', ['github.com']));
  assert(!hostAllowed('evilgithub.com', ['github.com']), 'a suffix that is not a subdomain');
  assert(!hostAllowed('example.org', ['github.com']));
  assert(hostAllowed('example.org', ['*']));
});

test('writeSiteSettings: merges, null removes a key, an empty site is dropped', t => {
  const dir = mkdtempSync(join(tmpdir(), 'anysite-perm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'nested', 'settings.json');
  assert.deepEqual(readSettings(file), {});
  assert.deepEqual(writeSiteSettings(file, 'a.com', { read_only: true }), { read_only: true });
  writeSiteSettings(file, 'a.com', { confirm: true });
  writeSiteSettings(file, 'b.com', { allowed_domains: ['b.com'] });
  assert.deepEqual(readSettings(file).sites, { 'a.com': { read_only: true, confirm: true }, 'b.com': { allowed_domains: ['b.com'] } });
  writeSiteSettings(file, 'a.com', { read_only: null, confirm: null });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sites, { 'b.com': { allowed_domains: ['b.com'] } });
  writeFileSync(file, '{ nope');
  assert.throws(() => readSettings(file), /is not valid JSON/);
});

test('RISKY, RISKY_HREF and SEARCHY', () => {
  for (const l of ['Send message', 'Buy now', 'Delete', 'Log out', 'Sign out']) assert(RISKY.test(l), l);
  for (const l of ['Search', 'Next page', 'About', 'Sender details']) assert(!RISKY.test(l), l);
  for (const h of ['/logout', '/account/sign-out', '/items/3/delete', '/unsubscribe']) assert(RISKY_HREF.test(h), h);
  assert(!RISKY_HREF.test('/about'));
  for (const l of ['Search products', 'Find', 'Filter results', 'Look up']) assert(SEARCHY.test(l), l);
  assert(!SEARCHY.test('Message'));
});
