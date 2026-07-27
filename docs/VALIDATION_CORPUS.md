# Audio-V real-world validation corpus

## Purpose

The Audio-V Validation Corpus measures how Oracle Engine rules behave on legally usable, provenance-labeled recordings. It does not turn a spectral heuristic into proof of a file’s history. It establishes the population, transformations, error rates, confidence intervals, and limitations behind each published claim.

## Evidence tiers

1. **Synthetic regression** catches deterministic implementation regressions. It is never counted as real-world calibration.
2. **Public real-world corpus** contains source masters that Audio-V may redistribute with provenance and controlled derivatives.
3. **Private challenge corpus** contains independently licensed material withheld from threshold development.
4. **External challenge datasets** may supplement testing under their own terms but are never silently relicensed as Audio-V corpus material.

## Master eligibility

A master is eligible only when:

- the sound-recording and composition rights are documented;
- its license permits the intended analysis, transformation, and distribution, or a signed Audio-V Corpus Contribution Agreement grants those rights;
- it came directly from a documented master export, multitrack render, analog transfer, or named research collection;
- SHA-256, acquisition date, chain of custody, format, sample rate, bit depth, and channel layout are recorded; and
- the source is not inferred to be “native” merely because it is stored in a lossless container.

CC0 1.0, CC BY 4.0, and the Audio-V Corpus Contribution Agreement are accepted for public masters. NoDerivatives material is rejected. NonCommercial and ShareAlike material is restricted to separately identified research sets and cannot satisfy the commercially flexible public-corpus target.

## Ground-truth model

Ground truth records facts, not a single “authentic” label:

- source-master identity and chain of custody;
- integrity state;
- known transformation graph;
- codec and encoding parameters;
- sample-rate and word-length changes;
- intentional production filtering;
- clipping and level changes;
- channel transformations; and
- the Oracle outcome allowed by the disclosed evidence.

Every derivative retains its source-master ID, contributor group, transformation recipe, exact tool version and arguments, and SHA-256.

## Leakage prevention

Development, calibration, test, and private-challenge partitions are assigned at the contributor group level. Every master and every derivative from the same artist or contributor remain in one partition. Thresholds may be changed with development data, frozen with calibration data, and evaluated once per candidate engine version against the locked test and challenge sets.

## Milestone v0.1

- Corpus governance, schemas, import tooling, deterministic recipes, grouped splits, scorecards, and application disclosure are enforced in the repository.
- Pilot threshold: 25 independent licensed masters.
- Target threshold: 50 independent licensed masters.
- Target transformations: at least 10 controlled cases per eligible master.
- The target must include native controls, lossy-to-lossless transcodes, upsampling, intentional low-pass confounders, clipping variants, channel variants, and deterministic corruption fixtures.

The milestone is **infrastructure ready** before masters arrive, **pilot building** below 25 masters, **pilot ready** from 25–49 masters with all required partitions, and **target corpus ready** from 50 masters with all required partitions. None of those states alone means statistically calibrated.

## Evaluation contract

Scorecards report:

- independent masters and contributor groups;
- cases by partition and transformation class;
- accepted and observed Oracle classifications;
- false-positive, false-negative, and inconclusive counts;
- sensitivity, specificity, and inconclusive rate;
- 95% binomial confidence intervals;
- results by transformation, codec, sample rate, and provenance group when counts permit; and
- the corpus, recipe, and Oracle Engine versions.

Production language remains “possible,” “bandwidth limited,” or “inconclusive” until the target corpus and an independent challenge evaluation justify a stronger claim. Synthetic cases and multiple derivatives of one master never inflate the independent-master count.

## Repository layout

```text
validation/
  fidelity-corpus.json                synthetic regression contract
  real-world/
    corpus.json                       source-master registry
    recipes.json                      controlled transformation definitions
    schemas/                          JSON Schemas
    .audio/                           ignored licensed audio and generated files
    generated/                        ignored case manifest
build/
  real-world-validation-latest.json  current corpus/readiness disclosure
  real-world-scorecard-latest.json   latest Oracle evaluation
```

## Operator workflow

```bash
npm run corpus:import -- \
  --file "/path/to/master.wav" \
  --id "AVC-M-0001" \
  --group "artist-stable-id" \
  --title "Track title" \
  --artist "Artist" \
  --license "Audio-V-CCA-1.0" \
  --agreement "AVCCA-2026-0001" \
  --provenance "direct-master-export"

npm run corpus:generate
npm run validate:real-world
```

Audio-V’s bundled LGPL FFmpeg engine does not include `libmp3lame`. AAC and Opus transformations use the bundled engine. To include the versioned MP3 recipes, set `AUDIO_V_CORPUS_MP3_FFMPEG_PATH` to a rights-reviewed FFmpeg executable that exposes the `libmp3lame` encoder. The generator records skipped MP3 recipes instead of silently substituting a codec or failing the rest of the corpus.

The imported audio and personal acceptance records are deliberately excluded from Git. A public corpus release must be assembled separately from entries whose rights record explicitly permits redistribution.
