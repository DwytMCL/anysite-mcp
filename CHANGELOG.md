# Changelog

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
