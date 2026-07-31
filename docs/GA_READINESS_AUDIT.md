# Audio-V GA readiness audit

Assessment date: 2026-07-29
Assessment basis: Oracle v12 source, automated gates, packaged-release policy,
product documentation, and comparison with the published capabilities of
AudioAuditor and Spek.

## Executive rating

Audio-V is **92% GA-ready** on a weighted engineering and product rubric. It is
already stronger than a spectrogram-only utility and is broadly competitive
with AudioAuditor's core assessment workflow. It should remain labeled a
release candidate until the remaining external acceptance gates below are
witnessed.

The score is not an accuracy probability and does not mean that 92% of verdicts
are correct. It measures how much of the work required for a defensible,
supportable general release is complete.

| Area | Weight | Current score | Evidence |
| --- | ---: | ---: | --- |
| Scientific validity and verdict semantics | 25% | 88% | Standards-based loudness and true peak, explicit EBU/ATSC/AES delivery profiles, complete decode, FLAC PCM MD5, versioned five-lane rules, explicit uncertainty |
| Functional assessment completeness | 20% | 96% | Batch audit, metadata, signal, spectral, provenance, delivery profiles, comparison, reports, CLI, cue, ReplayGain, fingerprints, and disc-verification eligibility |
| Reliability, scale, recovery, and cancellation | 20% | 93% | Bounded workers and fingerprint finalization, SQLite checkpoints, adaptive resume, suspect isolation, privacy-safe acceptance evidence, 10,000-record storage benchmark, native-Windows 6,000-file completion, and measured page reclamation |
| Workflow, responsive UI, and accessibility | 15% | 92% | Evidence-first review, human disposition, scalable layouts, keyboard and automated accessibility gates |
| Cross-platform acceptance | 10% | 82% | Four package targets exist; native Windows portable and clean Apple Silicon behavior are maintainer-witnessed, while the Windows installer, Intel Mac, assistive technology, and display-scale matrix remain incomplete |
| Security, privacy, documentation, and release operations | 10% | 97% | Local-first analysis, opt-in AcoustID, bounded IPC, versioned P0/P1 defect gate, AGPL policy, checksums, unsigned-build disclosure, reproducible release scripts |

Weighted result: **91.5%** (displayed as 92%).

## What a verdict can and cannot mean

### Clear

Clear means every completed check in the reported Oracle scope passed without
review-level evidence. It does not certify a studio master, ownership, artistic
quality, or an untouched production history.

### Review

Review means the scan completed and found material measured, structural, or
strong multi-feature heuristic evidence that deserves a person’s attention.
Intentional mastering can produce the same measurements as a defect or earlier
transcode, so Review is not silently promoted to Failed.

### Failed

Failed is reserved for deterministic evidence against the file itself:

1. strict and tolerant full-stream decoding both fail with recognized
   corruption evidence; or
2. decoded native FLAC PCM does not match its stored STREAMINFO MD5.

Tool launch faults, timeouts, worker failures, unavailable network sources, and
internal exceptions are Analysis errors, not file failures.

### Human approval

A person cannot “approve” an Oracle verdict into a different scientific result.
Audio-V instead stores a separate human disposition: acknowledged, accepted as
intentional, confirmed issue, possible false positive, remediated copy
verified, replacement required, or follow-up required. Reports preserve the
machine verdict and human conclusion independently.

## Competitive position

### Compared with Spek

Audio-V exceeds Spek as a library assessor: it adds recursive batch processing,
integrity checks, loudness, defects, versioned verdicts, evidence reports,
comparison, history, recovery, and automation. Spek remains an excellent,
focused spectrogram viewer with a smaller conceptual and operational surface.

### Compared with AudioAuditor

Audio-V is broadly at parity in core file inspection and is stronger in
cross-platform intent, transparent verdict precedence, immutable evidence,
large-library recovery, historical identity indexing, standards-backed
delivery profiles, explicit uncertainty, and headless JSON automation.
Audio-V now inventories MQA-related metadata/profile declarations but does not
pretend that a marker is authenticated MQA or an unfolded signal. AudioAuditor
retains a visible checklist advantage in experimental AI indicators. Audio-V
intentionally does not add an opaque AI yes/no badge without reproducible
validation.

## Remaining GA blockers

These cannot be closed honestly by another broad feature pass:

1. Complete a clean Windows installer, upgrade, retained-data, report-export,
   and uninstall journey. Native Windows portable operation and a completed
   6,000-file audit are already maintainer-witnessed.
2. Complete and record the full Apple Silicon install, unsigned Gatekeeper,
   mounted/removable source, cancel, recovery, report, and upgrade matrix.
   Clean Apple Silicon operation is already maintainer-witnessed as stable.
3. Run the Universal package on real Intel Mac hardware.
4. Witness 100%, 125%, 150%, and 200% Windows display scaling plus macOS scaled
   displays and narrow snapped windows.
5. Perform manual Narrator and VoiceOver journeys. Automated accessibility
   checks cannot prove assistive-technology usability.
6. Export an instrumented acceptance record from a large real-library run so
   exact package identity, wall time, peak memory, final database size,
   cancellation latency, and recovery behavior accompany the witnessed
   completion claim.

## Scientific limit that remains

The origin classifier is a conservative, versioned heuristic with synthetic
regression controls. It is not a calibrated probability of source history.
Audio-V now has a five-source external dataset registry, license-aware import
adapters, source-level 60/20/20 partitioning, 36 controlled transformation
recipes, bounded deterministic 60-second analysis windows, exact tool provenance, and
per-dataset/split/recipe scorecards. Those controls make a real external
evaluation reproducible without requiring private studio masters. Until the
public-reference target and held-out challenge evaluation are populated,
Audio-V should continue saying **possible** and **inconclusive**, publishing
rule strength and evidence coverage rather than a fabricated confidence
percentage.

The current external scorecard covers 85 independent references and 2,295
controlled cases across all five registered datasets. The public population
reaches 50 independent references; local challenge coverage now includes EBU
SQAM, composition-unique MAESTRO recordings, and balanced MUSDB18-HQ train/test
mixtures. This is strong false-advisory evidence, not an origin-sensitivity
claim: the measured scorecard still reports zero positive detections across its
controlled lossy and upsample derivatives, so probability calibration and
authoritative positive-origin claims remain gated.

## Post-1.0 opportunities

- Read-only AccurateRip or CTDB checksum lookup after the implemented disc
  eligibility contract, whole-disc assembly, and service/client review.
- Reproducible MQA payload authentication only if a lawful, testable,
  cross-platform method becomes available; metadata/profile marker disclosure
  is already separate from authenticity and decoding.
- A statistical AI-origin classifier only after corpus acquisition,
  calibration, and published false-positive/false-negative performance.
- Signed and notarized packages if the project later obtains platform
  certificates.

## Gold-release decision

The source and current packages are feature-complete enough for a release
candidate. A GA or gold label should require the six external acceptance gates
above, zero unresolved P0/P1 defects, a clean full regression, verified
four-package manifests, and a
release candidate that survives a defined soak period without a data-loss,
resume, cancellation, or verdict-classification regression.
