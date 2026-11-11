# Security policy

## Supported versions

| Version | Supported |
|---|---|
| The latest release on npm `latest` | Yes |
| Release candidates on npm `next` | Fixed in the next RC |
| Anything older | No: update to the latest release |

## How to report a vulnerability

Use the **[Report a vulnerability](https://github.com/DwytMCL/anysite-mcp/security/advisories/new)** form on the
repository's Security tab. The report stays private between you and the maintainer.

Please **never open a public issue** for a security problem.

## What's in scope

- Anything that gets past [read-only mode, confirm mode or the allowed domains](README.md#permissions-and-safety).
- A page steering the agent (prompt injection) into acting in a way those settings should prevent.
- Leaking a profile's cookies, or one site reading another site's profile.
- Writing files outside `~/.anysite-mcp` or the downloads folder.
- The release pipeline: tags, npm publishing and provenance.

## What's out of scope

- The limits the README already documents: the permissions are guard rails, not a sandbox. For example, a button
  that saves something through script, with a plain label like "Go", can get past read-only mode.
- Bugs in Chrome itself. Report those to the [Chromium project](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/).

## What to expect

- anysite-mcp has a single maintainer, so replies are best effort, with no promised response time.
- A confirmed problem is fixed in a patch release, with an advisory on GitHub.
- If you'd like, you're credited in CHANGELOG.md and the advisory.
