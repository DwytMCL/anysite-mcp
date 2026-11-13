import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokenTwoNights, classify, decide, KEEP_NIGHTS, looksBlocked, updateHistory } from '../scripts/nightly.js';
import { healthEntries } from '../scripts/library-health.js';

const night = (date, results) => ({ date, results: Object.fromEntries(Object.entries(results).map(([k, status]) => [k, { status, detail: status === 'broken' ? 'gone' : '' }])) });
const history = (...nights) => ({ nights });

test('looksBlocked: refusals and challenge pages, not ordinary failures', () => {
  for (const t of ['HTTP 403', 'Too Many Requests', 'Just a moment...', 'Attention Required! | Cloudflare', 'Access denied', 'Please complete the CAPTCHA'])
    assert.ok(looksBlocked(t), t);
  for (const t of ['no button "Search" found', 'Timeout 30000ms exceeded', '', undefined, 'item 4030 of 5'])
    assert.ok(!looksBlocked(t), String(t));
});

test('classify: a blocked site is "couldn\'t check", never broken; a real break and a pass are left alone', () => {
  const blocked = classify({ status: 'broken', detail: 'no link found' }, true);
  assert.deepEqual([blocked.status, blocked.blocked], ['unchecked', true]);
  assert.match(blocked.detail, /Couldn't check: the site blocked the check/);
  assert.equal(classify({ status: 'broken', detail: 'Navigation failed: 429' }, false).blocked, true);
  assert.deepEqual(classify({ status: 'broken', detail: 'no link found' }, false), { status: 'broken', detail: 'no link found' });
  assert.deepEqual(classify({ status: 'ok', detail: '' }, true), { status: 'ok', detail: '' });
});

test('healthEntries: a blocked site\'s broken shortcuts become unchecked, and passing ones stay ok', () => {
  const e = healthEntries('a.com', { x: 'h1', y: 'h2' }, [{ name: 'x', status: 'broken', detail: 'no link' }, { name: 'y', status: 'ok', detail: '' }], undefined, [], true);
  assert.deepEqual([e['a.com/x'].status, e['a.com/x'].blocked, e['a.com/y'].status], ['unchecked', true, 'ok']);
});

test('updateHistory: adds the night as blocked/broken/ok, replaces the same date, and keeps the last nights', () => {
  const health = { checked: '2026-11-14T04:30:00Z', shortcuts: {
    'a/x': { status: 'ok', detail: '' }, 'a/y': { status: 'broken', detail: 'gone' }, 'a/z': { status: 'unchecked', blocked: true, detail: "Couldn't check" } } };
  const h = updateHistory(undefined, health);
  assert.deepEqual(Object.fromEntries(Object.entries(h.nights[0].results).map(([k, v]) => [k, v.status])), { 'a/x': 'ok', 'a/y': 'broken', 'a/z': 'blocked' });
  assert.equal(updateHistory(h, health).nights.length, 1);
  let long = h;
  for (let i = 0; i < 20; i++) long = updateHistory(long, { ...health, checked: `2026-12-${String(i + 1).padStart(2, '0')}T04:30:00Z` });
  assert.equal(long.nights.length, KEEP_NIGHTS);
});

test('brokenTwoNights: needs two broken nights in a row; a blocked or passing night in between resets it', () => {
  assert.deepEqual(brokenTwoNights(history(night('1', { x: 'broken' }))), []);
  assert.deepEqual(brokenTwoNights(history(night('1', { x: 'broken' }), night('2', { x: 'broken' }))), ['x']);
  assert.deepEqual(brokenTwoNights(history(night('1', { x: 'broken' }), night('2', { x: 'blocked' }))), []);
  assert.deepEqual(brokenTwoNights(history(night('1', { x: 'ok' }), night('2', { x: 'broken' }))), []);
  assert.deepEqual(brokenTwoNights(history(night('1', { x: 'broken', y: 'broken' }), night('2', { x: 'broken', y: 'ok' }))), ['x']);
});

test('decide: opens after two broken nights, comments while it stays broken, closes when nothing is broken', () => {
  const one = history(night('2026-11-13', { 'a/x': 'broken' }));
  const two = history(night('2026-11-13', { 'a/x': 'broken' }), night('2026-11-14', { 'a/x': 'broken' }));
  assert.equal(decide(one, false).action, 'none');
  assert.equal(decide(two, false).action, 'open');
  assert.match(decide(two, false).body, /`a\/x`: gone/);
  assert.equal(decide(two, true).action, 'comment');
  const fixed = history(...two.nights, night('2026-11-15', { 'a/x': 'ok' }));
  assert.equal(decide(fixed, true).action, 'close');
  assert.equal(decide(fixed, false).action, 'none');
});

test('decide: a night with only blocked or unchecked results never closes the issue', () => {
  const quiet = history(night('1', { x: 'broken' }), night('2', { x: 'broken' }), night('3', { x: 'blocked', y: 'unchecked' }));
  assert.equal(decide(quiet, true).action, 'none');
  assert.equal(decide(history(night('1', {})), true).action, 'none');
});
