# Pack API

A pack is a JavaScript module that adds hand-written tools for one site. Built-in packs are in `sites/`; yours go in
`~/.anysite-mcp/sites/<site>.js` and win over a built-in pack of the same name. This page is the 1.0 contract: what is
described here keeps working through 1.x. Anything not described is internal.

Unlike a shortcut, a pack is code and runs with your permissions. Only install packs you have read.

## Shape

```js
export default ({ z, kit }) => ({
  version: 1,                       // optional; no version means 1
  url: 'https://example.com/',      // where the site's browser opens
  tools: {
    list_things: {
      readOnly: true,
      description: 'List the things on the page.',
      input: { limit: z.number().optional() },
      run: async (page, input, site, { progress }) => 'text the agent sees',
    },
  },
});
```

The default export receives `{ z, kit }` and returns an object. Each tool becomes an MCP tool named
`<site>_<tool>`, with dots in the site name turned into underscores (`example_com_list_things`).

## What a pack receives

- **`z`**: the `zod` module, for `input`.
- **`kit`**: helpers.
  - `kit.sleep(ms)`: wait.
  - `kit.settle(page)`: wait until the page text stops changing (at most 15 s). Use it after a load that renders in stages.
  - `kit.dismissPopups(page)`: close welcome and what's-new dialogs that block the page.

## A tool

| Field | Meaning |
|---|---|
| `description` | Required. What the agent reads to choose the tool. |
| `input` | An object of `zod` types, one per argument. Default: no arguments. Describe each with `.describe()`. |
| `readOnly` | `true` if the tool changes nothing. Sets the MCP `readOnlyHint` annotation. |
| `writes` | `true` if the tool changes something on the site. Sets `destructiveHint`, and the site's permissions (`read_only`, `confirm`) are checked before it runs. A tool that writes must say so. |
| `run` | Required. `run(page, input, site, { progress })`. |

`run` takes four arguments, in this order:

1. `page`: the Playwright `Page` of the site's signed-in Chrome.
2. `input`: the validated arguments.
3. `site`: `{ name, url, profile, shortcutFile, prefix }` of the site.
4. `{ progress }`: `progress(done, total, message)` sends a progress notification when the client asked for one and does
   nothing otherwise. Call it as `progress?.(...)`.

`run` returns text (or a value that becomes text). Throwing an error reports it to the agent as the tool's error.

## Versions

`version` says which pack API the file was written for. This server speaks version 1.

- A pack with no `version` is version 1.
- A pack with a later version is refused with a message naming the file and asking to update anysite-mcp. It is not
  loaded partly.
- A `version` that is not a whole number from 1 is refused.
- New optional fields and helpers are additions within a version. A change that would break existing packs gets a new version, and
  the server keeps loading the older ones.
