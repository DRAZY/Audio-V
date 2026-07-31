# Audio-V v0.4.42 — Clearer scientific-state disclosure

Audio-V v0.4.42 replaces the ambiguous “Corpus present · not calibrated” label
with an exact description of the completed Oracle Origin evaluation.

## What changed

- Settings now reports **Evaluated · no model promoted**.
- The validation card explains that the experimental Origin candidate failed
  independent false-advisory requirements and Oracle v12 stayed unchanged.
- Documentation makes clear that ordinary audits never train or silently
  recalibrate Oracle.
- A regression test prevents the completed evaluation from being presented as
  unfinished background calibration.
- The GA readiness audit now distinguishes Audio-V from Spek, SquidWTF Spec,
  AudioAuditor, Sonic Visualiser, Fakin' The Funk?, CUETools, and AccurateRip.

## Verification

- 203 automated tests pass across 42 test files.
- Type checking and the production renderer build pass.
- The accessibility audit passes 41 DOM rules and 154 exposed semantic nodes.
- Responsive-layout acceptance passes at wide, standard, minimum, and snapped
  desktop sizes.

## Packages

- `Audio-V-0.4.42-mac-arm64.dmg` — macOS Apple Silicon
- `Audio-V-0.4.42-mac-universal.dmg` — macOS Universal
- `Audio-V-0.4.42-win-x64.exe` — Windows installer
- `Audio-V-Portable-0.4.42-x64.exe` — Windows portable

> Audio-V remains an unsigned open-source development release. Verify package
> checksums and follow `docs/UNSIGNED_INSTALLATION.md` for first-launch steps.
