# 下载流程阅读路线

先读入口和主流程，遇到具体分支再进入对应模块。单章导出仍从 `scrapers/single.ts` 进入，不经过书籍下载协调器。

## 从哪里开始

| 要看什么                         | 入口                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面目录与书籍信息               | [`site/book.ts`](../src/site/book.ts) 的 `loadDetailBook` / `loadForumBook`；页面入口仍在 `scrapers/detail.ts` / `scrapers/forum.ts`                                                      |
| 选择范围、缓存确认、取得与释放锁 | [`scrapers/book-download.ts`](../src/scrapers/book-download.ts) 的 `runBookDownload`、`executeBookDownload` 与 [`book-download-lifecycle.ts`](../src/adapters/book-download-lifecycle.ts) |
| 选择规范化、绝对索引与范围摘要   | [`download/plan.ts`](../src/download/plan.ts) 的 `createDownloadPlan`、`createRangeSelection` 和 `selectDownloadTasks`                                                                    |
| 下载阶段顺序                     | [`run.ts`](../src/download/run.ts) 的 `runDownload`                                                                                                                                       |
| 缓存恢复、正文抓取、指定章节重试 | [`chapter-pipeline.ts`](../src/download/chapter-pipeline.ts)                                                                                                                              |
| 密码与字体决策                   | [`protected-chapters.ts`](../src/download/protected-chapters.ts)、[`mapped-chapters.ts`](../src/download/mapped-chapters.ts)                                                              |
| 落盘、背压、取消保存             | [`cache-writer.ts`](../src/download/cache-writer.ts)、[`cache-write-buffer.ts`](../src/download/cache-write-buffer.ts)                                                                    |
| 导出快照与格式生成               | [`export-data.ts`](../src/core/download/export-data.ts)、[`format-choice.ts`](../src/ui/dialogs/format-choice.ts)                                                                         |
| 浏览器能力装配                   | [`browser-download-dependencies.ts`](../src/adapters/browser-download-dependencies.ts)                                                                                                    |

## 模块依赖与运行调用

模块依赖方向如下。`contracts.ts` 描述输入、结果和能力；它是类型约定，不是运行时中转站。

```text
ui/pages → scrapers/book-download
              ↓ DownloadOptions + 本次 lock / chapters / cancellation / originalTitle
           browser-download-dependencies.batchDownload → download.runDownload
              ↓ 传入能力由核心调用
           UI / 网络 / 缓存 / 锁

download 与 adapters 共享 contracts 类型
download 通过传入的能力调用浏览器实现
```

`download/` 与暂留 `core/download/` 的快照模块由 ESLint 限制直接引入 UI、页面状态、持久化实现或浏览器全局能力。书籍锁收尾位于 `adapters/book-download-lifecycle.ts`，核心目录不再排除收尾文件；`storage/cache/` 实现 IndexedDB，不属于环境无关内核。字体缓存解析通过 `chapterProcessor.normalizeCached` 注入；新抓取正文处理仍通过 `chapterProcessor.process` 注入。

共享章节、图片、映射字体、封面和书籍元数据定义位于 [`content/model.ts`](../src/content/model.ts)。[`content/mapping-font.ts`](../src/content/mapping-font.ts) 保留唯一的字体规范化、恢复校验与安全导出绑定实现，恢复、格式生成和单章页面共同使用；[`content/image-format.ts`](../src/content/image-format.ts) 统一图片签名识别与 MIME 校验。图片 URL 解析、采集、压缩和封面获取由 [`site/images.ts`](../src/site/images.ts) 提供，正文插图仍按当前页面 `location.href` 解析。

站点书籍身份、目录和元数据解释位于 [`site/book.ts`](../src/site/book.ts)，详情入口读取当前文档，论坛入口获取详情文档后按详情 URL 解释章节地址。正文解析和采集顺序位于 [`site/chapter.ts`](../src/site/chapter.ts)，批量与单章共同使用解析与字体规范化规则；批量先规范化字体再处理或去除图片，单章仍保留原生解锁及格式决策路径。站点模块只返回内容、错误或结构化采集事实，任务归属、取消显示和本地化由调用者绑定。

