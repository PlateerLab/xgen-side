# XGEN Side

A skill-first AI browser that runs locally on macOS and Windows.

XGEN Side brings general chat, local DOCX, XLSX, PPTX, and PDF work, web research, real browser automation, and a model-blind local Password Manager together in one desktop application. Auto mode lets the Skill Router choose the smallest required capability for each request, and only the tools and browser actions permitted by the selected skills are exposed at runtime.

> Current status: early cross-platform desktop prototype. The core UI, local provider execution, Skill Router, Browser Agent Overview, and local run history are implemented.

## Product layout

- Left panel: manage chat and browser sessions in one unified list
- Center workspace: switch between general AI chat and real browser tabs
- Right panel: ask questions against a normal page, or inspect the same Agent Run that was started from general chat while its live browser tab is open
- Browser Agent Overview: when a request requires browser work, display the selected skills, execution steps, target site, permitted actions, and event-driven browser screenshots
- General chat Skill selector: pin an enabled Skill for a request, or leave it on Auto so the Skill Router chooses the execution boundary
- Settings replaces the ordinary app sidebar with one searchable first-level settings menu, provides a direct return to the previous app surface, and lets the detail workspace use the full remaining window.
- Aside-style Ask AI, Reply, and Side chat composers. A completed Agent browser tab accepts follow-up messages in the same chat and reuses the visible browser tab.
- Agent browser tabs: browser-backed chat requests receive a run-owned tab; opening it shows the live page with the same progress stream instead of starting a second run
- Reasoning effort: use Auto, Fast, Balanced, Deep, or Very Deep for Codex models while unsupported providers keep their own default
- Light and dark themes with the XGEN accent color `#305EEB`

## Skill-first execution

Every agent request is converted into an execution plan by the Skill Router.

```text
User request
    ↓
Skill Router
    ├─ Conversation
    ├─ Web research
    ├─ Page reader
    ├─ Browser navigation
    ├─ Structured extraction
    └─ Form guard
    ↓
Provider adapter (Codex CLI / Claude Code CLI)
    ↓
Command broker + Browser bridge
    ↓
Local run store
```

- Browser permissions start with `default: deny`.
- Only the action categories required by the selected skills are allowed at runtime.
- If a required skill is disabled, execution is blocked before the provider or browser starts.
- Skill routing decisions and execution events are stored in the local session history.
- Provider text and tool activity are streamed into the conversation while a run is active, and the user can stop the active run from the composer.
- A browser-backed run is correlated by one renderer run ID across the general chat, its event screenshot rail, and its run-owned browser tab. Switching presentation surfaces never starts another provider process.

## Providers

XGEN Side is designed to use CLI providers authenticated on the user's machine without requiring a separate API key.

- OpenAI: Codex CLI authentication and subscription environment
- Anthropic: Claude Code CLI authentication and subscription environment
- Providers are registered in Settings; the provider and model are selected inside the chat composer
- Provider-specific behavior is normalized behind a shared adapter contract

XGEN Side does not read or store provider subscription tokens. Optional website Auto login passwords are stored only in a separate OS-encrypted local vault and are never returned to the AI provider. Browser login runs may click visible login and passkey controls without interrupting the trusted login workflow, but resolving one exact-origin saved credential still requires an in-app approval and a one-time loopback capability. Passkeys stay in the native Chromium and operating-system WebAuthn prompt, so Touch ID or Windows Hello verification remains a direct user action. Authentication to the AI provider remains the responsibility of each provider's official CLI.

## Local execution and security

