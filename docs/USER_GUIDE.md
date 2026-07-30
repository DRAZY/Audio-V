# Audio-V user guide

## What Audio-V does

Audio-V is a local audio-integrity and fidelity workstation. It completely decodes selected audio, measures the decoded signal, verifies available checksums, presents conservative origin indicators, compares two files, creates limited non-destructive remediation copies, and exports evidence reports.

It is not a music player, mastering suite, source-provenance oracle, or guarantee that a recording has never been transformed.

If this is your first visit, read [The Oracle Engine, explained simply](ORACLE_ENGINE.md)
to understand how evidence becomes a verdict. The
[plain-language glossary](GLOSSARY.md) explains unfamiliar audio terms.

## Five-minute first audit

1. Leave the run mode on **Full Oracle audit**.
2. Select **Choose files** and pick one or two familiar tracks.
3. Wait until progress reaches 100%. The number means file analysis and final
   history work are complete.
4. Select a result row.
5. Read the Oracle headline and interpretation before opening the detailed
   measurements.
6. If the verdict is Review, find the Review-level finding in the evidence
   lanes. The lane explains what kind of question Oracle is raising.
7. Open Spectrogram, Loudness, or Origin Assessment only when the explanation
   points there.
8. Export the per-file report if you want a permanent record.

This order keeps a new user from treating one unfamiliar number as the whole
verdict.

## Audit workspace

Choose individual files with **Choose files**, or recursively discover supported audio with **Choose folder**. The table populates as files complete. **Pause** stops scheduling new work after active jobs finish; **Cancel audit** terminates active decoders while retaining completed session evidence.

Verdicts have deliberately limited scope:

- **Clear** — complete decoding and current deterministic/measured rules passed.
- **Review** — decoding completed but a measured or heuristic finding deserves inspection.
- **Failed** — deterministic decode or integrity evidence failed.

**Not analyzed** is not a verdict. Select **Metadata inventory** as the run mode to catalog declared format, codec, duration, bitrate, sample rate, bit depth, and channels without decoding the signal. Run a **Full Oracle audit** when you want integrity, loudness, spectrogram, continuity, and origin evidence.

An **Analysis error** means a tool, resource, probe, measurement, or internal processing stage did not finish. Audio-V shows the failure stage, code, and exact diagnostic evidence and does not call the source damaged. Retry the analysis after reviewing that evidence.

Select a row to open **Quick Inspect**, the one-file-at-a-glance view. It shows
the Oracle verdict and explanation, format, bitrate and encoded channel mode,
key signal measurements, spectrum/origin summary, integrity state, and the
recommended next step. Use its buttons—or the tabs above it—to open the full
Spectrogram, Loudness, and Evidence workflows. Quick Inspect uses the same
Oracle evidence and does not calculate a separate or simplified verdict.

For MP3, **MP3 frame mode** means the mode encoded in the MPEG frame headers:
Stereo, Joint Stereo, Dual Channel, or Mono. It is intentionally separate from
the decoder's output channel layout. Other formats continue to show their
declared/probed channel layout.

A Clear result does not prove provenance.

### The lightweight one-file path

If you only want to check one download, choose that file and remain in Quick
Inspect. You do not need to configure Compare, Reports, Identity, delivery
profiles, or high-resolution spectrogram controls. The scan is still a complete
Oracle audit; the result is simply presented in a compact form.

Use the deeper tabs only when you want to:

- inspect frequency energy visually;
- understand loudness or defect measurements;
- read the exact evidence behind Review or Failed; or
- export a detailed record.

Audio-V does not modify, normalize, EQ, or enhance the signal to draw the
spectrogram. The view is an STFT measurement of decoded samples. FFT size,
window, channel selection, scaling, floor, and palette affect its presentation,
so no responsible analyzer can call one rendering the uniquely “raw” view.

The results table can be sorted by verdict so Clear, Review, Failed, Not
analyzed, and Analysis error files can be handled together. Long paths and
hashes are shortened visually; hover over them to read the complete value.

In the evidence view, **Human disposition** records what you decided after
reviewing a result: acknowledged, accepted as intentional, confirmed issue,
possible false positive, remediated copy verified, replacement required, or
follow-up required. Add a note when useful. The saved disposition appears in
exports, but it does not modify the source, erase the finding, repair anything,
or convert Review or Failed to Clear.

