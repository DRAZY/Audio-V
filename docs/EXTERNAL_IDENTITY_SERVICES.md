# AcoustID and MusicBrainz setup

Audio-V can optionally ask two public music databases for identity information.
These services help answer **“What recording might this be?”** They do not
answer **“Is this audio healthy?”**, so their results appear beside the Oracle
verdict rather than changing it.

Both integrations are off by default. Audio analysis still works without them.

## The simple version

| Service | What it adds | What setup is needed? |
|---|---|---|
| **AcoustID** | Tries to recognize a recording from a locally calculated acoustic fingerprint | Official client identity in a configured Audio-V build, or a free registered-application key for source builds and forks |
| **MusicBrainz** | Adds recording title, credited artists, ISRCs, first-release date, and release-group context | No key; enable its separate switch |

For the fullest identity result, enable both. AcoustID can suggest a
MusicBrainz recording ID for files that do not already contain one, and
MusicBrainz can then add readable catalog details.

## Set up AcoustID

Open Settings first. Audio-V reports whether the installed build contains the
official registered client identity. Recognition remains off until you enable
it or choose the batch action; bundling the identity does not silently contact
the service.

A source build or fork needs an **application API key**, sometimes called a
client key. A user can also type one as an override in an official build.
Audio-V does not use the separate user API key intended for submitting
fingerprints.

1. Visit [AcoustID](https://acoustid.org/) and sign in.
2. Open [Register your application](https://acoustid.org/new-application).
3. Register Audio-V as the application you are using.
4. Copy the application API key shown by AcoustID.
5. Open **Settings** in Audio-V.
6. Turn on **AcoustID recognition**.
7. Paste the key into **AcoustID API key · optional override**.
8. Start an audit. Audio-V trims accidental spaces and validates the key before
   it begins scanning files.

You can revisit [your registered AcoustID
applications](https://acoustid.org/my-applications) later. Do not copy the user
submission key from the AcoustID user page; it serves a different purpose.
Temporary keys shown in API examples also expire and should not be used.

## Identify an audit that already finished

1. Open an audit or finish a new local audit.
2. Open **Identity**.
3. Choose **Identify current audit**.

Audio-V reuses the Chromaprint evidence already measured for each file. It
shows progress, stores each completed result as it arrives, and asks
MusicBrainz for readable details. No second audio decode is required. AcoustID
calls are serialized below three requests per second, identical fingerprints
share a cached result, and temporary HTTP 429/502/503/504 responses are retried
at most three times with bounded backoff.

> [!NOTE]
> AcoustID provides its public service for non-commercial use and asks clients
> not to exceed three requests per second. Review the current
> [AcoustID web-service rules](https://acoustid.org/webservice) before
> distributing a modified build or using the service commercially.

## Enable MusicBrainz enrichment

MusicBrainz enrichment is independent from AcoustID and does not require an API
key for Audio-V's read-only recording lookup.

1. Open **Settings** in Audio-V.
2. Turn on **MusicBrainz enrichment**.
3. Start the next audit.

Audio-V first looks for a valid MusicBrainz recording ID already stored in the
file. If none is present and AcoustID is also enabled, it can use the strongest
AcoustID candidate. If neither source supplies a recording ID, MusicBrainz has
nothing reliable to look up and the result stays inconclusive.

MusicBrainz asks public clients to average no more than one request per second.
Audio-V serializes these lookups and caches repeated recording IDs during the
session. A large library can therefore take longer when enrichment is enabled.
See the official [MusicBrainz API
documentation](https://musicbrainz.org/doc/MusicBrainz_API) and [rate-limit
policy](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

## What the identity result means

External identity evidence is summarized in a separate result:

| Result | Plain-language meaning |
|---|---|
| **Metadata corroborated** | The usable external identity agrees with the comparable recording ID, title, and artist stored in the file. |
| **Identity matched** | An external recording match exists, but the file does not declare enough comparable metadata to confirm it. |
| **Metadata conflict** | At least one comparable recording ID, title, or artist value disagrees. The evidence report shows both values. |
| **Inconclusive** | No usable external identity was available. This is not a failure. |

These results can strengthen catalog confidence or reveal tags worth fixing.
They never promote Review to Clear, demote Clear to Review, erase Failed, or
prove ownership, mastering history, or audio fidelity. Oracle verdicts remain
based on the decoded file and disclosed integrity and signal evidence.

## What leaves the computer

| When enabled | Audio-V sends | Audio-V does not send |
|---|---|---|
| AcoustID | The locally calculated Chromaprint fingerprint, rounded duration, and application key | The audio file, local path, filename, or file hash |
| MusicBrainz | One MusicBrainz recording ID | The audio file, fingerprint, local path, filename, or file hash |

A key entered in Settings stays in application memory for the current session.
An official client identity, when present, is packaged as a release resource
rather than stored in source control. Audio-V does not save either value in
history, reports, diagnostics, or source records. Returned identity details are
saved with the audit evidence so the report remains understandable later.

For the complete data-handling contract, read [Privacy and
security](PRIVACY_SECURITY.md).

## Troubleshooting

### “The AcoustID application key was rejected”

- Confirm that you copied the registered **application** key, not the user
  submission key.
- Remove hidden spaces or line breaks by pasting the key again. Audio-V trims
  ordinary surrounding whitespace automatically.
- Do not use a key copied from an API example; example keys expire.
- Open [your registered applications](https://acoustid.org/my-applications) and
  confirm that the application still exists.

Audio-V checks the credential before scanning so one incorrect key does not
produce thousands of failed requests.

### “No AcoustID match”

This means the service did not return a usable candidate. The recording may be
absent from the community database, substantially edited, too short, or
difficult to identify. It does not mean the file is damaged or low quality.

### “MusicBrainz had no recording identifier”

The file did not contain a valid MusicBrainz recording ID, and AcoustID did not
supply one. Enable AcoustID as well if you want Audio-V to attempt recognition
first.

### A service reports a limit, timeout, or temporary error

External databases can be unavailable or rate-limit requests. The file's local
Oracle analysis remains valid, while external identity stays neutral. Retry a
smaller audit later and consult the service-status information if the problem
continues.

### A large audit finishes more slowly

MusicBrainz lookup is deliberately limited to one request per second. Use the
services when catalog identity matters; leave them off for the fastest fully
local integrity and fidelity audit.
