# Source Ledger Contract

Track one entry per independent source origin.

## Fields

| Field | Requirement |
| --- | --- |
| Source | Organization, author, or publisher |
| URL | Direct URL used for the finding |
| Published | Publication or update date when available |
| Source type | Primary, official, research, reporting, or commentary |
| Claim supported | The specific finding this source supports or disputes |
| Independence | Independent origin or derivative of another listed source |
| Confidence | High, medium, or low with a short reason |

## Evidence rules

- Prefer the original document over pages summarizing it.
- Mark a source derivative when it cites or republishes another ledger source.
- Do not use search snippets as final evidence when the underlying source is available.
- Assign high confidence only when the source is authoritative for the claim and its scope matches the question.
- Keep unresolved conflicts as separate ledger entries.

## Output shape

Use this order unless the user requests another format:

1. Direct answer
2. Key findings
3. Conflicts or uncertainty
4. Limitations
5. Compact source ledger

The ledger should be concise. Do not reproduce long quotations or full source text.
