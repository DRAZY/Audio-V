# Audio-V v0.4.43 — Windows parity and checksum reliability

Audio-V v0.4.43 is a verification-focused release. It closes Windows-specific
test and responsive-layout gaps and corrects sidecar checksum matching when an
audio source is staged from slow, removable, or network storage.

## What changed

- Sidecar checksum entries continue to identify the original source while bytes
  can be read from an optimized staged copy.
- Windows runs the full applicable source suite without depending on Unix-only
  archive commands used by maintainer corpus tooling.
- FFmpeg and SQLite integration tests retain a bounded timeout that accommodates
  valid execution on slower Windows runners without masking deadlocks.
- Responsive comparison controls are checked against the viewport Windows
  actually provides, including mixed-row layouts with no overlap or overflow.
- Repository format documentation now explains container, codec, bitrate mode,
  channel layout, and explicit MP3 channel mode.

## Verification

- Native Windows source verification passes 202 tests; two maintainer-only Unix
  archive-tool cases are intentionally skipped.
- Local verification passes all 204 tests, type checking, production builds,
  accessibility checks, and responsive-layout acceptance.
- The Windows installer and portable executable are built locally and undergo
  package-structure verification before publication.

## Packages

- `Audio-V-0.4.43-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.43-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.43-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.43-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
