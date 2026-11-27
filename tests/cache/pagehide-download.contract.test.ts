// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
    createChapterFixture,
    createDeferred,
    createDetailPageFixture,
    installDocumentFixture,
    useFakeClock
} from "../support";
import { deleteTestDatabase } from "../support/resources";

describe("pagehide download cache", () => {
    it("commits buffered chapters before the next task acquires the book", async () => {
        vi.resetModules();
        const factory = new IDBFactory();
        const connections = new Set<IDBDatabase>();
        const openDatabase = factory.open.bind(factory);
        vi.spyOn(factory, "open").mockImplementation((...args) => {
            const request = openDatabase(...args);
            request.addEventListener("success", () => connections.add(request.result), { once: true });
            return request;
        });
        vi.stubGlobal("indexedDB", factory);
        vi.stubGlobal("BroadcastChannel", undefined);
        const [cache, locks, { setConcurrency }, { loadDetailBook }, { createChapterCacheSources }, diagnostics] =
            await Promise.all([
                import("../../src/storage/cache/book-cache"),
                import("../../src/storage/book-lock"),
                import("../../src/storage/settings"),
                import("../../src/site/book"),
                import("../../src/storage/cache/chapter-source"),
                import("../../src/diagnostics/runtime")
            ]);

        const bookId = "720";
        const firstBody = "<p>First completed chapter body</p>";
        const previousPage = location.href;
        window.history.replaceState({}, "", `/detail/${bookId}.html`);
        installDocumentFixture(createDetailPageFixture({ bookId, chapterCount: 2, coverUrl: "" }));
        const plan = loadDetailBook(document, location.href);
        const sources = createChapterCacheSources(plan.tasks, location.origin);
        setConcurrency(1);

        const secondStarted = createDeferred<void>();
        const abortSecond = vi.fn();
        vi.mocked(GM_xmlhttpRequest).mockImplementation((request) => {
            if (request.url === plan.tasks[1].url) {
                secondStarted.resolve();
                return { abort: abortSecond };
            }
            if (request.url !== plan.tasks[0].url) {
                throw new Error("Unexpected chapter request");
            }
            queueMicrotask(() =>
                request.onload?.call(
                    {} as never,
                    {
                        status: 200,
                        statusText: "OK",
                        finalUrl: plan.tasks[0].url,
                        response: createChapterFixture({ contentHtml: firstBody })
                    } as never
                )
            );
            return { abort: vi.fn() };
        });

        // 暂停实际批次提交，让下一任务在旧任务仍有待写正文时尝试取锁
        const writeStarted = createDeferred<void>();
        const allowWrite = createDeferred<void>();
        const putBatch = cache.putBookCacheBatchForTask;
        const write = vi.spyOn(cache, "putBookCacheBatchForTask").mockImplementation(async (...args) => {
            writeStarted.resolve();
            await allowWrite.promise;
            return putBatch(...args);
        });
        const [{ runBookDownload }, { abortActiveDownload }] = await Promise.all([
            import("../../src/app/book-download"),
            import("../../src/app/page-session")
        ]);

        const clock = useFakeClock(undefined, {
            toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]
        });
        let nextLock: Awaited<ReturnType<typeof locks.getActiveBookDownloadLock>> = null;
        let finished = false;
        const running = runBookDownload({
            bookId,
            pageTitle: document.title,
            sourcePageType: "detail",
            loadPlan: async () => plan
        }).finally(() => {
            finished = true;
        });
        const waitForTask = async () => {
            await vi.waitFor(() => expect(finished).toBe(true));
            await running;
        };
        try {
            const submit = await vi.waitFor(() => {
                const button = document.querySelector<HTMLButtonElement>("#esj-range-download");
                expect(button?.disabled).toBe(false);
                return button!;
            });
            submit.click();
            await vi.waitFor(() => expect(secondStarted.settled).toBe(true));
            const current = await locks.getActiveBookDownloadLock(bookId);
            expect(current).toMatchObject({ status: "running" });
            expect((await cache.previewBookCache(bookId, false, sources)).indexes).toEqual([]);
            expect(writeStarted.settled).toBe(false);

            window.dispatchEvent(new Event("pagehide"));
            await vi.waitFor(() => expect(writeStarted.settled).toBe(true));
            expect(abortSecond).toHaveBeenCalledOnce();
            const competing = await locks.acquireBookDownloadLock(bookId, "forum");
            expect(competing.acquired).toBe(false);
            expect(competing.lock.taskId).toBe(current!.taskId);

            allowWrite.resolve();
            await waitForTask();
            expect((await diagnostics.listBrowserDiagnosticSessions()).history[0]).toMatchObject({
                taskId: current!.taskId,
                result: "cancelled",
                task: { phase: "cancelled", cancellationOutcome: "saved" }
            });
            const { readCacheManifestV3 } = await import("../../src/storage/cache/indexeddb-repository");
            await expect(readCacheManifestV3(bookId)).resolves.toMatchObject({
                writerTaskId: current!.taskId,
                writerClosedAt: expect.any(Number)
            });

            const replacement = await locks.acquireBookDownloadLock(bookId, "forum");
            expect(replacement.acquired).toBe(true);
            nextLock = replacement.lock;
            expect(nextLock.taskId).not.toBe(current!.taskId);
            const restored = await cache.claimBookCache(bookId, nextLock.taskId, false, undefined, {
                chapterSources: sources
            });
            expect(restored).toMatchObject({ status: "claimed", size: 1 });
            if (restored.status !== "claimed" || !restored.map) {
                throw new Error("Expected the next task to load the committed chapter");
            }
            expect(Array.from(restored.map, ([index, chapter]) => [index, chapter.content])).toEqual([[0, firstBody]]);
        } finally {
            allowWrite.resolve();
            document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
            abortActiveDownload();
            try {
                await waitForTask();
                if (nextLock) {
                    await locks.releaseBookDownloadLock(nextLock);
                }
                await diagnostics.listBrowserDiagnosticSessions();
            } finally {
                connections.forEach((database) => database.close());
                write.mockRestore();
                window.history.replaceState({}, "", previousPage);
                clock.restore();
                await Promise.all((await factory.databases()).map(({ name }) => deleteTestDatabase(name!, factory)));
            }
        }
    });
});
