// Prints the CHANGELOG.md section for a version: the release notes for its GitHub release.
// A pre-release (e.g. 0.5.0-rc.0) uses its own section if there is one, otherwise "Unreleased".
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isPrerelease } from './check-versions.js';

// The text under "## <heading>" up to the next "## ", trimmed; null if there's no such heading.
export function section(changelog, heading) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(l => l.trimEnd() === `## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

export function releaseNotes(changelog, version) {
  const headings = isPrerelease(version) ? [version, 'Unreleased'] : [version];
  for (const h of headings) {
    const notes = section(changelog, h);
    if (notes) return notes;
  }
  throw new Error(`CHANGELOG.md has no notes under ${headings.map(h => `"## ${h}"`).join(' or ')}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2]?.replace(/^v/, '');
  if (!version) {
    console.error('Usage: node scripts/release-notes.js <version>');
    process.exit(2);
  }
  try {
    console.log(releaseNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
