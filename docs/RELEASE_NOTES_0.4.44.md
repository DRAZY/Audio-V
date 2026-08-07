# Audio-V v0.4.44 — Repository and build-chain hardening

Audio-V v0.4.44 removes the reported dependency vulnerability debt and places
the public source repository behind the same verification discipline used for
release packages. The application’s Oracle methodology and user-facing verdict
behavior are unchanged.

## What changed

- Patched the transitive build dependencies `fast-uri`, `brace-expansion`, and
  `js-yaml`; full and production-only npm audits now report zero findings.
- Updated Audio-V’s CommonJS compatibility adapter for the secured
  `brace-expansion` release.
- Added weekly grouped Dependabot maintenance for npm and GitHub Actions.
- Added pull-request dependency review that rejects new high or critical
  vulnerabilities in runtime or development scopes.
- Upgraded GitHub Actions and pinned every workflow reference to an immutable
  commit SHA.
- Protected `main` from direct, force, and deletion pushes and required native
  Windows, native macOS, Oracle parity, and dependency-review checks.
- Enabled CodeQL default analysis, secret protection, push protection, and
  private vulnerability reporting for the public project.

## Verification

- Clean `npm ci` installation completes with the patched dependency graph.
- `npm audit` and `npm audit --omit=dev` report zero vulnerabilities.
- Local source, build, UI, release-policy, corpus, and package checks pass.
- Native Windows and macOS verification plus cross-platform Oracle parity pass
  on the protected pull request.

## Packages

- `Audio-V-0.4.44-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.44-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.44-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.44-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source release. Verify package checksums and
> follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
