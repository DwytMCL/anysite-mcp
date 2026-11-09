import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changes } from '../lib/snapshot.js';

const page = (out = '') => ['- heading "Shop" [ref=e1]', '- main [ref=e2]:', '  - list [ref=e3]:',
  '    - listitem "Apples" [ref=e4]', '    - listitem "Pears" [ref=e5]', '    - listitem "Plums" [ref=e6]',
  `  - paragraph [ref=e7]: ${out}`, '- link "About" [ref=e8]'].join('\n');

test('changes: nothing changed', () => {
  assert.match(changes(page(), page()), /^Nothing changed on the page/);
});

test('changes: only new lines, with their parents for context', () => {
  const out = changes(page(), page('Results for kiwi'));
  assert.match(out, /^Changed since the last snapshot \(1 line gone; web_snapshot shows all\):/);
  assert.match(out, /- main \[ref=e2\]:\n {2}…\n {2}- paragraph \[ref=e7\]: Results for kiwi$/);
  assert.doesNotMatch(out, /Apples|About/, 'unchanged lines are left out');
});

test('changes: gaps between kept lines are marked', () => {
  const out = changes(page().replace('Apples', 'Kiwis'), page('x'));
  assert.match(out, /\(2 lines gone/);
  assert.match(out, / {4}- listitem "Apples" \[ref=e4\]\n {2}…\n {2}- paragraph \[ref=e7\]: x$/);
});

test('changes: a mostly new page is returned whole', () => {
  const after = '- heading "Other" [ref=e9]\n- paragraph [ref=e10]: hi';
  assert.equal(changes(page(), after), after);
});
