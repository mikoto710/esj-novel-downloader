# 下载流程阅读路线

先读入口和主流程，遇到具体分支再进入对应模块。单章导出从 `app/single-download.ts` 进入，不经过书籍下载协调器。

## 从哪里开始

| 要看什么                         | 入口                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 页面目录与书籍信息               | [`site/book.ts`](../src/site/book.ts) 的 `loadDetailBook` / `loadForumBook`；页面操作入口位于 `ui/pages/detail.ts` / `ui/pages/forum.ts` |
| 选择范围、缓存确认、取得与释放锁 | [`app/book-download.ts`](../src/app/book-download.ts) 的公开 `runBookDownload` 与局部执行、接线和收尾                                    |
| 选择规范化、绝对索引与范围摘要   | [`download/plan.ts`](../src/download/plan.ts) 的 `createDownloadPlan`、`createRangeSelection` 和 `selectDownloadTasks`                   |
| 下载阶段顺序                     | [`run.ts`](../src/download/run.ts) 的 `runDownload`                                                                                      |
| 缓存恢复、正文抓取、指定章节重试 | [`chapter-pipeline.ts`](../src/download/chapter-pipeline.ts)                                                                             |
| 密码与字体决策                   | [`protected-chapters.ts`](../src/download/protected-chapters.ts)、[`mapped-chapters.ts`](../src/download/mapped-chapters.ts)             |
| 落盘、背压、取消保存             | [`cache-writer.ts`](../src/download/cache-writer.ts)、[`cache-write-buffer.ts`](../src/download/cache-write-buffer.ts)                   |
| 导出快照与格式生成               | [`snapshot.ts`](../src/export/snapshot.ts)、[`export/`](../src/export/)、[`format-choice.ts`](../src/ui/dialogs/format-choice.ts)        |
| 页面会话与跨页通知               | [`page-session.ts`](../src/app/page-session.ts) 的当前操作、摘要、最近结果和只读所有权复核                                               |
| 缓存列表与用户清理               | [`cache-management.ts`](../src/app/cache-management.ts) 的来源合并、手动清理和停止清除                                                   |
| 语言目录、站点状态与界面刷新     | [`locale/catalog.ts`](../src/locale/catalog.ts)、[`site/locale.ts`](../src/site/locale.ts)、[`ui/locale.ts`](../src/ui/locale.ts)        |
| 浏览器能力装配                   | [`app/book-download.ts`](../src/app/book-download.ts)；显示与语言订阅位于 [`ui/download-view.ts`](../src/ui/download-view.ts)            |

## 模块依赖与运行调用

运行调用顺序如下（能力回调不等同于源码 import）。`contracts.ts` 描述输入、结果和能力；它是类型约定，不是运行时中转站。

```text
ui/pages → app/book-download.runBookDownload
              ↓ 局部取消、认领、装配与收尾
           download.runDownload
              ↓ 传入能力由核心调用
           ui/download-view / site / browser / storage

download 与 app 共享 contracts 类型
download 通过传入的能力调用浏览器实现
```

`download/` 与 `export/snapshot.ts` 由 ESLint 限制直接引入 UI、页面状态、持久化实现或浏览器全局能力。书籍锁收尾位于 `app/book-download.ts`，核心目录不再排除收尾文件；`storage/cache/` 实现 IndexedDB，不属于环境无关内核。字体缓存解析通过 `chapterProcessor.normalizeCached` 注入；新抓取正文处理仍通过 `chapterProcessor.process` 注入。

共享章节、图片、映射字体、封面和书籍元数据定义位于 [`content/model.ts`](../src/content/model.ts)。[`content/mapping-font.ts`](../src/content/mapping-font.ts) 保留唯一的字体规范化、恢复校验与安全导出绑定实现，恢复、格式生成和单章页面共同使用；[`content/image-format.ts`](../src/content/image-format.ts) 统一图片签名识别与 MIME 校验。图片 URL 解析、采集、压缩和封面获取由 [`site/images.ts`](../src/site/images.ts) 提供，正文插图仍按当前页面 `location.href` 解析。

站点书籍身份、目录和元数据解释位于 [`site/book.ts`](../src/site/book.ts)，详情入口读取当前文档，论坛入口获取详情文档后按详情 URL 解释章节地址。正文解析和采集顺序位于 [`site/chapter.ts`](../src/site/chapter.ts)，批量与单章共同使用解析与字体规范化规则；批量先规范化字体再处理或去除图片，单章仍保留原生解锁及格式决策路径。站点模块只返回内容、错误或结构化采集事实，任务归属、取消显示和本地化由调用者绑定。

