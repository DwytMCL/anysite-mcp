# Maintainers

Who can publish anysite-mcp, and how to recover if something goes wrong. This file holds no secrets.

## Who holds what

- **npm:** the owner of the `anysite-mcp` package, with two-factor authentication on. Publishing happens only through
  the trusted publisher (`DwytMCL/anysite-mcp`, workflow `release.yml`), so there are no npm tokens to leak.
- **MCP Registry:** the `io.github.DwytMCL/*` namespace. `release.yml` signs in through GitHub OIDC, so access
  follows the GitHub repository and needs no separate login.
- **GitHub:** admin on the repository. Only admins can push `v*` tags, and an admin's own PRs merge as a recorded
  bypass (see [CONTRIBUTING.md](../CONTRIBUTING.md#reviews)).

## If a release goes wrong

- **A bad version is on npm:** run `npm deprecate anysite-mcp@<version> "<why, and which version to use>"`, then ship
  the fix as a patch. Don't unpublish: it breaks anyone who pinned the version, and the number can't be reused.
- **A dist-tag points at the wrong version:** move it with `npm dist-tag add anysite-mcp@<version> latest` (or `next`).
- **A Release step failed:** fix it on `main`, then run Actions → Release → Run workflow with the tag. Steps already
  done are skipped.

## If the maintainer's account is lost

- Keep the GitHub and npm recovery codes in a password manager.
- npm account recovery goes through [npm support](https://www.npmjs.com/support).
- The MCP Registry follows GitHub, so restoring the GitHub account restores registry access.
- A second npm owner would remove this single point of failure; it's an open risk in the roadmap.

## Handing over

1. Add the new owner on npm (`npm owner add <user> anysite-mcp`) and as a repository admin.
2. Update [`.github/CODEOWNERS`](../.github/CODEOWNERS).
3. Nothing changes in the trusted publisher while the repository stays where it is.
