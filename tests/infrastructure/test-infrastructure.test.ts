// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
    FakeBookLockService,
    FakeChapterFetcher,
    FakeChapterProcessor,
    InMemoryCacheRepository,
    RecordingDownloadEvents,
    RecordingUiObserver,
    TestResourceTracker,
    closeTestDatabase,
    createChapter,
    createChapterFixture,
    createDeferred,
    createDetailPageFixture,
    createDownloadTask,
    createForumPageFixture,
    deleteTestDatabase,
    getUserscriptApiMocks,
    installFakeBroadcastChannel,
    openTestDatabase,
    trackEventListener,
    useFakeClock
} from "../support";

describe("test infrastructure", () => {
    it("installs isolated userscript API mocks for every test", () => {
        GM_setValue("concurrency", 5);

        expect(GM_getValue("concurrency", 1)).toBe(5);
        expect(getUserscriptApiMocks().setValue).toHaveBeenCalledWith("concurrency", 5);
        expect(GM_info.script?.version).toBe("0.0.0-test");
    });

    it("drives GM request success and abort callbacks", () => {
        const onload = vi.fn();
        const onabort = vi.fn();
        GM_xmlhttpRequest({ url: "https://example.com/chapter", onload });
        const mocks = getUserscriptApiMocks();

        mocks.respond(0, { responseText: "chapter" });
        expect(onload).toHaveBeenCalledWith(expect.objectContaining({ status: 200, responseText: "chapter" }));

        const request = GM_xmlhttpRequest({ url: "https://example.com/pending", onabort });
        request.abort();
        request.abort();
        expect(onabort).toHaveBeenCalledOnce();
    });

    it("controls deferred work and virtual time without real waiting", async () => {
        const clock = useFakeClock();
        const deferred = createDeferred<string>();
        const callback = vi.fn();
        setTimeout(callback, 3_000);

        await clock.advanceBy(2_999);
        expect(callback).not.toHaveBeenCalled();
        deferred.resolve("done");

        await clock.advanceBy(1);
        await expect(deferred.promise).resolves.toBe("done");
        expect(callback).toHaveBeenCalledOnce();
        clock.restore();
    });

    it("creates detail, forum, and chapter fixtures", () => {
        const detail = createDetailPageFixture({ chapterCount: 2 });
        const forum = createForumPageFixture("100");
        const chapter = createChapterFixture({ title: "测试章节" });

        expect(detail.querySelectorAll("#chapterList a")).toHaveLength(2);
        expect(detail.querySelector(".book-detail h2")?.textContent).toBe("测试小说");
        expect(forum.querySelector(".forum-list-page")?.getAttribute("data-book-id")).toBe("100");
        expect(chapter).toContain("测试章节");
        expect(chapter).toContain("forum-content");
    });

    it("drives fetcher and processor outcomes deterministically", async () => {
        const task = createDownloadTask();
        const fetcher = new FakeChapterFetcher().succeed(task.url, "<p>ok</p>");
        const processor = new FakeChapterProcessor().succeed(task.index, createChapter(task.index));

        const html = await fetcher.fetch(task);
        const chapter = await processor.process(html, task);

        expect(html).toBe("<p>ok</p>");
        expect(chapter.title).toBe("第 1 章");
        expect(fetcher.calls).toEqual([task]);
        expect(processor.calls).toHaveLength(1);
    });

    it("aborts deferred fetch and processing work", async () => {
        const task = createDownloadTask();
        const fetcher = new FakeChapterFetcher();
        const processor = new FakeChapterProcessor();
        fetcher.defer(task.url);
        processor.defer(task.index);
        const fetchAbort = new AbortController();
        const processAbort = new AbortController();

        const fetchPromise = fetcher.fetch(task, fetchAbort.signal);
        const processPromise = processor.process("<p>pending</p>", task, processAbort.signal);
        fetchAbort.abort();
        processAbort.abort();

        await expect(fetchPromise).rejects.toMatchObject({ name: "AbortError" });
        await expect(processPromise).rejects.toMatchObject({ name: "AbortError" });
    });

    it("enforces cache ownership and records incremental writes", async () => {
        const repository = new InMemoryCacheRepository();
        await repository.claim("100", "task-100");
        await repository.putBatch("100", "task-100", new Map([[0, createChapter(0)]]));

        await expect(repository.putBatch("100", "stale-task", new Map([[1, createChapter(1)]]))).rejects.toThrow(
            "ownership-lost"
        );
        expect(await repository.load("100")).toHaveLength(1);
        expect(repository.operations).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "put", indexes: [0] })])
        );
    });

    it("provides a fake lock and recording observers", async () => {
        const locks = new FakeBookLockService();
        const acquired = await locks.acquire("100");
        expect(acquired.acquired).toBe(true);
        if (!acquired.acquired) {
            throw new Error("expected acquired lock");
        }

        const events = new RecordingDownloadEvents<{ type: string; count: number }>();
        const ui = new RecordingUiObserver<{ phase: string }>();
        events.emit({ type: "progress", count: 1 });
        ui.update({ phase: "downloading" });

        expect(await locks.markRunning(acquired.lock)).toBe(true);
        expect(events.ofType("progress")).toHaveLength(1);
        expect(ui.latest()).toEqual({ phase: "downloading" });
        await locks.release(acquired.lock);
    });

    it("tracks BroadcastChannel and IndexedDB cleanup", async () => {
        const BroadcastChannelMock = installFakeBroadcastChannel();
        const sender = new BroadcastChannelMock("cache-sync");
        const receiver = new BroadcastChannelMock("cache-sync");
        const received: unknown[] = [];
        receiver.onmessage = (event) => received.push(event.data);

        sender.postMessage({ type: "cache-saved" });
        await Promise.resolve();
        expect(received).toEqual([{ type: "cache-saved" }]);

        sender.close();
        receiver.close();

        const databaseName = "esj-test-infrastructure";
        const database = await openTestDatabase(databaseName);
        expect(database.objectStoreNames.contains("records")).toBe(true);
        closeTestDatabase(database);
        await deleteTestDatabase(databaseName);
    });

    it("reports tracked resources before cleaning them", async () => {
        const tracker = new TestResourceTracker();
        const cleanup = vi.fn();
        tracker.track("custom", "sample", cleanup);

        expect(tracker.list()).toEqual(["custom:sample"]);
        await expect(tracker.cleanup()).resolves.toEqual(["custom:sample"]);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(tracker.list()).toEqual([]);
    });

    it("tracks and releases event listeners", () => {
        const target = new EventTarget();
        const listener = vi.fn();
        const remove = trackEventListener(target, "change", listener);

        target.dispatchEvent(new Event("change"));
        remove();
        target.dispatchEvent(new Event("change"));

        expect(listener).toHaveBeenCalledOnce();
    });
});
