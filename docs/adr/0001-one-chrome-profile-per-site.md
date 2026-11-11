# 1. One Chrome profile per site

**Status:** accepted

**Context.** The agent acts as the user on sites they are signed in to. A shared profile would let a page, or a mistake, reach the cookies of every other site.

**Decision.** Each site gets its own Chrome profile in `<ANYSITE_HOME>/profiles/<site>`. A profile can only be open once (`SingletonLock`, checked with `lstat`).

**Consequences.** Accounts stay apart and `web_open` is limited to the site's own domain unless the user allows more. Users sign in once per site. Moving to a shared profile would break stored sign-ins and the permission model, so it is hard to reverse.
