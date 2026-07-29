# Audio-V product audit and capability contract

Last reviewed: 2026-07-28

This document is the product truth source between the approved vision, the original request, competing applications, and what the repository actually implements. A feature is not considered present because a mock-up displays it.

## Original request baseline

The request from `jota726` in [DRAZY/deemix-remastered discussion 105](https://github.com/DRAZY/deemix-remastered/discussions/105#discussioncomment-17782035) asked for a lightweight, standalone analyzer with:

1. A full-track spectrogram for inspecting real frequency cutoffs.
2. CBR/VBR, bitrate, encoding, and sample-rate details.
3. Peak level, RMS, dynamic-range, and loudness measurements.
4. Channel layout and encoding-mode details such as stereo, joint stereo, and mono.

Those four outcomes are the minimum viable product. Batch folders, evidence-backed verdicts, integrity checks, comparison, and reports are the differentiators that make Audio-V a category-leading workstation.

The phrase “100% accurate, unaltered, raw spectrogram” needs a scientifically precise interpretation. A spectrogram is an STFT-derived view whose appearance changes with window function, FFT size, overlap, scaling, normalization, and color floor. Audio-V must expose and export those settings, preserve the decoded sample values, and never imply that one rendering is the only valid representation. Sonic Visualiser documents the same time-versus-frequency-resolution tradeoff in its [spectrogram reference](https://sonicvisualiser.org/doc/reference/3.2/en/#spectrogram).

## Product boundary

Audio-V is an audio integrity and fidelity workstation, not a general music player, tag editor, downloader, or mastering suite.

No playback transport is in scope. Audio comparison uses decoded measurements, waveform envelopes, spectra, and identity evidence without becoming a player. Lyrics, scrobbling, equalizers, spatial effects, and library playback are explicitly excluded. This keeps every primary action aimed at assessment, verification, comparison, reporting, or safe non-destructive remediation.

## AudioAuditor parity contract

The official [AudioAuditor website](https://audioauditor.org/) and [source repository](https://github.com/Angel2mp3/AudioAuditor) are the feature benchmark. Audio-V adopts assessor capabilities only when their evidence can be named and reproduced.

| AudioAuditor benchmark capability | Audio-V decision | Current state |
| --- | --- | --- |
| Automated batch analysis | Adopt | Implemented with recursive discovery, adaptively bounded 1–8 worker decoding, pause/cancellation, truthful finalization progress, checkpoints, and cache reuse |
| Fake-lossless / spectral-cutoff review | Adopt conservatively | Implemented as an explicitly heuristic origin assessment with inconclusive behavior |
| AI-generated audio detection | Research-gated | Generic “AI detected” verdict excluded until a validated corpus exists; offline C2PA validation, known generator metadata, and known identifier strings are implemented as separately labeled indicators rather than an AI verdict |
| MQA detection | Evidence-gated | Planned only as marker/profile disclosure; Audio-V will not imply MQA authenticity or decoding without a reproducible method |
| Fake stereo detection | Adopt with neutral language | Implemented as mono, sample-identical dual-mono, near-mono, distinct-stereo, or inconclusive using correlation and side-to-mid energy |
| Clipping analysis | Adopt | Implemented total/per-channel percentages, contiguous events and timeline, near clipping, BS.1770 true peak, and conservative scaled-clipping review; destructive peak reconstruction is never promised |
| Spectrogram viewer | Adopt and deepen | Implemented 512/2,048/4,096/16,384-point STFT, combined/L/R/L−R views, zoom/pan/region measurement, scientific colormaps, and single/batch PNG export |
| Waveform and spectrogram compare | Adopt without playback | Implemented independent File A/B loading, bounded waveform envelopes, paired spectra, normalized spectral-difference heatmap, and measurement table |
| Audio player, equalizer, lyrics | Exclude | No player, EQ, lyrics, queue playback, or transport code |
| CSV / PDF / XLSX / DOCX export | Adopt and add JSON | Implemented from one evidence model; JSON remains the lossless machine-readable format |
| Free / actively developed / open source | Product decision | Active development is current; source is AGPL-3.0-only, contributor and trademark policies are published, and development releases disclose their unsigned status |

AudioAuditor also advertises MQA and experimental AI checks. Audio-V now covers exact/internal silence, steep-transition, click/pop, and stuck-sample candidates; persistent Chromaprint identity relationships; offline C2PA inspection; known generator/signature inventory; and integer lossless bit-utilization review. MQA markers and a statistically calibrated AI classifier remain future work; neither may appear as authoritative until fixtures and failure boundaries exist.

## Capability matrix

Status meanings:

- **Implemented** — real data flows end to end and is covered by verification.
- **Foundation** — schema or UI exists, but the promised analysis does not.
- **Planned** — specified and prioritized, but not implemented.
- **Excluded** — intentionally outside the core product.

| Capability | User value | v0.4.29 source status | Disposition |
| --- | --- | --- | --- |
| File and folder ingest | Analyze one track or a full library | Implemented | Current |
| Recursive bounded discovery | Avoid freezing on large trees | Implemented | Current |
| Technical metadata | Codec, container, rate, depth, channels, duration | Implemented | Current |
| CBR/VBR/ABR mode | Verify encoding details requested by Jota | Implemented from packet evidence where the demuxer exposes it | Current |
| Frame-level bitrate statistics | Show average, percentile range, deviation, and coverage | Implemented for demuxers that expose packet size and duration | Current |
| Full decode integrity | Detect truncation and malformed frames | Implemented | Current |
| FLAC STREAMINFO MD5 | Deterministic lossless integrity evidence | Implemented | Current |
| Sample peak and RMS | Requested objective level measurements | Implemented | Current |
| Integrated LUFS and LRA | Standards-based loudness and variation | Implemented | Current |
| True peak | Detect inter-sample peaks | Implemented | Current |
| Clipping and near-clipping | Find damaged or overly limited masters | Implemented with per-channel events and timeline | Current |
| DC offset, silence, dropout | Diagnose signal defects | Implemented | Current |
| Channel layout and codec mode | Stereo, mono, 5.1, joint stereo | Implemented from probe and decoded evidence | Current |
| Stereo correlation / duplicate mono | Detect phase and fake stereo issues | Implemented | Current |
| Full-track spectrogram | Direct visual inspection | Implemented with multichannel inspection and export | Current |
| Adjustable analysis settings | Reproducible visual evidence | Implemented | Current |
| Effective-bandwidth estimate | Support upsample/transcode review | Implemented as conservative heuristic evidence | Current |
| Evidence-backed verdict | Explain facts versus heuristics | Implemented with scoped Clear, Review, Failed, and Analysis error outcomes | Current |
| Human review disposition | Record how a person handled a result without rewriting machine evidence | Implemented with seven explicit outcomes, optional notes, timestamps, and report export | Current |
| Batch queue, pause, resume, cancel | Library-scale workflow | Implemented with crash-safe checkpoints, immediate cancel acknowledgement, hard worker recycling, and conservative recovery limits | Current |
| Saved cache and sessions | Resume audits and avoid repeated work | Implemented with SQLite persistence, startup interruption recovery, and suspect-file isolation | Current |
| Storage reclamation | Keep large cleared histories from consuming disk indefinitely | Implemented with incremental reclamation for new databases, measured legacy free space, and isolated one-time optimization | Current |
| PDF/XLSX/DOCX/CSV/JSON reports | Share and automate results | Implemented from a shared evidence model | Current |
| File/edition comparison | Distinguish masters and encodes | Implemented with independent loading and full-overlap multichannel null testing | Current |
| Duplicate fingerprints | Find identical audio across containers and sessions | Implemented with persistent SQLite index | Current |
| External MD5/SHA manifests | Verify file identity against supplied sidecars | Implemented | Current |
| AccurateRip/CTDB verification | Verify CD extraction provenance when context exists | Planned | Post-1.0 |
| AI-generated audio detection | Experimental and difficult to validate responsibly | Deterministic provenance indicators implemented; statistical classifier deferred | Research only |
| Full music-player features | Does not improve the central verdict | Excluded | Excluded |
| Metadata editing | Risks turning inspection into mutation | Excluded | Excluded from 1.x |

## Competitive findings

No single competitor invalidates Audio-V, but the bar is substantially higher than a spectrogram plus metadata:

- [Spek](https://www.spek.cc/about) is fast, cross-platform, supports FFmpeg formats, exports images, and makes spectrogram inspection immediate. It lacks a serious batch verdict and evidence workflow.
- [MediaInfo](https://mediaarea.net/en/MediaInfo/Support/MediaInfo/Support/Tags) has deep, dependable container and stream metadata, multiple exports, and a library interface. It does not answer signal-authenticity questions.
- [Sonic Visualiser](https://sonicvisualiser.org/features.html) is the benchmark for inspectable, adjustable visualization and responsive work on substantial audio. It is an expert analysis environment rather than a decisive library auditor.
- [Fakin’ The Funk](https://fakinthefunk.net/) is centered on batch quality estimation and frame scanning. Its value validates the use case, while its classifications also demonstrate why Audio-V needs inspectable evidence and explicit uncertainty.
- [AudioAuditor](https://audioauditor.org/) currently has the broadest directly comparable feature list: spectral estimation, clipping, MQA, fake stereo, loudness, true peak, comparison, exports, batch tools, and a Windows GUI. Audio-V cannot compete by matching a checklist alone; it must win on cross-platform parity, scientific transparency, reproducibility, workflow focus, and validation quality.
- [Lossless Audio Checker research](https://secure.aes.org/forum/pubs/conventions/?elib=17972) demonstrates that upscaling, upsampling, and some transcoding detection can be validated against ground truth. That is a better model than inventing an opaque “quality percentage.”

## Scientific and standards contract

Audio-V measurements must name their governing method:

- Programme loudness and true peak: [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I).
- EBU mode, momentary/short-term/integrated loudness, and loudness range: [EBU R 128 and Tech 3341/3342](https://tech.ebu.ch/loudness/).
- FLAC integrity: decode and compare the unencoded PCM MD5 stored in STREAMINFO as described by [Xiph](https://xiph.org/flac/documentation_format_overview.html).
- CD-rip provenance: only call a rip verified when it matches a suitable external database such as [AccurateRip](https://accuraterip.com/) with the required disc context. A matching FLAC MD5 proves internal stream integrity, not provenance.
- Fingerprints: use local [Chromaprint](https://acoustid.org/chromaprint) for similarity and duplicates. Any AcoustID lookup must be opt-in because it is a network call with service terms and rate limits.

Every heuristic classifier must ship with:

- A versioned algorithm and settings.
- A controlled corpus with ground truth.
- Per-class false-positive and false-negative results.
- Evidence for and against the verdict.
- Explicit `inconclusive` behavior.
- Regression protection for historical recordings, vinyl transfers, analog tape, low-pass mastering, silence, speech, and unusual genres.

## Architecture decision

The Oracle Engine must be an independent, versioned worker rather than renderer code.

### Gate 1 implementation status

- Oracle file analysis now executes in a bounded, crash-replacing worker-thread pool. The Electron main process coordinates authorized jobs but does not perform PCM, FFT, or Oracle classification loops.
- Audit sources, incremental results, warnings, and terminal states are persisted to a WAL-mode SQLite session database. Canceled and failed sessions retain completed records.
- Reports are generated from authoritative main-process session/file records rather than renderer-supplied measurement objects.
- True-peak remediation derives its gain from the current authoritative Oracle record rather than accepting a renderer-supplied measurement.
- Renderer navigation, permission requests, and content loading use default-deny policies.
- Spectrogram power and waveform envelopes are channel-safe and no longer erase opposite-polarity stereo material.
- Audit history can reopen persisted evidence or clear every terminal session after an explicit confirmation. Clearing is blocked during an active audit and does not delete source audio, reusable Oracle cache, or the independent Identity index. A small foreground transaction hides terminal sessions immediately; physical saved-file records are then reclaimed in bounded 50-record background transactions with renderer progress, foreground storage interleaving, and launch-time continuation after interruption. At startup, orphaned running sessions become explicit interrupted checkpoints; the last source label is restored, adaptive resume avoids preloading the large partial result set, completed cache records are reused, and files active during interruption are validated serially before the saved worker profile is restored. A candidate that repeats the interruption is quarantined alone on the next resume. Requested and effective limits remain separately visible, and an explicit prior-limits path discloses its repeat-crash risk. Active queues can pause after current jobs finish. Cancellation rejects active work immediately, interrupts discovery/checksum/finalization stages, gives native decoders a cooperative shutdown window, then recycles any analysis worker blocked in synchronous computation. Completed records remain checkpointed, and failed records can be retried.
- New SQLite databases enable incremental page reclamation before schema creation. Settings reports total, live, and reclaimable database bytes. A legacy database with material free space can run one isolated `VACUUM` while no audit or history cleanup is active; this preserves logical cache, fingerprint, and session records, returns free pages to the operating system, and enables bounded future reclamation.
- The legacy 300-entry JSON cache migrates once into the unbounded SQLite Oracle cache, keyed by file size, modification time, and Oracle engine version.
- Compare now runs a separate decoded-signal worker that measures offset, gain, polarity, correlation, residual energy, and relationship.
- Spectrum analysis now stores a selectable 512-point overview and 2,048-point detail tier.

Gate 1 is complete at the repository level. Compare uses bounded alignment estimation and then null-tests the complete overlapping decoded tracks across every matching channel; channel-count mismatches are disclosed instead of silently coerced.

### Gate 2 implementation status

- All SQLite session and cache access now runs in a dedicated storage worker. Renderer and Electron main-process work no longer performs synchronous database operations.
- Analysis uses an adaptive, bounded worker schedule derived from available CPU parallelism instead of fixed two-file waves. Result order remains deterministic even when files finish out of order.
- Session writes are buffered into bounded batches and committed transactionally, reducing per-file worker messages and SQLite transaction overhead.
- Renderer progress events are coalesced to animation frames, and the audit result table is virtualized with overscan. A 10,000-record audit retains authoritative application state while mounting only the visible rows.
- Rich waveform and spectrogram arrays no longer accumulate in the Electron main process or renderer. Live queues carry measurement summaries without visual matrices; durable history retains a bounded 32-region spectrogram overview, 160-point waveform, the complete measurement/verdict summary, and the independent 4,096-point classifier summary. Higher inspection tiers regenerate from the selected source on demand, and only 16 recently used detailed records remain resident.
- Resource controls are per-file ceilings rather than independent speed settings. Before workers start, Audio-V resolves one to eight requested file workers against a system-wide budget capped at 20% of physical memory or 8 GB and 75% of logical CPUs; unsafe combinations are visibly reduced.
- Current-audit fingerprint matching uses exact-hash and ±3-second duration indexes instead of an all-pairs scan. Exact candidate expansion is capped, near-match expansion is deferred above 2,000 files, and per-file historical enrichment is deferred above 1,000 files. Exact duplicates remain available while end-of-audit relationship assembly stays bounded.
- Checksum manifests are indexed once per source, and the Oracle reuses an already-computed SHA-256 result instead of rereading the file.
- Mounted and removable libraries use eight-way bounded directory discovery. Full audits stage each active macOS `/Volumes`, Windows UNC, mapped-drive, or non-system-drive file through one 4 MB sequential transfer, run repeated forensic passes locally, and delete the copy afterward. Staging follows the resolved 1–8 file concurrency and an aggregate temporary-space reservation, rather than adding an independent unbounded “network sessions” control.
- Authoritative JSON and CSV session reports stream from paged SQLite records without a fixed payload limit. PDF, DOCX, and XLSX generation also runs outside the Electron main process and consumes compact session evidence instead of hydrating every full spectrogram.
- Compiled-worker verification now exercises Oracle analysis, comparison, durable storage, and streamed report export.
- Rotating JSONL application logs record lifecycle, scan/session identity, resource limits, per-file starts and outcomes, Oracle attempt/retry/timeout events, storage-worker recovery, checkpoint state, and renderer/child-process termination. Logs remain local, are size bounded, and are separate from the privacy-safe diagnostics export.
- Successful scan completion logs now include application version, elapsed wall time, file and error counts, point-in-time main-process RSS, database size, reclaimable bytes, source kind, and run mode. The RSS field is explicitly not represented as whole-application peak memory.
- Exhausted Oracle worker timeouts persist as per-file `Analysis error` records with the exact filename, `oracle-engine` failure stage, worker code, attempt count, and evidence. The failed worker is replaced and the remaining library continues; infrastructure-error cache entries are retried on later audits.
- Per-file Reports use independent bounded list and evidence panes. Selecting a row anywhere in a long report keeps the evidence visible beside it, resets the new evidence report to its header, and preserves independent scrolling in both wide and stacked window layouts.
- `npm run benchmark:scale` enforces repeatable persistence and restoration budgets for dense-evidence 100-, 1,000-, and 10,000-record sessions. The v0.4.25 benchmark persisted 10,000 records in 7.67 seconds, restored compact history in 385 ms, and occupied 435.5 MB across the cumulative 11,100 stored records, below the 600 MiB database budget.

These dense-evidence figures validate storage and compact state retrieval on the development Mac; they do not represent full audio decode throughput.

Gate 2 is complete for the repository-level scale foundation. Market-readiness still requires hardware and clean-VM profiling on Apple Silicon macOS and supported Windows versions with real 100/1,000/10,000-file libraries, 1/10 GbE shares, removable/network volumes, long-duration files, constrained memory, cancellation under load, and thermal throttling. Discovery still retains a sorted path list, renderer filters remain linear in session size, and rich document exports remain whole-session operations inside the storage worker. Those are measured optimization candidates rather than hidden claims of unlimited scale.

### Gate 3 implementation status

- Oracle Engine v5 separates heuristic rule strength from evidence coverage. Fixed rule values are no longer presented as provenance probabilities.
- Every successfully decoded Origin Assessment reports 0–100% evidence coverage plus a machine-readable reason code. Inconclusive files explain whether duration, measurable bandwidth, or cutoff stability prevented classification.
- Origin coverage, reason, and score type flow through the details UI and every report format.
- A versioned golden-corpus manifest covers native wideband controls, known MP3-to-FLAC and upsample transformations, intentional low-pass material, digital silence, insufficient duration, and narrow-band tonal content.
- `npm run validate:fidelity` executes the compiled Oracle against the corpus, blocks regressions, and records a machine-readable scorecard in `build/fidelity-validation-latest.json`.
- Changing the failure semantics advanced the engine/cache identity to `0.4.0-oracle-v6`, preventing older catch-all damage interpretations from appearing under the new model.
- Deep spectrogram inspection and clipping-event evidence advance the current identity to `0.5.0-oracle-v7`, invalidating cached v6 measurements that do not contain the expanded evidence model.

Gate 3 now has an enforceable validation foundation, but it is not statistically calibrated. The included corpus is synthetic and deliberately small. Production-grade provenance confidence requires a licensed, ground-truth library across genres, recording eras, mastering processes, analog transfers, speech, silence, sample rates, codecs, bitrates, resampling methods, and intentional filtering, with train/calibration/test separation and published per-class false-positive and false-negative results. Until that corpus exists, Audio-V will continue to use **possible**, **bandwidth limited**, or **inconclusive** language instead of claiming universal origin verdicts.

### Gate 4 implementation status

- Binary identity is explicit rather than dependent on whichever credentials happen to exist on the build machine. The default macOS build disables certificate discovery, notarization, and Hardened Runtime but applies a complete ad-hoc bundle signature so Gatekeeper sees a valid integrity seal; the default Windows build disables executable signing.
- Separate future signed build commands retain macOS Hardened Runtime/notarization and Windows Authenticode integration without requiring credentials for open-source development releases.
- Package inspection verifies the two required DMGs, Windows installer, Windows portable executable, embedded application archive, FFmpeg/ffprobe engines, notices, engine manifest, PE signatures, and both Intel/Apple Silicon architectures in the Universal application and engines. Packaged-runtime smoke tests then launch the native application, fully analyze a real FLAC fixture, verify the current Oracle engine identity, and exit through a guarded QA channel.
- Every release receives SHA-256 checksums and `UNSIGNED_RELEASE_MANIFEST.json`, which declares the distribution and signing policy for each exact artifact.
- Maintainers run the full suite and package inspection locally before publication. An optional manual-only workflow can produce macOS and Windows Oracle snapshots over identical fixtures and compare deterministic values exactly and measured values within documented tolerances.
- Release publication is a local-build, direct-upload process modeled on Deemix Remastered. Tag/package version mismatch, missing project licensing, failed artifact inspection, or a failed release-candidate check blocks maintainer publication.
- User documentation explains checksum verification, platform warnings, safe per-application approval, portable-state behavior, and why managed Windows policy may prevent unsigned execution.

Gate 4 is complete at the repository and local-package level. Actual macOS-versus-Windows parity remains unproven until maintainers collect and compare native snapshots locally or explicitly dispatch the optional workflow; clean-VM installation/upgrade/uninstall testing remains a release-candidate activity. The former public-release license blocker is resolved by the Gate 5 `AGPL-3.0-only` decision.

### Gate 5 implementation status

- Audio-V is licensed `AGPL-3.0-only`. Every application package includes the canonical license, copyright notice, corresponding-source notice, third-party notices, engine manifest, and trademark policy.
- The Contributor License Agreement preserves contributor ownership while granting DRAZY the explicit sublicensing and relicensing authority needed for continued AGPL distribution, commercial editions, and dual licensing. Pull requests must record affirmative agreement.
- The Audio-V name, logo/icon, Oracle Engine identity, and official-release claims are reserved separately from the code license; compliant forks must use distinct branding.
- Primary navigation, verdict filters, analysis tabs, virtual result rows, canvases, and live scan state expose keyboard and assistive-technology semantics. A skip link, visible focus, reduced-motion behavior, and Command/Ctrl keyboard workflow are implemented.
- An automated axe-core gate checks the production renderer and fails on serious or critical accessibility violations. The current empty-state audit passes 41 rules with no serious or critical violations.
- Settings exports a privacy-safe diagnostic record containing application/runtime versions, aggregate session status, and engine capabilities without accepting filenames, paths, hashes, tags, or audio evidence. A unit test enforces the aggregate-only boundary.
- The beginner user journey, plain-language Oracle Engine and glossary, scientific methodology, privacy/security, unsigned-installation, release, contribution, and release-candidate documents cover the complete product workflow and limitations at different levels of depth.
- `npm run verify:release-candidate` produces a machine-readable automated readiness result from licensing, documentation, accessibility, fidelity, scale, and artifact evidence.

Gate 5 is complete for automated repository readiness and local macOS validation. It is not yet honest to call the application market-ready: the manual clean-environment matrix in `docs/RELEASE_CANDIDATE_CHECKLIST.md`, actual Windows packaged runtime, locally captured Windows/macOS parity evidence, Intel hardware launch, VoiceOver/Narrator workflow review, display scaling, upgrade/uninstall, and real-library performance remain external acceptance work. Signing/notarization is an explicit policy waiver rather than a failure.

### Real-world validation milestone status

- Corpus governance is separated from the software CLA through `CORPUS_CONTRIBUTION_AGREEMENT.md`.
- The source-master registry enforces rights records, SHA-256 identity, chain of custody, public-versus-private disposition, and contributor-group partitions.
- Deterministic recipes generate at least ten native, lossy-transcode, upsample, and intentional-filter cases per imported master.
- Evaluation records accepted classifications, detector confusion counts, inconclusive behavior, and exact 95% Clopper-Pearson binomial intervals.
- Settings reads the exact status shipped with the package and exposes master, contributor-group, case, corpus-version, and claim-level information.
- Reports state that heuristic rule strength is not a probability-calibrated provenance claim.

Infrastructure is complete, while source acquisition remains factual external work. With no licensed masters present, the enforced state is `awaiting-source-masters` and the claim level is `synthetic-regression-only`.

### Provenance, automation, and identity milestone status

- Oracle Engine v10 validates embedded and locally resolvable C2PA Content Credentials with C2PA Tool 0.27.3. Remote-manifest and OCSP fetching are disabled so ordinary audits remain deterministic and private.
- Valid, untrusted-signer, invalid, absent, unsupported, and tool-error states remain distinct. A credential can validate a signed provenance statement; it does not establish truthfulness, human authorship, ownership, or audio quality.
- Known generator names in editable metadata and known watermark/signature identifier strings in raw file bytes are inventoried with their exact source and limitation. Audio-V does not claim to decode proprietary watermarks and does not produce a generic AI Yes/No badge.
- Local Chromaprint fingerprints identify exact-fingerprint and high-similarity relationships within the current audit and across a dedicated, browsable Identity workspace. The historical index can be rebuilt from sessions, pruned for missing sources, or cleared without deleting audit evidence. Optional AcoustID recognition sends only fingerprint plus rounded duration and returns linked MusicBrainz recording leads; it is off by default and its key is never persisted. Direct MusicBrainz enrichment is a separate no-key opt-in that prefers an embedded MBID, otherwise uses the strongest AcoustID candidate, caches unique IDs, obeys the public one-request-per-second ceiling, and preserves bounded artist, ISRC, date, and release-group context as neutral identity evidence.
- Metadata Inventory includes bounded native tags, BPM, ISRC, MusicBrainz IDs, declared ReplayGain values, embedded cue sheets, and adjacent cue-sheet references without invoking the decoder. Full Audit adds calculated RG2 track gain, album eligibility/reason evidence, grouped album gain, independent cue INDEX 01 programme analysis, and separate INDEX 00 pregap analysis.
- Full audits add DR meter values and integer-lossless bit-utilization/truncation assessment. Possible zero-padded depth is an origin advisory, not deterministic file damage.
- The accepted format list now follows a broad FFmpeg-backed set of common audio and audio-container extensions. Actual support remains decoder-runtime evidence rather than a promise based only on a filename suffix.
- The packaged headless CLI accepts files and recursive folders, emits the same compact JSON evidence model, supports CI evidence-policy exit codes, and exposes worker, JavaScript heap, FFmpeg-thread, and native-process RSS limits. The desktop exposes the same resource policy for the next audit.
- EBU R128 and DR measurements share one FFmpeg filter-graph pass. Full PCM analysis remains streaming and bounded; local fingerprinting performs one additional decode capped at 120 seconds. Opting into AcoustID performs a second capped fpcalc pass to create the service’s encoded fingerprint.

This milestone deliberately stops before a statistical AI classifier or automatic network service. Those claims remain corpus-gated.

### Oracle v10 refinement status

- A three-case native decoded defect corpus gates the clean, single-impulse click/pop, and non-zero stuck-sample behaviors. It is labeled synthetic regression evidence and does not claim real-world calibration.
- Compare accepts explicit one-to-one channel maps for differing decoded layouts. Without a map, mismatched layouts remain a bounded preview rather than receiving a misleading null.
- ReplayGain reports why album gain is unavailable, including missing album identity, insufficient matching tracks, incompatible channel counts, measurement failure, and large-library deferral. Audits above 1,000 files retain calculated track gain but skip the otherwise unbounded second full-library decode; selecting an album or a smaller source calculates exact grouped album gain.
- Cue programme segments stop at the next INDEX 00/01 boundary; declared INDEX 00 pregaps are decoded and reported separately.

### Oracle v11 evidence-model status

- Results now expose separate integrity, signal-defect, spectral-origin, provenance, and delivery lanes. Advisory provenance strings, stereo relationships, bit padding, positive true peak without a selected delivery profile, and steep transitions no longer force the overall verdict to Review.
- Strict full-decode failures receive a complete tolerant confirmation analysis. Only failure of both paths can establish deterministic stream damage; tolerant success becomes recoverable structural nonconformance for Review.
- The origin classifier uses a dedicated 4,096-point, 48-region tier, retains bounded summary evidence rather than another persisted matrix, and requires a stable band edge plus corroborating evidence before issuing a strong possible-upsample or possible-lossy-transcode pattern.
- Top-level and origin probability-like percentages are retired. The engine publishes ordinal rule strength, evidence coverage, regional stability, and independent-indicator count as distinct quantities.
- Click/pop detection uses a locally adaptive robust residual threshold. Finding promotion considers magnitude, repetition, or duration; steep transitions alone remain advisory.

Recommended layers:

1. **Probe** — container, codec, tags, frame structure, and declared properties.
2. **Decode** — bounded streaming conversion to normalized PCM without loading entire albums into memory.
3. **Measure** — deterministic integrity, levels, loudness, stereo, and defect metrics.
4. **Spectrum** — reusable STFT tiles, spectrogram pyramids, and spectral descriptors.
5. **Classify** — versioned evidence rules and calibrated probabilistic models.
6. **Persist** — SQLite session/cache keyed by file identity, engine version, and settings.
7. **Present** — renderer consumes typed results and never invents measurements.

FFmpeg is a viable decoder and measurement backend and exposes filters such as `astats`, `ebur128`, `silencedetect`, `aphasemeter`, and `showspectrumpic` in its [official filter documentation](https://www.ffmpeg.org/ffmpeg-filters.html). Packaging must not begin until a redistributable binary policy is selected: FFmpeg is normally LGPL, but optional components can make a build GPL, as described in its [legal guidance](https://www.ffmpeg.org/legal.html). Audio-V must record the exact binary version/configuration in every report and ship the required notices and source offer.

## Release gates

No build may be called a beta until:

- The original four-feature request works on real files on both macOS and Windows.
- The packaged application contains every required engine binary; it cannot depend on Homebrew, PATH, or a developer machine.
- Decorative plots and demo verdicts are absent from production mode.
- Results from macOS and Windows agree within documented tolerances.
- DMG and EXE installation is tested on clean virtual machines.
- The analysis corpus includes known-good and intentionally transformed fixtures.
- Every release publishes checksums, third-party notices, and an engine manifest.
- Signing/notarization status is explicit.

## Immediate build sequence

1. Remove fictional production data and repair metadata semantics.
2. Add single-file and multi-file ingest beside folder ingest.
3. Establish scanner and contract tests with generated fixtures.
4. Select and license the packaged decode backend.
5. Implement full decode, technical probe, peak/RMS, LUFS/LRA/true-peak, and channel mode.
6. Implement real spectrogram tiles and settings.
7. Add the golden corpus before adding transcode or upsample verdicts.
8. Add queueing, cache, reports, and comparison after the measurements are trusted.

## Corrections completed during this audit

- Production now starts empty; fictional tracks and verdicts were removed.
- Decorative spectrogram and loudness charts no longer masquerade as measurements.
- Individual and multiple file selection now sit beside recursive folder ingest.
- Codec profile is no longer mislabeled as CBR/VBR mode.
- Metadata-probe failure is no longer called proven stream damage.
- Source warnings no longer abort all valid files in a mixed selection.
- Packaged FFmpeg/ffprobe 8.1.2 LGPL engines perform complete multi-codec stream decoding and technical probing on macOS and Windows.
- Real sample peak, RMS, DC offset, clipping, near-clipping, stereo correlation, duplicate-mono, EBU R128 integrated loudness/LRA, and BS.1770 true-peak metrics run automatically during batch ingest.
- Measured 512- and 2,048-point Hann-window STFT tiers are created for successfully decoded formats during active inspection. Durable large-library history retains a bounded 32-region overview and the 4,096-point classifier summary; 4,096- and 16,384-point combined/L/R/L−R presentation views decode on demand and expose zoom, pan, region measurement, scientific colormaps, and batch PNG export.
- Streaming packet analysis reports p05/p95 bitrate, deviation, duration coverage, and observed CBR/VBR for every demuxer that exposes packet size and duration.
- Native FLAC files receive an independent canonical decoded-PCM comparison against the MD5 stored in STREAMINFO.
- Exact digital-silence runs, internal dropout candidates, steep transition candidates, crest factor, and peak-to-loudness ratio are measured and disclosed.
- Conservative spectral-origin review is regression-tested against native-wideband, MP3-to-FLAC, and 44.1-to-96 kHz controls; it never claims that bandwidth alone proves provenance.
- The Oracle produces scoped **Clear**, **Review**, and **Failed** outcomes for complete-decode, signal, loudness, and spectral checks, with deterministic evidence and an explicit provenance disclaimer.
- Compare performs real file-to-file property and measurement comparison; Repair provides non-destructive triage; Reports summarizes the session and exports complete JSON evidence.
- Deterministic decoder corruption and decoded-audio checksum mismatches finish as **Failed** with a stage and exact evidence. Tool, timeout, resource, probe, measurement, and internal failures finish as **Analysis error** without making a damage claim.
- Metadata Inventory is an explicit non-decoding workflow whose records remain **Not analyzed** until a Full Oracle Audit runs; it is no longer represented in verdict distribution as “Metadata only.”
- Batch audits can terminate active decoders, preserve completed rows, and restore unchanged v3 results from a persistent size/mtime-invalidated cache.
- Spectrogram inspection supports linear/log frequency display, −120/−100/−80 dBFS floors, cursor time/frequency/level readout, zoom/pan, exact dragged regions, combined/left/right/L−R views, scientific colormaps, and single/batch PNG export.
- Clipping evidence includes total and per-channel percentages, contiguous event grouping, a location timeline, and a conservative repeated-plateau indicator for possible scaled clipping. These remain Review findings unless independent deterministic integrity evidence establishes failure.
- Review now explains the exact trigger, distinguishes integrity failure from measured or heuristic warnings, and offers acknowledgement, evidence export, source reveal, re-analysis, and Repair routing.
- Repair Lab provides a visible diagnose/choose/verify process. Positive true-peak findings can create a separate −1 dBTP FLAC working copy that is automatically decoded and audited; sources are never overwritten, and the UI explicitly states that gain reduction does not reconstruct clipped peaks.
- Origin Assessment separates container-declared profile data from measured spectral evidence and exposes the classification, heuristic rule strength, evidence coverage, measured bandwidth, cutoff data, supporting basis, and provenance limitation.
- Repair is modeled as attention and remediation rather than an assertion that every listed file needs repair. Each item declares whether mitigation is optional, automatic repair is unavailable, manual verification is required, source comparison is recommended, or replacement is recommended.
- True-peak remediation preserves a 16-bit or 24-bit source word length by default and offers explicit 16-bit compatibility or 24-bit processing copies. Sixteen-bit output is triangular-dithered after gain processing; sample rate, channels, metadata, and embedded artwork are preserved and the verified output depth must match the selection.
- Compare has independent File A and File B disk selectors in addition to current-audit choices; directly loaded comparison files are decoded without replacing the audit session.
- Reports is explicitly the current audit report. Every file row opens identity, engine, decoded measurements, origin assessment, expandable evidence, and direct audit/compare/remediation/export actions.
- Folder and adjacent-file audits discover GNU, BSD, and filename-specific MD5, SHA-1, SHA-256, and SHA-512 sidecar manifests. Matching entries become deterministic support; mismatches become Review because they disprove manifest identity without pretending to know whether the file or manifest is authoritative.
- Stereo authenticity now distinguishes exact dual mono, near mono, distinct stereo content, mono, and inconclusive results using both Pearson correlation and side-to-mid energy. Dual/near mono is a review signal, not an accusation of deceptive intent.
- Compare renders bounded full-track waveform envelopes, paired measured spectrograms, and a normalized B-minus-A spectral heatmap alongside identity, format, loudness, clipping, bandwidth, stereo, and checksum values; no playback surface was introduced.
- Audit and per-file evidence export to PDF, XLSX, DOCX, CSV, or JSON from a shared 40+ column evidence model. Production dependencies remain free of known audit advisories.
- The desktop typography floor is 11px for utility labels and 12–14px for working text, with larger rows, controls, and analysis panels.
- The 142-test regression suite covers discovery, mounted-source staging and identity preservation, malformed metadata, PCM math, internal WAVE decoding, spectral-bin detection, multi-codec full decoding, FLAC audio-MD5 mismatch, loudness/true peak, continuity, packet-rate behavior, fidelity controls, persistent fingerprint management, AcoustID application-key normalization and service preflight, direct MusicBrainz enrichment and unique-ID caching, desktop IPC error normalization, cue programme/pregap segments, calculated and large-library-deferred ReplayGain eligibility, explicit comparison channel mapping, resource enforcement, adaptive crash recovery with cache bypass, structured log rotation, cache invalidation, prompt cancellation of blocked workers, virtualized large-session viewport recovery, process cancellation, source-preserving repair output, attached-artwork retention, source preservation, truncation, and verdict truthfulness.
- Production dependencies pass `npm audit --omit=dev`; remaining advisories are confined to the upstream packaging toolchain.
- Release packages contain third-party notices and a machine-readable engine capability manifest.
