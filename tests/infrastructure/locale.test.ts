import { describe, expect, it } from "vitest";
import {
    LOCALE_CATALOGS,
    LOCALE_KEYS,
    MissingLocaleParameterError,
    ZH_CN_MESSAGES,
    ZH_TW_MESSAGES,
    assertLocaleCatalogsComplete,
    findMissingLocaleKeys,
    interpolateLocaleMessage,
    translate
} from "../../src/core/locale";

describe("locale infrastructure", () => {
    it("keeps the base catalogs complete for both supported locales", () => {
        expect(Object.keys(ZH_CN_MESSAGES)).toHaveLength(LOCALE_KEYS.length);
        expect(Object.keys(ZH_TW_MESSAGES)).toHaveLength(LOCALE_KEYS.length);
        expect(findMissingLocaleKeys(LOCALE_CATALOGS)).toEqual({ "zh-CN": [], "zh-TW": [] });
        expect(() => assertLocaleCatalogsComplete()).not.toThrow();
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
