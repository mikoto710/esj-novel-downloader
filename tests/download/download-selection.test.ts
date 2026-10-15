import { describe, expect, it } from "vitest";
import type { DownloadTask } from "../../src/download/contracts";
import {
    createDownloadPlan,
    createChapterSelection,
    normalizeChapterSelectionSummary,
    summarizeChapterSelection,
    createRangeSelection,
    DownloadSelectionError,
    resolveDownloadSelection,
    selectDownloadTasks
} from "../../src/download/plan";

function createTasks(count: number): DownloadTask[] {
    return Array.from({ length: count }, (_, index) => ({
        index,
        title: `Chapter ${index + 1}`,
        url: `https://www.esjzone.cc/forum/1/${index + 1}.html`
    }));
}

describe("download selection", () => {
    it("normalizes sparse indexes without treating endpoints as a full book", () => {
        const selection = createChapterSelection([4, 0, 9, 1, 10, 4], 12);
        const plan = createDownloadPlan({ tasks: selectDownloadTasks(createTasks(12), selection), selection });
        expect(selection).toEqual({ mode: "selected", sourceTotalChapters: 12, indexes: [0, 1, 4, 9, 10] });
        expect(plan.summary).toEqual({
            version: 2,
            mode: "selected",
            sourceTotalChapters: 12,
            selectedCount: 5,
            ranges: [
                { startChapter: 1, endChapter: 2 },
                { startChapter: 5, endChapter: 5 },
                { startChapter: 10, endChapter: 11 }
            ]
        });
        expect(plan.retainCacheOnSuccess).toBe(true);
        expect(plan.readyCount(new Set([0, 2, 9, 11]))).toBe(2);
        expect(plan.position(plan.tasks[2])).toEqual({ index: 3, sourceIndex: 5, total: 5 });
        const endpoints = createChapterSelection([0, 11], 12);
        expect(
            createDownloadPlan({ tasks: selectDownloadTasks(createTasks(12), endpoints), selection: endpoints })
                .retainCacheOnSuccess
        ).toBe(true);
    });

    it.each([[[]], [[-1]], [[0.5]], [[5]], [[NaN]], [[Infinity]], [new Array<number>(1)]])(
        "rejects invalid chapter sets %j",
        (indexes) => {
            expect(() => createChapterSelection(indexes, 5)).toThrow(DownloadSelectionError);
        }
    );

    it("captures immutable indexes and task data", () => {
        const indexes = [0, 2];
        const tasks = createTasks(3);
        const selection = createChapterSelection(indexes, 3);
        const plan = createDownloadPlan({ tasks: [tasks[0], tasks[2]], selection });
        indexes.push(1);
        tasks[0].title = "Changed";
        expect(plan.selection.indexes).toEqual([0, 2]);
        expect(plan.tasks[0].title).toBe("Chapter 1");
        expect(Object.isFrozen(plan.selection.indexes)).toBe(true);
        expect(Object.isFrozen(plan.summary.ranges[0])).toBe(true);
    });

    it("reads legacy summaries and rejects dishonest selections", () => {
        expect(
            normalizeChapterSelectionSummary({ mode: "range", sourceTotalChapters: 9, startChapter: 3, endChapter: 5 })
        ).toEqual({
            version: 2,
            mode: "selected",
            sourceTotalChapters: 9,
            selectedCount: 3,
            ranges: [{ startChapter: 3, endChapter: 5 }]
        });
        const summary = summarizeChapterSelection(createChapterSelection([0, 4], 5));
        expect(normalizeChapterSelectionSummary(summary)).toEqual(summary);
        expect(normalizeChapterSelectionSummary({ ...summary, mode: "all" })).toBeNull();
        expect(normalizeChapterSelectionSummary({ ...summary, selectedCount: 5 })).toBeNull();
        expect(
            normalizeChapterSelectionSummary({ ...summary, ranges: [{ startChapter: 1, endChapter: 6 }] })
        ).toBeNull();
        expect(
            normalizeChapterSelectionSummary({ mode: "range", sourceTotalChapters: 9, startChapter: 5, endChapter: 3 })
        ).toBeNull();
    });

    it.each([
        [1, 1, 5, "selected", [0]],
        [1, 5, 5, "all", [0, 1, 2, 3, 4]],
        [5, 5, 5, "selected", [4]],
        [2, 4, 5, "selected", [1, 2, 3]]
    ] as const)("converts %s..%s of %s to absolute indexes", (start, end, total, mode, indexes) => {
        expect(createRangeSelection(start, end, total)).toEqual({ mode, sourceTotalChapters: total, indexes });
    });

    it.each([
        [0, 1, 5],
        [1.5, 2, 5],
        [3, 2, 5],
        [1, 6, 5]
    ])("rejects invalid user range %s..%s of %s", (start, end, total) => {
        expect(() => createRangeSelection(start, end, total)).toThrowError(
            expect.objectContaining<Partial<DownloadSelectionError>>({ code: "selection-range-invalid" })
        );
    });

    it("keeps absolute indexes when selecting a middle range", () => {
        const tasks = createTasks(120);
        const selection = createRangeSelection(101, 120, tasks.length);

        expect(selectDownloadTasks(tasks, selection).map((task) => task.index)).toEqual(
            Array.from({ length: 20 }, (_, index) => index + 100)
        );
    });

    it("treats missing selection as the existing full-book contract", () => {
        const tasks = createTasks(3);

        expect(resolveDownloadSelection({ tasks })).toEqual({
            mode: "all",
            sourceTotalChapters: 3,
            indexes: [0, 1, 2]
        });
    });

    it("normalizes an explicit full-source range before downstream consumers use it", () => {
        expect(
            resolveDownloadSelection({
                tasks: createTasks(3),
                selection: { mode: "range", sourceTotalChapters: 3, startIndex: 0, endIndex: 2 }
            })
        ).toEqual({ mode: "all", sourceTotalChapters: 3, indexes: [0, 1, 2] });
        expect(
            createDownloadPlan({
                tasks: createTasks(3),
                selection: { mode: "range", sourceTotalChapters: 3, startIndex: 0, endIndex: 2 }
            })
        ).toMatchObject({
            summary: {
                version: 2,
                mode: "all",
                sourceTotalChapters: 3,
                selectedCount: 3,
                ranges: [{ startChapter: 1, endChapter: 3 }]
            },
            retainCacheOnSuccess: false
        });
    });

    it("rejects reordered or mismatched selected tasks", () => {
        expect(() =>
            resolveDownloadSelection({
                tasks: [createTasks(3)[2], createTasks(3)[1]],
                selection: createRangeSelection(2, 3, 3)
            })
        ).toThrowError(
            expect.objectContaining<Partial<DownloadSelectionError>>({ code: "selection-task-order-invalid" })
        );

        expect(() =>
            resolveDownloadSelection({
                tasks: [createTasks(3)[0], createTasks(3)[2]],
                selection: createRangeSelection(1, 2, 3)
            })
        ).toThrowError(expect.objectContaining<Partial<DownloadSelectionError>>({ code: "selection-task-mismatch" }));
    });
});
