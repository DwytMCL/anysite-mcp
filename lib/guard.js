// Per-site permissions (lib/permissions.js), checked by the page actions, so shortcuts obey them too.
import { SETTINGS } from './config.js';
import { baseDomain, readSettings, RISKY, RISKY_HREF, SEARCHY } from './permissions.js';

export const perms = site => ({ read_only: false, confirm: false, ...readSettings(SETTINGS).sites?.[site.name] });
export const allowedDomains = site => perms(site).allowed_domains || [baseDomain(new URL(site.url).hostname)];

// How to ask the user is injected by the MCP layer (lib/tools.js), so this module doesn't depend on the server.
// The function gets (site, what) and returns the client's answer, or null if the client can't ask.
let ask = null;
export const setAsk = fn => { ask = fn; };

// A yes or no question only. The form stays empty: a confirmation must never collect passwords, tokens or any input.
/** @returns {import('@modelcontextprotocol/server').ElicitRequestFormParams} */
export const confirmRequest = (site, what) => ({ mode: 'form', message: `Let the agent ${what} on ${site.name}?`,
  requestedSchema: { type: 'object', properties: {} } });

// Clients that can't ask make the action fail rather than go ahead.
async function confirmAction(site, what) {
  const r = ask && await ask(site, what);
  if (!r)
    throw new Error(`${site.name} is set to ask the user before the agent can ${what}, and this MCP client can't ask. ` +
      `Ask the user to do it by hand, or to run: anysite-mcp permissions ${site.name} --no-confirm`);
  if (r.action !== 'accept') throw new Error(`The user said no to: ${what}. Don't try another way.`);
}

// Stop or ask before something that changes things (`what`, e.g. 'click "Send"'), per the site's settings.
export async function permit(site, what) {
  const { read_only, confirm } = perms(site);
  if (read_only) throw new Error(`${site.name} is read-only, so the agent can't ${what}. ` +
    `The user can change that with: anysite-mcp permissions ${site.name} --read-write`);
  if (confirm) await confirmAction(site, what);
}

// What activating an element would do, judged from the element itself rather than only its words: a real link
// just opens a page (unless its address logs out, deletes and the like); a button that submits a POST form changes
// something whatever it is called; other buttons go by their label. Enter in a field submits its form, or, outside a
// form, counts as a search only in fields labelled like one.
export const effectOf = (loc, enter = false) => loc.evaluate((e, enter) => {
  const el = enter ? e : e.closest('a[href], button, input, select, textarea, summary, [role]') || e;
  const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value ||
    el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const form = el.form || el.closest('form');
  const method = form ? (form.getAttribute('method') || 'get').toLowerCase() : null;
  const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
  const submits = !!form && (enter || el.type === 'submit' || el.type === 'image' || (el.tagName === 'BUTTON' && !el.getAttribute('type')));
  return { label, link: !!href && !/^\s*(javascript:|#)/i.test(href), href: el.href || '', submits, post: submits && method !== 'get' };
}, enter).catch(() => ({ label: '', link: false, href: '', submits: false, post: false }));

export async function permitClick(site, loc, a = {}) {
  const fx = await effectOf(loc);
  const label = a.name || a.text || fx.label;
  const risky = fx.link ? RISKY_HREF.test(fx.href) : fx.post || RISKY.test(label);
  if (risky) await permit(site, `click "${label.slice(0, 60)}"`);
}
export async function permitEnter(site, loc, a = {}) {
  const fx = await effectOf(loc, true);
  const label = a.name || a.text || fx.label;
  const risky = fx.submits ? fx.post : !(a.role === 'searchbox' || SEARCHY.test(label));
  if (risky) await permit(site, `submit "${label.slice(0, 60)}"`);
}
