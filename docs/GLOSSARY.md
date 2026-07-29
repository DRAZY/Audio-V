# Audio-V plain-language glossary

This glossary explains common terms used by Audio-V. The definitions are
intentionally short; the [Oracle Engine guide](ORACLE_ENGINE.md) explains how
they affect a verdict.

| Term | Plain-language meaning |
|---|---|
| **AcoustID** | An optional external service that compares a locally calculated acoustic fingerprint with a community database. A match is an identity lead, not an audio-quality verdict. |
| **AcoustID application key** | The client key issued after registering an application with AcoustID. It is different from the user key used to submit new fingerprints. |
| **Acoustic fingerprint** | A compact description of how a recording sounds. It can find related recordings even when their file bytes differ. |
| **Advisory** | An observation worth showing that is not strong enough to change Clear to Review. |
| **Analysis error** | Audio-V could not finish a processing stage. It is not proof that the file is damaged. |
| **Bit depth** | The number of bits used to describe each sample. More bits can provide more precision, but a larger label does not prove that useful detail exists. |
| **Bit padding / unused bits** | A file declares a word length, but some lower bits are consistently unused. This can be a clue about prior processing, not proof of its cause. |
| **Bitrate** | The amount of data used per second. It describes data rate, not guaranteed sound quality. |
| **Channel** | One stream of audio, such as left or right in stereo. |
| **Chromaprint** | The open acoustic-fingerprint system used locally by Audio-V to find duplicate or similar recording candidates. |
| **Clipping** | Samples reach or exceed the maximum digital level, potentially flattening the waveform. It can be accidental or intentional. |
| **Codec** | The method used to store or compress audio, such as FLAC, MP3, AAC, or PCM. |
| **Container** | The file structure that holds audio and metadata, such as WAV, MP4/M4A, Matroska, or OGG. |
| **Content Credentials / C2PA** | Cryptographically attached provenance statements. A valid statement is properly attached; it does not guarantee artistic truth or audio quality. |
| **Correlation** | A measurement of how similarly two channels move. Negative or near-identical channels can be intentional. |
| **DC offset** | A waveform is centered slightly above or below digital zero. Large offset deserves review but is not file corruption. |
| **Decode** | Turn stored audio data into samples that can be measured. Audio-V decodes the selected stream from beginning to end. |
| **Deterministic evidence** | A repeatable yes/no check, such as a checksum match. |
| **DR / dynamic-range descriptor** | A measurement related to the difference between stronger and weaker parts of a signal. It is not a universal score of musical quality. |
| **Evidence coverage** | How much usable information was available to the spectral-origin rules. It is not a probability of truth. |
| **Failed** | Audio-V found deterministic integrity evidence against the file itself. |
| **FFmpeg** | The bundled media engine Audio-V uses to inspect and decode many audio formats. |
| **FLAC audio MD5** | A checksum stored inside many FLAC files for the uncompressed audio samples. A mismatch is deterministic integrity evidence. |
| **Full scale** | The maximum digital sample level, commonly written as 0 dBFS. |
| **Hash / checksum** | A value calculated from data to help detect changes. SHA-256 identifies exact file bytes; FLAC audio MD5 identifies decoded samples. |
| **Heuristic** | A disclosed pattern-based rule. It provides a clue, not absolute proof. |
| **Identity matched** | An external service found a likely recording, but the file does not contain enough comparable metadata to call it corroborated. |
| **Identity result** | Audio-V’s separate summary of external catalog evidence: Metadata corroborated, Identity matched, Metadata conflict, or Inconclusive. It is not an Oracle audio verdict. |
| **Inconclusive identity** | No usable external identity was available. This is neutral, not a failure or quality concern. |
| **Integrated LUFS** | A standardized estimate of average perceived loudness over the whole track. |
| **Lossless** | A codec can reproduce the stored audio samples exactly, such as FLAC or ALAC. It does not prove the source was always lossless. |
| **Lossy** | A codec removes information to reduce size, such as MP3 or AAC. |
| **Loudness range (LRA)** | A standardized description of loudness variation across a program. |
| **Manifest** | A separate file listing expected hashes for one or more files. |
| **Metadata** | Editable information such as title, artist, album, codec label, or identifiers. |
| **Metadata conflict** | The external identity and at least one comparable recording ID, title, or artist stored in the file disagree. It does not change the Oracle verdict. |
| **Metadata corroborated** | The usable external identity agrees with all comparable recording ID, title, and artist values stored in the file. |
| **MusicBrainz** | A community-maintained music database. Audio-V can optionally use a recording ID to add artist, ISRC, date, and release-group context without changing the Oracle verdict. |
| **Near mono / dual mono** | Stereo channels contain nearly or exactly the same signal. This can be intentional and is not damage. |
| **Not analyzed** | Audio-V inventoried metadata but did not decode and assess the signal. |
| **Null test** | Align two decoded signals and subtract one from the other. A quiet residual suggests similarity; it does not prove provenance. |
| **Oracle Engine** | Audio-V’s versioned analysis pipeline, evidence organizer, and verdict system. |
| **Origin Assessment** | Conservative spectral clues about possible prior transcoding or upsampling. It does not prove source history. |
| **PCM** | The decoded sample representation used for direct signal measurements. |
| **Provenance** | Information about where an asset came from or how it was handled. Provenance claims and audio quality are separate questions. |
| **ReplayGain** | A loudness-normalization value. Audio-V calculates track gain and, for eligible smaller audits, album gain. |
| **Review** | The audit completed, but at least one material finding deserves human inspection. Review does not automatically mean damage. |
| **Rule strength** | How fully a spectral pattern matched the current rule: none, weak, moderate, or strong. It is not a probability. |
| **Sample rate** | How many samples are stored each second, such as 44.1 kHz or 96 kHz. A higher label does not prove useful high-frequency content. |
| **Spectrogram** | A picture showing frequency energy over time. Color represents strength, not quality. |
| **True peak / dBTP** | An estimate of peaks between stored samples, useful for delivery and transcoding headroom. |
| **Upsample** | Raise the sample-rate label or processing rate. Upsampling does not recreate missing source detail. |
| **Verdict** | Oracle’s scoped result: Clear, Review, or Failed. Analysis error and Not analyzed are separate workflow states. |
| **Waveform** | A view of signal level over time. |
