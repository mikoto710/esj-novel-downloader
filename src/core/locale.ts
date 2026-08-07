/**
 * 脚本界面语言
 */
export type InterfaceLocale = "zh-CN" | "zh-TW";

export const INTERFACE_LOCALE_PREFERENCES = ["auto", "zh-CN", "zh-TW"] as const;
export type InterfaceLocalePreference = (typeof INTERFACE_LOCALE_PREFERENCES)[number];

/**
 * 检查界面语言偏好是否有效
 */
export function isInterfaceLocalePreference(value: unknown): value is InterfaceLocalePreference {
    return INTERFACE_LOCALE_PREFERENCES.some((preference) => preference === value);
}

/**
 * 按优先级解析界面语言
 */
export function resolveInterfaceLocale(
    preference: InterfaceLocalePreference,
    websiteLocale: InterfaceLocale | null,
    browserLocale: InterfaceLocale
): InterfaceLocale {
    return preference === "auto" ? (websiteLocale ?? browserLocale) : preference;
}

export type LocaleMessageValue = string | number | boolean;
export type LocaleMessageParams = Readonly<Record<string, LocaleMessageValue>>;
export type LocaleCatalog = Readonly<Record<string, string>>;
export type LocaleCatalogs = Readonly<Record<InterfaceLocale, LocaleCatalog>>;

/**
 * 基础文案键，后续迁移按需扩充
 */
export const LOCALE_KEYS = [
    "common.confirm",
    "common.cancel",
    "common.close",
    "common.minimize",
    "common.infoTitle",
    "common.warningTitle",
    "common.errorTitle",
    "common.viewDiagnostics",
    "common.preparing",
    "common.retry",
    "common.skip",
    "common.skipAll",
    "common.loading",
    "button.downloadAll",
    "button.settings",
    "settings.title",
    "settings.versionUnknown",
    "settings.concurrency",
    "settings.cache",
    "settings.history",
    "settings.diagnostics",
    "settings.diagnosticsButton",
    "settings.diagnosticsDescription",
    "settings.imageDownload",
    "settings.imageDownloadDescription",
    "settings.epubTagPage",
    "settings.epubTagPageDescription",
    "settings.relatedLinks",
    "settings.github",
    "settings.greasyFork",
    "settings.feedback",
    "settings.interfaceLanguage",
    "settings.interfaceLanguage.auto",
    "settings.interfaceLanguage.simplified",
    "settings.interfaceLanguage.traditional",
    "confirm.download.title",
    "confirm.download.cached",
    "confirm.download.empty",
    "confirm.imageSettings.title",
    "confirm.imageSettings.message",
    "confirm.imageSettings.continue",
    "download.progress",
    "download.status.stopped",
    "download.status.stopping",
    "download.status.initializing",
    "download.status.validatingCache",
    "download.status.preparingCache",
    "download.status.savingProgress",
    "download.status.checkingIntegrity",
    "download.status.preparingExport",
    "download.status.exportReady",
    "download.status.running",
    "download.status.runningProtected",
    "download.status.protectedTitle",
    "download.action.stopped",
    "download.action.stopping",
    "download.action.saving",
    "download.log.coverCacheHit",
    "download.log.coverCacheReadFailed",
    "download.log.coverCacheSaved",
    "download.log.coverCacheOwnershipLost",
    "download.log.coverCacheWriteFailed",
    "download.log.cacheRestored",
    "download.log.cacheRestoredInvalidated",
    "download.log.cacheWriteRetry",
    "download.log.chapterFetchFailed",
    "download.log.chapterProcessed",
    "download.log.chapterProcessedRetry",
    "download.log.chapterProcessedImages",
    "download.log.chapterProcessedImageFailures",
    "download.log.chapterSkippedNonSite",
    "download.log.integrityStarted",
    "download.log.integrityPassed",
    "download.log.integrityFailed",
    "download.log.integrityRetry",
    "download.log.missingRetry",
    "download.log.missingPlaceholder",
    "download.log.missingRetryStarted",
    "download.log.missingRetrySaved",
    "download.log.lockLost",
    "download.log.discardRequested",
    "download.log.cacheWriteStarted",
    "download.log.cancelledOwnershipLost",
    "download.log.cancelledDiscarded",
    "download.log.cancelledSaved",
    "download.log.cancelledSaveTimeout",
    "download.log.cancelledSaveFailed",
    "download.log.cacheRestoreStarted",
    "download.log.started",
    "download.log.mainFlush",
    "download.log.integrityFlush",
    "download.log.exportPreparing",
    "download.log.completed",
    "download.log.storageFailed",
    "download.log.discardFailed",
    "download.storage.quotaExceeded",
    "download.storage.ownershipLost",
    "download.storage.transactionAborted",
    "download.storage.databaseUnavailable",
    "download.storage.migrationFailed",
    "download.storage.flushTimeout",
    "download.storage.unknown",
    "download.terminal.reason",
    "download.terminal.code",
    "download.terminal.operation",
    "download.terminal.progressNotSaved.title",
    "download.terminal.progressNotSaved.message",
    "download.terminal.failed.title",
    "download.terminal.failed.message",
    "download.terminal.ownershipLost.title",
    "download.terminal.ownershipLost.message",
    "download.terminal.saveTimeout.title",
    "download.terminal.saveTimeout.message",
    "download.terminal.saveFailed.title",
    "download.terminal.saveFailed.message",
    "download.terminal.discardFailed.title",
    "download.terminal.discardFailed.message"
] as const;