- Saved browser passwords are OS-encrypted and injected by the trusted XGEN desktop main process. AI providers and MCP receive only approval and completion states; password plaintext is never returned through the credential plugin protocol.
- Settings lists fourteen first-party XGEN Skill packages. Password Manager is a separate guarded package with an exact-origin, opaque-reference contract, while Login Assistant owns passkey, QR, OAuth, and signed-in verification handoffs.
- Browser cookies are treated as session data rather than saved passwords. Raw cookie, storage, eval, and network inspection remain denied to normal AI browser runs.
- The full macOS and Windows boundary, Aside findings, and production release gates are documented in [docs/xgen-side/credential-security-boundary.md](docs/xgen-side/credential-security-boundary.md).
- Starts the in-repository Rust `xgen-daemon` over private stdio with a one-time session token and a versioned protocol. The daemon owns health, lifecycle, fixed-key local storage, and run-scoped browser MCP relays. Providers receive only an opaque relay capability, while the authenticated tab-scoped CDP URL, browser policy, approval, and credential-injection values remain in the trusted daemon's `agent-browser` child process. Settings, workspace state, and credential ciphertext persist through core RPC. Electron does not expose a process-wide remote debugging port.
- Uses Windows PowerShell as the default command shell
- Routes commands through the Command Broker instead of executing them directly
- Separates read-only commands, approval-required commands, and denied commands
- Records execution requests, skill routes, approval results, output, and errors in local files
- Attaches the Browser Bridge only when a selected skill requires browser access
- Denies deletion, upload, download, and external state changes by default

## Getting started

### Requirements

- macOS 13 or later, or Windows 11
- Node.js 24 or later
- pnpm 11.1.3 or later
- The stable Rust toolchain for development builds
- An installed and authenticated Codex CLI or Claude Code CLI, depending on the providers you want to use

### Install and run

```powershell
pnpm install
pnpm dev:xgen-side
```

### Validate

```powershell
pnpm typecheck:xgen-side
pnpm test:xgen-side
pnpm build:xgen-side
```

### Package the desktop app

```powershell
# Current host, unpacked application for smoke testing
pnpm package:xgen-side:dir

# Run macOS packaging on macOS
pnpm package:xgen-side:mac

# Run Windows x64 packaging on Windows
pnpm package:xgen-side:win
```

One shared `electron-builder` configuration packages the renderer, Skills, provider bridges, `agent-browser`, and `xgen-daemon`. macOS and Windows builds differ only in native binary, signing, and installer targets. Release macOS builds still require a Developer ID identity, notarization credentials, and the final WebAuthn keychain access group. Windows release builds still require a code-signing identity and a real Windows Hello smoke test.

GitHub Actions runs only these three checks on Windows. It does not automatically run the upstream npm publishing pipeline, create GitHub Releases, or build Linux and macOS binaries.

## Repository structure

```text
apps/desktop/                XGEN Side Electron application
  src/main/                  Providers, skills, policies, browser, local storage
  src/preload/               Typed IPC bridge
  src/renderer/              Chat, browser, settings, and Overview UI
crates/xgen-core/            Platform-neutral trusted core and IPC contracts
crates/xgen-daemon/          Local core process and private stdio transport
cli/                         Embedded agent-browser engine
skill-data/                  Engine skills and supporting references
docs/xgen-side/              XGEN Side architecture documentation
scripts/xgen-side.mjs        Desktop development and validation entry point
```

See the [XGEN Side overview](XGEN_SIDE.md) and [architecture documentation](docs/xgen-side/architecture.md) for more details.

## Current implementation

- [x] Windows Electron application shell
- [x] General chat and browser session UI
- [x] Collapsible left and right panels
- [x] Light and dark themes
- [x] Codex CLI and Claude Code CLI adapters
- [x] Provider, MCP, and domain-based skill settings
- [x] Skill Router and least-privilege browser policy
- [x] Browser Agent Overview
- [x] Local run history
- [x] Real-time provider output and run cancellation
- [x] Manual Skill selection for general chat requests
- [x] Run-owned Agent browser tabs with shared progress in the browser side panel
- [x] Versioned XGEN Core process handshake and lifecycle
- [x] Shared macOS and Windows package layout with platform-native core and browser binaries
- [ ] Live Electron tab rendering inside the Overview
- [ ] Approval UI for command and consequential browser actions
- [ ] Windows installer and automatic updates

## Upstream

The browser automation engine is based on Vercel Labs' [agent-browser](https://github.com/vercel-labs/agent-browser). Within this repository, the upstream engine is treated as one local tool available to XGEN Side.

Original copyright and license notices remain available in [LICENSE](LICENSE) and the third-party notices included in the source tree. The upstream Git commit history is not included in order to maintain a clean XGEN Side history, but its copyright and open-source attribution are preserved.

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
