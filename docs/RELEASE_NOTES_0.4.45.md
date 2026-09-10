# Audio-V v0.4.45 — Dependency security and durable Windows provisioning

Audio-V v0.4.45 refreshes the desktop build chain after newly published
dependency advisories while preserving Oracle Engine v12 verdict behavior. It
also makes clean Windows builds reproducible again by replacing an expired
daily FFmpeg archive with a retained, checksum-pinned month-end LGPL build.

## What changed

- Upgraded Electron to 44.3.0, replacing the vulnerable `extract-zip`
  dependency with `@electron-internal/extract-zip` 1.0.5.
- Upgraded Vitest and `@vitest/mocker` to 4.1.11.
- Resolved the patched `@xmldom/xmldom` 0.8.15, `fast-uri` 3.1.6, `joi`
  18.2.5, and `js-yaml` 4.3.2 releases.
- Raised the documented Node.js development minimum to 22.12.0 to match the
  updated Electron toolchain.
- Changed clean Windows engine provisioning to BtbN's retained
  `autobuild-2026-08-31-13-27` FFmpeg n8.1 LGPL static package.
- Pinned and independently verified the Windows archive, `ffmpeg.exe`, and
  `ffprobe.exe` SHA-256 values.

## Security and verification

- Full and production-only npm audits report zero known vulnerabilities.
- Dependency Review and CodeQL checks pass.
- Native Windows and native macOS correctness checks pass.
- Cross-platform Oracle snapshots agree within the project's declared
  tolerances.
- The versioned defect register contains zero unresolved P0 or P1 defects.
- The Oracle Engine methodology and Clear, Review, and Failed criteria are
  unchanged in this maintenance release.

## Packages

- `Audio-V-0.4.45-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.45-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.45-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.45-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
