# Design QA

## Scope

- References: the Aside desktop screenshots supplied by the user, including the browser-workflow reference for this iteration.
- Implementation: Auto routing, reasoning effort, event-driven browser screenshots, collapsible run detail, Skills workbench, MCP workbench, and Browser Agent Memory.
- Auto screenshot capture: `artifacts/xgen-side-auto-snapshots.png`.
- Skills capture: `artifacts/xgen-side-skills.png`.
- Memory capture: `artifacts/xgen-side-memory-populated.png`.
- Combined comparisons: `artifacts/qa-auto-snapshots-comparison.png`, `artifacts/qa-chat-comparison.png`, and `artifacts/qa-settings-comparison.png`.

## Comparison findings

- Auto layout: Passed. The conversation and run timeline occupy the center while browser-backed work opens an event screenshot rail on the right.
- Run detail: Passed. The current activity is compact by default and expands to show routed skills, permission level, task steps, and browser capture state.
- Mode boundaries: Passed. Auto chooses the smallest capability required. Optional No web, Research, Ask page, and Browser work boundaries remain available.
- Browser capture: Passed. The native Electron browser stays detached between events, appears only for the capture interval, and unchanged screenshots are deduplicated.
- Reasoning effort: Passed. Codex exposes Auto, Fast, Balanced, Deep, and Very Deep. Unsupported providers show their own default without a nonfunctional control.
- Settings hierarchy: Passed. Skills, MCP, and Local data add a second file-explorer sidebar without replacing the primary settings navigation.
- Markdown workbench: Passed. Skill and MCP definitions have Preview and Source views. Memory files add editable source, line numbers, save state, and rendered Markdown.
- Memory scope: Passed. Only Browser Agent runs create `browser-history/` and `task-results/` Markdown files. Chat, Search, and Ask page remain excluded.
- Visual fidelity: Passed. The dense three-column settings structure, large document canvas, subdued chrome, typography hierarchy, borders, and elevation track the Aside references while retaining XGEN Side tokens.
- Icons and assets: Passed. Existing Fluent UI icons and the real browser surface are used. No fabricated image placeholders or inline SVG assets were introduced.
- Interaction: Passed. Auto routing, reasoning selection, run detail dropdown, screenshot rail, Settings resource navigation, Preview and Source tabs, Markdown editing, Save, and process stop controls are wired.
- Accessibility: Passed. Automated axe audit reports 0 violations and 0 incomplete checks.

## Engineering verification

- `pnpm typecheck:xgen-side`: passed.
- `pnpm test:xgen-side`: passed, 26 of 26 tests.
- Windows cancellation: passed. A long Browser Agent run was stopped from the UI and the composer became available again within two seconds.
- Browser Agent persistence: passed. A real run created daily browser history and per-task result Markdown files visible in Settings.
- Fast research path: passed. A real Seoul weather request opened Bing immediately, completed without starting the browser MCP daemon, and returned a sourced answer in about 15 seconds instead of remaining blocked for more than a minute.
- Updated layout: passed. The primary sidebar is 288 pixels wide, the browser capture rail is 520 pixels wide, and the default desktop window opens at 1680 by 1040.

final result: passed