export type LocaleKey = (typeof LOCALE_KEYS)[number];

/**
 * 简体中文文案
 */
export const ZH_CN_MESSAGES = Object.freeze({
    "common.confirm": "确认",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.minimize": "最小化",
    "common.infoTitle": "提示",
    "common.warningTitle": "请注意",
    "common.errorTitle": "操作失败",
    "common.viewDiagnostics": "查看诊断日志",
    "common.preparing": "准备中…",
    "common.retry": "重试",
    "common.skip": "跳过",
    "common.skipAll": "全部跳过",
    "common.loading": "加载中…",
    "button.downloadAll": "全本下载",
    "button.settings": "脚本设置",
    "settings.title": "脚本设置",
    "settings.versionUnknown": "版本未知",
    "settings.concurrency": "下载线程数（1-{max}）：",
    "settings.cache": "下载缓存",
    "settings.history": "下载记录",
    "settings.diagnostics": "诊断与反馈",
    "settings.diagnosticsButton": "诊断日志",
    "settings.diagnosticsDescription": "（用于导出问题排查信息）",
    "settings.imageDownload": "下载正文插图",
    "settings.imageDownloadDescription": "（会让速度变慢、体积变大）",
    "settings.epubTagPage": "生成 EPUB 标签页",
    "settings.epubTagPageDescription": "（关闭后标签仍会写入 EPUB 元数据）",
    "settings.relatedLinks": "相关链接",
    "settings.github": "GitHub 项目主页",
    "settings.greasyFork": "GreasyFork 脚本页",
    "settings.feedback": "反馈问题 / Issues",
    "settings.interfaceLanguage": "界面语言",
    "settings.interfaceLanguage.auto": "自动（跟随网站）",
    "settings.interfaceLanguage.simplified": "简体中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "confirm.download.title": "✔️ 确认下载",
    "confirm.download.cached": "检测到已有 {count} 章缓存，点击确认将跳过已下载章节继续下载。",
    "confirm.download.empty": "是否开始抓取该小说全部章节？",
    "confirm.imageSettings.title": "⚠️ 切换插图设置",
    "confirm.imageSettings.message":
        "当前有 {count} 个全本任务正在下载。它们会继续使用启动时的插图设置，不受本次切换影响；本次更改仅对之后新启动的任务生效。",
    "confirm.imageSettings.continue": "继续切换",
    "download.progress": "进度：{completed}/{total}",
    "download.status.stopped": "任务已停止",
    "download.status.stopping": "正在停止任务...",
    "download.status.initializing": "正在初始化下载任务...",
    "download.status.validatingCache": "正在校验本地缓存 ({count} 章)",
    "download.status.preparingCache": "正在准备本地缓存...",
    "download.status.savingProgress": "正在保存下载进度 ({ready}/{total})",
    "download.status.checkingIntegrity": "正在检查章节完整性 ({ready}/{total})",
    "download.status.preparingExport": "正在准备导出 ({ready}/{total})",
    "download.status.exportReady": "导出准备完成 ({ready}/{total})",
    "download.status.running": "全本下载 ({ready}/{total})",
    "download.status.runningProtected": "正文完成 {ready}/{total}｜密码待处理 {pending}｜正在抓取",
    "download.status.protectedTitle": "｜密码{pending}",
    "download.action.stopped": "已停止",
    "download.action.stopping": "正在停止...",
    "download.action.saving": "正在保存...",
    "download.log.coverCacheHit": "💾 已读取本地封面缓存",
    "download.log.coverCacheReadFailed": "⚠️ 封面缓存读取失败，将重新下载：{detail}",
    "download.log.coverCacheSaved": "💾 封面已写入本地缓存",
    "download.log.coverCacheOwnershipLost": "⚠️ 封面缓存写入权已失效，本次继续使用内存封面",
    "download.log.coverCacheWriteFailed": "⚠️ 封面缓存写入失败，本次继续使用内存封面：{detail}",
    "download.log.cacheRestored": "💾 已恢复 {count} 章缓存",
    "download.log.cacheRestoredInvalidated": "💾 已恢复 {count} 章缓存，{invalidatedCount} 章需要重新抓取",
    "download.log.cacheWriteRetry": "⚠️ 缓存写入失败，正在进行一次安全重试：{detail}",
    "download.log.chapterFetchFailed": "❌ 章节获取失败 ({title}): {detail}",
    "download.log.chapterProcessed": "✅ 抓取 ({completed}/{total}): {title}\nURL: {url}",
    "download.log.chapterProcessedRetry": "♻️ 补抓 ({completed}/{total}): {title}\nURL: {url}",
    "download.log.chapterProcessedImages": "{base} ({count} 张图片)\nURL: {url}",
    "download.log.chapterProcessedImageFailures": "{base} ({failed}/{total} 张图片获取失败)\nURL: {url}",
    "download.log.chapterSkippedNonSite": "⚠️ 跳过 ({completed}/{total})：{title} (非站内)",
    "download.log.integrityStarted": "正在进行章节完整性检查...",
    "download.log.integrityPassed": "✅ 完整性检查通过，无缺漏。",
    "download.log.integrityFailed": "⚠️ 发现 {count} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...",
    "download.log.integrityRetry": "补抓 [{index}/{total}] ({reason})...",
    "download.log.missingRetry": "再次补抓 [{index}/{total}] (缺失)...",
    "download.log.missingPlaceholder": "⚠️ 用户选择继续导出，{count} 个缺失章节将写入占位说明。",
    "download.log.missingRetryStarted": "正在再次补抓 {count} 个缺失章节...",
    "download.log.missingRetrySaved": "再次补抓完成，正在保存下载进度...",
    "download.log.lockLost": "下载任务锁已失效，跳过缓存写入。",
    "download.log.discardRequested": "停止请求要求清理缓存，将在释放任务锁前统一处理。",
    "download.log.cacheWriteStarted": "正在写入 IndexedDB...",
    "download.log.cancelledOwnershipLost": "任务锁已失效，当前任务已停止。",
    "download.log.cancelledDiscarded": "任务已停止，正在清理缓存。",
    "download.log.cancelledSaved": "任务已手动取消，进度已保存。",
    "download.log.cancelledSaveTimeout": "任务已停止，但进度保存超时，部分最新进度可能未保存。",
    "download.log.cancelledSaveFailed": "任务已手动取消，但缓存写入失败{detail}",
    "download.log.cacheRestoreStarted": "💾 读取到 {count} 章缓存，正在校验...",
    "download.log.started": "启动 {concurrency} 个并发线程...",
    "download.log.mainFlush": "主抓取完成，正在保存下载进度...",
    "download.log.integrityFlush": "完整性检查完成，正在保存下载进度...",
    "download.log.exportPreparing": "正在准备导出...",
    "download.log.completed": "✅ 所有任务处理完毕",
    "download.log.storageFailed": "❌ 下载进度未保存：{detail}",
    "download.log.discardFailed": "❌ 任务已停止，但缓存清理失败：{detail}",
    "download.storage.quotaExceeded": "浏览器存储空间不足",
    "download.storage.ownershipLost": "当前任务已失去缓存写入权",
    "download.storage.transactionAborted": "IndexedDB 事务意外中止",
    "download.storage.databaseUnavailable": "IndexedDB 当前不可用",
    "download.storage.migrationFailed": "旧版缓存迁移失败",
    "download.storage.flushTimeout": "缓存写入超时",
    "download.storage.unknown": "缓存存储发生未知错误",
    "download.terminal.reason": "原因",
    "download.terminal.code": "代码",
    "download.terminal.operation": "操作",
    "download.terminal.progressNotSaved.title": "下载进度未保存",
    "download.terminal.progressNotSaved.message": "下载任务已停止，本次新增进度可能未完整保存。请检查浏览器存储后重试。",
    "download.terminal.failed.title": "下载任务失败",
    "download.terminal.failed.message": "下载过程中发生异常，任务已停止。请重试；若问题持续，可打开诊断日志协助排查。",
    "download.terminal.ownershipLost.title": "任务已在其他页面接管",
    "download.terminal.ownershipLost.message": "当前页面已停止下载，且没有继续写入或清理缓存，以免覆盖其他页面的任务。",
    "download.terminal.saveTimeout.title": "进度保存超时",
    "download.terminal.saveTimeout.message": "任务已停止，但部分最新进度可能尚未保存。下次下载会从最后一次成功写入的缓存继续。",
    "download.terminal.saveFailed.title": "进度保存失败",
    "download.terminal.saveFailed.message": "任务已停止，但本次取消时未能确认进度已保存。下次下载会从最后一次成功写入的缓存继续。",
    "download.terminal.discardFailed.title": "缓存清理失败",
    "download.terminal.discardFailed.message": "任务已经停止，但原有下载缓存可能仍然保留。可稍后在缓存管理中重新清理。"
} satisfies Readonly<Record<LocaleKey, string>>);

