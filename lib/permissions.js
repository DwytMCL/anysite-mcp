// Per-site permissions. They are set by the user, never by the agent: in ~/.anysite-mcp/settings.json or with
// `anysite-mcp permissions <site> ...`. The file is read on every check, so changes apply at once.
//   { "sites": { "mail.google.com": { "read_only": true, "confirm": true, "allowed_domains": ["google.com"] } } }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Labels of buttons and fields whose use changes something for real.
export const RISKY = /\b(send|post|publish|submit|buy|purchase|order|pay|checkout|delete|remove|trash|archive|unsubscribe|reply|comment|share|invite|transfer|confirm|approve|accept|tweet|upload|save|create|sign out|log ?out)\b/i;
// Fields where pressing Enter only searches or asks.
export const SEARCHY = /\b(search|find|filter|query|look ?up|go to|jump)\b/i;

export const readSettings = file => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}). Fix or delete it.`);
  }
};

export function writeSiteSettings(file, site, change) {
  const all = readSettings(file);
  all.sites ??= {};
  const next = { ...all.sites[site], ...change };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
  if (Object.keys(next).length) all.sites[site] = next; else delete all.sites[site];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  return next;
}

// "mail.google.com" -> "google.com"; "bbc.co.uk" stays.
export function baseDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts.at(-1))) return host;
  const two = parts.at(-1).length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(parts.at(-2));
  return parts.slice(two ? -3 : -2).join('.');
}

export const hostAllowed = (host, domains) => domains.includes('*') || domains.some(d => host === d || host.endsWith(`.${d}`));
