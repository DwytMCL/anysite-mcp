// The Shortcut Library from the terminal: fetch its index and health, search it, and format it with health badges.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LIBRARY_URL = 'https://dwytmcl.github.io/anysite-mcp/library';
export const addCommand = (site, name) => `npx -y anysite-mcp add ${site}${name ? `/${name}` : ''}`;

// Object keys sorted at every level and arrays kept in order, so the same steps always hash the same.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
export const stepsHash = steps => createHash('sha256').update(canonical(steps ?? [])).digest('hex').slice(0, 12);

// The copy between the markers must match the one in shortcuts-library/app.js (checked by build.js and the tests).
// HEALTH_FOR_START
function healthFor(shortcut, health, now) {
  var entry = health && health.shortcuts ? health.shortcuts[shortcut.site + '/' + shortcut.name] : null;
  var checked = health && health.checked ? health.checked : null;
  var badges = {
    ok: { icon: '✓', label: 'passing' },
    repaired: { icon: '~', label: 'repaired' },
    broken: { icon: '✗', label: 'broken' },
    unchecked: { icon: '–', label: 'not checked yet' },
    stale: { icon: '?', label: 'not recently checked' }
  };
  if (shortcut.needsSignIn) return { status: 'unchecked', icon: badges.unchecked.icon, label: 'needs sign-in, not checked', checked: null, detail: '' };
  var status = 'unchecked';
  if (entry && badges[entry.status] && shortcut.stepsHash && entry.steps === shortcut.stepsHash) {
    var age = new Date(now).getTime() - new Date(checked).getTime();
    status = checked && age <= 14 * 24 * 60 * 60 * 1000 ? entry.status : 'stale';
  }
  return {
    status: status,
    icon: badges[status].icon,
    label: badges[status].label,
    checked: status === 'unchecked' ? null : checked,
    detail: status === 'unchecked' ? '' : entry.detail || ''
  };
}
// HEALTH_FOR_END
export { healthFor };

