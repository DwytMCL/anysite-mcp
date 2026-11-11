# Glossary

The words this project uses, one name per idea. Use these in code, docs and issues.

| Term | Meaning | Avoid |
|---|---|---|
| **site** | One website the user signs in to, named by its domain (`github.com`). Each site has its own profile, shortcuts and permissions. | account, app |
| **profile** | The Chrome user-data folder for one site, in `<ANYSITE_HOME>/profiles/<site>`. Holds cookies, so it is never shared or committed. | session, user |
| **tool** | Anything the MCP server offers the agent: the built-in `web_*` tools, shortcuts and packs. | command, function |
| **shortcut** | A saved sequence of steps that becomes a tool named `<site>_<name>`. Stored in `<ANYSITE_HOME>/sites/<site>.json`. | recipe, macro, playbook |
| **step** | One action in a shortcut (open, click, type, read). Found by role and name. | action (in user docs) |
| **pack** | A `.js` file with hand-written tools for one site. Built-in packs are in `sites/`; user packs in `<ANYSITE_HOME>/sites/` take precedence. | plugin, adapter |
| **heal** | Repairing a step whose element is gone, by other noted ways to find it, then by the closest element of a similar role (`lib/heal.js`). | fix, auto-repair |
| **record** | Saving a shortcut by doing the job in Chrome while the tool watches (`lib/recording.js`, `lib/recorder.js`). | capture |
| **doctor** | The check that follows each shortcut up to its first acting step, repairs what it can and never clicks or types. | lint, validate |
| **library** | The public Shortcut Library built from `library/<domain>.json` and published on GitHub Pages. | store, registry (the MCP Registry is a different thing) |
| **permissions** | Per-site limits (read-only, confirm, allowed domains). Only the user can change them; the agent has no tool for it. | policy, access |
| **login** | Signing in by hand in a plain Chrome with no debug port. | auth, authenticate |
