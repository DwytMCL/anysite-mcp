// The anysite-mcp command: one-off commands (login, record, add, library, doctor, permissions), else serve MCP over stdio.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { HOME, QUIT, SETTINGS, VERSION } from './config.js';
import { findChrome, loadSite, login, NO_CHROME, packNames } from './browser.js';
import { allowedDomains, perms } from './guard.js';
import { writeSiteSettings } from './permissions.js';
import { addShortcuts, doctor, readShortcuts } from './shortcuts.js';
import { startRecording, stopRecording } from './recording.js';
import { server, useSite } from './tools.js';

// Checked only by the commands that start Chrome, so --version, library, add and permissions work without it.
const needChrome = () => {
  if (findChrome()) return;
  console.error(NO_CHROME);
  process.exit(1);
};

// CLI.

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const flagValue = f => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--from', '--allow'].includes(rest[i - 1]));
const usage = `anysite-mcp [site ...]          Serve MCP over stdio. Sites are pack names (${packNames().join(', ')}) or domains.
                                With none, serves every site you have signed in to.
anysite-mcp login <site>        Open the site in its own Chrome profile to sign in once.
anysite-mcp record <site> <name>  Do a job by hand in the site's Chrome; it is saved as a shortcut.
anysite-mcp add <site>[/<name>] Add shared shortcuts from the library (or --from <file or URL>; --force replaces).
anysite-mcp library search <words>  Find shared shortcuts in the library, with their health and add command.
anysite-mcp library list [site]     List the library's sites, or one site's shortcuts.
anysite-mcp library info <site>[/<name>]  Show a shared shortcut's parameters, steps and health.
anysite-mcp doctor [site ...]   Check saved shortcuts without changing anything on the sites; repair what it can.
anysite-mcp permissions <site>  Show or set what the agent may do there:
                                --read-only | --read-write, --confirm | --no-confirm,
                                --allow <domain,...> | --allow-any | --allow-default
anysite-mcp --version           Print the version (${VERSION}).
Data: ${HOME}
Environment: ANYSITE_HOME, ANYSITE_CHROME, ANYSITE_CHROME_ARGS, ANYSITE_HEADLESS=1, ANYSITE_DOWNLOADS,
             ANYSITE_LIBRARY (a folder or URL to read the library from)`;
const need = (ok, msg) => { if (!ok) { console.error(msg); process.exit(1); } };

if (cmd === '--version' || cmd === '-v') { console.log(VERSION); process.exit(0); }
if (cmd === '--help' || cmd === '-h') { console.log(usage); process.exit(0); }
if (cmd === 'login') {
  need(positional[0], 'Usage: anysite-mcp login <site>');
  needChrome();
  const site = await loadSite(positional[0]);
  await login(site);
  console.log(`Sign in to ${site.name} in the window that opened, then ${QUIT}.`);
  process.exit(0);
}
if (cmd === 'record') {
  need(positional[1] && /^[a-z][a-z0-9_]*$/.test(positional[1]), 'Usage: anysite-mcp record <site> <name>   (name: lowercase letters, digits, _)');
  needChrome();
  const site = await loadSite(positional[0]);
  await startRecording(site);
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`Recording in the Chrome window for ${site.name}. Do the job there, then press Enter here. `);
  const description = (await rl.question('What does it do? (one line, for the agent) ')).trim() || `Recorded on ${site.name}`;
  rl.close();
  const sc = stopRecording(site, positional[1], description);
  console.log(`Saved ${site.prefix}_${positional[1]} in ${site.shortcutFile}:\n${JSON.stringify(sc, null, 2)}`);
  process.exit(0);
}
if (cmd === 'add') {
  need(positional[0], 'Usage: anysite-mcp add <site>[/<name>] [--from <file or URL>] [--force]');
  const [siteArg_, only] = positional[0].split(/\/(?=[a-z][a-z0-9_]*$)/);
  const site = await loadSite(siteArg_);
  const r = await addShortcuts(site, { from: flagValue('--from'), only, force: flags.has('--force') });
  const all = readShortcuts(site);
  for (const n of r.added) console.log(`+ ${site.prefix}_${n}: ${all[n].description}`);
  for (const n of r.skipped) console.log(`  ${site.prefix}_${n} already exists (--force replaces it)`);
  console.log(r.added.length ? `Added from ${r.src}. They hold steps only, no code; see them with web_list_shortcuts.` : 'Nothing added.');
  process.exit(0);
}
if (cmd === 'library') {
  const [sub, ...args] = positional;
  const help = 'Usage: anysite-mcp library search <words> | list [site] | info <site>[/<name>]';
  need(['search', 'list', 'info'].includes(sub) && (sub === 'list' || args.length), help);
  const { fetchLibrary, formatInfo, formatList, formatShortcuts, searchShortcuts } = await import('./library.js');
  try {
    const { index, health } = await fetchLibrary();
    if (sub === 'list') console.log(formatList(index, health, args[0]));
    else if (sub === 'info') console.log(formatInfo(index, health, args[0]));
    else {
      const found = searchShortcuts(index, args);
      console.log(found.length ? formatShortcuts(found, health)
        : `No shared shortcuts match "${args.join(' ')}". See every site with: anysite-mcp library list`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}
if (cmd === 'doctor') {
  needChrome();
  const dir = join(HOME, 'sites');
  const names = positional.length ? positional : existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
  if (!names.length) console.log('No saved shortcuts yet.');
  let broken = 0;
  for (const n of names) {
    const site = await loadSite(n);
    if (!Object.keys(readShortcuts(site)).length) continue;
    console.log(site.name);
    const r = await doctor(site);
    for (const l of r.lines) console.log(`  ${l}`);
    broken += r.broken;
  }
  process.exit(broken ? 1 : 0);
}
if (cmd === 'permissions') {
  need(positional[0], 'Usage: anysite-mcp permissions <site> [--read-only|--read-write] [--confirm|--no-confirm] [--allow <domain,...>|--allow-any|--allow-default]');
  const site = await loadSite(positional[0]);
  const change = {};
  if (flags.has('--read-only')) change.read_only = true;
  if (flags.has('--read-write')) change.read_only = null;
  if (flags.has('--confirm')) change.confirm = true;
  if (flags.has('--no-confirm')) change.confirm = null;
  if (flags.has('--allow')) change.allowed_domains = flagValue('--allow').split(',').map(d => d.trim()).filter(Boolean);
  if (flags.has('--allow-any')) change.allowed_domains = ['*'];
  if (flags.has('--allow-default')) change.allowed_domains = null;
  if (Object.keys(change).length) writeSiteSettings(SETTINGS, site.name, change);
  const pm = perms(site);
  console.log(`${site.name}: ${pm.read_only ? 'read-only' : 'read and write'}; ` +
    `${pm.confirm ? 'asks you before sending, buying, deleting and the like' : 'does not ask before acting'}; ` +
    `may open ${allowedDomains(site).join(', ')}${pm.allowed_domains ? '' : ' (default)'}.\nSettings: ${SETTINGS}`);
  process.exit(0);
}
needChrome();
const profiles = join(HOME, 'profiles');
for (const s of cmd ? [cmd, ...rest] : existsSync(profiles) ? readdirSync(profiles).filter(d => !d.startsWith('.')) : [])
  await useSite(s);
await server.connect(new StdioServerTransport());
