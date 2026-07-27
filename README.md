# Audio-V

Audio-V is a cross-platform audio integrity and fidelity workstation powered by the Oracle Engine.

This directory is the repository root for the application.

## Current milestone

The first production foundation includes:

- Electron, Vue 3, TypeScript, and Vite
- Approved Obsidian Spectrum desktop interface with an 11px minimum label size
- Secure context-isolated preload API
- Native multi-file and folder choosers
- Recursive audio discovery with bounded probing and automatic full-stream analysis
- Versioned Oracle Engine result schema
- Bundled FFmpeg 8.1.2 LGPL decoder/probe engine for macOS and Windows
- Complete multi-codec decode-integrity validation
- Independent FLAC STREAMINFO decoded-audio MD5 verification
- Adjacent and folder-level MD5, SHA-1, SHA-256, and SHA-512 manifest verification
- Decoder-independent PCM measurement core with regression tests
- EBU R128 integrated loudness/LRA and BS.1770 true peak
- Measured full-track STFT spectrograms for every successfully decoded format
- MP3 packet analysis with CBR/VBR classification
- Dropout, exact-digital-silence, discontinuity-candidate, crest-factor, and PLR measurements
- Conservative spectral-origin review for possible lossy transcodes and upsampling
- Persistent versioned result cache with file-change invalidation
- Live cancellation that terminates active decoder processes
- Linear/log spectrogram views, adjustable display floor, cursor readout, and PNG export
- Guided Review workflow with acknowledgement, evidence export, source reveal, and Repair routing
- Declared-versus-measured Origin Assessment with heuristic rule strength, evidence coverage, reason codes, spectral basis, and limitations
- Independent Compare file slots with full-track waveform envelopes, paired spectra, and spectral-difference heatmap
- Clickable per-file reports with identity, measurements, origin evidence, and workflow actions
- Non-destructive −1 dBTP FLAC working-copy creation with source-preserving bit depth, explicit 16/24-bit choices, dithering, artwork retention, and automatic re-audit
- Scoped Clear, Review, and Failed Oracle verdicts
- Working Compare, attention/remediation, detailed Reports, and capability views
- PDF, XLSX, DOCX, CSV, and lossless JSON audit-report export
- a native Apple silicon DMG and a universal macOS DMG supporting Intel and Apple silicon
- Windows x64 NSIS installer and portable build targets
- Explicit unsigned open-source development release policy with checksum manifests, artifact inspection, and future credential-driven signing paths

The scanner discovers files and runs every supported stream through the bundled engine from beginning to end. It combines deterministic decode-integrity and checksum results with technical probing, sample peak, RMS, DC offset, clipping, continuity, stereo correlation, mid/side energy, dual/near-mono assessment, EBU R128 loudness, BS.1770 true peak, a bounded waveform envelope, and a 512-point Hann-window STFT spectrogram. The Oracle reports **Clear**, **Review**, or **Failed** within the disclosed `oracle-integrity-fidelity-v5` scope.

Audio-V deliberately contains no audio player, lyrics, equalizer, or playback queue. Compare and Review remain evidence workflows rather than listening or library-management surfaces.

A clear verdict means the entire selected audio stream decoded and passed the current measured rules. It does not claim that an upstream source is authentic or prove that audio was never transcoded or upsampled; those classifications require separate validated detectors.

## Product documentation

- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Product audit and capability contract](docs/PRODUCT_AUDIT.md)
- [Oracle methodology and limitations](docs/METHODOLOGY.md)
- [Standalone Obsidian UI deck](docs/Audio-V-UI-Deck.html)
- [Logo concept deck](docs/Audio-V-Logo-Concepts.html)
- [Release workflow](docs/RELEASING.md)
- [Installing unsigned development builds](docs/UNSIGNED_INSTALLATION.md)
- [User guide](docs/USER_GUIDE.md)
- [Privacy and security model](docs/PRIVACY_SECURITY.md)
- [Release-candidate acceptance](docs/RELEASE_CANDIDATE_CHECKLIST.md)

## License and contributions

Audio-V source is licensed under the [GNU Affero General Public License version 3 only](LICENSE). Existing AGPL releases remain available under those terms. Dependencies and bundled engines retain their respective licenses and notices.

Contributions require acceptance of the [Audio-V Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md), which preserves contributor ownership while granting the Project explicit relicensing rights. The Audio-V and Oracle Engine branding is governed separately by [TRADEMARKS.md](TRADEMARKS.md). See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run validate:fidelity
npm run benchmark:scale
```

## Packaging

```bash
npm run dist:mac
npm run dist:win
```

Generated packages are written to `release/`. Tagged commits are built for macOS and Windows by GitHub Actions and attached to the matching GitHub Release.

Windows packages should be built on Windows or through a dedicated Windows CI runner. Code signing and macOS notarization will be configured after the application identity and release workflow are finalized.
