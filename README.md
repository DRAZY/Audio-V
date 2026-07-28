<div align="center">
  <img src="build/icon.png" alt="Audio-V logo" width="112">
  <h1>Audio-V</h1>
  <p><strong>Know what is really happening inside your audio files.</strong></p>
  <p>A friendly, evidence-based audio integrity and fidelity workstation powered by the Oracle Engine.</p>

  <p>
    <img alt="Locally verified builds" src="https://img.shields.io/badge/builds-locally%20verified-51e19b?style=for-the-badge">
    <a href="https://github.com/DRAZY/Audio-V/releases/tag/v0.4.21"><img alt="Latest development release 0.4.21" src="https://img.shields.io/badge/latest-0.4.21-8b5cf6?style=for-the-badge"></a>
    <a href="LICENSE"><img alt="AGPL 3.0 only" src="https://img.shields.io/badge/license-AGPL--3.0--only-8b5cf6?style=for-the-badge"></a>
    <img alt="macOS and Windows" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-252532?style=for-the-badge">
  </p>

  <p>
    <a href="#download-audio-v">Download</a> ·
    <a href="#your-first-audit">First audit</a> ·
    <a href="#meet-the-oracle-engine">Oracle Engine</a> ·
    <a href="#understanding-the-verdict">Verdicts</a> ·
    <a href="#take-a-tour">Feature tour</a> ·
    <a href="docs/USER_GUIDE.md">User guide</a>
  </p>
</div>

![Audio-V library audit showing verdicts, file results, and measured evidence](docs/assets/audio-v-library-audit.png)

## What is Audio-V?

Audio-V is a desktop application for people who want to inspect music and
audio files without becoming an audio engineer first.

Choose one track, a group of tracks, or a whole music folder. Audio-V reads
each selected audio stream from beginning to end, measures what it finds, and
gives the file a carefully limited verdict:

- **Clear** — the file passed the checks Audio-V performed.
- **Review** — the scan finished, but something deserves a closer look.
- **Failed** — a repeatable integrity check found evidence against the file.

Audio-V is not a music player. It does not judge whether a song is good, and it
does not assume that a large bitrate or “Hi-Res” label means high quality. It
is an inspection desk: decode the file, measure the signal, show the evidence,
and explain the result.

### Who is it for?

- Music collectors checking a personal library
- Archivists organizing and verifying audio
- DJs and creators checking delivered files
- People comparing an original track with an edited or repaired copy
- Curious listeners learning what technical audio information means
- Developers who need repeatable JSON evidence from a command line

No audio expertise is required. Technical details are available when wanted,
but the main workflow is designed to answer three simple questions:

1. **Could Audio-V read the whole file correctly?**
2. **Did it measure anything that deserves attention?**
3. **What evidence produced the verdict?**

> [!IMPORTANT]
> Audio-V is currently a development preview being prepared for release-candidate
> testing. A Clear verdict means the file passed the disclosed checks in this
> Oracle Engine version. It does not certify an original studio master, prove
> ownership, or guarantee that the audio was never transformed.

## Download Audio-V

