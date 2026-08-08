---
name: esj-regression-selector
description: Select, implement, and run focused regression coverage for ESJ Novel Downloader changes. Use after modifying or reviewing TypeScript code in this repository, especially download coordination, retries, cancellation, task locks, IndexedDB/cache behavior, browser adapters, exports, mapping fonts, localization, or UI flows.
---

# ESJ Regression Selector

## Select coverage

1. Read `references/test-matrix.md` and classify the changed behavior, not merely the edited folder.
2. Run the smallest targeted tests while iterating; then run every required command in the selected row before completion.
3. Add or update a regression test at the actual business boundary. Keep test titles about externally observable outcomes.
4. For protected chapter changes, cover authorization, password rejection, request ordering, skip/cancel finalization, and full-book versus single-chapter behavior across the relevant infrastructure, download, UI, and export tests. Run `npm run test:stress` for queue, lock, cancellation, or lifecycle changes, and report browser/userscript-manager validation separately.
5. Report commands run, unrun checks, and remaining manual-browser risk.

## Preserve test isolation

- Use `createDeferred()` to control promise order and `useFakeClock()` for retry, timeout, heartbeat, and backoff behavior.
- Reuse `tests/support/` fakes, fixtures, and resource tracking. Do not use live ESJZone, network calls, or real IndexedDB.
- Create independent state, repository, lock, and observer per test. Close/clear timers, BroadcastChannels, and test databases.
- Keep pure tests in the Node environment. Use jsdom only for DOM, DOMParser, page injection, HTML/EPUB structure, or browser-presentation contracts, and avoid broad tests that duplicate focused locale or UI assertions.
- Cover success, failure, normal stop, stop-and-clear, cache recovery, and repeated cancellation for changed download lifecycle behavior.

## Interpret results

Do not claim a full build from a focused test run. Treat a skipped stress suite or browser/manual check as an explicit residual risk, not as a pass.
