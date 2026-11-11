// The MCP server and its tools: web_* page tools, pack tools and saved shortcuts.
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { DOWNLOADS, HEADLESS, MAX_TEXT, QUIT, VERSION } from './config.js';
import { getPage, loadSite, login, sites } from './browser.js';
import { show, target } from './snapshot.js';
import { confirmRequest, permit, setAsk } from './guard.js';
import { actions, extractRows, extractText, STEP_NAMES } from './actions.js';
import { checkShortcut, exclusive, paramSpec, readShortcuts, runSteps, shortcutAnnotations, updateShortcut, writeShortcuts } from './shortcuts.js';
import { startRecording, stopRecording } from './recording.js';

const clip = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n…[truncated]' : s);
const text = s => ({ content: [{ type: 'text', text: clip(s) }] });
// The same answer as text, for clients that read text, and as data matching the tool's outputSchema.
const withData = (s, data) => ({ ...text(s), structuredContent: data });

// MCP server.

export const server = new McpServer({ name: 'anysite', version: VERSION }, {
  instructions: 'Use websites through a real Chrome that is signed in as the user; each site has its own browser profile. ' +
    'Call web_snapshot first, then act on elements by their ref (e.g. e12) or role and name. After an action you get ' +
    'only what changed on the page; call web_snapshot when you need all of it. Use web_extract to get lists as JSON. ' +
    'Pass `site` as a site name or a domain: any domain works, not only the ones already set up. ' +
    'If a page asks the user to sign in, call web_login and wait for the user to say they are done. ' +
    'Prefer a site\'s own tools (named <site>_...) when one fits. When a sequence of steps works and is likely to be ' +
    'wanted again, save it with web_save_shortcut so it becomes one tool. If the user wants to show you how to do ' +
    'something, use web_record. Some sites are read-only or ask the user first; respect a refusal and do not work around it.' });

// Confirmations (lib/guard.js) ask through the MCP client; null tells guard the client can't ask.
setAsk((site, what) => server.server.getClientCapabilities()?.elicitation
  ? server.server.elicitInput(confirmRequest(site, what)) : null);

// Hints for clients about what a tool does (some ask the user before destructive ones). Every hint is set, so
// nothing rests on the spec's defaults. A click that only navigates still counts as destructive: the cautious side.
const READS = { readOnlyHint: true, openWorldHint: true };
const ACTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
const OTHER = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

// progress(done, total, message) sends notifications/progress when the client asked for it (it sent a
// progressToken) and does nothing otherwise. A lost update never fails the tool.
const progressFor = ctx => {
  const token = ctx?.mcpReq?._meta?.progressToken;
  if (token === undefined) return async () => {};
  return (progress, total, message) => ctx.mcpReq.notify({ method: 'notifications/progress',
    params: { progressToken: token, progress, total, message } }).catch(() => {});
};

// Tools, packs and shortcuts give raw zod shapes; SDK v2 wants a schema object.
export const tool = (name, description, schema, annotations, fn, outputSchema) => server.registerTool(name,
  { description, inputSchema: z.object(schema), annotations, outputSchema },
  async (args, ctx) => {
    try { const r = await fn(args, { progress: progressFor(ctx) }); return typeof r === 'string' ? text(r) : r; }
    catch (e) { return { ...text(`Error: ${e.message}`), isError: true }; }
  });

export const zodParam = d => {
  const p = paramSpec(d);
  const t = (p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string())
    .describe(`${p.description || ''}${p.default !== undefined ? ` (default: ${p.default})` : ''}`);
  return p.optional || p.default !== undefined ? t.optional() : t;
};

