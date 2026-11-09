// Record mode: what the user does by hand in the site's Chrome becomes a shortcut.
import { getPage } from './browser.js';
import { addEvent, parametrize, recorderScript } from './recorder.js';
import { checkShortcut, readShortcuts, writeShortcuts } from './shortcuts.js';

// Record mode (lib/recorder.js). The caller registers the shortcut stopRecording returns as a tool.
const REC_TOKEN = Math.random().toString(36).slice(2);
export async function startRecording(site) {
  const p = await getPage(site);
  const ctx = p.context();
  site.recording = [{ action: 'open', url: p.url() }];
  if (!site.recorder) {
    await ctx.exposeBinding('__anysiteRecord', (_source, ev) => {
      if (site.recording && ev?.token === REC_TOKEN) addEvent(site.recording, ev);
    });
    await ctx.addInitScript(recorderScript(REC_TOKEN));
    site.recorder = true;
  }
  for (const page of ctx.pages()) await page.evaluate(recorderScript(REC_TOKEN)).catch(() => {});
  await p.bringToFront().catch(() => {});
}
export function stopRecording(site, name, description) {
  if (!site.recording) throw new Error(`Not recording on ${site.name}. Start with action "start".`);
  const { params, steps } = parametrize(site.recording);
  site.recording = null;
  if (steps.length < 2) throw new Error('Nothing was recorded: no clicks or typing happened in the window.');
  const sc = { description, ...(Object.keys(params).length ? { params } : {}), steps };
  checkShortcut(sc);
  writeShortcuts(site, { ...readShortcuts(site), [name]: sc });
  return sc;
}
