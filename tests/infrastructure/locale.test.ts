import { describe, expect, it } from "vitest";
import {
    MissingLocaleParameterError,
    ZH_CN_MESSAGES,
    ZH_TW_MESSAGES,
    interpolateLocaleMessage,
    translate
} from "../../src/locale/catalog";

describe("locale infrastructure", () => {
    it("keeps the base catalogs complete for both supported locales", () => {
        expect(Object.keys(ZH_TW_MESSAGES).sort()).toEqual(Object.keys(ZH_CN_MESSAGES).sort());
    });

    it("supports repeated and non-string interpolation values", () => {
        expect(
            interpolateLocaleMessage("test.message", "{count} chapters: {count} done ({enabled})", {
                count: 2,
                enabled: true
            })
        ).toBe("2 chapters: 2 done (true)");
    });

    it("fails clearly when an interpolation parameter is missing", () => {
        expect(() => translate("zh-CN", "download.progress", { completed: 2 })).toThrow(MissingLocaleParameterError);
    });
});
