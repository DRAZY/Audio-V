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

In **Spectrogram**, choose 512, 2,048, 4,096, or 16,384 FFT resolution. Higher settings separate nearby frequencies more precisely but provide coarser time resolution and require an on-demand decode. Choose combined power, left, right, or L−R; use zoom and pan to navigate, drag across the plot for exact time/frequency bounds, and export one PNG or a batch using the current inspection settings. Inferno, magma, and viridis change only the display palette.

In **Loudness**, clipping diagnostics show the percentage of decoded samples at full scale, per-channel counts, contiguous clipping events, their locations on a track timeline, and possible scaled-clipping plateaus. Clipping and possible scaled clipping remain Review findings because intentional mastering and synthesized waveforms can create the same measurements. Failed is reserved for deterministic file-integrity evidence.

The **Declared metadata inventory** lists normalized fields and a bounded set of raw tags. Metadata Inventory mode gives this capability a fast, non-decoding purpose; Full Oracle Audit adds local C2PA, fingerprint, dynamics, bit-utilization, and signal evidence.

The **Provenance & identity** card distinguishes cryptographic Content Credential status, editable generator metadata, known identifier strings, local Chromaprint relationships, and optional external matches. These are not collapsed into an “AI: Yes/No” badge. A raw identifier is not proof that Audio-V decoded a proprietary watermark, and a valid C2PA claim authenticates a signed statement rather than the truth of every statement.

## Origin Assessment

**Heuristic rule strength** shows how strongly a classifiable file matches a versioned rule. It is not a probability that a source history is true.

**Evidence coverage** shows how much usable classifier input was available. An inconclusive file still receives coverage and a reason such as insufficient duration, unmeasurable bandwidth, or unstable cutoff.

Intentional filtering, microphones, instruments, analog transfers, noise reduction, and mastering can resemble codec cutoffs. Use Origin Assessment to prioritize review, not accuse a source.

## Compare

Load File A and File B independently from disk or choose current-audit files. Audio-V compares identity, properties, waveform envelopes, spectra, normalized spectral difference, preview-derived offset/gain/polarity, and a full-track per-channel null without adding playback.

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

Settings also displays the packaged Oracle validation basis: public independent source-master count, contributor groups, controlled cases, corpus version, current claim level, and the first material limitation. “Infrastructure ready · masters pending” means the validation machinery exists but no licensed real-world master has been counted; it is not a hidden calibration score.

**Audit resource policy** applies to the next audit. Choose 1–4 concurrent Oracle workers, a 128–512 MB JavaScript heap cap, 1/2/4 FFmpeg threads per file, and a 256 MB–2 GB native-process RSS limit. Crossing the native limit terminates that analysis as a resource error rather than calling the file damaged.

**AcoustID / MusicBrainz lookup** is off by default. When enabled with an AcoustID application key, Audio-V sends the local Chromaprint value and rounded duration—not the audio—to AcoustID. The key remains only in application memory and is removed from saved sessions and reports. Matches are identity leads, not proof of ownership or mastering provenance.

## Headless folder automation

Source and CI users can audit files or recursive folders without opening the desktop:

```bash
npm run cli -- ./collection --output ./audio-v-evidence.json --concurrency 2 --memory-mb 256 --fail-on failed
```

Use `--fail-on review`, `failed`, or `never` to choose when evidence returns policy exit code 2. Processing errors return exit code 1. The output uses the same compact Oracle v9 JSON contract as desktop JSON reports. Desktop packages include launchers under `Contents/Resources/cli` on macOS and `resources\cli` on Windows.

For unsigned installation and checksum verification, see [UNSIGNED_INSTALLATION.md](UNSIGNED_INSTALLATION.md).
