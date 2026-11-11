# 5. Find elements by role and name, never CSS selectors

**Status:** accepted

**Context.** CSS selectors break when a site is redesigned.

**Decision.** Steps locate elements with Playwright's role, label and text locators, the way a screen reader does. Healing (`lib/heal.js`) relies on the same information.

**Consequences.** Shortcuts survive small redesigns, and the saved file format stores role and name, so changing approach would invalidate every saved shortcut.
