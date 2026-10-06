---
name: esj-downloader-dev
description: Implement, refactor, or diagnose ESJ Novel Downloader TypeScript userscript changes while preserving its scraper/UI, download-core, browser-adapter, cache, export, and localization boundaries. Use for feature work, bug fixes, refactors, or code review in this repository, especially changes involving downloads, cancellation, IndexedDB cache migration, browser APIs, exports, mapping fonts, localization, or page UI.
---

# ESJ Downloader Development

## Route the request

1. Read `references/architecture.md` before changing a download, cache, adapter, or export path. Otherwise, inspect only the named module and its nearest tests.
2. Identify the boundary before editing: book workflow (`app/book-download.ts`), single-page workflow (`scrapers/single.ts`), page injection (`ui/pages/`), dialogs (`ui/dialogs/`), presentation messages (`ui/messages/`), download business rules (`download/`), format generation and snapshots (`export/`), other core logic (`core/`), task wiring (`app/book-download.ts`) and download view (`ui/download-view.ts`), page session (`app/page-session.ts`), cache management (`app/cache-management.ts`), or persistence (`storage/`).
3. Keep core download code free of DOM, GM API, and browser-global access. Extend `download/contracts.ts` and assemble browser behavior in `app/book-download.ts` when a new dependency is needed.
4. Preserve unified finalization across success, failure, and cancellation. Treat lock ownership, cache writers, listeners, timers, and channels as one lifecycle.
5. Use `$esj-regression-selector` after selecting the change surface; follow its review or implementation path according to the requested scope.

## Keep changes reviewable

- Make the smallest focused edit; do not combine unrelated formatting, dependency, or version changes.
- Follow `docs/testing.md` when selecting evidence. Ordinary userscript page behavior is verified on real pages with a browser and userscript manager. Reuse existing automated boundaries; add a test only for a concrete uncovered data, asynchronous, protocol, or resource boundary that synthetic inputs can reliably reproduce.
- Use `ui/dialogs/common.ts` and the existing dialog modules for user prompts; do not introduce `alert`.
- Keep protected-chapter authorization in the browser adapter and expose only structured unlock results to the core. Passwords, tokens, cookies, authorization headers, and full response bodies must not enter cache, diagnostics, or logs; rejected passwords must not become ordinary retries, permanent failures, or chapter cache entries.
- Snapshot task settings before cache claim and download startup so cross-page setting changes affect only future tasks.
- During bulk cache recovery, aggregate diagnostics in memory instead of persisting one diagnostic update per restored chapter.
- Keep localization in the presentation boundary: core code emits stable codes, parameters, or locale-neutral details; UI and browser adapters translate them. Never translate novel content, book metadata, source URLs, exported novel data, or ESJZone `status === 206` protocol text. Localize `zh-TW` manually with Taiwanese software terminology.
- Production comments use Chinese and explain business invariants, lifecycle ownership, or race ordering. Use caller-focused JSDoc without a final period only where exported APIs need a contract; keep implementation details in adjacent `//` comments and do not mix ordinary block comments with JSDoc.
- Use fixtures, fakes, fake clocks, and userscript mocks. Do not access ESJZone, live network services, or production IndexedDB in automated tests.
- Version changes, tag creation/push, GitHub Releases, and committing `dist/` require explicit authorization for that operation. Required local builds may regenerate ignored `dist/` artifacts within the authorized implementation or validation scope.

## Escalate risk deliberately

Read the architecture reference and state the expected migration/compatibility behavior before changing cache schema or keys. For changes to scheduling, retries, cancellation, incremental writes, task locks, or cross-page sync, also require the stress suite through `$esj-regression-selector`.
