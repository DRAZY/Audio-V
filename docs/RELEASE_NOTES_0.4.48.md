# Audio-V v0.4.48 — Security and update delivery

Audio-V v0.4.48 delivers the November dependency-security remediation and adds
an in-application update path for official releases. Oracle Engine v12 verdict
rules and evidence semantics are unchanged.

## What changed

- Updated Electron, `undici`, `fast-uri`, document/audio libraries, and build
  tooling to patched compatible versions.
- Added update status, schedule, download, and restart controls for official
  GitHub Releases; builds that cannot safely update in place open the official
  release page instead.
- Strengthened release artifact verification, refreshed the defect register,
  and made identity-preference UI verification independent of Settings-card
  order.
- Normalized worker failure events at process boundaries for Node 26 typing
  compatibility.

## Verification

- Dependency audit reports zero known vulnerabilities.
- All 204 automated tests, type checking, production build, accessibility,
  native corpus, Oracle worker, defect, and manual-acceptance checks pass.
- GitHub macOS, Windows, cross-platform parity, dependency review, and CodeQL
  checks passed before release preparation.

## Packages

- `Audio-V-0.4.48-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.48-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.48-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.48-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