In **Spectrogram**, choose 512, 2,048, 4,096, or 16,384 FFT resolution. Higher settings separate nearby frequencies more precisely but provide coarser time resolution and require an on-demand decode. Choose combined power, left, right, or L−R; every selection is decoded and painted automatically without requiring a Floor or zoom change. All channel modes keep the same absolute dBFS color scale so their levels remain honestly comparable. L−R isolates stereo difference energy and can correctly appear darker when the channels contain similar material. Use zoom and pan to navigate, drag across the plot for exact time/frequency bounds, and export one PNG or a batch using the current inspection settings. Inferno, magma, and viridis change only the display palette.

In **Loudness**, clipping diagnostics show the percentage of decoded samples at full scale, per-channel counts, contiguous clipping events, their locations on a track timeline, and possible scaled-clipping plateaus. Clipping and possible scaled clipping remain Review findings because intentional mastering and synthesized waveforms can create the same measurements. Failed is reserved for deterministic file-integrity evidence.

The **Declared metadata inventory** lists normalized fields and a bounded set of raw tags. Metadata Inventory mode gives this capability a fast, non-decoding purpose; Full Oracle Audit adds local C2PA, fingerprint, dynamics, bit-utilization, and signal evidence.

The **Provenance & identity** card distinguishes cryptographic Content Credential status, editable generator metadata, known identifier strings, local Chromaprint relationships, and optional external matches. These are not collapsed into an “AI: Yes/No” badge. A raw identifier is not proof that Audio-V decoded a proprietary watermark, and a valid C2PA claim authenticates a signed statement rather than the truth of every statement.

An MQA-related tag or decoder profile appears only as an **MQA declaration**.
That means Audio-V found a marker; it does not mean Audio-V authenticated MQA,
performed an unfold, or proved the recording’s origin.

For CD-rip databases, Audio-V first checks eligibility. A complete
single-image cue layout must be CD-frame aligned and the decoded source must be
lossless 44.1 kHz, 16-bit stereo. **Eligible · not verified** means the
required context exists for a future read-only CTDB or AccurateRip lookup. It
is not a database match.

## Delivery profiles

Settings offers optional standards profiles for future full audits:

- **EBU R 128 programme QC** — −23 LUFS with the recommendation’s ±0.2 LU
  quality-control tolerance and −1 dBTP production maximum.
- **ATSC A/85 delivery** — −24 LKFS/LUFS with the current Annex M anticipated
  ±2 dB measurement range and −2 dBTP maximum.
- **AES internet music · track** — −16 LUFS track-normalization target,
  +0.2 LU upper tolerance, −20 LUFS general operational floor, and −1 dBTP
  maximum at lossy-codec input.

The selected profile is saved with the audit and appears in evidence and
reports. Outside-target audio becomes Review, not Failed. The source audio is
never normalized or altered. Leave the profile at **None · measure only** when
you are inspecting a library without one shared delivery requirement.

## Understanding progress and finalization

The analyzed-file count can reach the discovered-file count before the session
is ready to close. Audio-V therefore reserves 100% for durable completion and
names the remaining stage:

- **Album ReplayGain** groups eligible tracks.
- **Fingerprint relationships** link exact and bounded similarity matches.
- **Durable history** commits the final session state.

For sources above 1,000 files, Audio-V keeps calculated track ReplayGain but
defers the second full-library album decode. Audit an album or smaller folder
when exact album ReplayGain is needed. For sources above 2,000 files, exact
fingerprint duplicates remain linked while near-match expansion is deferred.
These limits keep completion time and stored evidence bounded.

## Identity library

Identity lists Chromaprint entries retained from historical audits, exact-fingerprint peers, last-seen time, and whether the original source path still exists. Historical finalization uses a bounded storage queue: selections above 100 files use indexed exact-fingerprint lookup, smaller selections can also inspect near-duration candidates, and historical enrichment is deferred above 1,000 files. If supplemental history lookup becomes unavailable, Audio-V completes the audit and reports one notice; current-audit relationships and Oracle verdicts remain intact. **Rebuild from history** recreates the index from saved audit evidence. **Prune missing** removes only entries whose source path no longer exists. **Clear index** removes historical fingerprints after confirmation but leaves saved audit sessions intact, so a later rebuild can restore eligible entries.

## Origin Assessment

**Heuristic rule strength** is the ordinal none, weak, moderate, or strong. It shows how completely a classifiable file matches a versioned multi-feature rule; it is not a probability that a source history is true.

