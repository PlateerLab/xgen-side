# XGEN Side architecture

## Product boundary

XGEN Side is the product. The upstream agent-browser codebase is its browser automation engine, not its end-user interface.

The desktop application owns tabs, navigation, user interaction, approval surfaces, Windows integration, and task presentation. The engine owns deterministic browser inspection and automation through CDP.

## Components

### Desktop shell

The shell uses Electron and `WebContentsView` so the user interacts with real Chromium content instead of a streamed screenshot. Renderer processes have Node.js integration disabled, context isolation enabled, and sandboxing enabled.

### Trusted local core

`xgen-core` is a platform-neutral Rust library and `xgen-daemon` is its separately launched local process host. The daemon is part of the same repository and application release, not a cloud API or separately operated service. Electron starts it as a child process and communicates over private stdio using the versioned `xgen.core.v1` protocol. A random session token is sent only through the inherited private pipe during the one-time handshake, never through command-line arguments or environment variables. Requests are bounded, correlated by request ID, authenticated after the handshake, and fail closed on incompatible protocol versions.

The core owns health, lifecycle, run-scoped browser relay operations, and fixed-key local blob storage. For browser runs, `xgen-daemon` launches `agent-browser mcp` with the authenticated tab CDP capability, action policy, approval capability, and credential-injection capability. The provider launches only the small `xgen-mcp-bridge` process with an opaque relay address and one-run token. The bridge forwards bounded MCP messages but never receives the CDP capability or downstream broker tokens. Settings, workspace state, and credential ciphertext are read and written through authenticated core RPC; storage modules no longer import Electron. Electron remains the UI, OS encryption adapter, and browser-view host during the migration.

### Browser engine

The existing Rust daemon remains upstream-compatible. XGEN-specific integration should be added through narrow adapters before changing core commands. Upstream changes are fetched from the `upstream` remote and merged into the XGEN branch.

Electron does not start a process-wide remote debugging port. Each browser run opens one direct-page CDP gateway for exactly one run-owned tab. The gateway binds a random loopback port and requires a 256-bit capability in the WebSocket path. Only `xgen-daemon` receives that URL through the private core channel. The trusted daemon launches the bundled `agent-browser mcp` process and holds its CDP, policy, approval, and credential environment. The provider receives only a capability-limited MCP relay connection, and the bridge strips provider-supplied session, namespace, CDP, and domain overrides. Browser state remains in Electron's persistent XGEN Side partition, so a second hidden Chromium profile is not created.

### Provider manager

Provider adapters execute native provider CLIs with `shell: false` and send user prompts over stdin. A Windows app does not need to route every prompt through PowerShell. PowerShell is used only for a visible, user-controlled OAuth login terminal and for commands that pass through the command broker.

`ProviderManager` is provider-neutral. It owns validation, sessions, browser policy, timeouts, logs, cancellation, and the common run lifecycle. `CodexAdapter` and `ClaudeCodeAdapter` implement the same `ProviderAdapter` contract for discovery, authentication, run planning, response parsing, and stream-event normalization. Adding another local CLI provider does not add provider branches to the manager.

Provider subprocess output is parsed line by line while the process is active. The main process emits provider-neutral run, route, text, activity, and completion events through a request-scoped IPC channel. The preload keeps renderer callbacks isolated by run ID, and cancellation is accepted only from the renderer that started the run. The final provider output remains available for deterministic parsing and local diagnostics.

Codex runs with an XGEN-specific `CODEX_HOME`. The official CLI stores its own session in Windows Credential Manager through the `keyring` setting. XGEN Side never reads or copies the token. Chat, Search, and Ask page use the Codex read-only sandbox. Browser agent uses the workspace-write sandbox only for its isolated session workspace.

Claude Code runs with an XGEN-specific `CLAUDE_CONFIG_DIR`. The official CLI owns login and credential storage; XGEN Side only launches `claude auth login`, checks `claude auth status`, and sends prompts to `claude -p` over stdin. Chat, Search, and Ask page use Claude permission modes plus explicit tool deny lists inside an isolated session workspace. Browser agent receives only the local `xgen_browser` MCP server and an action policy. These controls are application guardrails rather than an operating-system sandbox.

