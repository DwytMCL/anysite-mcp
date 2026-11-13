# Changelog

## Unreleased

- When Chrome fails to start, the error now says why (its own message, or an exit code) instead of waiting 20 seconds and saying only "Could not start Chrome". A missing sandbox gets a short explanation with the fix (the AppArmor setting, or `ANYSITE_CHROME_ARGS=--no-sandbox` as root).

## 0.7.0

- New `anysite-mcp library check` compares your saved shortcuts with the library's and says which ones differ. It changes nothing.
- `add` and `library` now read the library's versioned files (`v1/`) and fall back to the original ones, so they keep working against
  a library that has not been updated. The original library URLs are unchanged, so older versions keep working too.
- Packs can declare `version` (none means 1). A pack written for a newer pack API is refused with a message naming the file,
  instead of failing in odd ways. The built-in packs say `version: 1`.
- A command that fails (a profile that will not open, a bad settings file) now prints one message and exits 1 instead of a stack trace.
- A saved-shortcuts file that is not valid JSON now says which file and what is wrong.
- Shortcut files are now versioned: `sites/<site>.json` is written as `{ "version": 1, "shortcuts": { ... } }`. Old files
  still load and are not touched until the first save, which first copies the old file to `<site>.v0.bak`. **anysite-mcp
  0.6.x and older cannot read a version 1 file**; restore the `.bak` to go back. A file written for a newer version is
  refused and left alone. `add` accepts both forms.
- A shortcut param can have an `example`, which `doctor` tries before the default (a param with no default no longer
  has to be tried with "test"). A shortcut can be marked `"needsSignIn": true`; the library shows it as "needs sign-in" and does not
  mark it broken.

## 0.6.0

- CI checks the server with a second MCP client, the MCP Inspector CLI (`npm run test:inspector`): the
  handshake, the tool list with its `--strict` schema checks, and a tool call.
- Progress notifications: `web_wait` reports each second, and `gemini_ask` (including Deep Research) reports
  every 5 s while it waits for the reply, for clients that ask for progress. Packs get `progress` as `run`'s
  fourth argument.
- Saving, recording and deleting a shortcut tell the client that the tool list changed
  (`notifications/tools/list_changed`), and the self-check now tests each of them.
- `web_extract` and `web_list_shortcuts` also return structured output (MCP `structuredContent`, with an
  `outputSchema`): `{ rows, note? }` and `{ site, file, shortcuts: [{ name, tool, description, params, steps }] }`.
  Their text is unchanged, so clients that read the text see no difference.
- Tools carry MCP annotations, so clients can tell what each one does. Reading tools (`web_snapshot`, `web_read`,
  `web_extract`, `web_list_shortcuts` and so on) are marked read-only. Tools that act on a page (`web_click`,
  `web_type`, `web_select`, `web_press`, `web_upload`) and `web_save_shortcut` and `web_delete_shortcut` are
  marked destructive. Shortcut tools are marked by their steps, and pack tools by `writes: true` or the new
  `readOnly: true`.
