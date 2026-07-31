# Oracle Engine methodology

Audio-V separates deterministic integrity checks, direct measurements, and heuristic interpretation. A successful heuristic never upgrades a file to proven authentic, and a spectral anomaly alone is never called proof of a transcode or upsample.

## Oracle v12 assessment lanes

Oracle v12 evaluates five independent lanes: **file integrity**, **signal defects**, **spectral origin**, **provenance**, and **delivery compliance**. The overall precedence is deliberately narrow:

1. **Failed** requires deterministic evidence against the file itself, such as two unsuccessful decode paths or a decoded FLAC MD5 mismatch.
2. **Analysis error** means a tool, resource, or internal stage did not complete; it is never converted to file damage.
3. **Review** requires a material measured signal finding, recoverable structural nonconformance, external manifest mismatch, or a strong multi-feature spectral-origin pattern.
4. **Clear** means no review-level evidence was found within the tested scope. Informational and advisory findings remain visible without changing the overall verdict.

Provenance declarations and delivery preferences cannot independently turn a structurally valid file into Review or Failed. The top-level result no longer publishes a generic percentage: rule strength, evidence coverage, and regional stability describe different things and remain separate.

## Deterministic integrity

- The selected primary audio stream is decoded from beginning to end with FFmpeg using fatal error handling. When strict decoding reports a file-integrity error, Audio-V repeats the complete analysis with tolerant decoder behavior. Failure of both paths supplies deterministic evidence for **Failed**; tolerant success produces **Review** for recoverable structural nonconformance rather than incorrectly calling a playable stream damaged.
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

The inventory includes bounded raw tags plus normalized title/artist/album/composer/genre/date/track/disc/BPM, ISRC, MusicBrainz recording IDs, AcoustID IDs, declared ReplayGain, and embedded or adjacent cue-sheet references. Full audits calculate ReplayGain 2.0 track gain at the −18 LUFS reference. Album gain requires at least two fully analyzed files with matching normalized album identity and decoded channel count; every file records either the calculated group or the exact reason album gain was unavailable. Automatic album calculation is deferred above 1,000 audited files because it otherwise requires a second full decode of the entire eligible collection; auditing an album or smaller source calculates exact grouped gain. Cue INDEX 01 programme regions are decoded independently, stop at the next INDEX 00/01 boundary, and report any declared INDEX 00 pregap as separate evidence. Tags remain editable claims and never become deterministic authenticity evidence by themselves.

## Provenance and acoustic identity

