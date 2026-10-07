# 代码结构与维护入口

先按下面的表找到要改的职责，再读对应文件及附近测试。具体参数和分支约定放在源码注释中，验证选择见[测试指南](testing.md)。

## 改动入口

以下路径均相对于 `src/`，类型跟随维护它的规则，不集中到全局 `types` 或混合上下文中。

| 要修改的内容       | 主要文件                                                                                                                                                                                      | 职责                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 页面按钮与单章预检 | [ui/pages/](../src/ui/pages/)、[index.ts](../src/index.ts)                                                                                                                                    | 页面识别、注入、入口状态                                                              |
| 书籍下载生命周期   | [app/book-download.ts](../src/app/book-download.ts)                                                                                                                                           | 选择、缓存确认、取得锁、装配能力、最终收尾                                            |
| 下载范围与阶段     | [download/plan.ts](../src/download/plan.ts)、[run.ts](../src/download/run.ts)、[progress.ts](../src/download/progress.ts)                                                                     | 索引与范围、执行顺序、进度                                                            |
| 章节抓取与决策     | [download/chapter-pipeline.ts](../src/download/chapter-pipeline.ts)、[protected-chapters.ts](../src/download/protected-chapters.ts)、[mapped-chapters.ts](../src/download/mapped-chapters.ts) | 恢复、抓取、补抓、密码与字体决策                                                      |
| 任务内缓存写入     | [download/cache-writer.ts](../src/download/cache-writer.ts)、[cache-write-buffer.ts](../src/download/cache-write-buffer.ts)                                                                   | 批量写入、等待写入、取消保存                                                          |
| 站点内容与资源规则 | [site/](../src/site/)、[content/](../src/content/)                                                                                                                                            | 书籍/正文解析、请求授权、图片处理；共享模型与字体/图片校验                            |
| 持久缓存与书籍锁   | [storage/cache/](../src/storage/cache/)、[book-lock.ts](../src/storage/book-lock.ts)                                                                                                          | 缓存兼容、事务、写入者保护、跨页锁与通知                                              |
| 页面会话与缓存管理 | [app/page-session.ts](../src/app/page-session.ts)、[cache-management.ts](../src/app/cache-management.ts)                                                                                      | 当前操作、显示摘要、最近结果、缓存列表与用户清理                                      |
| 导出与当前单章流程 | [app/export.ts](../src/app/export.ts)、[single-download.ts](../src/app/single-download.ts)、[export/](../src/export/)                                                                         | 应用层确认/下载/历史；快照、文件名、TXT/HTML/EPUB 生成                                |
| 弹窗与呈现         | [ui/dialogs/](../src/ui/dialogs/)、[download-view.ts](../src/ui/download-view.ts)、[dom.ts](../src/ui/dom.ts)、[log-view.ts](../src/ui/log-view.ts)                                           | 交互、任务进度、节点清理与日志显示                                                    |
| 设置与历史         | [storage/settings.ts](../src/storage/settings.ts)、[history.ts](../src/storage/history.ts)                                                                                                    | 偏好和下载记录读写                                                                    |
| 诊断               | [diagnostics/manager.ts](../src/diagnostics/manager.ts)、[runtime.ts](../src/diagnostics/runtime.ts)、[export.ts](../src/diagnostics/export.ts)                                               | 记录规则、任务接入、JSON 生成；存储在 `storage/diagnostics.ts`，展示在 `ui/messages/` |
| 界面语言           | [locale/](../src/locale/)、[site/locale.ts](../src/site/locale.ts)、[ui/locale.ts](../src/ui/locale.ts)                                                                                       | 纯语言目录、站点转换提示、偏好解析与界面刷新                                          |
| 浏览器能力         | [browser/](../src/browser/)                                                                                                                                                                   | 请求、等待、脚本加载、文件触发与剪贴板                                                |

## 主要调用链

书籍下载的成功路径：

```text
ui/pages/detail 或 forum
  → app/book-download：打开准备窗口 → 冲突预检 → site/book 读取目录
                       → 缓存预览 → 窗口就绪 → 确认范围 → 取得锁、认领缓存
  → download/run：恢复 → 抓取 → 落盘 → 完整性检查与补抓
                  → 缺章决策 → 导出快照 → 缓存收尾
  → app/page-session：发布结果，format-choice 显示格式窗口
  → app/book-download 的 finally：处理清除请求、停心跳、释放锁

用户选择格式 → app/export → export 格式生成 → browser/files 触发下载
```

单章流程：`ui/pages/single → app/single-download → site/content → export → browser/files`。它使用当前文档和原站解锁，不取得书籍锁，也不替换书籍下载结果。

`download/contracts.ts` 描述输入、结果和能力；具体实现由应用层传入。下载内核与快照模块不直接读取页面状态、浏览器 API 或持久化实现，ESLint 检查这些边界。审查依赖时区分运行时 import 与仅类型引用。

## 修改流程时要保留的边界

- **准备与确认**：detail 读取当前文档，forum 通过 `browser/request.fetchPageText` 有界读取详情正文。准备窗口可取消或打开旧导出，应用层中止请求并忽略关闭后的目录、缓存与错误；准备期间不取得锁或认领缓存。
- **范围与缓存**：任务使用原书绝对索引。全本和范围共用一份书籍锁与缓存；全本成功清缓存，范围成功关闭写入者并保留累计章节。预览只读，正式认领在事务中复核兼容性与清除许可；需要重新确认时先释放锁并保留范围，不重读目录。
- **取消与收尾**：普通取消中断请求和用户等待，以独立写入信号有界保存；停止清除可以升级取消意图，最终由当前写入者清理。无论成功、失败或取消，应用层都停心跳、释放锁。密码、字体和缺章弹窗在任务内串行，密码仅保留于任务内存。
- **任务状态**：章节 Map、取消能力和锁属于具体任务；页面只保留操作入口、摘要和最近结果。旧回调按 `taskId` 校验，新任务失败或取消保留旧导出。`readyChapterCount` 计本次范围已有记录，`bookChapterCount` 计整书 Map，`persistedCount` 是确认保存数，三者不要混用。
- **输出与资源**：缺章占位只进导出快照。整书及范围 HTML 有封面/目录，当前单章用独立布局；两者共享资源规则。正文图片按发起页面地址解析，字体先规范化与校验；映射字体不能导出 TXT。
- **再次导出**：`app/export` 绑定原结果，EPUB 缓存复用需检查生成设置和失效版本；格式弹窗关闭不取消生成，旧生成不能覆盖新任务标题。插图设置在缓存预览前固定，并发数在装配时读取，EPUB 标签页设置在生成时读取。
- **诊断与语言**：诊断记录来源任务的中性消息，已有终态优先，存储故障不阻断主流程；敏感内容不进入记录。语言选择按手动偏好 → 站点提示 → 浏览器语言，UI 刷新不改变小说内容、元数据、URL 或站点协议原文。

一般改动直接运行对应测试；涉及取消、锁或缓存写入时，连同相邻退出路径与压力场景检查。测试目录、隔离要求和真实页面清单统一见[测试指南](testing.md)。