const shortcutTools = new Map();
export function addShortcut(site, name, sc) {
  const key = `${site.prefix}_${name}`;
  shortcutTools.get(key)?.remove();
  shortcutTools.set(key, tool(key, `${sc.description} (saved shortcut for ${site.name})`,
    Object.fromEntries(Object.entries(sc.params || {}).map(([k, d]) => [k, zodParam(d)])),
    { ...shortcutAnnotations(sc), openWorldHint: true },
    a => exclusive(site, async () => {
      const r = await runSteps(site, sc, a);
      if (r.repaired) { sc.steps = r.steps; updateShortcut(site, name, r.steps); }
      return r.text + (r.repaired ? ' The shortcut was updated to match.' : '');
    })));
}

const registered = new Set();
export async function useSite(arg) {
  if (!arg) {
    if (sites.size === 1) return [...sites.values()][0];
    throw new Error(`Say which site: ${[...sites.keys()].join(', ') || 'any domain, e.g. github.com'}`);
  }
  const site = await loadSite(arg);
  if (!registered.has(site.name)) {
    registered.add(site.name);
    for (const [n, t] of Object.entries(site.tools || {}))
      tool(`${site.prefix}_${n}`, t.description, t.input || {},
        { readOnlyHint: !!t.readOnly, destructiveHint: !!t.writes, openWorldHint: true }, (a, { progress }) => exclusive(site, async () => {
        if (t.writes) await permit(site, `use ${site.prefix}_${n}`);
        return t.run(await getPage(site), a, site, { progress });
      }));
    for (const [n, sc] of Object.entries(readShortcuts(site))) addShortcut(site, n, sc);
  }
  return site;
}

const siteArg = z.string().optional().describe('Site name or domain, e.g. gemini or github.com. Optional when only one site is in use.');
const web = (name, description, schema, annotations, fn, outputSchema) => tool(`web_${name}`, description, { site: siteArg, ...schema }, annotations,
  async ({ site, ...a }, { progress }) => {
    const s = await useSite(site);
    return exclusive(s, async () => fn(await getPage(s), a, s, { progress }));
  }, outputSchema);
const field = z.object({ role: z.string(), name: z.string(), text: z.string(), exact: z.boolean(), nth: z.number().int(),
  attr: z.string().describe('Return this attribute instead of the text, e.g. href') }).partial();

web('snapshot', 'Accessibility tree of the site\'s current page: roles, names and text of every element, each with a ' +
  'ref (e.g. [ref=e12]) to pass to other tools. Give ref or role/name to show only that part of the page, or depth ' +
  'to see only the top levels of a big page.',
  { ...target, depth: z.number().int().min(1).optional().describe('Only this many levels deep') }, READS, actions.snapshot);
web('open', 'Go to a URL (absolute, or relative to the site; default: the site\'s home) and return the snapshot.',
  { url: z.string().optional(), show }, READS, actions.open);
web('click', 'Click an element found by ref, role/name or text. Returns what changed on the page.',
  { ...target, show }, ACTS, actions.click);
web('type', 'Fill a text field found by ref, role/name or label/placeholder, optionally pressing Enter. ' +
  'Returns what changed on the page.',
  { ...target, value: z.string(), submit: z.boolean().optional(), show }, ACTS, actions.type);
web('select', 'Choose an option in a drop-down (<select>) found by ref, role/name or label.',
  { ...target, value: z.string().describe('The option\'s label or value'), show }, ACTS, actions.select);
web('press', 'Press a key or chord on the focused element, e.g. Enter, Escape, Tab.', { key: z.string(), show }, ACTS, actions.press);
web('upload', 'Click an element that opens a file picker (e.g. an upload button) and give it local files.',
  { ...target, paths: z.array(z.string()), show }, ACTS, actions.upload);
web('read', 'Visible text of the page (or of one element), e.g. to read a full reply.', target, READS, actions.read);
web('extract', 'Rows as JSON, one per element matching the target (e.g. role "row", "listitem" or "article"). ' +
  'Without fields each row is { text, link }. With fields, each field is found inside the row, e.g. ' +
  '{"title":{"role":"link"},"url":{"role":"link","attr":"href"},"score":{"text":"points"}}.',
  { ...target, fields: z.record(z.string(), field).optional(), limit: z.number().int().min(1).max(500).optional() },
  READS, async (p, a) => { const r = await extractRows(p, a); return withData(extractText(r), r); },
  z.object({ rows: z.array(z.record(z.string(), z.unknown())), note: z.string().optional() }));
