# Regression Matrix

| Changed behavior | Add or inspect | Required commands |
| --- | --- | --- |
| Pure parser, text, image, or formatting logic | nearest unit test; `tests/export/` for export output | targeted Vitest test; `npm run check` |
| UI popup, rendered log, setting, or single-page action | `tests/ui/` and nearest scraper/adapter contract | targeted Vitest test; `npm run check` |
| Browser API, download assembly, page injection | relevant `*.contract.test.ts`; `tests/support/browser-download-harness.ts` | targeted Vitest test; `npm run check`; document manual browser/userscript-manager check |
| Export, images, EPUB, HTML, or full-vs-single isolation | `tests/export/` | targeted Vitest test; `npm run check` |
| Mapping-font detection, cache normalization, or export binding | `tests/mapping-font/` plus affected export tests | targeted Vitest test; `npm run check` |
| Cache schema, legacy migration, history isolation, storage errors, cross-page sync | `tests/cache/` | targeted Vitest test; `npm run check` |
| Download scheduling, retry, worker pool, incremental writes, lock, cancel, resume, or lifecycle | `tests/download/` and relevant `tests/cache/` | targeted Vitest test; `npm run check`; `npm run test:stress` |
| Broad cross-cutting change or release candidate | affected suites | `npm run build`; add `npm run test:stress` for any lifecycle/cache/concurrency change |

## Test conventions

- `*.test.ts`: pure logic, state machine, retry, worker pool, cache writes.
- `*.contract.test.ts`: stable behavior across page adapters, core, locks, cache, and exports.
- `*.characterization.test.ts`: preserve confirmed complex behavior before refactoring.
- Stress tests are excluded from normal test commands and cover 3000-chapter scale, high cache hit rates, image blobs, slow storage, backpressure, and cancellation.