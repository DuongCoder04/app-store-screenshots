# Bug bash — 2026-09-29

Covered the editor UI, canvas interactions, persistence, uploads, exports, local APIs, and the documented project migration. Tests ran against disposable project copies in Google Chrome, including a production `next start` server. Existing project files and `promo/` were left untouched.

## Fixed findings

| Reproduction / failure | Fix |
| --- | --- |
| Open two editor tabs and save different changes; a stale tab can replace newer work. | Revision-based conditional saves, serialized compare/write, and a visible conflict message. |
| A save fails, or the page closes before the debounce completes. | Explicit retry, bounded requests, and an unsaved-changes warning. Newer queued edits retain the revision returned by an older in-flight save. |
| Upload truncated PNG/JPEG data with valid magic bytes, malformed base64, or truncated font containers. | Full image decoding, strict base64, font container bounds, and browser font decoding before import. |
| Send oversized or chunked request bodies, malformed project elements, duplicate IDs, or unsupported schemas. | Streaming body limits and stronger project validation before any write. |
| An upload is rejected by the API, but the picker installs the same image as an inline fallback. | Explicit rejections preserve the previous screenshot and display the error. |
| Two imports complete out of order, or an image's dimensions arrive after a replacement. | Request generation checks prevent stale results replacing newer choices. |
| Upload assets after starting a production server; the upload succeeds but the URL returns 404. | Runtime image/font serving routes preserve existing URLs and restrict filenames/extensions. Writes are atomic. |
| A corrupt image returns HTTP 200, or an asset request never completes. | Decode checks, bounded preloading, visible failures, and retry during export. |
| PNG workers throw, cannot deserialize messages, or never respond. | Retire failed workers and finish encoding inline. |
| One screen's PNG encoding rejects while the previous screen is still encoding. | Attach rejection handlers immediately to prevent uncaught errors and incomplete accounting. |
| An imported font never finishes loading during export. | Bounded font loading releases the editor with an actionable error. |
| Narrow viewports shrink the canvas to an unusable strip. | Scrollable stacked panels and a usable canvas height below the desktop breakpoint. Verified at 320, 390, 820, 1024, and 1440 px. |
| Duplicate/delete controls disappear on touch tablets. | Keep slide actions visible without hover. |
| Press Escape while editing an overlay's font size; the canceled value still applies. | Cancel the draft before blur can commit it. |
| Leave the two-device layout and return; the secondary screenshot is lost. | Preserve the chosen secondary screenshot across layout switches. |
| Pan at the default zoom, then click Fit active screen; nothing happens. | Explicitly recenter even when the zoom value does not change. |
| Keyboard focus reaches an image but its inspector stays closed. | Focusing the rotation control selects its element. Added accessible names to related inspector fields. |
| A notification covers Undo; changing fade direction resets a strength of zero. | Move notifications away from toolbar controls and preserve zero fade strength. |
| Run the documented migration on null or duplicate overlays. | Sanitize legacy values and ensure unique overlay IDs without dereferencing null. |

## Verification

- `scripts/bug-bash.cjs`: 35 browser regression groups. Covers real image/font upload → reload → export, concurrent tabs, failure injection, exported PNG dimensions for every device, locale output, connected crops, RTL, history, reset, and export locking.
- `scripts/ui-bug-bash.cjs`: 12 UI interaction groups, including 67 device/layout/orientation combinations; pointer drag/resize, keyboard reorder, rotation, layers, deletion/undo, empty states, backgrounds, themes/fonts, responsive widths, and touch controls.
- `scripts/api-bug-bash.cjs`: 9 API regression groups, including concurrent saves/uploads, origin/content-type checks, chunked limits, asset traversal rejection, real PNG/JPEG/WOFF2 round-trips, and execution of the documented migration.
- Production build (including TypeScript checking) and `git diff --check` passed.
- Reproduction commands are in [CONTRIBUTING.md](CONTRIBUTING.md). Run against a disposable copy; API and upload checks write its project/assets.

## Scope limits

This is a broad regression pass, not proof that every possible failure is eliminated. Browser coverage is Google Chrome; touch checks use Chrome emulation. The local API still assumes one server process. CLI callers that omit `If-Match` retain unconditional replacement behavior. Font API validation checks container structure; full font decoding is additionally checked by the editor's browser.
