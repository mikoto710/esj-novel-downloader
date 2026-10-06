# Project Boundaries

For download entry, cache, cancellation, protected chapters, or export changes, read the repository's [docs/architecture.md](../../../../docs/architecture.md). It is the maintained source for call paths, state ownership, browser seams, and representative tests.

- `app/book-download.ts` owns selection, atomic cache confirmation, book-lock acquisition, and finalization.
- `app/book-download.ts` locally binds task chapters, cancellation, and lock; `ui/download-view.ts` binds the original identity, stop action, title, DOM, tray, and locale subscription; `download/run.ts` returns explicit ready/cancelled results.
- `download/` business modules and `export/snapshot.ts` receive focused inputs and capabilities. ESLint enforces direct environment boundaries; `app/book-download.ts` owns browser finalization, and `storage/cache/` implements persistence. Lock, presence, heartbeat and remote cancellation belong to `storage/book-lock.ts`; concrete preferences and history belong to `storage/settings.ts` and `storage/history.ts`.
- `app/page-session.ts` owns the current operation handle, display summaries, retained export and read-only notification ownership rechecks. `app/cache-management.ts` combines cache sources and coordinates user clearing; storage supplies facts and protected operations. `app/export.ts` owns EPUB invalidation, generation/reuse, file triggering, and original-result history/diagnostics.
- `ui/dialogs/format-choice.ts` receives the original result and owns controls, confirmation display, locale subscriptions and title guards. `app/single-download.ts` owns current-page collection/export without book locks or result publication; it shares explicit format capabilities with `app/export.ts`. Failed or cancelled new work preserves the previous result.

- `export/` owns the source `ExportSnapshot` type, placeholders, TXT/HTML/EPUB generation, filenames and shared escaping. `html.ts` has explicit book/range and current-page entries sharing image/font implementations; retain their different resource order. `download/run.ts` owns cover-cache preparation and before-ready writer completion. Generators never read page state, collect novel content or claim cache. Application-owned `CachedData` extends that same object with optional derived EPUB fields; book file URLs revoke after 60 seconds and history is detached, while single URLs revoke immediately after click/remove and history is awaited.

- `diagnostics/manager.ts` owns neutral records, redaction, retention and terminal dominance; `storage/diagnostics.ts` isolates GM failures. `diagnostics/runtime.ts` binds task identity, startup settings/environment and page-close observers. Diagnostic JSON and filenames use `diagnostics/export.ts`; callers supply call-time presentation from `ui/messages/diagnostics.ts`. Log text lives in `ui/messages/download-log.ts`, batched visual output in `ui/log-view.ts`. The dialog uses these operations and `browser/files.ts` directly.

## Review invariants

- Full and range tasks share one book lock and absolute-index cache. Full success clears cache; range success seals and closes its writer while retaining accumulated chapters.
- `DownloadProgress` owns phase checks and scope progress; `readyChapterCount` is selected readiness and `bookChapterCount` is whole-book inventory. UI and diagnostics project authoritative state.
- Page state holds only the active operation handle, display summary, and latest export. Cleanup of one task must not clear its live Map or the previous export; stale callbacks remain bound to their taskId. Legacy sync events require read-only writer/lock checks.
- Preview is read-only. Cache claim checks compatibility and invalidation consent in the same write transaction.
- Normal cancellation has a bounded flush; discard can upgrade cancellation. Network abort must not prevent the permitted final cache write.
- Diagnostic callbacks keep their original task identity; retained exports pass source IDs and skip recording when identity is missing. Keep page-close listeners under task finalization, persist neutral codes, and preserve GM failure isolation and record budgets.
- Protected-chapter passwords stay in task memory. Export placeholders stay out of chapter/cache data.
- `locale/catalog.ts` and `locale/locales/` own pure locale selection, types, keys, catalogs and interpolation; `site/locale.ts` reads conversion hints. `ui/locale.ts` reads the stored preference at call time, owns subscriptions and DOM refresh, and composes preference → site → browser fallback. Storage remains independent of UI state. Novel content, metadata, URLs, and ESJZone `status === 206` protocol text remain unchanged.

Select automated boundaries and real userscript page validation with `esj-regression-selector` and [docs/testing.md](../../../../docs/testing.md). Synthetic fixtures and isolated storage prove only the boundary they exercise. Keep method JSDoc to a short Chinese sentence on three lines, with brief `//` comments for non-obvious ordering.
