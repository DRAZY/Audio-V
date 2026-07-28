# Audio-V GA readiness audit

Assessment date: 2026-07-28  
Assessment basis: Oracle v11 source, automated gates, packaged-release policy,
product documentation, and comparison with the published capabilities of
AudioAuditor and Spek.

## Executive rating

Audio-V is **87% GA-ready** on a weighted engineering and product rubric. It is
already stronger than a spectrogram-only utility and is broadly competitive
with AudioAuditor's core assessment workflow. It should remain labeled a
development release until the external acceptance gates below are witnessed.

The score is not an accuracy probability and does not mean that 87% of verdicts
are correct. It measures how much of the work required for a defensible,
supportable general release is complete.

| Area | Weight | Current score | Evidence |
| --- | ---: | ---: | --- |
| Scientific validity and verdict semantics | 25% | 86% | Standards-based loudness and true peak, complete decode, FLAC PCM MD5, versioned five-lane rules, explicit uncertainty |
| Functional assessment completeness | 20% | 94% | Batch audit, metadata, signal, spectral, provenance, comparison, reports, CLI, cue, ReplayGain, fingerprints |
| Reliability, scale, recovery, and cancellation | 20% | 88% | Bounded workers, SQLite checkpoints, adaptive resume, suspect isolation, compact 10,000-file storage model |
| Workflow, responsive UI, and accessibility | 15% | 90% | Evidence-first review, human disposition, scalable layouts, keyboard and automated accessibility gates |
| Cross-platform acceptance | 10% | 68% | Four package targets exist; native Windows, Intel Mac, clean-VM, assistive-technology, and display-scale witnessing remains incomplete |
| Security, privacy, documentation, and release operations | 10% | 94% | Local-first analysis, opt-in AcoustID, bounded IPC, AGPL policy, checksums, unsigned-build disclosure, reproducible release scripts |

Weighted result: **87.1%**, rounded to **87%**.

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
large-library recovery, historical identity indexing, explicit uncertainty,
and headless JSON automation. AudioAuditor retains visible checklist advantages
in MQA marker detection and experimental AI indicators. Audio-V intentionally
does not add an opaque AI yes/no badge or imply authenticated MQA decoding
without reproducible validation.

## Remaining GA blockers

These cannot be closed honestly by more source code on the development Mac:

1. Run the packaged Windows installer and portable build on a native, clean
   Windows system, including a 5,000–10,000-file local or mapped-drive audit,
   cancel, crash recovery, resume, report export, and uninstall.
2. Run Apple Silicon and Universal DMGs on clean macOS accounts; witness the
   unsigned Gatekeeper path, mounted/removable volumes, a large-library audit,
   cancel, recovery, report export, and upgrade.
3. Run the Universal package on real Intel Mac hardware.
4. Witness 100%, 125%, 150%, and 200% Windows display scaling plus macOS scaled
   displays and narrow snapped windows.
5. Perform manual Narrator and VoiceOver journeys. Automated accessibility
   checks cannot prove assistive-technology usability.
6. Publish measured wall time, peak memory, database size, cancellation
   latency, and recovery behavior from representative real libraries.

## Scientific limit that remains

The origin classifier is a conservative, versioned heuristic with synthetic
regression controls. It is not a calibrated probability of source history.
Professional references and scientific rules constrain the claims, but they do
not substitute for a legally usable, provenance-labeled, held-out music corpus.
Until that corpus exists, Audio-V should continue saying **possible** and
**inconclusive**, publishing rule strength and evidence coverage rather than a
fabricated confidence percentage.

## Post-1.0 opportunities

- AccurateRip or CTDB verification when disc context is available.
- Reproducible MQA-compatible marker/profile disclosure, clearly separated from
  authenticity and decoding.
- A statistical AI-origin classifier only after corpus acquisition,
  calibration, and published false-positive/false-negative performance.
- Signed and notarized packages if the project later obtains platform
  certificates.

## Gold-release decision

The source is feature-complete enough for a release candidate. A GA or gold
label should require the six external acceptance gates above, zero unresolved
P0/P1 defects, a clean full regression, verified four-package manifests, and a
release candidate that survives a defined soak period without a data-loss,
resume, cancellation, or verdict-classification regression.
