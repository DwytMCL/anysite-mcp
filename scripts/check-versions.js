// Checks that package.json, both versions in server.json and the top CHANGELOG.md heading agree.
// On a PR the heading may be "Unreleased"; with --release (the release workflow) it must be the version.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseVersions({ pkg, server, changelog }) {
  const heading = changelog.match(/^## (.*)$/m)?.[1].trim() ?? null;
  return { pkg: pkg.version, server: server.version, serverPackage: server.packages?.[0]?.version, heading };
}

export function checkHeading(heading, version, { release = false } = {}) {
  if (heading === version) return null;
  if (heading === 'Unreleased' && !release) return null;
  return release
    ? `CHANGELOG.md starts with "## ${heading}", but a release of ${version} needs "## ${version}" first.`
    : `CHANGELOG.md starts with "## ${heading}"; use "## Unreleased" or "## ${version}".`;
}

export function checkVersions(v, { release = false } = {}) {
  const problems = [];
  if (v.server !== v.pkg) problems.push(`server.json version is ${v.server}, package.json is ${v.pkg}.`);
  if (v.serverPackage !== v.pkg) problems.push(`server.json packages[0].version is ${v.serverPackage}, package.json is ${v.pkg}.`);
  const h = checkHeading(v.heading, v.pkg, { release });
  if (h) problems.push(h);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const release = process.argv.includes('--release');
  const v = parseVersions({ pkg: JSON.parse(read('package.json')), server: JSON.parse(read('server.json')),
    changelog: read('CHANGELOG.md') });
  const problems = checkVersions(v, { release });
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(`Versions agree: ${v.pkg}${release ? ' (release)' : ''}.`);
}