**Evidence coverage** shows how much usable classifier input was available. An inconclusive file still receives coverage and a reason such as insufficient duration, unmeasurable bandwidth, or unstable cutoff.

**Regional stability** shows how consistently a measured band edge repeats across active time regions. Strong origin Review requires corroboration from at least one additional evidence family.

Intentional filtering, microphones, instruments, analog transfers, noise reduction, and mastering can resemble codec cutoffs. Use Origin Assessment to prioritize review, not accuse a source.

## Compare

Load File A and File B independently from disk or choose current-audit files. Audio-V compares identity, properties, waveform envelopes, spectra, normalized spectral difference, preview-derived offset/gain/polarity, and a full-track per-channel null without adding playback.

Large audit lists intentionally retain compact summary records in memory.
Selecting either file in Compare automatically restores its full waveform and
spectrogram evidence from the saved session. While that happens, the affected
panel says that visual evidence is loading; a failed restore produces an
explicit error rather than a blank or stale canvas.

Automatic mapping runs a full-track null when channel counts match. For differing layouts, choose **Explicit channel map** and pair each participating File A channel with one File B channel. Each channel can appear once. Without an explicit map, Audio-V preserves the bounded mono alignment preview and explains why a full null was not attempted.

## Repair

Repair is triage, not a claim that every Review file is damaged. Audio-V explains whether replacement, manual verification, comparison, or optional mitigation is appropriate.

The automated true-peak action creates a separate FLAC working copy and never overwrites the source. It preserves source word length by default, offers explicit 16/24-bit output, applies triangular dither to 16-bit processing output, retains supported metadata/artwork, and audits the copy. Gain reduction prevents new positive true peaks; it does not reconstruct clipped samples.

## Reports

The Reports workspace opens complete per-file evidence and exports the current authoritative audit as PDF, XLSX, DOCX, CSV, or JSON. Reports can contain filenames, absolute paths, hashes, and audio measurements. Review them before sharing.

## History and recovery

Audio-V stores the source, discovered count, completed records, and currently decoding file set in a local SQLite checkpoint. If the application process ends during a scan, the next launch restores the last source label and marks the orphaned session **Interrupted** in History.

**Resume adaptively** starts directly from that checkpoint without first loading the entire partial result set into the interface. It reuses completed records whose file size, modification time, and Oracle engine version still match. Files that were active during the interruption are first validated serially with one worker, one FFmpeg thread, a 256 MB worker heap, and a 512 MB native-process limit. After that isolated stage succeeds, Audio-V automatically rebuilds the worker pool with the saved pre-crash settings for the remaining library.

If the same file interrupts the application again during safe validation, the next adaptive resume quarantines only that repeated candidate as **Analysis error · Quarantined during crash recovery**, not Failed or damaged, and restores the saved settings for everything else. **Use prior limits** explicitly bypasses isolated validation and carries a repeat-crash risk. Settings preserve the requested profile while separately displaying the effective recovery or full-audit limits. If a saved removable or network source is not mounted, Audio-V explains which path must be reconnected instead of starting a broken resume.

**Clear history** removes all finished, canceled, failed, and interrupted sessions from the History list immediately after confirmation. It is unavailable while an audit is active and never deletes source audio, reusable Oracle cache records, or the separate Identity fingerprint index. Large session collections are physically reclaimed in small background batches so the interface remains usable; visible status confirms when that cleanup finishes, and an interrupted cleanup resumes on the next launch. If you clear the history currently open in the workspace, Audio-V closes that saved view and returns to an empty audit workspace.

New databases return freed pages to the operating system incrementally. A
database created by an older Audio-V version may still contain substantial
unused pages after its records are removed. Settings shows database, live, and
reclaimable sizes. **Reclaim unused storage** performs a one-time isolated
compaction, enables bounded future reclamation, preserves cache and Identity
records, and is unavailable while an audit or history cleanup is active. Keep
Audio-V open until the operation finishes.

Settings also shows **Acceptance and soak evidence** for the latest audit:
package version, platform and architecture, completed workload and bytes,
elapsed time and throughput, sampled peak process working set, database
growth, cancellation response, source-storage class, and recovery mode. Export
this privacy-safe JSON when documenting a real-library or clean-machine test.
It contains no filenames, paths, hashes, tags, audio evidence, or service
credentials.

