import type { DownloadTask } from "./contracts";

/**
 * 原书章节选择使用 0-based 闭区间，由计划统一转换界面和持久化摘要
 */
export interface DownloadSelection {
    mode: "all" | "range";
    sourceTotalChapters: number;
    startIndex: number;
    endIndex: number;
}

export interface DownloadSelectionSummary {
    mode: "all" | "range";
    sourceTotalChapters: number;
    startChapter: number;
    endChapter: number;
}

interface DownloadPlanInput {
    tasks: readonly DownloadTask[];
    selection?: DownloadSelection;
}

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
    const normalized = normalizeSelection(selection);
    validateSourceTasks(sourceTasks, normalized.sourceTotalChapters);
    return sourceTasks.filter((task) => task.index >= normalized.startIndex && task.index <= normalized.endIndex);
}

/**
 * 规范化可选选择参数，并验证任务顺序和选择边界一致
 */
export function resolveDownloadSelection(options: DownloadPlanInput): DownloadSelection {
    const { tasks } = options;
    const selection =
        options.selection ||
        ({
            mode: "all",
            sourceTotalChapters: tasks.length,
            startIndex: 0,
            endIndex: tasks.length - 1
        } satisfies DownloadSelection);

    const normalized = normalizeSelection(selection);
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
    return normalized;
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

function normalizeSelection(selection: DownloadSelection): DownloadSelection {
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
    return createRangeSelection(selection.startIndex + 1, selection.endIndex + 1, selection.sourceTotalChapters);
}

/**
 * 由统一选择规则生成原书章序摘要，供诊断、导出和历史使用
 */
export function createDownloadSelectionSummary(selection: DownloadSelection): DownloadSelectionSummary {
    const normalized = normalizeSelection(selection);
    return {
        mode: normalized.mode,
        sourceTotalChapters: normalized.sourceTotalChapters,
        startChapter: normalized.startIndex + 1,
        endChapter: normalized.endIndex + 1
    };
}

/**
 * 固定输出章节集合与绝对索引视图；恢复和补抓只改变实际请求对象
 */
export function createDownloadPlan(input: DownloadPlanInput) {
    const selection = Object.freeze(resolveDownloadSelection(input));
    const tasks = Object.freeze([...input.tasks]);
    const indexes: ReadonlySet<number> = new Set(tasks.map((task) => task.index));
    const taskOrderByIndex: ReadonlyMap<number, number> = new Map(tasks.map((task, order) => [task.index, order]));
    return {
        tasks,
        selection,
        summary: Object.freeze(createDownloadSelectionSummary(selection)),
        retainCacheOnSuccess: selection.mode === "range",
        indexes,
        taskOrderByIndex,
        readyCount(chapters: Pick<ReadonlySet<number>, "has">): number {
            let count = 0;
            for (const task of tasks) {
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
            return { index: order + 1, sourceIndex: task.index + 1, total: tasks.length };
        }
    };
}
export type DownloadPlan = ReturnType<typeof createDownloadPlan>;
