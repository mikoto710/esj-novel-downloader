import { describe, expect, it } from "vitest";
import { createBookExportFilename } from "../../src/export/filename";

describe("book export filename", () => {
    it("names a sparse selection without implying a continuous range", () => {
        expect(
            createBookExportFilename("Example", "epub", {
                version: 2,
                mode: "selected",
                sourceTotalChapters: 5,
                selectedCount: 3,
                ranges: [
                    { startChapter: 1, endChapter: 1 },
                    { startChapter: 3, endChapter: 3 },
                    { startChapter: 5, endChapter: 5 }
                ]
            })
        ).toBe("Example_自选3章.epub");
    });

    it("keeps full-book filenames unchanged", () => {
        expect(createBookExportFilename("Example", "epub")).toBe("Example.epub");
        expect(
            createBookExportFilename("Example", "txt", {
                mode: "all",
                sourceTotalChapters: 120,
                startChapter: 1,
                endChapter: 120
            })
        ).toBe("Example.txt");
    });

    it("adds an inclusive one-based chapter suffix for range exports", () => {
        expect(
            createBookExportFilename("Example", "html", {
                mode: "range",
                sourceTotalChapters: 120,
                startChapter: 101,
                endChapter: 120
            })
        ).toBe("Example_第101-120章.html");
    });
});
