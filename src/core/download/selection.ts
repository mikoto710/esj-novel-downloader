import type { DownloadOptions, DownloadSelection, DownloadTask } from "./contracts";

export type DownloadSelectionErrorCode =
    | "selection-total-invalid"
    | "selection-range-invalid"
    | "selection-task-order-invalid"
    | "selection-task-mismatch";

export class DownloadSelectionError extends Error {
    constructor(readonly code: DownloadSelectionErrorCode) {
        super(code);
        this.name = "DownloadSelectionError";
    }
}

/**
 * 将用户输入的 1-based 闭区间转换为核心使用的选择契约
 */
export function createRangeSelection(
    startChapter: number,
    endChapter: number,
    sourceTotalChapters: number
): DownloadSelection {
    if (!Number.isInteger(sourceTotalChapters) || sourceTotalChapters < 1) {
        throw new DownloadSelectionError("selection-total-invalid");
    }
    if (
        !Number.isInteger(startChapter) ||
        !Number.isInteger(endChapter) ||
        startChapter < 1 ||
        endChapter < startChapter ||
        endChapter > sourceTotalChapters
    ) {
        throw new DownloadSelectionError("selection-range-invalid");
    }
    return {
        mode: startChapter === 1 && endChapter === sourceTotalChapters ? "all" : "range",
        sourceTotalChapters,
        startIndex: startChapter - 1,
        endIndex: endChapter - 1
    };
}

/**
 * 按绝对章节索引选择任务，禁止重排缓存键
 */
export function selectDownloadTasks(
    sourceTasks: readonly DownloadTask[],
    selection: DownloadSelection
): DownloadTask[] {
    validateSourceTasks(sourceTasks, selection.sourceTotalChapters);
    return sourceTasks.filter((task) => task.index >= selection.startIndex && task.index <= selection.endIndex);
}

/**
 * 规范化可选选择参数，并验证任务顺序和选择边界一致
 */
export function resolveDownloadSelection(options: Pick<DownloadOptions, "tasks" | "selection">): DownloadSelection {
    const { tasks } = options;
    const selection =
        options.selection ||
        ({
            mode: "all",
            sourceTotalChapters: tasks.length,
            startIndex: 0,
            endIndex: tasks.length - 1
        } satisfies DownloadSelection);

    if (!Number.isInteger(selection.sourceTotalChapters) || selection.sourceTotalChapters < 1) {
        throw new DownloadSelectionError("selection-total-invalid");
    }
    if (
        !Number.isInteger(selection.startIndex) ||
        !Number.isInteger(selection.endIndex) ||
        selection.startIndex < 0 ||
        selection.endIndex < selection.startIndex ||
        selection.endIndex >= selection.sourceTotalChapters
    ) {
        throw new DownloadSelectionError("selection-range-invalid");
    }
    if (
        selection.mode === "all" &&
        (selection.startIndex !== 0 || selection.endIndex !== selection.sourceTotalChapters - 1)
    ) {
        throw new DownloadSelectionError("selection-range-invalid");
    }
    if (tasks.length !== selection.endIndex - selection.startIndex + 1) {
        throw new DownloadSelectionError("selection-task-mismatch");
    }
    tasks.forEach((task, order) => {
        if (!Number.isInteger(task.index) || (order > 0 && task.index <= tasks[order - 1].index)) {
            throw new DownloadSelectionError("selection-task-order-invalid");
        }
    });
    tasks.forEach((task, order) => {
        if (task.index !== selection.startIndex + order) {
            throw new DownloadSelectionError("selection-task-mismatch");
        }
    });
    return selection;
}

function validateSourceTasks(tasks: readonly DownloadTask[], sourceTotalChapters: number): void {
    if (tasks.length !== sourceTotalChapters) {
        throw new DownloadSelectionError("selection-task-mismatch");
    }
    tasks.forEach((task, order) => {
        if (!Number.isInteger(task.index) || task.index !== order) {
            throw new DownloadSelectionError(
                order > 0 && task.index <= tasks[order - 1].index
                    ? "selection-task-order-invalid"
                    : "selection-task-mismatch"
            );
        }
    });
}