/**
 * 繁體中文文案
 */
export const ZH_TW_MESSAGES = Object.freeze({
    "common.confirm": "確認",
    "common.cancel": "取消",
    "common.close": "關閉",
    "common.minimize": "最小化",
    "common.infoTitle": "提示",
    "common.warningTitle": "請注意",
    "common.errorTitle": "操作失敗",
    "common.viewDiagnostics": "查看診斷日誌",
    "common.preparing": "準備中…",
    "common.retry": "重試",
    "common.skip": "跳過",
    "common.skipAll": "全部跳過",
    "common.loading": "載入中…",
    "button.downloadAll": "全本下載",
    "button.settings": "腳本設定",
    "settings.title": "腳本設定",
    "settings.versionUnknown": "版本未知",
    "settings.concurrency": "下載執行緒數（1-{max}）：",
    "settings.cache": "下載快取",
    "settings.history": "下載記錄",
    "settings.diagnostics": "診斷與回饋",
    "settings.diagnosticsButton": "診斷日誌",
    "settings.diagnosticsDescription": "（用於匯出問題排查資訊）",
    "settings.imageDownload": "下載正文插圖",
    "settings.imageDownloadDescription": "（會讓速度變慢、體積變大）",
    "settings.epubTagPage": "產生 EPUB 標籤頁",
    "settings.epubTagPageDescription": "（關閉後標籤仍會寫入 EPUB 元資料）",
    "settings.relatedLinks": "相關連結",
    "settings.github": "GitHub 專案首頁",
    "settings.greasyFork": "GreasyFork 腳本頁",
    "settings.feedback": "回報問題 / Issues",
    "settings.interfaceLanguage": "介面語言",
    "settings.interfaceLanguage.auto": "自動（跟隨網站）",
    "settings.interfaceLanguage.simplified": "簡體中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "confirm.download.title": "✔️ 確認下載",
    "confirm.download.cached": "偵測到已有 {count} 章快取，點擊確認將跳過已下載章節繼續下載。",
    "confirm.download.empty": "是否開始抓取此小說全部章節？",
    "confirm.imageSettings.title": "⚠️ 切換插圖設定",
    "confirm.imageSettings.message":
        "目前有 {count} 個全本任務正在下載。它們會繼續使用啟動時的插圖設定，不受本次切換影響；本次變更僅對之後新啟動的任務生效。",
    "confirm.imageSettings.continue": "繼續切換",
    "download.progress": "進度：{completed}/{total}",
    "download.status.stopped": "任務已停止",
    "download.status.stopping": "正在停止任務...",
    "download.status.initializing": "正在初始化下載任務...",
    "download.status.validatingCache": "正在驗證本機快取（{count} 章）",
    "download.status.preparingCache": "正在準備本機快取...",
    "download.status.savingProgress": "正在儲存下載進度（{ready}/{total}）",
    "download.status.checkingIntegrity": "正在檢查章節完整性（{ready}/{total}）",
    "download.status.preparingExport": "正在準備匯出（{ready}/{total}）",
    "download.status.exportReady": "匯出準備完成（{ready}/{total}）",
    "download.status.running": "全本下載（{ready}/{total}）",
    "download.status.runningProtected": "正文完成 {ready}/{total}｜密碼待處理 {pending}｜正在抓取",
    "download.status.protectedTitle": "｜密碼{pending}",
    "download.action.stopped": "已停止",
    "download.action.stopping": "正在停止...",
    "download.action.saving": "正在儲存...",
    "download.log.coverCacheHit": "💾 已讀取本機封面快取",
    "download.log.coverCacheReadFailed": "⚠️ 封面快取讀取失敗，將重新下載：{detail}",
    "download.log.coverCacheSaved": "💾 封面已寫入本機快取",
    "download.log.coverCacheOwnershipLost": "⚠️ 封面快取寫入權已失效，本次繼續使用記憶體封面",
    "download.log.coverCacheWriteFailed": "⚠️ 封面快取寫入失敗，本次繼續使用記憶體封面：{detail}",
    "download.log.cacheRestored": "💾 已恢復 {count} 章快取",
    "download.log.cacheRestoredInvalidated": "💾 已恢復 {count} 章快取，{invalidatedCount} 章需要重新抓取",
    "download.log.cacheWriteRetry": "⚠️ 快取寫入失敗，正在進行一次安全重試：{detail}",
    "download.log.chapterFetchFailed": "❌ 章節取得失敗（{title}）：{detail}",
    "download.log.chapterProcessed": "✅ 抓取（{completed}/{total}）：{title}\nURL: {url}",
    "download.log.chapterProcessedRetry": "♻️ 補抓（{completed}/{total}）：{title}\nURL: {url}",
    "download.log.chapterProcessedImages": "{base}（{count} 張圖片）\nURL: {url}",
    "download.log.chapterProcessedImageFailures": "{base}（{failed}/{total} 張圖片取得失敗）\nURL: {url}",
    "download.log.chapterSkippedNonSite": "⚠️ 跳過（{completed}/{total}）：{title}（非站內）",
    "download.log.integrityStarted": "正在進行章節完整性檢查...",
    "download.log.integrityPassed": "✅ 完整性檢查通過，無缺漏。",
    "download.log.integrityFailed": "⚠️ 發現 {count} 個章節不完整（缺失或含失敗圖片），嘗試自動補抓...",
    "download.log.integrityRetry": "補抓 [{index}/{total}]（{reason}）...",
    "download.log.missingRetry": "再次補抓 [{index}/{total}]（缺失）...",
    "download.log.missingPlaceholder": "⚠️ 使用者選擇繼續匯出，{count} 個缺失章節將寫入佔位說明。",
    "download.log.missingRetryStarted": "正在再次補抓 {count} 個缺失章節...",
    "download.log.missingRetrySaved": "再次補抓完成，正在儲存下載進度...",
    "download.log.lockLost": "下載任務鎖已失效，跳過快取寫入。",
    "download.log.discardRequested": "停止要求清理快取，將在釋放任務鎖前統一處理。",
    "download.log.cacheWriteStarted": "正在寫入 IndexedDB...",
    "download.log.cancelledOwnershipLost": "任務鎖已失效，目前任務已停止。",
    "download.log.cancelledDiscarded": "任務已停止，正在清理快取。",
    "download.log.cancelledSaved": "任務已手動取消，進度已儲存。",
    "download.log.cancelledSaveTimeout": "任務已停止，但進度儲存逾時，部分最新進度可能未儲存。",
    "download.log.cancelledSaveFailed": "任務已手動取消，但快取寫入失敗{detail}",
    "download.log.cacheRestoreStarted": "💾 讀取到 {count} 章快取，正在驗證...",
    "download.log.started": "啟動 {concurrency} 個並行執行緒...",
    "download.log.mainFlush": "主要抓取完成，正在儲存下載進度...",
    "download.log.integrityFlush": "完整性檢查完成，正在儲存下載進度...",
    "download.log.exportPreparing": "正在準備匯出...",
    "download.log.completed": "✅ 所有任務處理完畢",
    "download.log.storageFailed": "❌ 下載進度未儲存：{detail}",
    "download.log.discardFailed": "❌ 任務已停止，但快取清理失敗：{detail}",
    "download.storage.quotaExceeded": "瀏覽器儲存空間不足",
    "download.storage.ownershipLost": "目前任務已失去快取寫入權",
    "download.storage.transactionAborted": "IndexedDB 交易意外中止",
    "download.storage.databaseUnavailable": "IndexedDB 目前無法使用",
    "download.storage.migrationFailed": "舊版快取遷移失敗",
    "download.storage.flushTimeout": "快取寫入逾時",
    "download.storage.unknown": "快取儲存發生未知錯誤",
    "download.terminal.reason": "原因",
    "download.terminal.code": "代碼",
    "download.terminal.operation": "操作",
    "download.terminal.progressNotSaved.title": "下載進度未儲存",
    "download.terminal.progressNotSaved.message": "下載任務已停止，本次新增進度可能未完整儲存。請檢查瀏覽器儲存後重試。",
    "download.terminal.failed.title": "下載任務失敗",
    "download.terminal.failed.message": "下載過程發生異常，任務已停止。請重試；若問題持續，可開啟診斷日誌協助排查。",
    "download.terminal.ownershipLost.title": "任務已由其他頁面接管",
    "download.terminal.ownershipLost.message": "目前頁面已停止下載，且沒有繼續寫入或清理快取，以免覆蓋其他頁面的任務。",
    "download.terminal.saveTimeout.title": "進度儲存逾時",
    "download.terminal.saveTimeout.message": "任務已停止，但部分最新進度可能尚未儲存。下次下載會從最後一次成功寫入的快取繼續。",
    "download.terminal.saveFailed.title": "進度儲存失敗",
    "download.terminal.saveFailed.message": "任務已停止，但本次取消時未能確認進度已儲存。下次下載會從最後一次成功寫入的快取繼續。",
    "download.terminal.discardFailed.title": "快取清理失敗",
    "download.terminal.discardFailed.message": "任務已經停止，但原有下載快取可能仍然保留。可稍後在快取管理中重新清理。"
} satisfies Readonly<Record<LocaleKey, string>>);

