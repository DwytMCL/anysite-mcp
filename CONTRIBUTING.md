# Contributing

Thanks for helping. The easiest and most useful contributions are **site packs** and **shortcuts**.

## Run it from source

```bash
git clone https://github.com/DwytMCL/anysite-mcp && cd anysite-mcp
npm install
npm test                       # unit tests, then a headless self-check against a local page; no network needed
claude mcp add anysite-dev -- node "$PWD/server.js"
```

On Linux as root (Docker, CI) Chrome needs `ANYSITE_CHROME_ARGS=--no-sandbox`.

Before opening a pull request, run `npm run lint` (ESLint, plus a TypeScript check of `lib/` and `test/`) and
`npm test`. `npm run test:unit` runs only the unit tests in `test/`, which need no Chrome. Bug fixes come with a test.

## Where things are

- `server.js`: the entry point. It checks the Node version, then loads `lib/cli.js`.
- `lib/cli.js`: the commands (`login`, `record`, `add`, `doctor`, `permissions`) and serving MCP.
- `lib/tools.js`: the MCP server and its tools. `lib/actions.js`: what each page action does.
- `lib/browser.js`: finding and starting Chrome, sites and packs. `lib/snapshot.js`: snapshots and finding elements.
- `lib/guard.js` and `lib/permissions.js`: per-site permissions. `lib/shortcuts.js`, `lib/heal.js`,
  `lib/recording.js` and `lib/recorder.js`: shortcuts, self-repair and record mode.

## Share a shortcut

Shortcuts the agent saves live in `~/.anysite-mcp/sites/<site>.json`. If one works well for a public site, open a
pull request adding it to a pack, or paste it into a [site pack request](../../issues/new?template=site_pack.yml).
Check it first: no personal data in the steps, and role/name targets rather than refs.

## Write a pack

A pack is one file in `sites/<name>.js`; see the README and [`sites/gemini.js`](sites/gemini.js). Good packs:

- find elements by role, label and text, not CSS classes (they change with every redesign);
- return plain text or markdown that an agent can use directly;
- throw errors that say what to do next ("use web_snapshot to see why");
- never send, post, buy or delete without the user asking for exactly that.

## Releasing

A release PR sets the version in `package.json`, `package-lock.json` and both places in `server.json`, and renames
`## Unreleased` in CHANGELOG.md to the version (`npm run check:versions -- --release` checks all of it). After it merges,
push the tag, e.g. `git tag v0.5.0 && git push origin v0.5.0`. The release workflow runs the checks, publishes to npm
through trusted publishing and creates the GitHub release. If a step fails, fix it and run the workflow by hand with the
tag (Actions → Release → Run workflow); steps that are already done are skipped.

## Code style

Plain modern JavaScript (ES modules, Node 22+), no build step, no new dependencies unless there's no other way.
Keep comments for the *why*.
