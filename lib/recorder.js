// Record mode: the user does a job by hand in the site's Chrome, and each click, typed value and choice
// becomes a shortcut step that finds its element by role and name, like the rest of anysite-mcp.

// Runs in the page. `token` tells this server's listeners apart from ones left by an earlier server process.
export const recorderScript = token => `(() => {
  if (window.__anysiteRec === ${JSON.stringify(token)}) return;
  window.__anysiteRec = ${JSON.stringify(token)};
  const FIELDS = ['textbox', 'searchbox', 'combobox', 'spinbutton'];
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const roleOf = e => {
    const r = e.getAttribute('role');
    if (r) return r.split(' ')[0];
    const t = e.tagName.toLowerCase(), ty = (e.getAttribute('type') || 'text').toLowerCase();
    if (t === 'a' && e.hasAttribute('href')) return 'link';
    if (t === 'button' || t === 'summary' || (t === 'input' && ['button', 'submit', 'reset', 'image'].includes(ty))) return 'button';
    if (t === 'input' && ty === 'checkbox') return 'checkbox';
    if (t === 'input' && ty === 'radio') return 'radio';
    if (t === 'input' && ty === 'search') return 'searchbox';
    if (t === 'input' && ty === 'number') return 'spinbutton';
    if (t === 'input' && ['text', 'email', 'url', 'tel', 'password'].includes(ty)) return 'textbox';
    if (t === 'textarea' || e.isContentEditable) return 'textbox';
    if (t === 'select') return 'combobox';
    return null;
  };
  const nameOf = e => {
    const by = e.getAttribute('aria-labelledby');
    if (by) return clean(by.split(' ').map(id => document.getElementById(id)?.innerText || '').join(' '));
    if (e.getAttribute('aria-label')) return clean(e.getAttribute('aria-label'));
    if (e.labels && e.labels.length) return clean(e.labels[0].innerText);
    if (e.getAttribute('placeholder')) return clean(e.getAttribute('placeholder'));
    if (!FIELDS.includes(roleOf(e))) { const t = clean(e.innerText || e.value); if (t) return t.slice(0, 100); }
    return clean(e.getAttribute('title') || e.getAttribute('alt') || '');
  };
  const find = n => { for (; n && n !== document.body; n = n.parentElement) if (n.nodeType === 1 && roleOf(n)) return n; return null; };
  const send = (kind, e, extra) => {
    try { window.__anysiteRecord({ token: ${JSON.stringify(token)}, kind, role: roleOf(e), name: nameOf(e),
      text: clean(e.innerText).slice(0, 100), ...extra }); } catch {}
  };
  const value = e => e.isContentEditable ? e.innerText : e.value;
  document.addEventListener('click', ev => {
    const e = find(ev.target);
    if (e && !FIELDS.includes(roleOf(e))) send('click', e);
  }, true);
  document.addEventListener('change', ev => {
    const e = find(ev.target);
    if (!e) return;
    if (e.tagName === 'SELECT') send('select', e, { value: e.value });
    else if (FIELDS.includes(roleOf(e))) send('type', e, { value: value(e) });
  }, true);
  document.addEventListener('focusout', ev => {
    const e = find(ev.target);
    if (e && e.isContentEditable) send('type', e, { value: value(e) });
  }, true);
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    const e = find(ev.target);
    if (e && FIELDS.includes(roleOf(e))) send('type', e, { value: value(e), submit: true });
  }, true);
})()`;

const targetOf = ev => ev.role && ev.name ? { role: ev.role, name: ev.name } : ev.text ? { text: ev.text } : null;
const same = (a, b) => a && b && a.role === b.role && a.name === b.name && a.text === b.text;

// Add one recorded event to the steps. Typing into the same field again updates the earlier step.
export function addEvent(steps, ev) {
  const t = targetOf(ev);
  if (!t) return;
  const last = steps.at(-1);
  if (ev.kind === 'type') {
    const prev = last?.action === 'type' && same({ role: last.role, name: last.name, text: last.text }, t) ? last : null;
    if (prev) { prev.value = ev.value; if (ev.submit) prev.submit = true; return; }
    steps.push({ action: 'type', ...t, value: ev.value, ...(ev.submit ? { submit: true } : {}) });
  } else if (ev.kind === 'select') steps.push({ action: 'select', ...t, value: ev.value });
  else steps.push({ action: 'click', ...t });
}

// Typed values become parameters, with what the user typed as the default.
export function parametrize(steps) {
  const params = {};
  const out = steps.map(s => {
    if (s.action !== 'type' && s.action !== 'select') return s;
    const base = (s.name || s.text || 'value').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'v$1').slice(0, 30) || 'value';
    let key = base;
    for (let i = 2; key in params; i++) key = `${base}_${i}`;
    params[key] = { description: `Value for ${s.name || s.text || 'the field'}`, default: s.value };
    return { ...s, value: `{{${key}}}` };
  });
  return { params, steps: out };
}