具体浏览器能力位于 `browser/`：[`request.ts`](../src/browser/request.ts) 提供请求和中断，[`timing.ts`](../src/browser/timing.ts) 提供等待，[`files.ts`](../src/browser/files.ts) 提供文件触发与 Blob 转换，[`script-loader.ts`](../src/browser/script-loader.ts) 提供脚本加载及 fallback。app 的书籍任务装配这些能力，下载内核通过端口调用，不直接依赖 `browser/` 或字体 DOM 规范化函数。

### 全本成功

1. 下载按钮在 `ui/pages/detail.ts` / `ui/pages/forum.ts` 的局部处理函数中调用 `runBookDownload`。固定插图设置并只读预检同书冲突；已有任务立即提示，无冲突再读取完整目录、通过 `previewBookCache` 预览库存并打开选择弹窗。
2. 选择全本后进入 `executeBookDownload`：创建本任务取消能力，acquire 书籍锁后立即进入 `try/finally`，登记停止入口、启动心跳并 `claimBookCache`；认领结果的 Map 留在该任务局部。如果最新缓存需要额外失效确认，先结束本次尝试并释放锁，再回到选择弹窗。
3. `app/book-download.ts` 在认领和启动锁之后局部装配能力（此时读取并发数），直接调用 `runDownload` 顺序执行：

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
| 章节 Map                 | `executeBookDownload` 持有认领后的整书数据，显式传入下载核心；pipeline 写新章节，mapped-chapters 校验恢复内容                                                   |
| 下载阶段与进度           | `DownloadProgress` 同时维护阶段和进度，校验转换后发布快照；UI、诊断单向读取                                                                                     |
| 就绪与持久化数量         | `readyChapterCount` 是本次范围内存正文数；`persistedCount` 是 writer 已确认保存数；完成一次处理不等于正文或持久化成功                                           |
| 整书库存                 | `bookChapterCount`、Map 大小和 manifest 表示整书；`readyChapterCount` 表示本次范围正文                                                                          |
| 密码与字体决策           | 各模块局部状态；run 创建唯一 `UserDecisionGate`，传给 pipeline 的字体和密码分支，并串行协调缺章弹窗，密码只留任务内存                                           |
| 待写批次与存储失败       | `cache-writer` / buffer；页面不自行调度落盘                                                                                                                     |
| 锁与心跳                 | `executeBookDownload` 取得，同文件局部 finalizer 释放；回调捕获本任务取消能力，锁状态不代表业务成功                                                             |
| 最近可导出结果           | 当前任务仅在 `ready` 后通过 `publishCachedExport` 替换结果；格式弹窗绑定该结果，设置通过 `invalidateCachedEpub` 使 EPUB 失效，Blob 复用还校验生成时的标签页设置 |

`app/book-download.ts` 只公开 `runBookDownload`，取消能力、执行、接线和 finalizer 均为同文件局部实现。`ui/download-view.ts` 负责 DOM、标题、托盘与语言订阅，并在创建时绑定原任务身份和停止动作；核心未进入 try 或初始化失败时，应用层仍结束视图与已经创建的资源。[`app/page-session.ts`](../src/app/page-session.ts) 单一维护页面会话及最近导出；`AppState`、`RuntimeCacheSession` 与显示状态类型随该规则归位。EPUB 派生产物由 `app/export.ts` 维护；设置弹窗显式传入原结果使其失效。

页面 `state` 仅保留当前任务停止入口、缓存显示摘要、最近导出和页面标题。取消能力、章节 Map、锁都通过本次输入传入；不会根据新的全局变量切换到另一个任务。

- `clearRuntimeCacheSession(bookId, taskId)` 只移除摘要，不清章节或导出；显式会话清理还调用 `clearCachedExport(bookId)`，按结果自身的 bookId 定位。
- 跨页缓存通知只触发只读复核 manifest / 活动锁；失去所有权时请求当前任务停止，已结束摘要可以移除。复核完成后再次校验原 taskId；任一读取失败都不证明所有权失效。旧页面不带 taskId 的清除事件采用同样的复核方式。
- 旧 task 的事件、日志、UI 清理、锁收尾和结果发布都绑定原 taskId，不操作新的页面任务。网络取消和缓存写入信号仍分开。
- 并发数、备用页面 URL 和启动时间在浏览器装配时作为值传入；插图设置仍在缓存预览前固定，EPUB 标签页设置仍在生成 EPUB 时读取。