Saved browser passwords follow the stricter boundary in [credential-security-boundary.md](credential-security-boundary.md). Password plaintext is decrypted only in the desktop main process, inserted directly into one approved exact-origin tab, and never returned to Codex, Claude, MCP, plugin stdout, snapshots, chat, or run logs. Immediately before decryption, the tab becomes credential-protected and its authenticated CDP gateway is revoked, preventing the Agent from reading the inserted value afterward. Cookies remain browser session data and are handled separately from saved passwords.

This local CLI adapter is different from offering Claude subscription authentication as a hosted XGEN service. XGEN Side does not read, copy, proxy, pool, or remotely route Claude subscription credentials. A future hosted or shared deployment must use the Anthropic API or an approved commercial arrangement rather than reusing this local authentication path.

### Execution modes

- Auto classifies each request as conversation, read-only research, attached-page reading, or guarded browser work. Users can still select an explicit boundary when needed.
- Conversation sends only the conversation request to a local provider runner. It receives no browser context.
- Research uses the provider's read-only web search directly. It does not open a search-engine tab or start the browser MCP daemon, which keeps current-information requests fast and avoids duplicate searches.
- Browser work uses the local `xgen_browser` MCP bridge for guarded navigation and interaction. `xgen-daemon` owns the underlying `agent-browser` process and authenticated direct-page CDP URL, while the provider receives only a run-scoped relay capability. Every browser connection is restricted to one run-owned tab, and action permissions remain route-scoped.
- Browser-backed runs keep the native browser detached between capture events. XGEN Side attaches it briefly after meaningful browser actions, captures the visible result, deduplicates unchanged frames, and renders the screenshots in the activity rail.
- Ask page captures the active tab title, URL, selection, and visible text. It is read-only and cannot navigate or click.
- Browser agent attaches the current page context and the local `agent-browser` MCP tools. It can inspect and operate the Electron browser within the browser action policy.
- A browser request started from general chat creates one run-owned `WebContentsView` tab. The renderer request ID links that tab to the existing provider run. General chat renders its progress and event screenshots; opening the Agent tab renders the live page and the same progress in the right panel without launching another provider process.
- Agent-owned tabs, including QR and passkey handoff pages, are run-scoped and are not restored after an application restart. This prevents stale authentication URLs and expired run capabilities from being revived. Normal user-owned tabs and the shared Chromium partition, including cookies, are restored independently. After a restart, the user starts the login request again to receive a fresh site challenge.
- A browser request started from a normal browser side panel can explicitly reuse the attached tab. Snapshot capture and CDP targeting use the linked tab ID rather than whichever tab the user later activates.
- Users may pin an enabled Skill in the general chat composer. An explicit Skill determines Auto mode's execution boundary while required primary and guard Skills remain route-controlled.
- User-selected DOCX, XLSX, PPTX, and PDF attachments keep Auto in local Conversation mode. Electron main validates and stages opaque file references, the provider reads immutable copies under the run workspace, format-specific Skills define analysis and editing rules, and only newly generated files under `artifacts/` are returned. See [file-attachments.md](file-attachments.md).

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

The command broker runs outside the renderer process. The bootstrap implementation lives in the Electron main process behind a typed IPC boundary. It supports PowerShell, CMD, and WSL Bash. A later milestone will move it into the trusted Rust core using Windows Job Objects and an authenticated local transport.

### Tool bus

Browser actions, commands, files, XGEN, MCP servers, and model providers will expose typed schemas through one tool registry. Every action must report provenance, risk, duration, output artifacts, and approval state.

### Local run store

Every provider run receives a UUID and a directory under `agent-data/sessions`. The directory contains `session.json`, `events.jsonl`, provider stdout and stderr, an isolated workspace, and page context when attached. The JSONL events use a versioned provider-neutral envelope and record live execution event metadata without duplicating response text into every event. A later AgentFlow replacement can replay or export the same history. Provider tokens and API keys are redacted and are never written intentionally.

User-selected documents first enter a private attachment inbox through Electron main. The renderer sees only opaque IDs and sanitized metadata. At run start the inputs are copied read-only into `workspace/attachments`, while requested outputs must be written separately to `workspace/artifacts`. Result opening and Finder or Explorer reveal operations resolve only validated session-relative artifact paths.

Application preferences live in `agent-data/settings.json`. General execution preferences, global Agent upload/download decisions (`allow | ask | deny`), MCP enablement, and package-scoped Skill enablement use one versioned schema and an atomic local write. The renderer receives this store only through typed IPC and cannot choose an arbitrary settings path.

