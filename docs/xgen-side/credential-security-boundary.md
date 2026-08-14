# XGEN Side credential security boundary

The Settings Skills workbench exposes Password Manager as its own first-party XGEN package. This package is a clean-room XGEN workflow built around the existing credential broker. It does not contain Aside source. The provider receives an opaque item reference and non-secret summary only; the main process resolves the reference, verifies the exact page origin, injects the credential, and returns status.

## Product rule

Browser cookies are allowed to remain in the browser profile because they are required to preserve signed-in sessions. Password plaintext, OTP values, passkey private keys, recovery codes, and vault encryption keys must never enter an AI model prompt, provider process, MCP payload, browser snapshot, activity event, chat transcript, or local run log.

The rule applies equally to macOS and Windows. A provider may control an already authenticated page within the user's selected permission mode, but it must not receive the secret that created that session.

## Aside findings used as a reference

The installed macOS Aside build is a signed Chromium browser rather than an Electron shell. Its cookie database stored all observed cookie rows in Chromium's encrypted field and used a macOS Keychain item named `Aside Safe Storage`. Its signing entitlements include dedicated cryptography, WebAuthn, and unexportable-key access groups. Aside also separates its Browsing Agent, Password Manager, and local daemon into different components. The local daemon uses an authenticated challenge/session/verify flow.

Aside's Browsing Agent still has powerful browser permissions, including cookies and debugger access. Disk encryption therefore protects data at rest but does not by itself prove that an agent cannot access a live session. XGEN adopts the component separation while applying a stricter contract to password plaintext.

## Trust zones

### Trusted secret zone

- Electron main process and its future native credential helper
- macOS Keychain-backed encryption through Electron `safeStorage`
- Windows DPAPI-backed encryption through Electron `safeStorage`
- Exact-origin credential matching and the one-time user approval broker
- Direct insertion into the active, run-owned browser tab

This zone may hold password plaintext in memory only for the shortest possible fill operation. It must not serialize or return the plaintext.

### AI execution zone

- Codex and Claude provider processes
- `agent-browser` MCP and CLI output
- Skill prompts, model context, tool calls, activity events, and logs

This zone receives only non-secret states such as `awaiting approval`, `filled`, `submitted`, `not found`, `origin mismatch`, or `unavailable`.

### Browser session zone

- Cookies, IndexedDB, local storage, and rendered authenticated pages
- Site-owned passkey and device-verification flows

Cookies are permitted by product policy. They remain security-sensitive bearer tokens, so raw cookie export and storage tools stay denied to normal AI runs even though the browser may use the session.

## Saved-password flow

1. The agent identifies that a saved-password login is required and requests `auth_login` for the exact current HTTPS origin.
2. The XGEN credential plugin sends only the run capability, item reference, and page URL to the loopback broker.
3. The trusted shell asks the user to approve the exact origin.
4. After approval, the main process resolves one matching OS-encrypted vault entry.
5. The main process validates the active run-owned tab and exact origin, permanently marks the tab as credential-protected, inserts username and password with `WebContents.insertText`, and submits the form.
6. The broker returns only injection state. The plugin protocol contains no username, password, OTP, passkey material, or cookie value.
7. The agent verifies the post-login page without reading password fields.

## Passkey and QR flow

Passkey private keys remain with macOS Keychain and WebAuthn or Windows Hello. XGEN may click the site's passkey control and then must stop for direct user verification. QR, device approval, biometrics, device PINs, OTPs, and recovery codes are user interaction boundaries and are never simulated, captured, or stored by the model.

Agent-owned authentication tabs are intentionally ephemeral. XGEN Side does not restore them after an application restart because their site challenges and run capabilities may be stale. Cookies remain in the browser partition, but the user must start the login request again to receive a fresh QR, passkey, or device-approval challenge.

## Current implementation

- `CredentialVault` encrypts saved entries with Electron `safeStorage` and refuses to operate when an OS-backed secure backend is unavailable.
- The encrypted vault document is persisted by `xgen-daemon` under a fixed storage key. Electron sends only the encrypted document over authenticated private stdio; the daemon never receives plaintext credentials.
- `CredentialBroker` is loopback-only, uses a random single-run token, requires explicit approval, binds the capability to one browser tab, and returns state-only injection results.
- `CredentialAutofillService` decrypts and injects inside the main process, validates the exact origin before each operation, and submits without returning plaintext.
- `BrowserWorkspace` marks the injected tab as credential-protected before vault access.
- The XGEN credential plugin declares `credential.inject`, not `credential.read`.
- Login snapshots redact password, OTP, QR, canvas, and passkey-like regions and store only a protected header crop.

## Remaining hardening

`xgen-daemon` launches `agent-browser` with the authenticated tab-scoped CDP URL, action policy, approval capability, and credential-injection capability. Provider processes receive only a run-scoped MCP relay address and token, so the provider launch path contains no CDP capability, core storage token, or credential broker value. Electron no longer exposes a browser-wide remote debugging port. A provider that scans loopback receives only HTTP 404 responses without the 256-bit WebSocket capability, and the MCP bridge removes attempts to replace the bound session or connection. Before decrypting a saved password, Electron revokes the tab gateway. Existing legacy vault files are imported after validation and retained temporarily for recoverability until packaged migration testing is complete. Remaining production hardening must prove on packaged macOS and Windows builds that provider processes cannot read or modify XGEN application data and that operating-system encrypted storage behaves as expected under the packaged application identity.

## Release gates

- No serialized provider input, environment dump, MCP output, stdout, stderr, event, snapshot, or workspace file contains a test password marker.
- Invalid token, wrong run, inactive tab, wrong owner, wrong origin, missing password field, unavailable OS encryption, denied approval, and repeated use all fail closed.
- macOS packaged tests verify Keychain-backed vault encryption and signed WebAuthn entitlements.
- Windows packaged tests verify DPAPI-backed vault encryption and Windows Hello behavior.
- A provider red-team test attempts shell, MCP, CDP, log, snapshot, cookie, storage, and DOM-value extraction and cannot obtain password plaintext.
