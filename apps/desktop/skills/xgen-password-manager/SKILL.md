---
name: xgen-password-manager
description: Use XGEN Side's OS-encrypted local credential vault to fill a saved login into an origin-matched browser page without returning the password to the model, renderer, logs, screenshots, or chat. Use when the user explicitly asks to use a saved login or the XGEN password manager. Pair with xgen-login-assistant for passkeys, QR approval, OAuth, and verification of the signed-in state.
---

# Password Manager

Use the credential broker as a guarded browser capability, never as a source of secret text.

## Workflow

1. Navigate to the intended sign-in page and verify the current origin.
2. Read only credential summaries such as label, origin, and username. Never request or print a stored password.
3. Ask for approval before the broker fills the selected credential.
4. Pass only the opaque credential item reference to `agent_browser_auth_login`.
5. Let the broker verify the exact origin and inject the secret inside the browser process.
6. Inspect a fresh page snapshot for non-secret signed-in state. Do not inspect password field values.
7. If the site requests a passkey, QR code, OTP, or device approval, leave the browser visible and hand control to the user.

## Safety boundary

- Password bytes must never enter provider context, renderer state, application logs, screenshots, or run artifacts.
- A credential can be filled only on the exact saved origin.
- The model receives success, not-found, origin-mismatch, or unavailable status only.
- Autofilled authentication tabs stay isolated from unattended agent automation until the user continues.
- Never save a new password from model-generated or page-scraped text.

Read `references/security-boundary.md` before handling a saved login.
