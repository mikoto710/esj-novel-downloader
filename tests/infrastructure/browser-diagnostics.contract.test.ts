// @vitest-environment jsdom

import * as pageClose from "../../src/storage/diagnostic-page-close";
import { IDBDatabase } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    browserDiagnosticLog,
    clearBrowserDiagnosticSessions,
    finishBrowserDiagnosticSession,
    listBrowserDiagnosticSessions,
    recordBrowserDownloadEvent,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../../src/diagnostics/runtime";
import * as logView from "../../src/ui/log-view";
import { createDiagnosticExport } from "../../src/diagnostics/export";
import { formatDiagnosticBookTitle, formatDiagnosticLog } from "../../src/ui/messages/diagnostics";
import { createInitialDownloadSnapshot } from "../../src/download/progress";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import { getUserscriptApiMocks } from "../support/gm";
import { deleteTestDatabase } from "../support/resources";

describe("browser diagnostic persistence", () => {
    beforeEach(async () => {
        setInterfaceLocalePreference("zh-CN");
        await clearBrowserDiagnosticSessions();
    });

    afterEach(async () => {
        await deleteTestDatabase("esj-novel-downloader-diagnostics");
    });

    function dispatchPageHide(persisted: boolean): void {
        const event = new Event("pagehide");
        Object.defineProperty(event, "persisted", { value: persisted });
        window.dispatchEvent(event);
    }

    it("does not block a caller when diagnostic settings cannot be read", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const gm = getUserscriptApiMocks();
        gm.getValue.mockImplementation((key: string, fallback?: unknown) => {
            if (key === "enable_epub_tag_page") throw new Error("GM read unavailable");
            return gm.values.has(key) ? gm.values.get(key) : fallback;
        });

        expect(() =>
            startBrowserDiagnosticSession(
                {
                    taskId: "task-unavailable-settings",
                    bookId: "100",
                    bookTitle: "Book",
                    pageUrl: location.href,
                    sourcePageType: "detail",
                    imageEnabled: false
                },
                { observePageClose: true }
            )
        ).not.toThrow();
        expect((await listBrowserDiagnosticSessions()).active).toEqual([]);
    });

    it.each(["readonly", "readwrite"] as const)(
        "allows preflight recovery when diagnostic %s transactions fail",
        async (mode) => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const transaction = IDBDatabase.prototype.transaction;
            const storage = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
                this: IDBDatabase,
                names,
                transactionMode,
                options
            ) {
                if (transactionMode === mode) {
                    throw new Error("IndexedDB unavailable");
                }
                return transaction.call(this, names, transactionMode, options);
            });

            const failure = {
                bookId: "100",
                bookTitle: "Book",
                pageUrl: location.href,
                sourcePageType: "detail",
                imageEnabled: false,
                failure: {
                    scope: "storage" as const,
                    stage: "cache-read",
                    code: "database-unavailable",
                    message: "Unavailable"
                }
            };
            expect(() => recordBrowserPreflightDiagnosticFailure(failure)).not.toThrow();
            if (mode === "readonly") {
                await expect(listBrowserDiagnosticSessions()).rejects.toThrow("IndexedDB unavailable");
            } else {
                expect((await listBrowserDiagnosticSessions()).history).toEqual([]);
            }

            storage.mockRestore();
            recordBrowserPreflightDiagnosticFailure(failure);
            const { active, history } = await listBrowserDiagnosticSessions();
            expect(active).toEqual([]);
            expect(history[0]).toMatchObject({
                result: "failed",
                failures: [{ scope: "storage", stage: "cache-read", code: "database-unavailable" }]
            });
        }
    );

    it("records the original diagnostic log even when its view cannot render", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-log-failure",
            bookId: "100",
            bookTitle: "Book",
            pageUrl: location.href,
            sourcePageType: "detail",
            imageEnabled: false
        });
        vi.spyOn(logView, "log").mockImplementation(() => {
            throw new Error("view unavailable");
        });
        expect(() =>
            browserDiagnosticLog({ code: "download-started", params: { concurrency: 1 } }, "task-log-failure")
        ).not.toThrow();
        finishBrowserDiagnosticSession("task-log-failure", "success");
        expect((await listBrowserDiagnosticSessions()).history[0].logs).toMatchObject([
            { level: "info", code: "download-started", params: { concurrency: 1 } }
        ]);
    });

    it("exports a completed diagnostic session with filtered book details", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-1",
            bookId: "1737469479",
            bookTitle: "Temporary title",
            pageUrl: "https://www.esjzone.cc/detail/1737469479.html?token=secret",
            sourcePageType: "detail",
            imageEnabled: true
        });
        updateBrowserDiagnosticSession({
            taskId: "task-1",
            bookId: "1737469479",
            bookName: "Book title",
            introTxt: "must not be stored",
            description: "must not be stored",
            tags: ["private"],
            pageUrl: "https://www.esjzone.cc/detail/1737469479.html?token=secret",
            sourcePageType: "detail",
            imageEnabled: true,
            tasks: [{ index: 0, title: "Chapter 1", url: "https://www.esjzone.cc/forum/1/2.html" }]
        });
        browserDiagnosticLog("正在下载章节");
        finishBrowserDiagnosticSession("task-1", "success");

        const session = (await listBrowserDiagnosticSessions()).history[0];
        const exported = createDiagnosticExport(session, {
            bookTitle: formatDiagnosticBookTitle(session),
            formatLog: formatDiagnosticLog
        }).json;
        expect(session.book).toEqual({
            bookId: "1737469479",
            title: "Book title",
            url: "https://www.esjzone.cc/detail/1737469479.html",
            sourcePageType: "detail"
        });
        expect(session.logs[0].message).toBe("正在下载章节");
        expect(JSON.parse(exported)).toEqual({ session });
        expect(exported).not.toContain("must not be stored");
        expect(exported).not.toContain("token=secret");
    });

    it("records structured download snapshots, mapped fonts and terminal failures", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-events",
            bookId: "book-events",
            bookTitle: "Event Book",
            pageUrl: "https://www.esjzone.cc/detail/9.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        const failed = {
            ...createInitialDownloadSnapshot(20, 5),
            phase: "failed" as const,
            failedCount: 1,
            completedCount: 7,
            restoredCount: 5,
            fetchedCount: 2,
            processedCount: 2
        };
        recordBrowserDownloadEvent("task-events", {
            type: "mapping-font-updated",
            summary: { chapterCount: 2, fontBytes: 700_000 }
        });
        recordBrowserDownloadEvent("task-events", {
            type: "chapter-failed",
            task: { index: 8, title: "Broken chapter", url: "https://www.esjzone.cc/forum/9/10.html" },
            stage: "fetch",
            code: "chapter-fetch-failed",
            params: { detail: "request timed out" },
            retry: true
        });
        recordBrowserDownloadEvent("task-events", {
            type: "phase-changed",
            previous: "downloading",
            current: "failed",
            snapshot: failed
        });
        recordBrowserDownloadEvent("task-events", {
            type: "download-failed",
            code: "download-failed",
            params: { detail: "download failed" },
            snapshot: failed
        });

        const session = (await listBrowserDiagnosticSessions()).history[0];
        expect(session.task).toEqual(
            expect.objectContaining({
                phase: "failed",
                totalChapters: 20,
                restoredChapters: 5,
                fetchedChapters: 2,
                mappingFontChapterCount: 2,
                mappingFontBytes: 700_000
            })
        );
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "chapter",
                code: "chapter-fetch-failed",
                chapter: expect.objectContaining({ index: 9, title: "Broken chapter" })
            }),
            expect.objectContaining({ scope: "download", code: "download-failed", message: "download failed" })
        ]);
    });

    it("does not let scraper finalization overwrite an export-ready success", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-success-finalizer",
            bookId: "book-success",
            bookTitle: "Successful Book",
            pageUrl: "https://www.esjzone.cc/detail/11.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        const snapshot = {
            ...createInitialDownloadSnapshot(41, 25),
            phase: "export-ready" as const,
            completedCount: 41,
            fetchedCount: 16,
            processedCount: 16,
            persistedCount: 16,
            hasExportData: true
        };
        recordBrowserDownloadEvent("task-success-finalizer", {
            type: "phase-changed",
            previous: "preparing-export",
            current: "export-ready",
            snapshot
        });

        recordBrowserDownloadEvent("task-success-finalizer", {
            type: "phase-changed",
            previous: "export-ready",
            current: "failed",
            snapshot: { ...snapshot, phase: "failed" }
        });

        // 页面 finally 无法判断下载流程是否已经结束，因此仍会执行失败兜底
        finishBrowserDiagnosticSession("task-success-finalizer", "failed");

        const session = (await listBrowserDiagnosticSessions()).history[0];
        expect(session.result).toBe("success");
        expect(session.task.phase).toBe("export-ready");
        expect(session.failures).toEqual([]);
    });

    it("records a non-bfcache pagehide without treating it as a terminal outcome", async () => {
        startBrowserDiagnosticSession(
            {
                taskId: "task-page-close",
                bookId: "book-page-close",
                bookTitle: "Page Close Book",
                pageUrl: "https://www.esjzone.cc/detail/12.html",
                sourcePageType: "detail",
                imageEnabled: false
            },
            { observePageClose: true }
        );

        dispatchPageHide(true);
        const afterBfcache = (await listBrowserDiagnosticSessions()).active[0];
        expect(afterBfcache).toEqual(expect.objectContaining({ taskId: "task-page-close", result: "running" }));
        expect(afterBfcache.closeObservedAt).toBeUndefined();

        dispatchPageHide(false);
        expect((await listBrowserDiagnosticSessions()).active[0]).toEqual(
            expect.objectContaining({
                taskId: "task-page-close",
                result: "running",
                closeObservedAt: expect.any(Number)
            })
        );
    });

    it("stops page-close observation after a real terminal outcome", async () => {
        startBrowserDiagnosticSession(
            {
                taskId: "task-page-terminal",
                bookId: "book-page-terminal",
                bookTitle: "Terminal Book",
                pageUrl: "https://www.esjzone.cc/detail/13.html",
                sourcePageType: "detail",
                imageEnabled: false
            },
            { observePageClose: true }
        );
        finishBrowserDiagnosticSession("task-page-terminal", "cancelled");
        const rememberClose = vi.spyOn(pageClose, "rememberDiagnosticPageClose");

        dispatchPageHide(false);

        expect(rememberClose).not.toHaveBeenCalledWith("task-page-terminal");
        expect((await listBrowserDiagnosticSessions()).history[0]).toMatchObject({ result: "cancelled" });
    });

    it.each([23, 25])(
        "preserves page-close presentation after %i idle hours when the async write fails",
        async (hours) => {
            const hour = 60 * 60 * 1000;
            let now = Date.now();
            vi.spyOn(Date, "now").mockImplementation(() => now);
            const input = {
                taskId: "task-close-during-navigation",
                bookId: "100",
                pageUrl: location.href,
                sourcePageType: "detail",
                imageEnabled: false
            };
            startBrowserDiagnosticSession(input, { observePageClose: true });
            expect((await listBrowserDiagnosticSessions()).active).toHaveLength(1);
            now += hours * hour;
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const transaction = IDBDatabase.prototype.transaction;
            const storage = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
                this: IDBDatabase,
                names,
                mode,
                options
            ) {
                if (mode === "readwrite") {
                    throw new Error("Page stopped before the diagnostic write");
                }
                return transaction.call(this, names, mode, options);
            });

            dispatchPageHide(false);
            const { active, history } = await listBrowserDiagnosticSessions();
            storage.mockRestore();
            if (hours === 25) {
                expect(active).toEqual([]);
                expect(history[0]).toMatchObject({ taskId: input.taskId, result: "interrupted" });
                expect(history[0].closeObservedAt).toBeUndefined();
                return;
            }
            expect(active[0]).toMatchObject({ taskId: input.taskId, result: "running", closeObservedAt: now });

            now += 2 * hour;
            for (let index = 0; index < 30; index++) {
                const taskId = "history-" + index;
                startBrowserDiagnosticSession({ ...input, taskId });
                finishBrowserDiagnosticSession(taskId, "success");
            }
            expect((await listBrowserDiagnosticSessions()).active.map(({ taskId }) => taskId)).toEqual([input.taskId]);
        }
    );
});
