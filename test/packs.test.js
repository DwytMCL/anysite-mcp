import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyAnswer } from '../sites/notebooklm.js';
import { dropLeadIn } from '../sites/gemini.js';

test('tidyAnswer: drops the Thoughts label, joins citation numbers, cuts at Save to note', () => {
  const lines = ['Thoughts', 'The RC test code word is pineapple', '1', '.', 'A hash table maps keys to values', '2', '3', '.',
    'Save to note', "Let's go with option A", 'Option B sounds good!'];
  assert.deepEqual(tidyAnswer(lines), ['The RC test code word is pineapple[1].', 'A hash table maps keys to values[2][3].']);
});

test('tidyAnswer: leaves a plain answer alone', () => {
  assert.deepEqual(tidyAnswer(['One line.', 'Two lines.']), ['One line.', 'Two lines.']);
  assert.deepEqual(tidyAnswer(['42']), ['42']);
});

test('dropLeadIn: removes a trailing lead-in only when buttons followed it', () => {
  const t = 'Answer here.\n\nTo explore how this applies to your projects:';
  assert.equal(dropLeadIn(t, true), 'Answer here.');
  assert.equal(dropLeadIn(t, false), t);
  assert.equal(dropLeadIn('No colon at the end.', true), 'No colon at the end.');
});
