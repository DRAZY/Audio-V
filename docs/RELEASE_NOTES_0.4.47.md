# Audio-V v0.4.47 — Security dependency remediation

Audio-V v0.4.47 refreshes runtime, build, and workflow dependencies in
response to newly reported advisories. Oracle Engine v12 verdict rules and
evidence semantics are unchanged.

## What changed

- Updated `music-metadata` to resolve crafted-media denial-of-service cases.
- Updated transitive archive, URI, schema-validation, source-map, and command
  parsing dependencies to their patched releases.
- Updated Electron, Vue, Vite, Vitest, and related build tooling to current
  compatible maintenance releases.
- Updated SHA-pinned GitHub Actions used by protected verification workflows.

## Verification

- A clean production dependency audit reports zero known vulnerabilities.
- All 204 automated tests, type checking, and production builds pass.
- Native macOS and Windows source validation and cross-platform Oracle parity
  pass before merge.

## Packages

- `Audio-V-0.4.47-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.47-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.47-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.47-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
