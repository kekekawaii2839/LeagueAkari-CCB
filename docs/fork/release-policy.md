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
- First public stable version: `0.2.0`.
- CCB feature releases increment the SemVer minor component.
- Fix/security releases increment the patch component.
- Every release entry in `docs/fork/README.md` records the exact official upstream SHA separately; the official product version is never reused as the CCB version. Do not create a separate Markdown release report.

## Current distribution and update policy

- Version `0.2.0` is an explicitly user-approved unsigned public release. Windows SmartScreen may
  warn users; the package and release notes must not claim a code signature.
- Automatic update is enabled for packaged Windows x64 CCB builds beginning with `0.2.0`.
- The only CCB source and manual release page is
  `https://github.com/kekekawaii2839/LeagueAkari-CCB`; never download a CCB update from the official
  League Akari repository or API.
- The update loader accepts only stable releases from that repository whose tag and exact CCB
  archive name agree. Every release includes a SHA-256 sidecar; the downloaded archive is rejected
  and deleted before execution when verification fails.
- Official League Akari packages remain rejected. The portable CCB build does not invoke the
  updater's uninstall path because it does not own official Akari protocol registrations.
- Updates replace the complete portable application directory after CCB exits; CCB userData remains
  outside that directory.
- Replacing the application directory must not remove CCB userData.
- Upstream Akari currently places general Windows logs beside the executable. CCB must sanitize every logger payload before transport; player identifiers and credential values are forbidden even in local/internal logs.

## Remaining signed-update hardening

The user explicitly accepted an unsigned first public channel. SHA-256 detects corruption but the
sidecar is hosted with the archive and is not an independent authenticity signature. The following
remain required before describing the channel as signed or rollback-safe:

1. A real Windows code-signing certificate and protected signing workflow.
2. Signed manifest or equivalent authenticity verification independent of transport TLS.
3. Previous complete version retention, atomic switch and verified rollback after download, hash,
   signature, startup or migration failure.
4. Clean Windows upgrade, downgrade-readonly and rollback tests.

## Upstream maintenance policy

- The current exact official baseline is maintained in `patch-manifest.json`.
- Remote model: official `Hanxven/LeagueAkari` as `upstream`; CCB repository
  `kekekawaii2839/LeagueAkari-CCB` as `origin`.
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
