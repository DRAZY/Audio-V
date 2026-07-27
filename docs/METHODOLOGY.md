# Oracle Engine methodology

Audio-V separates deterministic integrity checks, direct measurements, and heuristic interpretation. A successful heuristic never upgrades a file to proven authentic, and a spectral anomaly alone is never called proof of a transcode or upsample.

## Deterministic integrity

- The selected primary audio stream is decoded from beginning to end with FFmpeg using fatal error handling. Only decoder diagnostics that deterministically identify corruption, truncation, malformed frames, checksum errors, or an incomplete decoded frame produce **Failed**.
- Engine launch failures, timeouts, output limits, unclassified tool exits, probe/measurement faults, and internal exceptions produce **Analysis error**, never **Failed**. Each error retains a stage, stable code, and exact diagnostic evidence. No file-integrity verdict is issued.
- Native FLAC files expose the 128-bit MD5 stored in STREAMINFO. Audio-V decodes to the canonical little-endian PCM width, calculates the audio MD5, and compares it with STREAMINFO. A mismatch produces **Failed** even when frames remain decodable. The [FLAC format overview](https://xiph.org/flac/documentation_format_overview.html) identifies this signature as the checksum of unencoded audio; the [reference `flac` tool documentation](https://xiph.org/flac/documentation_tools_flac.html) likewise distinguishes bitstream errors from decoded-audio MD5 mismatch.
- SHA-256 identifies the exact file bytes. Declared duration is compared with decoded frame duration, allowing 100 ms for normal codec delay and container rounding.

## Signal and loudness measurements

- Sample peak, RMS, per-channel DC offset, clipping, near clipping, stereo correlation, duplicated mono, and crest factor are calculated from streamed 64-bit decoded PCM.
- A clipped sample is a decoded sample whose absolute amplitude is at least 1.0 full scale. Audio-V reports total and per-channel counts and percentages, and groups adjacent frames containing clipped samples into contiguous events. The event timeline retains at most 500 event records while preserving the complete aggregate count.
- Possible scaled clipping is a conservative plateau indicator: three or more consecutive samples with the same absolute amplitude within \(10^{-7}\), at or above 0.5 full scale. It may find a clipped waveform that was later attenuated, but square waves, synthesis, limiting, and quantization can produce the same shape. It therefore produces **Review**, never **Failed**, and is not described as reconstructed proof.
- Integrated loudness, loudness range, and oversampled true peak are measured with FFmpeg's EBU R128 filter. Peak-to-loudness ratio is true peak minus integrated LUFS. These descriptors follow [EBU R 128](https://tech.ebu.ch/publications/r128) and its [streaming supplement](https://tech.ebu.ch/files/live/sites/tech/files/shared/r/r128s2v1_0.pdf).
- An internal dropout candidate is an exact digital-zero run of at least 100 ms surrounded by non-zero signal. It produces **Review**, not **Failed**, because intentional edits can contain the same pattern.
- A discontinuity candidate is a channel sample-to-sample jump of at least 0.95 full scale. It is reported as a measurement and does not currently affect the verdict.

## Metadata inventory

Metadata Inventory is a deliberate non-decoding workflow. It records declared container and stream properties and assigns the workflow state **Not analyzed**. It does not run checksum, PCM, loudness, continuity, spectral, or origin assessment and therefore cannot issue Clear, Review, or Failed.

The inventory includes bounded raw tags plus normalized title/artist/album/composer/genre/date/track/disc/BPM, ISRC, MusicBrainz recording IDs, AcoustID IDs, declared ReplayGain, and embedded or adjacent cue-sheet references. Full audits calculate ReplayGain 2.0 track gain at the −18 LUFS reference; files sharing normalized album identity and channel count are concatenated in disc/track order for album gain. Cue INDEX 01 regions are decoded and measured independently. Tags remain editable claims and never become deterministic authenticity evidence by themselves.

## Provenance and acoustic identity

- Audio-V invokes the official C2PA Tool in offline mode. Remote-manifest and OCSP fetching are disabled, so a result is reproducible and does not disclose the file to a network service. It reports manifest validity, signer trust state, claim generator, signing time, and declared digital source types. The [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.2/specs/ContentCredentials.html) distinguishes a valid asset from a trusted signer and treats provenance as statements rather than a truth verdict.
- A valid Content Credential verifies its cryptographic association and assertions; it does not establish artistic truth, quality, ownership, or human authorship. Missing credentials are neutral. An invalid credential or untrusted signer routes to Review, never Failed.
- Generator/tool names found in metadata and known identifier strings found in raw bytes are labeled inventory indicators. Editable tags and unauthenticated strings cannot prove how decoded audio was created. Audio-V deliberately has no statistical AI classifier or universal “AI: Yes/No” badge.
- [Chromaprint](https://acoustid.org/chromaprint) locally fingerprints up to 120 seconds and supports same-fingerprint and high-similarity candidates within the current audit and a SQLite historical-session index. A fingerprint indicates acoustic relationship, not byte identity, ownership, edition, or mastering provenance.
- AcoustID lookup is disabled by default. When the user supplies a key and explicitly enables it, Audio-V sends only the duration and Chromaprint value to AcoustID and reads linked recording identifiers/titles. The key remains in memory and is removed from persisted sources and exported evidence. Requests have a 15-second timeout and a 1 MB response limit.

## Dynamics and bit utilization

- FFmpeg `drmeter` adds an overall and per-channel windowed DR descriptor alongside EBU loudness range, peak-to-loudness ratio, and crest factor. These metrics answer different questions and are not interchangeable mastering scores.
- Integer bit utilization applies only when a reliable declared word length exists for a lossless integer stream. Audio-V measures consistently unused least-significant bits and reports an effective utilized depth. Two or more unused bits route to Review as possible padding or prior truncation; silence is inconclusive. The measurement cannot identify cause or recover precision.

## Spectral analysis

- The displayed spectrogram is measured, not decorative. Every completed audit persists a 512-point overview and 2,048-point detail tier. The inspector can decode the selected file on demand for 4,096- or 16,384-point analysis without expanding every batch record. Every tier discloses its dynamic floor, frequency range, hop size, and resolution.
- Combined mode averages per-channel power, so opposite-polarity channels do not cancel before measurement. Left and right modes isolate the first two channels. L−R measures the side signal \((L-R)/2\); mono requests resolve to the available left channel.
- Zoom and pan select a bounded time window from the measured slices. Drag selection reports exact visible time and frequency bounds. Inferno, magma, and viridis palettes affect presentation only; FFT data and verdict logic are unchanged. Batch PNG export applies the selected FFT resolution, channel mode, floor, and colormap to each decoded file.
- The waveform overview is a per-channel envelope: its extrema preserve the minimum and maximum sample across channels, while RMS uses average channel power. It is not a mono downmix.
- Compare alignment decodes up to the first 120 seconds of each selected file into an 8 kHz mono analysis preview. It estimates a bounded ±5 second offset from energy-envelope correlation, then measures aligned sample correlation, polarity, relative gain, and residual energy. This is decoded-signal relationship evidence, not a full-track null test or source-provenance claim.
- Effective bandwidth is the highest locally sustained bin within 60 dB of the strongest average bin, bounded by −90 dBFS.
- The strongest upper-band cutoff compares six bins below and above each candidate frequency. Upper-band level is the mean power over the top 15% of the declared Nyquist range.
- A possible upsample review requires at least two seconds of content, sample rate at least 88.2 kHz, a cutoff from 18–28 kHz, at least an 18 dB cliff, no more than 65% Nyquist occupancy, and upper-band level at or below −85 dBFS.
- A possible lossy-transcode review requires a lossless output codec at no more than 50 kHz, a cutoff from 14–21.5 kHz, at least a 25 dB cliff, and no more than 90% Nyquist occupancy.

The thresholds are regression-tested against deterministic native-wideband, MP3-to-FLAC, 44.1-to-96 kHz, intentional low-pass, silence, short-duration, and narrow-band tonal controls. They are deliberately labeled **possible**: microphones, mastering filters, instrument bandwidth, noise reduction, and artistic processing can create similar spectra. A broader real-music corpus is required before Audio-V may use a stronger “likely” classification.

### Rule strength and evidence coverage

Origin Assessment reports two separate quantities:

- **Heuristic rule strength** indicates how strongly the measured values satisfy the current versioned rule. It is not the probability that the inferred source history is true. The current values are fixed rule strengths and must not be described as statistically calibrated confidence.
- **Evidence coverage** indicates how much of the classifier's required input was usable: sufficient decoded duration, measurable effective bandwidth, a stable cutoff and drop, and upper-band energy. Every successfully decoded file with an Origin Assessment receives coverage from 0–100%, including inconclusive files.

An inconclusive assessment has no rule-strength score and includes a machine-readable reason: insufficient duration, unmeasurable bandwidth, or no stable cutoff. Assigning a probability in those cases would manufacture certainty. Stronger confidence requires a large provenance-labeled corpus and held-out calibration; additional spectral features alone cannot prove whether an identical cutoff came from lossy encoding or intentional production filtering.

`npm run validate:fidelity` runs the versioned corpus manifest at `validation/fidelity-corpus.json`, fails on an unsafe classifier regression, and writes the exact result to `build/fidelity-validation-latest.json`. The initial synthetic corpus is a regression suite, not probability calibration.

## Reproducibility

Reports include file identity, engine version, decoded measurements, analysis settings, evidence disposition, clipping diagnostics, and classifier limitations. Raw spectrogram matrices are omitted from batch JSON exports to keep reports bounded; PNG exports preserve the selected FFT resolution, channel mode, colormap, and display floor.

The headless CLI uses the same Oracle worker and compact JSON contract and is included with desktop packages. Folder recursion, deterministic ordering, worker count, per-worker JavaScript heap limits, FFmpeg thread caps, native-process RSS enforcement, and policy exit codes make it suitable for CI and archival ingest. FFmpeg subprocesses stream decoded PCM and do not materialize complete tracks in application memory. Local Chromaprint uses one decode capped at 120 seconds; the optional AcoustID request performs a second capped pass only when it needs the service’s encoded form.

Click/pop detection requires an isolated impulse against stable neighboring windows. Stuck-sample detection requires a constant, non-zero run lasting at least 10 ms or 128 frames. These and steep full-scale transitions are conservative Review candidates, not deterministic corruption evidence.

Comparison alignment is estimated from a mono 8 kHz preview capped at 120 seconds. The recovered signed gain and offset are then applied to a complete decoded, matching-channel FFmpeg null pass. Audio-V reports per-channel PSNR-derived null depth, compared frames, and duration coverage; resampling is disclosed when source sample rates differ.

## Non-destructive level remediation

- True-peak remediation always creates a new FLAC working copy and never overwrites the selected source.
- The default output word length preserves a declared 16-bit or 24-bit source. Sources without a reliable word-length declaration use a 24-bit working copy.
- Gain processing is performed before explicit output quantization. Sixteen-bit output uses triangular dither; 24-bit FLAC uses a 24-bit output word length. Choosing 24-bit for a 16-bit source preserves processing headroom but does not recover source detail.
- Sample rate and channel layout remain unchanged. Container metadata and attached artwork are mapped into the output where the FLAC container supports them.
- The completed copy is decoded and audited again. Audio-V rejects the operation if the verified output word length does not match the user’s selection.