web('wait', 'Wait for the page to settle, e.g. while something is generating. With until_text, fails if the text ' +
  'has not appeared in time.',
  { seconds: z.number().min(0).max(120), until_text: z.string().optional().describe('Stop early once this text appears'), show },
  READS, actions.wait);
web('download', 'Click an element that downloads a file and save it. ' +
  `Saved to ${DOWNLOADS} unless save_dir is given. Returns the saved path.`,
  { ...target, save_dir: z.string().optional() }, OTHER, actions.download);
web('screenshot', 'PNG screenshot of the current page, for when the snapshot is not enough.', {}, READS,
  async p => ({ content: [{ type: 'image', mimeType: 'image/png', data: (await p.screenshot()).toString('base64') }] }));

tool('web_login', 'Open a normal Chrome window on the site so the user can sign in by hand (automated browsers are ' +
  'often refused). Then ask the user to sign in and quit that window, and wait for them to say so before using the site.',
  { site: z.string() }, OTHER, async ({ site }) => {
    const s = await useSite(site);
    await exclusive(s, () => login(s));
    return `A Chrome window opened on ${s.url}. Ask the user to sign in there, then ${QUIT}, ` +
      'and tell you. The login is kept for next time.';
  });

tool('web_record', 'Learn a job by watching the user do it. "start" brings the site\'s Chrome window to the front and ' +
  'records the user\'s clicks, typing and choices there; ask the user to do the job and to tell you when they are done. ' +
  '"stop" saves what they did as a shortcut tool named <site>_<name>, with each typed value as a parameter.',
  { site: z.string(), action: z.enum(['start', 'stop']), name: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    description: z.string().optional().describe('What the shortcut does, for stop') }, OTHER,
  async ({ site, action, name, description }) => {
    const s = await useSite(site);
    if (action === 'start') {
      await exclusive(s, () => startRecording(s));
      return `Recording on ${s.name}${HEADLESS ? ' (Chrome is headless here, so the user can\'t see it: unset ANYSITE_HEADLESS to record)' : ''}. ` +
        'Ask the user to do the job in that Chrome window and tell you when they are done. Then call web_record with ' +
        'action "stop", a name and a description.';
    }
    if (!name || !description) throw new Error('Give a name and a description to save the recording.');
    const sc = stopRecording(s, name, description);
    addShortcut(s, name, sc);
    return `Saved ${s.prefix}_${name}:\n${JSON.stringify(sc, null, 2)}\nRead it over: if a step clicks a specific ` +
      'item that should change each time, edit it with web_save_shortcut to use a {{param}}.';
  });

