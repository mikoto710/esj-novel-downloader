---
name: esj-downloader-dev
description: Implement, refactor, or diagnose ESJ Novel Downloader TypeScript userscript changes while preserving its scraper/UI, download-core, browser-adapter, cache, export, and localization boundaries. Use for feature work, bug fixes, refactors, or code review in this repository, especially changes involving downloads, cancellation, IndexedDB cache migration, browser APIs, exports, mapping fonts, localization, or page UI.
---

# ESJ Downloader Development

## Route the request

1. Read `references/architecture.md` before changing a download, cache, adapter, or export path. Otherwise, inspect only the named module and its nearest tests.
2. Identify the boundary before editing: page integration (`scrapers/` or `ui/`), pure core logic (`core/`), browser assembly (`adapters/`), or persistence (`core/cache/`).
3. Keep core download code free of DOM, GM API, and browser-global access. Extend `core/download/contracts.ts` and assemble browser behavior in `adapters/browser-download-dependencies.ts` when a new dependency is needed.
4. Preserve unified finalization across success, failure, and cancellation. Treat lock ownership, cache writers, listeners, timers, and channels as one lifecycle.
5. Use `$esj-regression-selector` after selecting the change surface; run its required checks before reporting completion.

## Keep changes reviewable

- Make the smallest focused edit; do not combine unrelated formatting, dependency, or version changes.
- Add a regression test for a defect. Use contract tests for stable cross-boundary behavior and characterization tests before refactoring established complex behavior.
- Use the existing shared popup components for user prompts; do not introduce `alert`.
- Keep protected-chapter authorization in the browser adapter and expose only structured unlock results to the core. Passwords, tokens, cookies, authorization headers, and full response bodies must not enter cache, diagnostics, or logs; rejected passwords must not become ordinary retries, permanent failures, or chapter cache entries.
- Snapshot task settings before cache claim and download startup so cross-page setting changes affect only future tasks.
- During bulk cache recovery, aggregate diagnostics in memory instead of persisting one diagnostic update per restored chapter.
- Keep localization in the presentation boundary: core code emits stable codes, parameters, or locale-neutral details; UI and browser adapters translate them. Never translate novel content, book metadata, source URLs, exported novel data, or ESJZone `status === 206` protocol text. Localize `zh-TW` manually with Taiwanese software terminology.
- Production comments use Chinese and explain business invariants, lifecycle ownership, or race ordering. Use caller-focused JSDoc without a final period only where exported APIs need a contract; keep implementation details in adjacent `//` comments and do not mix ordinary block comments with JSDoc.
- Use fixtures, fakes, fake clocks, and userscript mocks. Do not access ESJZone, live network services, or production IndexedDB in automated tests.
- Leave version, tags, GitHub Releases, and `dist/` untouched unless the user explicitly assigns release work.

## Escalate risk deliberately

Read the architecture reference and state the expected migration/compatibility behavior before changing cache schema or keys. For changes to scheduling, retries, cancellation, incremental writes, task locks, or cross-page sync, also require the stress suite through `$esj-regression-selector`.
