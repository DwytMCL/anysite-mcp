// Checks that every runtime dependency in package-lock.json has an allowed licence. Dev-only packages are skipped,
// because they never ship to users. An "OR" expression passes if any part is allowed, "AND" only if every part is.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0'];

// Evaluates an SPDX expression with AND binding tighter than OR, as SPDX defines; anything unparseable fails.
export function licenseAllowed(expression, allowed = ALLOWED) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const primary = () => {
    if (tokens[i] === '(') { i++; const v = or(); if (tokens[i++] !== ')') throw new Error('unbalanced'); return v; }
    const id = tokens[i++];
    if (!id || /^(AND|OR|WITH)$/i.test(id) || id === ')') throw new Error('unexpected');
    return allowed.includes(id);
  };
  const and = () => { let v = primary(); while (/^AND$/i.test(tokens[i] ?? '')) { i++; v = primary() && v; } return v; };
  const or = () => { let v = and(); while (/^OR$/i.test(tokens[i] ?? '')) { i++; v = and() || v; } return v; };
  try {
    const v = or();
    return i === tokens.length && v;
  } catch {
    return false;
  }
}

export function checkLicenses(lock, allowed = ALLOWED) {
  const problems = [];
  let checked = 0;
  for (const [path, pkg] of Object.entries(lock?.packages ?? {})) {
    if (path === '' || pkg.dev) continue;
    checked++;
    const name = path.replace(/^.*node_modules\//, '');
    const label = `${name}@${pkg.version ?? '?'}`;
    if (typeof pkg.license !== 'string' || !pkg.license.trim()) problems.push(`${label} has no license.`);
    else if (!licenseAllowed(pkg.license, allowed)) problems.push(`${label} is licensed "${pkg.license}", which isn't allowed.`);
  }
  return { checked, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const { checked, problems } = checkLicenses(lock);
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(`Licenses OK: ${checked} runtime packages.`);
}
