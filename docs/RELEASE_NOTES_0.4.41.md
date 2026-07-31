# Audio-V v0.4.41 — Frozen Origin promotion gates

Audio-V v0.4.41 completes a source-separated evaluation of a multivariate
Oracle Origin candidate without weakening the production verdict method. The
candidate looked strong on controlled Slakh material but produced unacceptable
false advisories on independent music, speech, and narrow-band recordings, so
the new promotion contract correctly rejected it.

## What changed

- Adds a deterministic, regularized multivariate ranking experiment over 20
  spectral measurements plus explicit missing-value indicators.
- Separates development, calibration, frozen test, external challenge, and
  edge-abstention populations by source group.
- Publishes exact promotion requirements in
  `validation/real-world/origin-promotion-policy.json`.
- Publishes the complete rejected-candidate evidence in
  `validation/real-world/calibration/oracle-v12-multivariate-candidate-v1.json`.
- Adds source-group-balanced training, leave-one-source-group-out development
  evaluation, Wilson confidence intervals, and per-dataset false-advisory gates.
- Extends the accessibility audit from DOM rules into Chromium's exposed
  accessibility tree, the semantic layer used by VoiceOver and Narrator.

## Scientific result

The evaluation covered 1,870 candidate records across all 85 independent
source groups in the local five-source corpus. The lossy-origin model reached
0.926 development AUC and the upsample model reached 0.983, and both passed the
frozen Slakh test split. They did not generalize safely: the lossy model
produced false advisories in 37 of 61 pooled held-out negative source groups,
while the upsample model produced false advisories in 7 of 61.

The promotion decision is **rejected**. These experimental scores are not
probabilities, never produce `Failed`, never promote a file to `Clear`, and do
not affect Oracle Engine v12 production verdicts. A future candidate must be
developed without reusing the opened test population and then pass a new,
independent confirmation set.

## Verification

- 201 automated tests pass.
- The complete 2,295-case corpus passes the production acceptance evaluation.
- All 39 advertised extensions validate, including 29 native fixtures.
- The accessibility gate passes 41 DOM rules and checks 154 exposed semantic
  nodes, with no unnamed interactive controls.
- Source builds, worker isolation, CLI evidence, storage, defect, and dependency
  gates pass.

## Packages

- `Audio-V-0.4.41-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.41-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.41-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.41-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source development release. Verify package
> checksums and follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
