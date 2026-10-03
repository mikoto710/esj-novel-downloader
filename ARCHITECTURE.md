# 下载流程阅读路线

先读入口和主流程，遇到具体分支再进入对应模块。单章导出仍从 `scrapers/single.ts` 进入，不经过书籍下载协调器。

## 从哪里开始

| 要看什么                         | 入口                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 页面目录与书籍信息               | [`scrapers/detail.ts`](src/scrapers/detail.ts)、[`scrapers/forum.ts`](src/scrapers/forum.ts) 的 `loadPlan`                           |
| 选择范围、缓存确认、取得与释放锁 | [`scrapers/book-download.ts`](src/scrapers/book-download.ts) 的 `runBookDownload`、`executeBookDownload`                             |
| 下载阶段顺序                     | [`coordinator.ts`](src/core/download/coordinator.ts) 的 `runDownload`                                                                |
| 正文抓取、补抓、缺章选择         | [`chapter-pipeline.ts`](src/core/download/chapter-pipeline.ts)                                                                       |
| 密码与字体决策                   | [`protected-chapters.ts`](src/core/download/protected-chapters.ts)、[`mapped-chapters.ts`](src/core/download/mapped-chapters.ts)     |
| 落盘、背压、取消保存             | [`task-cache-writer.ts`](src/core/download/task-cache-writer.ts)、[`cache-write-buffer.ts`](src/core/download/cache-write-buffer.ts) |
| 导出快照与格式生成               | [`export-data.ts`](src/core/download/export-data.ts)、[`format-choice.ts`](src/ui/dialogs/format-choice.ts)                          |
| 浏览器实现                       | [`browser-download-dependencies.ts`](src/adapters/browser-download-dependencies.ts)                                                  |

## 模块依赖与运行调用

模块依赖方向如下。`contracts.ts` 描述输入、结果和能力；它是类型约定，不是运行时中转站。

```text
ui/pages → scrapers → adapters/batch-download → core/download
                         ↓
              browser-download-dependencies → UI / 网络 / 缓存 / 锁

core/download 与 adapters 共享 contracts 类型
core/download 通过传入的能力调用浏览器实现
```

`core/download/` 的业务模块由 ESLint 限制直接引入 UI、页面状态、持久化实现或浏览器全局能力。`task-finalizer.ts` 是书籍锁收尾的浏览器编排，明确排除；`core/cache/` 实现 IndexedDB，不属于环境无关内核。字体缓存解析通过 `chapterProcessor.normalizeCached` 注入。

### 全本成功

1. 下载按钮调用 `scrapeDetail` / `scrapeForum` → `runBookDownload`。读取完整目录、固定插图设置，`previewBookCache` 只预览库存，再打开选择弹窗。
2. 选择全本后进入 `executeBookDownload`：acquire 书籍锁，立即进入 `try/finally`，启动心跳并 `claimBookCache`。如果最新缓存需要额外失效确认，先结束本次尝试并释放锁，再回到选择弹窗。
3. `adapters/batch-download` 装配能力，`runDownload` 顺序执行：

    ```text
    mapping.restore
      → pipeline.download（含等待密码队列结束）
      → cache.flush
      → pipeline.checkIntegrity → cache.flush
      → pipeline.resolveIncomplete（重试后再次落盘）
      → createExportData → cache.finish
    ```

4. 全本 `cache.finish` 先 seal 待写批次，再清理本书缓存。`runDownload` 返回 `{ status: "ready", data }`，页面保存这份结果并调用 `showFormatChoice(data)`；外层 `finally` 处理清除请求，随后停心跳并释放书籍锁。

代表测试：[`browser-download-flow.contract.test.ts`](tests/download/browser-download-flow.contract.test.ts)、[`download-lifecycle.contract.test.ts`](tests/download/download-lifecycle.contract.test.ts)。

### 范围成功

调用链与全本相同，只在 `selection` 和 writer 收尾处区分。`selectDownloadTasks` 保留原书绝对索引；本次进度、完整性检查和导出只使用选中任务。缓存仍是一书一份，范围外章节继续保留。

