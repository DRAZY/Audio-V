# Audio-V release workflow

Audio-V keeps generated installers out of git history. Local builds are written to the ignored `release/` directory. Tagged builds are attached to the corresponding GitHub Release by `.github/workflows/release.yml`.

## Local verification

```bash
npm ci
npm run provision:engines # required on a clean checkout
npm run prepare:release
npm run build
npm test
npm audit --omit=dev
npm run validate:platform
npm run verify:release-policy
```

## Local macOS packages

```bash
npm run dist:mac
```

This creates an intentionally unsigned native Apple silicon DMG plus an intentionally unsigned Universal DMG containing both Intel and Apple silicon application and Oracle Engine binaries. Audio-V does not publish a standalone Intel DMG.

The unsigned command explicitly disables identity discovery, notarization, and Hardened Runtime. This avoids accidentally producing different artifacts on a developer machine that happens to contain a signing identity. `npm run verify:artifacts:mac` checks both packages, embedded resources, and Universal Mach-O architectures.

See [Unsigned installation](UNSIGNED_INSTALLATION.md) for checksum verification and the per-application macOS approval process.

## Local Windows packages

Run on Windows:

```powershell
npm ci
npm run dist:win
```

This produces an intentionally unsigned x64 NSIS installer and x64 portable executable. `signExecutable=false` is explicit, so the unsigned status is reproducible rather than dependent on missing credentials. `npm run verify:artifacts:win` checks PE signatures, package size, the unpacked application, and required engine resources. On a Windows runner it also confirms that Authenticode status is `NotSigned`.

Cross-building Windows packages from macOS may work when the required compatibility tools are installed, but the supported and reproducible path is the Windows GitHub Actions runner.

## Version and publish

1. Update the version without creating the tag:

   ```bash
   npm version patch --no-git-tag-version
   ```

2. Commit the source and version metadata.
3. Create and push a matching tag:

   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

The tag starts independent macOS and Windows builds. Each runner executes the full verification suite, fidelity corpus, platform snapshot, package build, and artifact inspection. A parity job compares deterministic identities and measurements within documented tolerances before publication.

The workflow attaches the `.dmg` and `.exe` files, block maps, `SHA256SUMS.txt`, and `UNSIGNED_RELEASE_MANIFEST.json` to the versioned GitHub Release.

The release workflow provisions engines before packaging. macOS builds FFmpeg 8.1.2 from the checksum-pinned official source with GPL/nonfree features disabled; Windows downloads the immutable, checksum-pinned BtbN `autobuild-2026-07-26-13-28` n8.1 LGPL static build. It also downloads checksum-pinned C2PA Tool 0.27.3 and Chromaprint fpcalc 1.6.0 archives from their official releases, writes offline C2PA policy and license files into every target engine directory, and verifies their executable hashes. `prepare:engines` blocks packaging when provenance, licensing policy, versions, or offline settings disagree.

## Headless automation

After `npm ci` and `npm run provision:engines`, CI or archival workflows can produce the same compact JSON evidence model without starting Electron:

```bash
npm run cli -- ./collection --output ./audio-v-evidence.json --concurrency 2 --memory-mb 256 --fail-on failed
```

`--fail-on review` makes Review or Failed evidence return exit code 2; `--fail-on failed` reserves exit code 2 for deterministic file failures. CLI errors return exit code 1. External AcoustID lookup remains opt-in.

## Release policy

- Commit source, configuration, artwork, and lockfiles.
- Do not commit `release/`, `dist/`, or `dist-electron/`.
- Builds are unsigned by project policy until the maintainer explicitly adopts signing.
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

The signed macOS path enables Hardened Runtime and Electron Builder notarization. It requires an Apple Developer Program membership, Developer ID Application certificate, and Apple notarization credentials. The signed Windows path accepts standard Electron Builder Authenticode credentials. CI secrets—not repository files—must supply every credential.

After a future signing change, extend the artifact checks to require a valid Developer ID/notarization ticket or Authenticode signature before publishing signed builds.
