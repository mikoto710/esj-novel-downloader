# 代码结构与维护入口

## 书籍下载

从 [runBookDownload](../src/app/book-download.ts) 进入。详情页读取当前文档，论坛列表页限时取得详情页。准备窗口同时支持取消和再次导出。用户确认选择后，应用才取得书籍锁并认领缓存。

```text
目录与只读预览 → 确认所选章节 → 取得锁、认领缓存
→ 恢复可用章节 → 抓取与批量保存 → 检查完整性、补抓或确认占位
→ 生成导出快照 → 结算缓存与书籍锁 → 发布本次结果 → 按所选格式下载
```

| 维护问题             | 代码入口                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面挂载、目录与选择 | [页面入口](../src/index.ts)识别页面类型，30 秒内补查下载按钮。[原站目录](../src/site/book-directory.ts)与[选择视图](../src/ui/dialogs/chapter-directory.ts)共用绝对索引。[选择计划](../src/download/plan.ts)负责全选、自选和旧摘要兼容。 |
| 网络请求与重试       | [站点路由](../src/site/routes.ts)判定当前镜像的章节地址。[章节请求](../src/site/chapter.ts)与[密码授权](../src/site/protected-chapter.ts)共用请求门控。[重试策略](../src/download/retry-policy.ts)维护次数与等待。                       |
| 恢复、密码与缺章     | [章节流程](../src/download/chapter-pipeline.ts)恢复缓存、确认字体、抓取和补抓。[密码处理](../src/download/protected-chapters.ts)负责拒绝与重连。[runDownload](../src/download/run.ts)决定重试、占位或取消。                              |
| 进度、缓存与清理     | [DownloadProgress](../src/download/progress.ts)区分本次就绪、整书库存与已提交章节。[批量写入](../src/download/cache-writer.ts)负责背压、提交和取消保存。[缓存管理](../src/app/cache-management.ts)合并持久缓存、活动任务及当前页结果。   |
| 页面会话与导出       | [页面会话](../src/app/page-session.ts)按任务保存操作句柄、进度摘要和最近结果。[导出快照](../src/export/snapshot.ts)固定选择、正文和原任务身份。[格式导出](../src/app/export.ts)处理文件、历史与再次导出。                                |

### 断点与写入权

- 全本和自选共用一本书的缓存。章节按原目录位置保存，站内章另存书号和章号，站外占位另存完整目标地址。预览与恢复都校验位置及来源。插章、调序或旧缓存缺少标识时，只重新抓取本次选中的不匹配项。其余位置留到下次选择。[章节来源](../src/storage/cache/chapter-source.ts)
- v3 预览读取清单、索引和来源，不读取正文或 Blob。旧版整块记录在认领时迁移。已有的 v3 清单及清除标记优先于旧键。插图设置不兼容时先确认，再持锁复核许可。[缓存入口](../src/storage/cache/book-cache.ts)
- 每书的锁、写入者和章节记录共用 v3 的 IndexedDB 对象存储。认领、每批写入、关闭和清理都在事务内核对任务及锁有效期。接管后旧任务失去写入权。缓存管理发出的停止请求绑定窗口显示的任务，释放事务结算已接受的清理请求并记录清理结果。[书籍锁](../src/storage/book-lock.ts) · [缓存事务](../src/storage/cache/indexeddb-repository.ts)
- 全本成功后清理整书缓存，自选成功保留已存章节并关闭写入者。批次提交成功才计入落盘。普通取消和 `pagehide` 中止网络、保留写入权并尝试保存，在首次请求后的五秒内收尾。浏览器强制结束时，续传从最后成功提交的批次开始。[写入缓冲](../src/download/cache-write-buffer.ts)
- 成功抓完的全本遇到普通清理或释放错误时仍可导出，界面另行提示。显式丢弃、失去所有权或新任务失败时保留此前的导出结果。缓存列表遇到局部读取失败时展示可确认的条目，支持刷新重试。[任务收尾](../src/app/book-download.ts) · [缓存窗口](../src/ui/dialogs/cache-manager.ts)

### 正文与输出

- 单章从[当前页导出](../src/app/single-download.ts)，使用原站解锁，不占用书籍锁。批量、解锁后重取和单章共用[正文解析](../src/site/chapter.ts)。批量抓取区分站点登录页和缺少正文容器。TXT 保留段落和换行，只去掉开头独占一行的重复章名。
- 书籍抓取只请求当前官方镜像的章节。站外章节保留链接占位。密码仅保存在当前任务内存，授权请求限制在同源。
- HTML 嵌入正文片段，EPUB 将正文转换为 XHTML，两种格式按需绑定插图资源。[映射字体](../src/content/mapping-font.ts)与正文一起校验和保存，含映射字体的选择支持 HTML 和 EPUB。
- 缺章占位只进入本次选中的导出快照。原始书名用于元数据及历史，自定义名只影响[下载文件名](../src/export/filename.ts)。[EPUB](../src/export/epub.ts)按生成设置复用，旧任务的生成结果仍归原任务。

## 界面、设置与诊断

- [选择窗口](../src/ui/dialogs/download-selection.ts)持有勾选、搜索和文件名，[任务视图](../src/ui/download-view.ts)按任务刷新进度。全局[样式](../src/ui/styles.css)和局部 CSS 在构建时内联。
- [下载设置](../src/storage/settings.ts)持久化偏好。插图开关在预览前固定，并发数和批量下载兼容模式在任务装配时读取，EPUB 设置在生成时读取。[界面语言](../src/ui/locale.ts)依次使用手动偏好、站点提示和浏览器语言。新增文案同时维护[简体](../src/locale/locales/zh-CN.ts)和[繁体](../src/locale/locales/zh-TW.ts)。
- 批量下载兼容模式默认关闭。[章节请求](../src/site/chapter.ts)默认使用脚本管理器的 GM 请求，开启后用浏览器的同源 `fetch` 读取章节页面。密码授权和图片分别沿用各自的请求方式。
- [历史](../src/storage/history.ts)和[诊断](../src/diagnostics/manager.ts)兼容旧选择摘要。诊断按站点来源和任务写入 IndexedDB，读取、复制及导出时也处理旧日志中的认证信息。诊断故障不阻断下载，已删除的会话不会写入后续任务。[诊断存储](../src/storage/diagnostics.ts) · [诊断导出](../src/diagnostics/export.ts)

下载内核通过[能力接口](../src/download/contracts.ts)访问应用提供的站点、存储与交互能力。内核和快照的依赖边界由 ESLint 检查。测试选择和实页验收见[测试指南](testing.md)。
