---
name: xgen-login-assistant
description: Complete a visible browser sign-in with an existing session, the XGEN OS-encrypted credential vault, or a site-provided passkey. Use when the user asks to log in, sign in, use a saved password, or use a passkey. Keep secrets out of the model, screenshots, tool output, and chat.
---

# Secure Login Assistant

Use the visible XGEN Side browser and follow this order.

## Execution flow

1. List browser tabs and inspect the target site for an existing signed-in session.
2. Open the official site when no relevant tab exists.
3. Find and open the site's sign-in page using a fresh accessibility snapshot. The trusted login workflow may click visible login and passkey controls without a separate Guard interruption.
4. Inspect the sign-in methods without reading input values.
5. Prefer a site-provided passkey when it is visible. Click only the passkey control, wait for the native verification surface, then stop browser actions and tell the user that platform verification is waiting.
6. If no passkey control is visible but the site offers a QR login, linked-device login, or security-key route, prefer that device-verification route before the saved-login path. Click the route once, wait for its identifying text or navigation, and capture a fresh snapshot. When a QR code or device challenge is visible, stop browser actions and report `waiting for device verification`. Do not conclude that the click failed from an immediate pre-navigation snapshot.
7. If no device-verification route is available or the user chooses the saved-login path, call `agent_browser_auth_login` with `credentialProvider` set to `xgen-vault`, `name` set to the site host, and `url` set to the exact current sign-in URL. Do not call auth save, auth list, auth show, fill, type, or evaluation.
8. The trusted XGEN shell asks the user to approve the exact saved-credential login action. After approval, the desktop main process decrypts one matching credential, injects it directly into the run-owned exact-origin tab, and submits the form. The plugin returns only fill state; the model, provider process, MCP server, and agent-browser process never receive the username or password.
9. Wait for navigation or an authenticated page marker. Capture a fresh snapshot only after the password form is gone.
10. Report success only when the signed-in state is observed. Otherwise report whether the flow is waiting for device verification, awaiting approval, cancelled, or unavailable.

## Passkey boundary

- macOS uses the Chromium WebAuthn prompt backed by Touch ID, device password, or a linked device.
- Windows uses the Chromium WebAuthn prompt backed by Windows Hello, device PIN, security key, or a linked device.
- Never attempt to simulate biometrics, device PINs, QR scans, recovery codes, or one-time codes.
- Do not continue clicking while a native passkey prompt is open.
- If the native prompt offers a QR fallback, describe it and wait for the user to complete it.

## Credential boundary

- XGEN credentials are encrypted at rest by Electron safeStorage. macOS uses the system Keychain-backed encryption path and Windows uses DPAPI-backed encryption.
- Resolve credentials only through the `xgen-vault` host injector for the exact current origin.
- Never request, display, repeat, log, snapshot, or return a password.
- Never use a credential returned for one origin on another origin.
- A vault approval and credential resolution are single-run capabilities, not reusable agent memory.

## Completion states

Use one of these precise states in the final response: signed in, waiting for device verification, awaiting login approval, no matching saved login, cancelled, or failed verification.
