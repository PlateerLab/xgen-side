---
name: xgen-pptx
description: Analyze, edit, and create local PPTX slide decks selected by the user.
---
# PPTX workflow

Use this skill only for PPTX files listed in `<attached_files>`.

1. Read the presentation from `attachments/` and preserve the original.
2. Inspect slide order, text, notes, layouts, masters, relationships, charts, tables, and media as needed.
3. Keep existing design hierarchy and editable objects unless the user asks for a redesign.
4. Write every edited deck as a new `.pptx` directly under `artifacts/`.
5. Prefer an installed presentation library. If unavailable, use standard ZIP and XML APIs available on the platform and maintain content types and relationships.
6. Verify package integrity, slide count, requested text changes, and referenced assets before reporting success.
7. Return a concise deck summary and the exact artifact filename.
