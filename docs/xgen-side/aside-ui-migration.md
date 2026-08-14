# Aside UI migration

## Product direction

XGEN Side should adopt Aside's desktop information architecture, interaction density, and core browser-agent workflows while keeping the XGEN Side name, its local provider model, its security boundaries, and its existing browser engine. The target is behavioral and structural fidelity rather than copying Aside trademarks or proprietary assets.

## Current milestone

P0 shell implementation is complete for the dark desktop frame, sidebar hierarchy, profile menu, browser toolbar, blank new tab, Search and Ask AI modes, suggested task cards, chat composer, normal browser rendering, browser agent panel, the Settings AI subscription flow, and the first secure browser-login flow. Search sends address-like input directly to the selected browser tab and converts ordinary text into a Google search URL. Ask AI creates a chat, transfers the prompt, and starts the provider run immediately. Ask AI, regular Reply, and browser Side chat now use the observed Aside prompt-pill and lower-control layout. Settings replaces the ordinary app sidebar with a searchable first-level menu, removes the duplicated settings navigation depth, exposes Permissions as its own destination, and fills the remaining window with the selected detail screen. A run-owned Agent browser tab resolves its owning chat by run identity, keeps the same transcript visible in Side chat, accepts a follow-up after completion, and rebinds that visible browser tab to the new run. Chat state is isolated per chat and preserves running, cancellation, failure, approval-required, passkey-waiting, and login-verification transitions. Chat transcripts, observed run activities, protected browser captures, selected chat, user browser tabs, URLs, and active tab now persist locally across app restarts.

The local runtime now shares one macOS and Windows contract for provider discovery, provider login terminals, environment isolation, process termination, command policy, packaged Agent Browser selection, and DOCX, XLSX, PPTX, and PDF attachment handling. On macOS, provider discovery includes the Codex CLI bundled with the installed ChatGPT app while XGEN keeps a separate `CODEX_HOME` for its own login and configuration boundary. The profile menu opens Settings, AI exposes the same compact provider list and Connect menu structure as Aside, macOS launches Terminal, Windows launches PowerShell, and both return to the same connecting and connected UI through provider status polling. Platform-specific behavior is limited to adapters while browser navigation, agent-owned tabs, document Skills, Memory, MCPs, and permission infrastructure continue to use the same XGEN services. A packaged macOS regression run confirmed that a Side chat follow-up sends the active page context, keeps one Agent tab, and reuses the visible BrowserView instead of creating a second blank tab.

## Reference captures

The current reference set lives in `artifacts/aside-reference/`.

- `new-tab.jpeg`: Search and Ask AI switch, suggested tasks, browser toolbar, and sidebar
- `new-chat.jpeg`: Empty chat and composer controls
- `browser-page.jpeg`: Normal browser page
- `browser-agent-panel.jpeg`: Browser page with the agent side panel
- `skills.jpeg`: Settings resource explorer and skill detail
- `statistics.jpeg`: Settings navigation and statistics layout
- `artifacts/aside-ai-flow/01-profile-menu.jpeg`: live Aside profile menu
- `artifacts/aside-ai-flow/03-settings-ai-connected.jpeg`: live Aside AI screen with an existing ChatGPT subscription connection
- `artifacts/aside-ai-flow/20-aside-xgen-ai-comparison.jpeg`: current source and implementation comparison
- `artifacts/aside-naver-login-flow/01-chat-passkey-waiting.jpeg`: live Aside passkey-waiting chat state
- `artifacts/aside-naver-login-flow/02-expanded-run-steps.jpeg`: live Aside expanded tool execution trace
- `.audit/aside-chat-skills-2026-08-14/screenshots/01-aside-new-tab-ask-ai.png`: live Aside Ask AI composer
- `.audit/aside-chat-skills-2026-08-14/screenshots/02-aside-agent-chat-reply-and-sidepanel.png`: live Aside Reply composer and completed Agent chat
- `.audit/aside-chat-skills-2026-08-14/screenshots/06-aside-side-chat.png`: live Aside split Side chat

## P0 screen states

<table>
  <thead>
    <tr><th>Screen</th><th>Required states</th><th>Primary behavior</th></tr>
  </thead>
  <tbody>
    <tr><td>Desktop shell</td><td>Sidebar open, sidebar closed, light, dark</td><td>Preserve the selected task while the shell changes presentation</td></tr>
    <tr><td>New tab</td><td>Search selected, Ask AI selected, focused, populated</td><td>Search navigates the active browser tab. Ask AI carries the prompt into a new chat</td></tr>
    <tr><td>New chat</td><td>Empty, populated, running, cancelled, failed</td><td>Choose project, permission, provider, model, reasoning, and send or stop a task</td></tr>
    <tr><td>Browser</td><td>Loading, loaded, navigation disabled, navigation available</td><td>Use the active Chromium view without creating a second browser profile</td></tr>
    <tr><td>Browser agent</td><td>Closed, empty, running, approval required, completed</td><td>Attach page context or operate the current page within the selected permission boundary</td></tr>
    <tr><td>Sidebar</td><td>Bookmarks empty, chats, normal tabs, agent tabs</td><td>Switch between chats and browser tabs as first-class work items</td></tr>
    <tr><td>AI subscription</td><td>Connect menu, authenticating, connected, failed</td><td>Launch the system login terminal, poll locally, and expose the provider only after authentication succeeds</td></tr>
    <tr><td>Secure browser login</td><td>Session check, login page, vault approval, passkey waiting, verifying, completed, failed</td><td>Keep secrets outside model context and require direct user interaction for native device verification</td></tr>
    <tr><td>Local documents</td><td>Picker, chips, multi-file request, format Skills, running, failed, completed, result cards</td><td>Analyze or create DOCX, XLSX, PPTX, and PDF artifacts without overwriting source files</td></tr>
  </tbody>
