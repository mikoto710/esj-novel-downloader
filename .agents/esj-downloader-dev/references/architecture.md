# Project Boundaries

## Dependency direction

```text
scrapers / ui
  -> core/download/batch-download.ts
  -> core/download/coordinator.ts
  -> contracts.ts
  -> adapters/browser-download-dependencies.ts
  -> cache, lock, state, UI, GM API, DOM
```

- `batch-download.ts` composes browser dependencies and starts full-book downloads.
- `coordinator.ts` owns state transitions, cache recovery, chapter scheduling, integrity checks, cancellation, and export preparation.
- `contracts.ts` exposes the core ports and process data. Browser implementations belong in `adapters/`.
- `integrity.ts` classifies missing chapters and image retry conditions. `incomplete-chapters.ts` creates export-only placeholders after an explicit user decision; callers must not write those placeholders back to the chapter map or persistent cache.
- `core/cache/` owns v3 incremental cache, legacy-cache lazy migration, listing, and cross-page synchronization.

## High-risk invariants

- Do not let `core/download/` access DOM, GM APIs, or browser globals.
- Finish success, failure, and cancellation through the shared finalization path.
- Keep the task lock, cache writer, and cancellation mode consistent.
- Keep download cache distinct from download history.
- Define migration, backward-compatibility, or explicit invalidation for cache/config format changes.

## Useful module locations

| Concern                                 | Production code                                                              | Tests                                           |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Scheduling and lifecycle                | `src/core/download/`                                                         | `tests/download/`                               |
| Integrity and incomplete-chapter export | `src/core/download/integrity.ts`, `src/core/download/incomplete-chapters.ts` | `tests/download/`, `tests/export/`, `tests/ui/` |
| Cache, locks, cross-page state          | `src/core/cache/`, `src/core/book-lock.ts`                                   | `tests/cache/`                                  |
| Browser wiring                          | `src/adapters/`                                                              | browser contract tests                          |
| Export and images                       | `src/core/epub.ts`, `src/core/html.ts`                                       | `tests/export/`                                 |
| Mapping fonts                           | `src/core/mapping-font.ts`                                                   | `tests/mapping-font/`                           |
| Page behavior                           | `src/ui/`, `src/scrapers/`                                                   | `tests/ui/`                                     |