具体浏览器能力位于 `browser/`：[`request.ts`](../src/browser/request.ts) 提供请求和中断，[`timing.ts`](../src/browser/timing.ts) 提供等待，[`files.ts`](../src/browser/files.ts) 提供文件触发与 Blob 转换，[`script-loader.ts`](../src/browser/script-loader.ts) 提供脚本加载及 fallback。adapter 装配这些能力，下载内核通过端口调用，不直接依赖 `browser/` 或字体 DOM 规范化函数。

### 全本成功

1. 下载按钮调用 `scrapeDetail` / `scrapeForum` → `runBookDownload`。固定插图设置并只读预检同书冲突；已有任务立即提示，无冲突再读取完整目录、通过 `previewBookCache` 预览库存并打开选择弹窗。
2. 选择全本后进入 `executeBookDownload`：创建本任务取消能力，acquire 书籍锁后立即进入 `try/finally`，登记停止入口、启动心跳并 `claimBookCache`；认领结果的 Map 留在该任务局部。如果最新缓存需要额外失效确认，先结束本次尝试并释放锁，再回到选择弹窗。
3. `browser-download-dependencies.batchDownload(options, task)` 装配能力，`runDownload` 顺序执行：

    ```text
    pipeline.restore
      → pipeline.download（含等待密码队列结束）
      → cache.flush
      → scanChapterIntegrity → pipeline.retry → cache.flush
      → scanMissingChapterTasks → 缺章决策循环（pipeline.retry 后先落盘，再重新检查）
      → createExportData → cache.finish
    ```

4. 全本 `cache.finish` 先 seal 待写批次，再清理本书缓存。`runDownload` 返回 `{ status: "ready", data }`，页面以 taskId 校验后发布这份结果并调用 `showFormatChoice(data)`；外层 `finally` 处理清除请求，随后停心跳并释放书籍锁。

入口预检仅提前提示，不占锁；选择期间出现的新任务仍由确认后的原子获取拦截。预检读取失败时任务不启动，旧结果仍可再次导出。

代表测试：[`download-lifecycle.contract.test.ts`](../tests/download/download-lifecycle.contract.test.ts)、[`download-coordinator.characterization.test.ts`](../tests/download/download-coordinator.characterization.test.ts)。普通页面接线按 [`docs/testing.md`](testing.md) 的实际页面清单验收；`browser-download-flow.contract.test.ts` 保留请求排序、任务隔离与启动失败清理边界。

### 范围成功

调用链与全本相同。`download/plan.ts` 统一规范化全本／连续范围、校验源目录和选中任务顺序，提供原书绝对索引、范围内位置、结构化摘要和成功缓存保留规则。`selectDownloadTasks` 保留原书绝对索引，`createDownloadPlan` 固定输出章节集合；run 根据当前库存扫描补抓对象，pipeline 执行恢复、正常抓取和指定章节重试，不改写输出范围。缓存仍是一书一份，范围外章节继续保留。

`cache.finish` 先 seal，再依据计划的 `retainCacheOnSuccess` 调用 `finishForTask` 关闭 writer，保留整书累计缓存。第 1 章到最后一章的选择在计划中规范化为全本，成功后清缓存。入口诊断、导出快照及后续文件名和历史共用计划生成的选择摘要，不分别转换章序。运行 `CacheMeta` 在 run 中构造并传给 writer，plan 不接收书籍锁、取消、UI、writer 或运行元信息。

代表测试：[`download-selection.test.ts`](../tests/download/download-selection.test.ts)、[`range-download-lifecycle.contract.test.ts`](../tests/download/range-download-lifecycle.contract.test.ts)、[`book-lock-cache.contract.test.ts`](../tests/cache/book-lock-cache.contract.test.ts)。

