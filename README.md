# XGEN Side

A skill-first AI browser that runs locally on Windows.

XGEN Side brings general chat, web research, and real browser automation together in one desktop application. Auto mode lets the Skill Router choose the smallest required capability for each request, and only the tools and browser actions permitted by the selected skills are exposed at runtime.

> Current status: early Windows desktop prototype. The core UI, local provider execution, Skill Router, Browser Agent Overview, and local run history are implemented.

## Product layout

- Left panel: manage chat and browser sessions in one unified list
- Center workspace: switch between general AI chat and real browser tabs
- Right panel: ask questions and run tasks against the currently open page
- Browser Agent Overview: when a request requires browser work, display the selected skills, execution steps, target site, permitted actions, and event-driven browser screenshots
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

## Providers

XGEN Side is designed to use CLI providers authenticated on the user's machine without requiring a separate API key.

- OpenAI: Codex CLI authentication and subscription environment
- Anthropic: Claude Code CLI authentication and subscription environment
- Providers are registered in Settings; the provider and model are selected inside the chat composer
- Provider-specific behavior is normalized behind a shared adapter contract

XGEN Side does not store account passwords or subscription tokens. Authentication remains the responsibility of each provider's official CLI.

## Local execution and security

- Uses Windows PowerShell as the default command shell
- Routes commands through the Command Broker instead of executing them directly
- Separates read-only commands, approval-required commands, and denied commands
- Records execution requests, skill routes, approval results, output, and errors in local files
- Attaches the Browser Bridge only when a selected skill requires browser access
- Denies deletion, upload, download, and external state changes by default

## Getting started

### Requirements

- Windows 11
- Node.js 24 or later
- pnpm 11.1.3 or later
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

GitHub Actions runs only these three checks on Windows. It does not automatically run the upstream npm publishing pipeline, create GitHub Releases, or build Linux and macOS binaries.

## Repository structure

```text
apps/desktop/                XGEN Side Electron application
  src/main/                  Providers, skills, policies, browser, local storage
  src/preload/               Typed IPC bridge
  src/renderer/              Chat, browser, settings, and Overview UI
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
- [ ] Live Electron tab rendering inside the Overview
- [ ] Approval UI for command and consequential browser actions
- [ ] Windows installer and automatic updates

## Upstream

The browser automation engine is based on Vercel Labs' [agent-browser](https://github.com/vercel-labs/agent-browser). Within this repository, the upstream engine is treated as one local tool available to XGEN Side.

Original copyright and license notices remain available in [LICENSE](LICENSE) and the third-party notices included in the source tree. The upstream Git commit history is not included in order to maintain a clean XGEN Side history, but its copyright and open-source attribution are preserved.

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
