# Audio-V — Product Blueprint

Status: approved product direction; production implementation started
Product name: **Audio-V**
Engine name: **Oracle Engine**
Approved visual direction: **Obsidian Spectrum**

## Product promise

Audio-V is the definitive desktop application for inspecting, validating, and comparing audio files. A user can drop one track, multiple files, or an entire music library into the application and receive a decisive verdict backed by inspectable measurements and evidence.

The experience should feel like an oracle: immediate, authoritative, and easy to understand. The analysis must remain scientifically honest by distinguishing verified facts from probabilistic conclusions.

## Positioning

**The go-to audio integrity and fidelity workstation for collectors, DJs, archivists, producers, and music enthusiasts.**

Audio-V combines:

- Spek's immediate visual readability
- MediaInfo's technical depth
- Fakin' the Funk's batch workflow
- AudioAuditor's breadth
- Sonic Visualiser's inspectability
- A substantially more coherent, modern, cross-platform experience

It should replace a collection of utilities, not merely add another one.

## Product principles

1. **Decisive first, explainable second.** Every file receives an immediate verdict. Every verdict opens into its evidence.
2. **Never fabricate certainty.** Results distinguish measured facts, standards-based checks, heuristics, and inconclusive evidence.
3. **Batch is a first-class workflow.** Folder analysis is as polished as single-file inspection.
4. **Local by default.** Audio stays on the user's computer unless an explicitly enabled lookup requires a network.
5. **Fast enough for libraries.** Metadata appears immediately while deeper analysis streams in progressively.
6. **Professional visualizations.** Spectrogram settings and transformations are visible and reproducible.
7. **Cross-platform parity.** Windows and macOS ship from the same product specification and share project files and reports.
8. **No feature sprawl.** This is an analysis workstation, not a music player with an analyzer bolted on.

## Verdict model

The Oracle Engine should not collapse every result into fake versus real.

| Verdict | Meaning |
| --- | --- |
| **Verified** | Integrity or provenance was verified through a deterministic check, such as a valid FLAC MD5 or a trusted comparison fingerprint. |
| **Authentic profile** | The measured signal is consistent with the declared format and quality tier. |
| **Review suggested** | One or more anomalies deserve inspection but are not proof of a problem. |
| **Likely transcode** | Multiple independent signals support lossy-to-lossless or lower-bitrate transcoding. |
| **Likely upsample** | The container's sample rate exceeds the signal's strongly supported effective bandwidth. |
| **Damaged** | Decode, checksum, frame, truncation, or stream-integrity checks failed. |
| **Inconclusive** | The engine cannot produce a responsible classification from available evidence. |

Every non-deterministic verdict includes:

- Confidence level
- Evidence for the verdict
- Evidence against the verdict
- Analysis settings
- Plain-language interpretation
- A warning when natural mastering choices could produce the same pattern

## Version-one feature surface

### Ingest and library analysis

- Drag and drop files or folders
- Folder picker with recursive scanning
- Configurable inclusions and exclusions
- Pause, resume, cancel, and retry
- Bounded parallel workers
- Persistent cache keyed by file identity and analysis-version
- Live results while the remaining queue continues
- Saved analysis sessions

### Technical inspection

- Container and codec
- Encoding profile and encoder tags
- CBR, ABR, or VBR where applicable
- Declared and measured average bitrate
- Sample rate and bit depth
- Channel count, layout, and encoding mode
- Duration, file size, and metadata
- Frame-level consistency

### Integrity

- Full decode test
- FLAC STREAMINFO MD5 validation
- Truncation and malformed-frame detection
- Embedded versus calculated duration comparison
- Unexpected discontinuities
- Optional file hashes for reports and later comparisons

### Signal and loudness

- Sample peak
- True peak in dBTP
- RMS by channel and overall
- Integrated LUFS
- Loudness range
- Peak-to-loudness ratio
- Clipped and near-clipped sample analysis
- DC offset
- Silence and dropout detection
- Stereo correlation, phase concerns, and duplicated-mono detection

### Spectral analysis