### 取消保留与停止清除

页面取消入口或捕获本任务的心跳回调 → 本任务 `cancellation` → `runDownload` 的取消分支 → `cache.cancel` → 外层 `finalizeBookDownloadTask`。

- 普通取消中止网络和用户决策等待，缓存 buffer 使用独立写入信号，有界保存当前进度。
- 停止清除可升级已有取消：buffer 丢弃待写内容，外层 finalizer 以 writer 所有权保护清理整书章节与封面。
- 核心 `finally` 关闭密码队列、密码弹窗及 buffer 监听；页面 `finally` 停心跳并释放锁。即使缓存清理失败，也继续释放资源。
- 取消返回 `{ status: "cancelled", outcome }`，失败抛出异常；两者均不替换上次可导出的结果。

代表测试：[`browser-download-cancellation.contract.test.ts`](../tests/download/browser-download-cancellation.contract.test.ts)、[`cache-write-buffer.test.ts`](../tests/cache/cache-write-buffer.test.ts)、[`task-finalizer.test.ts`](../tests/download/task-finalizer.test.ts)、[`download-resilience.stress.test.ts`](../tests/stress/download-resilience.stress.test.ts)。

## 状态由谁维护

| 数据                     | 所有者与含义                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务目录、范围、插图设置 | 页面固定插图设置；`download/plan.ts` 校验并固定选择、输出目录和索引视图                                                                                         |
| 运行缓存元信息           | `run.ts` 在 writer 创建前构造 `CacheMeta`，沿用原启动时间、页面 URL 和整书章数                                                                                  |
| 章节 Map                 | `executeBookDownload` 持有认领后的整书数据，显式传入 adapter；pipeline 写新章节，mapped-chapters 校验恢复内容                                                   |
| 下载阶段与进度           | `DownloadProgress` 同时维护阶段和进度，校验转换后发布快照；UI、诊断单向读取                                                                                     |
| 就绪与持久化数量         | `readyChapterCount` 是本次范围内存正文数；`persistedCount` 是 writer 已确认保存数；完成一次处理不等于正文或持久化成功                                           |
| 整书库存                 | `bookChapterCount`、Map 大小和 manifest 表示整书；`readyChapterCount` 表示本次范围正文                                                                          |
| 密码与字体决策           | 各模块局部状态；run 创建唯一 `UserDecisionGate`，传给 pipeline 的字体和密码分支，并串行协调缺章弹窗，密码只留任务内存                                           |
| 待写批次与存储失败       | `cache-writer` / buffer；页面不自行调度落盘                                                                                                                     |
| 锁与心跳                 | `executeBookDownload` 取得，浏览器 lifecycle 释放；回调捕获本任务取消能力，锁状态不代表业务成功                                                                 |
| 最近可导出结果           | 当前任务仅在 `ready` 后通过 `publishCachedExport` 替换结果；格式弹窗绑定该结果，设置通过 `invalidateCachedEpub` 使 EPUB 失效，Blob 复用还校验生成时的标签页设置 |

页面 `state` 仅保留当前任务停止入口、缓存显示摘要、最近导出和页面标题。取消能力、章节 Map、锁都通过本次输入传入；不会根据新的全局变量切换到另一个任务。

- `clearRuntimeCacheSession(bookId, taskId)` 只移除摘要，不清章节或导出；显式会话清理还调用 `clearCachedExport(bookId)`，按结果自身的 bookId 定位。
- 跨页缓存通知只触发只读复核 manifest / 活动锁；失去所有权时请求当前任务停止，已结束摘要可以移除。旧页面不带 taskId 的清除事件采用同样的复核方式。
- 旧 task 的事件、日志、UI 清理、锁收尾和结果发布都绑定原 taskId，不操作新的页面任务。网络取消和缓存写入信号仍分开。
- 并发数、备用页面 URL 和启动时间在浏览器装配时作为值传入；插图设置仍在缓存预览前固定，EPUB 标签页设置仍在生成 EPUB 时读取。

