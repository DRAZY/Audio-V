# How Audio-V learned to say “we do not know”

Audio-V began with a simple goal: inspect an audio file, show the evidence, and
give the user a result they can understand. The difficult part was not adding
more measurements. It was deciding when those measurements were strong enough
to support a verdict—and when they were not.

## A verdict is a promise with limits

Oracle Engine separates evidence into distinct jobs:

- deterministic integrity checks answer whether the file itself can be read
  and verified;
- signal measurements describe what is present in the decoded audio;
- origin heuristics identify patterns that may deserve review; and
- external identity services identify recordings without certifying their
  fidelity.

Those jobs are intentionally not interchangeable. An AcoustID match does not
repair a corrupt file. A familiar MusicBrainz recording does not prove that a
copy is lossless. A spectral pattern can justify Review, but cannot prove a
file's full history.

## Building the evidence base

The local validation corpus contains 85 independent, hash-verified reference
recordings drawn from five external sources:

- Slakh2100 for controlled development, calibration, and frozen testing;
- MAESTRO for real piano-recording challenges;
- MUSDB18-HQ for produced multitrack music challenges;
- EBU SQAM for standardized technical and programme material; and
- MUSAN for speech, music, noise, and narrow-band edge cases.

Audio-V generates known transformations from those references instead of
guessing what happened to an unknown commercial recording. The complete
production run currently contains 2,295 cases. Rights records, source hashes,
tool versions, transformation recipes, and expected classes make the exercise
repeatable.

## Preventing an easy but misleading score

One original recording and all of its derivatives form one source group.
Source groups—not individual files—are divided among development, calibration,
test, and challenge populations. This prevents a transformed sibling of a test
track from leaking into training and making the result look better than it is.

The current experimental evaluation uses five boundaries:

1. **Development** is where candidate measurements may be explored.
2. **Calibration** freezes the model and threshold.
3. **Test** is opened once to evaluate that frozen choice.
4. **Challenge** asks whether the idea generalizes to different real material.
5. **Edge abstention** checks whether speech, silence, noise, or narrow-band
   audio is being mistaken for evidence of source history.

The detailed requirements live in
`validation/real-world/origin-promotion-policy.json`. Among other safeguards,
a candidate must protect every independent negative calibration and test group,
meet sensitivity requirements, avoid false advisories in every challenge
dataset, and remain quiet on the edge-abstention population.

## The rejected candidate that strengthened Audio-V

Audio-V tested a deterministic multivariate ranking model using 20 normalized
spectral measurements plus explicit missing-measurement indicators. It was
evaluated on 1,870 records spanning all 85 independent source groups.

The candidate looked convincing at first. Its development AUC was 0.926 for
lossy-origin ranking and 0.983 for upsample ranking, and it passed the frozen
Slakh test groups. External evidence changed the conclusion:

- the lossy model produced false advisories in 37 of 61 pooled held-out
  negative source groups; and
- the upsample model produced false advisories in 7 of 61 pooled held-out
  negative source groups.

That was not close enough to the stated safety requirement. The candidate was
rejected, its score was never presented as a probability, and it received no
verdict authority. Production Oracle Engine v12 did not change.

Publishing an unsuccessful experiment matters. It shows that the corpus is not
being used to decorate a feature that was already chosen. It can—and does—stop
features that do not generalize.

## What the release gates verify

The v0.4.41 validation cycle completed:

- 201 automated source tests;
- all 2,295 production corpus cases;
- 39 advertised audio extensions, including 29 native fixtures;
- worker, storage, repair, comparison, CLI, and defect gates;
- 41 automated accessibility rules and 154 exposed accessibility-tree nodes;
- Apple Silicon and Universal macOS package inspection;
- Windows installer and portable-package inspection;
- a packaged macOS Oracle reference audit; and
- exact local-versus-GitHub SHA-256 matching for all six release assets.

The repository retains compact evidence and reproducible tools. Generated
audio derivatives and package staging directories are removed after validation
so the scientific process does not leave unnecessary local data behind.

## What Audio-V can honestly say

A **Clear** verdict means the file passed the checks performed by that Oracle
Engine version. **Review** means measured or heuristic evidence deserves human
attention. **Failed** is reserved for deterministic evidence against the file
itself.

Audio-V cannot certify an original studio master, ownership, artistic quality,
or every transformation in a recording's past. No tool can recover history
that the evidence does not contain. Audio-V's standard is therefore not
absolute certainty. It is the highest defensible confidence supported by
reproducible measurements, explicit limits, independent tests, and a willingness
to say **Inconclusive**.

## Reproduce or inspect the work

- `docs/ORACLE_CALIBRATION.md` records each scientific iteration.
- `docs/VALIDATION_CORPUS.md` documents acquisition, partitioning, and
  reproducibility.
- `validation/real-world/origin-promotion-policy.json` defines the exact
  promotion contract.
- `validation/real-world/calibration/oracle-v12-multivariate-candidate-v1.json`
  publishes the rejected candidate's path-free evidence.
- `docs/RELEASE_CANDIDATE_CHECKLIST.md` separates automated evidence from the
  native manual acceptance work that still requires a person.
