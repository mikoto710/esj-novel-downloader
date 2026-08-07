import type { StorageFailure } from "../core/cache/storage-error";
import type { DownloadLog } from "../core/download/contracts";

function value(message: DownloadLog, key: string, fallback = ""): string {
    const entry = message.params?.[key];
    return entry === undefined ? fallback : String(entry);
}

const STORAGE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
    "quota-exceeded": "浏览器存储空间不足",
    "ownership-lost": "当前任务已失去缓存写入权",
    "transaction-aborted": "IndexedDB 事务意外中止",
    "database-unavailable": "IndexedDB 当前不可用",
    "migration-failed": "旧版缓存迁移失败",
    "flush-timeout": "缓存写入超时",
    "unknown-storage-error": "缓存存储发生未知错误"
};

function formatStorageFailureText(reason: string, detail = ""): string {
    const summary = STORAGE_FAILURE_MESSAGES[reason] || reason;
    return detail && detail !== summary ? `${summary}：${detail}` : summary;
}

export function formatStorageFailure(failure: StorageFailure): string {
    const detail = typeof failure.params?.detail === "string" ? failure.params.detail : "";
    return formatStorageFailureText(failure.reason, detail);
}

function storageFailureText(message: DownloadLog): string {
    return formatStorageFailureText(value(message, "reason"), value(message, "detail"));
}

function chapterPosition(message: DownloadLog): string {
    return `[${value(message, "index")}/${value(message, "total")}]`;
}

function chapterTitle(message: DownloadLog): string {
    return `${chapterPosition(message)}：${value(message, "title")}`;
}

function formatChapterProcessed(message: DownloadLog): string {
    const prefix = message.params?.retry ? "♻️ 补抓" : "✅ 抓取";
    const base = `${prefix} (${value(message, "completed")}/${value(message, "total")}): ${value(message, "title")}`;
    if (message.code === "chapter-processed-with-image-failures") {
        const imageErrors = Number(message.params?.imageErrors || 0);
        const imageCount = Number(message.params?.imageCount || 0);
        return `${base} (${imageErrors}/${imageCount + imageErrors} 张图片获取失败)\nURL: ${value(message, "url")}`;
    }
    if (message.code === "chapter-processed-with-images") {
        return `${base} (${value(message, "imageCount")} 张图片)\nURL: ${value(message, "url")}`;
    }
    return `${base}\nURL: ${value(message, "url")}`;
}

function formatIntegrityRetry(message: DownloadLog): string {
    const reason = value(message, "reason");
    const suffix =
        reason === "missing"
            ? "缺失"
            : reason === "invalid-image-media-type"
              ? "图片格式无效"
              : `图片失败 ${value(message, "imageErrors")} 张`;
    return `补抓 [${value(message, "index")}/${value(message, "total")}] (${suffix})...`;
}

function formatCancellation(message: DownloadLog): string {
    const outcome = value(message, "outcome");
    if (outcome === "ownership-lost") {
        return "任务锁已失效，当前任务已停止。";
    }
    if (outcome === "discarded") {
        return "任务已停止，正在清理缓存。";
    }
    if (outcome === "saved") {
        return "任务已手动取消，进度已保存。";
    }
    if (outcome === "save-timed-out") {
        return "任务已停止，但进度保存超时，部分最新进度可能未保存。";
    }
    const detail = value(message, "detail");
    return detail ? `任务已手动取消，但缓存写入失败：${detail}` : "任务已手动取消，但缓存写入失败。";
}

/**
 * 暂时将无语言核心日志映射为现有界面文案，后续由 locale 字典替换
 */
