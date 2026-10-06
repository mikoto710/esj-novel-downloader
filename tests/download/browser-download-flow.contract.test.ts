// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";
import { createDeferred } from "../support";
import { createProtectedChapterFixture } from "../support/fixtures";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser download flow contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
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

    it("binds old callbacks to their task without updating the new page task", async () => {
        const { createBrowserDownloadDependencies } = await import("../../src/adapters/browser-download-dependencies");
        const { activateDownload, createDownloadCancellation, startRuntimeCacheSession } =
            await import("../../src/core/state");
        const { createCacheMeta, createBookLock } = await import("../support");
        const { createInitialDownloadSnapshot } = await import("../../src/download/progress");
        const dependencies = createBrowserDownloadDependencies(runtime.task);
        dependencies.events.emit({
            type: "task-started",
            meta: createCacheMeta(),
            taskId: "task-100",
            bookChapterCount: 0
        });
        const nextLock = createBookLock({ bookId: "200", taskId: "task-200" });
        const nextCancellation = createDownloadCancellation();
        activateDownload(nextLock.bookId, nextLock.taskId, nextCancellation);
        startRuntimeCacheSession(createCacheMeta({ bookId: "200" }), nextLock.taskId, 9);
        const snapshot = createInitialDownloadSnapshot(3, 1);
        document.body.innerHTML = '<div id="esj-popup"><span id="esj-title">new task</span></div>';
        dependencies.events.emit({ type: "snapshot-updated", snapshot });
        dependencies.events.emit({
            type: "task-started",
            meta: createCacheMeta(),
            taskId: "task-100",
            bookChapterCount: 0
        });
        dependencies.ui.update(snapshot);
        dependencies.ui.cleanup();
        dependencies.ui.showTerminalFailure({ kind: "cancellation", outcome: "ownership-lost", storageFailure: null });
        expect(document.querySelector("#esj-title")?.textContent).toBe("new task");
        expect(runtime.state.runtimeCacheSession).toMatchObject({ taskId: "task-200", bookChapterCount: 9 });
        expect(mocks.fullCleanup).not.toHaveBeenCalled();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
        await dependencies.scheduler.sleepWithAbort(10);
        expect(mocks.sleepWithAbort).toHaveBeenCalledWith(10, runtime.task.cancellation.signal);
        await dependencies.lock.owns();
        expect(mocks.ownsLock).toHaveBeenCalledWith(runtime.task.lock);
        expect(nextCancellation.isCancellationRequested()).toBe(false);
    });
    it("cleans the browser presentation when invalid selection fails before core startup", async () => {
        const options = createBrowserDownloadOptions(createBrowserDownloadTasks(1));
        await expect(
            runtime.batchDownload({
                ...options,
                selection: { mode: "range", sourceTotalChapters: 3, startIndex: 1, endIndex: 2 }
            })
        ).rejects.toThrow();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    });
});
