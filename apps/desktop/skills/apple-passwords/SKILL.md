---
name: apple-passwords
description: Securely select and autofill credentials from Apple Passwords on macOS. Use for Apple Passwords, iCloud Passwords, passkeys, OTPs, or saved-login requests.
---

# Apple Passwords

1. Confirm the visible page origin before requesting a credential.
2. Use the trusted credential broker. Never ask the provider model to read, return, log, or persist a password or OTP.
3. Prefer passkeys, then opaque autofill. Keep account selection metadata separate from secret material.
4. Show the browser and hand Touch ID or device approval to the user.
5. On Windows, route the same request through Windows Hello and the OS credential vault instead of claiming Apple Passwords support.
