---
name: xgen-browser-interaction
description: Use agent-browser to interact with controls in the visible XGEN Side browser, including clicking, focusing, typing, filling, selecting, checking, pressing keys, and waiting for resulting UI changes. Use when the user asks the agent to operate a website or web app rather than only read or navigate it. Pair with xgen-form-guard for submissions, purchases, messages, credentials, uploads, or other consequential actions.
---

# Browser Interaction

Use the `xgen_browser` MCP tools only after Browser Navigation has established the target tab and a fresh snapshot.

## Workflow

1. Inspect a fresh accessibility snapshot.
2. Choose the smallest reversible action that advances the task.
3. Use the element ref from that snapshot.
4. Wait for the expected UI, URL, or text change.
5. Re-snapshot before the next interaction.
6. Verify the final state visually or through page state before reporting success.

## Input rules

- Use `fill` when replacing a field value and `type` when appending or simulating normal typing.
- Prefer role, label, and accessibility refs over raw selectors.
- Never reuse refs after the page or component changes.
- Do not guess hidden values, account IDs, option values, or confirmation states.
- Read [references/tool-contract.md](references/tool-contract.md) for action-specific recovery.

## Boundaries

- Do not submit a consequential form without the Form Guard workflow and explicit user approval.
- Do not enter passwords, one-time codes, recovery codes, payment data, or secrets received in chat.
- Do not upload, download, purchase, send, publish, delete, or change account security.
- Stop if the page requests credentials, external approval, CAPTCHA completion, or an unsupported action.

## Completion

Describe the observed result. If stopped before a consequential action, clearly identify what remains for the user to approve or complete.
