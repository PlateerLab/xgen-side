---
name: xgen-xlsx
description: Analyze formulas and data, then edit or create local XLSX workbooks selected by the user.
---
# XLSX workflow

Use this skill only for XLSX files listed in `<attached_files>`.

1. Read the workbook from `attachments/` and preserve the original.
2. Inspect workbook sheets, used ranges, formulas, cached values, styles, tables, merged cells, and drawings as needed.
3. Keep formulas as formulas. Do not replace calculated cells with hard-coded values unless the user explicitly requests it.
4. Write every edited workbook as a new `.xlsx` directly under `artifacts/`.
5. Prefer an installed spreadsheet library. If unavailable, use standard ZIP and XML APIs available on the platform and update worksheet dimensions, shared strings, relationships, and calculations consistently.
6. Verify package integrity, formulas, requested values, and formula error markers before reporting success.
7. Return a concise data summary and the exact artifact filename.
