import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEvent, parametrize } from '../lib/recorder.js';

test('addEvent: clicks, selects, and typing into the same field again updates the step', () => {
  const steps = [{ action: 'open', url: 'https://shop.test/' }];
  addEvent(steps, { kind: 'type', role: 'textbox', name: 'Search', value: 'ki' });
  addEvent(steps, { kind: 'type', role: 'textbox', name: 'Search', value: 'kiwi', submit: true });
  addEvent(steps, { kind: 'click', role: 'button', name: 'Go' });
  addEvent(steps, { kind: 'click', text: 'More' });
  addEvent(steps, { kind: 'select', role: 'combobox', name: 'Sort', value: 'price' });
  addEvent(steps, { kind: 'click', role: 'button' }); // no name or text: nothing to find it by
  assert.deepEqual(steps.slice(1), [
    { action: 'type', role: 'textbox', name: 'Search', value: 'kiwi', submit: true },
    { action: 'click', role: 'button', name: 'Go' },
    { action: 'click', text: 'More' },
    { action: 'select', role: 'combobox', name: 'Sort', value: 'price' },
  ]);
});

test('addEvent: typing into another field adds a step', () => {
  const steps = [];
  addEvent(steps, { kind: 'type', role: 'textbox', name: 'First', value: 'a' });
  addEvent(steps, { kind: 'type', role: 'textbox', name: 'Last', value: 'b' });
  assert.equal(steps.length, 2);
});

test('parametrize: typed values become params with what was typed as the default', () => {
  const { params, steps } = parametrize([
    { action: 'open', url: '/' },
    { action: 'type', role: 'textbox', name: 'Product search', value: 'nuts' },
    { action: 'type', role: 'textbox', name: 'Product search!', value: 'figs' },
    { action: 'select', role: 'combobox', name: '2nd choice', value: 'b' },
    { action: 'click', role: 'button', name: 'Go' },
  ]);
  assert.deepEqual(params, {
    product_search: { description: 'Value for Product search', default: 'nuts' },
    product_search_2: { description: 'Value for Product search!', default: 'figs' },
    v2nd_choice: { description: 'Value for 2nd choice', default: 'b' },
  });
  assert.deepEqual(steps.map(s => s.value), [undefined, '{{product_search}}', '{{product_search_2}}', '{{v2nd_choice}}', undefined]);
});
