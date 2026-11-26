# Audio-V v0.4.49 — Electron 45 and dependency maintenance

Audio-V v0.4.49 moves the desktop runtime to Electron 45 and brings the
November dependency updates. Oracle Engine v12 verdict rules and evidence
semantics are unchanged.

## What changed

- Updated Electron from 44.11.5 to 45.4.1.
- Updated Vue to 3.5.46 and the `concurrently` development tool to 10.0.7.
- Updated the dependency-review GitHub Action to 5.0.1.
- New update notice: when a newer release is found, a notice in the corner
  of the window offers **Update now** or **Skip this version**. Skipping hides
  the notice for that version until a newer one comes out; the close button
  hides it until the next launch. Settings still lists every available update.
- Fixed the update check's version comparison. It compared each part of the
  version on its own, so a newer install could be offered an older release
  (0.5.0 would have seen 0.4.49 as an update). It now compares versions in
  order and ranks a release above its own prereleases.
- The Windows portable build now opens the release page for updates instead
  of starting an in-place download that cannot replace a portable executable.
- Made the responsive-layout check wait for each window resize to reach the
  renderer before measuring, instead of sleeping a fixed 80 ms. The fixed
  sleep could measure the previous layout on slower machines.
- Approved the `electron-winstaller` install script, which selects the 7-Zip
  binary used to build the Windows installer.

## Updating

This is the first release that installed copies of 0.4.48 can update to from
inside the app (signed macOS builds and the Windows installer). 0.4.48 does
not have the new notice, so open **Settings › Application updates** and choose
**Update now** there; from 0.4.49 on, the notice appears by itself. The
Windows portable build, and anyone on 0.4.47 or earlier, should download it
by hand.

## Verification

- Dependency audit reports zero known vulnerabilities.
- All 209 automated tests, type checking, production build, accessibility,
  responsive layout, native corpus, Oracle worker, defect, and
  manual-acceptance checks pass.
- GitHub macOS, Windows, cross-platform parity, dependency review, and CodeQL
  checks passed before release preparation.

## Packages

- `Audio-V-0.4.49-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.49-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.49-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.49-x64.exe` — Windows portable

Both macOS DMGs, and the app inside them, are signed with the DRAZY Developer
ID and notarized by Apple. Windows builds are still unsigned. Verify package
checksums with `SHA256SUMS.txt` and follow `docs/UNSIGNED_INSTALLATION.md` for
Windows first-launch steps.
