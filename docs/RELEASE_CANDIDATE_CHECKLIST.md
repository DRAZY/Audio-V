# Audio-V release-candidate acceptance

A release candidate is evidence-backed, not simply a successful packaging command.

## Current readiness snapshot

As of source version 0.4.34:

| Area | Current evidence | RC meaning |
|---|---|---|
| Source regression | 162 tests passed | Automated source behavior is green |
| Build and UI | Type checks, production build, responsive-layout checks, and 41 accessibility rules passed | Repository-level UI gate is green |
| Scale storage | 10,000-record persistence completed in 6.95 seconds; restore completed in 485 ms; cumulative 11,100-record database was 458.4 MB (437.1 MiB) | Synthetic dense-evidence storage budget is green |
| macOS packages | Apple Silicon and Universal DMGs passed structure/signature checks; native Apple Silicon packaged reference audit passed | Current development Mac evidence is green |
| Windows packages | Installer and portable package structure and bundled resources passed macOS-side inspection | Native Windows launch and workflow acceptance remain open |
| Real-library scale | Maintainer witnessed a completed full audit of at least 6,000 files | Completion is established; platform, version, timing, memory, and final database size were not captured |
| Blocking defects | Versioned register contains one fixed P1 and zero unresolved P0/P1 defects | Known critical/high defects block release automatically |
| Release assets | Four v0.4.34 application packages, checksums, block maps, and unsigned policy manifest were prepared and verified locally | Preview distribution is ready for publication |
| Instrumented acceptance | Every real audit records privacy-safe package, workload, throughput, sampled memory, storage growth, cancellation, source class, and recovery evidence | Clean-machine and real-library witnessing can now be reproduced instead of described from memory |
| Real-world origin calibration | Infrastructure is valid; licensed independent masters are absent | No probability-calibrated origin claim is allowed |

The automated readiness command reports 17/17 repository evidence categories,
but Audio-V is **not yet promoted as a release candidate**. Native Windows
runtime/parity, Intel launch, clean-environment installation and upgrade,
assistive-technology workflows, display scaling, and instrumented real-library
performance remain manual acceptance work.

## Automated acceptance

- [ ] `npm ci` completes from the lockfile.
- [ ] Bundled FFmpeg, C2PA Tool, and Chromaprint provenance, licenses, hashes, versions, and offline settings verify.
- [ ] TypeScript and Vue type checks pass.
- [ ] All unit, integration, scanner, worker, repair, report, storage, and diagnostics tests pass.
- [ ] Fidelity golden-corpus validation passes.
- [ ] Real-world corpus infrastructure and packaged validation disclosure verify.
- [ ] Accessibility audit has no serious or critical violations.
- [ ] Left, right, and L−R channel selections each repaint a fully populated spectrogram canvas without requiring a Floor, zoom, or color control change.
- [ ] Compare restores compact session records into independent File A and File B waveform/spectrum evidence, paints difference and residual panels, and never leaves a stale canvas.
- [ ] AcoustID enablement, protected key presence, and MusicBrainz enablement restore after relaunch; clearing the key removes it without plaintext fallback.
- [ ] Delivery profiles persist with the session, switch cleanly across cache reuse, preserve their exact references and limits in reports, and never convert delivery nonconformance into Failed.
- [ ] CD-database eligibility requires complete CD-frame-aligned whole-disc context and never appears as a CTDB/AccurateRip match without an actual database verification result.
- [ ] MQA-related text/profile markers remain unauthenticated provenance inventory and never imply proprietary unfolding.
- [ ] Latest acceptance evidence renders and exports without filenames, paths, hashes, tags, audio evidence, or service credentials.
- [ ] Scale budgets pass for 100, 1,000, and 10,000 records.
- [ ] The defect register matches the package version and contains no unresolved P0/P1 defects.
- [ ] Maintainer acceptance evidence validates and states every uncaptured measurement.
- [ ] Packaged CLI folder audit emits the v11 five-lane JSON evidence model, honors evidence-policy and native resource limits, and does not persist external-service keys.
- [ ] Production dependency audit reports zero known vulnerabilities.
- [ ] Apple Silicon DMG, Universal DMG, Windows installer, and Windows portable artifacts pass structural inspection.
- [ ] Both macOS app bundles have valid whole-bundle ad-hoc signatures, no Developer ID identity, and remain valid after quarantine metadata is applied.
- [ ] Native packaged applications complete the reference FLAC audit.
- [ ] Packaged reference audits emit completed acceptance evidence with nonzero resource samples and no source path leakage.
- [ ] macOS and Windows Oracle snapshots agree within declared tolerances.
- [ ] Artifact checksums and unsigned-release manifest agree.
- [ ] Tag, package version, AGPL license, source offer, CLA, and trademark policy verify.

## Manual clean-environment acceptance

- [ ] Apple Silicon DMG install, first launch, audit, report export, and removal tested on a clean supported macOS user account.
- [ ] Universal DMG launches natively on Intel macOS and Apple Silicon macOS.
- [ ] Windows installer install, custom location, first launch, audit, report export, upgrade, uninstall, and retained-data behavior tested on a clean supported Windows VM.
- [ ] Windows portable build runs without installation and documents its per-user state.
- [ ] Keyboard-only Audit, Identity, Compare, Repair, Reports, Settings, dialogs, and history workflows completed.
- [ ] VoiceOver on macOS and Narrator on Windows can identify navigation, status, result rows, tabs, controls, evidence, and report actions.
- [ ] 100%, 125%, 150%, and 200% display scaling checked without clipped primary actions.
- [ ] Long filenames, Unicode paths, removable media, read-only sources, unavailable volumes, corrupt files, and cancellation under load checked.
- [ ] Upgrade and rollback do not corrupt the SQLite session database.
- [ ] macOS unknown-developer “Open Anyway” and Windows unsigned-warning instructions plus SHA-256 verification checked against current operating-system behavior.

## Policy waivers

Developer ID/Authenticode certificate signing and Apple notarization are not release-candidate requirements while the official project policy remains open-source development distribution. macOS ad-hoc integrity signing is required; the absence of trusted identities and notarization must remain explicit in the build log, manifest, release notes, and installation guide.

Statistically calibrated provenance probability is not claimed. The release must retain conservative rule-strength, evidence-coverage, and inconclusive language until a representative real-music corpus exists.

The Settings validation card and exported origin limitations must agree with `build/real-world-validation-latest.json`. A development release may report `awaiting-source-masters`, but it must not imply that synthetic fixtures are independent real-world evidence.
