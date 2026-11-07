// Self-healing for saved shortcuts. When a step's element is gone, try the fallbacks recorded when the shortcut
// was saved, then look for the closest name of a similar role on the page. Only a single clear winner counts.

const norm = s => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stem = w => w.length > 3 ? w.replace(/(ies|es|s)$/, m => m === 'ies' ? 'y' : '') : w; // "products" ~ "product"

// 1 for the same words, 0.6–1 when one name contains the other, else the share of words they have in common.
export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.6 + 0.4 * Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const wx = new Set(x.split(' ').map(stem)), wy = new Set(y.split(' ').map(stem));
  const common = [...wx].filter(w => wy.has(w)).length;
  return common / new Set([...wx, ...wy]).size;
}

// Roles that a redesign commonly swaps for one another.
const KIN = { button: ['button', 'link', 'menuitem', 'tab'], link: ['link', 'button', 'menuitem', 'tab'],
  menuitem: ['menuitem', 'button', 'link', 'option'], tab: ['tab', 'button', 'link'], option: ['option', 'menuitem'],
  textbox: ['textbox', 'searchbox', 'combobox'], searchbox: ['searchbox', 'textbox', 'combobox'],
  combobox: ['combobox', 'textbox', 'searchbox'], checkbox: ['checkbox', 'switch'], switch: ['switch', 'checkbox'] };

// "role" and "name" of every element in an AI-mode aria snapshot.
export function elements(tree) {
  return [...tree.matchAll(/^\s*- (\w+) "((?:[^"\\]|\\.)*)"/gm)].map(([, role, name]) => ({ role, name: name.replace(/\\(.)/g, '$1') }));
}

export const describe = a => a.role ? `${a.role}${a.name ? ` "${a.name}"` : ''}` : a.name ? `field "${a.name}"` : `text "${a.text}"`;

// The best stand-in for target `a` among `els`, or null when nothing is close enough or two are equally close.
export function closest(a, els, threshold = 0.6) {
  const want = a.name || a.text;
  if (!want) return null;
  const roles = a.role ? KIN[a.role] || [a.role] : null;
  let best = new Map(), top = 0;
  for (const el of els) {
    if (roles && !roles.includes(el.role)) continue;
    const s = similarity(want, el.name) - (a.role && el.role !== a.role ? 0.05 : 0);
    if (s > top + 1e-9) { top = s; best = new Map([[`${el.role}\0${el.name}`, el]]); }
    else if (Math.abs(s - top) < 1e-9) best.set(`${el.role}\0${el.name}`, el);
  }
  return top >= threshold && best.size === 1 ? [...best.values()][0] : null;
}