The current locally built development release is
**[Audio-V 0.4.21](https://github.com/DRAZY/Audio-V/releases/tag/v0.4.21)**.

| Your computer | Download | What you receive |
|---|---|---|
| Apple Silicon Mac | [Apple Silicon DMG](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/Audio-V-0.4.21-mac-arm64.dmg) | Native build for M-series Macs |
| Any supported Mac | [Universal DMG](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/Audio-V-0.4.21-mac-universal.dmg) | Apple Silicon and Intel in one package |
| Windows | [Windows installer](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/Audio-V-0.4.21-win-x64.exe) | Guided installation |
| Windows portable | [Portable executable](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/Audio-V-Portable-0.4.21-x64.exe) | Runs without installation |

These builds are not signed with paid Apple or Microsoft certificates. Verify
the download with
[`SHA256SUMS.txt`](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/SHA256SUMS.txt),
then follow the
[unsigned installation guide](docs/UNSIGNED_INSTALLATION.md). The
[`UNSIGNED_RELEASE_MANIFEST.json`](https://github.com/DRAZY/Audio-V/releases/download/v0.4.21/UNSIGNED_RELEASE_MANIFEST.json)
records the signing policy and artifact identities.

## Your first audit

### 1. Choose what to inspect

Open Audio-V and select:

- **Choose files** for one or more tracks; or
- **Choose folder** for a folder and its subfolders.

Audio-V can work with local folders, user-selected removable drives, mounted
macOS volumes, Windows mapped drives, and UNC network paths.

### 2. Choose the run mode

- **Full Oracle audit** decodes and assesses the audio. Use this when you want
  a verdict.
- **Metadata inventory** quickly catalogs declared properties without decoding
  the signal. Its result is **Not analyzed**, because no audio verdict was
  attempted.

### 3. Watch the work

Completed files appear while the audit continues. Progress remains below 100%
until file analysis, fingerprint linking, and durable history finalization are
finished.

You can pause the scheduling of new files or cancel the audit. Completed
results are checkpointed, and interrupted scans can be resumed from History.

### 4. Read the verdict

Select a file to see:

- the plain-language Oracle explanation;
- the evidence lane that raised a concern;
- hashes and integrity results;
- signal, loudness, clipping, and defect measurements;
- Origin Assessment and its limitations;
- provenance and acoustic-identity clues;
- measured waveform and spectrogram views.

### 5. Decide what to do

- For **Clear**, save a report if you need a record.
- For **Review**, inspect the named evidence and compare with a trusted copy
  when possible.
- For **Failed**, preserve the source and obtain or compare another copy before
  deleting anything.
- For **Analysis error**, read the failure stage and retry; Audio-V has not
  called the file damaged.

## Meet the Oracle Engine

The **Oracle Engine** is Audio-V’s versioned inspection and verdict system.
Think of it as a line of specialists. Each specialist checks one part of the
file, then Oracle brings their evidence together without pretending that every
clue is proof.

```mermaid
flowchart LR
    A[Discover] --> B[Identify]
    B --> C[Decode all audio]
    C --> D[Verify integrity]
    D --> E[Measure signal]
    E --> F[Inspect spectrum]
    F --> G[Inspect provenance]
    G --> H[Five evidence lanes]
    H --> I[Explain verdict]
```

### Oracle’s processing stages

1. **Discover** — find supported audio and normalize its format.
2. **Inventory** — read declared properties and metadata.
3. **Identify** — calculate exact SHA-256 file identity.
4. **Decode** — read the selected audio stream from beginning to end.
5. **Verify** — check decode completion, FLAC audio MD5, duration, and
   supplied checksum manifests.
6. **Measure** — calculate loudness, peaks, clipping, continuity, dynamics,
   channel behavior, waveform, and spectrum.
7. **Assess origin clues** — look for conservative multi-feature patterns
   compatible with possible transcoding or upsampling.
8. **Inspect provenance and identity** — examine C2PA statements, generator
   indicators, and Chromaprint relationships.
9. **Organize evidence** — keep integrity, signal, origin, provenance, and
   delivery findings in separate lanes.
10. **Issue and explain the verdict** — apply narrow rules and show exactly
    which evidence mattered.
11. **Finalize** — link bounded library relationships and commit resumable
    history before showing 100%.

Read [The Oracle Engine, explained simply](docs/ORACLE_ENGINE.md) for a
complete walkthrough of every stage, rule, threshold, limitation, and sensible
next step.

### Four kinds of evidence

| Evidence | Meaning | Example |
|---|---|---|
| **Deterministic** | A repeatable yes/no check | A FLAC audio MD5 matches or does not |
| **Measured** | A number or behavior observed in decoded audio | Loudness is −14 LUFS |
| **Heuristic** | Several measurements match a disclosed pattern | Possible prior lossy encoding |
| **Declared** | Metadata or a signed statement says something | A tag names a generator |

This labeling is important. A heuristic clue is never silently presented as
deterministic proof.

### Five evidence lanes

| Lane | The question it answers |
|---|---|
| **File integrity** | Could the whole file be read and verified? |
| **Signal defects** | Did the decoded sound contain material warning patterns? |
| **Spectral origin** | Does its frequency shape resemble a prior transformation? |
| **Provenance** | Are there attached claims, generator clues, or identity relationships? |
| **Delivery compliance** | Does it fit a selected delivery target? |

The lanes prevent unlike issues from being mixed together. Missing provenance
does not mean broken audio. A loud master does not mean a corrupt file. A
possible transcode pattern does not mean the decoder failed.

## Understanding the verdict

### Clear

Clear means:

- the complete selected audio stream decoded;
- deterministic integrity checks did not fail; and
- no current finding reached Review or Critical severity.

Clear files may still contain advisory observations. Clear does **not** mean
“original master,” “perfect sound,” or “never edited.”

### Review

Review means the audit completed, but at least one material finding deserves a
person’s attention. Examples include:

- strict decode failed but a tolerant confirmation decode succeeded;
- material clipping or possible scaled-clipping patterns;
- repeated or large click/pop candidates;
- repeated or long stuck-sample candidates;
- multiple internal digital-silence dropout candidates;
- large DC offset;
- a material duration mismatch in a sample-exact format;
- an external checksum-manifest mismatch; or
- a strong, multi-feature possible-transcode or possible-upsample pattern.

Review is not the same as damaged. Music production, synthesis, old recordings,
hard edits, analog transfers, and intentional mastering can create similar
measurements.

### Failed

Failed is intentionally rare. It currently requires deterministic evidence
such as:

- strict and tolerant complete decodes both failing with recognized corruption
  evidence; or
- decoded native FLAC audio not matching its stored STREAMINFO audio MD5.

### Analysis error and Not analyzed

These are workflow states, not verdicts:

- **Analysis error** means a tool, resource, source connection, worker, or
  internal stage prevented completion. The file is not labeled damaged.
- **Not analyzed** means Metadata Inventory ran without decoding the signal.

**Review acknowledged** only records that someone saw a Review result. It does
not change the file, erase evidence, or turn Review into Clear.

## Take a tour

### Audit: inspect one file or a complete collection

Audit shows the active queue, sortable verdict results, library distribution,
selected-file summary, Oracle explanation, measured evidence, and progress.

![Audio-V Oracle audit and selected-file evidence](docs/assets/audio-v-oracle-audit.png)

Audio-V accepts 39 FFmpeg-backed audio and container extensions. Examples
include FLAC, WAV, AIFF, ALAC, MP3, AAC/M4A, OGG, Opus, WavPack, APE, DSF,
Matroska/WebM, WMA, AC-3, and E-AC-3.

### Spectrogram: see frequency energy over time

Choose 512, 2,048, 4,096, or 16,384-point inspection; combined, left, right,
or L−R channel views; scientific color maps; zoom, pan, region readout; and
single or batch PNG export.

![Audio-V measured spectrogram inspection](docs/assets/audio-v-spectrogram.png)

The spectrogram is evidence, not decoration—but one picture alone does not
prove source history.

### Loudness and signal diagnostics

Audio-V measures:

- EBU R128 integrated loudness and loudness range;
- true peak, sample peak, RMS, and crest factor;
- clipping percentage, per-channel counts, grouped events, and timeline;
- click/pop, stuck-sample, dropout, and steep-transition candidates;
- DC offset, stereo correlation, dual mono, and near mono;
- DR descriptors and integer bit utilization;
- track ReplayGain and eligible album ReplayGain.

### Identity: find related recordings

Chromaprint relationships work inside the current audit and in a persistent
historical Identity library. Browse, rebuild, prune missing paths, or clear the
index. Optional AcoustID lookup sends a fingerprint and rounded duration—not
the audio—to the external service.

### Compare: inspect two independent files

Load File A and File B directly from disk or from the current audit. Audio-V
compares hashes, formats, loudness, waveforms, spectra, offset, gain, polarity,
and a complete overlapping decoded null test when channel mapping permits.

![Audio-V decoded-signal comparison](docs/assets/audio-v-signal-compare.png)

Compare has no playback component. It is built to answer “how are these files
related?” with measurements.

### Repair: make a safe working copy when an action exists

Repair is a triage workspace. It explains whether replacement, comparison,
manual verification, acknowledgement, or optional mitigation makes sense.

The current automated true-peak action:

- creates a separate FLAC working copy;
- never overwrites the source;
- preserves a known 16-bit or 24-bit source depth by default;
- supports explicit 16-bit or 24-bit output;
- preserves supported metadata and artwork; and
- audits the new copy.

It reduces level to avoid new positive true peaks. It does not reconstruct
samples already lost to clipping.

![Audio-V non-destructive remediation center](docs/assets/audio-v-remediation-center.png)

### Reports: keep the evidence

Open a complete per-file evidence report or export a full audit as PDF, XLSX,
DOCX, CSV, or lossless JSON.

![Audio-V evidence report workspace](docs/assets/audio-v-evidence-report.png)

Reports can contain filenames, full paths, hashes, metadata, and measurements.
Review them before sharing.

### History and recovery

Audio-V checkpoints completed records in local SQLite history. After an
unexpected interruption, adaptive resume:

1. reuses completed records that still match;
2. safely validates files that were active during the interruption;
3. restores the saved worker profile after that isolated check; and
4. quarantines a repeatedly unstable file as Analysis error rather than
   crashing the remaining audit or calling the file damaged.

### Automation and the packaged CLI

The command line uses the same Oracle worker, verdict rules, and JSON evidence
model as the desktop app:

```bash
npm run cli -- /music/archive \
  --output audit.json \
  --concurrency 2 \
  --memory-mb 256 \
  --ffmpeg-threads 2 \
  --native-memory-mb 1024 \
  --fail-on failed
```

Use `--metadata-only` for inventory, `--fail-on review` for a stricter policy,
or `--fail-on never` when evidence should never return policy exit code 2.
Desktop packages include a CLI launcher and their bundled Oracle tools.

## What Audio-V does not claim

Audio-V does not:

- play music or manage a listening queue;
- prove that a file is an original studio master;
- rate musical taste or mastering style;
- treat high sample rate, bit depth, or bitrate as automatic quality;
- recover information removed by lossy encoding or clipping;
- identify every possible defect;
- issue a universal “AI generated: Yes/No” badge;
- upload selected audio or collect telemetry.

The project has deterministic synthetic regression fixtures and a complete
real-world corpus framework. It does not publish real-world false-positive or
false-negative rates until licensed, provenance-labeled masters and an
independent challenge set satisfy the documented thresholds.

## Privacy

- Audio analysis runs locally.
- Selected audio is not uploaded.
- There is no account, advertising, or telemetry.
- AcoustID lookup is optional and off by default.
- Source files are never overwritten by Repair.
- Privacy-safe diagnostic exports omit filenames, paths, hashes, tags, and
  report evidence.
- Local rotating logs may contain filenames and paths so a failed file can be
  identified; they stay on the user’s computer unless deliberately shared.

Read the complete [privacy and security model](docs/PRIVACY_SECURITY.md).

## Learn more

| Start here when… | Document |
|---|---|
| You want normal step-by-step operation | [User guide](docs/USER_GUIDE.md) |
| You want to understand Oracle and every verdict | [Oracle Engine guide](docs/ORACLE_ENGINE.md) |
| A technical word is unfamiliar | [Plain-language glossary](docs/GLOSSARY.md) |
| You want formulas, standards, and limitations | [Methodology](docs/METHODOLOGY.md) |
| You want to understand validation claims | [Validation corpus contract](docs/VALIDATION_CORPUS.md) |
| You need to install an unsigned build | [Unsigned installation](docs/UNSIGNED_INSTALLATION.md) |
| You want the implemented capability contract | [Product audit](docs/PRODUCT_AUDIT.md) |
| You are preparing a release | [Release workflow](docs/RELEASING.md) and [RC checklist](docs/RELEASE_CANDIDATE_CHECKLIST.md) |
| You want to contribute | [Contributor guide](CONTRIBUTING.md) |

## Build from source

Audio-V requires Node.js 22 or newer.

```bash
git clone https://github.com/DRAZY/Audio-V.git
cd Audio-V
npm ci
npm run provision:engines
npm run dev
```

Run the complete source gate:

```bash
npm run verify
npm run validate:platform
npm run validate:formats
npm run verify:release-candidate
```

Create local development packages:

```bash
npm run dist:mac
npm run dist:win
```

Maintainers build packages on controlled local systems and upload the verified
artifacts directly to a versioned GitHub Release. Pushes and tags do not start
hosted builds. The optional GitHub verification workflow is manual-only.

## Technology

Audio-V uses Electron, Vue 3, TypeScript, Vite, FFmpeg/ffprobe 8.1.2 LGPL
builds, SQLite-backed storage, Vitest, C2PA Tool, Chromaprint, and Electron
Builder. The renderer is context-isolated and receives a narrow preload API.

## License, contributions, and branding

Audio-V source is licensed under
[GNU AGPL version 3 only](LICENSE). Dependencies and bundled tools keep their
own licenses.

Contributors accept the
[Audio-V Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md),
which preserves contributor ownership while granting the project explicit
relicensing rights. The Audio-V name, logo, icon, Oracle Engine identity, and
official-release designation are covered by the
[trademark policy](TRADEMARKS.md).

Audio submitted for validation uses the separate
[Validation Corpus Contribution Agreement](CORPUS_CONTRIBUTION_AGREEMENT.md).

---

<div align="center">
  <strong>Audio-V</strong><br>
  Evidence before assumption. Measurement before verdict.
</div>
