import { createBrowserDownloadDependencies } from "../../adapters/browser-download-dependencies";
import { runDownload } from "./coordinator";
import type { DownloadOptions } from "./contracts";

/**
 * 全本下载的浏览器组合入口
 * download 核心包中仅此文件允许创建 browser dependencies，实际业务流程位于 coordinator
 */
export async function batchDownload(options: DownloadOptions): Promise<void> {
    await runDownload(options, createBrowserDownloadDependencies());
}
