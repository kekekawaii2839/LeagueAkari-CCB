# League Akari CCB release policy

> This document owns release identity and distribution conditions, not task authorization or current
> test status. Use [README](README.md) for dated evidence and the parent AGENTS for permission boundaries.

## Current release identity

- Product name: `League Akari CCB`
- Application ID: `com.ccb.leagueakari`
- Windows executable: `LeagueAkariCCB.exe`
- Application directory: `League Akari CCB`
- First internal version: `0.1.0-ccb.1`
- Supported platform: Windows x64 only
- Distribution format: portable full 7z archive; no installer

These are package identity requirements; verify the active packaging configuration before building.

The CCB identity must remain separate from official League Akari. CCB does not automatically read, copy or migrate official League Akari userData, databases, logs, tokens, settings or caches. CCB schema migration applies only to older CCB data.

## Versioning

- Internal iterations: `0.1.0-ccb.1`, `0.1.0-ccb.2`, and so on.
- First relatively stable version: `0.1.0`.
- CCB feature releases increment the SemVer minor component.
- Fix/security releases increment the patch component.
- Every release entry in `docs/fork/README.md` records the exact official upstream SHA separately; the official product version is never reused as the CCB version. Do not create a separate Markdown release report.

## Current distribution and update policy

- Current builds are unsigned and for local/internal use only.
- Do not publicly distribute an unsigned build.
- Automatic update remains compile-time disabled.
- The only CCB source and manual release page is
  `https://github.com/LHLKEVIN0713/LeagueAkari-CCB`; never download a CCB update from the official
  League Akari repository or API.
- Official League Akari packages remain rejected at download, apply, quit and uninstall boundaries.
- Upgrade only by closing CCB, backing up CCB userData and replacing the complete portable application directory.
- Replacing the application directory must not remove CCB userData.
- Upstream Akari currently places general Windows logs beside the executable. CCB must sanitize every logger payload before transport; player identifiers and credential values are forbidden even in local/internal logs.

## Future fork self-update gate

Fork self-update is an intended future capability, but it must not be enabled until all of the following exist and pass rollback testing:

1. A release repository/feed owned by the CCB fork, never the official League Akari feed.
2. A stable CCB product identity and versioned update manifest.
3. SHA-256 for every downloadable artifact and manifest verification before execution.
4. A real Windows code-signing certificate and protected signing workflow.
5. Signed manifest or equivalent authenticity verification independent of transport TLS.
6. Previous complete version retention, atomic switch and verified rollback after download, hash, signature, startup or migration failure.
7. Explicit refusal of product/appId/feed mismatch and every official League Akari artifact.
8. Clean Windows upgrade, downgrade-readonly and rollback tests.

Until every item passes, the only supported update mechanism is manual replacement of the complete CCB package.

## Upstream maintenance policy

- First release baseline is fixed at official SHA `ba522009f0d85b0ee0979e76e3b92724555d4c53` from `dev`.
- Remote model: official `Hanxven/LeagueAkari` as `upstream`; CCB repository
  `LHLKEVIN0713/LeagueAkari-CCB` as `origin`.
- `.github/workflows/upstream-sync.yml` checks official `upstream/dev` daily and on manual dispatch.
  It merges on a temporary automation branch, advances the recorded upstream baseline, runs the
  patch guard, full tests, production build, CCB Windows package, and artifact scan, and pushes the
  verified merge to `dev` only when every gate succeeds. Conflicts or failed gates leave `dev`
  unchanged.
- Perform upstream sync on a temporary sync branch, run patch-manifest, full tests, packaging and artifact scans, and only then integrate it into a CCB release branch.
- Never merge or rebase unverified upstream changes directly into a release branch.

## Acceptance environment

The user approved real-machine-only acceptance. Windows Sandbox is no longer required and the unified progress entry in `docs/fork/README.md` must not claim that testing occurred on a clean Windows image.

All checks run on the current LoL-enabled Windows x64 host in two modes:

### Isolated packaged smoke

- Launch the portable package with a new temporary userData directory rather than the developer or official Akari profile.
- Validate packaged paths, bundled worker availability and hashes, default-disabled behavior, synthetic anonymous worker contract, exit and absence of orphan workers.
- Synthetic inputs are generated during the test and are not copied from `raw_data` or `analysis_output`.
- After scanning and evidence capture, clean up only the disposable package/userData created by this check; never remove existing user profiles or packages.

### Live LCU/SGP integration

- Use CCB's own userData and an explicitly configured member list; never read or migrate official League Akari userData.
- Validate real Riot ID resolution and LCU/SGP collection on the same machine.
- Confirm credentials stay in Electron main, Python receives no token, cancellation/failure preserves current data, and actual player data exists only under CCB userData.
- Never copy resulting player data into fixtures, Git, packages or reports.

This policy provides package and real-client evidence but intentionally does not make a clean-OS compatibility, SmartScreen or antivirus claim. A future public signed release should restore clean-image testing.
