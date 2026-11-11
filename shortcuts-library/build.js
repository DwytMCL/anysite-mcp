#!/usr/bin/env node
// Builds the Shortcut Library site into _site/: the page files plus library/index.json,
// one list made from every library/<site>.json (GitHub Pages can't list a folder), and
// library/health.json when the weekly health check (scripts/library-health.js) has written one.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarked, stepsHash } from '../lib/library.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// One index entry per shortcut, hashing the steps exactly as written in library/<site>.json.
export const indexEntries = (site, data) => Object.entries(data).map(([name, sc]) => ({
  site,
  name,
  tool: `${site.replace(/[^a-z0-9]+/g, '_')}_${name}`,
  description: sc.description,
  params: sc.params || {},
  steps: sc.steps || [],
  ...(sc.needsSignIn ? { needsSignIn: true } : {}),
  stepsHash: stepsHash(sc.steps)
}));

// The page's healthFor must be the same as the CLI's, or the site and `library` would disagree about a badge.
export function healthForDrift() {
  const page = extractMarked(readFileSync(join(here, 'app.js'), 'utf8'));
  const cli = extractMarked(readFileSync(join(root, 'lib', 'library.js'), 'utf8'));
  return page === cli ? null : 'healthFor in shortcuts-library/app.js differs from the copy in lib/library.js. Make them the same.';
}

export function build({ libDir = join(root, 'library'), out = join(root, '_site'), health = join(libDir, 'health.json') } = {}) {
  const drift = healthForDrift();
  if (drift) throw new Error(drift);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'library'), { recursive: true });
  for (const f of ['index.html', 'style.css', 'app.js']) copyFileSync(join(here, f), join(out, f));
  mkdirSync(join(out, 'schema'), { recursive: true });
  copyFileSync(join(root, 'schema', 'shortcuts.v1.json'), join(out, 'schema', 'shortcuts.v1.json'));

  const shortcuts = [];
  const files = readdirSync(libDir).filter(f => f.endsWith('.json') && !['index.json', 'health.json'].includes(f)).sort();
  for (const f of files) {
    copyFileSync(join(libDir, f), join(out, 'library', f));
    shortcuts.push(...indexEntries(f.slice(0, -5), JSON.parse(readFileSync(join(libDir, f), 'utf8'))));
  }
  writeFileSync(join(out, 'library', 'index.json'),
    JSON.stringify({ generated: new Date().toISOString(), sites: files.map(f => f.slice(0, -5)), shortcuts }, null, 2) + '\n');
  const hasHealth = existsSync(health);
  if (hasHealth) copyFileSync(health, join(out, 'library', 'health.json'));
  return { shortcuts: shortcuts.length, sites: files.length, health: hasHealth };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // HEALTH_JSON is where the Pages workflow put this week's (or the carried-over) health.json.
    const r = build(process.env.HEALTH_JSON ? { health: process.env.HEALTH_JSON } : {});
    console.log(`Built _site/ with ${r.shortcuts} shortcuts from ${r.sites} sites${r.health ? ' and health.json' : ''}.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
