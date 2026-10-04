# Project Boundaries

For download entry, cache, cancellation, protected chapters, or export changes, read the repository's [docs/architecture.md](../../../../docs/architecture.md). It is the maintained source for call paths, state ownership, browser seams, and representative tests.

- `scrapers/book-download.ts` owns selection, atomic cache confirmation, book-lock acquisition, and finalization.
- `adapters/browser-download-dependencies.ts` receives explicit task chapters, cancellation, lock, and title to assemble browser capabilities; `core/download/coordinator.ts` returns explicit ready/cancelled results.
- `core/download/` business modules receive focused inputs and capabilities. ESLint enforces direct environment boundaries; `adapters/book-download-lifecycle.ts` owns browser finalization, and `core/cache/` implements persistence.
- `ui/dialogs/format-choice.ts` receives the export snapshot explicitly. Failed or cancelled new work preserves the previous result.

## Review invariants

- Full and range tasks share one book lock and absolute-index cache. Full success clears cache; range success seals and closes its writer while retaining accumulated chapters.
- `DownloadProgress` owns phase checks and scope progress; `readyChapterCount` is selected readiness and `bookChapterCount` is whole-book inventory. UI and diagnostics project authoritative state.
- Page state holds only the active operation handle, display summary, and latest export. Cleanup of one task must not clear its live Map or the previous export; stale callbacks remain bound to their taskId. Legacy sync events require read-only writer/lock checks.
- Preview is read-only. Cache claim checks compatibility and invalidation consent in the same write transaction.
- Normal cancellation has a bounded flush; discard can upgrade cancellation. Network abort must not prevent the permitted final cache write.
- Protected-chapter passwords stay in task memory. Export placeholders stay out of chapter/cache data.
- Core emits stable message codes. UI and adapters localize interface text; novel content, metadata, URLs, and ESJZone `status === 206` protocol text remain unchanged.

Select focused checks with `esj-regression-selector`; tests use fixtures and isolated storage. Keep method JSDoc to a short Chinese sentence on three lines, with brief `//` comments for non-obvious ordering.