- Full-track spectrogram
- Linear and logarithmic frequency scales
- Adjustable FFT size, window function, overlap, and dynamic floor
- Left, right, mid, side, and difference views
- Frequency cursor with time/frequency readout
- Effective-bandwidth estimate
- Abrupt cutoff and codec-pattern detection
- Zoom, pan, region selection, and comparison
- Exportable spectrogram images with settings embedded

### Reporting

- CSV for library management
- JSON for automation and reproducibility
- Polished HTML report for sharing
- Per-file evidence report
- Folder summary with filters and distributions
- Compare two files or two releases of the same track

## Signature workflows

### Drop and know

Drop a file onto the application. Within moments, Audio-V displays the verdict, confidence, declared quality, measured profile, loudness, integrity, and spectrogram.

### Audit a library

Select a folder. The application progressively populates a high-density results table. Filters isolate probable transcodes, damaged streams, clipping, unexpected sample rates, duplicates, and inconclusive files.

### Compare editions

Select two versions of a track. Audio-V aligns fingerprints and compares spectral content, loudness, dynamics, phase, duration, and encoding. The result states whether they appear to share a master and which differences are container-only versus signal-level.

### Prove a result

Open any verdict to see the evidence chain. Export a self-contained report with hashes, tool version, algorithms, settings, and measurements.

## Visual direction

### Direction A — Obsidian Spectrum (approved)

The interface resembles a premium scientific instrument designed in the near future.

- Near-black graphite surfaces rather than flat black
- Electric violet as the brand color
- Cyan for measured facts
- Emerald for verified outcomes
- Amber for review
- Coral red for integrity failure
- Large, beautiful spectrogram as the visual hero
- Crisp condensed display typography paired with a highly readable sans serif
- Fine grid lines, subtle glass, restrained bloom, and precise motion
- A circular spectral-fingerprint mark for the icon

This direction is the most distinctive and provides the strongest visual separation from AudioAuditor.

### Direction B — Signal Deck

A direct ecosystem relative of Deemix Remastered.

- Deep navy and black
- Hardware rack structure
- Monospace labels and status lamps
- Emerald and amber signal colors
- Tactile segmented controls
- Strong transfer and scanning animations

This creates immediate family resemblance but risks making the standalone product feel like an accessory rather than the category leader.

### Direction C — Ivory Laboratory

A premium daylight mode inspired by high-end mastering hardware and editorial data products.

- Warm off-white canvas
- Graphite typography
- Cobalt and ultraviolet plots
- Amber annotations
- Spacious, print-like reports
- Minimal translucency and high accessibility

This is exceptionally readable and differentiated, but less dramatic in screenshots than Obsidian Spectrum.

Decision: Obsidian Spectrum is the canonical Audio-V identity. Signal Deck contributes instrument-like status behavior and operational clarity, while Ivory Laboratory remains a possible future light theme.

## Core screen layout

### Global frame

- Compact left rail: Audit, Sessions, Compare, Reports, Settings
- Top command bar: add files, select folder, recent sources, global search
- Main workspace changes between batch table and evidence inspector
- Bottom status strip: worker count, queue, elapsed time, cache, engine version

### Batch audit screen

- Hero summary row with total files and verdict distribution
- Filter chips for verdict, codec, resolution, clipping, and integrity
- Virtualized results table with customizable columns
- Expandable evidence drawer without losing table position
- Mini spectral fingerprint thumbnail per row

### Evidence inspector

- Large verdict and confidence statement
- Spectrogram occupying roughly half the canvas
- Technical facts in a disciplined grid
- Evidence stack showing which checks contributed
- Loudness and dynamics plots
- Analysis settings and reproducibility footer

## Brand and naming shortlist

The following is preliminary naming research, not legal or trademark clearance.

### 1. Audio-V — selected product name

Strengths:

- Short, punchy, and visually strong
- Flexible “V” association with verification and verdict
- Compact in title bars, app icons, and release names
- Supports strong language: "Get the verdict"
- Supports the Oracle Engine as an internal branded capability

Risk:

