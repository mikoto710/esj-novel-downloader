import { describe, expect, it } from "vitest";
import { ProtectedChapterQueue } from "../../src/core/download/protected-chapter-queue";
import { createDeferred, createDownloadTask } from "../support";

function item(index: number) {
    return { task: createDownloadTask(index), pageHtml: `<html data-index="${index}"></html>` };
}

describe("ProtectedChapterQueue", () => {
    it("keeps the active item and sorts later discoveries by original chapter index", async () => {
        const queue = new ProtectedChapterQueue();
        const waitingConsumer = createDeferred<void>();
        const firstTake = queue.take().then((value) => {
            waitingConsumer.resolve();
            return value;
        });
        queue.enqueue(item(64));
        await waitingConsumer.promise;
        queue.enqueue(item(53));
        queue.enqueue(item(35));

        expect((await firstTake)?.task.index).toBe(64);
        expect((await queue.take())?.task.index).toBe(35);
        expect((await queue.take())?.task.index).toBe(53);
    });

    it("deduplicates repeated discoveries by task index", async () => {
        const queue = new ProtectedChapterQueue();

        expect(queue.enqueue(item(4)).kind).toBe("queued");
        expect(queue.enqueue(item(4)).kind).toBe("duplicate");
        expect(queue.pendingCount).toBe(1);
        expect((await queue.take())?.task.index).toBe(4);
    });

    it("drains queued work before ending after the producer closes", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(item(2));
        queue.enqueue(item(1));
        queue.closeProducer();

        expect((await queue.take())?.task.index).toBe(1);
        expect((await queue.take())?.task.index).toBe(2);
        await expect(queue.take()).resolves.toBeNull();
    });

    it("skips queued and future protected chapters after skip-all", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(item(8));
        queue.enqueue(item(3));

        expect(queue.skipAllRemaining().map((entry) => entry.task.index)).toEqual([3, 8]);
        expect(queue.isSkippingRemaining).toBe(true);
        expect(queue.enqueue(item(12)).kind).toBe("skipped");
        await expect(queue.take()).resolves.toBeNull();
    });

    it("wakes an empty consumer on cancellation", async () => {
        const queue = new ProtectedChapterQueue();
        const controller = new AbortController();
        const take = queue.take(controller.signal);

        controller.abort();

        await expect(take).resolves.toBeNull();
    });

    it("returns pending work and wakes consumers when the queue is cancelled", async () => {
        const queue = new ProtectedChapterQueue();
        queue.enqueue(item(7));
        queue.enqueue(item(9));

        expect(queue.cancel().map((entry) => entry.task.index)).toEqual([7, 9]);
        expect(queue.pendingCount).toBe(0);
        await expect(queue.take()).resolves.toBeNull();
    });
});
