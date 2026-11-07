#!/usr/bin/env node
// Builds the Shortcut Library site into _site/: the page files plus library/index.json,
// one list made from every library/<site>.json (GitHub Pages can't list a folder).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const libDir = join(root, 'library');
const out = join(root, '_site');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'library'), { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js']) copyFileSync(join(here, f), join(out, f));

const shortcuts = [];
const files = readdirSync(libDir).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
for (const f of files) {
  const site = f.slice(0, -5);
  const data = JSON.parse(readFileSync(join(libDir, f), 'utf8'));
  copyFileSync(join(libDir, f), join(out, 'library', f));
  for (const [name, sc] of Object.entries(data)) {
    shortcuts.push({
      site,
      name,
      tool: `${site.replace(/[^a-z0-9]+/g, '_')}_${name}`,
      description: sc.description,
      params: sc.params || {},
      steps: sc.steps || []
    });
  }
}

writeFileSync(join(out, 'library', 'index.json'),
  JSON.stringify({ generated: new Date().toISOString(), sites: files.map(f => f.slice(0, -5)), shortcuts }, null, 2) + '\n');
console.log(`Built _site/ with ${shortcuts.length} shortcuts from ${files.length} sites.`);