For an `ask` file transfer, agent-browser holds the MCP call and sends an authenticated request to a loopback approval broker owned by Electron main. Only the context-isolated shell renderer can resolve the one-shot request; the provider can request a prompt but cannot approve itself. Missing brokers, timeouts, cancelled runs, and renderer loss fail closed. Ordinary page-initiated downloads are independently paused by Electron's `will-download` handler and use the same global decision.

Secure browser login uses a separate one-time credential broker owned by Electron main. The trusted login Skill may click visible login, passkey, and QR controls without a generic Guard interruption. When the provider's `agent_browser_auth_login` request reaches a saved credential that matches the exact current origin, the credential broker pauses and opens the trusted XGEN approval UI. After approval, Electron main decrypts through `safeStorage`, inserts the credential directly into the approved run-owned tab, and returns only state such as `filled` and `submitted` through the `credential.inject` plugin protocol. The username and password never enter the plugin process, `agent-browser`, renderer, model response, run event, or Markdown memory. macOS relies on Keychain-backed `safeStorage`; Windows relies on DPAPI-backed `safeStorage`.

Passkeys and site-provided QR login do not use the credential vault. The login skill clicks only the site's passkey or linked-device control, waits for the device challenge to render, and then pauses browser actions. Chromium may open the operating-system WebAuthn surface, while a site such as Naver may render its own QR challenge. macOS verification remains in Touch ID, device password, security key, linked-device UI, or the site's QR flow. Windows verification remains in Windows Hello, device PIN, security key, linked-device UI, or the site's QR flow. The agent resumes only after navigation or a fresh page state proves that the password form is gone.

The signed macOS build must include `apps/desktop/build/entitlements.mac.plist.example` with the final application identifier and set `XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP` to the matching `<TEAM_ID>.<BUNDLE_ID>.webauthn` value before app startup. Development builds without that signed access group advertise only external-device or security-key passkey paths. Windows does not call the macOS-only configuration API and keeps the Chromium Windows Hello path. This is a packaging gate, not a reason to fork the renderer or duplicate the login state machine.

## Security invariants

- Page content is untrusted input.
- Renderer code cannot access Node.js or operating system APIs directly.
- Unknown commands require approval.
- Known destructive commands are denied before process creation.
- Credentials never enter model context or command output.
- Command broker access stays behind the context-isolated Electron IPC bridge.
- There is no process-wide CDP port. A random loopback gateway with a 256-bit capability exists only for one Agent run and one tab, and it is revoked before credential decryption.
- Provider subprocesses inherit an environment allowlist that excludes API keys and access-token variables.
- User prompts are passed through stdin, never interpolated into a shell command.
- Document attachments are signature-checked, size-bounded, copied into an isolated run workspace, and never overwritten by the provider.
- Published builds are code signed and use Windows-native secret storage.

## Upstream strategy

The repository keeps `upstream/main` as the source of agent-browser updates. Product work lives on XGEN branches. Avoid broad renames inside the engine because they make upstream merges expensive. Brand-specific commands should be exposed through a separate `xside` launcher or adapter.

Apache 2.0 notices and relevant third-party attributions must remain in distributed source and binaries.


## Private credential boundary

The optional Auto login vault is separate from renderer-readable settings and run logs. Electron `safeStorage` encrypts each complete credential record; no plaintext fallback is permitted. Credential list/save responses contain only ID, label, exact origin, and timestamps. Manual autofill decrypts in the main process immediately before exact-origin insertion through `WebContents.insertText`. Agent login decrypts through the one-time credential broker only after the trusted approval boundary and inserts the secret directly into the exact-origin tab. The browser credential plugin receives only the resulting state.

Autofill accepts HTTPS origins and loopback HTTP development origins only. Manual autofill targets a visible active user-owned tab with no active Agent Run. The tab becomes credential-protected before decryption. Protected tabs cannot provide page context or screenshots, and their lifetime blocks agent tab creation, current-tab attachment, and automation target lookup. Agent login uses an agent-owned visible tab, a one-use run token, exact-origin matching, a separate child process, and no secret-bearing run events. The run-scoped direct-page gateway is closed before decryption, and adversarial prompt-injection tests remain a release gate around the credential capability.
