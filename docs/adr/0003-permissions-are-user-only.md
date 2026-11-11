# 3. Permissions can only be changed by the user

**Status:** accepted

**Context.** A prompt-injected page could ask the agent to loosen its own limits.

**Decision.** Permissions are changed only through the CLI (`anysite-mcp permissions`). The agent has no tool for it, and settings are re-read on every check. Risk is judged by what an element does, not by its label. A client that cannot ask the user makes a confirm-mode action fail, never pass.

**Consequences.** The limits are guard rails, not a sandbox (see the README warning). Adding an agent-side way to change them would remove the main protection.
