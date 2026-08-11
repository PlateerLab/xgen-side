# Structured Extraction Output Contract

## Required checks

- Every record represents one consistent entity.
- Every requested field is present, even when its value is unavailable.
- Duplicate records are removed only when identity is unambiguous.
- Dates, currencies, and units retain their original context.
- Volatile values include the observed time when available.
- The final result names the source URL and any incomplete page range.

## Missing values

Use `null` in JSON and `Unavailable` in Markdown unless the user specifies another convention. Do not infer missing values from neighboring records.
