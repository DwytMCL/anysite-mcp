# Shortcut library

Shortcuts that people have shared, one file per site. Browse them on the
[Shortcut Library site](https://dwytmcl.github.io/anysite-mcp/). Add them with:

```bash
npx -y anysite-mcp add github.com              # every shortcut for github.com
npx -y anysite-mcp add en.wikipedia.org/summary  # just one
```

They become tools named `<site>_<name>` (for example `github_com_trending`) the next time the server starts.
A shortcut is only a list of steps for the `web_*` tools: no code runs, and it can't do anything the agent couldn't
do on that site anyway. Read them before you add them all the same.

| Site | Shortcuts |
|---|---|
| `github.com` | `notifications`, `trending` |
| `en.wikipedia.org` | `summary`, `search` |
| `hn.algolia.com` | `search`, `front_page` (Hacker News) |

## Share yours

1. Ask your agent for the JSON: `web_list_shortcuts` with `site` and `name`.
2. Paste it into the [Share form](https://dwytmcl.github.io/anysite-mcp/#add), which checks it and opens an issue or
   pull request for you. Or add it to `library/<site>.json` in a pull request yourself. Check that it has no personal data (names, emails, IDs in URLs)
   and that it finds elements by role and name. `npx anysite-mcp doctor <site>` checks it still works.
