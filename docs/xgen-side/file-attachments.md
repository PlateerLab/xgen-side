# Local document attachments

XGEN Side supports user-selected DOCX, XLSX, PPTX, and PDF files in general chat. The implementation follows the same visible pattern observed in Aside: file chips appear before sending, the run shows `Read` and format-specific Skill activity, and generated files return as result cards that can be opened or revealed locally.

## Observed Aside flow

The live Aside test used synthetic files with no credentials or sensitive data. The captured sequence is stored under `.audit/aside-file-flow-2026-08-14/screenshots/aside/`.

1. The composer attachment menu offers file upload and folder attachment.
2. macOS presents the native file picker with Quick Look previews for DOCX, PPTX, and PDF.
3. Selected files become compact chips containing filename and format.
4. After sending, the user message groups multiple attached files behind a `See all` control.
5. Aside emits one `Read <filename>` activity for each input and one format-specific Skill activity such as `Used XLSX skill`.
6. The run expands local command activity and errors inline. A right-side panel is reserved for opening a file preview.
7. Aside is designed to return generated files to the chat, but the captured live runs did not reach a verified final artifact before macOS locked. XGEN uses a per-session `artifacts` directory to make that output boundary explicit and testable.

The live DOCX run also exposed an Aside runtime defect: `python` was missing and `python3` did not include `python-docx`. Aside recovered with direct ZIP and XML processing, but the fallback initially generated malformed XML and required another repair pass. XGEN therefore treats installed document libraries as optional and makes package integrity verification mandatory after every fallback edit.

## XGEN trust boundary

- The renderer never receives an arbitrary local path. Electron main opens the operating-system picker and returns an opaque attachment ID plus filename, format, and size.
- Only DOCX, XLSX, PPTX, and PDF are accepted. Files are limited to 50 MB each and validated by extension, container signature, OOXML content markers, and PDF signature as applicable.
- Electron main copies each selected file into a private inbox. The provider receives a read-only copy under the isolated run workspace at `attachments/`.
- The inbox copy is removed after successful materialization. Abandoned staged items are removed after 24 hours on the next app start.
- The provider is instructed to treat document content as untrusted data and never as agent instructions.
- Source attachments are never overwritten. Requested outputs must be new files directly under `artifacts/`.
- Only verified DOCX, XLSX, PPTX, and PDF artifacts of at most 100 MB are returned to the renderer.
- Artifact open and reveal requests are resolved in Electron main and rejected if path traversal leaves the session artifact directory.
- Passwords and provider tokens are never inserted into document context. This file path is independent from the encrypted browser credential vault.

## Cross-platform execution

The renderer, IPC contracts, staging rules, Skill routing, session layout, and result cards are shared across macOS and Windows. Format Skills prefer installed libraries and use platform standard ZIP and XML APIs as a fallback. macOS may use `python3` standard-library modules. Windows may use PowerShell and .NET compression and XML APIs. Platform-specific commands stay inside Skill instructions and provider execution rather than creating separate product implementations.

Electron remains appropriate for this milestone because native dialogs, filesystem mediation, result opening, and Chromium coexist in one signed desktop package. Replacing Electron is not justified by file attachments alone. The replacement decision remains tied to the signed release, memory, update, crash, accessibility, and browser-host gates in `electron-exit-criteria.md`.