`export-ready` 表示数据已准备好，实际文件下载、历史和导出诊断由 `app/export.ts` 负责，格式弹窗提供交互。“再次导出”使用本页快照，不依赖续传缓存是否可读，也不重新认领缓存或获取书籍锁。

导出快照保留来源 `taskId`，再次导出的诊断写回原任务；旧弹窗的异步生成结束时，不覆盖后来任务的页面标题。EPUB 生成固定本次标签页设置，设置和原结果失效代次均未改变才缓存 Blob，重试前还会复核设置键；无来源身份的旧结果不写到后来任务的诊断。

`run` 集中恢复、下载、落盘、完整性扫描、自动补抓、缺章决策和结果准备的顺序，并创建唯一的用户决策队列传给 `chapter-pipeline`。pipeline 组装字体与密码分支，只负责恢复、正常抓取和指定章节重试；正常下载等待密码队列收尾，自动补抓与手动补章共用同一条重试路径。字体、密码、writer、范围和错误模块具有真实业务职责；不因文件短而合并。`contracts.ts` 保留实际使用的输入、结果和能力类型，不建立共享巨型 Context。

持久化实现位于 `storage/`：[`book-lock.ts`](../src/storage/book-lock.ts) 保持书籍锁、presence、心跳和远程停止的共同协议；[`cache/book-cache.ts`](../src/storage/cache/book-cache.ts) 处理预览、认领、旧缓存恢复、封面及通知，实际写事务位于 [`cache/indexeddb-repository.ts`](../src/storage/cache/indexeddb-repository.ts)。公开缓存记录位于 [`cache/model.ts`](../src/storage/cache/model.ts)，V3 与旧版结构分别留在对应 repository / legacy 模块；错误分类位于环境无关的 [`cache/storage-error.ts`](../src/storage/cache/storage-error.ts)。下载内核只引用缓存模型与错误契约，具体能力由 app 的书籍任务装配。设置由 [`settings.ts`](../src/storage/settings.ts) 直接读写 GM 偏好，历史及其记录类型由 [`history.ts`](../src/storage/history.ts) 维护；[`app/cache-management.ts`](../src/app/cache-management.ts) 合并持久库存、当前会话、原导出结果与活动锁，并协调手动清理和停止清除；统一条目、来源与清理结果类型就近定义，存储没有页面状态的反向依赖。

## 输出快照与格式生成

`export/snapshot.ts` 单一维护 `ExportSnapshot`、原任务归属、元数据、固定范围的章节及缺章占位；`app/export.ts` 的 `CachedData` 只为同一对象增加可失效的 EPUB 派生字段，不复制正文或创建第二份结果。占位只加入输出，不写回章节 Map 或缓存。`download/run.ts` 局部准备封面：恢复后启动缓存复用或经注入端口抓取，就绪前等待；固定 TXT 文本及快照后仍先 `cache.finish`，全本清整书缓存、范围关闭 writer 保留库存，然后才返回 ready。

`export/txt.ts` 负责简介与章节文本拼接、单章作者及当前 URL、TXT Blob。书籍 TXT 文本在结果准备时固定，Blob 在格式弹窗触发时创建。`export/html.ts` 的 `buildBookHtml` 与 `buildCurrentChapterHtml` 是明确的两个入口：整书与一章范围均保留封面／目录布局，当前单章保留单章元信息。共用嵌图与字体资源实现，但整书先准备字体再替换图片，当前单章先嵌图再准备字体；单章 TXT 也继续完成已启用的图片资源准备。

`export/epub.ts` 维护 EPUB 文档、导航、资源校验与局部 XHTML 转换；字体安全绑定继续调用 `content/mapping-font.ts`。`export/filename.ts` 维护原范围摘要后缀及当前单章文件名，`export/text.ts` 仅公开实际共用的字符转义。生成器不读取页面会话、采集正文、认领缓存或变更任务状态；`app/export.ts` 集中格式能力、原结果 Blob 复用、生成、触发、失败重试及历史和诊断条件。`ui/dialogs/format-choice.ts` 只保留按钮防重、确认显示、语言刷新、最小化和原任务／旧视图标题保护。

