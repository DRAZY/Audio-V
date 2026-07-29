# Privacy and security model

Audio-V performs analysis locally by default. The application has no telemetry, advertising, account system, cloud upload, automatic metadata lookup, or audio playback service.

## File authority

- Files and folders enter the application through native user selection.
- Renderer requests are validated against main-process selections before analysis, comparison, reveal, export, or repair.
- Repair never overwrites the selected source.
- Reports and repaired copies are written only after a native save dialog.
- Navigation, new windows, and renderer permission requests use default-deny policies.

## Local data

Audit sessions and the Oracle cache are stored in the Electron per-user application-data directory using SQLite WAL mode. They can contain source paths, file properties, hashes, verdicts, and measurements. Removing the application does not necessarily remove this per-user evidence database.

Audit reports can contain identifying file paths and cryptographic hashes. Users should review reports before publishing them.

Privacy-safe diagnostics are intentionally separate from evidence exports. Automated tests ensure the diagnostics builder accepts aggregate session status rather than filenames, paths, checksums, tags, or evidence.

## Processes and bundled engines

FFmpeg and ffprobe are bundled, checksum-pinned engines. The main process invokes them with argument arrays rather than shell command construction. Oracle and comparison analysis run in bounded workers; SQLite runs in a dedicated storage worker.

Every package contains the engine manifest, provenance, C2PA Tool and Chromaprint license texts, third-party notices, AGPL license, source notice, and trademark policy. C2PA inspection disables remote-manifest and OCSP network fetching. Chromaprint fingerprinting is local and does not upload audio.

Audio-V can read audio from removable storage and operating-system-mounted network shares only after the user selects a file or folder through the native chooser. On macOS this includes mounted locations under `/Volumes`; on Windows it includes mapped drive letters and UNC paths. Audio-V does not mount shares, store network credentials, or expose an SMB/NFS server. Analysis remains local, although reading a file from a network share necessarily transfers that file's bytes across the user's configured network filesystem.

During a full audit of a mounted or non-system source, one active file may be copied into an operating-system temporary directory so repeated Oracle passes do not repeatedly traverse the network or removable bus. The copy is deleted when that file finishes or is canceled. Staging directories are process-scoped; a later run removes remnants owned by a process that is no longer running. Metadata Inventory does not create staged audio copies. Temporary-space reservations prevent concurrent workers from consuming more than the disclosed safe budget.

## Optional external identity lookup

AcoustID recognition is disabled by default and runs only when the user enables it for the next audit or chooses **Identify current audit**. A configured release can include the registered Audio-V client identity in an ignored packaged resource; a source build, fork, or user override can provide its own registered-application key. Audio-V sends the locally calculated Chromaprint fingerprint and rounded duration to `https://api.acoustid.org`; it does not send the audio file, filename, local path, or file hash. Requests are serialized below the public limit, repeated fingerprints are cached in memory, and only transient HTTP failures receive bounded retries. Client keys are excluded from source control, session history, diagnostics, and exported evidence. The returned AcoustID and linked MusicBrainz recording identifiers are evidence leads, not proof of ownership, mastering provenance, or byte identity.

When the user chooses **Save identity settings**, Audio-V encrypts the personal AcoustID key with Electron safe storage, backed by macOS Keychain or Windows DPAPI, and writes only the encrypted value to the current user's application-data directory. Audio-V refuses plaintext credential persistence when operating-system encryption is unavailable. The key is decrypted into application memory only when Settings or an explicitly enabled lookup needs it. It remains excluded from persisted audit sessions, reports, diagnostics, returned source records, source control, and release packages. **Clear stored key** removes it.

MusicBrainz enrichment is a separate opt-in. It sends one MusicBrainz recording identifier—not the fingerprint or audio—to `https://musicbrainz.org` and receives community-maintained recording, artist, ISRC, date, and release-group fields. Audio-V prefers a valid recording ID embedded in the file, otherwise it can use the strongest AcoustID candidate. Unique IDs are cached in application memory and public requests are globally limited to one per second. The returned fields are saved as advisory identity evidence and never change the Oracle verdict.

The parallel identity result is calculated locally from the returned identity and the file's existing recording ID, title, and artist declarations. No additional network request is made for this comparison.

The [external identity services setup
guide](EXTERNAL_IDENTITY_SERVICES.md) explains how to enable either service,
which AcoustID credential is accepted, and how to interpret service failures
without confusing them with Oracle verdicts.

## Unsigned distribution

Official macOS development app bundles use an ad-hoc integrity signature without an Apple Developer ID identity or notarization; official Windows development artifacts are unsigned. Users must verify the complete SHA-256 digest against the official release before approving an operating-system warning. Audio-V does not recommend disabling Gatekeeper, SmartScreen, Smart App Control, or organization policy globally.

The project’s future signed build paths require credentials supplied through the local process environment or an external secret manager. No certificate, password, API token, or private signing material belongs in the repository.

## Vulnerability and defect reporting

Do not include private audio, personal paths, credentials, or unpublished reports in a public issue. Attach the privacy-safe diagnostic export and a minimal redistributable fixture when possible. Security reports should use the private security-reporting channel configured on the official GitHub repository once it is enabled.
