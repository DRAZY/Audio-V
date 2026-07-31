# Audio-V v0.4.39 — Five-source validation corpus

Audio-V v0.4.39 expands the evidence behind Oracle Engine without overstating
what that evidence proves. It adds a reproducible, license-aware external
corpus workflow and publishes the measured results—including the result that
the current positive-origin detector remains too conservative.

## What changed

- Adds a versioned registry for MUSAN, Slakh2100 Redux, EBU SQAM, MAESTRO, and
  MUSDB18-HQ.
- Adds resumable, byte-bounded downloads with publisher-checksum verification.
- Adds selective extraction that excludes unnecessary stems and duplicate
  source material.
- Records source identity, rights, terms evidence, SHA-256, technical
  properties, chain of custody, and leakage-safe partitions.
- Generates controlled native, lossy, upsample, low-pass, clipping, channel,
  bit-depth, and deterministic-corruption cases.
- Reuses hash-identical prior derivatives and Oracle results, with atomic
  checkpoints for interrupted evaluations.
- Publishes dataset, source-group, split, recipe, and truth-class measurements
  with exact 95% binomial intervals.

## Measured evidence

Corpus `0.5.0` contains 85 independent references and 2,295 controlled cases:

- 50 public references across MUSAN and Slakh2100 Redux;
- 35 local challenge references across EBU SQAM, MAESTRO, and MUSDB18-HQ;
- 1,522 of 1,735 scored outcomes accepted;
- 55 of 85 independent source groups passed every scored case;
- zero lossy-origin false advisories across 975 eligible negative cases;
- zero upsample false advisories across 1,495 eligible negative cases; and
- 110 of 110 scored MUSDB18-HQ integrity, channel, and defect cases accepted.

The scorecard also records zero positive detections across 360 controlled lossy
derivatives and 120 controlled upsample derivatives. Audio-V therefore does
not present these measurements as probability-calibrated provenance accuracy.
Oracle continues to use conservative Review and inconclusive outcomes when its
evidence does not justify a stronger claim.

## Verification

- 189 automated tests pass.
- Full typechecking passes.
- The 17-category release-candidate gate passes.
- Dataset audio remains local, nonpackaged, and governed by its original terms.
- The published repository contains corpus manifests and aggregate scorecards,
  not restricted source audio.

## Packages

- `Audio-V-0.4.39-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.39-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.39-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.39-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source development release. Verify package
> checksums and follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