`app/single-download.ts` 保留当前文档采集、详情元数据失败回退、原生密码检查、正文及字体预检，并调用明确的当前章格式入口；不进入书籍锁、续传认领或全本结果发布。插图设置在诊断启动及实际资源准备时分别读取。元数据未取得和取得空简介的 TXT／命名行为保持不同。

`browser/files.ts` 提供文件触发与回收：书籍点击后 `remove()`，60 秒后撤销 URL；单章点击后立即标记 `downloadTriggered`，再 `body.removeChild()` 并直接撤销 URL。书籍历史 `void` 写入，不阻塞格式按钮复位；单章等待历史完成，写入拒绝仍展示失败，但已触发文件的导出诊断保持成功。清理置于 `finally`，点击或移除失败也会按各自时序回收 URL。以上记录只代表触发，不证明文件实际保存。

## 改一条规则时

- 选择、章序、范围摘要和成功缓存策略：改 [`download/plan.ts`](../src/download/plan.ts)，检查范围选择、进度、生命周期和文件名边界。运行元信息和补抓对象的选择留在 `download/run.ts`，正文执行留在 `download/chapter-pipeline.ts`。
- 缓存是否兼容：改 [`storage/cache/compatibility.ts`](../src/storage/cache/compatibility.ts)，检查 [`cache-preview.contract.test.ts`](../tests/cache/cache-preview.contract.test.ts)。预览不授权清理；正式 claim 在同一写事务检查兼容性和确认，未确认不写入、不迁移清理、不发 claimed 事件。
- 密码错误如何处理：看 `protected-chapters.ts`；站点授权协议看 [`site/protected-chapter.ts`](../src/site/protected-chapter.ts)，普通章节与授权请求共用本任务的 [`site/request-gate.ts`](../src/site/request-gate.ts)，授权独占队列保持原请求顺序。拒绝的密码不能变成普通失败章节或缓存记录。
- 会话／导出清理与跨页失效：看 [`app/page-session.ts`](../src/app/page-session.ts)、[`app/cache-management.ts`](../src/app/cache-management.ts) 和 [`runtime-cache-ownership.contract.test.ts`](../tests/cache/runtime-cache-ownership.contract.test.ts)。已有结果与新任务独立，活动章节表不由同步事件清空。
- 导出生成与重试：看 [`app/export.ts`](../src/app/export.ts) 和 [`export-recovery.contract.test.ts`](../tests/export/export-recovery.contract.test.ts)。缺章占位只加入导出快照。

注释保持就近、简短：方法说明一句职责，阶段边界说明不直观的顺序。修改流程时同时检查这里的入口与代表测试；验证命令和隔离约定见 [`docs/testing.md`](testing.md)。

## 诊断记录、任务接入与呈现

`diagnostics/manager.ts` 持有诊断数据类型、会话、事件归并、终态优先级、脱敏、容量与保留规则。它通过 `DiagnosticRepository` 读写，由 `storage/diagnostics.ts` 实现 GM 存储兼容检查及读写失败隔离。诊断独立于章节缓存，沿用原键及 schema；逐章恢复只进入内存汇总，不增加逐章持久记录。

`app/book-download.ts` 在原启动位置调用 `diagnostics/runtime.ts`：当时读取环境、并发与 EPUB 设置，插图设置由任务传入。运行时持有默认日志身份及每任务 `pagehide` 清理；实际下载能力捕获原 `taskId`，旧任务日志与事件仍写原会话，只有当前任务显示日志。`pagehide.persisted` 不标记关闭；终态事件、外层任务收尾及全量清空结束各自监听。关闭只记录事实，不推断成功；已有业务终态优先于补充收尾。

`app/export.ts` 从原快照显式传入来源身份，缺失 `taskId` 的旧结果跳过记录，避免落入运行时的默认会话。`app/single-download.ts` 仍自行创建单章身份并区分业务结果与已触发文件的导出结果。预检失败在锁创建前使用独立短会话；各入口没有共享书籍锁状态与业务成功推断。

`ui/dialogs/diagnostics.ts` 直接使用运行时的查看、删除与清空操作，调用 `diagnostics/export.ts` 生成 JSON 和文件名，再由 `browser/files.ts` 保存文件或复制摘要。`ui/messages/diagnostics.ts` 与 `ui/messages/download-log.ts` 负责调用时的界面语言；JSON 接收书名回退和日志格式器，持久记录仍保存中性代码，旧字符串、书名与协议文本不随界面语言改写。`ui/log-view.ts` 保留 50 ms 批量显示、1000 条界面事件和截断标记，控制台逐条输出及无 DOM 使用路径继续可用。