`export-ready` 表示数据已准备好，实际文件下载和历史记录由格式弹窗负责。“再次导出”使用本页快照，不依赖续传缓存是否可读，也不重新认领缓存或获取书籍锁。

导出快照保留来源 `taskId`，再次导出的诊断写回原任务；旧弹窗的异步生成结束时，不覆盖后来任务的页面标题。EPUB 生成固定本次标签页设置，设置未改变才缓存 Blob，重试前还会复核设置键。

`run` 集中恢复、下载、落盘、完整性扫描、自动补抓、缺章决策和结果准备的顺序，并创建唯一的用户决策队列传给 `chapter-pipeline`。pipeline 组装字体与密码分支，只负责恢复、正常抓取和指定章节重试；正常下载等待密码队列收尾，自动补抓与手动补章共用同一条重试路径。字体、密码、writer、范围和错误模块具有真实业务职责；不因文件短而合并。`contracts.ts` 保留实际使用的输入、结果和能力类型，不建立共享巨型 Context。

持久化实现位于 `storage/`：[`book-lock.ts`](../src/storage/book-lock.ts) 保持书籍锁、presence、心跳和远程停止的共同协议；[`cache/book-cache.ts`](../src/storage/cache/book-cache.ts) 处理预览、认领、旧缓存恢复、封面及通知，实际写事务位于 [`cache/indexeddb-repository.ts`](../src/storage/cache/indexeddb-repository.ts)。公开缓存记录位于 [`cache/model.ts`](../src/storage/cache/model.ts)，V3 与旧版结构分别留在对应 repository / legacy 模块；错误分类位于环境无关的 [`cache/storage-error.ts`](../src/storage/cache/storage-error.ts)。下载内核只引用缓存模型与错误契约，具体能力由 adapter 装配。设置由 [`settings.ts`](../src/storage/settings.ts) 直接读写 GM 偏好，历史及其记录类型由 [`history.ts`](../src/storage/history.ts) 维护；页面会话摘要与 [`core/cache/manager.ts`](../src/core/cache/manager.ts) 的缓存管理协调暂留原归属。

## 改一条规则时

- 选择、章序、范围摘要和成功缓存策略：改 [`download/plan.ts`](../src/download/plan.ts)，检查范围选择、进度、生命周期和文件名边界。运行元信息和补抓对象的选择留在 `download/run.ts`，正文执行留在 `download/chapter-pipeline.ts`。
- 缓存是否兼容：改 [`storage/cache/compatibility.ts`](../src/storage/cache/compatibility.ts)，检查 [`cache-preview.contract.test.ts`](../tests/cache/cache-preview.contract.test.ts)。预览不授权清理；正式 claim 在同一写事务检查兼容性和确认，未确认不写入、不迁移清理、不发 claimed 事件。
- 密码错误如何处理：看 `protected-chapters.ts`；站点授权协议看 [`site/protected-chapter.ts`](../src/site/protected-chapter.ts)，普通章节与授权请求共用本任务的 [`site/request-gate.ts`](../src/site/request-gate.ts)，授权独占队列保持原请求顺序。拒绝的密码不能变成普通失败章节或缓存记录。
- 会话／导出清理与跨页失效：看 `state.ts`、`cache/manager.ts` 和 [`runtime-cache-ownership.contract.test.ts`](../tests/cache/runtime-cache-ownership.contract.test.ts)。已有结果与新任务独立，活动章节表不由同步事件清空。
- 导出生成与重试：看 `format-choice.ts` 和 [`export-recovery.contract.test.ts`](../tests/export/export-recovery.contract.test.ts)。缺章占位只加入导出快照。

注释保持就近、简短：方法说明一句职责，阶段边界说明不直观的顺序。修改流程时同时检查这里的入口与代表测试；验证命令和隔离约定见 [`docs/testing.md`](testing.md)。
