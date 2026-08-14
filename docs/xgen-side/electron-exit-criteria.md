# Electron exit criteria

Electron is the temporary desktop host. It should be replaced after the product interaction model is stable and before platform-specific browser-host work becomes the dominant development cost.

## Do not switch yet

Keep Electron while any of these are changing frequently:

- Sidebar, tab, chat, project, and agent-panel information architecture
- Provider execution and streaming event contracts
- Browser action approvals and credential isolation rules
- Project, Skill, Memory, MCP, and permission data models
- The relationship between normal tabs, agent-owned tabs, and chat sessions

Changing the desktop host before these contracts stabilize would mix product redesign work with a runtime rewrite and make regressions difficult to attribute.

## Start the replacement spike when

Begin a two-week replacement spike when all of the following are true:

- P0 browser and chat journeys have passed visual and interaction QA for two consecutive milestones.
- Shared contracts have not required a breaking change for at least four weeks.
- Projects, Skills, Memory, MCPs, and Permissions have persisted schemas with migration tests.
- Browser, provider, storage, and policy code can run without importing Electron outside `main/shell` adapters.
- At least one Windows packaged build has completed an internal dogfood cycle.
- Signed macOS Touch ID WebAuthn and packaged Windows Hello have each passed one real-site login smoke test. A passkey failure caused only by missing signing entitlements is a packaging blocker, not evidence that Electron must be replaced.
- Startup time, idle memory, installer size, update behavior, extension support, or browser embedding has a measured target that Electron cannot meet acceptably.

## Replace Electron before

Do not wait beyond the point where any of these become committed release requirements:

- Native Chromium extension compatibility beyond Electron's supported extension surface
- A multi-process security boundary that requires the browser to run outside the desktop UI process tree
- Platform-native tab, window, update, or enterprise policy behavior that Electron cannot provide reliably
- A strict installer-size or idle-memory budget confirmed by measurement
- Distribution through a channel whose policy or signing model conflicts with Electron

## Architecture boundary to maintain now

The future host should be able to reuse the renderer and domain services through four interfaces:

1. `BrowserHost`: tabs, navigation, page context, screenshots, and browser view placement
2. `AgentHost`: provider discovery, authentication, run streaming, cancellation, and approvals
3. `LocalDataHost`: settings, projects, memory, run logs, and credentials
4. `DesktopHost`: windows, theme, notifications, updates, file pickers, and platform integration

Electron IPC and `WebContentsView` must remain implementations of these interfaces rather than leaking into React components or provider, policy, and storage modules.

The extraction has started with the in-repository `xgen-core` library and `xgen-daemon` process. The protocol covers health, lifecycle, run-scoped browser relay operations, and fixed-key local storage. Provider processes do not receive the CDP capability through their launch configuration, and Electron no longer exposes a browser-wide debugger. Each Agent run uses an authenticated direct-page gateway that is revoked before credential decryption. Settings, workspace state, and credential ciphertext now persist through core RPC, while Electron supplies only the OS encryption adapter. The next security-critical slice is packaged macOS and Windows adversarial testing, followed by moving provider lifecycle ownership into the core.

The package layout is now shared through one `electron-builder` configuration. OS-specific work is limited to the native `agent-browser` and `xgen-daemon` binaries, macOS signing and notarization inputs, Windows signing and NSIS, and native authentication smoke tests. An unsigned arm64 macOS directory build boots without a development server, starts the packaged core, finds the packaged browser engine, and exposes no process-wide remote-debugging switch. This is packaging evidence, but it does not satisfy the signed Touch ID or Windows dogfood exit gates.

## Candidate evaluation

Evaluate alternatives with a working vertical slice rather than a framework comparison document. The slice must open a real browser tab, render the XGEN Side sidebar, run one provider request, stream progress, request one approval, and persist one local setting.

Score candidates on browser embedding, CDP ownership, extension support, Windows security, updater and signing support, accessibility, renderer reuse, memory, installer size, crash isolation, and engineering maintenance. Select the replacement only when the vertical slice beats Electron on the release requirements that triggered the spike.