诊断仍限制最近 30 条历史、7 天保留、单会话 256 KiB 与总量 4 MiB；500 条日志、500 条事件和 50 条导出记录的裁剪顺序保持不变。密码、token、授权头及完整响应不作为记录输入；受控 URL 去除查询与片段，诊断存储失败不得改变调用方任务结果。

代表证据：`tests/infrastructure/diagnostics.test.ts`、`browser-diagnostics.contract.test.ts`、`tests/ui/diagnostics.test.ts`、`log-rendering.test.ts`，以及 `tests/export/export-recovery.contract.test.ts` 的旧结果归属和缺失身份场景。界面查看、筛选、删除、JSON 下载与摘要复制按实际页面清单验收。

## 界面语言规则与运行

`locale/catalog.ts` 持有界面语言及偏好类型、稳定键、目录完整性、插值校验和纯选择规则；两份原文目录位于 `locale/locales/`。浏览器语言映射接受字符串参数，不读取浏览器全局。`site/locale.ts` 只读取传入文档中的 ESJZone 正文转换状态：编码 1 为简体，0 或 2 为繁体，缺失或未知编码返回空值。

`ui/locale.ts` 在每次调用时通过 `storage/settings.ts` 读取偏好，再按手动偏好 → 站点状态 → 浏览器语言决定界面语言。偏好缺失、无效或暂时不可读时使用 auto；站点状态不可用时，浏览器 zh-CN / zh-SG 使用简体，其他语言回退繁体。语言设置只有保存成功才通知刷新；插图预览、并发启动和 EPUB 生成的设置读取时机分别留在原应用流程。

当前语言、订阅、DOM 文本及属性绑定和站点变化观察器归 `ui/locale.ts`。入口 `index.ts` 安装语言同步，并让日志截断格式器在调用时读取当前语言。已开放视图通过原订阅原地刷新，密码、范围输入、待决策状态、busy 状态及原任务／视图身份保护由各视图维护。语言切换不重建正文、书籍元数据、URL、导出小说内容或 206 原始提示；诊断仍保存中性代码，由 `ui/messages/` 在调用时呈现。

主要自动化证据为语言目录键与插值、设置存储失败、密码输入保留、范围选择保留及单章晚到字体结果的现有用例。自动语言跟随、保存后开放弹窗切换和普通页面控件按 `docs/testing.md` 的真实页面清单验证。

## 类型、中性消息与视图基础

类型与维护规则同处：内容及来源 `SourcePageType` 在 `content/model.ts`，下载取消模式与端口在 `download/contracts.ts`，`ChapterSummary` 在 `export/snapshot.ts`，格式扩展名 `DownloadFormat` 在 `export/filename.ts`。应用层的 `ExportFormat` 引用同一格式约定；历史只按类型消费来源、格式和快照摘要。缓存公开模型在 `storage/cache/model.ts`，内部 schema 留在 repository / legacy 实现，应用显示类型留在相应 app 模块。新增字段先定位其规则所有者，不建立全局或每包的混合 Context / types 容器。

`messages.ts` 只约定中性 code / params；具体消息集合随下载、存储错误或诊断规则定义，展示由 `ui/messages/` 本地化。`ui/dom.ts` 维护节点创建、拖动、元素清理回调与弹窗清理；`ui/log-view.ts` 维护批量日志呈现。`ui/popups.ts` 是纯视图导出入口，实际交互留在对应 dialog。文本转义只有 `export/text.ts` 的实际共用实现，去图留在 `site/chapter.ts`，EPUB 文档转换留在生成器。

审查依赖时按文件检查 import、re-export 和字面量动态 import，并区分 TypeScript 擦除前后的图。`contracts.ts`、`plan.ts`、`snapshot.ts` 的互相引用描述任务、范围及结果；`locale/catalog.ts` 与语言目录的互相引用校验目录类型。它们的类型边不代表运行时循环，也不授权引入环境 I/O。下载与快照仅消费中性缓存模型和错误契约；字体 DOM 规范化仍通过端口注入，ESLint 同时限制 `normalizeChapterMappingFont` 的命名导入。诊断 manager / JSON 和语言目录保持环境隔离，存储不反向读取应用状态。
