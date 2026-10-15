import type { DownloadTask } from "./contracts";

/**
 * 固定的原书索引集合，规范化后唯一、升序且非空
 */
export interface ChapterSelection {
    mode: "all" | "selected";
    sourceTotalChapters: number;
    indexes: readonly number[];
}

/**
 * 快照与持久记录共用的选择摘要，区间位置从 1 开始并包含两端
 */
export interface ChapterSelectionSummary {
    version: 2;
    mode: ChapterSelection["mode"];
    sourceTotalChapters: number;
    selectedCount: number;
    ranges: readonly Readonly<{ startChapter: number; endChapter: number }>[];
}

export type DownloadSelection = ChapterSelection;

export type DownloadSelectionSummary = ChapterSelectionSummary;

/**
 * 旧输入只在规范化入口接收，不能直接作为新任务的固定计划
 */
export interface LegacyDownloadSelection {
    mode: "all" | "range";
    sourceTotalChapters: number;
    startIndex: number;
    endIndex: number;
}

/**
 * 旧版持久摘要使用从 1 开始的闭区间，仅在读取时兼容
 */
export interface LegacyDownloadSelectionSummary {
    mode: "all" | "range";
    sourceTotalChapters: number;
    startChapter: number;
    endChapter: number;
}

export type DownloadSelectionInput = ChapterSelection | LegacyDownloadSelection;

export type StoredDownloadSelectionSummary = ChapterSelectionSummary | LegacyDownloadSelectionSummary;

interface DownloadPlanInput {
    tasks: readonly DownloadTask[];
    selection?: DownloadSelectionInput;
}

export type DownloadSelectionErrorCode =
    | "selection-total-invalid"
    | "selection-range-invalid"
    | "selection-indexes-invalid"
    | "selection-task-order-invalid"
    | "selection-task-mismatch";

export class DownloadSelectionError extends Error {
    constructor(readonly code: DownloadSelectionErrorCode) {
        super(code);
        this.name = "DownloadSelectionError";
    }
}

function validTotal(total: number): boolean {
    return Number.isSafeInteger(total) && total > 0;
}

/**
 * 校验并复制原书索引；选择整个目录时统一使用全本成功策略
 */
export function createChapterSelection(indexes: readonly number[], sourceTotalChapters: number): ChapterSelection {
    if (!validTotal(sourceTotalChapters)) {
        throw new DownloadSelectionError("selection-total-invalid");
    }
    if (
        !Array.isArray(indexes) ||
        !indexes.length ||
        Array.from(indexes).some((index) => !Number.isSafeInteger(index) || index < 0 || index >= sourceTotalChapters)
    ) {
        throw new DownloadSelectionError("selection-indexes-invalid");
    }
    const normalized = Object.freeze([...new Set(indexes)].sort((left, right) => left - right));
    return Object.freeze({
        mode: normalized.length === sourceTotalChapters ? "all" : "selected",
        sourceTotalChapters,
        indexes: normalized
    });
}

/**
 * 将界面的 1-based 连续闭区间转换为同一章节集合
 */
export function createRangeSelection(
    startChapter: number,
    endChapter: number,
    sourceTotalChapters: number
): ChapterSelection {
    if (!validTotal(sourceTotalChapters)) {
        throw new DownloadSelectionError("selection-total-invalid");
    }
    if (
        !Number.isSafeInteger(startChapter) ||
        !Number.isSafeInteger(endChapter) ||
        startChapter < 1 ||
        endChapter < startChapter ||
        endChapter > sourceTotalChapters
    ) {
        throw new DownloadSelectionError("selection-range-invalid");
    }
    return createChapterSelection(
        Array.from({ length: endChapter - startChapter + 1 }, (_, offset) => startChapter - 1 + offset),
        sourceTotalChapters
    );
}

