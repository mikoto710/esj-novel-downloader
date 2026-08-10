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

- `batch-download.ts` composes browser dependencies and starts book downloads; an optional selection narrows work while preserving absolute chapter indexes.
- `coordinator.ts` owns state transitions, cache recovery, chapter scheduling, integrity checks, cancellation, and export preparation.
- `contracts.ts` exposes the core ports and process data. Browser implementations belong in `adapters/`.
- `integrity.ts` classifies missing chapters and image retry conditions. `incomplete-chapters.ts` creates export-only placeholders after an explicit user decision; callers must not write those placeholders back to the chapter map or persistent cache.
- `core/cache/` owns v3 incremental cache, legacy-cache lazy migration, listing, and cross-page synchronization.
- `ui/download-terminal-notices.ts` translates structured download, cancellation, and cache-discard failures into the common message popup after lifecycle cleanup; core code must not render DOM directly.

## Localization boundary

- `core/locales/` owns interface catalogs, while UI and browser adapters own translated presentation.
- Core download and persistence code emits stable codes, parameters, or locale-neutral details; it must not read the current locale.
- Never translate novel content, book metadata, source URLs, exported novel data, or the ESJZone `status === 206` protocol text.
- Keep Simplified Chinese terminology consistent with existing public labels. Localize Traditional Chinese manually with Taiwanese software terms such as `下載執行緒數`, `快取`, `紀錄`, and `匯出`.

## High-risk invariants

- Do not let `core/download/` access DOM, GM APIs, or browser globals.
- Finish success, failure, and cancellation through the shared finalization path.
- Keep the task lock, cache writer, and cancellation mode consistent.
- Full and range downloads of the same book share one book-level lock and one v3 cache. Full success clears its writer; range success seals pending writes and closes its writer with `finishForTask()` while retaining the whole-book cache.
- Treat range progress, integrity, password prompts, and export as selected-task views. Keep `CacheMeta.totalChapters` and runtime cache counts at whole-book scope, and never let outside-range chapters enter the current export.
- Keep download cache distinct from download history.
- Keep persisted diagnostic and history records locale-neutral when they are rendered in the current interface language.
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
| Interface localization                  | `src/core/locales/`, `src/ui/locale.ts`                                      | `tests/ui/`                                     |
