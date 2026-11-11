# Contributing

Thanks for helping. The easiest and most useful contributions are **site packs** and **shortcuts**.

## Run it from source

```bash
git clone https://github.com/DwytMCL/anysite-mcp && cd anysite-mcp
npm install
npm test                       # unit tests, then a headless self-check against a local page; no network needed
npm run test:inspector         # handshake, tool schemas (--strict) and a tool call through the MCP Inspector CLI
claude mcp add anysite-dev -- node "$PWD/server.js"
```

On Linux as root (Docker, CI) Chrome needs `ANYSITE_CHROME_ARGS=--no-sandbox`.

Before opening a pull request, run `npm run lint` (ESLint, plus a TypeScript check of all the code) and
`npm test`. `npm run test:unit` runs only the unit tests in `test/`, which need no Chrome. Bug fixes come with a test.
CI also runs `npm run check:licenses` (every runtime dependency has an allowed license) and `npm run audit` (fails on a
high or critical advisory in a runtime dependency).

## Where things are

- `server.js`: the entry point. It checks the Node version, then loads `lib/cli.js`.
- `lib/cli.js`: the commands (`login`, `record`, `add`, `doctor`, `permissions`) and serving MCP.
- `lib/tools.js`: the MCP server and its tools. `lib/actions.js`: what each page action does.
- `lib/browser.js`: finding and starting Chrome, sites and packs. `lib/snapshot.js`: snapshots and finding elements.
- `lib/guard.js` and `lib/permissions.js`: per-site permissions. `lib/shortcuts.js`, `lib/heal.js`,
  `lib/recording.js` and `lib/recorder.js`: shortcuts, self-repair and record mode.
- [`CONTEXT.md`](CONTEXT.md): the project's terms. [`docs/adr/`](docs/adr/): why the big decisions were made.

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

## Reviews

Every pull request to `main` needs one approving review from a code owner (`@DwytMCL`, see
[`.github/CODEOWNERS`](.github/CODEOWNERS)). A bot's approval doesn't count, because a bot isn't a code owner.

- **Bot PRs (Dependabot, Prepare release):** the maintainer reviews and approves them as code owner, then merges
  normally. That's a real review, because the maintainer didn't write them.
- **The maintainer's own PRs:** GitHub doesn't allow approving your own PR, so they merge as a recorded admin bypass
  ("Merge without waiting for requirements", or `gh pr merge --admin`). This is deliberate until there's a second
  reviewer, and every such PR shows the bypass in its history.
- **Stale approvals are dismissed:** a new push, such as Dependabot rebasing a PR, dismisses an earlier approval, so
  approve it again.

## Releasing

Changes go under `## Unreleased` in CHANGELOG.md as they land. A release is prepare → merge → tag:

1. **Prepare.** Run Actions → Prepare release with a `bump`. It sets the version in `package.json`,
   `package-lock.json` and both places in `server.json`, renames `## Unreleased` to the version for a final release,
   pushes `release/v<version>` and opens a PR. CI on that PR waits until you click **Approve workflows to run**,
   because the bot opened it.
2. **Approve and merge** the PR once CI is green.
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

**Manual checks.** CI can't sign in to Google, so before the final bump run
[`docs/release-checklist.md`](docs/release-checklist.md) against each RC from npm `next`, and paste the results table
into the release PR.

Who can publish, and how to recover from a bad release or a lost account, is in
[`docs/maintainers.md`](docs/maintainers.md).

## Code style

Plain modern JavaScript (ES modules, Node 22+), no build step, no new dependencies unless there's no other way.
Keep comments for the *why*.
