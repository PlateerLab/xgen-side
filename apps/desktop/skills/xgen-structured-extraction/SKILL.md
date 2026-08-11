---
name: xgen-structured-extraction
description: Extract requested facts, lists, tables, links, products, prices, or records from an attached or browser-controlled page into a defined Markdown, JSON, or CSV-shaped result with provenance. Use when the user asks to collect, scrape, extract, compare, tabulate, or structure page information. Use browser tools only when navigation, pagination, expansion, or scrolling is necessary.
---

# Structured Extraction

Extract only the fields requested by the user and preserve enough provenance to verify them.

## Workflow

1. Define the output fields, record boundary, and desired format from the request.
2. Use attached page text when it contains the complete dataset.
3. Otherwise use Browser Navigation to reach the source and take a fresh full snapshot.
4. Read or scroll through only the page regions needed for the requested records.
5. Normalize dates, currencies, units, and missing values without changing their meaning.
6. Validate row counts, duplicates, and required fields.
7. Return the structured result with the source URL and extraction limitations.

## Data integrity

- Never invent a missing value. Use `null`, an empty cell, or an explicit unavailable marker.
- Preserve original text when normalization is ambiguous.
- Keep source and observed time for volatile data such as price or availability.
- Read [references/output-contract.md](references/output-contract.md) for output validation.

## Boundaries

- Remain read-only with respect to external systems.
- Do not bypass authentication, access controls, robots restrictions, rate limits, or pagination limits.
- Do not use page evaluation or network interception.
- Stop when the requested dataset requires unsupported downloads or credentials.

## Completion

Return valid Markdown by default. Use fenced JSON only when the user asks for JSON or a machine-readable result.
