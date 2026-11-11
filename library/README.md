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

Find them from the terminal with `npx -y anysite-mcp library search <words>`, `library list [site]` and
`library info <site>/<name>`.

## Health

Every Monday a workflow runs `doctor` on each shortcut here against the live site (opening and reading pages only,
never clicking or typing) and publishes the result. The site and `anysite-mcp library` show:

| Badge | Meaning |
|---|---|
| ✓ passing | Every step it could check found what it needed |
| ~ repaired | It worked after finding a changed element another way; the file should be updated to match |
| ✗ broken | A step failed; the detail says which and why |
| – not checked yet | Not checked since it was added or its steps last changed |
| ? not recently checked | The last check is more than 14 days old, so its result isn't shown |

The check can't sign in. A shortcut that only works signed in must say `"needsSignIn": true`: it stays in the library, shows
as "needs sign-in" and is never marked broken. Give params an `example` (a value that works) so the check can try them.

To try a library change before it's deployed, build the site and point the CLI at it:

```bash
node shortcuts-library/build.js
ANYSITE_LIBRARY=_site/library node server.js library list
```

## Share yours

1. Ask your agent for the JSON: `web_list_shortcuts` with `site` and `name`.
2. Paste it into the [Share form](https://dwytmcl.github.io/anysite-mcp/#add), which checks it and opens an issue or
   pull request for you. Or add it to `library/<site>.json` in a pull request yourself. Check that it has no personal data (names, emails, IDs in URLs)
   and that it finds elements by role and name. `npx anysite-mcp doctor <site>` checks it still works.
