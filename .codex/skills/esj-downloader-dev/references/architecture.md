# Project Boundaries

For download entry, cache, cancellation, protected chapters, or export changes, read the repository's [docs/architecture.md](../../../../docs/architecture.md). It is the maintained source for call paths, state ownership, browser seams, and representative tests.

- `app/book-download.ts` owns selection, atomic cache confirmation, book-lock acquisition, and finalization.
- `app/book-download.ts` locally binds task chapters, cancellation, and lock; `ui/download-view.ts` binds the original identity, stop action, title, DOM, tray, and locale subscription; `download/run.ts` returns explicit ready/cancelled results.
- `download/` business modules (plus the existing snapshot implementation in `core/download/`) receive focused inputs and capabilities. ESLint enforces direct environment boundaries; `app/book-download.ts` owns browser finalization, and `storage/cache/` implements persistence. Lock, presence, heartbeat and remote cancellation belong to `storage/book-lock.ts`; concrete preferences and history belong to `storage/settings.ts` and `storage/history.ts`.
- `app/page-session.ts` owns the current operation handle, display summaries, retained export and read-only notification ownership rechecks. `app/cache-management.ts` combines cache sources and coordinates user clearing; storage supplies facts and protected operations. The actual EPUB invalidation implementation remains in `core/state.ts` until export ownership moves.
- `ui/dialogs/format-choice.ts` receives the export snapshot explicitly. Failed or cancelled new work preserves the previous result.

## Review invariants

- Full and range tasks share one book lock and absolute-index cache. Full success clears cache; range success seals and closes its writer while retaining accumulated chapters.
- `DownloadProgress` owns phase checks and scope progress; `readyChapterCount` is selected readiness and `bookChapterCount` is whole-book inventory. UI and diagnostics project authoritative state.
- Page state holds only the active operation handle, display summary, and latest export. Cleanup of one task must not clear its live Map or the previous export; stale callbacks remain bound to their taskId. Legacy sync events require read-only writer/lock checks.
- Preview is read-only. Cache claim checks compatibility and invalidation consent in the same write transaction.
- Normal cancellation has a bounded flush; discard can upgrade cancellation. Network abort must not prevent the permitted final cache write.
- Protected-chapter passwords stay in task memory. Export placeholders stay out of chapter/cache data.
- Core emits stable message codes. UI and adapters localize interface text; novel content, metadata, URLs, and ESJZone `status === 206` protocol text remain unchanged.

Select automated boundaries and real userscript page validation with `esj-regression-selector` and [docs/testing.md](../../../../docs/testing.md). Synthetic fixtures and isolated storage prove only the boundary they exercise. Keep method JSDoc to a short Chinese sentence on three lines, with brief `//` comments for non-obvious ordering.
