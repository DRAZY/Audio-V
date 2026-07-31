# Audio-V v0.4.40 — Evidence-led Oracle calibration

Audio-V v0.4.40 strengthens the way Oracle Engine calibration ideas are
measured before they can influence a user verdict. It adds reproducible
diagnostics for the existing five-source corpus, tests a promising spectral
texture detector against both controlled cases and real MAESTRO recordings,
and publishes why that detector was rejected rather than quietly tuning the
product toward one dataset.

## What changed

- Adds a versioned Oracle feature exporter with bounded checkpoints and
  reusable measurements.
- Adds per-feature separation reports for controlled development cases and
  observational MAESTRO challenge recordings.
- Measures normalized spectral flux plus high-band flatness, crest, entropy,
  and floor occupancy without changing a file's verdict.
- Adds a frozen candidate evaluator with explicit thresholds and expected
  truth classes.
- Publishes the complete candidate-v2 result in
  `validation/real-world/calibration/oracle-v12-texture-candidate-v2.json`.
- Documents the promotion gate: a new heuristic must generalize across
  independent material before Oracle may use it.

## What the evaluation found

The frozen candidate detected 104 of 216 eligible controlled lossy cases while
producing zero positive-origin false advisories on controlled native,
low-pass, and upsample controls. That promising laboratory result did not
generalize to the MAESTRO observational challenge set: it also fired on 8 of
15 native references, 56 of 75 intentional low-pass cases, and 11 of 60
upsampled cases.

Audio-V therefore rejected the candidate. Oracle Engine v12 verdict behavior
is unchanged, and the release does not convert this experimental measurement
into a confidence score or provenance claim. Publishing the rejection is part
of Audio-V's evidence policy: inconclusive is more trustworthy than a stronger
answer that the data cannot support.

## Verification

- 197 automated tests pass.
- Full typechecking and production builds pass.
- The 17-category release-candidate gate passes.
- Corpus audio remains local, nonpackaged, and governed by its original terms.
- The repository publishes aggregate evidence and reproducible tooling, not
  restricted source audio.

## Packages

- `Audio-V-0.4.40-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.40-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.40-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.40-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source development release. Verify package
> checksums and follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
