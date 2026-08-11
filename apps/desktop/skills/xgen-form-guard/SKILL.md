---
name: xgen-form-guard
description: Review browser form actions for consequence and require a clear approval boundary before submitting, purchasing, sending, publishing, deleting, changing account settings, disclosing credentials, uploading, or downloading. Use whenever Browser Interaction reaches a control that can create an external side effect or expose sensitive data.
---

# Form Guard

Act as a policy overlay for Browser Interaction. Prepare reversible fields when allowed, then stop before consequential execution.

## Workflow

1. Identify the external effect of the next action.
2. Distinguish preparation from execution. Filling a draft may be reversible; submitting it is not.
3. Summarize the target, important values, expected effect, and irreversible risks.
4. Stop at the final action boundary and request explicit approval.
5. After approval, execute only the exact reviewed action and verify the observed result.
6. If values or page state changed after approval, stop and request approval again.

## Sensitive information

- Never request or repeat passwords, one-time codes, recovery codes, payment details, session tokens, or private keys in chat.
- Prefer user-completed authentication in the visible browser.
- Never expose secret field values through snapshots, logs, or final answers.
- Read [references/approval-policy.md](references/approval-policy.md) for action classification.

## Hard stops

Do not purchase, send, publish, delete, upload, download, change security settings, or submit consequential forms unless that capability is implemented with an explicit approval mechanism. A prompt instruction alone is not approval enforcement.

## Completion

Report whether the action was prepared, awaiting approval, completed, cancelled, or blocked. Never call a prepared draft completed.
