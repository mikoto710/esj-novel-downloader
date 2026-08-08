import { describe, expect, it, vi } from "vitest";
import { formatDownloadLog } from "../../src/adapters/browser-download-messages";

vi.mock("../../src/ui/locale", async () => {
    const locale = await vi.importActual<typeof import("../../src/core/locale")>("../../src/core/locale");
    return {
        t: (key: Parameters<typeof locale.translate>[1], params?: Parameters<typeof locale.translate>[2]) =>
            locale.translate("zh-CN", key, params)
    };
});

describe("browser download messages", () => {
    it("formats direct messages with their structured parameters", () => {
        expect(formatDownloadLog({ code: "cache-restored", params: { count: 3 } })).toBe("💾 已恢复 3 章缓存");
    });

    it("composes image progress without parsing translated output", () => {
        expect(
            formatDownloadLog({
                code: "chapter-processed-with-images",
                params: {
                    completed: 2,
                    total: 5,
                    title: "第二章",
                    url: "https://www.esjzone.cc/forum/1/2.html",
                    imageCount: 4
                }
            })
        ).toBe("✅ 抓取（2/5）：第二章（4 张图片）\nURL: https://www.esjzone.cc/forum/1/2.html");
    });

    it("maps integrity reasons before interpolation", () => {
        expect(
            formatDownloadLog({
                code: "chapter-integrity-retry",
                params: { index: 1, total: 3, reason: "invalid-image-media-type" }
            })
        ).toBe("补抓 [1/3]（图片格式无效）…");
    });

    it("adds chapter position to protected chapter logs", () => {
        expect(
            formatDownloadLog({
                code: "protected-chapter-password-rejected",
                params: { index: 2, total: 7, title: "密码章节" }
            })
        ).toBe("⚠️ 密码不正确 [2/7]：密码章节");
    });

    it("localizes storage reasons in download logs", () => {
        expect(
            formatDownloadLog({
                code: "download-storage-failed",
                params: { reason: "quota-exceeded", detail: "storage full" }
            })
        ).toBe("❌ 下载进度未保存：浏览器存储空间不足：storage full");
    });

    it("formats cancellation outcomes without changing their meaning", () => {
        expect(formatDownloadLog({ code: "cancellation-finished", params: { outcome: "saved" } })).toBe(
            "任务已手动取消，进度已保存。"
        );
    });
});
