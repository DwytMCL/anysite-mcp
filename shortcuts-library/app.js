/* Shortcuts Library: loads shortcuts.json, filters it, and builds submissions. */
(function () {
  'use strict';

  // The GitHub repository that holds this site ("owner/name").
  // Used for the "Source on GitHub" link and the pre-filled issue link.
  var REPO = 'DwytMCL/anysite-mcp';

  // Categories shown as tags, in this order. Platforms in the data that are
  // not listed here still show up, after these.
  var PLATFORMS = ['Mac', 'iOS Shortcuts', 'Windows', 'Linux', 'VS Code', 'Vim', 'Blender', 'Browser'];

  var all = [];
  var state = { q: '', platform: 'All' };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    search: $('search'),
    count: $('count'),
    cats: $('category-list'),
    body: $('results-body'),
    form: $('add-form'),
    platformSelect: $('f-platform'),
    error: $('form-error'),
    output: $('output'),
    json: $('json-output'),
    copy: $('copy-btn'),
    copyStatus: $('copy-status'),
    issue: $('issue-link'),
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

  // "Ctrl+K Ctrl+S" -> <kbd>Ctrl</kbd>+<kbd>K</kbd> then <kbd>Ctrl</kbd>+<kbd>S</kbd>
  function renderKeys(keys) {
    var wrap = el('span');
    var steps = String(keys).trim().split(/\s+/);
    steps.forEach(function (step, i) {
      if (i > 0) wrap.appendChild(el('span', { 'class': 'then', text: 'then' }));
      // Split on "+" but keep a literal "+" key (e.g. "Ctrl++").
      var parts = step === '+' ? ['+'] : step.split(/\+(?!$)/);
      parts.forEach(function (p, j) {
        if (j > 0) wrap.appendChild(el('span', { 'class': 'plus', text: '+' }));
        wrap.appendChild(el('kbd', { text: p }));
      });
    });
    return wrap;
  }

  function isSafeUrl(u) { return /^https?:\/\//i.test(String(u || '')); }

  function platformList() {
    var seen = {};
    PLATFORMS.forEach(function (p) { seen[p] = true; });
    var extra = [];
    all.forEach(function (s) {
      if (s.platform && !seen[s.platform]) { seen[s.platform] = true; extra.push(s.platform); }
    });
    return PLATFORMS.concat(extra.sort());
  }

  // ---------- URL state (?q=...&platform=...) ----------

  function readUrl() {
    var params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    state.platform = params.get('platform') || 'All';
  }

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.platform !== 'All') params.set('platform', state.platform);
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  // ---------- browse ----------

  function matches(s, words) {
    if (state.platform !== 'All' && s.platform !== state.platform) return false;
    if (!words.length) return true;
    var hay = norm([s.title, s.description, s.keys, s.platform, (s.tags || []).join(' ')].join(' '));
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function renderCategories() {
    var counts = { All: all.length };
    all.forEach(function (s) { counts[s.platform] = (counts[s.platform] || 0) + 1; });
    els.cats.textContent = '';
    ['All'].concat(platformList()).forEach(function (p) {
      if (p !== 'All' && !counts[p]) return;
      var b = el('button', {
        type: 'button',
        'class': 'cat' + (state.platform === p ? ' active' : ''),
        'aria-pressed': state.platform === p ? 'true' : 'false'
      }, [p + ' ', el('span', { 'class': 'n', text: '(' + (counts[p] || 0) + ')' })]);
      b.addEventListener('click', function () {
        state.platform = p;
        writeUrl();
        render();
      });
      els.cats.appendChild(b);
      els.cats.appendChild(document.createTextNode(' '));
    });
  }

  function renderRows() {
    var words = norm(state.q).split(/\s+/).filter(Boolean);
    var list = all.filter(function (s) { return matches(s, words); });

    els.body.textContent = '';
    if (!list.length) {
      els.body.appendChild(el('tr', null, [el('td', { colspan: '3', 'class': 'empty', text: 'No shortcuts match. Try another search, or add one below.' })]));
    }

    list.forEach(function (s) {
      var info = el('td', { 'class': 'col-title' }, [
        el('div', { 'class': 's-title' }, [highlight(s.title, words)]),
        el('div', { 'class': 's-desc' }, [highlight(s.description, words)]),
        s.author ? el('div', { 'class': 's-by' }, ['added by ', el('a', { href: 'https://github.com/' + encodeURIComponent(s.author), text: s.author })]) : null
      ]);

      var keysCell = el('td', { 'class': 'col-keys' });
      if (s.keys) keysCell.appendChild(renderKeys(s.keys));
      if (s.link && isSafeUrl(s.link)) {
        keysCell.appendChild(el('div', { 'class': 'link-line' }, [
          el('a', { href: s.link, target: '_blank', rel: 'noopener nofollow', text: s.keys ? 'More info' : 'Open link' })
        ]));
      }
      if (!s.keys && !s.link) keysCell.textContent = '—';

      var plat = el('td', { 'class': 'col-platform' }, [el('span', { 'class': 'tag', text: s.platform })]);

      els.body.appendChild(el('tr', null, [info, keysCell, plat]));
    });

    els.count.textContent = list.length + ' of ' + all.length + ' shown';
  }

  function render() {
    renderCategories();
    renderRows();
  }

  var timer;
  els.search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = els.search.value.trim();
      writeUrl();
      renderRows();
    }, 80);
  });

  // "/" focuses the search box, like many sites of the era.
  document.addEventListener('keydown', function (e) {
    var t = e.target.tagName;
    if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') {
      e.preventDefault();
      els.search.focus();
    }
  });

  // ---------- add a shortcut ----------

  function fillPlatformSelect() {
    els.platformSelect.textContent = '';
    els.platformSelect.appendChild(el('option', { value: '', text: 'Choose one…' }));
    platformList().forEach(function (p) {
      els.platformSelect.appendChild(el('option', { value: p, text: p }));
    });
    els.platformSelect.appendChild(el('option', { value: '__other', text: 'Other (name it in the description)' }));
  }

  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = els.form.elements;
    var entry = {
      id: '',
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      platform: f.platform.value === '__other' ? 'Other' : f.platform.value
    };
    var keys = f.keys.value.trim();
    var link = f.link.value.trim();
    var author = f.author.value.trim().replace(/^@/, '');

    els.error.textContent = '';
    if (!entry.title || !entry.description || !entry.platform) {
      els.error.textContent = 'Title, platform and description are required.';
      return;
    }
    if (!keys && !link) {
      els.error.textContent = 'Add a key combination, a workflow link, or both.';
      return;
    }
    if (link && !isSafeUrl(link)) {
      els.error.textContent = 'The link must start with http:// or https://';
      return;
    }

    entry.id = slug(entry.platform + ' ' + entry.title);
    if (keys) entry.keys = keys;
    if (link) entry.link = link;
    if (author) entry.author = author;

    var json = JSON.stringify(entry, null, 2);
    els.json.textContent = json;
    els.copyStatus.textContent = '';

    var title = 'New shortcut: ' + entry.title + ' (' + entry.platform + ')';
    var body = 'Please add this shortcut to `shortcuts-library/shortcuts.json`.\n\n```json\n' + json + '\n```\n';
    els.issue.href = 'https://github.com/' + REPO + '/issues/new?title=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(body) + '&labels=shortcut';

    els.output.hidden = false;
    els.output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  els.copy.addEventListener('click', function () {
    var text = els.json.textContent;
    function done(ok) { els.copyStatus.textContent = ok ? 'Copied.' : 'Select the text above and copy it.'; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      // Fallback for older browsers and file:// pages.
      var ta = el('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
  });

  // ---------- start ----------

  readUrl();
  els.search.value = state.q;

  fetch('shortcuts.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      all = (Array.isArray(data) ? data : data.shortcuts || []).slice().sort(function (a, b) {
        return a.platform === b.platform ? a.title.localeCompare(b.title) : a.platform.localeCompare(b.platform);
      });
      fillPlatformSelect();
      render();
    })
    .catch(function (err) {
      els.body.textContent = '';
      els.body.appendChild(el('tr', null, [el('td', { colspan: '3', 'class': 'empty',
        text: 'Could not load shortcuts.json (' + err.message + '). If you opened this file directly, run a local server: python3 -m http.server' })]));
      fillPlatformSelect();
    });
})();
