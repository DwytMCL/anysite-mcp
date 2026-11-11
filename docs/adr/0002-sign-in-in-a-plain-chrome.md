# 2. Sign in with a plain Chrome, no debug port

**Status:** accepted

**Context.** Google and other sites refuse sign-in in a browser that is being automated.

**Decision.** `login` and `web_login` open an ordinary Chrome with no debugging port. The automated Chrome only uses the profile afterwards.

**Consequences.** Google sign-in works, but the user must quit that Chrome before the server can open the profile.
