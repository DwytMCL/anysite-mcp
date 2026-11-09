import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNode } from '../lib/node-version.js';

test('checkNode refuses Node 18 and 20 with a clear message', () => {
  assert.equal(checkNode('18.20.0'), 'anysite-mcp needs Node 22 or newer; you have v18.20.0. Update Node: https://nodejs.org');
  assert.match(checkNode('20.19.0'), /needs Node 22 or newer; you have v20\.19\.0/);
  assert.match(checkNode('v20.19.0'), /you have v20\.19\.0\./);
});

test('checkNode accepts Node 22 and later', () => {
  assert.equal(checkNode('22.0.0'), null);
  assert.equal(checkNode('24.11.1'), null);
  assert.equal(checkNode('26.0.0'), null);
});

test('checkNode takes another minimum', () => {
  assert.equal(checkNode('22.5.0', 24), 'anysite-mcp needs Node 24 or newer; you have v22.5.0. Update Node: https://nodejs.org');
});
