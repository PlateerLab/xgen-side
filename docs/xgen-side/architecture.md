# XGEN Side architecture

## Product boundary

XGEN Side is the product. The upstream agent-browser codebase is its browser automation engine, not its end-user interface.

The desktop application owns tabs, navigation, user interaction, approval surfaces, Windows integration, and task presentation. The engine owns deterministic browser inspection and automation through CDP.

## Components

### Desktop shell

The shell uses Electron and `WebContentsView` so the user interacts with real Chromium content instead of a streamed screenshot. Renderer processes have Node.js integration disabled, context isolation enabled, and sandboxing enabled.

### Browser engine

The existing Rust daemon remains upstream-compatible. XGEN-specific integration should be added through narrow adapters before changing core commands. Upstream changes are fetched from the `upstream` remote and merged into the XGEN branch.

The desktop process reserves a random loopback CDP port at startup. Browser agent runs launch the bundled `agent-browser mcp` process with that port in `AGENT_BROWSER_CDP`. Content boundaries and output limits are enabled. Browser state remains in Electron's persistent XGEN Side partition, so a second hidden Chromium profile is not created.

### Provider manager

Provider adapters execute native provider CLIs with `shell: false` and send user prompts over stdin. A Windows app does not need to route every prompt through PowerShell. PowerShell is used only for a visible, user-controlled OAuth login terminal and for commands that pass through the command broker.

`ProviderManager` is provider-neutral. It owns validation, sessions, browser policy, timeouts, logs, cancellation, and the common run lifecycle. `CodexAdapter` and `ClaudeCodeAdapter` implement the same `ProviderAdapter` contract for discovery, authentication, run planning, response parsing, and stream-event normalization. Adding another local CLI provider does not add provider branches to the manager.

Provider subprocess output is parsed line by line while the process is active. The main process emits provider-neutral run, route, text, activity, and completion events through a request-scoped IPC channel. The preload keeps renderer callbacks isolated by run ID, and cancellation is accepted only from the renderer that started the run. The final provider output remains available for deterministic parsing and local diagnostics.

Codex runs with an XGEN-specific `CODEX_HOME`. The official CLI stores its own session in Windows Credential Manager through the `keyring` setting. XGEN Side never reads or copies the token. Chat, Search, and Ask page use the Codex read-only sandbox. Browser agent uses the workspace-write sandbox only for its isolated session workspace.

Claude Code runs with an XGEN-specific `CLAUDE_CONFIG_DIR`. The official CLI owns login and credential storage; XGEN Side only launches `claude auth login`, checks `claude auth status`, and sends prompts to `claude -p` over stdin. Chat, Search, and Ask page use Claude permission modes plus explicit tool deny lists inside an isolated session workspace. Browser agent receives only the local `xgen_browser` MCP server and an action policy. These controls are application guardrails rather than an operating-system sandbox.

This local CLI adapter is different from offering Claude subscription authentication as a hosted XGEN service. XGEN Side does not read, copy, proxy, pool, or remotely route Claude subscription credentials. A future hosted or shared deployment must use the Anthropic API or an approved commercial arrangement rather than reusing this local authentication path.

### Execution modes

- Auto classifies each request as conversation, read-only research, attached-page reading, or guarded browser work. Users can still select an explicit boundary when needed.
- Conversation sends only the conversation request to a local provider runner. It receives no browser context.
- Research uses the provider's read-only web search directly. It does not open a search-engine tab or start the browser MCP daemon, which keeps current-information requests fast and avoids duplicate searches.
- Browser work uses the local `xgen_browser` MCP bridge for guarded navigation and interaction. Its first connection is restricted to the active loopback CDP target, and action permissions remain route-scoped.
- Browser-backed runs keep the native browser detached between capture events. XGEN Side attaches it briefly after meaningful browser actions, captures the visible result, deduplicates unchanged frames, and renders the screenshots in the activity rail.
- Ask page captures the active tab title, URL, selection, and visible text. It is read-only and cannot navigate or click.
- Browser agent attaches the current page context and the local `agent-browser` MCP tools. It can inspect and operate the Electron browser within the browser action policy.

