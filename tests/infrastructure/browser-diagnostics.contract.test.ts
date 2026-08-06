// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
    browserDiagnosticLog,
    clearBrowserDiagnosticSessions,
    browserDiagnosticEvents,
    createBrowserDiagnosticExport,
    finishBrowserDiagnosticSession,
    formatBrowserDiagnosticSummary,
    listBrowserDiagnosticSessions,
    recordBrowserPreflightDiagnosticFailure,
    recordBrowserDiagnosticExport,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../../src/adapters/browser-diagnostics";
import { createInitialDownloadSnapshot } from "../../src/core/download/state-machine";

describe("browser diagnostic persistence", () => {
    beforeEach(() => {
        clearBrowserDiagnosticSessions();
    });

    function dispatchPageHide(persisted: boolean): void {
        const event = new Event("pagehide");
        Object.defineProperty(event, "persisted", { value: persisted });
        window.dispatchEvent(event);
    }

    it("persists a completed session with settings, logs and controlled book details", () => {
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

        const session = listBrowserDiagnosticSessions().history[0];
        const exported = createBrowserDiagnosticExport(session).json;
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

    it("keeps failed chapter location and export failures after download completion", () => {
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

        const session = listBrowserDiagnosticSessions().history[0];
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

    it("keeps inline image failures inside a successful diagnostic session", () => {
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

        const session = listBrowserDiagnosticSessions().history[0];
        const exported = createBrowserDiagnosticExport(session).json;

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

    it("records structured download snapshots, mapped fonts and terminal failures", () => {
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
            code: "TimeoutError",
            message: "request timed out",
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
            error: new Error("download failed"),
            snapshot: failed
        });

        const session = listBrowserDiagnosticSessions().history[0];
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
                code: "TimeoutError",
                chapter: expect.objectContaining({ index: 9, title: "Broken chapter" })
            }),
            expect.objectContaining({ scope: "download", code: "Error", message: "download failed" })
        ]);
    });

    it("summarizes protected chapter progress without treating password rejection as a failure", () => {
        startBrowserDiagnosticSession({
            taskId: "task-protected",
            bookId: "book-protected",
            bookTitle: "Protected Book",
            pageUrl: "https://www.esjzone.cc/detail/14.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        browserDiagnosticEvents.emit({
            type: "snapshot-updated",
            snapshot: {
                ...createInitialDownloadSnapshot(10, 0),
                phase: "downloading",
                protectedDetectedCount: 3,
                protectedPendingCount: 1,
                protectedResolvedCount: 1,
                protectedSkippedCount: 1
            }
        });
        browserDiagnosticEvents.emit({
            type: "protected-chapter-password-rejected",
            task: { index: 2, title: "Protected Chapter", url: "https://www.esjzone.cc/forum/14/3.html" }
        });

        const session = listBrowserDiagnosticSessions().active[0];
        expect(formatBrowserDiagnosticSummary(session)).toContain("密码章节：发现 3；待处理 1；已解锁 1；已跳过 1");
        expect(session.failures).toEqual([]);
        expect(session.events.at(-1)).toMatchObject({
            type: "protected-chapter-password-rejected",
            details: { chapterIndex: 3, result: "password-rejected" }
        });
    });

    it("persists failures that happen before a download lock is acquired", () => {
        const session = recordBrowserPreflightDiagnosticFailure({
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

        expect(session.result).toBe("failed");
        expect(listBrowserDiagnosticSessions().active).toEqual([]);
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "storage",
                stage: "cache-read",
                code: "database-unavailable"
            })
        ]);
    });

    it("does not let scraper finalization overwrite an export-ready success", () => {
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

        // 页面 finally 无法判断 coordinator 是否已经结束，因此仍会执行失败兜底
        finishBrowserDiagnosticSession("task-success-finalizer", "failed");

        const session = listBrowserDiagnosticSessions().history[0];
        expect(session.result).toBe("success");
        expect(session.task.phase).toBe("export-ready");
        expect(session.failures).toEqual([]);
    });

    it("records a real page close without treating bfcache as a terminal outcome", () => {
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
        const afterBfcache = listBrowserDiagnosticSessions().active[0];
        expect(afterBfcache).toEqual(expect.objectContaining({ taskId: "task-page-close", result: "running" }));
        expect(afterBfcache.closeObservedAt).toBeUndefined();

        dispatchPageHide(false);
        expect(listBrowserDiagnosticSessions().active[0]).toEqual(
            expect.objectContaining({
                taskId: "task-page-close",
                result: "running",
                closeObservedAt: expect.any(Number)
            })
        );
    });

    it("stops page-close observation after a real terminal outcome", () => {
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

        const terminal = listBrowserDiagnosticSessions().history[0];
        expect(terminal).toEqual(expect.objectContaining({ taskId: "task-page-terminal", result: "cancelled" }));
        expect(terminal.closeObservedAt).toBeUndefined();
    });
});
