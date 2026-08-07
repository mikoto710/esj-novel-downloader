import { describe, expect, it } from "vitest";
import {
    IncompleteLocaleCatalogError,
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
        expect(LOCALE_KEYS).toHaveLength(12);
        expect(Object.keys(ZH_CN_MESSAGES)).toHaveLength(LOCALE_KEYS.length);
        expect(Object.keys(ZH_TW_MESSAGES)).toHaveLength(LOCALE_KEYS.length);
        expect(findMissingLocaleKeys(LOCALE_CATALOGS)).toEqual({ "zh-CN": [], "zh-TW": [] });
        expect(() => assertLocaleCatalogsComplete()).not.toThrow();
    });

    it("reports missing keys without changing the source catalogs", () => {
        const incompleteCatalogs = {
            "zh-CN": { "common.confirm": "确认" },
            "zh-TW": { "common.confirm": "確認", "common.cancel": "取消" }
        } as const;

        const missing = findMissingLocaleKeys(incompleteCatalogs);

        expect(missing["zh-CN"]).toContain("common.cancel");
        expect(missing["zh-CN"]).toContain("download.progress");
        expect(missing["zh-TW"]).toContain("download.progress");
        expect(() => assertLocaleCatalogsComplete(incompleteCatalogs)).toThrow(IncompleteLocaleCatalogError);
        expect(incompleteCatalogs["zh-CN"]).toEqual({ "common.confirm": "确认" });
    });

    it("translates stable keys using the selected manually reviewed catalog", () => {
        expect(translate("zh-CN", "common.cancel")).toBe("取消");
        expect(translate("zh-TW", "common.cancel")).toBe("取消");
        expect(translate("zh-CN", "download.progress", { completed: 2, total: 5 })).toBe("进度：2/5");
        expect(translate("zh-TW", "download.progress", { completed: 2, total: 5 })).toBe("進度：2/5");
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
        expect(() => translate("zh-CN", "download.progress", { completed: 2 })).toThrow(
            "Missing locale message parameter: download.progress.{total}"
        );
    });
});