export const LOCALE_CATALOGS: LocaleCatalogs = Object.freeze({
    "zh-CN": ZH_CN_MESSAGES,
    "zh-TW": ZH_TW_MESSAGES
});

const LOCALE_PARAMETER_PATTERN = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export class MissingLocaleMessageError extends Error {
    readonly locale: InterfaceLocale;
    readonly key: string;

    constructor(locale: InterfaceLocale, key: string) {
        super(`Missing locale message: ${locale}.${key}`);
        this.name = "MissingLocaleMessageError";
        this.locale = locale;
        this.key = key;
    }
}

export class MissingLocaleParameterError extends Error {
    readonly key: string;
    readonly parameter: string;

    constructor(key: string, parameter: string) {
        super(`Missing locale message parameter: ${key}.{${parameter}}`);
        this.name = "MissingLocaleParameterError";
        this.key = key;
        this.parameter = parameter;
    }
}

export class IncompleteLocaleCatalogError extends Error {
    readonly missing: Readonly<Record<InterfaceLocale, readonly string[]>>;

    constructor(missing: Readonly<Record<InterfaceLocale, readonly string[]>>) {
        const details = (Object.entries(missing) as Array<[InterfaceLocale, readonly string[]]>)
            .filter(([, keys]) => keys.length > 0)
            .map(([locale, keys]) => `${locale}: ${keys.join(", ")}`)
            .join("; ");
        super(`Incomplete locale catalog: ${details}`);
        this.name = "IncompleteLocaleCatalogError";
        this.missing = missing;
    }
}

