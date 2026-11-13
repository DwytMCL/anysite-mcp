# Release checklist

CI can't sign in to Google, so the Gemini and NotebookLM packs are checked by hand. Run this against each release
candidate before the final bump, and paste the results table into the release PR.

## Setup

- Install the release candidate from npm `next`, e.g. `claude mcp add anysite-rc -- npx -y anysite-mcp@next`.
- Use profiles that are already signed in to `gemini.google.com` and `notebooklm.google.com`.

## Gemini

1. `gemini_list_chats` returns chats, each with a URL.
2. `gemini_ask` returns a finished reply as markdown.
3. `gemini_ask` with progress shown in the client reports progress every 5 s while it waits.
4. `gemini_ask` with Deep Research completes and returns the report.

## NotebookLM

5. `notebooklm_list_notebooks` returns your notebooks.
6. `notebooklm_create_notebook` creates a test notebook.
7. `notebooklm_add_source` adds a URL to it.
8. `notebooklm_add_source` adds text to it.
9. `notebooklm_ask` on that notebook returns an answer.
10. Delete the test notebook by hand afterwards.

## Sign-in

11. `web_login` opens a plain window, and Google accepts the sign-in there.

## Read-only

12. With `npx -y anysite-mcp@next permissions gemini.google.com --read-only`, `gemini_ask` (a `writes: true` tool) is
    refused, and the message names the tool. Turn read-only off again afterwards.

## Nightly check

13. Actions → Nightly live-site check has a successful run in the last two days, and no `nightly-health` issue is open.
    GitHub turns off scheduled workflows after 60 days without repository activity, so a quiet repository may need it
    turned back on.

## Recording results

Copy this into the release PR:

```markdown
| # | Check | Result (✓/✗) | Date | Chrome | OS |
|---|---|---|---|---|---|
| 1 | gemini_list_chats | | | | |
| 2 | gemini_ask | | | | |
| 3 | gemini_ask progress | | | | |
| 4 | Deep Research | | | | |
| 5 | notebooklm_list_notebooks | | | | |
| 6 | notebooklm_create_notebook | | | | |
| 7 | notebooklm_add_source (URL) | | | | |
| 8 | notebooklm_add_source (text) | | | | |
| 9 | notebooklm_ask | | | | |
| 10 | Test notebook deleted | | | | |
| 11 | web_login sign-in | | | | |
| 12 | Read-only refuses gemini_ask | | | | |
| 13 | Nightly check running, no open issue | | | | |
```
