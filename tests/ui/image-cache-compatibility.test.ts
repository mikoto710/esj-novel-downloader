// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { getImageCacheConfirmHint } from "../../src/ui/image-cache-compatibility";
import { setInterfaceLocalePreference } from "../../src/core/config";

describe("image cache compatibility messages", () => {
    beforeEach(() => setInterfaceLocalePreference("zh-CN"));

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
