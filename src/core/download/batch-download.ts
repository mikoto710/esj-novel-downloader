import { batchDownload as download } from "../../adapters/batch-download";
import { setCachedData } from "../state";
import { showFormatChoice } from "../../ui/popups";
import type { DownloadOptions } from "./contracts";

/**
 * 兼容尚未迁移到统一入口的页面调用
 */
export async function batchDownload(options: DownloadOptions): Promise<void> {
    const result = await download(options);
    if (result.status === "ready") {
        setCachedData(result.data);
        showFormatChoice(result.data);
    }
}