## Keyboard commands

- `Command/Ctrl+O` — choose audio files
- `Command/Ctrl+Shift+O` — choose a folder
- `Command/Ctrl+1` through `6` — Audit, Identity, Compare, Repair, Reports, Settings
- `Escape` — close audit history

## Support diagnostics

Settings can export a privacy-safe diagnostic JSON file containing application/runtime versions, worker count, aggregate session statuses, and the engine manifest. It excludes filenames, source paths, checksums, tags, and report evidence.

Audio-V also maintains rotating structured application logs for lifecycle
events, scan coordination, per-file starts and outcomes, Oracle worker
attempts, timeouts and recycling, storage recovery, checkpoints, and native
process termination. Open **Settings → Support diagnostics → Open log folder**
to inspect them.

Every completed audit also records the Audio-V version, elapsed wall time,
file/error counts, database and reclaimable sizes, and point-in-time main
process memory. This makes future real-library runs evidence-bearing. It does
not claim to be total peak memory across Electron and FFmpeg processes.

- macOS: `~/Library/Application Support/audio-v/logs`
- Windows: `%APPDATA%\audio-v\logs`

The active `audio-v.jsonl` file is limited to 8 MB and four rotated files are
retained. These local logs include filenames and paths so a timed-out artifact
can be identified. They remain on the computer unless the user chooses to
share them. The privacy-safe diagnostics export remains path-free.

Settings also displays the packaged Oracle validation basis: public independent source-master count, contributor groups, controlled cases, corpus version, current claim level, and the first material limitation. “Infrastructure ready · masters pending” means the validation machinery exists but no licensed real-world master has been counted; it is not a hidden calibration score.

**Audit resource policy** applies to the next audit. Choose Recovery safe, Balanced, or Performance, or set 1–8 concurrent Oracle workers, a 128–512 MB JavaScript heap cap, 1/2/4 FFmpeg threads per file, and a 256 MB–2 GB native-process RSS limit individually. These selectors are per-file ceilings, so maximizing every selector is not a valid performance preset. Before creating workers, Audio-V caps their aggregate at the smaller of 20% of physical memory or 8 GB, with a minimum application budget of 1.5 GB, reserves memory for the desktop process, and limits aggregate FFmpeg threads to 75% of logical CPUs. The Settings card keeps the requested configuration intact and separately reports effective audit limits and adaptive-recovery transitions. Crossing an enforced native limit terminates that file as a resource error rather than calling it damaged.

**Mounted-source I/O policy** is automatic on both platforms. Audio-V recognizes macOS `/Volumes` paths, Windows UNC paths, mapped drives, and non-system drive letters. Directory discovery issues at most eight concurrent metadata operations. Each active full-audit file uses one 4 MB sequential copy into local temporary storage, then packet inspection, decoding, loudness, integrity, fingerprint, and spectral passes run locally before the copy is deleted. Up to four transfers can be active because transfer count follows the safely resolved worker count. Staging is skipped when a file is larger than 16 GB or would consume more than half of currently unreserved temporary space; the status line discloses whether staging or direct analysis is active. Metadata Inventory does not stage files because it does not perform repeated full-stream passes.

SMB, NFS, and removable-drive transport sessions remain managed by macOS or Windows; Audio-V does not create “web sessions” or bypass the mounted filesystem. On a 1/10 GbE share, throughput still depends on server disks, SMB multichannel/signing settings, client adapters, Wi-Fi versus Ethernet, and competing clients. The application optimization reduces repeated source reads and share round trips without claiming a fixed line-rate result.

**Cancel audit** changes the workspace to an explicit Cancelling state, stops assigning files, interrupts discovery and native decoders, and checkpoints completed records before the session closes as Canceled. If synchronous signal analysis cannot receive a cooperative cancel message promptly, Audio-V replaces that worker after a short grace period. Cancellation does not mark an active source file damaged; reopen the partial evidence or resume the source from History.

Large sessions retain the complete measurement and verdict summary while
compacting durable display evidence to a 32-region spectrogram overview and a
160-point waveform. Selecting a track can regenerate higher-resolution
spectrogram tiers from the source on demand. This prevents thousands of
approximately megabyte-sized visual payloads from being duplicated across
Electron processes without discarding the evidence that determined the
verdict.