function normalizeSelection(selection: DownloadSelectionInput): ChapterSelection {
    if ("indexes" in selection) {
        return createChapterSelection(selection.indexes, selection.sourceTotalChapters);
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
 * 从完整目录选出原任务，保留绝对索引和目录顺序
 */
export function selectDownloadTasks(
    sourceTasks: readonly DownloadTask[],
    selection: DownloadSelectionInput
): DownloadTask[] {
    const normalized = normalizeSelection(selection);
    if (
        sourceTasks.length !== normalized.sourceTotalChapters ||
        sourceTasks.some((task, index) => task.index !== index)
    ) {
        throw new DownloadSelectionError("selection-task-order-invalid");
    }
    const indexes = new Set(normalized.indexes);
    return sourceTasks.filter((task) => indexes.has(task.index));
}

/**
 * 校验任务与选中集合逐项一致，允许绝对索引之间存在间隔
 */
export function resolveDownloadSelection(options: DownloadPlanInput): ChapterSelection {
    const selection = options.selection
        ? normalizeSelection(options.selection)
        : createRangeSelection(1, options.tasks.length, options.tasks.length);
    if (options.tasks.length !== selection.indexes.length) {
        throw new DownloadSelectionError("selection-task-mismatch");
    }
    if (
        options.tasks.some(
            (task, order) =>
                !Number.isSafeInteger(task.index) || (order > 0 && task.index <= options.tasks[order - 1].index)
        )
    ) {
        throw new DownloadSelectionError("selection-task-order-invalid");
    }
    if (options.tasks.some((task, order) => task.index !== selection.indexes[order])) {
        throw new DownloadSelectionError("selection-task-mismatch");
    }
    return selection;
}

function freezeSummary(total: number, ranges: { startChapter: number; endChapter: number }[]): ChapterSelectionSummary {
    const selectedCount = ranges.reduce((count, range) => count + range.endChapter - range.startChapter + 1, 0);
    return Object.freeze({
        version: 2,
        mode: selectedCount === total ? "all" : "selected",
        sourceTotalChapters: total,
        selectedCount,
        ranges: Object.freeze(ranges.map((range) => Object.freeze(range)))
    });
}

/**
 * 将相邻索引压缩为区间，摘要与计划共享同一全本判定
 */
export function summarizeChapterSelection(selection: ChapterSelection): ChapterSelectionSummary {
    const normalized = createChapterSelection(selection.indexes, selection.sourceTotalChapters);
    const ranges: { startChapter: number; endChapter: number }[] = [];
    for (const index of normalized.indexes) {
        const previous = ranges.at(-1);
        if (previous && previous.endChapter === index) {
            previous.endChapter = index + 1;
        } else {
            ranges.push({ startChapter: index + 1, endChapter: index + 1 });
        }
    }
    return freezeSummary(normalized.sourceTotalChapters, ranges);
}

/**
 * 兼容旧摘要并验证新摘要；不展开持久区间为大数组，非法记录由展示方保留并提示
 */
export function normalizeChapterSelectionSummary(value: unknown): ChapterSelectionSummary | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const input = value as Record<string, unknown>;
    const total = input.sourceTotalChapters;
    if (typeof total !== "number" || !validTotal(total)) {
        return null;
    }
    const modern = "version" in input;
    if (
        modern
            ? input.version !== 2 || (input.mode !== "all" && input.mode !== "selected")
            : input.mode !== "all" && input.mode !== "range"
    ) {
        return null;
    }
    const entries = modern ? input.ranges : [{ startChapter: input.startChapter, endChapter: input.endChapter }];
    if (!Array.isArray(entries) || !entries.length) {
        return null;
    }
    const ranges: { startChapter: number; endChapter: number }[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
            return null;
        }
        const { startChapter, endChapter } = entry;
        if (
            !Number.isSafeInteger(startChapter) ||
            !Number.isSafeInteger(endChapter) ||
            startChapter < 1 ||
            endChapter < startChapter ||
            endChapter > total
        ) {
            return null;
        }
        const previous = ranges.at(-1);
        if (previous && startChapter <= previous.endChapter) {
            return null;
        }
        if (previous && startChapter === previous.endChapter + 1) {
            previous.endChapter = endChapter;
        } else {
            ranges.push({ startChapter, endChapter });
        }
    }
    const summary = freezeSummary(total, ranges);
    if (
        (input.mode === "all" && summary.mode !== "all") ||
        (modern && (input.selectedCount !== summary.selectedCount || input.mode !== summary.mode))
    ) {
        return null;
    }
    return summary;
}

/**
 * 从规范化选择构造快照摘要，旧任务输入在此兼容
 */
export function createDownloadSelectionSummary(selection: DownloadSelectionInput): ChapterSelectionSummary {
    return summarizeChapterSelection(normalizeSelection(selection));
}

/**
 * 创建固定任务计划；部分选择保留累计缓存，完整目录沿用全本清理规则
 */
export function createDownloadPlan(input: DownloadPlanInput) {
    const selection = resolveDownloadSelection(input);
    const tasks = Object.freeze(input.tasks.map((task) => Object.freeze({ ...task })));
    const indexes: ReadonlySet<number> = new Set(selection.indexes);
    const taskOrderByIndex: ReadonlyMap<number, number> = new Map(tasks.map((task, order) => [task.index, order]));
    return {
        tasks,
        selection,
        summary: summarizeChapterSelection(selection),
        retainCacheOnSuccess: selection.mode === "selected",
        indexes,
        taskOrderByIndex,
        /**
         * 只统计本次选中索引的缓存命中，正文与资源完整性由恢复阶段检查
         */
        readyCount(chapters: Pick<ReadonlySet<number>, "has">): number {
            return tasks.reduce((count, task) => count + Number(chapters.has(task.index)), 0);
        },
        /**
         * 同时返回本次任务位置与原书目录位置，均从 1 开始
         */
        position(task: DownloadTask) {
            const order = taskOrderByIndex.get(task.index);
            if (order === undefined) {
                throw new DownloadSelectionError("selection-task-mismatch");
            }
            return { index: order + 1, sourceIndex: task.index + 1, total: tasks.length };
        }
    };
}

export type DownloadPlan = ReturnType<typeof createDownloadPlan>;