`cache.finish` 先 seal，再调用 `finishForTask` 关闭 writer，保留整书累计缓存。手动选择第 1 章到最后一章会规范化为全本，成功后清缓存。

代表测试：[`download-selection.test.ts`](tests/download/download-selection.test.ts)、[`range-download-lifecycle.contract.test.ts`](tests/download/range-download-lifecycle.contract.test.ts)、[`book-lock-cache.contract.test.ts`](tests/cache/book-lock-cache.contract.test.ts)。

### 取消保留与停止清除

页面取消或远程停止 → `state` 的取消意图 → adapter 的 `cancellation` → `runDownload` 的取消分支 → `cache.cancel` → 外层 `finalizeBookDownloadTask`。

- 普通取消中止网络和用户决策等待，缓存 buffer 使用独立写入信号，有界保存当前进度。
- 停止清除可升级已有取消：buffer 丢弃待写内容，外层 finalizer 以 writer 所有权保护清理整书章节与封面。
- 核心 `finally` 关闭密码队列、密码弹窗及 buffer 监听；页面 `finally` 停心跳并释放锁。即使缓存清理失败，也继续释放资源。
- 取消返回 `{ status: "cancelled", outcome }`，失败抛出异常；两者均不替换上次可导出的结果。

代表测试：[`browser-download-cancellation.contract.test.ts`](tests/download/browser-download-cancellation.contract.test.ts)、[`cache-write-buffer.test.ts`](tests/cache/cache-write-buffer.test.ts)、[`task-finalizer.test.ts`](tests/download/task-finalizer.test.ts)、[`download-resilience.stress.test.ts`](tests/stress/download-resilience.stress.test.ts)。

## 状态由谁维护

| 数据                     | 所有者与含义                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 任务目录、范围、插图设置 | 页面固定 `DownloadOptions`；`download-scope` 校验范围并提供索引视图                                                   |
| 章节 Map                 | 当前任务持有整书数据；pipeline 写新章节，mapped-chapters 校验恢复内容                                                 |
| 下载阶段与进度           | `DownloadProgress` 是写入口，`DownloadStateMachine` 校验阶段；UI、诊断读取快照                                        |
| 就绪与持久化数量         | `readyChapterCount` 是本次范围内存正文数；`persistedCount` 是 writer 已确认保存数；完成一次处理不等于正文或持久化成功 |
| 整书库存                 | Map 大小、缓存 manifest 与页面缓存列表表示整书；下载快照中的计数以本次选择为范围                                      |
| 密码与字体决策           | 各模块局部状态；`UserDecisionGate` 串行协调弹窗，密码只留任务内存                                                     |
| 待写批次与存储失败       | `task-cache-writer` / buffer；页面不自行调度落盘                                                                      |
| 锁与心跳                 | `executeBookDownload` 取得，`finalizeBookDownloadTask` 释放；锁状态不代表业务成功                                     |
| 最近可导出结果           | 页面仅在 `ready` 后替换 `state.cachedData`；格式弹窗绑定传入快照，生成的 EPUB 属于该快照                              |

`export-ready` 表示数据已准备好，实际文件下载和历史记录由格式弹窗负责。“再次导出”使用本页快照，不依赖续传缓存是否可读，也不重新认领缓存或获取书籍锁。

## 改一条规则时

- 缓存是否兼容：改 `image-cache-compatibility.ts`，检查 [`cache-preview.contract.test.ts`](tests/cache/cache-preview.contract.test.ts)。预览不授权清理；正式 claim 在同一写事务检查兼容性和确认，未确认不写入、不迁移清理、不发 claimed 事件。
- 密码错误如何处理：看 `protected-chapters.ts`；站点授权协议看 `browser-protected-chapter.ts`。拒绝的密码不能变成普通失败章节或缓存记录。
- 导出生成与重试：看 `format-choice.ts` 和 [`export-recovery.contract.test.ts`](tests/export/export-recovery.contract.test.ts)。缺章占位只加入导出快照。

注释保持就近、简短：方法说明一句职责，阶段边界说明不直观的顺序。修改流程时同时检查这里的入口与代表测试；验证命令和隔离约定见 [`tests/README.md`](tests/README.md)。