- Audio-V invokes the official C2PA Tool in offline mode. Remote-manifest and OCSP fetching are disabled, so a result is reproducible and does not disclose the file to a network service. It reports manifest validity, signer trust state, claim generator, signing time, and declared digital source types. The [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.2/specs/ContentCredentials.html) distinguishes a valid asset from a trusted signer and treats provenance as statements rather than a truth verdict.
- A valid Content Credential verifies its cryptographic association and assertions; it does not establish artistic truth, quality, ownership, or human authorship. Missing credentials are neutral. Invalid credentials and untrusted signers remain visible provenance advisories and do not alter the audio-quality verdict.
- Generator/tool names found in metadata and known identifier strings found in raw bytes are labeled inventory indicators. Editable tags and unauthenticated strings cannot prove how decoded audio was created. Audio-V deliberately has no statistical AI classifier or universal “AI: Yes/No” badge.
- [Chromaprint](https://acoustid.org/chromaprint) locally fingerprints up to 120 seconds and supports same-fingerprint and high-similarity candidates within the current audit and a SQLite historical-session index. Historical finalization uses at most four outstanding storage requests, switches to indexed exact-hash lookup above 100 selected files, and treats unavailable supplemental history as a notice rather than an audit failure. The Identity workspace can browse, rebuild from saved sessions, prune missing source paths, or clear that index. A fingerprint indicates acoustic relationship, not byte identity, ownership, edition, or mastering provenance.
- AcoustID lookup is disabled by default. A release may inject the registered Audio-V client identity into an ignored packaged resource; source builds and forks can supply their own 10-character registered-application key, and a user-entered key overrides the packaged identity. Audio-V trims and locally validates an override, then performs a service-backed preflight before discovery. A rejected key stops the audit instead of producing repeated per-file errors. When the user explicitly saves identity settings, Electron safe storage protects the key with macOS Keychain or Windows DPAPI; Audio-V refuses plaintext fallback and excludes the key from audit records, reports, diagnostics, source control, and packages. Audio-V sends only the duration and Chromaprint value to AcoustID using POST and reads linked recording identifiers/titles. Requests are globally serialized at 375 ms spacing, cached by fingerprint identity, retried up to three times only for HTTP 429/502/503/504, limited to 15 seconds and 1 MB per response. The Identity workspace can apply the same bounded lookup to previously measured current-audit fingerprints without another audio decode.
- Direct MusicBrainz enrichment is independently disabled by default and requires no credential. It looks up one syntactically valid recording MBID, preferring a file's embedded identifier over an AcoustID candidate. The public client uses an identifying User-Agent, globally spaces request starts by 1.1 seconds, retries transient throttling, gateway failures, busy responses, and timeouts no more than three times with bounded backoff, enforces a 15-second per-attempt timeout and 1 MB response limit, and caches each unique ID in memory. Credited artists, ISRCs, first-release date, and up to eight release groups are bounded in saved evidence. Missing identifiers, not-found responses, and final service errors remain distinct and neutral.
- A parallel identity assessment compares an external recording ID, title, and credited artists only when both declared and identified values exist. Unicode, punctuation, common joining words, and artist ordering are normalized before comparison. **Metadata corroborated** means every comparable field agrees; **Identity matched** means an acoustic identity exists but local tags are insufficient for comparison; **Metadata conflict** exposes at least one disagreement; **Inconclusive** means no enabled service produced a usable identity. The assessment has no Oracle verdict field and cannot cancel integrity, signal, spectral-origin, provenance, or delivery findings.
- MQA-like metadata keys and decoder profile strings are reported only as unauthenticated format markers. Audio-V does not decode, unfold, authenticate, or certify MQA, and a marker never changes the Oracle verdict.
- CD checksum databases require exact disc context. Audio-V evaluates whether a selection is lossless 44.1 kHz, 16-bit stereo, contains a complete single-image cue layout, and aligns to CD frames. An eligible result means only that a future AccurateRip or CUETools Database query could be constructed. This release does not contact either service and does not claim a checksum match.

## Optional delivery profiles

Delivery compliance is off by default because a music library does not necessarily share one delivery specification. When a profile is selected, Audio-V stores the exact profile snapshot with the audit and evaluates measured integrated loudness and true peak against disclosed limits:

- **EBU R 128 programme QC:** target −23 LUFS, accepted −23.2 to −22.8 LUFS, maximum −1 dBTP.
- **ATSC A/85 Annex M:** target −24 LKFS/LUFS, accepted −26 to −22 LUFS, maximum −2 dBTP.
- **AES TD1008 internet-music track:** target −16 LUFS, operational range −20 to −15.8 LUFS, maximum −1 dBTP.

A missing or out-of-range delivery measurement produces **Review**, never **Failed**. A compliant profile cannot erase integrity, defect, or origin evidence. Reports retain the profile name, revision, reference URL, target, accepted range, peak ceiling, measured values, and qualification.

## Dynamics and bit utilization

- FFmpeg `drmeter` adds an overall and per-channel windowed DR descriptor alongside EBU loudness range, peak-to-loudness ratio, and crest factor. These metrics answer different questions and are not interchangeable mastering scores.
- Integer bit utilization applies only when a reliable declared word length exists for a lossless integer stream. Audio-V measures consistently unused least-significant bits and reports an effective utilized depth. Two or more unused bits produce an origin advisory for possible padding or prior truncation; silence is inconclusive. The measurement cannot identify cause or recover precision.

## Spectral analysis

- Quick Inspect is a presentation layer over the completed Oracle record. It
  does not change evidence precedence, recalculate confidence, or issue an
  alternate verdict. “Lightweight” refers to this compact one-file workflow,
  not reduced decoding or reduced evidence.
- MP3 encoded channel mode is parsed from validated consecutive MPEG audio
  frame headers and reported separately from decoded channel count/layout.
  Audio-V distinguishes Stereo, Joint Stereo, Dual Channel, and Mono without
  treating the mode itself as a fidelity verdict.
- The displayed spectrogram is measured, not decorative. Active analysis creates 512-point overview and 2,048-point detail data. Durable large-library history retains a bounded 32-region overview and 160-point waveform while keeping the complete measurement/verdict summary. Oracle v12 also runs a separate 4,096-point, 48-region classifier tier and discards its full matrix after retaining bounded summary evidence; this avoids multiplying historical-database size. The inspector can decode the selected file on demand for 4,096- or 16,384-point presentation. Every tier discloses its dynamic floor, frequency range, hop size, and resolution.
- “Measured” means the view is calculated from decoded samples without EQ,
  enhancement, or a decorative texture. It does not mean the rendering is a
  uniquely raw or source-authentic picture: FFT size, window, overlap, scale,
  floor, channel combination, and palette all affect presentation.
- Combined mode averages per-channel power, so opposite-polarity channels do not cancel before measurement. Left and right modes isolate the first two channels. L−R measures the side signal \((L-R)/2\); mono requests resolve to the available left channel.
- Zoom and pan select a bounded time window from the measured slices. Drag selection reports exact visible time and frequency bounds. Inferno, magma, and viridis palettes affect presentation only; FFT data and verdict logic are unchanged. Batch PNG export applies the selected FFT resolution, channel mode, floor, and colormap to each decoded file.
- The waveform overview is a per-channel envelope: its extrema preserve the minimum and maximum sample across channels, while RMS uses average channel power. It is not a mono downmix.
- Compare alignment decodes up to the first 120 seconds of each selected file into an 8 kHz mono analysis preview and estimates a bounded ±5 second offset, gain, and polarity. Matching layouts then receive a full-overlap per-channel decoded null test. Differing layouts require an explicit one-to-one channel map for a full null; without a map, Audio-V reports only the bounded preview. Resampling is disclosed and the result remains decoded-signal relationship evidence, not source-provenance proof.

## Defect-validation scope

The native defect gate fully decodes labeled WAV controls containing a clean signal, one inserted single-sample impulse, and one non-zero stuck-sample plateau. All three must match their expected click/pop and stuck-sample counts. These are deterministic synthetic decoder-path fixtures, not a licensed real-world defect corpus; historical recordings, vinyl transfers, hard edits, percussion, and synthesis remain necessary future false-positive/false-negative validation material.

Click/pop candidates use a robust local prediction residual. The center sample is compared with the neighboring baseline, and its threshold adapts to the median and median absolute deviation of nearby sample differences. A candidate is promoted to Review only when it is repeated or materially large; a small isolated candidate is advisory. Stuck-sample promotion considers event count and duration. Steep transitions alone are advisory, because percussion, edits, and synthesis commonly create them.

## Spectral-origin decision rules

- Effective bandwidth is the highest locally sustained bin within 60 dB of the strongest average bin, bounded by −90 dBFS.
- The classifier measures the strongest upper-band cliff, active-region coverage, regional band-edge stability, proximity to earlier common Nyquist boundaries, sustained upper-band suppression, and a separated secondary band rupture.
- A strong possible-upsample or possible-lossy-transcode pattern requires at least two independent evidence families and a regionally repeatable band edge. A cutoff or low-pass shape by itself can produce only a compatible-pattern advisory.
- The possible-upsample envelope requires at least two seconds of content, a declared sample rate of at least 88.2 kHz, a band edge from 18–28 kHz, materially unused declared bandwidth, sustained upper-band suppression, regional stability, and either a prior sample-grid boundary match or a secondary band rupture.
- The possible-lossy-transcode envelope applies only to lossless output codecs at no more than 50 kHz and requires a 14–21.5 kHz band edge, at least a 25 dB cliff, limited Nyquist occupancy, regional stability, and corroborating band evidence.

The thresholds are regression-tested against deterministic native-wideband, MP3-to-FLAC, 44.1-to-96 kHz, intentional low-pass, silence, short-duration, and narrow-band tonal controls. They are deliberately labeled **possible**: microphones, mastering filters, instrument bandwidth, noise reduction, and artistic processing can create similar spectra. A broader real-music corpus is required before Audio-V may use a stronger “likely” classification.

### Rule strength and evidence coverage

Origin Assessment reports three separate quantities:

- **Heuristic rule strength** is the ordinal `none`, `weak`, `moderate`, or `strong`. It indicates how completely the measured values satisfy the current versioned multi-feature rule and is not a probability that the inferred source history is true.
- **Evidence coverage** indicates how much of the classifier's required input was usable: sufficient decoded duration, measurable effective bandwidth, a stable cutoff and drop, and upper-band energy. Every successfully decoded file with an Origin Assessment receives coverage from 0–100%, including inconclusive files.
- **Regional stability** reports how consistently the measured band edge repeats across active time regions. It is a measurement of repeatability, not provenance confidence.

An inconclusive assessment has no rule-strength score and includes a machine-readable reason: insufficient duration, unmeasurable bandwidth, or no stable cutoff. Assigning a probability in those cases would manufacture certainty. Stronger confidence requires a large provenance-labeled corpus and held-out calibration; additional spectral features alone cannot prove whether an identical cutoff came from lossy encoding or intentional production filtering.

`npm run validate:fidelity` runs the versioned corpus manifest at `validation/fidelity-corpus.json`, fails on an unsafe classifier regression, and writes the exact result to `build/fidelity-validation-latest.json`. The initial synthetic corpus is a regression suite, not probability calibration.

## Reproducibility

Reports include file identity, engine version, decoded measurements, analysis settings, evidence disposition, clipping diagnostics, and classifier limitations. Raw spectrogram matrices are omitted from batch JSON exports to keep reports bounded; PNG exports preserve the selected FFT resolution, channel mode, colormap, and display floor.

Every real audit also records a privacy-safe acceptance evidence document. It contains aggregate source type and storage class, discovered/completed file and byte counts, elapsed time, cancellation latency, verdict and failure-stage totals, sampled process-memory peaks, database growth, and recovery behavior. It deliberately excludes filenames, source paths, hashes, tags, and audio evidence. This makes large-library and packaged-runtime claims reproducible without exposing a user's collection.

The headless CLI uses the same Oracle worker and compact JSON contract and is included with desktop packages. Folder recursion, deterministic ordering, worker count, per-worker JavaScript heap limits, FFmpeg thread caps, native-process RSS enforcement, and policy exit codes make it suitable for CI and archival ingest. Desktop controls are additionally resolved against an aggregate budget capped at the smaller of 20% of physical memory or 8 GB, with a 1.5 GB minimum application budget, 768 MB application reserve, and an aggregate FFmpeg ceiling of 75% of logical CPUs. FFmpeg subprocesses stream decoded PCM and do not materialize complete tracks in application memory. The live audit keeps complete display tiers; durable history retains a 32-region overview, a 160-point waveform, the full measurement summary, and the 4,096-point classifier summary. Higher-resolution matrices are regenerated from the source on selection. This keeps the 10,000-file benchmark below a 600 MiB database budget without discarding verdict evidence. Local Chromaprint uses one decode capped at 120 seconds; the optional AcoustID request performs a second capped pass only when it needs the service’s encoded form.

Click/pop detection uses the adaptive robust residual described above. Stuck-sample detection requires a constant, non-zero run lasting at least 10 ms or 128 frames. These are conservative candidates, not deterministic corruption evidence; steep transitions remain advisory inventory.

Comparison alignment is estimated from a mono 8 kHz preview capped at 120 seconds. The recovered signed gain and offset are then applied to a complete decoded, matching-channel FFmpeg null pass. Audio-V reports per-channel PSNR-derived null depth, compared frames, and duration coverage; resampling is disclosed when source sample rates differ.

## Scientific and standards basis

Oracle rules are implementation policy built on disclosed measurements, not a claim that one standard defines “audio authenticity.” The principal technical references are:

- [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en) and the [EBU loudness resource](https://tech.ebu.ch/loudness/) for loudness and true-peak measurement.
- [RFC 9639, Free Lossless Audio Codec](https://www.rfc-editor.org/rfc/rfc9639.html) for FLAC framing and STREAMINFO semantics.
- The [C2PA harms model](https://c2pa.org/specifications/specifications/2.0/security/Harms_Modelling.html) for the explicit separation between cryptographic provenance, trust, and truth.
- Koops et al., [Robust Lossy Audio Compression Identification](https://arxiv.org/abs/2407.21545), for the evidence that compression-history identification is a multi-feature classification problem rather than a universal cutoff test.
- Esquef et al., [Automatic detection of audio defects using deep anomaly detection](https://link.springer.com/article/10.1186/s13636-024-00389-9), for contemporary defect-detection framing. Audio-V does not reproduce that neural model; its bounded local residual detector remains deterministic, disclosed, and corpus-gated.

These references constrain measurement and claim language. They do not replace validation: synthetic fixtures prove regression behavior, while published false-positive and false-negative rates still require a legally usable labeled corpus. Audio-V’s external-corpus workflow now registers Slakh2100, MUSAN, MAESTRO, EBU SQAM, and MUSDB18-HQ by exact version, license, access boundary, and intended role. Dataset-specific adapters select independent source groups into leakage-safe development, calibration, test, or challenge partitions; 36 controlled recipes retain source hashes, deterministic 60-second windows, tool versions, arguments, and output hashes. Until the public-reference and held-out challenge thresholds are populated, these controls improve reproducibility but do not justify a probability claim.

## Non-destructive level remediation

- True-peak remediation always creates a new FLAC working copy and never overwrites the selected source.
- The default output word length preserves a declared 16-bit or 24-bit source. Sources without a reliable word-length declaration use a 24-bit working copy.
- Gain processing is performed before explicit output quantization. Sixteen-bit output uses triangular dither; 24-bit FLAC uses a 24-bit output word length. Choosing 24-bit for a 16-bit source preserves processing headroom but does not recover source detail.
- Sample rate and channel layout remain unchanged. Container metadata and attached artwork are mapped into the output where the FLAC container supports them.
- The completed copy is decoded and audited again. Audio-V rejects the operation if the verified output word length does not match the user’s selection.
