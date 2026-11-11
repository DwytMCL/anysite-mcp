// NotebookLM (now also called Gemini Notebook). Shortcut tools for common jobs; they match elements by
// loose role/name patterns, so small wording changes still work, and when they fail the web_* tools still can.
export default ({ z, kit }) => {
  const HOME_URL = 'https://notebooklm.google.com/';
  const NOTEBOOK_LINK = 'a[href*="/notebook/"]';

  async function notebookLinks(p) {
    if (new URL(p.url()).pathname !== '/') await p.goto(HOME_URL);
    await p.locator(NOTEBOOK_LINK).first().waitFor({ timeout: 20000 });
    return p.locator(NOTEBOOK_LINK).evaluateAll(as => as.map(a => ({ title: a.innerText.replace(/\s+/g, ' ').trim(), url: a.href })));
  }

  // notebook: a notebook URL, its id, or (part of) its title.
  async function openNotebook(p, notebook) {
    if (/^https?:/.test(notebook)) await p.goto(notebook);
    else if (/^[0-9a-f-]{36}$/i.test(notebook)) await p.goto(new URL(`/notebook/${notebook}`, HOME_URL).href);
    else {
      const want = notebook.toLowerCase();
      const links = await notebookLinks(p);
      const hit = links.find(l => l.title.toLowerCase() === want) || links.find(l => l.title.toLowerCase().includes(want));
      if (!hit) throw new Error(`No notebook matching "${notebook}". Notebooks: ${links.map(l => l.title).join(' | ')}`);
      await p.goto(hit.url);
    }
    await p.waitForLoadState('domcontentloaded');
    await p.getByRole('textbox').first().waitFor({ timeout: 20000 }).catch(() => {});
    await kit.settle(p);
    await kit.dismissPopups(p);
  }

  const notebookArg = z.string().optional().describe('Notebook title (or part of it), id or URL. Omit to use the open notebook.');

  return {
    version: 1,
    url: HOME_URL,
    tools: {
      list_notebooks: {
        readOnly: true,
        description: 'List NotebookLM notebooks with their URLs (yours first, then featured ones).',
        run: async p => (await notebookLinks(p)).map(l => `${l.title}\t${l.url}`).join('\n'),
      },

      create_notebook: {
        writes: true,
        description: 'Create a new empty NotebookLM notebook, optionally titled. Returns its URL.',
        input: { title: z.string().optional() },
        async run(p, { title }) {
          await p.goto(HOME_URL);
          await p.getByRole('button', { name: /new notebook|create( new)? notebook/i }).first().click();
          await p.waitForURL(/\/notebook\//, { timeout: 20000 });
          await kit.sleep(2000);
          await kit.dismissPopups(p);
          if (title) {
            // The title is the textbox whose value is the placeholder name, e.g. "Untitled notebook".
            for (const box of await p.getByRole('textbox').all()) {
              if (/untitled/i.test(await box.inputValue().catch(() => ''))) {
                await box.fill(title); await box.press('Enter'); break;
              }
            }
          }
          return `Created ${title ? `"${title}" ` : ''}${p.url()}`;
        },
      },

      ask: {
        description: 'Ask a NotebookLM notebook a question and return its full answer (waits until it finishes).',
        input: { notebook: notebookArg, question: z.string(), timeout_seconds: z.number().min(10).max(600).optional() },
        async run(p, { notebook, question, timeout_seconds = 180 }) {
          if (notebook) await openNotebook(p, notebook); else await kit.dismissPopups(p);
          const box = p.getByRole('textbox', { name: /query|ask|chat|message|prompt/i })
            .or(p.getByPlaceholder(/ask|question/i)).last();
          // Page text after the last copy of the question = answer + the rest of the page (other panels).
          const after = async () => {
            const body = await p.locator('body').innerText();
            const i = body.lastIndexOf(question);
            return i < 0 ? '' : body.slice(i + question.length);
          };
          // Right after a notebook opens, Enter can be ignored; retry until the question shows up in the chat.
          const shown = (await p.locator('body').innerText()).split(question).length;
          for (let tries = 0; ; tries++) {
            await box.fill(question, { timeout: 10000 });
            await box.press('Enter');
            const ok = await p.waitForFunction(([q, n]) => document.body.innerText.split(q).length > n,
              [question, shown], { timeout: 15000 }).then(() => true, () => false);
            if (ok) break;
            if (tries === 2) throw new Error('The question was not accepted. Use web_snapshot to see why.');
          }
          let before = '', last = '', changed = false, stableFor = 0;
          for (const end = Date.now() + timeout_seconds * 1000; Date.now() < end && !(changed && stableFor >= 5000);) {
            await kit.sleep(1000);
            const now = await after();
            if (!before) before = now;
            else if (now !== before) changed = true;
            stableFor = now && now === last ? stableFor + 1000 : 0;
            last = now;
          }
          // Drop icon-font names (e.g. thumb_up) and cut where the rest of the page starts: the first run of
          // 3 lines that were already on the page before the answer arrived.
          const icon = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$|^(copy|tune|sort|quiz|article|tablet|videocam|flowchart|settings)$/;
          const seen = new Set(before.split('\n').map(s => s.trim()).filter(Boolean));
          const lines = last.split('\n').map(s => s.trim()).filter(s => s && !icon.test(s));
          const cut = lines.findIndex((_, i) => i + 2 < lines.length && [0, 1, 2].every(k => seen.has(lines[i + k])));
          const reply = (cut < 0 ? lines : lines.slice(0, cut)).join('\n');
          if (!(changed && stableFor >= 5000)) return `Still answering after ${timeout_seconds}s. Partial answer:\n${reply}`;
          return reply;
        },
      },

      add_source: {
        writes: true,
        description: 'Add sources to a NotebookLM notebook: website/YouTube URLs, pasted text, and/or local files.',
        input: { notebook: notebookArg, urls: z.array(z.string()).optional(), text: z.string().optional(),
          files: z.array(z.string()).optional() },
        async run(p, { notebook, urls, text: pasted, files }) {
          if (!urls?.length && !pasted && !files?.length) throw new Error('Give urls, text or files.');
          if (notebook) await openNotebook(p, notebook);
          const openAdder = async () => {
            // A new notebook opens the dialog by itself; otherwise click "Add source".
            if (!await p.getByRole('dialog').last().getByRole('button', { name: /website|copied text|upload/i }).first()
              .isVisible().catch(() => false))
              await p.getByRole('button', { name: /add sources?/i }).first().click();
            return p.getByRole('dialog').last();
          };
          const insert = async (kind, field, value) => {
            const d = await openAdder();
            await d.getByRole('button', { name: kind }).first().click();
            const f = p.getByRole('dialog').last().getByRole('textbox', { name: field }).first();
            await f.fill(value);
            await p.getByRole('dialog').last().getByRole('button', { name: /^(insert|add|submit)/i }).first().click();
            await kit.sleep(1500);
          };
          const done = [];
          if (urls?.length) { await insert(/website|link|url/i, /url|link/i, urls.join('\n')); done.push(`${urls.length} URL(s)`); }
          if (pasted) { await insert(/copied text|paste/i, /paste|text/i, pasted); done.push('pasted text'); }
          if (files?.length) {
            const d = await openAdder();
            const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }),
              d.getByRole('button', { name: /upload|choose file|browse/i }).first().click()]);
            await chooser.setFiles(files);
            await kit.sleep(3000);
            done.push(`${files.length} file(s)`);
          }
          await kit.dismissPopups(p);
          return `Added ${done.join(', ')}. Sources can take a minute to process; use web_snapshot to check.`;
        },
      },
    },
  };
};
