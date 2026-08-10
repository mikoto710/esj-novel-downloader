import { describe, expect, it } from "vitest";
import { createBookExportFilename } from "../../src/core/download/export-filename";

describe("book export filename", () => {
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
