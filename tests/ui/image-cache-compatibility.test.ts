import { describe, expect, it, vi } from "vitest";
import { getImageCacheConfirmHint } from "../../src/ui/image-cache-compatibility";

vi.mock("../../src/ui/locale", async () => {
    const locale = await vi.importActual<typeof import("../../src/core/locale")>("../../src/core/locale");
    return {
        t: (key: Parameters<typeof locale.translate>[1], params?: Parameters<typeof locale.translate>[2]) =>
            locale.translate("zh-CN", key, params)
    };
});

describe("image cache compatibility messages", () => {
    it("describes reusable cache when settings match", () => {
        expect(getImageCacheConfirmHint(12, true, true)).toContain("12 章兼容缓存");
    });

    it("warns that mismatched cache will be refetched", () => {
        expect(getImageCacheConfirmHint(12, false, true)).toContain("插图设置与本次任务不同");
    });

    it("warns that cache without image metadata will be refetched", () => {
        expect(getImageCacheConfirmHint(12, undefined, false)).toContain("缺少插图设置信息");
    });

    it("uses the default confirmation copy when there is no cache", () => {
        expect(getImageCacheConfirmHint(0, undefined, false)).toBeUndefined();
    });
});
