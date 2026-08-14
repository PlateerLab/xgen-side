# Credential security boundary

The renderer may create or replace a credential only from a user-operated password field. Main process code validates the origin and sends the secret directly to the OS-backed credential store.

For agent use, the provider may receive an opaque item reference and non-secret metadata. The credential broker resolves that reference inside the main process, verifies that the live page origin exactly matches the saved origin, and injects the username and password through the isolated browser gateway. It returns status only.

The provider must never ask the page, browser tool, preload bridge, renderer, credential store, or user to reveal the stored password. Passkey, OTP, QR, and device prompts remain user-operated system or browser UI.
