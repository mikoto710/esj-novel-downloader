---
name: esj-release-checklist
description: Assess ESJ Novel Downloader beta, release-candidate, or stable-release readiness with evidence, targeted regression checks, and explicit residual risk. Use when preparing release notes, reviewing a release branch or tag, validating a version bump, or deciding whether a build is ready to publish; do not use it to publish without explicit authorization.
---

# ESJ Release Checklist

## Assess; do not publish

1. Read `references/release-gates.md` and inspect the current branch, version, tags, and release workflow before making any release claim.
2. Compare the intended change set with the gates that apply to it. Use `$esj-regression-selector` to select and execute the regression matrix.
3. Produce an evidence table: gate, evidence/command, result, and unresolved risk.
4. Mark the release ready only when required checks pass and every relevant manual or migration check is evidenced. Otherwise report the precise blocker.

## Preserve release authority

- Do not edit package versions, create or push tags, create GitHub Releases, or commit `dist/` unless the user explicitly authorizes that operation.
- Treat `dev` as the source of alpha/beta/rc releases and `main` as the source of stable releases.
- Build the userscript from checked source; do not use a stale artifact as release evidence.

## Focus the regression discussion

For a cache/history, migration, downloader, or export change, explicitly address cache migration, cache/history separation, cancellation/recovery, and full-book versus single-chapter export. For browser-facing changes, record the browser and userscript-manager manual verification or call it out as outstanding.