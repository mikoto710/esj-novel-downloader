// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";
import { createChapter, createDeferred } from "../support";
import { createProtectedChapterFixture } from "../support/fixtures";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser download flow contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("shows saving, integrity, export preparation, and completion stages", async () => {
        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        const trayMessages = mocks.updateTrayText.mock.calls.flat();
        expect(trayMessages).toContain("全本下载（1/1）");
        expect(trayMessages.join("\n")).not.toContain("密码待处理 0");
        expect(trayMessages).toContain("正在保存下载进度（1/1）");
        expect(trayMessages).toContain("正在检查章节完整性（1/1）");
        expect(trayMessages).toContain("正在准备导出（1/1）");
        expect(trayMessages).toContain("导出准备完成（1/1）");
    });

    it("shows cache validation before restored chapters finish normalizing", async () => {
        const validationStarted = createDeferred<void>();
        const continueValidation = createDeferred<void>();
        runtime.state.globalChaptersMap = new Map([[0, createChapter(0)]]);
        document.body.innerHTML = '<span id="esj-title"></span><div id="esj-progress"></div>';
        mocks.sleepWithAbort.mockImplementationOnce(async () => {
            validationStarted.resolve();
            await continueValidation.promise;
        });

        const downloadPromise = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await validationStarted.promise;

        expect(document.querySelector("#esj-title")?.textContent).toBe("📘 正在校验本地缓存（1 章）");
        expect(mocks.log).toHaveBeenCalledWith("💾 读取到 1 章缓存，正在校验…");

        continueValidation.resolve();
        await downloadPromise;
    });

    it("retries a missing chapter through the integrity queue", async () => {
        mocks.fetchWithTimeout
            .mockRejectedValueOnce(new Error("first"))
            .mockRejectedValueOnce(new Error("second"))
            .mockRejectedValueOnce(new Error("third"))
            .mockResolvedValue({ text: vi.fn().mockResolvedValue("<html></html>") });

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(4);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(runtime.state.cachedData?.chapters).toHaveLength(1);
    });

    it("wires protected chapter GET, token POST, password POST, and normal processing", async () => {
        mocks.fetchWithTimeout
            .mockResolvedValueOnce({ text: vi.fn().mockResolvedValue(createProtectedChapterFixture()) })
            .mockResolvedValueOnce({ text: vi.fn().mockResolvedValue(createProtectedChapterFixture()) })
            .mockResolvedValueOnce({ text: vi.fn().mockResolvedValue("<JinJing>fictional-token</JinJing>") })
            .mockResolvedValueOnce({
                text: vi.fn().mockResolvedValue(JSON.stringify({ status: 200, html: "<p>unlocked body</p>" }))
            });
        mocks.promptProtectedChapterPassword.mockResolvedValue({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(4);
        expect(mocks.fetchWithTimeout.mock.calls[1][1]).toMatchObject({ method: "GET", credentials: "include" });
        expect(mocks.fetchWithTimeout.mock.calls[2][1]).toMatchObject({ method: "POST", credentials: "include" });
        expect(String(mocks.fetchWithTimeout.mock.calls[2][1].body)).toBe("plxf=getAuthToken");
        expect(mocks.fetchWithTimeout.mock.calls[3][0]).toBe("https://www.esjzone.cc/inc/forum_pw.php");
        expect(mocks.fetchWithTimeout.mock.calls[3][1].headers.Authorization).toBe("fictional-token");
        expect(String(mocks.fetchWithTimeout.mock.calls[3][1].body)).toBe("pw=fictional-password");
        expect(mocks.parseChapterHtml).toHaveBeenCalledWith(expect.stringContaining("unlocked body"), "第 1 章");
        expect(runtime.state.cachedData?.chapters).toHaveLength(1);
    });

    it("waits for ordinary requests before refreshing and authorizing the protected chapter", async () => {
        const tasks = createBrowserDownloadTasks(2);
        const ordinaryStarted = createDeferred<void>();
        const ordinaryFinished = createDeferred<void>();
        const order: string[] = [];
        let protectedGetCount = 0;
        mocks.getConcurrency.mockReturnValue(2);
        mocks.promptProtectedChapterPassword.mockResolvedValue({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });
        mocks.fetchWithTimeout.mockImplementation(async (url: string, options: RequestInit = {}) => {
            const method = options.method || "GET";
            if (url === tasks[0].url && method === "GET") {
                protectedGetCount++;
                order.push(protectedGetCount === 1 ? "protected-detected" : "protected-refreshed");
                return { text: vi.fn().mockResolvedValue(createProtectedChapterFixture()) } as unknown as Response;
            }
            if (url === tasks[1].url && method === "GET") {
                order.push("ordinary-start");
                ordinaryStarted.resolve();
                await ordinaryFinished.promise;
                order.push("ordinary-end");
                return { text: vi.fn().mockResolvedValue("<html></html>") } as unknown as Response;
            }
            if (url === tasks[0].url && method === "POST") {
                order.push("token");
                return { text: vi.fn().mockResolvedValue("<JinJing>fictional-token</JinJing>") } as unknown as Response;
            }
            order.push("password");
            return {
                text: vi.fn().mockResolvedValue(JSON.stringify({ status: 200, html: "<p>unlocked body</p>" }))
            } as unknown as Response;
        });

        const download = runtime.batchDownload(createBrowserDownloadOptions(tasks));
        await ordinaryStarted.promise;
        await vi.waitFor(() => expect(mocks.promptProtectedChapterPassword).toHaveBeenCalledOnce());
        expect(order).not.toContain("protected-refreshed");

        ordinaryFinished.resolve();
        await download;

        expect(order.indexOf("ordinary-end")).toBeLessThan(order.indexOf("protected-refreshed"));
        expect(order.slice(order.indexOf("protected-refreshed"))).toEqual(["protected-refreshed", "token", "password"]);
    });

    it("keeps protected chapters pending instead of presenting request completion as正文 progress", async () => {
        const decision = createDeferred<{ action: "skip-current" }>();
        document.body.innerHTML = '<span id="esj-title"></span><div id="esj-progress"></div>';
        mocks.fetchWithTimeout.mockResolvedValueOnce({
            text: vi.fn().mockResolvedValue(createProtectedChapterFixture())
        });
        mocks.promptProtectedChapterPassword.mockImplementationOnce(() => decision.promise);

        const download = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await vi.waitFor(() => expect(mocks.promptProtectedChapterPassword).toHaveBeenCalledOnce());

        expect(document.querySelector("#esj-title")?.textContent).toContain("正文完成 0/1｜密码待处理 1｜正在抓取");
        expect(document.title).toContain("[0/1｜密码1]");
        expect((document.querySelector("#esj-progress") as HTMLElement).style.width).toBe("0%");

        decision.resolve({ action: "skip-current" });
        await download;

        expect(mocks.updateTrayText.mock.calls.flat()).toContain("全本下载（0/1）");
    });

    it("refreshes the active download status in place when the interface locale changes", async () => {
        const decision = createDeferred<{ action: "skip-current" }>();
        document.body.innerHTML = '<div id="esj-popup"><span id="esj-title"></span><div id="esj-progress"></div></div>';
        mocks.fetchWithTimeout.mockResolvedValueOnce({
            text: vi.fn().mockResolvedValue(createProtectedChapterFixture())
        });
        mocks.promptProtectedChapterPassword.mockImplementationOnce(() => decision.promise);

        const download = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await vi.waitFor(() => expect(mocks.promptProtectedChapterPassword).toHaveBeenCalledOnce());
        const popup = document.querySelector("#esj-popup");

        mocks.getInterfaceLocalePreference.mockReturnValue("zh-TW");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-popup")).toBe(popup);
        expect(document.querySelector("#esj-title")?.textContent).toContain("內文完成 0/1｜密碼待處理 1｜正在擷取");
        decision.resolve({ action: "skip-current" });
        await download;
    });
});
