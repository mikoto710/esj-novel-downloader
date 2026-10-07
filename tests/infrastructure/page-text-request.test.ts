import { describe, expect, it, vi } from "vitest";
import * as requests from "../../src/browser/request";
import { createDeferred, useFakeClock } from "../support";

describe("native page text request", () => {
    it("times out while the response body is still pending", async () => {
        const clock = useFakeClock();
        const body = createDeferred<string>();
        const reading = createDeferred<void>();
        const response = new Response();
        let signal: AbortSignal | null | undefined;
        vi.spyOn(response, "text").mockImplementation(() => {
            reading.resolve();
            return body.promise;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, options: RequestInit) => {
                signal = options.signal;
                return response;
            })
        );
        try {
            const pending = requests.fetchPageText("https://example.test/detail/100.html");
            const result = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
            await reading.promise;
            await clock.advanceBy(15000);
            await result;
            expect(signal?.aborted).toBe(true);
            body.resolve("late body");
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            clock.restore();
        }
    });

    it("ends promptly on cancellation without waiting for the body", async () => {
        const clock = useFakeClock();
        const controller = new AbortController();
        const add = vi.spyOn(controller.signal, "addEventListener");
        const remove = vi.spyOn(controller.signal, "removeEventListener");
        const body = createDeferred<string>();
        const reading = createDeferred<void>();
        const response = new Response();
        vi.spyOn(response, "text").mockImplementation(() => {
            reading.resolve();
            return body.promise;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => response)
        );
        try {
            const pending = requests.fetchPageText("https://example.test/detail/100.html", {
                signal: controller.signal
            });
            const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
            await reading.promise;
            controller.abort();
            await result;
            expect(body.settled).toBe(false);
            expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
            expect(vi.getTimerCount()).toBe(0);
            body.resolve("late body");
        } finally {
            clock.restore();
        }
    });

    it("does not issue a request for an already cancelled signal", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        await expect(
            requests.fetchPageText("https://example.test/detail/100.html", {
                signal: controller.signal
            })
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(fetch).not.toHaveBeenCalled();
    });
});