export function extractMarked(source) {
  const m = /\/\/ HEALTH_FOR_START\r?\n([\s\S]*?)\/\/ HEALTH_FOR_END/.exec(source);
  if (!m) throw new Error('No HEALTH_FOR_START ... HEALTH_FOR_END block found.');
  return m[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');
}

// ANYSITE_LIBRARY points at a local folder or another URL, e.g. _site/library after a local build.
export async function fetchLibrary(from = process.env.ANYSITE_LIBRARY || LIBRARY_URL) {
  const remote = /^https?:\/\//.test(from);
  const get = async f => {
    if (!remote) return JSON.parse(readFileSync(join(from, f), 'utf8'));
    const r = await fetch(`${from.replace(/\/$/, '')}/${f}`, { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  };
  let index;
  // The versioned index first; a library that predates v1/ has only the original one.
  try { index = await get('v1/index.json').catch(() => get('index.json')); } catch (e) {
    throw new Error(`Couldn't load the Shortcut Library from ${from} (${e.message}).`, { cause: e });
  }
  const health = await get('health.json').catch(() => null);
  return { index, health, from };
}

export function searchShortcuts(index, words) {
  const ws = (Array.isArray(words) ? words : String(words || '').split(/\s+/)).map(w => w.toLowerCase()).filter(Boolean);
  return (index.shortcuts || []).filter(s => {
    const hay = [s.site, s.name, s.description, s.tool].join(' ').toLowerCase();
    return ws.every(w => hay.includes(w));
  });
}

const date = iso => iso ? String(iso).slice(0, 10) : '';
const badge = (s, health, now) => { const h = healthFor(s, health, now); return `${h.icon} ${h.label}`; };
const byName = (a, b) => a.site === b.site ? a.name.localeCompare(b.name) : a.site.localeCompare(b.site);

export function formatShortcuts(list, health, now = new Date()) {
  const rows = list.slice().sort(byName).map(s => [badge(s, health, now), s.tool, s.description, addCommand(s.site, s.name)]);
  const w = Math.max(0, ...rows.map(r => r[0].length));
  return rows.map(([b, tool, desc, cmd]) => `${b.padEnd(w)}  ${tool}: ${desc}\n${' '.repeat(w + 2)}${cmd}`).join('\n');
}

export function formatList(index, health, site, now = new Date()) {
  const all = index.shortcuts || [];
  if (site) {
    const mine = all.filter(s => s.site === site);
    if (!mine.length) throw new Error(`No shortcuts for ${site} in the library. Sites: ${(index.sites || []).join(', ') || 'none'}`);
    return `${site} (${mine.length})\n${formatShortcuts(mine, health, now)}\nAll of them: ${addCommand(site)}`;
  }
  const sites = [...new Set([...(index.sites || []), ...all.map(s => s.site)])].sort();
  const w = Math.max(0, ...sites.map(s => s.length));
  return sites.map(s => {
    const n = all.filter(x => x.site === s).length;
    return `${s.padEnd(w)}  ${n} shortcut${n === 1 ? '' : 's'}`;
  }).join('\n') + '\nSee one site with: anysite-mcp library list <site>';
}

export function formatInfo(index, health, ref, now = new Date()) {
  const [site, name] = ref.split(/\/(?=[a-z][a-z0-9_]*$)/);
  const list = (index.shortcuts || []).filter(s => s.site === site && (!name || s.name === name)).sort(byName);
  if (!list.length) throw new Error(`No shortcut ${ref} in the library. Try: anysite-mcp library search <words>`);
  return list.map(s => {
    const h = healthFor(s, health, now);
    const params = Object.entries(s.params || {}).map(([k, d]) => {
      const p = typeof d === 'string' ? { description: d } : d || {};
      const bits = [p.type && p.type !== 'string' && p.type, p.optional && 'optional',
        p.default !== undefined && `default ${JSON.stringify(p.default)}`].filter(Boolean);
      return `  ${k}: ${p.description || ''}${bits.length ? ` (${bits.join(', ')})` : ''}`;
    });
    return [`${s.tool}: ${s.description}`,
      `Health: ${h.icon} ${h.label}${h.checked ? ` (checked ${date(h.checked)})` : ''}${h.detail ? `: ${h.detail}` : ''}`,
      `Parameters:${params.length ? `\n${params.join('\n')}` : ' none'}`,
      `Steps:\n${(s.steps || []).map((st, i) => `  ${i + 1}. ${JSON.stringify(st)}`).join('\n')}`,
      `Add: ${addCommand(s.site, s.name)}`].join('\n');
  }).join('\n\n');
}

// Installed shortcut files against the library: for each shortcut whose site and name are in the library, are its
// steps the library's? Shortcuts that exist only here are ignored. `installed` is [{ site, shortcuts } | { site, error }].
export function checkInstalled(index, installed) {
  const shared = new Map((index.shortcuts || []).map(s => [`${s.site}/${s.name}`, s]));
  const rows = [];
  for (const f of installed) {
    if (f.error) {
      if ((index.sites || []).includes(f.site) || /newer anysite-mcp/.test(f.error))
        rows.push({ site: f.site, status: /newer anysite-mcp/.test(f.error) ? 'newer-format' : 'unreadable', detail: f.error });
      continue;
    }
    for (const [name, sc] of Object.entries(f.shortcuts)) {
      const lib = shared.get(`${f.site}/${name}`);
      if (lib) rows.push({ site: f.site, name, status: stepsHash(sc.steps) === lib.stepsHash ? 'current' : 'outdated' });
    }
  }
  return rows;
}

export function formatCheck(rows) {
  if (!rows.length) return 'None of your saved shortcuts are in the library, so there is nothing to compare.';
  const bySite = new Map();
  for (const r of rows) bySite.set(r.site, [...(bySite.get(r.site) || []), r]);
  const lines = [];
  for (const [site, list] of bySite) {
    lines.push(site);
    for (const r of list) {
      if (r.status === 'current') lines.push(`  ${r.name}: same as the library`);
      else if (r.status === 'outdated') lines.push(`  ${r.name}: differs from the library (changed here, or updated there). To take the library's: ${addCommand(site, r.name)} --force`);
      else lines.push(`  not compared: ${r.status === 'newer-format' ? 'written for a newer anysite-mcp, update it to read this file' : r.detail.split('\n')[0]}`);
    }
  }
  const count = s => rows.filter(r => r.status === s).length;
  lines.push(`${count('current')} same, ${count('outdated')} differ, ${count('newer-format') + count('unreadable')} not compared.`);
  return lines.join('\n');
}
