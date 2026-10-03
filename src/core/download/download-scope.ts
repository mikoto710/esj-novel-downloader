import type { CacheMeta, Chapter } from "../../types";
import type { DownloadEnvironmentPort, DownloadOptions, DownloadTask } from "./contracts";
import { resolveDownloadSelection } from "./selection";

/**
 * 固定本次范围；章节索引始终沿用原书位置
 */
export function createDownloadScope(options: DownloadOptions, environment: DownloadEnvironmentPort) {
    const selection = resolveDownloadSelection(options);
    const indexes = new Set(options.tasks.map((task) => task.index));
    const taskOrderByIndex = new Map(options.tasks.map((task, order) => [task.index, order]));
    const meta: CacheMeta = {
        bookId: options.bookId,
        bookName: options.bookName,
        rawBookName: options.rawBookName || options.bookName,
        author: options.author || "未知作者",
        pageUrl: options.pageUrl || environment.currentUrl(),
        totalChapters: selection.sourceTotalChapters,
        sourcePageType: options.sourcePageType || "unknown",
        imageEnabled: options.imageEnabled,
        updatedAt: environment.now()
    };
    return {
        options,
        selection,
        indexes,
        taskOrderByIndex,
        meta,
        readyCount(chapters: ReadonlyMap<number, Chapter>): number {
            let count = 0;
            for (const task of options.tasks) {
                if (chapters.has(task.index)) {
                    count++;
                }
            }
            return count;
        },
        position(task: DownloadTask) {
            const order = taskOrderByIndex.get(task.index);
            if (order === undefined) {
                throw new Error(`selection-task-mismatch: ${task.index}`);
            }
            return { index: order + 1, sourceIndex: task.index + 1, total: options.tasks.length };
        }
    };
}
export type DownloadScope = ReturnType<typeof createDownloadScope>;
