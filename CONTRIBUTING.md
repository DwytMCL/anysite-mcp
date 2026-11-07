# Contributing

Thanks for helping. The easiest and most useful contributions are **site packs** and **shortcuts**.

## Run it from source

```bash
git clone https://github.com/DwytMCL/anysite-mcp && cd anysite-mcp
npm install
npm test                       # headless self-check against a local page, no network needed
claude mcp add anysite-dev -- node "$PWD/server.js"
```

On Linux as root (Docker, CI) Chrome needs `ANYSITE_CHROME_ARGS=--no-sandbox`.

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

## Code style

Plain modern JavaScript (ES modules, Node 18+), no build step, no new dependencies unless there's no other way.
Keep comments for the *why*.