- The “V” is ambiguous without the audio-verification descriptor
- Hyphenated and non-hyphenated searches may fragment discoverability

### 2. Fideliscope

Strengths:

- Distinctive, instrument-like, and centered on fidelity
- Feels premium and enduring
- Natural visual association with scopes and spectrograms

Risk:

- The term appeared historically on Philips equipment and requires proper clearance

### 3. WaveSentry

Strengths:

- Communicates continuous protection and library auditing
- Strong fit for batch monitoring and watch-folder features
- Memorable icon opportunities

Risk:

- Existing unrelated ocean/wave-monitoring uses require clearance

### 4. Sonic Verdict

Strengths:

- Bold, memorable, and editorial
- Immediately audio-related
- Excellent launch and marketing language

Risk:

- "Sonic verdict" is already used as a phrase by audio publications

### 5. Fidelity Lens

Strengths:

- Elegant, transparent, and descriptive
- Excellent fit for evidence and visual inspection
- Avoids the implication of infallibility

Risk:

- Softer and less ownable than Audio-V

## Brand language

Working tagline: **Know what is really in the file.**

Alternates:

- **See the signal. Trust the verdict.**
- **Every file. Every signal. The evidence.**
- **Audio quality, proven.**
- **Beyond the label. Into the signal.**

Preferred UI terminology:

- Audit rather than Scan
- Verdict rather than Score
- Evidence rather than Details
- Declared quality versus Measured profile
- Review rather than Warning for ambiguous spectral evidence
- Integrity failure only for deterministic failures

## Icon families

### Spectral fingerprint

A circular fingerprint composed of waveform and frequency bands. A clean missing segment forms a subtle check mark. This is the recommended direction because it remains recognizable at 16 pixels and can animate during analysis.

### Verified prism

A waveform enters a geometric prism and exits as separated frequency bands. This communicates inspection and truth but must be simplified substantially for small icons.

### Signal aperture

A camera-aperture-like ring built from spectral bars around a central waveform. This reinforces the "lens into audio" concept and suits both dark and light themes.

The icon must be constructed as vector artwork for production. Generated icon imagery is concept material only.

## Desktop packaging

Required deliverables:

- macOS universal DMG for Apple silicon and Intel
- Signed and notarized macOS application bundle
- Windows x64 NSIS installer
- Windows x64 portable executable
- Optional Windows arm64 after the initial stable release
- Automatic update channel for installed builds
- Manual update notification for portable builds

Recommended initial framework:

- Electron, Vue 3, and TypeScript to reuse Deemix Remastered expertise and packaging knowledge
- Worker processes for all CPU-heavy analysis
- Bundled, license-reviewed FFmpeg/ffprobe distribution
- SQLite for session results and analysis cache
- Canvas or WebGL spectrogram renderer
- Strict IPC boundary between renderer and filesystem/process access

The analysis engine should be an independent package with a versioned JSON result schema. That keeps the UI replaceable and enables a future CLI without duplicating analysis logic.

## Quality bar

Audio-V is ready for public release only when:

- A controlled golden corpus covers clean lossless, multiple lossy codecs and bitrates, transcoding, upsampling, historical recordings, vinyl, cassette, silence, clipping, and damaged files
- Every classifier has measured false-positive and false-negative performance
- macOS and Windows produce equivalent numeric results within defined tolerances
- A 10,000-file folder can be scanned without UI degradation
- Interrupted audits resume safely
- Reports reproduce the on-screen result
- macOS signing/notarization and Windows signing pass clean installation tests
- Accessibility includes keyboard operation, scalable type, reduced motion, and color-independent verdict indicators

The detailed implementation truth source and competitive audit live in [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md).

## Recommended first execution phase

1. Confirm the working name and primary visual direction.
2. Build a non-functional but realistic desktop UI prototype.
3. Create the Oracle Engine result schema.
4. Assemble the first controlled audio corpus.
5. Implement file probing, integrity checks, and standards-based loudness.
6. Add spectrogram generation and the evidence inspector.
7. Validate the end-to-end experience on Windows and macOS before adding probabilistic transcoding verdicts.
