#!/usr/bin/env node
// Decides what the nightly live-site check reports. It keeps the last nights' results (history.json) and opens one
// issue after a shortcut is broken two nights running, updates it while that holds, and closes it once nothing is
// broken. A night where the site blocked the runner ("blocked") neither counts as broken nor clears a broken streak.
// Usage: node scripts/nightly.js history <previous history.json | -> <health.json> <history.json>
//        node scripts/nightly.js decide <history.json> <open|none>   (prints { action, title, body }; action is open, comment, close or none)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KEEP_NIGHTS = 14;
export const TITLE = 'Nightly live-site check: shortcuts are broken';
const BLOCK_TEXT = /\b(403|429)\b|forbidden|too many requests|captcha|just a moment|attention required|access denied|verify (that )?you are (a )?human|are you a robot|unusual traffic/i;

// True when what we saw (an HTTP status, a page title or an error message) says the site turned the runner away.
export const looksBlocked = text => BLOCK_TEXT.test(String(text ?? ''));

// Turns doctor's "broken" into "couldn't check" when the site blocked the runner. Stays within health.json's published
// statuses: a blocked shortcut is "unchecked" with blocked: true (an added field, which old readers ignore).
export function classify(entry, blocked) {
  if (entry.status !== 'broken' || !(blocked || looksBlocked(entry.detail))) return entry;
  return { ...entry, status: 'unchecked', blocked: true, detail: `Couldn't check: the site blocked the check. ${entry.detail || ''}`.trim() };
}

const nightStatus = e => (e.blocked ? 'blocked' : e.status);

// Adds tonight's results (from health.json) to the history, keeping the last KEEP_NIGHTS nights.
export function updateHistory(previous, health, date = health.checked) {
  const results = Object.fromEntries(Object.entries(health.shortcuts || {}).map(([k, e]) =>
    [k, { status: nightStatus(e), detail: nightStatus(e) === 'ok' ? '' : String(e.detail || '').slice(0, 200) }]));
  const nights = [...(previous?.nights || []).filter(n => n.date !== date), { date, results }];
  return { nights: nights.slice(-KEEP_NIGHTS) };
}

// Shortcuts broken in each of the last two nights.
export function brokenTwoNights(history) {
  const [a, b] = history.nights.slice(-2);
  if (!a || !b) return [];
  return Object.keys(b.results).filter(k => b.results[k].status === 'broken' && a.results[k]?.status === 'broken');
}

export function decide(history, issueOpen) {
  const latest = history.nights.at(-1);
  const persistent = brokenTwoNights(history);
  if (persistent.length) {
    const lines = persistent.map(k => `- \`${k}\`: ${latest.results[k].detail || 'broken'}`);
    const body = `These shortcuts were broken on the last two nightly checks (${latest.date.slice(0, 10)}):\n\n${lines.join('\n')}\n\n` +
      'Run `npx anysite-mcp doctor` on the site to see why. A night where a site blocked the runner does not count either way.';
    return { action: issueOpen ? 'comment' : 'open', title: TITLE, body };
  }
  const statuses = Object.values(latest?.results || {}).map(r => r.status);
  const clear = statuses.length > 0 && !statuses.includes('broken') && statuses.some(s => s === 'ok' || s === 'repaired');
  return issueOpen && clear
    ? { action: 'close', title: TITLE, body: `Nothing was broken on the nightly check of ${latest.date.slice(0, 10)}, so this is closed.` }
    : { action: 'none', title: TITLE, body: '' };
}

const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
function main(/** @type {string[]} */ args) {
  const [cmd, ...a] = args;
  if (cmd === 'history') {
    const [prev, health, out] = a;
    writeFileSync(out, JSON.stringify(updateHistory(prev && prev !== '-' ? readJson(prev) : undefined, readJson(health)), null, 2) + '\n');
  } else if (cmd === 'decide') {
    console.log(JSON.stringify(decide(readJson(a[0]), a[1] === 'open')));
  } else throw new Error('Usage: node scripts/nightly.js history <previous|-> <health.json> <out> | decide <history.json> <open|none>');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
