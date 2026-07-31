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

## Second measured development result

Audio-V added measurement-only 85%, 95%, and 99% spectral rolloff,
fixed-frequency high-band energy ratios, and effective-bandwidth edge contrast.
These fields do not affect Oracle v12 verdicts. The development exporter then
remeasured all 396 controlled-origin cases and summarized percentiles across
source-group medians rather than treating related derivatives as independent.

The result rejected two tempting shortcuts:

- 99% rolloff was nearly identical for native, lossy, and upsampled cases;
- fixed high-band energy overlapped native and upsampled cases and cannot
  distinguish a production low-pass from codec history by itself.

Effective-bandwidth edge contrast is useful for some codec recipes. Its median
was 21.523 dB for the combined lossy class and 2.610 dB for native controls.
However, high-bitrate AAC remained close to the native controls, and individual
source overlap means edge contrast is not a universal or standalone rule.
Audio-V therefore retained it as a diagnostic candidate and made **no
production verdict change**.

This outcome is successful calibration: the corpus prevented a superficially
attractive threshold from becoming an overconfident verdict. The concise
evidence is published at
`validation/real-world/calibration/oracle-v12-development-feature-separation.json`.
The full path-free development matrix and recipe report remain ignored build
artifacts.

This design follows two research cautions:

- Koops, Micchi, and Quinton demonstrate that lossy-identification models can
  appear highly accurate while depending on codec cutoff settings and then fail
  on unseen configurations:
  https://arxiv.org/abs/2407.21545
- Urbano et al. show that lossy encoding changes high-frequency content and
  spectral envelopes, while track characteristics account for substantial
  descriptor variability:
  https://archives.ismir.net/ismir2014/paper/000326.pdf

## Next engineering stage

The next stage needs no new recording or maintainer labeling. It will:

1. measure the already acquired MAESTRO real-recording derivatives as an
   observational confirmation population;
2. preserve MAESTRO's conservative challenge status while checking whether the
   development patterns generalize beyond synthesized mixtures;
3. investigate codec-artifact measurements that do not rely on a single cutoff;
4. promote a candidate only if it protects native and intentional-filter
   controls across independent source groups.

MAESTRO is suitable for this confirmation role because its publisher documents
uncompressed 44.1–48 kHz PCM recordings, but Audio-V will not silently claim
that this proves every file's complete pre-dataset mastering history:
https://magenta.tensorflow.org/datasets/maestro

## MAESTRO observational confirmation result

The guarded observational exporter analyzed 330 origin-relevant derivatives
from all 15 acquired MAESTRO source groups. The exporter required the explicit
`maestro-v3` allowlist, accepted `challenge` only in observational mode,
verified every derivative SHA-256, and kept this population separate from
controlled sensitivity metrics.

Run the reproducible local workflow with:

```bash
npm run build:electron
AUDIO_V_CALIBRATION_CONCURRENCY=8 npm run calibration:export:maestro
npm run calibration:separation:maestro
```

The result did not confirm edge contrast as a general lossy-history rule:

- native median edge contrast was 2.480 dB;
- combined lossy median edge contrast was 3.360 dB;
- intentional-low-pass median edge contrast was 3.420 dB;
- upsample median edge contrast was 2.855 dB.

Low-bitrate Opus retained partial separation, with recipe medians of 12.940 dB
at 64 kbps and 11.640 dB at 96 kbps. AAC and Vorbis recipes substantially
overlapped native controls. The 99% rolloff and fixed-frequency high-band
energy measurements also overlapped the compared classes.

All 330 cases remained `inconclusive` under Oracle v12. That outcome is not an
analysis failure: it prevents an observational dataset and a
non-generalizing feature from creating false certainty. No production verdict
rule changed. The concise evidence is published at
`validation/real-world/calibration/oracle-v12-maestro-observational-feature-separation.json`.

The next research stage must investigate codec-artifact evidence that does not
depend on a single spectral edge, such as time-frequency texture or block-level
residual structure. Any such measurement remains diagnostic until it separates
independent development groups and protects native and intentional-processing
controls.

## Time-frequency texture result

Audio-V implemented a bounded, deterministic texture measurement family over
the existing 48-slice origin spectrogram:

- normalized frame-to-frame spectral flux;
- high-band spectral flatness and crest;
- normalized high-band spectral entropy; and
- high-band numerical-floor occupancy.

Flatness, crest, and entropy use only bins measurably above the −120 dBFS
numerical floor. Floor occupancy remains a separate measurement. This prevents
clamped floor bins from falsely appearing to be meaningful uniform spectral
energy. The measurements are path-free scalar summaries and do not retain more
decoded audio or increase the bounded slice count.

The corrected development search froze this candidate before observational
confirmation:

