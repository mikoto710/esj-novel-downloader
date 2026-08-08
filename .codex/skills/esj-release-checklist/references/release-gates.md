# Release Gates

## Always collect

| Gate                        | Evidence                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Intended version and branch | `package.json`, current branch, and target-release policy                                            |
| Candidate state             | clean working tree, exact candidate commit, and remote branch synchronization                        |
| Repository blockers         | open Issue and PR state relevant to the release                                                      |
| Source quality              | `npm run build` from the release candidate source                                                    |
| Scope                       | focused diff and user-visible change summary                                                         |
| Documentation               | Simplified and Traditional Chinese README parity; contributor, test, and Skill command consistency   |
| Regression selection        | `$esj-regression-selector` command record                                                            |
| Artifact provenance         | confirm the userscript was built from the checked source                                             |
| Tag policy                  | tag exactly matches `package.json`; prerelease commit is contained in `dev`, stable commit in `main` |
| Published release           | verify prerelease status, uploaded asset version, and userscript installation or upgrade             |

## Apply when relevant

| Change area                                           | Additional evidence                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Cache/key/schema migration                            | legacy read/migration path, compatibility or invalidation behavior, storage-failure recovery |
| Download state, locks, writes, retry, or cancellation | affected lifecycle tests and `npm run test:stress`                                           |
| Download history                                      | cache/history isolation tests and clearing behavior                                          |
| Export or images                                      | full-book and single-chapter output isolation; TXT/HTML/EPUB behavior as applicable          |
| Mapping fonts                                         | strict detection, cache normalization, and exported-font binding                             |
| Browser-facing behavior                               | manual verification with named browser and userscript manager                                |
| Interface localization                                | catalog symmetry, locale-neutral data, and Chrome + Tampermonkey runtime switching           |

## Decision wording

- Ready: all applicable gates have passing evidence; list any accepted non-blocking risk.
- Not ready: identify the failed or unverified gate and the exact action needed.
- Never infer release readiness from a tag, a green focused test, or an existing `dist/` artifact alone.