- Built on MCP TypeScript SDK v2 (`@modelcontextprotocol/server`); no change for clients. Tool input schemas now
  declare JSON Schema 2020-12 (the 2025-11-25 protocol's default) instead of draft-07, with the same content.
- `doctor` leaves optional parameters empty when it checks a shortcut, instead of filling them with "test". The
  library's `github.com/trending` showed ✗ because the check opened the trending page for a language called "test",
  which has no rows. The shortcut itself was fine, so there's nothing to re-add.

## 0.5.1

- `anysite-mcp library search <words>`, `library list [site]` and `library info <site>[/<name>]` find shared
  shortcuts from the terminal, with each one's health and `add` command. `ANYSITE_LIBRARY` points them at a local
  library build or another URL.
- Health badges: a weekly check runs every library shortcut against the live sites. The
  [Shortcut Library site](https://dwytmcl.github.io/anysite-mcp/) and `library` show ✓ passing, ~ repaired,
  ✗ broken, "not checked yet" (never checked, or edited since) or "not recently checked" (no check in 14 days).
- `--version`, `--help`, `library`, `add` and `permissions` no longer need Chrome installed. Only commands that
  start it (`login`, `record`, `doctor` and serving MCP) do.
- Unit tests for the MCP tool registration (`zodParam`, `useSite`, pack and shortcut tools).

## 0.5.0

- Releases are published to npm by GitHub Actions with npm trusted publishing, so each version comes with provenance:
  proof of the commit and workflow it was built from (`npm audit signatures` checks it).
- Listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.DwytMCL/anysite-mcp`.
- Every release first runs all of CI against its tag, then packs, installs and starts the exact package about to be
  published (`npm run test:pack`), which also checks that nothing outside the expected files ships.
- Release candidates (e.g. 0.5.0-rc.0) publish to npm's `next` tag, so `npx anysite-mcp` keeps getting the stable
  version. Try one with `npx -y anysite-mcp@next`.
- CI also runs weekly, so a new Chrome that breaks something shows up without a commit. The TypeScript check now
  covers all the code, and `npm run check:versions` also checks `package-lock.json`.

## 0.4.0

Node 22 or newer, Chromium builds that work, and a codebase split into tested modules.

- **Breaking: Node 22 or newer.** Node 18 and 20 have reached end of life. `anysite-mcp` now stops at startup on an
  older Node with "anysite-mcp needs Node 22 or newer" and a link to update, instead of failing somewhere later.
- Fixed: Chromium and Chrome for Testing (for example from `npx playwright install chromium`) never loaded the
  site, so anysite-mcp timed out connecting to them. Chrome is now started with `--disable-field-trial-config`, as
  Playwright does.
- Fixed: a pack tool marked `writes: true` on a read-only site said the agent "can't write" instead of naming the
  tool (for example "can't use notebooklm_add_source").
- `server.js` is split into modules in `lib/`, with no change in behaviour. Chrome is now looked up when first
  needed rather than when the code loads.
- Unit tests (`npm run test:unit`), ESLint and a TypeScript check (`npm run lint`), and a version check
  (`npm run check:versions`).
- Uses Playwright 1.65.
- CI tests Node 22 and 24 on Linux, macOS and Windows (with Chrome for Testing on Linux and Windows, and Google
  Chrome on macOS), reports unit test coverage, checks that Node 20 is refused, and runs CodeQL. Actions are pinned to commits and kept up
  to date by Dependabot.

## 0.3.0

Shortcuts that repair themselves, learning by watching, and limits you set.

- **Self-repairing shortcuts.** When a step's element is gone, the shortcut tries the other ways to find it that were
  noted when it was saved, then the closest element of a similar role on the page (a renamed button, a button that
  became a link). Only one clear match counts. The shortcut file is updated, and the agent is told what changed.
- **Record mode.** `anysite-mcp record <site> <name>` (or the `web_record` tool): do the job by hand in the site's
  Chrome and it becomes a shortcut, with each typed value as a parameter that defaults to what you typed.
- **Permissions per site**, set only by you with `anysite-mcp permissions`: read-only, confirm before sending, buying,
  deleting and the like (asked through your MCP client), and the domains `web_open` may go to (by default the
  site's own).
- **`web_extract`** returns rows as JSON, with optional fields per row. Shortcuts can use it as a step.
- **`web_select`** for drop-downs.
- **Typed params**: `{ description, type: number|boolean, optional, default }`.
- **Shared shortcuts**: a [`library/`](library/) in this repo, `anysite-mcp add <site>[/<name>]` (or `--from` a file
  or URL), and `web_list_shortcuts` with a name gives JSON ready to share.
- **`anysite-mcp doctor`** checks saved shortcuts without clicking or typing anything, and repairs what it can.
- Calls on the same site now wait for each other instead of acting on one tab at the same time.
- Steps check that the element they act on is visible, and if an action still fails because the page swapped
  the element (a search box that becomes a combobox after loading), the step is repaired and tried again.
- A step with only a role (e.g. `{ "role": "searchbox" }`) can be repaired when one element of a kindred role is
  on the page.
- `extract` fields take the first match that has something in it (the titled link, not the thumbnail before it);
  unknown roles are an error with a suggestion; a field that is empty on every row gets a note; it waits a moment
  for lists that arrive after the page.
- Clicks, choices and Enter wait for a page they start loading.
- Read-only judges a click by what the element does: links that just open pages are allowed, POST form buttons
  are blocked whatever their label.
- Pack tools can be marked `writes: true` (NotebookLM's `add_source` and `create_notebook` are), which read-only
  blocks and confirm asks about.

## 0.2.0

Faster, cheaper and harder to break.

- **Smaller results.** Snapshots now give every element a ref like `[ref=e12]`, and `web_click`, `web_type` and
  the other tools accept `ref`. After an action you get only what changed on the page, not the whole tree again.
  Pass `show: "full"` or `show: "none"` to change that, and `depth` to `web_snapshot` for a quick outline of a big page.
- **Shortcuts are tried before they are saved.** `web_save_shortcut` runs the steps once with `test_args`, so a
  broken shortcut is never saved. Use `verify: false` for steps that must not run twice (sending, buying).
- **Shortcuts fail loudly.** A step can say `"expect": "some text"`, and the shortcut fails if that text is not on
  the page afterwards. Refs and undeclared `{{params}}` in steps are refused at save time. `web_wait` with
  `until_text` now fails if the text never appears, instead of carrying on.
- **`web_list_shortcuts`** shows what has been saved for a site.
- **Windows:** finds per-user and 32-bit Chrome installs; sign-in instructions match your OS.
- **`ANYSITE_HEADLESS=1`** runs the automated Chrome without a window (sign-in still opens one), and
  `ANYSITE_CHROME_ARGS` adds Chrome flags. `localhost` sites use http.
- `anysite-mcp --version`. CI runs the self-check on macOS, Windows and Linux; the self-check needs no network.

## 0.1.1

- README with demo GIF; targets can be scoped with `within`.

## 0.1.0

- First release: any website as MCP tools, one Chrome profile per site, shortcuts, Gemini and NotebookLM packs.
