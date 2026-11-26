// @vitest-environment jsdom

import { createRangeSelection } from "../../src/download/plan";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    expectReadyDownload,
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
        mocks.getConcurrency.mockReturnValue(2);
        mocks.promptProtectedChapterPassword.mockResolvedValue({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });
        mocks.fetchWithTimeout.mockImplementation(async (url: string) => {
            if (url === tasks[0].url) {
                order.push("protected-detected");
                return { text: vi.fn().mockResolvedValue(createProtectedChapterFixture()) } as unknown as Response;
            }
            order.push("ordinary-start");
            ordinaryStarted.resolve();
            await ordinaryFinished.promise;
            order.push("ordinary-end");
            return { text: vi.fn().mockResolvedValue("<html></html>") } as unknown as Response;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options: RequestInit) => {
                if (url === tasks[0].url && options.method === "GET") {
                    order.push("protected-refreshed");
                    return new Response(createProtectedChapterFixture());
                }
                if (url === tasks[0].url) {
                    order.push("token");
                    return new Response("<JinJing>fictional-token</JinJing>");
                }
                order.push("password");
                return new Response(JSON.stringify({ status: 200, html: "<p>unlocked body</p>" }));
            })
        );

        const download = runtime.runBookDownload(createBrowserDownloadOptions(tasks));
        await ordinaryStarted.promise;
        await vi.waitFor(() => expect(mocks.promptProtectedChapterPassword).toHaveBeenCalledOnce());
        expect(order).not.toContain("protected-refreshed");

        ordinaryFinished.resolve();
        await download;

        expect(order.indexOf("ordinary-end")).toBeLessThan(order.indexOf("protected-refreshed"));
        expect(order.slice(order.indexOf("protected-refreshed"))).toEqual(["protected-refreshed", "token", "password"]);
    });

    it("fetches only current-site chapter paths and keeps links for the other entries", async () => {
        const tasks = createBrowserDownloadTasks(4);
        tasks[0].url += "?view=reader#chapter";
        tasks[1].url = "https://www.esjzone.one/forum/100/2.html";
        tasks[2].url = "https://www.esjzone.cc/forum/100/";
        tasks[3].url = "https://example.test/story/4";

        const result = expectReadyDownload(await runtime.runBookDownload(createBrowserDownloadOptions(tasks)));
        expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([tasks[0].url]);
        for (const task of tasks.slice(1)) {
            expect(result.txt).toContain(task.url);
        }
    });

    it("binds old callbacks to their task without updating the new page task", async () => {
        const { startRuntimeCacheSession } = await import("../../src/app/page-session");
        const { createCacheMeta } = await import("../support");
        const { createInitialDownloadSnapshot } = await import("../../src/download/progress");
        const entered = createDeferred<void>();
        const finish = createDeferred<void>();
        mocks.runDownload.mockImplementationOnce(async () => {
            entered.resolve();
            await finish.promise;
            return {
                status: "failed",
                failure: { kind: "download", code: "old-failure", params: {}, storageFailure: null }
            };
        });
        const running = runtime.start(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await entered.promise;
        const dependencies = runtime.dependencies;
        const oldCancellation = runtime.task.cancellation;
        dependencies.events.emit({
            type: "task-started",
            meta: createCacheMeta(),
            taskId: "task-100",
            bookChapterCount: 0
        });
        const newer = { bookId: "200", taskId: "task-200", requestCancellation: vi.fn() };
        runtime.state.activeDownload = newer;
        startRuntimeCacheSession(createCacheMeta({ bookId: "200" }), "task-200", 9);
        const snapshot = createInitialDownloadSnapshot(3, 1);
        document.body.innerHTML = '<div id="esj-popup"><span id="esj-title">new task</span></div>';
        document.title = "new task title";
        dependencies.events.emit({ type: "snapshot-updated", snapshot });
        dependencies.events.emit({
            type: "task-started",
            meta: createCacheMeta(),
            taskId: "task-100",
            bookChapterCount: 0
        });
        dependencies.ui.update(snapshot);
        expect(document.querySelector("#esj-title")?.textContent).toBe("new task");
        expect(document.title).toBe("new task title");
        expect(runtime.state.runtimeCacheSession).toMatchObject({ taskId: "task-200", bookChapterCount: 9 });
        expect(mocks.fullCleanup).not.toHaveBeenCalled();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
        await dependencies.scheduler.sleepWithAbort(10, oldCancellation.signal);
        expect(mocks.sleepWithAbort).toHaveBeenCalledWith(10, oldCancellation.signal);
        await dependencies.lock.owns();
        expect(mocks.ownsLock).toHaveBeenCalledWith(runtime.task.lock);
        mocks.startHeartbeat.mock.calls[0][1]("discard");
        expect(oldCancellation.isCancellationRequested()).toBe(true);
        expect(newer.requestCancellation).not.toHaveBeenCalled();
        finish.resolve();
        await running;
        expect(mocks.fullCleanup).not.toHaveBeenCalled();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
        expect(runtime.state.activeDownload).toBe(newer);
    });

    it("cleans presentation when core input validation fails before its try", async () => {
        const locale = await import("../../src/ui/locale");
        const subscribe = locale.subscribeInterfaceLocaleChange;
        const unsubscribe = vi.fn();
        vi.spyOn(locale, "subscribeInterfaceLocaleChange").mockImplementation((listener) => {
            const dispose = subscribe(listener);
            return () => {
                unsubscribe();
                dispose();
            };
        });
        const actual = await vi.importActual<typeof import("../../src/download/run")>("../../src/download/run");
        mocks.runDownload.mockImplementationOnce((options, dependencies) =>
            actual.runDownload({ ...options, selection: createRangeSelection(2, 3, 3) }, dependencies)
        );
        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)))
        ).rejects.toThrow();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(runtime.state.activeDownload).toBeNull();
    });
});
