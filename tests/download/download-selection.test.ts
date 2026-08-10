import { describe, expect, it } from "vitest";
import type { DownloadTask } from "../../src/core/download/contracts";
import {
    createRangeSelection,
    DownloadSelectionError,
    resolveDownloadSelection,
    selectDownloadTasks
} from "../../src/core/download/selection";

function createTasks(count: number): DownloadTask[] {
    return Array.from({ length: count }, (_, index) => ({
        index,
        title: `Chapter ${index + 1}`,
        url: `https://www.esjzone.cc/forum/1/${index + 1}.html`
    }));
}

describe("download selection", () => {
    it.each([
        [1, 1, 5, "range", 0, 0],
        [1, 5, 5, "all", 0, 4],
        [5, 5, 5, "range", 4, 4],
        [2, 4, 5, "range", 1, 3]
    ] as const)("converts %s..%s of %s to absolute indexes", (start, end, total, mode, startIndex, endIndex) => {
        expect(createRangeSelection(start, end, total)).toEqual({
            mode,
            sourceTotalChapters: total,
            startIndex,
            endIndex
        });
    });

    it.each([
        [0, 1, 5],
        [-1, 1, 5],
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
            startIndex: 0,
            endIndex: 2
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
