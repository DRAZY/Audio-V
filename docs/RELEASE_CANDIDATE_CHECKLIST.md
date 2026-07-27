# Audio-V release-candidate acceptance

A release candidate is evidence-backed, not simply a successful packaging command.

## Automated acceptance

- [ ] `npm ci` completes from the lockfile.
- [ ] Bundled engine provenance and LGPL configuration verify.
- [ ] TypeScript and Vue type checks pass.
- [ ] All unit, integration, scanner, worker, repair, report, storage, and diagnostics tests pass.
- [ ] Fidelity golden-corpus validation passes.
- [ ] Real-world corpus infrastructure and packaged validation disclosure verify.
- [ ] Accessibility audit has no serious or critical violations.
- [ ] Scale budgets pass for 100, 1,000, and 10,000 records.
- [ ] Production dependency audit reports zero known vulnerabilities.
- [ ] Apple Silicon DMG, Universal DMG, Windows installer, and Windows portable artifacts pass structural inspection.
- [ ] Native packaged applications complete the reference FLAC audit.
- [ ] macOS and Windows Oracle snapshots agree within declared tolerances.
- [ ] Artifact checksums and unsigned-release manifest agree.
- [ ] Tag, package version, AGPL license, source offer, CLA, and trademark policy verify.

## Manual clean-environment acceptance

- [ ] Apple Silicon DMG install, first launch, audit, report export, and removal tested on a clean supported macOS user account.
- [ ] Universal DMG launches natively on Intel macOS and Apple Silicon macOS.
- [ ] Windows installer install, custom location, first launch, audit, report export, upgrade, uninstall, and retained-data behavior tested on a clean supported Windows VM.
- [ ] Windows portable build runs without installation and documents its per-user state.
- [ ] Keyboard-only Audit, Compare, Repair, Reports, Settings, dialogs, and history workflows completed.
- [ ] VoiceOver on macOS and Narrator on Windows can identify navigation, status, result rows, tabs, controls, evidence, and report actions.
- [ ] 100%, 125%, 150%, and 200% display scaling checked without clipped primary actions.
- [ ] Long filenames, Unicode paths, removable media, read-only sources, unavailable volumes, corrupt files, and cancellation under load checked.
- [ ] Upgrade and rollback do not corrupt the SQLite session database.
- [ ] Unsigned warning instructions and SHA-256 verification checked against current operating-system behavior.

## Policy waivers

Code signing and notarization are not release-candidate requirements while the official project policy remains unsigned open-source development distribution. Their absence must be explicit in the build log, manifest, release notes, and installation guide.

Statistically calibrated provenance probability is not claimed. The release must retain conservative rule-strength, evidence-coverage, and inconclusive language until a representative real-music corpus exists.

The Settings validation card and exported origin limitations must agree with `build/real-world-validation-latest.json`. A development release may report `awaiting-source-masters`, but it must not imply that synthetic fixtures are independent real-world evidence.
