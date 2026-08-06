import { describe, expect, it, vi } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
import type {
    DownloadDependencies,
    DownloadEvent,
    IncompleteChapterDecision,
    IncompleteChapterDetection,
    DownloadSnapshot,
    DownloadTask,
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterUnlockResult
} from "../../src/core/download/contracts";
import type { CachedData, Chapter, RuntimeCacheSession } from "../../src/types";
import {
    createChapter,
    createDeferred,
    createDownloadTask,
    FakeChapterFetcher,
    RecordingDownloadEvents
} from "../support";
import { MappingFontError } from "../../src/core/mapping-font";

describe("runDownload characterization", () => {
    it("processes protected chapters through the live queue and existing chapter pipeline", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async (task) =>
            task.index === 1 ? "<protected>password form</protected>" : `<p>${task.title}</p>`
        );
        harness.dependencies.protectedChapterDetector.isProtected = vi.fn((html) => html.includes("<protected>"));
        harness.ui.promptProtectedChapterPassword.mockResolvedValue({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });
        harness.dependencies.protectedChapterAuth.unlock = vi.fn(
            async (): Promise<ProtectedChapterUnlockResult> => ({
                kind: "unlocked",
                html: "<p>unlocked body</p>"
            })
        );

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[1], totalChapters: 3 }),
            expect.any(AbortSignal)
        );
        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledWith(
            tasks[1],
            "<protected>password form</protected>",
            "fictional-password",
            expect.any(AbortSignal)
        );
        expect(harness.processedIndexes.sort((a, b) => a - b)).toEqual([0, 1, 2]);
        expect(harness.exportData?.chapters).toHaveLength(3);
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

        const download = runDownload(createOptions(tasks), harness.dependencies);
        await vi.waitFor(() => expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledOnce());

        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
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
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
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

        await runDownload(createOptions(tasks), harness.dependencies);

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
            .mockResolvedValueOnce({ kind: "protocol-error", code: "token-invalid", message: "授权响应异常" })
            .mockResolvedValueOnce({ kind: "unlocked", html: "<p>unlocked body</p>" });

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.dependencies.protectedChapterAuth.unlock).toHaveBeenCalledTimes(3);
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).toMatchObject({
            message: "密码不正确",
            rememberPassword: false
        });
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[1][0]).not.toHaveProperty("initialPassword");
        expect(harness.ui.promptProtectedChapterPassword.mock.calls[2][0]).toMatchObject({
            message: "授权响应异常",
            retryConnection: true
        });
    });

    it("keeps a skipped protected chapter out of the chapter map and reuses the incomplete decision", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => "<protected>password form</protected>");
        harness.dependencies.protectedChapterDetector.isProtected = () => true;
        harness.ui.promptProtectedChapterPassword.mockResolvedValue({ action: "skip-current" });

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.ui.promptProtectedChapterPassword).toHaveBeenCalledOnce();
        expect(harness.dependencies.protectedChapterAuth.unlock).not.toHaveBeenCalled();
        expect(harness.dependencies.runtime.chapters.has(0)).toBe(false);
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledWith(
            { missingTasks: tasks, totalChapters: 1 },
            expect.any(AbortSignal)
        );
        expect(harness.exportData?.chapters).toHaveLength(1);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            readyChapterCount: 0,
            protectedDetectedCount: 1,
            protectedPendingCount: 0,
            protectedResolvedCount: 0,
            protectedSkippedCount: 1
        });
    });

    it("runs without DOM, IndexedDB, GM APIs, or global application state", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks, new Map([[0, createChapter(0)]]));

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([1]);
        expect(harness.processedIndexes).toEqual([1]);
        expect(harness.exportData?.chapters.map((chapter) => chapter.title)).toEqual(["第 1 章", "第 2 章"]);
        expect(harness.cacheClears).toEqual([{ bookId: "100", taskId: "task-100" }]);
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
        expect(harness.ui.cleanup).toHaveBeenCalledOnce();
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

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([2]);
        expect(harness.processedIndexes).toEqual([2]);
        expect(harness.events.ofType("chapter-restored")).toHaveLength(2);
        expect(
            harness.ui.snapshots.find((snapshot) => snapshot.phase === "downloading" && snapshot.completedCount === 2)
        ).toMatchObject({ restoredCount: 2, cachedChapterCount: 2 });
        expect(harness.dependencies.log).not.toHaveBeenCalledWith(expect.stringContaining("正在预检"));
    });

    it("yields while validating a large restored cache", async () => {
        const tasks = Array.from({ length: 51 }, (_, index) => createDownloadTask(index));
        const chapters = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));
        const harness = createHarness(tasks, chapters);
        const sleepWithAbort = vi.fn(async () => undefined);
        harness.dependencies.scheduler.sleepWithAbort = sleepWithAbort;

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(sleepWithAbort).toHaveBeenCalledTimes(3);
        expect(sleepWithAbort).toHaveBeenCalledWith(0);
        expect(harness.dependencies.log).toHaveBeenCalledWith("💾 读取到 51 章缓存，正在校验...");
        expect(harness.dependencies.log).toHaveBeenCalledWith("💾 已恢复 51 章缓存");
        expect(harness.fetcher.calls).toHaveLength(0);
    });

    it("honors cancellation after yielding during cache validation", async () => {
        const tasks = Array.from({ length: 30 }, (_, index) => createDownloadTask(index));
        const chapters = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));
        const harness = createHarness(tasks, chapters);
        harness.dependencies.scheduler.sleepWithAbort = vi.fn(async () => {
            harness.dependencies.runtime.requestCancellation();
        });

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls).toHaveLength(0);
        expect(harness.exportData).toBeNull();
        expect(harness.ui.snapshots).toContainEqual(expect.objectContaining({ phase: "cancelled" }));
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
    });

    it("publishes structured phases and progress while preserving small-download results", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(
            harness.events
                .ofType("phase-changed")
                .map((event) => (event as Extract<DownloadEvent, { type: "phase-changed" }>).current)
        ).toEqual([
            "preparing",
            "restoring-cache",
            "downloading",
            "flushing-cache",
            "checking-integrity",
            "flushing-cache",
            "preparing-export",
            "export-ready"
        ]);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "export-ready",
            scheduledCount: 2,
            fetchedCount: 2,
            processedCount: 2,
            completedCount: 2,
            hasExportData: true
        });
        expect(harness.exportData?.txt).toContain("第 1 章正文");
        expect(harness.exportData?.txt).toContain("第 2 章正文");
        expect(harness.dependencies.log).not.toHaveBeenCalledWith("💾 已恢复 0 章缓存");
    });

    it("asks for consent once and publishes a persistent summary for mapped chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[0], chapterCount: 1, fontBytes: 64, inFlightLimit: 1 }),
            expect.any(AbortSignal)
        );
        expect(harness.ui.updateMappingFontWarning).toHaveBeenLastCalledWith({ chapterCount: 2, fontBytes: 128 });
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
    });

    it("stops without publishing export data when mapped chapter consent is rejected", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));
        harness.ui.confirmMappingFontDownload.mockResolvedValue(false);

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([0]);
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
        expect(harness.exportData).toBeNull();
        expect(harness.ui.cleanup).toHaveBeenCalledOnce();
    });

    it("blocks export and reports chapters whose mapped font remains invalid after retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async () => {
            throw new MappingFontError("woff2-invalid", "invalid test font");
        };

        await expect(runDownload(createOptions(tasks), harness.dependencies)).rejects.toThrow(
            "1 个章节的映射字体无法解析"
        );

        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledOnce();
        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledWith([
            expect.objectContaining({ task: tasks[0], message: expect.stringContaining("invalid test font") })
        ]);
        expect(harness.ui.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
            harness.ui.showMappingFontFailure.mock.invocationCallOrder[0]
        );
        expect(harness.ui.showTerminalFailure).not.toHaveBeenCalled();
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
    });

    it("retries an unexpected storage abort once and still completes", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        const putBatch = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"))
            .mockResolvedValueOnce(true);
        harness.dependencies.cache.putBatch = putBatch;

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(putBatch).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.log).toHaveBeenCalledWith(expect.stringContaining("正在进行一次安全重试"));
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
    });

    it("propagates a classified storage failure without turning it into user cancellation", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.cache.putBatch = vi.fn(async () => false);

        await expect(runDownload(createOptions(tasks), harness.dependencies)).rejects.toMatchObject({
            reason: "ownership-lost",
            operation: "write"
        });

        expect(harness.dependencies.runtime.requestCancellation).not.toHaveBeenCalled();
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
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
            message: expect.any(String),
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

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledWith(
            { missingTasks: tasks, totalChapters: 1 },
            expect.any(AbortSignal)
        );
        expect(harness.exportData?.txt).toContain("[章节缺失]");
        expect(harness.exportData?.txt).toContain("https://www.esjzone.cc/forum/100/1.html?from=%3Cunsafe%3E");
        expect(harness.exportData?.chapters[0].content).toContain("第 &lt;script&gt; 章");
        expect(harness.exportData?.chapters[0].content).not.toContain("<script>");
        expect(harness.exportData?.exportContext?.chapterInfo).toBe("共 1 章（1 章缺失占位）");
        expect(harness.dependencies.runtime.chapters.size).toBe(0);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "export-ready",
            cachedChapterCount: 0,
            failedCount: 1
        });
        expect(harness.events.ofType("incomplete-chapters-decided")).toEqual([
            expect.objectContaining({ decision: "export-with-placeholders", missingCount: 1 })
        ]);
    });

    it("retries only missing chapters and rescans after the retry flush", async () => {
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

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(fetch).toHaveBeenCalledTimes(7);
        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.exportData?.chapters[0].content).not.toContain("[章节缺失]");
        expect(harness.ui.snapshots.at(-1)).toMatchObject({ failedCount: 0, cachedChapterCount: 1 });
        expect(harness.dependencies.log).toHaveBeenCalledWith("再次补抓完成，正在保存下载进度...");
    });

    it("shows the updated decision again when an explicit retry still fails", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });
        harness.ui.confirmIncompleteChapters
            .mockResolvedValueOnce("retry")
            .mockResolvedValueOnce("export-with-placeholders");

        await runDownload(createOptions(tasks), harness.dependencies);

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
            throw new MappingFontError("woff2-invalid", "invalid retry font");
        };
        harness.ui.confirmIncompleteChapters.mockResolvedValue("retry");

        await expect(runDownload(createOptions(tasks), harness.dependencies)).rejects.toThrow(
            "1 个章节的映射字体无法解析"
        );

        expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce();
        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledWith([
            expect.objectContaining({ task: tasks[0], message: expect.stringContaining("invalid retry font") })
        ]);
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
    });

    it("cancels and preserves the current cache when the user declines incomplete export", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterFetcher.fetch = vi.fn(async () => {
            throw new Error("offline");
        });
        harness.ui.confirmIncompleteChapters.mockResolvedValue("cancel");

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.dependencies.runtime.requestCancellation).toHaveBeenCalledWith("flush");
        expect(harness.exportData).toBeNull();
        expect(harness.cacheClears).toHaveLength(0);
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
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

        const download = runDownload(createOptions(tasks), harness.dependencies);
        await vi.waitFor(() => expect(harness.ui.confirmIncompleteChapters).toHaveBeenCalledOnce());
        harness.dependencies.runtime.requestCancellation("flush");
        await download;

        expect(harness.ui.snapshots.at(-1)).toMatchObject({ phase: "cancelled", cancellationOutcome: "saved" });
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
    });

    it("does not prompt for chapters that only retain image failures", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async () => createChapter(0, { imageErrors: 1 });

        await runDownload(createOptions(tasks, { imageEnabled: true }), harness.dependencies);

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

function createHarness(tasks: DownloadTask[], chapters = new Map<number, Chapter>()) {
    const fetcher = new FakeChapterFetcher();
    for (const task of tasks) {
        fetcher.succeed(task.url, `<p>${task.title}</p>`);
    }
    const events = new RecordingDownloadEvents<DownloadEvent>();
    const processedIndexes: number[] = [];
    const cacheClears: Array<{ bookId: string; taskId: string }> = [];
    const ui = {
        snapshots: [] as DownloadSnapshot[],
        prepare: vi.fn(),
        update(snapshot: DownloadSnapshot) {
            this.snapshots.push(snapshot);
        },
        confirmMappingFontDownload: vi.fn(async () => true),
        confirmIncompleteChapters: vi.fn<
            (detection: IncompleteChapterDetection, signal?: AbortSignal) => Promise<IncompleteChapterDecision>
        >(async () => "export-with-placeholders"),
        promptProtectedChapterPassword: vi.fn(
            async (_prompt: ProtectedChapterPrompt, _signal?: AbortSignal): Promise<ProtectedChapterDecision> => ({
                action: "skip-current"
            })
        ),
        closeProtectedChapterPrompt: vi.fn(),
        updateMappingFontWarning: vi.fn(),
        showMappingFontFailure: vi.fn(),
        showTerminalFailure: vi.fn(),
        cleanup: vi.fn(),
        showFormatChoice: vi.fn()
    };
    const protectedChapterDetector = { isProtected: vi.fn(() => false) };
    const protectedChapterAuth = {
        unlock: vi.fn(
            async (): Promise<ProtectedChapterUnlockResult> => ({
                kind: "protocol-error",
                code: "response-invalid",
                message: "unused"
            })
        )
    };
    let exportData: CachedData | null = null;
    let runtimeSession: RuntimeCacheSession | null = null;
    let cancellationRequested = false;
    const abortController = new AbortController();

    const log = vi.fn();
    const dependencies: DownloadDependencies = {
        runtime: {
            chapters,
            signal: abortController.signal,
            activeBookLock: null,
            originalTitle: "Test",
            isCancellationRequested: () => cancellationRequested,
            requestCancellation: vi.fn(() => {
                cancellationRequested = true;
                abortController.abort();
            }),
            subscribeCancellation: () => () => undefined,
            startCacheSession(meta, taskId, initialChapterCount) {
                runtimeSession = {
                    ...meta,
                    taskId,
                    completedCount: 0,
                    cachedChapterCount: initialChapterCount,
                    status: "downloading",
                    hasExportData: false
                };
            },
            updateCacheSession(progress) {
                if (runtimeSession) {
                    runtimeSession = { ...runtimeSession, ...progress };
                }
            },
            setExportData(data) {
                exportData = data;
            }
        },
        ui,
        chapterFetcher: fetcher,
        chapterProcessor: {
            async process(_html, task) {
                processedIndexes.push(task.index);
                return createChapter(task.index);
            }
        },
        protectedChapterDetector,
        protectedChapterAuth,
        coverFetcher: { fetch: async () => null },
        coverCache: { load: async () => null, put: async () => true },
        cache: {
            putBatch: async () => true,
            async clearForTask(bookId, taskId) {
                cacheClears.push({ bookId, taskId });
                return true;
            }
        },
        lock: {
            owns: async () => true,
            shouldDiscardCache: async () => false
        },
        events,
        scheduler: {
            sleep: async () => undefined,
            sleepWithAbort: async () => undefined,
            randomDelay: () => 0,
            schedule: () => () => undefined
        },
        settings: {
            getConcurrency: () => 1
        },
        environment: {
            currentUrl: () => "https://www.esjzone.cc/detail/100.html",
            now: () => Date.parse("2026-01-01T00:00:00.000Z")
        },
        log
    };

    return {
        dependencies,
        events,
        fetcher,
        processedIndexes,
        cacheClears,
        ui,
        log,
        get exportData() {
            return exportData;
        }
    };
}

function createOptions(tasks: DownloadTask[], overrides: Partial<ReturnType<typeof createOptionsBase>> = {}) {
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
