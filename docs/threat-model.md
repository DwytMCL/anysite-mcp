# Threat model: a page that steers the agent

**The risk.** anysite-mcp drives a Chrome that is signed in as the user. Whatever a page shows (text, a link label, a
hidden element, an email body) is handed to the agent as a tool result. A hostile page can try to talk the agent into
doing something the user never asked for: sending a message, deleting data, opening another site, uploading a file.
This is prompt injection. anysite-mcp cannot tell whether an instruction came from the user or from a page, so it
limits what a steered agent can do instead.

**Who is trusted.** The user, who sets permissions. The server code. Packs the user put in `ANYSITE_HOME/sites/`
(they are code and run with the user's rights). Not trusted: page content, anything a page links to, and shared
shortcuts from the library until the user has read them.

## What stops a steered agent

| Control | What it does | Where |
| --- | --- | --- |
| Permissions are user-only | The agent has no tool to change `settings.json`; it is re-read on every check, so a change by the user applies at once. | `lib/guard.js`, `lib/permissions.js` |
| `read_only` | Refuses clicks, typing with submit, Enter, uploads and shortcuts that change things. | `lib/guard.js` |
| `confirm` | Asks the user before a risky action. A client that cannot ask makes the action fail; it is never a silent yes. The confirm form collects no input. | `lib/guard.js` |
| Risk by effect, not label | A POST submit is always risky. A link is risky only if its href looks like logout, delete or unsubscribe. Labels such as send, buy, delete are risky. | `RISKY`, `RISKY_HREF` |
| `allowed_domains` | `web_open` refuses a host outside the site's base domain (or the user's list). `*` allows any and is the user's explicit choice. | `lib/actions.js` |
| One Chrome profile per site | A page on one site cannot read another site's session. | `lib/browser.js` |
| Shortcuts are steps, not code | A shared shortcut is JSON that `checkShortcut` validates (known actions, no refs, declared params). It cannot run script. Its annotations follow from its steps. | `lib/shortcuts.js` |
| Library health | Shared shortcuts are re-checked weekly; broken ones show as broken. This is about working, not about safe: read a shortcut before you add it. | `scripts/library-health.js` |

## What it does not stop

- **A page can lie inside the allowed domain.** Read-only mode is the real protection on a site you do not control.
- **Reading is not gated.** A steered agent can read any page of an allowed site the user is signed in to, and can
  put what it read into a later tool call. Keep sensitive accounts in sites with `read_only` and a short
  `allowed_domains`.
- **`*` in `allowed_domains`** removes the domain limit.
- **Without `confirm`, a read-write site acts without asking.** `confirm` is off by default.
- **`web_upload` takes file paths from the agent** and `web_download` takes a `save_dir` from the agent. Both are
  gated by `read_only` and `confirm`, but with neither set a steered agent can upload any file it can name, or save a
  download into any folder. Recorded as a follow-up for 0.8.0 (an allow-list of folders), not a format change.
- **User packs and `ANYSITE_CHROME` are code or a program run with the user's rights.** Add only what you trust.

## Does this change the 1.0 formats?

No. The controls above are expressed in the existing `settings.json` keys (`read_only`, `confirm`,
`allowed_domains`), so `settings.json` and the shortcut file need no new field for format version 1. A folder
allow-list for upload and download would be a new optional key, which is an addition, allowed after 1.0.

## Reporting

A way around any control above is a security bug: see `SECURITY.md`.
