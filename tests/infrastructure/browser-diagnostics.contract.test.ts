// @vitest-environment jsdom

import { IDBDatabase } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    browserDiagnosticLog,
    clearBrowserDiagnosticSessions,
    browserDiagnosticEvents,
    finishBrowserDiagnosticSession,
    listBrowserDiagnosticSessions,
    recordBrowserDownloadEvent,
    recordBrowserPreflightDiagnosticFailure,
    recordBrowserDiagnosticExport,
    recordBrowserDiagnosticFailure,
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
            expect((await listBrowserDiagnosticSessions()).history[0]).toMatchObject({
                result: "failed",
                failures: [expect.objectContaining({ code: "database-unavailable" })]
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
        expect((await listBrowserDiagnosticSessions()).active[0].logs).toContainEqual(
            expect.objectContaining({ code: "download-started", params: { concurrency: 1 } })
        );
    });

    it("persists a completed session with logs, exports and controlled book details", async () => {
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
        recordBrowserDiagnosticExport({
            scope: "full",
            format: "epub",
            outcome: "success",
            generated: true,
            downloadTriggered: true,
            failureStage: null
        });

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
        expect(session.exports).toEqual([
            expect.objectContaining({ format: "epub", generated: true, downloadTriggered: true })
        ]);
        expect(JSON.parse(exported)).toEqual({ session });
        expect(exported).not.toContain('"notice"');
        expect(exported).not.toContain("must not be stored");
        expect(exported).not.toContain("token=secret");
    });

    it("persists structured log codes and parameters after completion", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-structured-log",
            bookId: "book-log",
            bookTitle: "Log Book",
            pageUrl: "https://www.esjzone.cc/detail/12.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        browserDiagnosticLog({ code: "download-started", params: { concurrency: 3 } });
        finishBrowserDiagnosticSession("task-structured-log", "success");

        const session = (await listBrowserDiagnosticSessions()).history[0];
        expect(session.logs).toEqual([
            { at: expect.any(Number), level: "info", code: "download-started", params: { concurrency: 3 } }
        ]);
    });

    it("keeps failed chapter location and export failures after download completion", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-2",
            bookId: "book-2",
            bookTitle: "Book 2",
            pageUrl: "https://www.esjzone.cc/detail/2.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        recordBrowserDiagnosticFailure({
            scope: "chapter",
            stage: "fetch",
            code: "network-error",
            message: "request failed",
            chapter: {
                index: 2,
                title: "Chapter 3",
                url: "https://www.esjzone.cc/forum/2/3.html?cookie=secret"
            }
        });
        finishBrowserDiagnosticSession("task-2", "success");
        recordBrowserDiagnosticFailure({
            scope: "export",
            stage: "epub-download",
            code: "NotAllowedError",
            message: "download blocked"
        });

        const session = (await listBrowserDiagnosticSessions()).history[0];
        expect(session.result).toBe("success");
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "chapter",
                chapter: {
                    index: 3,
                    title: "Chapter 3",
                    url: "https://www.esjzone.cc/forum/2/3.html"
                }
            }),
            expect.objectContaining({ scope: "export", stage: "epub-download" })
        ]);
    });

    it("keeps inline image failures inside a successful diagnostic session", async () => {
        startBrowserDiagnosticSession({
            taskId: "task-inline-image",
            bookId: "book-image",
            bookTitle: "Image Book",
            pageUrl: "https://www.esjzone.cc/detail/3.html",
            sourcePageType: "detail",
            imageEnabled: true
        });
        recordBrowserDiagnosticFailure({
            scope: "image",
            stage: "request",
            code: "image-request-failed",
            message:
                "图片请求在重试后仍失败 data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            imageFailureCount: 2,
            chapter: {
                index: 0,
                title: "Chapter 1",
                url: "https://www.esjzone.cc/forum/3/1.html?cookie=secret"
            }
        });
        finishBrowserDiagnosticSession("task-inline-image", "success");

        const session = (await listBrowserDiagnosticSessions()).history[0];
        const exported = createDiagnosticExport(session, {
            bookTitle: formatDiagnosticBookTitle(session),
            formatLog: formatDiagnosticLog
        }).json;

        expect(session.result).toBe("success");
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "image",
                stage: "request",
                imageFailureCount: 2,
                chapter: expect.objectContaining({ index: 1, url: "https://www.esjzone.cc/forum/3/1.html" })
            })
        ]);
        expect(exported).not.toContain("data:image");
        expect(exported).not.toContain("cookie=secret");
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
        const base = createInitialDownloadSnapshot(20, 5);
        const downloading = {
            ...base,
            phase: "downloading" as const,
            completedCount: 7,
            restoredCount: 5,
            fetchedCount: 2,
            processedCount: 2
        };
        browserDiagnosticEvents.emit({ type: "snapshot-updated", snapshot: downloading });
        browserDiagnosticEvents.emit({
            type: "mapping-font-updated",
            summary: { chapterCount: 2, fontBytes: 700_000 }
        });
        browserDiagnosticEvents.emit({
            type: "chapter-failed",
            task: { index: 8, title: "Broken chapter", url: "https://www.esjzone.cc/forum/9/10.html" },
            stage: "fetch",
            code: "chapter-fetch-failed",
            params: { detail: "request timed out" },
            retry: true
        });
        const failed = { ...downloading, phase: "failed" as const, failedCount: 1 };
        browserDiagnosticEvents.emit({
            type: "phase-changed",
            previous: "downloading",
            current: "failed",
            snapshot: failed
        });
        browserDiagnosticEvents.emit({
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

    it("persists failures that happen before a download lock is acquired", async () => {
        recordBrowserPreflightDiagnosticFailure({
            bookId: "book-preflight",
            bookTitle: "Preflight Book",
            pageUrl: "https://www.esjzone.cc/detail/10.html",
            sourcePageType: "detail",
            imageEnabled: false,
            failure: {
                scope: "storage",
                stage: "cache-read",
                code: "database-unavailable",
                message: "IndexedDB unavailable"
            }
        });

        const { active, history } = await listBrowserDiagnosticSessions();
        const [session] = history;
        expect(session.result).toBe("failed");
        expect(active).toEqual([]);
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "storage",
                stage: "cache-read",
                code: "database-unavailable"
            })
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
        browserDiagnosticEvents.emit({
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

        dispatchPageHide(false);

        const terminal = (await listBrowserDiagnosticSessions()).history[0];
        expect(terminal).toEqual(expect.objectContaining({ taskId: "task-page-terminal", result: "cancelled" }));
        expect(terminal.closeObservedAt).toBeUndefined();
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
