import { describe, expect, it } from "vitest";
import { evaluateImageCacheCompatibility } from "../../src/core/cache/image-cache-compatibility";

describe("image cache compatibility", () => {
    it.each([
        [true, true],
        [false, false]
    ])("reuses cache when image settings match (%s -> %s)", (cached, requested) => {
        expect(evaluateImageCacheCompatibility(cached, requested)).toBe("compatible");
    });

    it.each([
        [true, false],
        [false, true]
    ])("requires refetch when image settings differ (%s -> %s)", (cached, requested) => {
        expect(evaluateImageCacheCompatibility(cached, requested)).toBe("refetch-required");
    });

    it("treats cache without image metadata as unknown", () => {
        expect(evaluateImageCacheCompatibility(undefined, true)).toBe("unknown");
        expect(evaluateImageCacheCompatibility(undefined, false)).toBe("unknown");
    });
});
