---
name: esj-downloader-dev
description: Develop, review, document, validate, or release ESJ Novel Downloader in this repository.
---

# ESJ Project Workflow

Check the requested scope, branch, worktree, and relevant callers and exit paths. Preserve unrelated edits. Compare exact fetched commits when asked for current upstream source.

Read [代码与注释](../../../CONTRIBUTING.md#代码与注释) before source, test, UI text, or template work. Use [Architecture](../../../docs/architecture.md) for data ownership, cancellation, and compatibility, [Testing](../../../docs/testing.md) for verification and real-page acceptance, and [Contributing](../../../CONTRIBUTING.md) for documentation, commits, and publication. When persisted data changes, state compatibility or invalidation.

Commit, push, version, tag, release, and committing `dist/` each need authorization. Continue operations already authorized.

## Release tasks

1. Establish the exact candidate, clean worktree, package/lockfile version, and relevant remote state. Read `.github/workflows/release.yml`, `script-meta.js`, and `rollup.config.js` to verify tag policy and artifact provenance. A future tag need not exist during assessment.
2. Run `npm run build` and `npm run test:stress`, plus applicable real-page, migration, and exported-file checks from the testing guide. Chrome + Tampermonkey is the active release combination. Record only verified combinations.
3. Report readiness with evidence and unresolved gates. Missing applicable acceptance remains a blocker; assessment does not authorize implementation or publication.
4. For authorized publication, inspect existing runs/releases before retrying. Pushing a `v*` tag triggers release creation. After publication, verify tag SHA/ancestry, workflow outcome, prerelease status, and uploaded userscript header/content against the candidate. Report installation or upgrade checks separately.

## Skill maintenance and delivery

Keep architecture and test rules in their guides; update this routing only when it changes how a task should proceed. Preserve the skill name, implicit-discovery policy, and consistent `agents/openai.yaml` metadata.

After skill edits, validate frontmatter and affected links/metadata, and run `npm exec -- prettier --check .codex/skills/esj-downloader-dev/SKILL.md .codex/skills/esj-downloader-dev/agents/openai.yaml` explicitly because the package formatting glob excludes skills. Exercise the task branches whose instructions changed; wording-only edits need text and link checks.

Review the scoped diff and `git diff --check`. Report the result, checks actually run, unverified scope, and commit/publication state. Keep run-specific evidence in the task or PR.
