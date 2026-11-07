# Shortcuts Library

A small, community-maintained list of keyboard shortcuts and workflows for Mac, iOS Shortcuts, Windows, Linux, VS Code, Vim, Blender and browsers.

It is a plain static site: one HTML page, one stylesheet, one script and one JSON file. No build step, no framework, no tracking. It lives in this folder of the anysite-mcp repo and is published with GitHub Pages.

**Live site:** https://dwytmcl.github.io/anysite-mcp/

## Directory structure

```
anysite-mcp/
├── shortcuts-library/
│   ├── index.html        Page layout: search, category tags, results table, add form
│   ├── style.css         Plain styling (system fonts, borders, no gradients)
│   ├── app.js            Loads the data, search/filter, builds submissions
│   ├── shortcuts.json    The shortcuts themselves
│   └── README.md
└── .github/
    ├── workflows/pages.yml                    Validates shortcuts.json and deploys this folder to Pages
    └── ISSUE_TEMPLATE/shortcut_submission.md  Issue template for submissions
```

Nothing in this folder is part of the npm package (`package.json` only ships `server.js` and `sites/`).

## Adding a shortcut

Use the **Add a shortcut** form at the bottom of the site. It builds a JSON entry and gives you two options:

1. **Open a GitHub issue**: opens a new issue with the entry already filled in. A maintainer adds it.
2. **Copy the JSON**: edit [`shortcuts.json`](shortcuts.json) on GitHub, paste the entry into the list, and open a pull request.

Each entry looks like this:

```json
{
  "id": "vs-code-command-palette",
  "title": "Command Palette",
  "description": "Run any command by name. Use Cmd+Shift+P on macOS.",
  "platform": "VS Code",
  "keys": "Ctrl+Shift+P",
  "link": "https://code.visualstudio.com/docs/getstarted/keybindings",
  "author": "your-github-name"
}
```

`id`, `title`, `description` and `platform` are required, plus at least one of `keys` or `link`. In `keys`, use `+` for keys pressed together and a space between steps (`Ctrl+K Ctrl+S`, `g g`). The workflow checks every pull request that touches this folder for missing fields and duplicate ids.

## Run it locally

The page loads `shortcuts.json` with `fetch`, so open it through a local server rather than as a file:

```
cd shortcuts-library
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy to GitHub Pages

1. Merge this folder and `.github/workflows/pages.yml` into `main`.
2. In the repository, go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Run the **Shortcuts Library site** workflow from the **Actions** tab, or push any change under `shortcuts-library/`. The site goes live at `https://dwytmcl.github.io/anysite-mcp/`.

Optional: create a `shortcut` label under **Issues > Labels** so submitted issues are tagged automatically.

If the repository is renamed or moved, change `REPO` at the top of `app.js` so the issue links point to the right place.

## License

Code: MIT, like the rest of this repo. Shortcut descriptions: CC BY 4.0.
