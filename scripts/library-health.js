#!/usr/bin/env node
// Health check of the Shortcut Library (weekly for the site, nightly for early warning): runs `doctor` on every shortcut in library/<site>.json against the
// live site, in a throwaway ANYSITE_HOME, and writes health.json for the Pages site and `anysite-mcp library`.
// It checks without signing in, so a shortcut marked "needsSignIn": true is recorded as unchecked, not broken.
// A broken shortcut or a site that won't load is recorded as broken (unless the site blocked the runner: then it is
// "unchecked", with blocked: true) and the script still exits 0 (it's a monitor,
// not a gate). It fails only when it can't run at all: no Chrome, or no library files.
// Usage: node scripts/library-health.js <library folder> <output file>
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stepsHash } from '../lib/library.js';
import { classify, looksBlocked } from './nightly.js';

// Hashed from the file as written, before anything loads or heals the shortcuts, so they match index.json's.
export const fileHashes = data => Object.fromEntries(Object.entries(data).map(([n, sc]) => [n, stepsHash(sc?.steps)]));

export const signInNames = data => Object.entries(data).filter(([, sc]) => sc?.needsSignIn === true).map(([n]) => n);

// Entries for health.json: doctor's result for each shortcut, or the site's error for all of them. `blocked` says the
// site turned the runner away (403, 429, a challenge page): that is recorded as "couldn't check", not as broken.
export function healthEntries(site, hashes, results = [], error, signIn = [], blocked = false) {
  const byName = new Map(results.map(r => [r.name, r]));
  return Object.fromEntries(Object.keys(hashes).map(n => {
    if (signIn.includes(n)) return [`${site}/${n}`, { status: 'unchecked', detail: 'Needs sign-in; not checked.', steps: hashes[n] }];
    const r = error ? { status: 'broken', detail: error } : byName.get(n) || { status: 'broken', detail: 'Not checked: doctor did not report it.' };
    return [`${site}/${n}`, { ...classify({ status: r.status, detail: r.detail || '' }, blocked), steps: hashes[n] }];
  }));
}

async function main(libDir, outFile) {
  if (!libDir || !outFile) throw new Error('Usage: node scripts/library-health.js <library folder> <output file>');
  const files = readdirSync(libDir).filter(f => f.endsWith('.json') && !['index.json', 'health.json'].includes(f)).sort();
  if (!files.length) throw new Error(`No library files in ${libDir}.`);
  // config.js reads ANYSITE_HOME when it loads, so set it before importing the rest.
  process.env.ANYSITE_HOME = mkdtempSync(join(tmpdir(), 'anysite-health-'));
  const { findChrome, getPage, loadSite, NO_CHROME } = await import('../lib/browser.js');
  const { addShortcuts, doctor } = await import('../lib/shortcuts.js');
  if (!findChrome()) throw new Error(NO_CHROME);

  const shortcuts = {};
  for (const f of files) {
    const name = f.slice(0, -5), file = join(libDir, f);
    let hashes = {}, signIn = [];
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      hashes = fileHashes(data);
      signIn = signInNames(data);
      const site = await loadSite(name);
      await addShortcuts(site, { from: file, only: undefined, force: true });
      const page = await getPage(site);
      const refused = [];
      page.on('response', r => { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame() && [403, 429].includes(r.status())) refused.push(r.status()); });
      const { results } = await doctor(site);
      const title = await page.title().catch(() => '');
      Object.assign(shortcuts, healthEntries(name, hashes, results, undefined, signIn, refused.length > 0 || looksBlocked(title)));
      await site.browser?.newBrowserCDPSession().then(s => s.send('Browser.close')).catch(() => {});
    } catch (e) {
      Object.assign(shortcuts, healthEntries(name, hashes, [], e.message, signIn));
    }
    for (const n of Object.keys(hashes)) console.log(`${shortcuts[`${name}/${n}`].status.padEnd(8)} ${name}/${n}`);
  }
  writeFileSync(outFile, JSON.stringify({ checked: new Date().toISOString(), shortcuts }, null, 2) + '\n');
  console.log(`Wrote ${outFile}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // process.exit, because the Chrome it started keeps the event loop alive.
  main(process.argv[2], process.argv[3]).then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });
}
