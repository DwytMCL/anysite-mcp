// Gemini web app (gemini.google.com). gemini_ask covers most jobs; anything else goes through the web_* tools.

// A reply that ends on a lead-in ("To explore this:") only had follow-up suggestion buttons after it; drop the line.
export const dropLeadIn = (text, hadButtons) => hadButtons ? text.replace(/\n+[^\n]*:\s*$/, '') : text;

export default ({ z, kit }) => {
  const HOME_URL = 'https://gemini.google.com/app';
  const CHAT_LINK = 'a[href*="/app/"]';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  async function chatLinks(p) {
    if (!p.url().startsWith('https://gemini.google.com/')) await p.goto(HOME_URL);
    // Attached, not visible: a collapsed sidebar hides the links. If there are none at all, open the sidebar.
    const first = p.locator(CHAT_LINK).first();
    const there = () => first.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
    if (!await there()) {
      await p.getByRole('button', { name: /main menu/i }).first().click({ timeout: 3000 }).catch(() => {});
      if (!await first.waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false))
        throw new Error('No chats found. If Gemini asks you to sign in, run web_login for gemini first; otherwise use web_snapshot to see the page.');
    }
    return p.locator(CHAT_LINK).evaluateAll(as => as.map(a => ({ title: (a.innerText || a.textContent).replace(/\s+/g, ' ').trim(), url: a.href })));
  }

  // chat: a chat URL, its id, or (part of) its title.
  async function openChat(p, chat) {
    if (/^https?:/.test(chat)) await p.goto(chat);
    else if (/^[0-9a-f]{12,}$/i.test(chat)) await p.goto(new URL(`/app/${chat}`, HOME_URL).href);
    else {
      const want = chat.toLowerCase();
      const links = await chatLinks(p);
      const hit = links.find(l => l.title.toLowerCase() === want) || links.find(l => l.title.toLowerCase().includes(want));
      if (!hit) throw new Error(`No recent chat matching "${chat}". Use gemini_list_chats to see them.`);
      await p.goto(hit.url);
    }
  }

  // Reply as light markdown: bullets, numbers, headings and code fences survive; buttons and icons go.
  // The copy is laid out off-screen because innerText needs layout to keep line breaks.
  const replyText = loc => loc.evaluate(el => {
    const c = el.cloneNode(true);
    // Formulas: keep the TeX source instead of the several rendered copies Gemini lays out.
    c.querySelectorAll('[data-math], .katex').forEach(m => {
      const tex = m.getAttribute('data-math') || m.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) m.replaceWith('$' + tex.trim() + '$');
    });
    const hadButtons = !!c.querySelector('button');
    c.querySelectorAll('button, mat-icon, [aria-hidden="true"]').forEach(e => e.remove());
    c.querySelectorAll('li').forEach(li => li.prepend(li.parentElement.tagName === 'OL'
      ? `${[...li.parentElement.children].indexOf(li) + 1}. ` : '- '));
    c.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => h.prepend('#'.repeat(+h.tagName[1]) + ' '));
    c.querySelectorAll('pre').forEach(pre => { pre.textContent = '```\n' + pre.textContent.replace(/\n+$/, '') + '\n```'; });
    Object.assign(c.style, { position: 'fixed', left: '-99999px', top: '0', width: '800px' });
    document.body.append(c);
    // List items wrap their text in paragraphs, which puts it on the line after the bullet.
    const t = c.innerText.replace(/^(- |\d+\. )\s*\n+/gm, '$1').replace(/\n{3,}/g, '\n\n').trim();
    c.remove();
    return { t, hadButtons };
  }).then(({ t, hadButtons }) => dropLeadIn(t, hadButtons));

  // Open a menu with `opener` and click the item whose name matches `want`; on a miss, list the items.
  async function pickMenuItem(p, opener, role, want) {
    await opener.click();
    const items = p.getByRole(role); // not scoped to one menu: Gemini nests menus
    await items.first().waitFor({ timeout: 5000 });
    const hit = items.filter({ hasText: new RegExp(esc(want), 'i') }).first();
    if (!await hit.count()) {
      const names = await items.allInnerTexts();
      await p.keyboard.press('Escape');
      throw new Error(`No "${want}" option. Options: ${names.map(n => n.replace(/\s+/g, ' ').trim()).join(' | ')} (others may be under a "More" button: use web_snapshot and web_click)`);
    }
    await hit.click();
    await kit.sleep(500);
  }

  return {
    version: 1,
    url: HOME_URL,
    tools: {
      list_chats: {
        readOnly: true,
        description: 'List recent Gemini chats from the sidebar with their URLs, newest first.',
        run: async p => (await chatLinks(p)).map(l => `${l.title}\t${l.url}`).join('\n'),
      },

      ask: {
        description: 'Send Gemini a prompt and return its finished reply (waits for thinking and streaming to end). ' +
          'Starts a new chat unless `chat` is given. Can attach files, pick a model and switch on a tool such as Create image.',
        input: { prompt: z.string(),
          chat: z.string().optional().describe('Continue a chat: "current" for the open one, or a chat title (or part), id or URL'),
          files: z.array(z.string()).optional().describe('Local files to attach'),
          model: z.string().optional().describe('Model from the mode picker, e.g. "Pro", "Flash", "Flash-Lite"'),
          tool: z.string().optional().describe('Tool to switch on first, e.g. "Create image", "Create video", "Deep Research"'),
          timeout_seconds: z.number().min(10).max(900).optional() },
        async run(p, { prompt, chat, files, model, tool: useTool, timeout_seconds = 300 }, site, /** @type {{ progress?: Function }} */ { progress } = {}) {
          if (!chat) await p.goto(HOME_URL);
          else if (chat !== 'current') await openChat(p, chat);
          const box = p.getByRole('textbox', { name: /prompt|ask gemini/i }).first();
          await box.waitFor({ timeout: 20000 });
          if (model) await pickMenuItem(p, p.getByRole('button', { name: /mode picker|model/i }).first(), 'menuitem', model);
          const tools = p.getByRole('button', { name: /upload & tools|tools/i }).first();
          if (useTool) await pickMenuItem(p, tools, 'menuitemcheckbox', useTool);
          if (files?.length) {
            await tools.click();
            const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }),
              p.getByRole('menuitem', { name: /upload files/i }).first().click()]);
            await chooser.setFiles(files);
          }
          // Enter is ignored while attachments upload; retry until the prompt is the chat's last message.
          // (Counting messages fails because an opened chat's history keeps loading for a while.)
          const head = prompt.replace(/\s+/g, ' ').trim().slice(0, 60);
          await box.fill(prompt, { timeout: 10000 });
          for (let tries = 0; ; tries++) {
            await box.press('Enter');
            const ok = await p.waitForFunction(h => [...document.querySelectorAll('user-query')].pop()?.innerText.replace(/\s+/g, ' ').includes(h),
              head, { timeout: 5000 }).then(() => true, () => false);
            if (ok) break;
            if (tries === 20) throw new Error('The prompt was not accepted. Use web_snapshot to see why.');
          }
          progress?.(0, timeout_seconds, 'Prompt sent, waiting for Gemini');
          const stop = p.getByRole('button', { name: /stop (response|generating)/i });
          const reply = p.locator('xpath=(//user-query)[last()]/following::model-response[1]');
          let last = '', stableFor = 0, done = false;
          const began = Date.now();
          let noted = began;
          for (const end = began + timeout_seconds * 1000; Date.now() < end && !done;) {
            await kit.sleep(1000);
            const secs = Math.round((Date.now() - began) / 1000);
            if (Date.now() - noted >= 5000) { noted = Date.now(); progress?.(Math.min(secs, timeout_seconds), timeout_seconds, `Waiting for Gemini's reply (${secs} s)`); }
            // Short timeout: before the reply starts there is nothing to read, and the default wait is 30 s.
            const now = await reply.locator('message-content').first().innerText({ timeout: 1000 }).catch(() => '');
            const imgs = await reply.locator('img[src^="http"], img[src^="blob:"]').count().catch(() => 0);
            stableFor = now === last ? stableFor + 1000 : 0;
            last = now;
            done = (now || imgs) && !await stop.count() && stableFor >= 2000;
          }
          const content = reply.locator('message-content').first();
          const body = await content.count() ? await replyText(content) : last;
          const imgs = await reply.locator('img[src^="http"], img[src^="blob:"]').count().catch(() => 0);
          const extra = (imgs ? `\n\n[${imgs} image(s) in the reply. Use web_snapshot and web_download to save them.]` : '') + `\n\nChat: ${p.url()}`;
          return (done ? '' : `Still answering after ${timeout_seconds}s. Partial reply:\n`) + body + extra;
        },
      },
    },
  };
};
