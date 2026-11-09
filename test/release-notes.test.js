import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseNotes, section } from '../scripts/release-notes.js';

const log = '# Changelog\r\n\r\n## Unreleased\r\n\r\n- next\r\n\r\n## 1.2.0\r\n\r\nIntro\r\n\r\n- a\r\n\r\n## 1.1.0\r\n\r\n- old\r\n';

test('section returns the text up to the next heading, and null when missing', () => {
  assert.equal(section(log, '1.2.0'), 'Intro\n\n- a');
  assert.equal(section(log, '1.1.0'), '- old');
  assert.equal(section(log, '1.0.0'), null);
  assert.equal(section('## 1.10.0\n- x\n', '1.1.0'), null, 'no prefix or regex match');
});

test('a final release uses its own section', () => {
  assert.equal(releaseNotes(log, '1.2.0'), 'Intro\n\n- a');
  assert.throws(() => releaseNotes(log, '1.3.0'), /no notes under "## 1\.3\.0"/);
});

test('a pre-release uses its own section, or Unreleased', () => {
  assert.equal(releaseNotes(log, '1.3.0-rc.0'), '- next');
  assert.equal(releaseNotes('## 1.3.0-rc.0\n- rc\n## Unreleased\n- u\n', '1.3.0-rc.0'), '- rc');
  assert.throws(() => releaseNotes('## Unreleased\n\n## 1.2.0\n- a\n', '1.3.0-rc.0'), /"## 1\.3\.0-rc\.0" or "## Unreleased"/);
});