</table>

## Delivery order

1. Match the flat desktop shell, sidebar, toolbar, new tab, and empty chat.
2. Preserve search, navigation, provider execution, cancellation, and agent-owned tabs while moving controls into the new shell.
3. Replace placeholder Project controls with persisted project context.
4. Expand Settings in this order: Skills, Memory, MCPs, Permissions, AI providers, Projects.
5. Add Routines, Statistics, archived chats, notifications, and developer setup after the core workflow is stable.
6. Decide Account, Billing, Channels, Extensions, and cloud sync only after the distribution and service model is known.

## Prioritized screen backlog

### P0: core daily loop

- Desktop shell and sidebar: implemented, with responsive close state still requiring packaged Windows verification.
- New tab: implemented for Search, Ask AI, suggestions, and blank-tab creation.
- New chat: implemented for empty, populated, running, approval-required, cancelled, and failed states with per-chat message and run isolation.
- Browser: implemented for navigation, reload, address input, real page rendering, and agent-panel toggle.
- Browser agent panel: implemented as an Aside-style Side chat with the run-linked transcript, a persistent Reply composer, same-tab follow-up rebinding after completion, running and failed feedback, cancellation, and approval handling.
- Chat and tab switching: implemented for active rows, close actions, blank tab creation, search result titles, local restart recovery, and run-aware close protection.
- Profile and AI settings: implemented for profile menu navigation, one-depth searchable settings sidebar replacement, return to the previous app surface, full-height detail content, provider selection, authenticating feedback, automatic completion polling, connected state, reconnect action, model rows, and platform-neutral dependency information.
- Runtime parity: macOS and Windows use shared contracts with platform-specific executable, terminal, process, environment, command shell, and Agent Browser adapters. Packaged Windows smoke testing remains.
- Secure login: implemented for login intent routing, Aside-style elapsed run disclosure, actual chronological tool events, inline browser captures at meaningful visual milestones, protected top crops for sensitive login pages, uninterrupted login, passkey and QR control clicks, a post-click device-challenge wait, exact-origin OS-encrypted vault resolution with one-time approval, passkey waiting copy for macOS and Windows, and signed-in state verification guidance. The UI does not predeclare future numbered steps or open a separate Browser Activity rail in the home chat. Real Touch ID and Windows Hello verification remain packaging smoke tests.
- Local documents: implemented for native multi-file selection, DOCX, XLSX, PPTX, and PDF chips, format-aware Skill routing, read-only source copies, isolated artifacts, inline local activity, persisted attachment and result metadata, and open or reveal actions. Packaged macOS validation is in progress and packaged Windows validation remains a release gate.

### P1: persistent work context

- Projects: replace the composer placeholder with project selection, persisted instructions, files, and recent project state.
- Bookmarks: implement drag, drop, reorder, rename, open, and persistence.
- Skills and Memory: the Settings workbench now lists fourteen validated first-party packages, including an independent Password Manager package whose secret boundary is enforced by runtime policy. Continue matching Aside empty states and Memory editing details without copying proprietary Skill source.
- MCPs and Permissions: consolidate connection state, tool scope, approval policy, and per-project overrides.
- Chat and tab lifecycle: archive, restore, rename, duplicate, and close confirmation when a task is active. Basic restart recovery is implemented.

### P2: proactive workflows

- Routines: schedule, enable, pause, run history, error recovery, and notification routing.
- Statistics: task counts, model usage, latency, browser work, approvals, failures, and local storage.
- Archived chats and notifications: searchable archive, restore, notification preferences, and task completion routing.
- Auto-login hardening: add account selection when multiple exact-origin entries exist, recovery after failed submit, and packaged WebAuthn verification without exposing secrets to the renderer or model.

### P3: distribution-dependent surfaces

- Account, Billing, Channels, Extensions, Community, and cloud sync remain deferred until the service and distribution model is decided.
- Native host replacement remains a measured engineering decision governed by `electron-exit-criteria.md`.

## Fidelity rules

- Use Aside's compact spacing, muted dark surfaces, left navigation hierarchy, and task-first composer layout.
- Keep real controls interactive in the core workflow. Do not ship a static replica of Search, Ask AI, navigation, send, stop, or agent panel controls.
- Use Fluent UI icons already shipped with XGEN Side. Create original XGEN raster assets when the reference depends on imagery. Do not ship Aside icons, logos, avatars, or proprietary illustration assets.
- Keep renderer layout independent from Electron APIs. Electron-specific placement belongs in the shell adapter and browser host.
- Compare each implemented screen against the matching reference capture at the same window size before declaring it complete.
