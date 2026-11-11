# 4. Frozen public contracts

**Status:** accepted

**Context.** Shortcuts, packs and agents depend on the exact shape of the tools and their output. Changes would silently break saved shortcuts.

**Decision.** These are frozen, and tests fail on purpose if they change: the JSON Schema of shortcut and pack tools (`test/tools.test.js`), the text output of `web_extract` (`test/fixtures/extract-text.json`) and the MCP protocol revision the server speaks.

**Consequences.** Changing one needs a deliberate update of the test and a changelog entry.
