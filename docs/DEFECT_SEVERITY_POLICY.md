# Audio-V defect severity and release blocking

Audio-V distinguishes **zero known blocking defects** from the impossible claim
that no undiscovered defect exists. Every confirmed release-affecting problem
is recorded in `validation/release-defects.json` until it is fixed or formally
closed.

## Severity

| Severity | Meaning | Release effect |
| --- | --- | --- |
| **P0 — Critical** | Data loss, source mutation, security boundary failure, or systematically false deterministic verdict | Blocks every package and release |
| **P1 — High** | Reproducible crash, unrecoverable audit, broken primary workflow, major cross-platform failure, or materially incorrect evidence | Blocks release candidate and GA |
| **P2 — Medium** | Important defect with a safe workaround that does not corrupt evidence or data | Must be disclosed and triaged |
| **P3 — Low** | Cosmetic, wording, or low-impact workflow defect | May be scheduled after release |

`open`, `investigating`, and `mitigated` P0/P1 entries are blocking. Only
`fixed`, with a regression test or explicit verification reference, closes a
blocking defect. “Cannot reproduce” requires the environment and attempts to
be recorded; it does not silently become fixed.

## Release gate

`npm run verify:defects` checks the register schema, exact package version,
unique IDs, valid states, audit age, and unresolved P0/P1 count. The generated
`build/defect-register-latest.json` is consumed by the release-candidate gate.

GitHub issues remain useful for collaboration. The versioned register is the
offline, reproducible release truth source and prevents a private, deleted, or
temporarily unavailable issue tracker from changing whether a build passes.
