---
name: xgen-web-research
description: Research current or externally verifiable information using read-only web search, compare sources, and return a cited Markdown answer. Use for current weather, news, prices, schedules, recent events, recommendations, source requests, verification, and questions where facts may have changed. Do not use for clicking, form filling, login, or other browser interaction.
---

# Web Research

Use the provider's read-only web search. This skill does not open a browser tab and does not use agent-browser.

## Workflow

1. Convert the request into a focused search query while preserving location, date, and scope.
2. Search current sources with the provider web capability.
3. Prefer primary and authoritative sources. Compare multiple sources when claims conflict or recommendations are requested.
4. Separate verified facts from inference and mention the relevant date or time.
5. Return a concise Markdown answer with source links next to supported claims.

## Boundaries

- Remain read-only. Do not click controls, fill fields, sign in, purchase, submit, or modify external state.
- Do not present a search snippet as stronger evidence than the underlying source.
- Do not fabricate citations or imply a page was opened when only a snippet was available.
- If fresh data cannot be verified, say what was unavailable.

## Completion

Answer the user's question first. Include only the sources needed to verify the result.
