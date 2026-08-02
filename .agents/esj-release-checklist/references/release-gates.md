# Release Gates

## Always collect

| Gate | Evidence |
| --- | --- |
| Intended version and branch | `package.json`, current branch, and target-release policy |
| Source quality | `npm run build` from the release candidate source |
| Scope | focused diff and user-visible change summary |
| Regression selection | `$esj-regression-selector` command record |
| Artifact provenance | confirm the userscript was built from the checked source |

## Apply when relevant

| Change area | Additional evidence |
| --- | --- |
| Cache/key/schema migration | legacy read/migration path, compatibility or invalidation behavior, storage-failure recovery |
| Download state, locks, writes, retry, or cancellation | affected lifecycle tests and `npm run test:stress` |
| Download history | cache/history isolation tests and clearing behavior |
| Export or images | full-book and single-chapter output isolation; TXT/HTML/EPUB behavior as applicable |
| Mapping fonts | strict detection, cache normalization, and exported-font binding |
| Browser-facing behavior | manual verification with named browser and userscript manager |

## Decision wording

- Ready: all applicable gates have passing evidence; list any accepted non-blocking risk.
- Not ready: identify the failed or unverified gate and the exact action needed.
- Never infer release readiness from a tag, a green focused test, or an existing `dist/` artifact alone.