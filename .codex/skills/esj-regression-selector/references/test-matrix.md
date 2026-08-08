# Regression Matrix

| Changed behavior                                                                                | Add or inspect                                                             | Required commands                                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pure parser, text, image, or formatting logic                                                   | nearest unit test; `tests/export/` for export output                       | targeted Vitest test; `npm run check`                                                    |
| UI popup, rendered log, setting, or single-page action                                          | `tests/ui/` and nearest scraper/adapter contract                           | targeted Vitest test; `npm run check`                                                    |
| Locale catalog, persisted presentation data, or runtime language switching                      | locale symmetry and terminology tests; affected open UI and adapter tests  | targeted Vitest test; `npm run check`; document Chrome + Tampermonkey language switching |
| Browser API, download assembly, page injection                                                  | relevant `*.contract.test.ts`; `tests/support/browser-download-harness.ts` | targeted Vitest test; `npm run check`; document manual browser/userscript-manager check  |
| Export, images, EPUB, HTML, or full-vs-single isolation                                         | `tests/export/`                                                            | targeted Vitest test; `npm run check`                                                    |
| Mapping-font detection, cache normalization, or export binding                                  | `tests/mapping-font/` plus affected export tests                           | targeted Vitest test; `npm run check`                                                    |
| Cache schema, legacy migration, history isolation, storage errors, cross-page sync              | `tests/cache/`                                                             | targeted Vitest test; `npm run check`                                                    |
| Download scheduling, retry, worker pool, incremental writes, lock, cancel, resume, or lifecycle | `tests/download/` and relevant `tests/cache/`                              | targeted Vitest test; `npm run check`; `npm run test:stress`                             |
| Broad cross-cutting change or release candidate                                                 | affected suites                                                            | `npm run build`; add `npm run test:stress` for any lifecycle/cache/concurrency change    |

## Test conventions

- `*.test.ts`: pure logic, state machine, retry, worker pool, cache writes.
- `*.contract.test.ts`: stable behavior across page adapters, core, locks, cache, and exports.
- `*.characterization.test.ts`: preserve confirmed complex behavior before refactoring.
- For a popup with multiple decisions, click every action directly and assert its result, cleanup, and relevant side effects.
- For localization, assert catalog symmetry, intentional Taiwanese terminology, locale-neutral persistence, and updates to already-open interfaces. Never translate novel data or infer behavior by parsing translated output.
- Keep pure logic in Node and reserve jsdom for tests that require browser document behavior. Do not add a broad presentation test when focused locale and component tests already cover the same contract.
- Stress tests are excluded from normal test commands and cover 3000-chapter scale, high cache hit rates, image blobs, slow storage, backpressure, and cancellation.
