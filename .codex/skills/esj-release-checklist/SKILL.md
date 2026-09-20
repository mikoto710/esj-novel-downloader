---
name: esj-release-checklist
description: Assess ESJ Novel Downloader release readiness or verify a published release. Use for release gate assessments, candidate version/tag validation, or post-release verification; exclude wording-only release-note edits. Publishing requires explicit authorization.
---

# ESJ Release Checklist

## Assess; do not publish

1. Read `references/release-gates.md` and inspect the current branch, version, tags, and release workflow before making any release claim.
2. Compare the intended change set with the gates that apply to the requested pre-release assessment or post-release verification. Use `$esj-regression-selector` within the authorized review or validation scope.
3. For changed user-visible behavior, check the affected sections of both READMEs. For changed development, test, or release commands, check the affected sections of `CONTRIBUTING.md`, `tests/README.md`, and the governing Skills.
4. Produce an evidence table: gate, evidence/command, result, and unresolved risk.
5. Mark the release ready to publish only when required pre-release checks pass and every relevant manual or migration check is evidenced. Otherwise report the precise blocker. Apply post-release gates after publication.

## Preserve release authority

- Do not edit package versions, create or push tags, create GitHub Releases, or commit `dist/` unless the user explicitly authorizes that operation.
- Treat `dev` as the source of alpha/beta/rc releases and `main` as the source of stable releases.
- Build the userscript from checked source; do not use a stale artifact as release evidence.
- Record the browser combinations actually validated. Use Chrome + Tampermonkey as the active manual release gate; do not claim Firefox + Violentmonkey coverage unless it was explicitly required and verified.

## Focus the regression discussion

For a cache/history, migration, downloader, or export change, explicitly address cache migration, cache/history separation, cancellation/recovery, and full-book versus single-chapter export. For browser-facing changes, record the browser and userscript-manager manual verification or call it out as outstanding.
