# Audio-V v0.4.50 — In-app updates that install themselves

Audio-V v0.4.50 fixes in-app updating on macOS. Oracle Engine v12 verdict
rules and evidence semantics are unchanged.

## What changed

- Fixed signed macOS builds being treated as unsigned. The updater checked
  the app's Developer ID signature by reading `codesign` output from the wrong
  stream, so every signed Mac build showed **Get the update** and opened the
  release page instead of updating itself.
- **Update now** now downloads the update and restarts into the new version
  by itself. If an audit is running, it waits and shows **Restart and
  install** so the audit is never cut off.
- If an in-place update fails, Audio-V keeps running, shows the error, and
  offers the release page instead.
- Update checks and install steps are written to the application log.

## Updating to this version

0.4.48 and 0.4.49 cannot update themselves to this release, because the bug
is in the copy that is already installed. Download 0.4.50 by hand once and
replace the app. From 0.4.50 on, new releases show a notice with **Update
now** and **Skip this version**, and **Update now** installs and restarts by
itself on signed macOS builds and the Windows installer. The Windows
portable build opens the release page.

## Verification

- Dependency audit reports zero known vulnerabilities.
- All 214 automated tests, type checking, production build, accessibility,
  responsive layout, update notice, native corpus, Oracle worker, defect, and
  manual-acceptance checks pass.
- End-to-end: a Developer-ID-signed 0.4.50 test build found a newer signed
  build on a local feed, downloaded it, and Squirrel.Mac replaced and
  relaunched the app as the newer version.
- GitHub macOS, Windows, cross-platform parity, dependency review, and CodeQL
  checks passed before release preparation.

## Packages

- `Audio-V-0.4.50-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.50-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.50-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.50-x64.exe` — Windows portable

Both macOS DMGs, and the app inside them, are signed with the DRAZY Developer
ID and notarized by Apple. Windows builds are still unsigned. Verify package
checksums with `SHA256SUMS.txt` and follow `docs/UNSIGNED_INSTALLATION.md` for
Windows first-launch steps.
