# Changelog

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