/**
 * 检查字典缺失的稳定键
 */
export function findMissingLocaleKeys(
    catalogs: LocaleCatalogs,
    expectedKeys: readonly string[] = LOCALE_KEYS
): Readonly<Record<InterfaceLocale, readonly string[]>> {
    return {
        "zh-CN": expectedKeys.filter((key) => !(key in catalogs["zh-CN"])),
        "zh-TW": expectedKeys.filter((key) => !(key in catalogs["zh-TW"]))
    };
}

/**
 * 断言字典包含完整稳定键
 */
export function assertLocaleCatalogsComplete(
    catalogs: LocaleCatalogs = LOCALE_CATALOGS,
    expectedKeys: readonly string[] = LOCALE_KEYS
): void {
    const missing = findMissingLocaleKeys(catalogs, expectedKeys);
    if (missing["zh-CN"].length > 0 || missing["zh-TW"].length > 0) {
        throw new IncompleteLocaleCatalogError(missing);
    }
}

/**
 * 替换文案参数
 */
export function interpolateLocaleMessage(key: string, template: string, params: LocaleMessageParams = {}): string {
    return template.replace(LOCALE_PARAMETER_PATTERN, (_placeholder, parameter: string) => {
        if (!Object.prototype.hasOwnProperty.call(params, parameter)) {
            throw new MissingLocaleParameterError(key, parameter);
        }
        return String(params[parameter]);
    });
}

/**
 * 生成指定语言的文案
 */
export function translate(locale: InterfaceLocale, key: LocaleKey, params?: LocaleMessageParams): string {
    const message = LOCALE_CATALOGS[locale][key];
    if (message === undefined) {
        throw new MissingLocaleMessageError(locale, key);
    }
    return interpolateLocaleMessage(key, message, params);
}
