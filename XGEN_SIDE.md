# XGEN Side

XGEN Side is a Windows-first AI browser built on top of the agent-browser automation engine.

The upstream project remains the browser control engine. XGEN Side adds a native desktop browser surface, a guarded command broker, model and tool adapters, task orchestration, and Windows security integration.

## Development status

The first bootstrap milestone includes:

- an Electron browser shell using real `WebContentsView` tabs
- a context-isolated preload API
- a Guard-first command policy
- PowerShell, CMD, and WSL Bash command adapters
- an upstream tracking strategy for agent-browser
- ChatGPT subscription authentication through the official Codex CLI
- provider and model selection inside both composers
- separate Chat, Search, Ask page, and Browser agent execution modes
- a versioned local JSONL run store under Electron's user data directory
- an `agent-browser` MCP bridge attached to the active Electron instance over loopback CDP
- Claude subscription authentication through the official Claude Code CLI
- a local Skill Router that selects capabilities before exposing provider tools
- an in-chat Browser task overview for routed Skills, execution steps, and policy scope

Claude runs only through the official CLI installed and authenticated by the local user. XGEN Side launches `claude auth login`, checks `claude auth status`, and invokes `claude -p` without reading or copying subscription credentials. XGEN Side must not become a hosted OAuth broker or route one user's subscription credentials on behalf of other users; a hosted or shared service requires an API or an Anthropic-approved commercial arrangement.

## Commands

Use Node.js 24 or later.

```powershell
pnpm install
pnpm dev:xgen-side
pnpm test:xgen-side
pnpm typecheck:xgen-side
```

If an upstream workspace prepare script prevents a filtered pnpm command on Windows, invoke the isolated runner directly:

```powershell
node scripts/xgen-side.mjs typecheck
node scripts/xgen-side.mjs test
node scripts/xgen-side.mjs build
```

See [the architecture document](docs/xgen-side/architecture.md) for component boundaries and security requirements.
