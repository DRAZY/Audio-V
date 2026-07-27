# Privacy and security model

Audio-V performs analysis locally. The application has no telemetry, advertising, account system, cloud upload, automatic metadata lookup, or audio playback service.

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

Every package contains the engine manifest, provenance, third-party notices, AGPL license, source notice, and trademark policy.

## Unsigned distribution

Official development artifacts are intentionally unsigned. Users must verify the complete SHA-256 digest against the official release before approving an operating-system warning. Audio-V does not recommend disabling Gatekeeper, SmartScreen, Smart App Control, or organization policy globally.

The project’s future signed build paths require credentials supplied as CI secrets. No certificate, password, API token, or private signing material belongs in the repository.

## Vulnerability and defect reporting

Do not include private audio, personal paths, credentials, or unpublished reports in a public issue. Attach the privacy-safe diagnostic export and a minimal redistributable fixture when possible. Security reports should use the private security-reporting channel configured on the official GitHub repository once it is enabled.