**AcoustID recognition** is off by default. An official Audio-V package can contain the registered Audio-V client identity, while a development build or fork requires the 10-character key from its own registered AcoustID application. The Settings card says which case applies. This is not the separate user submission key. Audio-V trims copied whitespace, checks the format, and asks AcoustID to validate an override before file discovery begins. A rejected key stops the audit before repeated lookups and displays the service explanation. **Save identity settings** encrypts the key with macOS Keychain or Windows DPAPI and remembers both service switches for future launches; Audio-V refuses plaintext fallback. When enabled, Audio-V sends the local Chromaprint value and rounded duration—not the audio—to AcoustID using bounded POST requests. Calls are serialized below three requests per second, repeated fingerprints are cached, and HTTP 429/502/503/504 responses receive at most three attempts with bounded backoff. No client key is written to saved sessions or reports.

**MusicBrainz enrichment** has its own switch and needs no API key. It looks up one valid recording ID per file, preferring an ID already embedded in the metadata and otherwise using the strongest AcoustID candidate. The result can add credited artists, ISRCs, a first-release date, and up to eight release groups. Audio-V caches repeated IDs, spaces request starts beyond the public one-request-per-second boundary, and makes no more than three bounded attempts when MusicBrainz is throttling, busy, temporarily unavailable, or times out. Enabling it for a large library can therefore significantly extend the audit. Final service errors and missing IDs stay visible and neutral. AcoustID and MusicBrainz results are identity leads, not proof of ownership, mastering provenance, integrity, or sound quality.

Audio-V waits for saved identity preferences to finish restoring before a new audit begins. A full audit labels disabled services, missing recording identifiers, queued recognition, no matches, matches, and service errors separately; the older generic **Not requested** wording is not used as a catch-all. Metadata Inventory intentionally performs no external recognition because it does not calculate a Chromaprint.

**Parallel identity result** appears in the evidence inspector and exported reports after external lookup. Metadata corroborated means all comparable ID, title, and artist declarations agree. Identity matched means an acoustic match exists but local tags are insufficient. Metadata conflict identifies the exact declared and external values that disagree. Inconclusive means there was no usable external identity. These labels help review catalog information; they never promote Review to Clear, demote Clear to Review, or override Failed.

Open **Identity** and choose **Identify current audit** when an audit already
contains measured Chromaprint evidence. Audio-V recognizes the current list in
place, shows file-by-file progress, saves each completed result as it arrives,
and optionally adds MusicBrainz details. It does not decode the audio again.
This is useful when a fully local audit was completed first or when an external
service was unavailable during the original scan.

## Visual comparison modes

Compare keeps File A and File B on one synchronized time axis:

- **Stacked** shows both waveform and spectrum views independently.
- **Overlay** blends File B over File A with an opacity control.
- **Wipe** uses a movable boundary to reveal A on one side and B on the other.
- **Blink** alternates A and B every 650 milliseconds so movement stands out.

Zoom and horizontal position apply to every waveform and spectrum view. The
Difference panel compares normalized source spectra. The Residual panels show
the bounded aligned mono preview after Audio-V adjusts offset, polarity, and
gain. Choose a start and end time, then select **Measure selected region** to
calculate correlation, residual level, and residual peak for that passage.
These visual and regional aids do not replace the complete overlapping,
per-channel null test shown in Decoded-signal alignment.

An `aligned-equivalent` relationship requires strong alignment evidence and at
least 80% duration coverage. A deep null over a very short overlap or an
uncorrelated periodic signal is not promoted to equivalence.

For account creation, the correct AcoustID key type, step-by-step Settings
instructions, privacy details, and service-error help, use the dedicated
[AcoustID and MusicBrainz setup guide](EXTERNAL_IDENTITY_SERVICES.md).

## Headless folder automation

Source and CI users can audit files or recursive folders without opening the desktop:

```bash
npm run cli -- ./collection --output ./audio-v-evidence.json --concurrency 2 --memory-mb 256 --fail-on failed
```

Use `--fail-on review`, `failed`, or `never` to choose when evidence returns policy exit code 2. Processing errors return exit code 1. The output uses the same compact Oracle v12 five-lane JSON contract as desktop JSON reports. Desktop packages include launchers under `Contents/Resources/cli` on macOS and `resources\cli` on Windows.

For unsigned installation and checksum verification, see [UNSIGNED_INSTALLATION.md](UNSIGNED_INSTALLATION.md).
