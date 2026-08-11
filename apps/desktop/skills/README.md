# XGEN Side Skill Packages

XGEN Side treats a Skill as a versioned workflow package, not as a label for a prompt. Each folder is independently discoverable and contains:

- `SKILL.md`: activation guidance, workflow, failure behavior, boundaries, and completion criteria
- `manifest.json`: deterministic routing, runtime binding, exact tools, policy categories, progress text, and settings key
- `agents/openai.yaml`: provider-facing display metadata and MCP dependency declarations
- `references/`: detailed contracts loaded only when the Skill is selected

## Runtime boundary

Skills decide how a task should be performed. Runtimes provide the actual capability.

| Runtime | Use | Browser control |
| --- | --- | --- |
| `llm` | Stable conversation and writing | No |
| `provider-web` | Current web research with citations | No |
| `page-context` | Read the page already attached by XGEN Side | No |
| `agent-browser` | Navigate or interact with the visible browser | Yes |
| `policy` | Add safety and approval boundaries | No direct tools |

Do not bind `agent-browser` to a Skill that can finish from provider search or attached page text. Browser control is reserved for navigation, scrolling, dynamic inspection, and interaction.

## Routing model

1. Resolve the request mode from manifest signals.
2. Select one enabled primary Skill.
3. Add supplemental Skills only when their signals match.
4. Add guard Skills at consequential boundaries.
5. Build the provider prompt from the selected `SKILL.md` bodies and reference files.
6. Expose only the runtime profiles and action-policy categories declared by those Skills.

The router fails closed when a required primary Skill or browser-control Skill is disabled.

## Initial set

| Skill | Role | Runtime |
| --- | --- | --- |
| `xgen-conversation` | Stable answers and writing | `llm` |
| `xgen-web-research` | Current information and cited research | `provider-web` |
| `xgen-multi-page-research` | Bounded multi-source comparison and source ledger | `provider-web` |
| `xgen-page-reader` | Questions about the attached page | `page-context` |
| `xgen-browser-navigation` | Tabs, URLs, snapshots, scroll, and waits | `agent-browser` |
| `xgen-browser-interaction` | Click, fill, type, select, check, and press | `agent-browser` |
| `xgen-structured-extraction` | Structured records with provenance | Attached page or `agent-browser` |
| `xgen-form-guard` | Consequential-action boundary | `policy` |

## Next implementation order

1. `xgen-auth-handoff`: detect authentication, pause for user-completed login, and resume without exposing credentials.
2. `xgen-browser-qa`: run visible local-app checks with assertions, screenshots, console errors, and a reproducible report.
3. `xgen-artifact-download`: explicitly approved downloads with file type, destination, and provenance checks.
4. `xgen-routine-runner`: repeat a saved browser workflow with bounded inputs, cancellation, and per-step evidence.
5. Domain Skills such as GitHub or Google Workspace only after their workflow needs differ materially from the generic browser Skills.

## Acceptance checklist

- The frontmatter name matches the folder name.
- The description states both capability and activation conditions.
- Inputs, ordered steps, output, stop conditions, and failure recovery are explicit.
- Every declared MCP tool exists in the selected agent-browser profiles.
- `allowActions` contains agent-browser policy categories, not command names.
- Read and write workflows are separate where external state can change.
- Progress labels describe observable work without exposing private chain-of-thought.
- Unit tests cover positive routing, disabled Skills, no-browser paths, and consequential guards.
