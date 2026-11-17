---
name: esj-downloader-dev
description: Develop, review, document, validate, or release ESJ Novel Downloader in this repository.
---

# ESJ Project Workflow

## Establish scope

Inspect the request, branch/commit, `git status --short`, scoped diff, and relevant source/tests. Preserve unrelated edits. When current upstream source is requested, fetch and compare exact commits before assessing or integrating it.

Before editing or reviewing source, tests, UI text, or template prompts, read [代码与注释](../../../CONTRIBUTING.md#代码与注释). Use the following guides as the rule owners; keep implementation details in source.

| Task                         | Read and apply                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation or review     | [Architecture](../../../docs/architecture.md) for ownership, call chains, and affected business contracts; inspect the actual callers and exit paths |
| Verification or test changes | [Testing](../../../docs/testing.md) for existing evidence, fault injection, stress coverage, and real-page acceptance                                |
| Documentation                | Check the described behavior against source; update both READMEs for user-visible changes                                                            |
| Commit or contribution       | [Contributing](../../../CONTRIBUTING.md) for branch, commit-message, PR, and publication conventions                                                 |
| Release                      | Apply the release steps below and the relevant testing guide scenarios                                                                               |

## Preserve boundaries

- Preserve task ownership, atomic cache claims/writes, cancellation saving and discard upgrades, stale-result isolation, and persisted-data migration contracts in the architecture guide. State compatibility or invalidation before changing persisted formats or behavior.
- Current in-memory selections and export snapshots use their canonical types and original task identity. Legacy compatibility belongs at persisted-data read boundaries.
- Reuse existing verification for affected behavior. Add automation only for an uncovered, reproducible data or asynchronous boundary; ordinary page behavior uses real ESJZone/browser/userscript-manager checks. Report unavailable acceptance separately.
- Commit, push, version changes, tags, releases, and committing `dist/` have separate authorization scopes. Continue operations already authorized; builds may regenerate ignored `dist/`.

## Release tasks

1. Establish the exact candidate, clean worktree, package/lockfile version, and relevant remote state. Read `.github/workflows/release.yml`, `script-meta.js`, and `rollup.config.js` to verify tag policy and artifact provenance. A future tag need not exist during assessment.
2. Run `npm run build` and `npm run test:stress`, plus applicable real-page, migration, and exported-file checks from the testing guide. Chrome + Tampermonkey is the active release combination. Record only verified combinations.
3. Report readiness with evidence and unresolved gates. Missing applicable acceptance remains a blocker; assessment does not authorize implementation or publication.
4. For authorized publication, inspect existing runs/releases before retrying. Pushing a `v*` tag triggers release creation. After publication, verify tag SHA/ancestry, workflow outcome, prerelease status, and uploaded userscript header/content against the candidate. Report installation or upgrade checks separately.

## Skill maintenance and delivery

Keep architecture and test rules in their guides; update this routing only when it changes how a task should proceed. Preserve the skill name, implicit-discovery policy, and consistent `agents/openai.yaml` metadata.

After skill edits, validate frontmatter and affected links/metadata, and run `npm exec -- prettier --check .codex/skills/esj-downloader-dev/SKILL.md .codex/skills/esj-downloader-dev/agents/openai.yaml` explicitly because the package formatting glob excludes skills. Exercise the task branches whose instructions changed; wording-only edits need text and link checks.

Review the scoped diff and `git diff --check`. Report the result, checks actually run, unverified scope, and commit/publication state. Keep run-specific evidence in the task or PR.
