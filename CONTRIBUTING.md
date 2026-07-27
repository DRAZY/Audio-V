# Contributing to Audio-V

Audio-V welcomes reproducible defect reports, validation fixtures with documented provenance, accessibility improvements, documentation, and focused code changes.

## Before submitting code

1. Do not submit confidential audio, personal data, credentials, or material You cannot legally redistribute.
2. Add or update tests for behavioral changes.
3. Run:

   ```bash
   npm ci
   npm run provision:engines
   npm run verify
   npm run validate:platform
   ```

4. Keep Oracle claims within the evidence boundaries documented in `docs/METHODOLOGY.md`.
5. Complete the Contributor License Agreement checkbox in the pull-request template.

## Contributor agreement

Contributions are accepted under the [Audio-V Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md). Contributors retain copyright while granting the Project and its users the rights needed for AGPL distribution, enforcement, future dual licensing, and commercial editions.

The agreement does not permit contributors to relicense third-party material they do not own. Identify every third-party source and license in the pull request.

## Licensing and branding

Project code is licensed under `AGPL-3.0-only`. Dependencies and bundled engines retain their own licenses. The Audio-V name, logo, icon, Oracle Engine identity, and official-release designation are governed by [TRADEMARKS.md](TRADEMARKS.md).
