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
- Auto routing with optional No web, Research, Ask page, and Browser work boundaries
- event-driven browser screenshots instead of an always-live browser dock
- selectable Codex reasoning effort with an automatic task-aware default
- a versioned local JSONL run store under Electron's user data directory
- a provider-neutral execution event stream with live text, tool activity, and user cancellation
- an `agent-browser` MCP bridge attached to the active Electron instance over loopback CDP
- Claude subscription authentication through the official Claude Code CLI
- a local Skill Router that selects capabilities before exposing provider tools
- an optional general-chat Skill selector that pins one enabled Skill for the request
- an in-chat Browser task overview for routed Skills, execution steps, and policy scope
- run-owned Agent browser tabs that show the live page while the browser side panel reuses the general-chat run progress
- global Agent upload/download permissions with fail-closed, user-owned approval handoff

Claude runs only through the official CLI installed and authenticated by the local user. XGEN Side launches `claude auth login`, checks `claude auth status`, and invokes `claude -p` without reading or copying subscription credentials. XGEN Side must not become a hosted OAuth broker or route one user's subscription credentials on behalf of other users; a hosted or shared service requires an API or an Anthropic-approved commercial arrangement.

## Run permissions and private auto login

Each composer exposes a run-scoped permission ceiling:

- `Read only` allows navigation and inspection but denies page interaction and data changes.
- `Guard` allows navigation and asks through the trusted XGEN approval broker before each selected mutating browser action.
- `Full access` allows the capabilities declared by the selected Skill without intermediate prompts. It does not enable unselected tools or privileged actions such as eval, raw network access, or browser state export. Global upload and download deny/ask settings still take precedence.

Optional Auto login credentials are stored in a separate OS-encrypted local vault. The renderer can list only non-secret metadata; decrypted usernames and passwords remain in the Electron main process and are inserted directly into an exact-origin user tab. An autofilled tab is protected for its lifetime and browser-agent automation is blocked while any protected tab is open.

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
