# Audio-V release workflow

Audio-V follows the Deemix Remastered distribution model: installers are built and verified on maintainer-controlled machines, written to the ignored `release/` directory, and uploaded directly to a release named for the exact version. GitHub does not build or publish Audio-V binaries.

Routine source commits do not require a release. A development checkpoint that
is distributed for user testing receives an exact version, tag, GitHub
prerelease, four matching application packages, checksum manifest, unsigned
policy manifest, and direct README links. The current line uses `v0.4.x`
development releases.

A true release candidate is a deliberate promotion after the automated and
manual acceptance evidence in
[`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) is complete
or explicitly waived. Use a semantic prerelease version such as
`v0.5.0-rc.1`, the title **Audio-V 0.5.0 Release Candidate 1**, and GitHub’s
prerelease flag. “Release candidate” describes readiness; GitHub’s
“prerelease” flag prevents it from being mistaken for the final stable
release. The README must name the exact promoted version and link all four
primary assets directly; a generic Releases link alone is insufficient.

`.github/workflows/verify.yml` is an optional, manual-only cross-platform verification workflow. It runs only when a maintainer explicitly dispatches it and is not triggered by pushes, pull requests, or tags. This prevents the private repository from consuming GitHub-hosted runner allowance during normal development and publication.

## Local verification

```bash
npm ci
npm run provision:engines # required on a clean checkout
npm run verify
npm run validate:platform
npm run verify:release-policy
```

## Local macOS packages

```bash
# Optional: inject the registered Audio-V application client identity without
# writing it to source control.
export AUDIO_V_ACOUSTID_CLIENT_KEY="XXXXXXXXXX"
npm run dist:mac
```

This creates a native Apple silicon DMG plus a Universal DMG containing both Intel and Apple silicon application and Oracle Engine binaries. Audio-V does not publish a standalone Intel DMG.

The development command disables certificate discovery, notarization, and Hardened Runtime, then signs each complete app bundle with the ad-hoc pseudo-identity `-`. This supplies a valid resource seal without claiming a Developer ID identity. `npm run verify:artifacts:mac` requires the ad-hoc signature, validates the complete nested-code seal, rejects certificate identities, and checks both packages, embedded resources, permission declarations, and Universal Mach-O architectures.

See [Unsigned installation](UNSIGNED_INSTALLATION.md) for checksum verification and the per-application macOS approval process.

## Local Windows packages

Run on Windows:

```powershell
npm ci
$env:AUDIO_V_ACOUSTID_CLIENT_KEY = "XXXXXXXXXX" # optional official client identity
npm run dist:win
```

This produces an intentionally unsigned x64 NSIS installer and x64 portable executable. `signExecutable=false` is explicit, so the unsigned status is reproducible rather than dependent on missing credentials. `npm run verify:artifacts:win` checks PE signatures, package size, the unpacked application, and required engine resources. On a Windows runner it also confirms that Authenticode status is `NotSigned`.

Build and launch-test Windows packages on a maintainer-controlled Windows installation or VM before publication. Cross-building from macOS is acceptable when the local Electron Builder toolchain succeeds, but structural inspection on macOS does not replace first-launch and packaged-runtime acceptance on Windows.

`prepare:release` writes the optional client identity to the ignored
`build/external-services.json` resource. The value must be the 10-character key
for the registered Audio-V AcoustID application. It is never committed. Omit
the environment variable for a development/fork package that should require a
session-only user key. Artifact verification must confirm the Settings service
status matches the intended release configuration.

## Version and publish

1. Update the version without creating the tag:

   ```bash
   npm version patch --no-git-tag-version
   ```

2. Commit and push the verified source and version metadata.
3. Produce and inspect the four local packages:

   ```bash
   npm run dist:mac
   npm run verify:artifacts:mac
   npm run verify:runtime:mac
   npm run dist:win
   npm run verify:artifacts:win
   npm run release:checksums
   npm run release:manifest
   npm run verify:release-candidate
   (cd release && shasum -a 256 -c SHA256SUMS.txt)
   ```

4. Complete the applicable clean-environment checks in `docs/RELEASE_CANDIDATE_CHECKLIST.md`.
5. Create and push an annotated matching tag:

   ```bash
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "v${VERSION}" -m "Audio-V v${VERSION}"
   git push origin main "v${VERSION}"
   ```

6. Create the version-named release and upload the exact locally verified assets:

   ```bash
   gh release create "v${VERSION}" \
     --repo DRAZY/Audio-V \
     --prerelease \
     --title "Audio-V v${VERSION}" \
     --generate-notes \
     "release/Audio-V-${VERSION}-mac-arm64.dmg" \
     "release/Audio-V-${VERSION}-mac-arm64.dmg.blockmap" \
     "release/Audio-V-${VERSION}-mac-universal.dmg" \
     "release/Audio-V-${VERSION}-mac-universal.dmg.blockmap" \
     "release/Audio-V-${VERSION}-win-x64.exe" \
     "release/Audio-V-${VERSION}-win-x64.exe.blockmap" \
     "release/Audio-V-Portable-${VERSION}-x64.exe" \
     "release/SHA256SUMS.txt" \
     "release/UNSIGNED_RELEASE_MANIFEST.json"
   ```

## Maintainer synchronization policy

For maintainer-directed work, verified source is synchronized when its commit is
pushed to `main`. Documentation-only commits do not require rebuilding
unchanged application packages. A source or packaged-runtime change that is
distributed to testers receives a new development version and four matching
packages; local current-version artifacts are retained until their upload is
confirmed. Once the maintainer promotes a release candidate, its semantic
version, tag, package metadata, README links, and assets must match; applicable
native correctness, packaged-runtime verification, and release-candidate
checks must pass before upload.

GitHub Releases preserve meaningful published test versions as the project’s
distribution record while the repository is private. Before public launch, the
maintainer may remove superseded private-development previews and retain the
first release candidate plus later promoted versions. The local ignored
`release/` directory is a current-build workspace, not an archive. After a
release succeeds:

1. Download the exact published assets for the current version.
2. Verify `SHA256SUMS.txt` against all four application packages.
3. Remove older-version installers, portable executables, DMGs, block maps, update metadata, and unpacked staging directories from local `release/`.
4. Retain only the current Apple Silicon DMG, Universal DMG, Windows installer, Windows portable executable, available block maps, `SHA256SUMS.txt`, and `UNSIGNED_RELEASE_MANIFEST.json`.

This prevents stale local binaries from being confused with the source version while keeping reproducible historical downloads in GitHub.

The local packaging commands provision engines before packaging. macOS builds FFmpeg 8.1.2 from the checksum-pinned official source with GPL/nonfree features disabled; Windows downloads the immutable, checksum-pinned BtbN `autobuild-2026-07-26-13-28` n8.1 LGPL static build. They also download checksum-pinned C2PA Tool 0.27.3 and Chromaprint fpcalc 1.6.0 archives from their official releases, write offline C2PA policy and license files into every target engine directory, and verify their executable hashes. `prepare:engines` blocks packaging when provenance, licensing policy, versions, or offline settings disagree.

## Headless automation

After `npm ci` and `npm run provision:engines`, CI or archival workflows can produce the same compact JSON evidence model without starting Electron:

```bash
npm run cli -- ./collection --output ./audio-v-evidence.json --concurrency 2 --memory-mb 256 --fail-on failed
```

`--fail-on review` makes Review or Failed evidence return exit code 2; `--fail-on failed` reserves exit code 2 for deterministic file failures. CLI errors return exit code 1. External AcoustID lookup remains opt-in.

## Release policy

- Commit source, configuration, artwork, and lockfiles.
- Do not commit `release/`, `dist/`, or `dist-electron/`.
- macOS development app bundles are ad-hoc signed without a Developer ID identity; Windows artifacts remain unsigned until the maintainer explicitly adopts certificate signing.
- Test installation, first launch, analysis, upgrade, uninstall, and portable behavior on clean operating-system environments before promoting a prerelease.
- Publish SHA-256 checksums and the unsigned policy manifest with every binary release.
- `scripts/verify-release-policy.mjs --public` blocks a tag whose version does not match `package.json` or whose repository lacks a project license.
- Audio-V code uses `AGPL-3.0-only`. Contributions require the repository CLA acknowledgement; official names and artwork remain governed by `TRADEMARKS.md`.

## Optional future signing

Signing is not required by the current project policy, but the configuration keeps a credential-driven path ready:

```bash
npm run dist:mac:signed
npm run dist:win:signed
```

The signed macOS path enables Hardened Runtime and Electron Builder notarization. It requires an Apple Developer Program membership, Developer ID Application certificate, and Apple notarization credentials. The signed Windows path accepts standard Electron Builder Authenticode credentials. The local process environment or an external secret manager—not repository files—must supply every credential.

After a future signing change, extend the artifact checks to require a valid Developer ID/notarization ticket or Authenticode signature before publishing signed builds.
