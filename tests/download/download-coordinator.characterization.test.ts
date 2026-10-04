import { describe, expect, it, vi } from "vitest";
import { createDownloadHarness as createHarness } from "../support/download-harness";
import type {
    DownloadOptions,
    IncompleteChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterUnlockResult,
    DownloadTask,
    ProtectedChapterDecision
} from "../../src/core/download/contracts";
import type { Chapter } from "../../src/types";
import { createChapter, createDeferred, createDownloadTask } from "../support";
import { MappingFontError } from "../../src/core/mapping-font";

describe("runDownload characterization", () => {
    it("removes cache cancellation listeners even when prompt teardown fails", async () => {
        const tasks = [createDownloadTask()];
        const harness = createHarness(tasks);
        const unsubscribe = vi.fn();
        harness.dependencies.cancellation.subscribeCancellation = () => unsubscribe;
        harness.ui.closeProtectedChapterPrompt.mockImplementationOnce(() => {
            throw new Error("prompt teardown");
        });

        await expect(harness.run(createOptions(tasks))).rejects.toThrow("prompt teardown");
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it("returns the export snapshot only after the cache writer finishes", async () => {
        const tasks = [createDownloadTask()];
        const harness = createHarness(tasks);
        const started = createDeferred<void>();
        const finish = createDeferred<boolean>();
        harness.dependencies.cache.clearForTask = async () => {
            started.resolve();
            return finish.promise;
        };
        const download = harness.run(createOptions(tasks));
        await started.promise;
        expect(harness.result).toBeNull();
        finish.resolve(true);
        const result = await download;
        expect(result).toMatchObject({
            status: "ready",
            data: { chapters: [expect.objectContaining({ title: tasks[0].title })] }
        });
    });

    it("does not clear cached progress when export assembly fails", async () => {
        const tasks = [createDownloadTask()];
        const harness = createHarness(tasks);
        const options = createOptions(tasks);
        Object.defineProperty(options, "tags", {
            get() {
                throw new Error("export-metadata-invalid");
            }
        });
        await expect(harness.run(options)).rejects.toThrow("export-metadata-invalid");
        expect(harness.cacheClears).toEqual([]);
        expect(harness.result).toBeNull();
        expect(harness.dependencies.chapters.has(tasks[0].index)).toBe(true);
    });

    it("returns cancellation explicitly without an export snapshot", async () => {
        const tasks = [createDownloadTask()];
        const harness = createHarness(tasks);
        harness.dependencies.cancellation.requestCancellation("flush");
        expect(await harness.run(createOptions(tasks))).toEqual({ status: "cancelled", outcome: "saved" });
        expect(harness.cacheClears).toEqual([]);
    });

    it("downloads a middle range by absolute index without counting or exporting outside cache", async () => {
        const tasks = Array.from({ length: 20 }, (_, order) => createDownloadTask(order + 100));
        const chapters = new Map<number, Chapter>([
            [0, createChapter(0)],
            [100, createChapter(100)],
            [101, createChapter(101)]
        ]);
        const harness = createHarness(tasks, chapters);

        await harness.run(
            createOptions(tasks, {
                selection: {
                    mode: "range",
                    sourceTotalChapters: 120,
                    startIndex: 100,
                    endIndex: 119
                }
            })
        );

        expect(harness.processedIndexes).toEqual(Array.from({ length: 18 }, (_, order) => order + 102));
        expect(harness.exportData?.chapters).toHaveLength(20);
        expect(harness.exportData?.chapters[0]).toEqual(createChapter(100));
        expect(harness.exportData?.chapters.at(-1)).toEqual(createChapter(119));
        expect(harness.exportData?.exportContext?.selection).toEqual({
            mode: "range",
            sourceTotalChapters: 120,
            startChapter: 101,
            endChapter: 120
        });
        expect(harness.cacheClears).toEqual([]);
        expect(harness.cacheFinishes).toEqual([
            expect.objectContaining({ bookId: "100", taskId: "task-100", totalChapters: 120 })
        ]);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            scheduledCount: 20,
            restoredCount: 2,
            readyChapterCount: 20,
            persistedCount: 20
        });
        expect(harness.events.ofType("task-started")[0]).toMatchObject({
            bookChapterCount: 3,
            meta: { totalChapters: 120 }
        });
    });

    it("retries an uncertain range writer close once before publishing export data", async () => {
        const tasks = [createDownloadTask(10), createDownloadTask(11)];
        const harness = createHarness(tasks);
        const finishForTask = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"))
            .mockResolvedValueOnce(true);
        harness.dependencies.cache.finishForTask = finishForTask;

        await harness.run(
            createOptions(tasks, {
                selection: { mode: "range", sourceTotalChapters: 20, startIndex: 10, endIndex: 11 }
            })
        );

        expect(finishForTask).toHaveBeenCalledTimes(2);
        expect(harness.exportData?.chapters).toHaveLength(2);
        expect(harness.log).toHaveBeenCalledWith(expect.objectContaining({ code: "cache-write-retry" }));
    });

    it("waits for the protected queue before entering export preparation", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        const unlock = createDeferred<Awaited<ReturnType<typeof harness.dependencies.protectedChapterAuth.unlock>>>();
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword.mockResolvedValue({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });
        harness.dependencies.protectedChapterAuth.unlock = vi.fn(() => unlock.promise);

        const download = harness.run(createOptions(tasks));
        await vi.waitFor(() => expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledOnce());

        expect(harness.exportData).toBeNull();
        expect(harness.cacheClears).toHaveLength(0);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            readyChapterCount: 0,
            protectedDetectedCount: 1,
            protectedPendingCount: 1,
            protectedResolvedCount: 0,
            protectedSkippedCount: 0
        });

        unlock.resolve({ kind: "unlocked", html: "<p>unlocked body</p>" });
        await download;
        expect(harness.result?.status).toBe("ready");
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            readyChapterCount: 1,
            protectedDetectedCount: 1,
            protectedPendingCount: 0,
            protectedResolvedCount: 1,
            protectedSkippedCount: 0
        });
    });

    it("retries one technical failure automatically, then requires an explicit reconnect decision", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword
            .mockResolvedValueOnce({ action: "submit", password: "never-log-this", rememberPassword: true })
            .mockResolvedValueOnce({ action: "submit", password: "never-log-this", rememberPassword: true });
        harness.dependencies.protectedChapterAuth.unlock = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockRejectedValueOnce(new Error("still offline"))
            .mockResolvedValueOnce({ kind: "unlocked", html: "<p>unlocked body</p>" });

        await harness.run(createOptions(tasks));

        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledTimes(3);
        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledTimes(2);
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).toMatchObject({
            retryConnection: true,
            initialPassword: "never-log-this"
        });
        expect(harness.log.mock.calls.flat().join("\n")).not.toContain("never-log-this");
        expect(harness.events.ofType("chapter-failed")).toContainEqual(
            expect.objectContaining({ stage: "protected-auth", code: "network-error" })
        );
    });

    it("does not automatically retry password rejection or protocol failures", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword
            .mockResolvedValueOnce({ action: "submit", password: "wrong", rememberPassword: true })
            .mockResolvedValueOnce({ action: "submit", password: "right", rememberPassword: false })
            .mockResolvedValueOnce({ action: "submit", password: "right", rememberPassword: false });
        harness.dependencies.protectedChapterAuth.unlock = vi
            .fn()
            .mockResolvedValueOnce({ kind: "password-rejected", message: "密码不正确" })
            .mockResolvedValueOnce({ kind: "protocol-error", code: "token-invalid" })
            .mockResolvedValueOnce({ kind: "unlocked", html: "<p>unlocked body</p>" });

        await harness.run(createOptions(tasks));

        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledTimes(3);
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).toMatchObject({
            message: "密码不正确",
            rememberPassword: false
        });
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).not.toHaveProperty("initialPassword");
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[2][0]).toMatchObject({
            messageCode: "token-invalid",
            retryConnection: true
        });
        expect(harness.events.ofType("protected-chapter-password-rejected")).toEqual([
            expect.objectContaining({ task: expect.objectContaining({ index: 0 }) })
        ]);
    });

    it("re-prompts a skipped protected chapter during automatic retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword
            .mockResolvedValueOnce({ action: "skip-current" })
            .mockResolvedValueOnce({ action: "submit", password: "fictional-password", rememberPassword: false });
        harness.dependencies.protectedChapterAuth.unlock = vi.fn(
            async (): Promise<ProtectedChapterUnlockResult> => ({
                kind: "unlocked",
                html: "<p>recovered protected body</p>"
            })
        );

        await harness.run(createOptions(tasks));

        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledTimes(2);
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).toMatchObject({
            task: tasks[0],
            pendingCount: 1
        });
        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledOnce();
        expect(harness.ui.confirmIncompleteChapters).not.toHaveBeenCalled();
        expect(harness.dependencies.chapters.has(0)).toBe(true);
        expect(harness.exportData?.chapters).toHaveLength(1);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            readyChapterCount: 1,
            protectedDetectedCount: 1,
            protectedPendingCount: 0,
            protectedResolvedCount: 1,
            protectedSkippedCount: 0
        });
    });

    it("keeps skip-all scoped to the current protected retry round", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword.mockResolvedValue({ action: "skip-all" });

        await harness.run(createOptions(tasks));

        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.protectedChapterAuth.unlock).not.toHaveBeenCalled();
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.log).toHaveBeenCalledWith(expect.objectContaining({ code: "protected-chapter-retry-skipped" }));
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            protectedDetectedCount: 2,
            protectedPendingCount: 0,
            protectedResolvedCount: 0,
            protectedSkippedCount: 2
        });
    });

    it("re-prompts after an explicit missing-chapter retry starts a new round", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword
            .mockResolvedValueOnce({ action: "skip-current" })
            .mockResolvedValueOnce({ action: "skip-all" })
            .mockResolvedValueOnce({ action: "submit", password: "fictional-password", rememberPassword: false });
        harness.ui.confirmIncompleteChapters.mockResolvedValue("retry");
        harness.dependencies.protectedChapterAuth.unlock = vi.fn(
            async (): Promise<ProtectedChapterUnlockResult> => ({
                kind: "unlocked",
                html: "<p>explicit retry body</p>"
            })
        );

        await harness.run(createOptions(tasks));

        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledTimes(3);
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledOnce();
        expect(harness.exportData?.chapters[0].content).not.toContain("[章节缺失]");
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            readyChapterCount: 1,
            protectedDetectedCount: 1,
            protectedPendingCount: 0,
            protectedResolvedCount: 1,
            protectedSkippedCount: 0
        });
    });

    it("cancels cleanly while a protected retry prompt is pending", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword
            .mockResolvedValueOnce({ action: "skip-current" })
            .mockImplementationOnce(
                (_prompt: ProtectedChapterPrompt, signal?: AbortSignal) =>
                    new Promise<ProtectedChapterDecision>((resolve) => {
                        if (signal?.aborted) {
                            resolve({ action: "cancel" });
                            return;
                        }
                        signal?.addEventListener("abort", () => resolve({ action: "cancel" }), { once: true });
                    })
            );

        const download = harness.run(createOptions(tasks));
        await vi.waitFor(() => expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledTimes(2));

        harness.dependencies.cancellation.requestCancellation("flush");
        await download;

        expect(harness.exportData).toBeNull();
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "cancelled",
            cancellationRequested: true,
            protectedPendingCount: 0
        });
    });

    it("keeps popup cancellation connected while protected authorization is pending", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        let cancelPendingAuthorization: (() => void) | undefined;
        harness.ui.promptProtectedChapterPassword.mockImplementationOnce(async (_prompt, _signal, onPending) => {
            cancelPendingAuthorization = () => onPending?.({ action: "cancel" });
            return { action: "submit", password: "fictional-password", rememberPassword: false };
        });
        harness.dependencies.protectedChapterAuth.unlock = vi.fn(
            async (_task: DownloadTask, _html: string, _password: string, signal?: AbortSignal) =>
                new Promise<ProtectedChapterUnlockResult>((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), {
                        once: true
                    });
                })
        );

        const download = harness.run(createOptions(tasks));
        await vi.waitFor(() => expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledOnce());
        cancelPendingAuthorization?.();
        await download;

        expect(harness.dependencies.cancellation.requestCancellation).toHaveBeenCalledWith("flush");
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "cancelled",
            cancellationRequested: true,
            protectedPendingCount: 0
        });
    });

    it("starts resumed progress from valid cached chapters and only schedules missing chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const harness = createHarness(
            tasks,
            new Map([
                [0, createChapter(0)],
                [1, createChapter(1)]
            ])
        );

        await harness.run(createOptions(tasks));

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([2]);
        expect(harness.processedIndexes).toEqual([2]);
        expect(harness.events.ofType("chapter-restored")).toHaveLength(2);
        expect(
            harness.ui.snapshots.find((snapshot) => snapshot.phase === "downloading" && snapshot.completedCount === 2)
        ).toMatchObject({ restoredCount: 2, readyChapterCount: 2 });
        expect(harness.dependencies.log).not.toHaveBeenCalledWith(
            expect.objectContaining({ code: "cache-restore-started", params: { count: 0 } })
        );
    });

    it("honors cancellation after yielding during cache validation", async () => {
        const tasks = Array.from({ length: 30 }, (_, index) => createDownloadTask(index));
        const chapters = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));
        const harness = createHarness(tasks, chapters);
        harness.dependencies.scheduler.sleepWithAbort = vi.fn(async () => {
            harness.dependencies.cancellation.requestCancellation();
        });

        await harness.run(createOptions(tasks));

        expect(harness.fetcher.calls).toHaveLength(0);
        expect(harness.exportData).toBeNull();
        expect(harness.ui.snapshots).toContainEqual(expect.objectContaining({ phase: "cancelled" }));
    });

    it("asks for consent once and publishes a persistent summary for mapped chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));

        await harness.run(createOptions(tasks));

        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[0], chapterCount: 1, fontBytes: 64, inFlightLimit: 1 }),
            expect.any(AbortSignal)
        );
        expect(harness.ui.updateMappingFontWarning).toHaveBeenLastCalledWith({ chapterCount: 2, fontBytes: 128 });
        expect(harness.result?.status).toBe("ready");
    });

    it("stops without publishing export data when mapped chapter consent is rejected", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));
        harness.ui.confirmMappingFontDownload.mockResolvedValue(false);

        await harness.run(createOptions(tasks));

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([0]);
        expect(harness.exportData).toBeNull();
        expect(harness.ui.cleanup).toHaveBeenCalledOnce();
    });

    it("blocks export and reports chapters whose mapped font remains invalid after retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async () => {
            throw new MappingFontError("woff2-invalid", "woff2-signature-invalid");
        };

        await expect(harness.run(createOptions(tasks))).rejects.toMatchObject({
            code: "font-source-invalid",
            reason: "chapter-structure-invalid",
            params: { count: 1 }
        });

        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledOnce();
        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledWith([
            expect.objectContaining({
                task: tasks[0],
                code: "woff2-invalid",
                reason: "woff2-signature-invalid",
                params: {}
            })
        ]);
        expect(harness.ui.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
            harness.ui.showMappingFontFailure.mock.invocationCallOrder[0]
        );
        expect(harness.ui.showTerminalFailure).not.toHaveBeenCalled();
        expect(harness.exportData).toBeNull();
    });

    it("retries an unexpected storage abort once and still completes", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        const putBatch = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"))
            .mockResolvedValueOnce(true);
        harness.dependencies.cache.putBatch = putBatch;

        await harness.run(createOptions(tasks));

        expect(putBatch).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.log).toHaveBeenCalledWith(expect.objectContaining({ code: "cache-write-retry" }));
        expect(harness.result?.status).toBe("ready");
    });

    it("propagates a classified storage failure without turning it into user cancellation", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.cache.putBatch = vi.fn(async () => false);

        await expect(harness.run(createOptions(tasks))).rejects.toMatchObject({
            reason: "ownership-lost",
            operation: "write"
        });

        expect(harness.dependencies.cancellation.requestCancellation).not.toHaveBeenCalled();
        expect(harness.exportData).toBeNull();
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "failed",
            storageFailure: { reason: "ownership-lost", operation: "write" }
        });
        expect(harness.events.ofType("cache-write-finished").at(-1)).toMatchObject({
            saved: false,
            failure: { reason: "ownership-lost", operation: "write" }
        });
        expect(harness.ui.showTerminalFailure).toHaveBeenCalledWith({
            kind: "download",
            code: "ownership-lost",
            params: { operation: "write" },
            storageFailure: expect.objectContaining({ reason: "ownership-lost", operation: "write" })
        });
        expect(harness.ui.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
            harness.ui.showTerminalFailure.mock.invocationCallOrder[0]
        );
    });

    it("requires an explicit decision and exports safe placeholders without caching them", async () => {
        const tasks = [
            createDownloadTask(0, {
                title: "第 <script> 章",
                url: "https://www.esjzone.cc/forum/100/1.html?from=<unsafe>"
            })
        ];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });

        await harness.run(createOptions(tasks));

        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledWith(
            { missingTasks: tasks, totalChapters: 1 },
            expect.any(AbortSignal)
        );
        expect(harness.exportData?.txt).toContain("[章节缺失]");
        expect(harness.exportData?.txt).toContain("https://www.esjzone.cc/forum/100/1.html?from=%3Cunsafe%3E");
        expect(harness.exportData?.chapters[0].content).toContain("第 &lt;script&gt; 章");
        expect(harness.exportData?.chapters[0].content).not.toContain("<script>");
        expect(harness.exportData?.exportContext?.chapterSummary).toEqual({ totalCount: 1, missingCount: 1 });
        expect(harness.dependencies.chapters.size).toBe(0);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "export-ready",
            readyChapterCount: 0,
            failedCount: 1
        });
        expect(harness.events.ofType("incomplete-chapters-decided")).toEqual([
            expect.objectContaining({ decision: "export-with-placeholders", missingCount: 1 })
        ]);
    });

    it("recovers a missing chapter after the user requests another retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error("main 1"))
            .mockRejectedValueOnce(new Error("main 2"))
            .mockRejectedValueOnce(new Error("main 3"))
            .mockRejectedValueOnce(new Error("automatic 1"))
            .mockRejectedValueOnce(new Error("automatic 2"))
            .mockRejectedValueOnce(new Error("automatic 3"))
            .mockResolvedValue("<p>recovered</p>");
        harness.dependencies.chapterFetcher.fetch = fetch;
        harness.ui.confirmIncompleteChapters.mockResolvedValue("retry");

        await harness.run(createOptions(tasks));

        expect(fetch).toHaveBeenCalledTimes(7);
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.exportData?.chapters[0].content).not.toContain("[章节缺失]");
        expect(harness.ui.snapshots.at(-1)).toMatchObject({ failedCount: 0, readyChapterCount: 1 });
        expect(harness.dependencies.log).toHaveBeenCalledWith({ code: "missing-chapter-retry-saved" });
    });

    it("offers another decision when an explicit retry still fails", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });
        harness.ui.confirmIncompleteChapters
            .mockResolvedValueOnce("retry")
            .mockResolvedValueOnce("export-with-placeholders");

        await harness.run(createOptions(tasks));

        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledTimes(2);
        expect(harness.events.ofType("incomplete-chapters-decided")).toEqual([
            expect.objectContaining({ decision: "retry", missingCount: 1 }),
            expect.objectContaining({ decision: "export-with-placeholders", missingCount: 1 })
        ]);
        expect(harness.exportData?.chapters[0].content).toContain("[章节缺失]");
    });

    it("keeps mapping font failures blocking after an explicit missing chapter retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error("main 1"))
            .mockRejectedValueOnce(new Error("main 2"))
            .mockRejectedValueOnce(new Error("main 3"))
            .mockRejectedValueOnce(new Error("automatic 1"))
            .mockRejectedValueOnce(new Error("automatic 2"))
            .mockRejectedValueOnce(new Error("automatic 3"))
            .mockResolvedValue("<p>mapped</p>");
        harness.dependencies.chapterProcessor.process = async () => {
            throw new MappingFontError("woff2-invalid", "woff2-signature-invalid");
        };
        harness.ui.confirmIncompleteChapters.mockResolvedValue("retry");

        await expect(harness.run(createOptions(tasks))).rejects.toMatchObject({
            code: "font-source-invalid",
            reason: "chapter-structure-invalid",
            params: { count: 1 }
        });

        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledWith([
            expect.objectContaining({
                task: tasks[0],
                code: "woff2-invalid",
                reason: "woff2-signature-invalid",
                params: {}
            })
        ]);
        expect(harness.exportData).toBeNull();
    });

    it("cancels and preserves the current cache when the user declines incomplete export", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });
        harness.ui.confirmIncompleteChapters.mockResolvedValue("cancel");

        await harness.run(createOptions(tasks));

        expect(harness.dependencies.cancellation.requestCancellation).toHaveBeenCalledWith("flush");
        expect(harness.exportData).toBeNull();
        expect(harness.cacheClears).toHaveLength(0);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "cancelled",
            cancellationOutcome: "saved",
            hasExportData: false
        });
    });

    it("settles an open incomplete chapter decision when cancellation wins the race", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });
        harness.ui.confirmIncompleteChapters.mockImplementation(
            async (_detection, signal) =>
                new Promise<IncompleteChapterDecision>((resolve) => {
                    signal?.addEventListener("abort", () => resolve("cancel"), { once: true });
                })
        );

        const download = harness.run(createOptions(tasks));
        await vi.waitFor(() => expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce());
        harness.dependencies.cancellation.requestCancellation("flush");
        await download;

        expect(harness.ui.snapshots.at(-1)).toMatchObject({ phase: "cancelled", cancellationOutcome: "saved" });
        expect(harness.exportData).toBeNull();
    });

    it("does not prompt for chapters that only retain image failures", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async () => createChapter(0, { imageErrors: 1 });

        await harness.run(createOptions(tasks, { imageEnabled: true }));

        expect(harness.ui.confirmIncompleteChapters).not.toHaveBeenCalled();
        expect(harness.exportData?.chapters).toHaveLength(1);
    });
});

function createMappedChapter(index: number, family: string): Chapter {
    return createChapter(index, {
        content: `<section style="font-family: '${family}', sans-serif;"><p>Mapped body</p></section>`,
        mappingFont: {
            family,
            blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
            mediaType: "font/woff2",
            sha256: family.padStart(64, "a")
        }
    });
}

function createOptions(tasks: DownloadTask[], overrides: Partial<DownloadOptions> = {}): DownloadOptions {
    return { ...createOptionsBase(tasks), ...overrides };
}

function createOptionsBase(tasks: DownloadTask[]) {
    return {
        bookId: "100",
        taskId: "task-100",
        bookName: "测试小说",
        rawBookName: "测试小说",
        author: "测试作者",
        introTxt: "测试简介\n",
        description: "测试描述",
        tags: [],
        pageUrl: "https://www.esjzone.cc/detail/100.html",
        sourcePageType: "detail" as const,
        imageEnabled: false,
        tasks
    };
}
