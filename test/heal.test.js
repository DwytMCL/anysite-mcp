import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRole, closest, elements, similarity } from '../lib/heal.js';

test('similarity: same words, containment, shared words', () => {
  assert.equal(similarity('Go', 'go'), 1);
  assert.equal(similarity('Search products', 'Product search'), 1, 'word order and plurals do not matter');
  const contained = similarity('Search', 'Search the shop');
  assert(contained > 0.6 && contained < 1, String(contained));
  assert.equal(similarity('Send', 'Delete'), 0);
  assert.equal(similarity('', 'x'), 0);
});

test('closest: one clear winner of a kindred role, else null', () => {
  const els = [{ role: 'link', name: 'Go' }, { role: 'heading', name: 'Go' }, { role: 'textbox', name: 'Product search' }];
  assert.deepEqual(closest({ role: 'button', name: 'Go' }, els), { role: 'link', name: 'Go' });
  assert.deepEqual(closest({ role: 'textbox', name: 'Search products' }, els), { role: 'textbox', name: 'Product search' });
  assert.equal(closest({ role: 'button', name: 'Checkout' }, els), null, 'nothing close enough');
  assert.equal(closest({ role: 'button', name: 'Go' }, [{ role: 'link', name: 'Go' }, { role: 'tab', name: 'Go' }]), null, 'a tie is not a winner');
  assert.deepEqual(closest({ role: 'searchbox' }, [{ role: 'combobox', name: 'Find' }]), { role: 'combobox', name: 'Find' });
  assert.equal(closest({ name: 'x' }, []), null);
});

test('checkRole: known roles pass, typos get a suggestion', () => {
  assert.doesNotThrow(() => checkRole('button'));
  assert.doesNotThrow(() => checkRole(undefined));
  assert.throws(() => checkRole('lnk'), /unknown role "lnk"; did you mean "link"/);
  assert.throws(() => checkRole('dialgo', 'within role'), /unknown within role "dialgo"; did you mean "dialog"/);
});

test('elements: role and name of each element in an AI-mode snapshot', () => {
  const tree = '- heading "Test shop" [level=1] [ref=e1]\n- button "Go" [ref=e2]\n  - link "Say \\"hi\\"" [ref=e3]\n- textbox [ref=e4]\n- notarole "x"';
  assert.deepEqual(elements(tree), [{ role: 'heading', name: 'Test shop' }, { role: 'button', name: 'Go' },
    { role: 'link', name: 'Say "hi"' }, { role: 'textbox', name: '' }]);
});
