# Shortcut Library site

The web page for the shared [anysite-mcp shortcuts](../library/): browse them, copy the `add` command, and share your own.

**Live site:** https://dwytmcl.github.io/anysite-mcp/

It is a plain static page: HTML, one stylesheet and one script, no framework and no tracking. The shortcuts
themselves stay in [`library/<site>.json`](../library/); the page reads an index built from those files.

## Directory structure

```
anysite-mcp/
├── library/                 The shortcuts, one file per site (the data)
│   ├── github.com.json
│   └── ...
├── shortcuts-library/       The site
│   ├── index.html           Search, site tags, shortcut list, Share form
│   ├── style.css            Plain styling (system fonts, borders, no gradients)
│   ├── app.js               Lists and filters shortcuts, checks shared JSON, builds issue and PR links
│   ├── build.js             Copies the page into _site/ and writes _site/library/index.json
│   └── README.md
└── .github/
    ├── workflows/pages.yml              Checks library files, builds and deploys to Pages
    └── ISSUE_TEMPLATE/shortcut_share.yml Issue form the Share button fills in
```

`_site/` is build output and is not committed. Nothing here is part of the npm package.

## What the page does

- Lists every shortcut as its tool name (`github_com_trending`), description, parameters and readable steps, with the raw JSON one click away.
- Search covers site, name, description and parameter names. Site tags filter by site and show the command to add all of a site's shortcuts. Both are kept in the URL (`?q=wiki&site=en.wikipedia.org`).
- Each shortcut has a Copy button for its install command: `npx -y anysite-mcp add <site>/<name>`.
- **Share a shortcut**: paste the JSON from `web_list_shortcuts`. The page checks it with the same rules as `anysite-mcp add` (name format, description, known step actions, no refs, every `{{param}}` declared), warns about emails and tokens, then offers a pre-filled issue or a pull request link to `library/<site>.json`.

## Run it locally

```
node shortcuts-library/build.js
cd _site && python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy

1. In the repository, go to **Settings > Pages** and set **Source** to **GitHub Actions** (once).
2. Any push to `main` that touches `library/` or `shortcuts-library/` runs the **Shortcut Library site** workflow, which checks each library file with `anysite-mcp add --from`, builds `_site/` and deploys it. You can also run it by hand from the **Actions** tab.
