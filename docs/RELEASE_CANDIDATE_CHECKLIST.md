# Audio-V release-candidate acceptance

A release candidate is evidence-backed, not simply a successful packaging command.

## Current readiness snapshot

As of source version 0.4.40:

| Area | Current evidence | RC meaning |
|---|---|---|
| Source regression | 197 tests passed | Automated source behavior is green |
| Build and UI | Type checks, production build, responsive-layout checks, and 41 accessibility rules passed | Repository-level UI gate is green |
| Scale storage | 10,000-record persistence completed in 6.95 seconds; restore completed in 485 ms; cumulative 11,100-record database was 458.4 MB (437.1 MiB) | Synthetic dense-evidence storage budget is green |
| macOS packages | Apple Silicon and Universal DMGs passed structure/signature checks; native packaged reference audit and clean Apple Silicon maintainer testing passed | Intel and the complete clean-environment journey remain open |
| Windows packages | Installer and portable structure passed; the maintainer exercised the portable build natively on Windows | Clean installer, upgrade, uninstall, and formal parity evidence remain open |
| Real-library scale | Maintainer witnessed a completed full audit of at least 6,000 files on native Windows | Platform and portable context are established; exact package version, timing, memory, and final database size were not captured |
| Blocking defects | Versioned register contains fixed P1/P2 defects and zero unresolved P0/P1 defects | Known critical/high defects block release automatically |
| Release assets | Four v0.4.40 application packages, checksums, block maps, and unsigned policy manifest are prepared and verified together | Current release distribution remains a single versioned set |
| Instrumented acceptance | Every real audit records privacy-safe package, workload, throughput, sampled memory, storage growth, cancellation, source class, and recovery evidence | The next witnessed large-library run should export this record; earlier observations did not capture it |
| Real-world origin calibration | Corpus 0.5.0 measures 85 independent references and 2,295 cases across five datasets; controlled and MAESTRO texture-candidate evaluation rejected a tempting but non-generalizing detector | No probability-calibrated origin claim is allowed |

The automated readiness command reports 17/17 repository evidence categories,
and Audio-V is published as the current unsigned open-source release. Its
engineering evidence is at release-candidate level, while the clean Windows
installer, Intel launch, assistive-technology workflows, display scaling, and
instrumented real-library performance remain manual GA acceptance work.

## Automated acceptance

- [ ] `npm ci` completes from the lockfile.
- [x] Bundled FFmpeg, C2PA Tool, and Chromaprint provenance, licenses, hashes, versions, and offline settings verify.
- [x] TypeScript and Vue type checks pass.
- [x] All unit, integration, scanner, worker, repair, report, storage, and diagnostics tests pass.
- [x] Fidelity golden-corpus validation passes.
- [x] Real-world corpus infrastructure and packaged validation disclosure verify.
- [x] Accessibility audit has no serious or critical violations.
- [x] Left, right, and L−R channel selections each repaint a fully populated spectrogram canvas without requiring a Floor, zoom, or color control change.
- [x] Quick Inspect is the default completed-file view, renders four bounded summary cards from the Oracle record, and routes to the deeper Spectrogram, Loudness, and Evidence views.
- [x] MP3 Stereo, Joint Stereo, Dual Channel, and Mono modes are parsed from consecutive MPEG frame headers and remain distinct from decoded channel layout.
- [x] Compare restores compact session records into independent File A and File B waveform/spectrum evidence, paints difference and residual panels, and never leaves a stale canvas.
- [x] AcoustID enablement, protected key presence, and MusicBrainz enablement restore after relaunch; clearing the key removes it without plaintext fallback.
- [x] Audit startup waits for protected identity preferences, and cached records enabled for recognition cannot remain in an ambiguous not-requested state.
- [x] MusicBrainz starts remain spaced beyond the public one-request-per-second boundary, and transient throttling, gateway failures, busy responses, and timeouts receive no more than three bounded attempts.
- [x] Delivery profiles persist with the session, switch cleanly across cache reuse, preserve their exact references and limits in reports, and never convert delivery nonconformance into Failed.
- [x] CD-database eligibility requires complete CD-frame-aligned whole-disc context and never appears as a CTDB/AccurateRip match without an actual database verification result.
- [x] MQA-related text/profile markers remain unauthenticated provenance inventory and never imply proprietary unfolding.
- [x] Latest acceptance evidence renders and exports without filenames, paths, hashes, tags, audio evidence, or service credentials.
- [x] Scale budgets pass for 100, 1,000, and 10,000 records.
- [x] A 640-file fingerprint-finalization regression bounds persistent lookups to four outstanding requests, uses indexed exact matching at scale, and preserves audit completion when supplemental history enrichment times out.
- [x] The defect register matches the package version and contains no unresolved P0/P1 defects.
- [x] Maintainer acceptance evidence validates and states every uncaptured measurement.
- [x] Packaged CLI folder audit emits the v12 five-lane JSON evidence model, honors evidence-policy and native resource limits, and does not persist external-service keys.
- [x] Production dependency audit reports zero known vulnerabilities.
- [x] Apple Silicon DMG, Universal DMG, Windows installer, and Windows portable artifacts pass structural inspection.
- [x] Both macOS app bundles have valid whole-bundle ad-hoc signatures, no Developer ID identity, and remain valid after quarantine metadata is applied.
- [x] The native macOS packaged application completes the reference FLAC audit.
- [x] The packaged macOS reference audit emits completed acceptance evidence with nonzero resource samples and no source path leakage.
- [ ] The native Windows packages complete the reference FLAC audit and emit matching acceptance evidence.
- [ ] macOS and Windows Oracle snapshots agree within declared tolerances.
- [x] Artifact checksums and unsigned-release manifest agree.
- [x] Tag, package version, AGPL license, source offer, CLA, and trademark policy verify.

## Manual clean-environment acceptance

- [ ] Apple Silicon DMG install, first launch, audit, report export, and removal tested on a clean supported macOS user account.
- [ ] Universal DMG launches natively on Intel macOS and Apple Silicon macOS.
- [ ] Windows installer install, custom location, first launch, audit, report export, upgrade, uninstall, and retained-data behavior tested on a clean supported Windows VM.
- [x] Windows portable build runs natively without installation and documents its per-user state.
- [ ] Keyboard-only Audit, Identity, Compare, Repair, Reports, Settings, dialogs, and history workflows completed.
- [ ] VoiceOver on macOS and Narrator on Windows can identify navigation, status, result rows, tabs, controls, evidence, and report actions.
- [ ] 100%, 125%, 150%, and 200% display scaling checked without clipped primary actions.
- [ ] Long filenames, Unicode paths, removable media, read-only sources, unavailable volumes, corrupt files, and cancellation under load checked.
- [ ] Upgrade and rollback do not corrupt the SQLite session database.
- [ ] macOS unknown-developer “Open Anyway” and Windows unsigned-warning instructions plus SHA-256 verification checked against current operating-system behavior.

## Policy waivers

Developer ID/Authenticode certificate signing and Apple notarization are not release-candidate requirements while the official project policy remains open-source development distribution. macOS ad-hoc integrity signing is required; the absence of trusted identities and notarization must remain explicit in the build log, manifest, release notes, and installation guide.

Statistically calibrated provenance probability is not claimed. The release must retain conservative rule-strength, evidence-coverage, and inconclusive language until a representative real-music corpus exists.

The Settings validation card and exported origin limitations must agree with `build/real-world-validation-latest.json`. A release may report external references pending, but it must not imply that synthetic fixtures or controlled derivatives are independent real-world evidence.
