/* anysite-mcp Shortcut Library: lists library/index.json, filters it, and checks shared shortcuts. */
(function () {
  'use strict';

  // The GitHub repository that holds anysite-mcp and its library/ folder ("owner/name").
  var REPO = 'DwytMCL/anysite-mcp';
  var BRANCH = 'main';

  // Step actions a shortcut may use: the web_* tools without the prefix (see checkShortcut in lib/shortcuts.js).
  var ACTIONS = ['snapshot', 'open', 'click', 'type', 'select', 'press', 'upload', 'read', 'extract', 'wait', 'download'];
  var NAME_RE = /^[a-z][a-z0-9_]*$/;

  var all = [];
  var sites = [];
  var health = null;
  var state = { q: '', site: 'All' };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    search: $('search'),
    count: $('count'),
    cats: $('category-list'),
    body: $('results-body'),
    siteInstall: $('site-install'),
    siteInstallName: $('site-install-name'),
    siteInstallCmd: $('site-install-cmd'),
    siteInstallCopy: $('site-install-copy'),
    form: $('add-form'),
    siteInput: $('f-site'),
    siteList: $('site-list'),
    jsonInput: $('f-json'),
    errors: $('form-errors'),
    output: $('output'),
    summary: $('output-summary'),
    json: $('json-output'),
    copy: $('copy-btn'),
    copyStatus: $('copy-status'),
    issue: $('issue-link'),
    pr: $('pr-link'),
    prHint: $('pr-hint'),
    repoLink: $('repo-link')
  };

  els.repoLink.href = 'https://github.com/' + REPO;

  // ---------- helpers ----------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function norm(s) { return String(s || '').toLowerCase(); }
  function toolPrefix(site) { return site.replace(/[^a-z0-9]+/g, '_'); }
  function paramSpec(d) { return typeof d === 'string' ? { description: d } : (d || {}); }
  function addCmd(site, name) { return 'npx -y anysite-mcp add ' + site + (name ? '/' + name : ''); }

  // Wraps matches of the search words in <mark>, safely (no innerHTML).
  function highlight(text, words) {
    var frag = document.createDocumentFragment();
    text = String(text || '');
    if (!words.length) { frag.appendChild(document.createTextNode(text)); return frag; }
    var escaped = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('(' + escaped.join('|') + ')', 'gi');
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(el('mark', { text: m[0] }));
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function copyText(text, statusEl) {
    function done(ok) {
      statusEl.textContent = ok ? 'Copied.' : 'Select it and copy by hand.';
      setTimeout(function () { statusEl.textContent = ''; }, 2500);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = el('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
  }

  // ---------- readable steps ----------

  function target(a) {
    var parts = [];
    if (a.role) parts.push(a.role + (a.name ? ' "' + a.name + '"' : ''));
    else if (a.name) parts.push('"' + a.name + '"');
    if (a.text) parts.push('with text "' + a.text + '"');
    if (a.nth !== undefined) parts.push('(#' + (Number(a.nth) + 1) + ')');
    if (a.within) parts.push('inside ' + a.within);
    return parts.join(' ') || 'the page';
  }

  function describeStep(s) {
    var a = s || {};
    var t;
    switch (a.action) {
      case 'open': t = ['Open ', val(a.url || '(the site)')]; break;
      case 'click': t = ['Click ' + target(a)]; break;
      case 'type': t = ['Type ', val(a.value), ' into ' + target(a) + (a.submit ? ', then Enter' : '')]; break;
      case 'select': t = ['Choose ', val(a.value), ' in ' + target(a)]; break;
      case 'press': t = ['Press ', val(a.key)]; break;
      case 'upload': t = ['Upload ', val([].concat(a.paths || []).join(', ')), ' to ' + target(a)]; break;
      case 'read': t = [a.role || a.name || a.text ? 'Read ' + target(a) : 'Read the page text']; break;
      case 'extract': {
        var x = 'Extract each ' + (a.role || 'item') + (a.name ? ' "' + a.name + '"' : '') +
          (a.within ? ' inside ' + a.within : '') + (a.limit ? ' (up to ' + a.limit + ')' : '');
        if (a.fields) x += ' with ' + Object.keys(a.fields).join(', ');
        t = [x];
        break;
      }
      case 'wait': t = a.until_text ? ['Wait for ', val(a.until_text)] : ['Wait ' + (a.seconds || 1) + ' s']; break;
      case 'download': t = ['Download from ' + target(a)]; break;
      case 'snapshot': t = ['Take a snapshot of the page']; break;
      default: t = ['Unknown step "' + a.action + '"'];
    }
    if (a.expect) t.push(' (expects ', val(a.expect), ')');
    var li = el('li');
    var first = true;
    t.forEach(function (part) {
      if (typeof part === 'string') {
        if (first) {
          var sp = part.indexOf(' ');
          var verb = sp > 0 ? part.slice(0, sp) : part;
          li.appendChild(el('span', { 'class': 'act', text: verb }));
          li.appendChild(document.createTextNode(sp > 0 ? part.slice(sp) : ''));
        } else li.appendChild(document.createTextNode(part));
      } else li.appendChild(part);
      first = false;
    });
    return li;
  }

  function val(v) { return el('span', { 'class': 'val', text: String(v == null ? '' : v) }); }

  // ---------- health badges ----------

  // The copy between the markers must match the one in lib/library.js (checked by build.js and the tests).
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

  // One short word on the badge; the full meaning and check date are in its label and tooltip.
  var BADGE_WORDS = { ok: 'passing', repaired: 'repaired', broken: 'broken', unchecked: 'unchecked', stale: 'stale' };

  function healthBadge(s) {
    var h = healthFor(s, health, new Date());
    var full = 'Health: ' + h.label + (h.checked ? ', checked ' + String(h.checked).slice(0, 10) : '') +
      (h.status === 'ok' || h.status === 'unchecked' || !h.detail ? '' : ' (' + h.detail + ')');
    return el('span', { 'class': 'health health-' + h.status, role: 'img', 'aria-label': full, title: full }, [
      el('span', { 'class': 'health-icon', 'aria-hidden': 'true', text: h.icon }),
      el('span', { 'class': 'health-word', 'aria-hidden': 'true', text: BADGE_WORDS[h.status] })
    ]);
  }

  // ---------- URL state (?q=...&site=...) ----------

  function readUrl() {
    var params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    state.site = params.get('site') || 'All';
  }

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.site !== 'All') params.set('site', state.site);
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  // ---------- browse ----------

  function matches(s, words) {
    if (state.site !== 'All' && s.site !== state.site) return false;
    if (!words.length) return true;
    var hay = norm([s.site, s.name, s.tool, s.description, Object.keys(s.params || {}).join(' ')].join(' '));
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function renderCategories() {
    var counts = { All: all.length };
    all.forEach(function (s) { counts[s.site] = (counts[s.site] || 0) + 1; });
    els.cats.textContent = '';
    ['All'].concat(sites).forEach(function (p) {
      var b = el('button', {
        type: 'button',
        'class': 'cat' + (state.site === p ? ' active' : ''),
        'aria-pressed': state.site === p ? 'true' : 'false'
      }, [p + ' ', el('span', { 'class': 'n', text: '(' + (counts[p] || 0) + ')' })]);
      b.addEventListener('click', function () { state.site = p; writeUrl(); render(); });
      els.cats.appendChild(b);
      els.cats.appendChild(document.createTextNode(' '));
    });

    var one = state.site !== 'All';
    els.siteInstall.hidden = !one;
    if (one) {
      els.siteInstallName.textContent = state.site;
      els.siteInstallCmd.textContent = addCmd(state.site);
    }
  }

  function paramList(params) {
    var keys = Object.keys(params || {});
    if (!keys.length) return el('div', { 'class': 's-by', text: 'No parameters.' });
    var ul = el('ul', { 'class': 's-params' });
    keys.forEach(function (k) {
      var d = paramSpec(params[k]);
      var bits = [];
      if (d.type && d.type !== 'string') bits.push(d.type);
      if (d.optional) bits.push('optional');
      if (d.default !== undefined) bits.push('default ' + JSON.stringify(d.default));
      ul.appendChild(el('li', null, [
        el('code', { text: k }), ' ', d.description || '',
        bits.length ? el('span', { 'class': 'opt', text: ' (' + bits.join(', ') + ')' }) : null
      ]));
    });
    return ul;
  }

  function renderRows() {
    var words = norm(state.q).split(/\s+/).filter(Boolean);
    var list = all.filter(function (s) { return matches(s, words); });

    els.body.textContent = '';
    if (!list.length) {
      els.body.appendChild(el('tr', null, [el('td', { colspan: '3', 'class': 'empty', text: 'No shortcuts match. Try another search, or share one below.' })]));
    }

    list.forEach(function (s) {
      var steps = el('ol', { 'class': 'steps' });
      (s.steps || []).forEach(function (st) { steps.appendChild(describeStep(st)); });
      var raw = {};
      raw[s.name] = { description: s.description };
      if (Object.keys(s.params || {}).length) raw[s.name].params = s.params;
      raw[s.name].steps = s.steps;

      var info = el('td', { 'class': 'col-title' }, [
        el('div', { 'class': 's-title' }, [el('span', { 'class': 's-tool' }, [highlight(s.tool, words)]), ' ', healthBadge(s)]),
        el('div', { 'class': 's-desc' }, [highlight(s.description, words)]),
        paramList(s.params),
        el('details', null, [el('summary', { text: 'Steps (' + (s.steps || []).length + ')' }), steps]),
        el('details', null, [el('summary', { text: 'JSON' }), el('pre', { 'class': 'raw', text: JSON.stringify(raw, null, 2) })])
      ]);

      var cmd = addCmd(s.site, s.name);
      var status = el('span', { 'class': 'copied' });
      var btn = el('button', { type: 'button', 'class': 'copy-cmd', text: 'Copy' });
      btn.addEventListener('click', function () { copyText(cmd, status); });
      var installCell = el('td', { 'class': 'col-keys' }, [el('code', { 'class': 'cmd', text: cmd }), btn, status]);

      var tag = el('button', { type: 'button', 'class': 'tag cat', text: s.site, title: 'Show all shortcuts for ' + s.site });
      tag.addEventListener('click', function () { state.site = s.site; writeUrl(); render(); });
      var siteCell = el('td', { 'class': 'col-platform' }, [tag]);

      els.body.appendChild(el('tr', null, [info, installCell, siteCell]));
    });

    els.count.textContent = list.length + ' of ' + all.length + ' shown';
  }

  function render() {
    renderCategories();
    renderRows();
  }

  els.siteInstallCopy.addEventListener('click', function () {
    var status = els.siteInstallCopy.nextElementSibling;
    if (!status || status.className !== 'copied') {
      status = el('span', { 'class': 'copied' });
      els.siteInstallCopy.parentNode.insertBefore(status, els.siteInstallCopy.nextSibling);
    }
    copyText(els.siteInstallCmd.textContent, status);
  });

  var timer;
  els.search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = els.search.value.trim(); writeUrl(); renderRows(); }, 80);
  });

  // "/" focuses the search box.
  document.addEventListener('keydown', function (e) {
    var t = e.target.tagName;
    if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') {
      e.preventDefault();
      els.search.focus();
    }
  });

  // ---------- share a shortcut ----------

  function cleanSite(s) {
    return norm(s).trim().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  }

  // The same rules anysite-mcp applies when you run "add" (addShortcuts and checkShortcut in lib/shortcuts.js).
  function checkShortcuts(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['The JSON must be an object of { "name": { ... } }.'];
    var names = Object.keys(obj);
    if (!names.length) return ['There are no shortcuts in it.'];
    if (Array.isArray(obj.steps)) return ['This looks like one shortcut without its name. Wrap it as { "name": { ... } }.'];
    names.forEach(function (n) {
      var sc = obj[n];
      var at = '"' + n + '"';
      if (!NAME_RE.test(n)) errors.push(at + ': names use lowercase letters, digits and _, starting with a letter.');
      if (!sc || typeof sc !== 'object') { errors.push(at + ': must be an object.'); return; }
      if (typeof sc.description !== 'string' || !sc.description.trim()) errors.push(at + ': needs a description.');
      var params = sc.params || {};
      if (typeof params !== 'object' || Array.isArray(params)) errors.push(at + ': params must be an object.');
      if (!Array.isArray(sc.steps) || !sc.steps.length) { errors.push(at + ': needs a list of steps.'); return; }
      sc.steps.forEach(function (st, i) {
        var where = at + ', step ' + (i + 1) + (st && st.action ? ' (' + st.action + ')' : '');
        if (!st || typeof st !== 'object') { errors.push(where + ': must be an object.'); return; }
        if (ACTIONS.indexOf(st.action) === -1) errors.push(where + ': use one of ' + ACTIONS.join(', ') + '.');
        if (st.ref) errors.push(where + ': refs like "' + st.ref + '" only last until the page changes. Use role and name instead.');
        var re = /\{\{(\w+)\}\}/g, m, text = JSON.stringify(st);
        while ((m = re.exec(text)) !== null) {
          if (!(m[1] in params)) errors.push(where + ' uses {{' + m[1] + '}}, which is not in params.');
        }
      });
    });
    return errors;
  }

  function warnings(text) {
    var w = [];
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) w.push('It contains something that looks like an email address.');
    if (/[?&](token|key|auth|session|sid)=/i.test(text)) w.push('A URL in it has a token or key in it.');
    return w;
  }

  function showErrors(list) {
    els.errors.textContent = '';
    if (!list.length) { els.errors.hidden = true; return; }
    els.errors.appendChild(el('strong', { text: 'Please fix this first:' }));
    var ul = el('ul');
    list.forEach(function (e) { ul.appendChild(el('li', { text: e })); });
    els.errors.appendChild(ul);
    els.errors.hidden = false;
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    els.output.hidden = true;
    var site = cleanSite(els.siteInput.value);
    var errors = [];
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site) && !/^[a-z][a-z0-9_-]*$/.test(site)) errors.push('Site must be a domain like github.com.');

    var obj = null;
    try { obj = JSON.parse(els.jsonInput.value); } catch (err) { errors.push('The JSON does not parse: ' + err.message); }
    if (obj) errors = errors.concat(checkShortcuts(obj));
    showErrors(errors);
    if (errors.length) return;

    var json = JSON.stringify(obj, null, 2);
    var names = Object.keys(obj);
    var existing = all.filter(function (s) { return s.site === site; }).map(function (s) { return s.name; });
    var clash = names.filter(function (n) { return existing.indexOf(n) !== -1; });
    var fileExists = sites.indexOf(site) !== -1;

    els.summary.textContent = '';
    els.summary.appendChild(document.createTextNode('Looks good: ' + names.map(function (n) { return toolPrefix(site) + '_' + n; }).join(', ') + '.'));
    if (clash.length) els.summary.appendChild(el('div', { 'class': 'warn', text: 'The library already has ' + clash.join(', ') + ' for ' + site + '. Say in the issue why yours is better, or pick another name.' }));
    warnings(json).forEach(function (w) { els.summary.appendChild(el('div', { 'class': 'warn', text: w + ' Check it before sharing.' })); });

    els.json.textContent = json;
    els.copyStatus.textContent = '';

    var title = 'Shortcut: ' + names.map(function (n) { return toolPrefix(site) + '_' + n; }).join(', ');
    els.issue.href = 'https://github.com/' + REPO + '/issues/new?template=shortcut_share.yml' +
      '&title=' + encodeURIComponent(title) +
      '&site=' + encodeURIComponent(site) +
      '&shortcuts=' + encodeURIComponent(json);

    var file = 'library/' + site + '.json';
    if (fileExists) {
      els.pr.href = 'https://github.com/' + REPO + '/edit/' + BRANCH + '/library/' + encodeURIComponent(site + '.json');
      els.prHint.textContent = 'The pull request link opens ' + file + ' on GitHub. Paste your entries into its top-level object (mind the commas), then propose the change.';
    } else {
      els.pr.href = 'https://github.com/' + REPO + '/new/' + BRANCH + '/library?filename=' + encodeURIComponent(site + '.json') + '&value=' + encodeURIComponent(json + '\n');
      els.prHint.textContent = 'The pull request link creates ' + file + ' on GitHub with your shortcuts already in it. Add a row for it to library/README.md too if you like.';
    }
    if (json.length > 6000) els.prHint.textContent += ' It is long, so if a link opens empty, use Copy JSON and paste it in.';

    els.output.hidden = false;
    els.output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  els.copy.addEventListener('click', function () { copyText(els.json.textContent, els.copyStatus); });

  // ---------- start ----------

  readUrl();
  els.search.value = state.q;

  // The preview build sets window.__LIBRARY__; the real site reads the index the Pages build makes.
  // health.json comes from the weekly health check; without it every badge says "not checked yet".
  var healthLoad = window.__LIBRARY__ ? Promise.resolve(window.__HEALTH__ || null) : fetch('library/health.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
  Promise.all([window.__LIBRARY__ ? Promise.resolve(window.__LIBRARY__) : fetch('library/index.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), healthLoad])
    .then(function (loaded) {
      var data = loaded[0];
      health = loaded[1];
      all = (data.shortcuts || []).slice().sort(function (a, b) {
        return a.site === b.site ? a.name.localeCompare(b.name) : a.site.localeCompare(b.site);
      });
      sites = (data.sites || []).slice().sort();
      sites.forEach(function (s) { els.siteList.appendChild(el('option', { value: s })); });
      if (state.site !== 'All' && sites.indexOf(state.site) === -1) state.site = 'All';
      render();
    })
    .catch(function (err) {
      els.body.textContent = '';
      els.body.appendChild(el('tr', null, [el('td', { colspan: '3', 'class': 'empty',
        text: 'Could not load library/index.json (' + err.message + '). To run it locally: node shortcuts-library/build.js, then serve the _site folder.' })]));
    });
})();
