---
name: bitwarden
description: Use a user-installed Bitwarden browser integration for secure login and autofill. Trigger for Bitwarden, vault login, or saved Bitwarden credential requests.
---

# Bitwarden

1. Verify that Bitwarden is installed and unlocked by the user.
2. Match credentials only to the exact visible origin.
3. Prefer the extension's autofill surface. Never expose secret values to the provider model or run log.
4. Keep the browser visible for vault unlock, passkey, OTP, and final approval.
5. If the integration is unavailable, explain the limitation and offer manual login without requesting the password in chat.
