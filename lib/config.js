// Paths and settings, from the environment.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = process.env.ANYSITE_HOME || join(homedir(), '.anysite-mcp');
export const DOWNLOADS = process.env.ANYSITE_DOWNLOADS || join(homedir(), 'Downloads', 'anysite');
export const PACK_DIRS = [join(HOME, 'sites'), fileURLToPath(new URL('../sites', import.meta.url))];
export const MAX_TEXT = 40000;
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// ANYSITE_HEADLESS=1 runs the automated Chrome without a window (sign-in always gets a window).
// ANYSITE_CHROME_ARGS adds Chrome flags, e.g. "--no-sandbox" when running as root in a container.
export const HEADLESS = /^(1|true|yes)$/i.test(process.env.ANYSITE_HEADLESS || '');
// Longest a tool call may run, in ms, before it returns an error (ANYSITE_TOOL_TIMEOUT in seconds; 0 turns it off).
export const TOOL_TIMEOUT = (Number(process.env.ANYSITE_TOOL_TIMEOUT) >= 0 && process.env.ANYSITE_TOOL_TIMEOUT !== undefined && process.env.ANYSITE_TOOL_TIMEOUT !== '' ? Number(process.env.ANYSITE_TOOL_TIMEOUT) : 180) * 1000;
export const CHROME_ARGS = (process.env.ANYSITE_CHROME_ARGS || '').split(/\s+/).filter(Boolean);
export const QUIT = process.platform === 'darwin' ? 'quit that window (Cmd+Q)' : 'close all of its windows';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const SETTINGS = join(HOME, 'settings.json');
