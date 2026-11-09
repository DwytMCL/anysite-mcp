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

Before opening a pull request, run `npm run lint` (ESLint, plus a TypeScript check of all the code) and
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

Changes go under `## Unreleased` in CHANGELOG.md as they land. A release is prepare → merge → tag:

1. **Prepare.** Run Actions → Prepare release with a `bump`. It sets the version in `package.json`,
   `package-lock.json` and both places in `server.json`, renames `## Unreleased` to the version for a final release,
   pushes `release/v<version>` and opens a PR. CI on that PR waits until you click **Approve workflows to run**,
   because the bot opened it.
2. **Merge** the PR once CI is green.
3. **Tag** the merge commit with the command in the PR, e.g. `git tag v0.5.0 && git push origin v0.5.0`.

The Release workflow then checks the tag matches `package.json`, runs all of CI against the tag, smoke-tests the
packed package (`npm run test:pack`), publishes to npm through trusted publishing, creates the GitHub release from
CHANGELOG.md and lists the version in the MCP Registry.

**Release candidates.** `preminor` (or `prepatch`, `premajor`) starts one, e.g. 0.4.0 → 0.5.0-rc.0, and `prerelease`
moves to the next, 0.5.0-rc.0 → 0.5.0-rc.1. (On a stable version, `prerelease` starts a patch RC: 0.5.0 →
0.5.1-rc.0.) An RC keeps its notes under `## Unreleased`, publishes to npm's `next` dist-tag, becomes a GitHub
pre-release and only signs in to the MCP Registry. To finish, pick the same level again: `minor` turns 0.5.0-rc.0
into 0.5.0.

**Re-runs.** Prepare release is safe to run again for the same version: it replaces the `release/v<version>` branch
and reuses the open PR. That branch belongs to the bot, so commits you push to it yourself are overwritten by a
re-run. If a Release step fails, fix it on `main` and run Actions → Release → Run workflow with the tag; steps already
done (npm, the GitHub release, the registry listing) are skipped. Tags from before v0.5.0 can't be re-run this way.

## Code style

Plain modern JavaScript (ES modules, Node 22+), no build step, no new dependencies unless there's no other way.
Keep comments for the *why*.