- declared sample rate no higher than 50 kHz;
- high-band floor occupancy at least 16%; and
- measurable-bin high-band entropy at least 84%.

On 396 controlled development cases, it matched 104/216 lossy derivatives
across all 18 source groups, with zero matches among 18 native, 90 intentional
low-pass, and 72 upsample controls. That apparent separation did **not**
generalize to MAESTRO:

- 8/15 native controls matched;
- 56/75 intentional-low-pass controls matched;
- 11/60 upsample controls matched; and
- 139/180 lossy derivatives matched.

The candidate is therefore rejected. Quiet or naturally bandwidth-limited
high-frequency regions can reproduce the texture pattern without proving codec
history. Oracle v12 verdict logic remains unchanged. Reproduce the accounting
after both feature matrices exist with:

```bash
npm run calibration:evaluate:texture
```

The concise frozen evidence is
`validation/real-world/calibration/oracle-v12-texture-candidate-v2.json`.
This negative result reinforces the robustness concern documented by Koops,
Micchi, and Quinton: strong results on one codec/source configuration do not
establish generalization to unseen content:
https://arxiv.org/abs/2407.21545

The next safe origin-classification advance is not another hand-tuned cutoff or
texture threshold. It requires either a separately validated codec-artifact
model with source-group and unseen-configuration testing, or continued
conservative abstention. Audio-V chooses abstention until such evidence exists.

## Source-separated multivariate candidate result

Audio-V next tested whether the existing independent measurements become more
useful when combined instead of reduced to one threshold. Candidate v1 uses a
deterministic L2-regularized logistic ranking model over 20 normalized spectral
features plus their missing-measurement indicators. The output is explicitly an
uncalibrated ranking score, not a provenance probability.

The promotion policy was frozen at
`validation/real-world/origin-promotion-policy.json`. It requires:

- leave-one-source-group-out development AUC of at least 0.75;
- zero false-hit source groups during threshold calibration;
- zero false-hit source groups in the untouched test split;
- at least 50% held-out positive-case recall and 60% positive-source coverage;
- zero false-hit source groups in each of EBU SQAM, MAESTRO, and MUSDB18-HQ;
- zero origin advisories across MUSAN edge-abstention material;
- a pooled held-out false-hit source-group Wilson upper 95% bound no greater
  than 10%; and
- at least 60 independent held-out negative source groups.

Development, calibration, and test used disjoint Slakh2100 source groups.
Challenge evaluation used 35 separate EBU SQAM, MAESTRO, and MUSDB18-HQ source
groups. All 20 MUSAN speech, music, and noise groups were an all-negative edge
population. In total, the evaluation measured 1,870 path-free records and
accounted for all 85 corpus source groups without source-group overlap.

The lossy candidate reached 0.926 leave-one-group-out development AUC, 56.9%
held-out test case recall, and zero Slakh test false hits. It failed external
generalization: 17/35 challenge groups and all 20 MUSAN edge groups received at
least one false advisory. Its pooled false-hit source-group rate was 60.7%
(95% Wilson interval 48.1–71.9%).

The upsample candidate reached 0.983 development AUC and 79.2% held-out test
case recall with zero Slakh test false hits. It was substantially safer but
still failed: one EBU challenge group and six MUSAN edge groups received a
false advisory. Its pooled rate was 11.5% and the 95% Wilson upper bound was
21.8%, above the frozen 10% maximum.

Both candidates are rejected. No score, threshold, or coefficient changes
Oracle v12, and neither candidate is packaged. The complete frozen model,
parameters, intervals, gate outcomes, and false-advisory case identities are
published at
`validation/real-world/calibration/oracle-v12-multivariate-candidate-v1.json`.
Reproduce it after exporting the four controlled/challenge matrices and the
MUSAN edge matrix with:

```bash
npm run calibration:evaluate:multivariate
```

This protocol follows published evidence that lossy-history detection can use
time-frequency quantization structure, while recognizing that performance on
one codec and corpus does not establish generalization. Relevant references
include the Audio Engineering Society's open
[Lossless Audio Checker paper](https://secure.aes.org/forum/pubs/conventions/?elib=17972),
the later AES study of
[time-frequency quantization errors](https://secure.aes.org/forum/pubs/journal/?elib=19892),
and research showing that duplicate/source leakage can materially inflate audio
benchmark results: https://arxiv.org/abs/2302.12258. Wilson intervals follow
the NIST proportion-interval guidance:
https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/propconf.htm.

The held-out test and challenge populations are now consumed for candidate v1.
A future feature or model may use this result for diagnosis, but it requires new
independent confirmation material before production promotion. Retuning against
these opened results and calling them held out again is prohibited.
