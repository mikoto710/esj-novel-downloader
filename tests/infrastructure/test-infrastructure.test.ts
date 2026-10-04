// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
    FakeChapterFetcher,
    FakeChapterProcessor,
    InMemoryCacheRepository,
    TestResourceTracker,
    closeTestDatabase,
    createChapter,
    createDownloadTask,
    deleteTestDatabase,
    getUserscriptApiMocks,
    installFakeBroadcastChannel,
    openTestDatabase,
    trackEventListener
} from "../support";

describe("test infrastructure", () => {
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
