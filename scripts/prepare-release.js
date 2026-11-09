// Sets the version in both places in server.json and, for a final release, renames "## Unreleased" in CHANGELOG.md
// to the version. Run after `npm version`, which updates package.json and package-lock.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isPrerelease } from './check-versions.js';
import { section } from './release-notes.js';

const eol = text => (text.includes('\r\n') ? '\r\n' : '\n');

export function setServerVersions(text, version) {
  const server = JSON.parse(text);
  server.version = version;
  if (!server.packages?.length) throw new Error('server.json has no packages entry.');
  for (const p of server.packages) p.version = version;
  return (JSON.stringify(server, null, 2) + '\n').replace(/\n/g, eol(text));
}

export function renameUnreleased(changelog, version) {
  if (isPrerelease(version)) return changelog;
  const first = changelog.match(/^## (.*)$/m)?.[1].trim();
  if (first !== 'Unreleased') throw new Error(`CHANGELOG.md starts with "## ${first}", not "## Unreleased".`);
  if (!section(changelog, 'Unreleased')) throw new Error('CHANGELOG.md\'s "## Unreleased" section is empty.');
  return changelog.replace(/^## Unreleased[ \t]*$/m, `## ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2]?.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version ?? '')) {
    console.error('Usage: node scripts/prepare-release.js <version>, e.g. 0.5.0 or 0.5.0-rc.0');
    process.exit(2);
  }
  const file = f => new URL(`../${f}`, import.meta.url);
  try {
    const changelog = renameUnreleased(readFileSync(file('CHANGELOG.md'), 'utf8'), version);
    const server = setServerVersions(readFileSync(file('server.json'), 'utf8'), version);
    writeFileSync(file('CHANGELOG.md'), changelog);
    writeFileSync(file('server.json'), server);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`Prepared ${version}.`);
}