export function formatDownloadLog(message: DownloadLog): string {
    switch (message.code) {
        case "cover-cache-hit":
            return "💾 已读取本地封面缓存";
        case "cover-cache-read-failed":
            return `⚠️ 封面缓存读取失败，将重新下载：${value(message, "message") || value(message, "detail")}`;
        case "cover-cache-saved":
            return "💾 封面已写入本地缓存";
        case "cover-cache-write-ownership-lost":
            return "⚠️ 封面缓存写入权已失效，本次继续使用内存封面";
        case "cover-cache-write-failed":
            return `⚠️ 封面缓存写入失败，本次继续使用内存封面：${value(message, "message") || value(message, "detail")}`;
        case "restored-mapping-font-invalid":
            return `⚠️ 旧缓存映射字体无效，将重新抓取 (${value(message, "title")}): ${value(message, "detail")}`;
        case "cache-restored":
            return `💾 已恢复 ${value(message, "count")} 章缓存`;
        case "cache-restored-with-invalidated":
            return `💾 已恢复 ${value(message, "count")} 章缓存，${value(message, "invalidatedCount")} 章需要重新抓取`;
        case "cache-write-retry":
            return `⚠️ 缓存写入失败，正在进行一次安全重试：${storageFailureText(message)}`;
        case "chapter-fetch-failed":
            return `❌ 章节获取失败 (${value(message, "title")}): ${value(message, "detail")}`;
        case "chapter-mapping-font-failed":
            return `❌ 映射字体解析失败: ${value(message, "detail")} (${value(message, "title")})`;
        case "chapter-processed":
        case "chapter-processed-with-images":
        case "chapter-processed-with-image-failures":
            return formatChapterProcessed(message);
        case "chapter-skipped-non-site":
            return `⚠️ 跳过 (${value(message, "completed")}/${value(message, "total")})：${value(message, "title")} (非站内)`;
        case "protected-chapter-retry-skipped":
            return `⏭ 本轮补抓已跳过密码章节 ${chapterTitle(message)}`;
        case "protected-chapter-redetected":
            return `🔒 补抓再次发现密码章节 ${chapterTitle(message)}`;
        case "protected-chapter-queued":
            return `🔒 发现密码章节 ${chapterTitle(message)}，已加入等待队列。`;
        case "protected-chapter-skipped":
            return `⏭ 已跳过密码章节 ${chapterTitle(message)}`;
        case "protected-chapter-connection-retry":
            return `⚠️ 密码章节连接失败，正在进行一次技术重试 ${chapterTitle(message)}`;
        case "protected-chapter-connection-failed":
            return `❌ 密码章节连接失败 ${chapterTitle(message)}`;
        case "protected-chapter-password-rejected":
            return `⚠️ 密码不正确 ${chapterTitle(message)}`;
        case "protected-chapter-protocol-failed":
            return `❌ 密码章节授权响应异常 ${chapterTitle(message)}`;
        case "protected-chapter-unlocked":
            return `🔓 密码章节解锁完成 ${chapterTitle(message)}`;
        case "integrity-check-started":
            return "正在进行章节完整性检查...";
        case "integrity-check-passed":
            return "✅ 完整性检查通过，无缺漏。";
        case "integrity-check-failed":
            return `⚠️ 发现 ${value(message, "count")} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...`;
        case "chapter-integrity-retry":
            return formatIntegrityRetry(message);
        case "missing-chapter-retry":
            return `再次补抓 [${value(message, "index")}/${value(message, "total")}] (缺失)...`;
        case "missing-chapter-export-with-placeholders":
            return `⚠️ 用户选择继续导出，${value(message, "count")} 个缺失章节将写入占位说明。`;
        case "missing-chapter-retry-started":
            return `正在再次补抓 ${value(message, "count")} 个缺失章节...`;
        case "missing-chapter-retry-saved":
            return "再次补抓完成，正在保存下载进度...";
        case "cancellation-cache-write-skipped-lock-lost":
            return "下载任务锁已失效，跳过缓存写入。";
        case "cancellation-cache-discard-requested":
            return "停止请求要求清理缓存，将在释放任务锁前统一处理。";
        case "cancellation-cache-write-started":
            return "正在写入 IndexedDB...";
        case "cancellation-finished":
            return formatCancellation(message);
        case "cache-restore-started":
            return `💾 读取到 ${value(message, "count")} 章缓存，正在校验...`;
        case "download-started":
            return `启动 ${value(message, "concurrency")} 个并发线程...`;
        case "download-main-flush-started":
            return "主抓取完成，正在保存下载进度...";
        case "download-integrity-flush-started":
            return "完整性检查完成，正在保存下载进度...";
        case "export-preparation-started":
            return "正在准备导出...";
        case "download-completed":
            return "✅ 所有任务处理完毕";
        case "download-storage-failed":
            return `❌ 下载进度未保存：${storageFailureText(message)}`;
        case "cache-discard-failed":
            return `❌ 任务已停止，但缓存清理失败：${storageFailureText(message)}`;
        default:
            return `${message.code}${message.params ? ` ${JSON.stringify(message.params)}` : ""}`;
    }
}
