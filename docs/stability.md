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
`library info <site>[/<name>]`, `library check`, `doctor [site ...]`,
`permissions <site> [--read-only | --read-write] [--confirm | --no-confirm] [--allow <domain,...> | --allow-any | --allow-default]`,
`--version`, `--help`. The exit code is 0 on success and 1 on an error. The wording of messages is not part of the
contract.

## Environment variables

`ANYSITE_HOME`, `ANYSITE_CHROME`, `ANYSITE_CHROME_ARGS`, `ANYSITE_HEADLESS`, `ANYSITE_DOWNLOADS` and
`ANYSITE_LIBRARY`: same names, same meaning. All six are declared in `server.json`.

## Files in `ANYSITE_HOME`

- **`settings.json`:** `{ "sites": { "<site>": { "read_only", "confirm", "allowed_domains" } } }`. Permissions are set
  by the user only; the agent has no tool to change them.
- **`sites/<site>.json`**, the shortcut file, is versioned. Its JSON Schema is `schema/shortcuts.v1.json`
  (published at `dwytmcl.github.io/anysite-mcp/schema/shortcuts.v1.json`). The rules:
  - Version 1 is `{ "$schema", "version": 1, "shortcuts": { name: shortcut } }`. A file is an envelope only when its
    top-level `version` is a number; anything else is version 0, the plain `{ name: shortcut }` map. The code never
    looks for a `shortcuts` key, because that could be a shortcut's name.
  - A newer anysite-mcp reads every older version. Loading never rewrites a file.
  - The first write to a version 0 file copies it to `<name>.v0.bak` and writes version 1. Restoring the `.bak`
    (and using an older anysite-mcp) is the way back.
  - A file with a higher version than this anysite-mcp knows is refused ("written for a newer anysite-mcp") and
    never rewritten.
  - A param may carry an `example`, which `doctor` tries before the `default`. A shortcut may carry
    `"needsSignIn": true`; the library's weekly check leaves it unchecked instead of marking it broken.
  - New optional fields are additions within a version; a change that older readers would misread needs a new version.
- **`sites/<site>.js`**, a user pack: see `docs/pack-api.md`.
- **`profiles/<site>/`** are Chrome's own files. They are not a format of ours.

## Pack API

A pack is a module whose default export is `({ z, kit }) => ...`. Kept: the `kit` helpers, a tool's `writes`,
`readOnly` and `input` fields, and `run(page, input, site, { progress })` with its four arguments. The reference is
`docs/pack-api.md`. A pack may carry `version` (none means 1); a pack with a later version than the server knows is
refused with a clear message and a newer anysite-mcp reads every older pack version.

## The shortcuts library

Published at `dwytmcl.github.io/anysite-mcp/library`: `index.json` and `<site>.json` stay at their current URLs and
stay readable by every released CLI. New formats are published beside them under `v1/`, never in their place:
`v1/index.json` and `v1/<site>.json` (the version 1 envelope of the shortcut file format). A CLI reads `v1/index.json`
first and falls back to `index.json` when there is none; `add` reads `v1/<site>.json` and falls back to the raw file
in the repository. CI runs the published 0.6.0 CLI against every build (`npm run test:library`) to keep this true.

## Accepted Inspector warnings

`npm run test:inspector` runs the MCP Inspector with `--strict`. These six warnings are accepted, because the
fields are free-form on purpose (a shortcut's steps, a param's default and a row's columns have no fixed shape), and
tightening them would change the frozen schemas. The check fails on any warning not listed here.

- `web_extract` output: `rows[]` items are free-form objects (untyped-schema).
- `web_save_shortcut` input: `steps[]` items are free-form objects (untyped-schema).
- `web_save_shortcut` input: a param's `default` and the values in `test_args` may be a string, number or boolean (type-union).
- `web_list_shortcuts` output: `params` and `steps[]` are free-form (untyped-schema).
