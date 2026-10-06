---
name: esj-downloader-dev
description: Implement, refactor, or diagnose ESJ Novel Downloader TypeScript userscript changes while preserving its site, app, download, storage, export, diagnostics, locale, browser, and UI ownership. Use for feature work, bug fixes, refactors, or code review in this repository, especially changes involving downloads, cancellation, IndexedDB cache migration, browser APIs, exports, mapping fonts, localization, or page UI.
---

# ESJ Downloader Development

## Route the request

1. Read `references/architecture.md` before changing a download, cache, site, browser, or export path. Otherwise, inspect only the named module and its nearest tests.
2. Identify the boundary before editing: book workflow (`app/book-download.ts`), single-page workflow (`app/single-download.ts`), page injection (`ui/pages/`), dialogs (`ui/dialogs/`), presentation messages (`ui/messages/`), download business rules (`download/`), format generation and snapshots (`export/`), export workflow (`app/export.ts`), task wiring (`app/book-download.ts`) and download view (`ui/download-view.ts`), page session (`app/page-session.ts`), cache management (`app/cache-management.ts`), persistence (`storage/`), diagnostic rules (`diagnostics/manager.ts`), task/environment integration (`diagnostics/runtime.ts`), diagnostic JSON (`diagnostics/export.ts`), log rendering (`ui/log-view.ts`), pure locale/catalog rules (`locale/catalog.ts` and `locale/locales/`), site conversion hints (`site/locale.ts`), active language/DOM/subscriptions (`ui/locale.ts`), view nodes/dragging/cleanup (`ui/dom.ts`), or neutral message data (`messages.ts`).
3. Keep core download code free of DOM, GM API, and browser-global access. Extend `download/contracts.ts` and assemble browser behavior in `app/book-download.ts` when a new dependency is needed.
4. Preserve unified finalization across success, failure, and cancellation. Treat lock ownership, cache writers, listeners, timers, and channels as one lifecycle.
5. Use `$esj-regression-selector` after selecting the change surface; follow its review or implementation path according to the requested scope.

Keep types with their owning rule: content/source in `content/model.ts`, cancellation in `download/contracts.ts`, snapshot summaries in `export/snapshot.ts`, formats in `export/filename.ts`, public cache models in `storage/cache/model.ts`, and internal schemas in persistence implementations. Follow `docs/architecture.md` for file-level runtime versus type dependency review.

## Keep changes reviewable

- Make the smallest focused edit; do not combine unrelated formatting, dependency, or version changes.
- Follow `docs/testing.md` when selecting evidence. Ordinary userscript page behavior is verified on real pages with a browser and userscript manager. Reuse existing automated boundaries; add a test only for a concrete uncovered data, asynchronous, protocol, or resource boundary that synthetic inputs can reliably reproduce.
- Use `ui/dialogs/common.ts` and the existing dialog modules for user prompts; do not introduce `alert`.
- Keep protected-chapter authorization in `site/protected-chapter.ts` and expose only structured unlock results to the core. Passwords, tokens, cookies, authorization headers, and full response bodies must not enter cache, diagnostics, or logs; rejected passwords must not become ordinary retries, permanent failures, or chapter cache entries.
- Preserve setting timing: fix image settings before cache preview, read concurrency at task assembly, and fix EPUB settings when generating the original result.
- During bulk cache recovery, aggregate diagnostics in memory instead of persisting one diagnostic update per restored chapter.
- Keep localization in the presentation boundary: business code emits stable codes, parameters, or locale-neutral details; `ui/locale.ts` and `ui/messages/` present them using the pure catalog. Read/save preferences through `storage/settings.ts`; site conversion detection only supplies hints and never converts content. Never translate novel content, book metadata, source URLs, exported novel data, or ESJZone `status === 206` protocol text. Localize `zh-TW` manually with Taiwanese software terminology.
- Production comments use Chinese and explain business invariants, lifecycle ownership, or race ordering. Use caller-focused JSDoc without a final period only where exported APIs need a contract; keep implementation details in adjacent `//` comments and do not mix ordinary block comments with JSDoc.
- Use fixtures, fakes, fake clocks, and userscript mocks. Do not access ESJZone, live network services, or production IndexedDB in automated tests.
- Version changes, tag creation/push, GitHub Releases, and committing `dist/` require explicit authorization for that operation. Required local builds may regenerate ignored `dist/` artifacts within the authorized implementation or validation scope.

## Escalate risk deliberately

Read the architecture reference and state the expected migration/compatibility behavior before changing cache schema or keys. For changes to scheduling, retries, cancellation, incremental writes, task locks, or cross-page sync, also require the stress suite through `$esj-regression-selector`.
