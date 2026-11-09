#!/usr/bin/env node
// anysite-mcp: let AI agents use any website through a real Chrome that is signed in as you.
// Each site gets its own Chrome profile, signed in once by hand. Tools find elements by accessible
// role and name (what a screen reader sees), never by CSS, so they survive redesigns. A sequence that
// works can be saved as a shortcut, which becomes a tool of its own.
// Usage: `anysite-mcp [site ...]` (MCP over stdio), `anysite-mcp login <site>` (one-time sign-in).
import { checkNode } from './lib/node-version.js';

// Checked before loading the rest, which needs a newer Node than some people have.
const problem = checkNode(process.versions.node);
if (problem) {
  console.error(problem);
  process.exit(1);
}
await import('./lib/cli.js');
