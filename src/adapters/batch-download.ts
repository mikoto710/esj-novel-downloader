import { createBrowserDownloadDependencies, type BrowserDownloadTask } from "./browser-download-dependencies";
import { runDownload } from "../core/download/coordinator";
import type { DownloadOptions, DownloadResult } from "../core/download/contracts";

/**
 * 装配浏览器能力并返回本次下载结果
 */
export function batchDownload(options: DownloadOptions, task: BrowserDownloadTask): Promise<DownloadResult> {
    return runDownload(options, createBrowserDownloadDependencies(task));
}
