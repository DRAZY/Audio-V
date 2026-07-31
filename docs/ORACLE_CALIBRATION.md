# Oracle Engine calibration

## What the maintainer has already completed

The maintainer does not need to find more recordings or label files for the
first calibration pass. Audio-V already has:

- 85 legally acquired independent references;
- exact source hashes and rights records;
- known native, lossy, upsample, low-pass, clipping, channel, bit-depth, and
  corruption transformations;
- source-group development, calibration, test, and challenge boundaries; and
- an immutable Oracle v12 baseline scorecard.

The next work is performed by repository tooling, not by asking the maintainer
to listen to or manually classify thousands of files.

## What calibration means

Calibration asks which reproducible measurement rules best separate known
controlled transformations while protecting native and intentional-production
controls from false advisories. It does not make Clear mean “authentic,” turn
rule strength into a probability, or change deterministic integrity failures.

The workflow has four guarded stages:

1. **Measure development cases.** Export the path-free raw measurements that
   Oracle used and identify which v12 prerequisites blocked controlled positive
   cases.
2. **Explore development rules.** Compare candidate rules only on development
   source groups. Related derivatives never cross a source boundary.
3. **Freeze with calibration.** Select one versioned rule profile using the
   calibration groups, then stop changing it.
4. **Open test once.** Evaluate the frozen profile once on held-out test groups.
   Challenge sources may measure false advisories but cannot provide positive
   provenance labels when their earlier mastering history is unknown.

If no candidate improves positive detection without unsafe false advisories,
Audio-V must add a new evidence family rather than simply lowering thresholds.

## First milestone commands

Build the current Oracle implementation, then export development measurements:

```bash
npm run build:electron
npm run calibration:export:development
npm run calibration:analyze:development
```

The exporter selects only controlled-source cases whose prior processing is
known, verifies every derivative SHA-256, omits paths and spectrogram slices,
and checkpoints every ten newly analyzed cases. Rerunning the same command
resumes compatible work.

The blocker report explains why v12 did not classify each controlled lossy or
upsample case. A blocker is diagnostic; it is never automatic permission to
relax a production rule.

## First measured development result

Oracle v12 measured 396 eligible cases from 18 independent development source
groups:

- 18 native controls;
- 90 intentional low-pass controls;
- 216 known lossy-to-lossless transformations; and
- 72 known upsample transformations.

The output contained 391 inconclusive classifications and five
bandwidth-limited classifications. None of the controlled positives satisfied
the current positive rule.

The main lossy blockers were:

- no stable cutoff measurement in 212/216 cases;
- no measured 25 dB spectral cliff in 216/216 cases; and
- insufficient regional stability in 216/216 cases.

The main upsample blockers were:

- no stable cutoff measurement in 71/72 cases;
- no measured 5 dB spectral cliff in 71/72 cases;
- insufficient regional stability in 72/72 cases; and
- no prior-grid match or secondary rupture in 71/72 cases.

This establishes that the immediate problem is not merely a threshold that is
too high. Most controlled positives do not produce the prerequisite
measurements at all. The next calibration milestone must add a standalone
spectral evidence family and prove that it separates known transforms from
native and intentional-filter controls before Oracle verdict logic changes.

The exact published diagnostic is
`validation/real-world/calibration/oracle-v12-development-blockers.json`.
