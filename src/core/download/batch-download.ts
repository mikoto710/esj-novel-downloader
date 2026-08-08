import { createBrowserDownloadDependencies } from "../../adapters/browser-download-dependencies";
import { runDownload } from "./coordinator";
import type { DownloadOptions } from "./contracts";

/**
 * 使用浏览器依赖启动一次全本下载
 */
export async function batchDownload(options: DownloadOptions): Promise<void> {
    // 浏览器能力只在组合入口创建，业务流程由 coordinator 执行
    await runDownload(options, createBrowserDownloadDependencies());
}
