# Stability: what 1.0 keeps

From 1.0, everything on this page changes only in a new major version, apart from additions that do not break
existing users (a new tool, a new optional argument, a new optional field). Anything not listed here is internal and
may change in any release.

**Protocol.** 1.0 supports MCP protocol revision 2025-11-25. A newer revision is added alongside it; dropping
2025-11-25 is a major change.

## MCP tools

- **Names:** `web_snapshot`, `web_open`, `web_click`, `web_type`, `web_select`, `web_press`, `web_upload`,
  `web_read`, `web_extract`, `web_wait`, `web_download`, `web_screenshot`, `web_login`, `web_record`,
  `web_save_shortcut`, `web_list_shortcuts`, `web_delete_shortcut`. Shortcut and pack tools are named
  `<site prefix>_<name>`.
- **Input schemas** of those tools: a required argument is never added, and no argument is removed or retyped.
- **Annotations** (`readOnlyHint`, `destructiveHint`, `openWorldHint`) of those tools. A shortcut's annotations follow
  from its steps as they do today.
- **`outputSchema`** of `web_extract` and `web_list_shortcuts`, and the text output of `web_extract`.
- **The JSON Schema** of a shortcut or pack tool, as built from its parameters.

Tool descriptions are not part of the contract; the wording may improve.

## Command line

Commands and flags: `anysite-mcp [site ...]`, `login <site>`, `record <site> <name>`,
`add <site>[/<name>] [--from <file or URL>] [--force]`, `library search <words>`, `library list [site]`,
`library info <site>[/<name>]`, `doctor [site ...]`,
`permissions <site> [--read-only | --read-write] [--confirm | --no-confirm] [--allow <domain,...> | --allow-any | --allow-default]`,
`--version`, `--help`. The exit code is 0 on success and 1 on an error. The wording of messages is not part of the
contract.

## Environment variables

`ANYSITE_HOME`, `ANYSITE_CHROME`, `ANYSITE_CHROME_ARGS`, `ANYSITE_HEADLESS`, `ANYSITE_DOWNLOADS` and
`ANYSITE_LIBRARY`: same names, same meaning. All six are declared in `server.json`.

## Files in `ANYSITE_HOME`

- **`settings.json`:** `{ "sites": { "<site>": { "read_only", "confirm", "allowed_domains" } } }`. Permissions are set
  by the user only; the agent has no tool to change them.
- **`sites/<site>.json`**, the shortcut file: its format is versioned (see the format version rules once they land in
  v0.7.0). A newer anysite-mcp reads every older version.
- **`sites/<site>.js`**, a user pack: see `docs/pack-api.md`.
- **`profiles/<site>/`** are Chrome's own files. They are not a format of ours.

## Pack API

A pack is a module whose default export is `({ z, kit }) => ...`. Kept: the `kit` helpers, a tool's `writes`,
`readOnly` and `input` fields, and `run(page, input, site, { progress })` with its four arguments. The reference is
`docs/pack-api.md`.

## The shortcuts library

Published at `dwytmcl.github.io/anysite-mcp/library`: `index.json` and `<site>.json` stay at their current URLs and
stay readable by every released CLI. New formats are published beside them under `v1/`, never in their place.

## Accepted Inspector warnings

None yet; this list is filled in with the clean-up of the `--strict` warnings.