tool('web_save_shortcut', 'Save a sequence of steps that worked as a new tool named <site>_<name>, available now and in ' +
  'later sessions. Each step is { action, ...arguments of the web_<action> tool }, e.g. ' +
  '{"action":"type","role":"textbox","name":"Search","value":"{{query}}","submit":true}. "{{param}}" is replaced by ' +
  'the argument. Find elements by role and name (refs do not last). Add "expect":"some text" to a step to make the ' +
  'shortcut fail if that text is not on the page afterwards. The tool returns the text of its "read" and "extract" ' +
  'steps, or the final page if there are none. The steps are run once with test_args before saving, so a broken ' +
  'shortcut is not saved; that run also notes other ways to find each element, so the shortcut can repair itself ' +
  'when the site changes. Saving under an existing name replaces it.',
  { site: z.string(), name: z.string().regex(/^[a-z][a-z0-9_]*$/), description: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.object({ description: z.string(),
      type: z.enum(['string', 'number', 'boolean']).optional(), optional: z.boolean().optional(),
      default: z.union([z.string(), z.number(), z.boolean()]).optional(), example: z.string().optional() })])).optional()
      .describe('Parameter name -> description, or { description, type, optional, default, example }. example is a value that works; doctor tries it'),
    steps: z.array(z.object({ action: z.enum(STEP_NAMES), expect: z.string().optional() }).catchall(z.any())).min(1)
      .describe(`Actions: ${STEP_NAMES.join(', ')}`),
    test_args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
      .describe('Values for params to use in the test run'),
    verify: z.boolean().optional().describe('Run the steps once before saving (default true). Set false only when ' +
      'running them again would do something twice, such as sending a message or buying something') },
  // Saving replaces a shortcut of the same name; the test run acts on the live site.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async ({ site, name, test_args = {}, verify = true, ...sc }) => {
    const s = await useSite(site);
    checkShortcut(sc);
    let note = '';
    if (verify) {
      const missing = Object.entries(sc.params || {}).map(([k, d]) => [k, paramSpec(d)])
        .filter(([k, d]) => test_args[k] === undefined && d.default === undefined && !d.optional).map(([k]) => k);
      if (missing.length) throw new Error(`Give test_args for ${missing.join(', ')} so the steps can be tried, or set verify: false.`);
      const r = await exclusive(s, () => runSteps(s, sc, test_args, { learn: true }));
      sc.steps = r.steps;
      note = ` Test run worked and returned:\n${r.text.slice(0, 500)}${r.text.length > 500 ? '…' : ''}`;
    }
    writeShortcuts(s, { ...readShortcuts(s), [name]: sc });
    addShortcut(s, name, sc);
    return `Saved ${s.prefix}_${name} in ${s.shortcutFile}.${note}`;
  });

tool('web_list_shortcuts', 'List the shortcuts saved for a site with their steps. With a name, return that one as ' +
  'JSON ready to share (other people add it with `anysite-mcp add <site> --from <file or URL>`).',
  { site: z.string(), name: z.string().optional() }, { readOnlyHint: true, openWorldHint: false }, async ({ site, name }) => {
    const s = await useSite(site);
    const all = readShortcuts(s);
    if (name && !all[name]) throw new Error(`No shortcut "${name}" for ${s.name}. Saved: ${Object.keys(all).join(', ') || 'none'}`);
    const picked = name ? { [name]: all[name] } : all;
    const data = { site: s.name, file: s.shortcutFile, shortcuts: Object.entries(picked).map(([n, sc]) => ({ name: n,
      tool: `${s.prefix}_${n}`, description: sc.description || '', params: sc.params || {}, steps: sc.steps || [] })) };
    if (name) return withData(JSON.stringify(picked, null, 2), data);
    if (!data.shortcuts.length) return withData(`No shortcuts saved for ${s.name} yet.`, data);
    return withData(`Shortcuts for ${s.name} (${s.shortcutFile}):\n` + Object.entries(all).map(([n, sc]) =>
      `\n${s.prefix}_${n}: ${sc.description}\n${JSON.stringify({ params: sc.params || {}, steps: sc.steps }, null, 2)}`).join('\n'), data);
  }, z.object({ site: z.string(), file: z.string(), shortcuts: z.array(z.object({ name: z.string(), tool: z.string(),
    description: z.string(), params: z.record(z.string(), z.unknown()), steps: z.array(z.record(z.string(), z.unknown())) })) }));

tool('web_delete_shortcut', 'Delete a saved shortcut.', { site: z.string(), name: z.string() },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, async ({ site, name }) => {
  const s = await useSite(site);
  const all = readShortcuts(s);
  if (!all[name]) throw new Error(`No shortcut "${name}" for ${s.name}. Saved: ${Object.keys(all).join(', ') || 'none'}`);
  delete all[name];
  writeShortcuts(s, all);
  shortcutTools.get(`${s.prefix}_${name}`)?.remove();
  shortcutTools.delete(`${s.prefix}_${name}`);
  return `Deleted ${s.prefix}_${name}.`;
});
