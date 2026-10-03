# Project Boundaries

For download entry, cache, cancellation, protected chapters, or export changes, read the repository's [ARCHITECTURE.md](../../../../ARCHITECTURE.md). It is the maintained source for call paths, state ownership, browser seams, and representative tests.

- `scrapers/book-download.ts` owns selection, atomic cache confirmation, book-lock acquisition, and finalization.
- `adapters/batch-download.ts` assembles browser capabilities; `core/download/coordinator.ts` returns explicit ready/cancelled results.
- `core/download/` business modules receive focused inputs and capabilities. ESLint enforces direct environment boundaries; `task-finalizer.ts` is browser lifecycle assembly, and `core/cache/` implements persistence.
- `ui/dialogs/format-choice.ts` receives the export snapshot explicitly. Failed or cancelled new work preserves the previous result.

## Review invariants

- Full and range tasks share one book lock and absolute-index cache. Full success clears cache; range success seals and closes its writer while retaining accumulated chapters.
- Selection progress, whole-book inventory, and export readiness have different meanings. UI and diagnostics project authoritative state.
- Preview is read-only. Cache claim checks compatibility and invalidation consent in the same write transaction.
- Normal cancellation has a bounded flush; discard can upgrade cancellation. Network abort must not prevent the permitted final cache write.
- Protected-chapter passwords stay in task memory. Export placeholders stay out of chapter/cache data.
- Core emits stable message codes. UI and adapters localize interface text; novel content, metadata, URLs, and ESJZone `status === 206` protocol text remain unchanged.

Select focused checks with `esj-regression-selector`; tests use fixtures and isolated storage. Keep method JSDoc to a short Chinese sentence on three lines, with brief `//` comments for non-obvious ordering.
