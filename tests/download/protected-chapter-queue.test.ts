import { describe, expect, it } from "vitest";
import { ProtectedChapterQueue } from "../../src/download/protected-chapter-queue";
import { createDeferred, createDownloadTask } from "../support";

describe("ProtectedChapterQueue", () => {
    it("keeps the active item and sorts later discoveries by original chapter index", async () => {
        const queue = new ProtectedChapterQueue();
        const waitingConsumer = createDeferred<void>();
        const firstTake = queue.take().then((value) => {
            waitingConsumer.resolve();
            return value;
        });
        queue.enqueue(createDownloadTask(64));
        await waitingConsumer.promise;
        queue.enqueue(createDownloadTask(53));
        queue.enqueue(createDownloadTask(35));

        expect((await firstTake)?.index).toBe(64);
        expect((await queue.take())?.index).toBe(35);
        expect((await queue.take())?.index).toBe(53);
    });

    it("deduplicates repeated discoveries by task index", async () => {
        const queue = new ProtectedChapterQueue();

        expect(queue.enqueue(createDownloadTask(4))).toBe("queued");
        expect(queue.enqueue(createDownloadTask(4))).toBe("duplicate");
        expect(queue.pendingCount).toBe(1);
        expect((await queue.take())?.index).toBe(4);
    });

    it("drains queued work before ending after the producer closes", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(createDownloadTask(2));
        queue.enqueue(createDownloadTask(1));
        queue.closeProducer();

        expect((await queue.take())?.index).toBe(1);
        expect((await queue.take())?.index).toBe(2);
        await expect(queue.take()).resolves.toBeNull();
    });

    it("skips queued and future protected chapters after skip-all", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(createDownloadTask(8));
        queue.enqueue(createDownloadTask(3));

        expect(queue.skipAllRemaining().map((entry) => entry.index)).toEqual([3, 8]);
        expect(queue.isSkippingRemaining).toBe(true);
        expect(queue.enqueue(createDownloadTask(12))).toBe("skipped");
        await expect(queue.take()).resolves.toBeNull();
    });

    it("wakes an empty consumer on cancellation", async () => {
        const queue = new ProtectedChapterQueue();
        const controller = new AbortController();
        const take = queue.take(controller.signal);

        controller.abort();

        await expect(take).resolves.toBeNull();
    });

    it("returns pending work and closes the cancelled queue", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(createDownloadTask(7));
        queue.enqueue(createDownloadTask(9));

        expect(queue.cancel().map((entry) => entry.index)).toEqual([7, 9]);
        expect(queue.pendingCount).toBe(0);
        await expect(queue.take()).resolves.toBeNull();
    });
});
