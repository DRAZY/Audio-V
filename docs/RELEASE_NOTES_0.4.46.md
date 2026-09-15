# Audio-V v0.4.46 — Runtime and validation dependency refresh

Audio-V v0.4.46 consolidates five overlapping routine dependency updates into
one tested release. Oracle Engine v12 verdict rules and evidence semantics are
unchanged.

## What changed

- Updated docx to 9.7.1 for current Word report-generation fixes.
- Updated JSZip to 3.10.2 and Vue to 3.5.42.
- Updated the accessibility validator to axe-core 4.13.0.
- Updated Vue type checking to vue-tsc 3.3.11.
- Updated the test runner to the Vitest 5 line.
- Aligned Audio-V's declared Node.js development range with the runtimes
  supported by Vitest 5. Release verification continues to use Node.js 22.

## Verification

- Clean installation and both npm security audits report zero vulnerabilities.
- All 204 automated tests pass under supported Node.js 22.
- Type checking, production builds, accessibility, responsive layout,
  spectrogram, comparison, identity, corpus, format, Oracle worker, CLI,
  defect, and release-candidate gates pass.
- Native Windows and macOS correctness plus cross-platform Oracle parity are
  required before merge.

## Packages

- `Audio-V-0.4.46-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.46-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.46-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.46-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
