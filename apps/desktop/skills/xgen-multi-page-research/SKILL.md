---
name: xgen-multi-page-research
description: Compare multiple current sources, cross-check important claims, resolve disagreements, and produce a bounded research synthesis with a source ledger. Use when the user asks for deep research, multiple or independent sources, fact-checking, cross-verification, a research report, evidence comparison, or an answer that must distinguish consensus, conflict, and inference. Do not use for a simple current fact that one authoritative source can answer.
---

# Multi-page Research

Extend Web Research with a bounded evidence workflow. Use provider web search without controlling the browser.

## Workflow

1. Define the research question, freshness window, geography, and comparison criteria.
2. Split the question into no more than four focused search queries unless the user specifies a broader scope.
3. Gather a default of four strong sources and a maximum of eight. Prefer primary sources, official records, original research, and direct documentation.
4. Record each source in the source ledger before synthesizing it.
5. Group equivalent claims, remove duplicate reporting, and distinguish independent evidence from articles that repeat the same origin.
6. Cross-check material claims against a second independent source when available.
7. Resolve conflicts using publication date, source proximity, methodology, and scope. Preserve unresolved disagreement explicitly.
8. Stop searching when the major claims are supported, the source budget is reached, or additional results only repeat existing evidence.
9. Return the answer first, followed by findings, disagreements, limitations, and the compact source ledger.

## Research discipline

- Do not count syndicated copies or articles citing the same original report as independent confirmation.
- Separate observed facts, source claims, and model inference.
- Preserve dates, units, sample sizes, jurisdictions, and definitions that affect comparison.
- Use a narrower claim when the available evidence does not support a broad conclusion.
- Read [references/source-ledger.md](references/source-ledger.md) for the evidence and output contract.

## Boundaries

- Remain read-only and use only provider web search.
- Do not open or interact with browser tabs, sign in, bypass access controls, or download files.
- Do not hide source conflicts or fill evidence gaps with plausible text.
- Stop and report the limitation when primary evidence is unavailable, paywalled, inaccessible, or outside the requested time window.

## Completion

Return concise Markdown with citations beside the claims they support. Include enough source-ledger information for the user to understand why each source was used without reproducing full articles.
