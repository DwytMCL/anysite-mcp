import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fileHashes, healthEntries } from '../scripts/library-health.js';
import { indexEntries } from '../shortcuts-library/build.js';

const libDir = fileURLToPath(new URL('../library/', import.meta.url));

test('healthEntries: doctor results by shortcut, with the hashes from the file', () => {
  const data = { a: { description: 'A', steps: [{ action: 'read' }] }, b: { description: 'B', steps: [{ action: 'open', url: '/' }] },
    c: { description: 'C', steps: [{ action: 'snapshot' }] } };
  const hashes = fileHashes(data);
  const entries = healthEntries('example.com', hashes, [
    { name: 'a', status: 'ok', detail: '' }, { name: 'b', status: 'repaired', detail: 'repaired link "x"' }]);
  assert.deepEqual(entries, {
    'example.com/a': { status: 'ok', detail: '', steps: hashes.a },
    'example.com/b': { status: 'repaired', detail: 'repaired link "x"', steps: hashes.b },
    'example.com/c': { status: 'broken', detail: 'Not checked: doctor did not report it.', steps: hashes.c } });
  const failed = healthEntries('example.com', hashes, [], 'Could not start Chrome');
  assert.deepEqual(Object.values(failed).map(e => [e.status, e.detail]), Array(3).fill(['broken', 'Could not start Chrome']));
});

test('every real library file: build.js and the health check hash the same steps the same', () => {
  const files = readdirSync(libDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length);
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(libDir, f), 'utf8'));
    const hashes = fileHashes(data);
    const index = indexEntries(f.slice(0, -5), data);
    assert.equal(index.length, Object.keys(hashes).length, f);
    for (const e of index) assert.equal(e.stepsHash, hashes[e.name], `${f}: ${e.name}`);
  }
});