Typing in the browser address bar remains normal navigation or search-engine search and does not start an AI run.

### Skill router

Every agent run is routed through at least one versioned Skill before provider execution. Skills are real packages under `apps/desktop/skills`, with `SKILL.md`, a deterministic runtime manifest, provider metadata, and optional reference files. The loader validates package identity, runtime bindings, agent-browser profiles, tool names, and action-policy categories before the router can use them.

The router evaluates the requested boundary, prompt intent, attached page, target URL, local enablement, and risk class from the manifests. Auto selects Conversation for stable questions, Web Research for current or source-backed requests, Page Reader for attached-page questions, and guarded Browser Skills for interaction requests. Supplemental extraction or interaction Skills and the Form Guard are added only when their activation signals match.

Codex requests also carry a reasoning effort. Auto resolves to low effort for ordinary conversation and research, medium for page analysis, and high for guarded browser work. Manual Fast, Balanced, Deep, and Very Deep choices map to the supported Codex CLI values. Providers without a verified reasoning control keep their own default.

Skills declare exact MCP tools for provider context and separate browser action-policy categories for engine enforcement. XGEN Side writes the union of allowed categories to an `agent-browser` action policy with `default: deny`. It injects the selected `SKILL.md` workflows and reference contracts into the provider request, and exposes only the declared MCP profiles when browser control is required. Disabled Skills therefore remove the workflow, tools, and underlying browser permissions together.

The renderer can preview the deterministic route before execution. Browser-backed runs show an Overview containing the selection reason, Skill identities, risk levels, execution steps, target host, and effective action categories. The final route is also stored in the session event log and returned with the provider result.

### Browser Agent memory

Local session JSON and provider traces remain available for diagnostics, but user-facing Markdown memory is intentionally narrower. Only Browser agent runs write files under `memory/browser-history/` and `memory/task-results/`. Chat, Search, and Ask page do not create browser memory. The Settings workbench lists these files and supports rendered Markdown plus source editing.

### Policy engine

Guard is the default. The policy engine classifies browser, file, network, credential, and command actions as allow, ask, or deny. Deny takes precedence. Approval is scoped to one action and expires quickly.

### Command broker

The command broker runs outside the renderer process. The bootstrap implementation lives in the Electron main process behind a typed IPC boundary. It supports PowerShell, CMD, and WSL Bash. A later milestone will move it to a dedicated Rust process using Windows Job Objects and Named Pipes.

### Tool bus

Browser actions, commands, files, XGEN, MCP servers, and model providers will expose typed schemas through one tool registry. Every action must report provenance, risk, duration, output artifacts, and approval state.

### Local run store

Every provider run receives a UUID and a directory under `agent-data/sessions`. The directory contains `session.json`, `events.jsonl`, provider stdout and stderr, an isolated workspace, and page context when attached. The JSONL events use a versioned provider-neutral envelope and record live execution event metadata without duplicating response text into every event. A later AgentFlow replacement can replay or export the same history. Provider tokens and API keys are redacted and are never written intentionally.

Application preferences live in `agent-data/settings.json`. General execution preferences, MCP enablement, and package-scoped Skill enablement use one versioned schema and an atomic local write. The renderer receives this store only through typed IPC and cannot choose an arbitrary settings path.

## Security invariants

- Page content is untrusted input.
- Renderer code cannot access Node.js or operating system APIs directly.
- Unknown commands require approval.
- Known destructive commands are denied before process creation.
- Credentials never enter model context or command output.
- Command broker access stays behind the context-isolated Electron IPC bridge.
- The CDP port is random and loopback-only. It exists only while XGEN Side is running.
- Provider subprocesses inherit an environment allowlist that excludes API keys and access-token variables.
- User prompts are passed through stdin, never interpolated into a shell command.
- Published builds are code signed and use Windows-native secret storage.

## Upstream strategy

The repository keeps `upstream/main` as the source of agent-browser updates. Product work lives on XGEN branches. Avoid broad renames inside the engine because they make upstream merges expensive. Brand-specific commands should be exposed through a separate `xside` launcher or adapter.

Apache 2.0 notices and relevant third-party attributions must remain in distributed source and binaries.
