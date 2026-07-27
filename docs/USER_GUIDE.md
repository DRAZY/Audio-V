# Audio-V user guide

## What Audio-V does

Audio-V is a local audio-integrity and fidelity workstation. It completely decodes selected audio, measures the decoded signal, verifies available checksums, presents conservative origin indicators, compares two files, creates limited non-destructive remediation copies, and exports evidence reports.

It is not a music player, mastering suite, source-provenance oracle, or guarantee that a recording has never been transformed.

## Audit

Choose individual files with **Choose files**, or recursively discover supported audio with **Choose folder**. The table populates as files complete. **Pause** stops scheduling new work after active jobs finish; **Cancel audit** terminates active decoders while retaining completed session evidence.

Verdicts have deliberately limited scope:

- **Clear** — complete decoding and current deterministic/measured rules passed.
- **Review** — decoding completed but a measured or heuristic finding deserves inspection.
- **Failed** — deterministic decode or integrity evidence failed.

**Not analyzed** is not a verdict. Select **Metadata inventory** as the run mode to catalog declared format, codec, duration, bitrate, sample rate, bit depth, and channels without decoding the signal. Run a **Full Oracle audit** when you want integrity, loudness, spectrogram, continuity, and origin evidence.

An **Analysis error** means a tool, resource, probe, measurement, or internal processing stage did not finish. Audio-V shows the failure stage, code, and exact diagnostic evidence and does not call the source damaged. Retry the analysis after reviewing that evidence.

Select a row to inspect its measured spectrogram, loudness, technical profile, evidence chain, Origin Assessment, and Oracle verdict. A Clear result does not prove provenance.

## Origin Assessment

**Heuristic rule strength** shows how strongly a classifiable file matches a versioned rule. It is not a probability that a source history is true.

**Evidence coverage** shows how much usable classifier input was available. An inconclusive file still receives coverage and a reason such as insufficient duration, unmeasurable bandwidth, or unstable cutoff.

Intentional filtering, microphones, instruments, analog transfers, noise reduction, and mastering can resemble codec cutoffs. Use Origin Assessment to prioritize review, not accuse a source.

## Compare

Load File A and File B independently from disk or choose current-audit files. Audio-V compares identity, properties, waveform envelopes, spectra, normalized spectral difference, offset, gain, polarity, correlation, and residual energy without adding playback.

The current alignment measurement is bounded and is not a full-track multichannel null test.

## Repair

Repair is triage, not a claim that every Review file is damaged. Audio-V explains whether replacement, manual verification, comparison, or optional mitigation is appropriate.

The automated true-peak action creates a separate FLAC working copy and never overwrites the source. It preserves source word length by default, offers explicit 16/24-bit output, applies triangular dither to 16-bit processing output, retains supported metadata/artwork, and audits the copy. Gain reduction prevents new positive true peaks; it does not reconstruct clipped samples.

## Reports

The Reports workspace opens complete per-file evidence and exports the current authoritative audit as PDF, XLSX, DOCX, CSV, or JSON. Reports can contain filenames, absolute paths, hashes, and audio measurements. Review them before sharing.

## History and recovery

Audio-V stores audit sessions locally. History can reopen completed evidence or resume an interrupted source. Cache reuse requires matching file size, modification time, and Oracle engine version.

## Keyboard commands

- `Command/Ctrl+O` — choose audio files
- `Command/Ctrl+Shift+O` — choose a folder
- `Command/Ctrl+1` through `5` — Audit, Compare, Repair, Reports, Settings
- `Escape` — close audit history

## Support diagnostics

Settings can export a privacy-safe diagnostic JSON file containing application/runtime versions, worker count, aggregate session statuses, and the engine manifest. It excludes filenames, source paths, checksums, tags, and report evidence.

For unsigned installation and checksum verification, see [UNSIGNED_INSTALLATION.md](UNSIGNED_INSTALLATION.md).
