// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../src/utils/log";

describe("log rendering", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<pre id="esj-log"></pre>';
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("keeps the latest 1000 UI events while preserving every console event", async () => {
        const box = document.querySelector("#esj-log") as HTMLElement;

        for (let index = 0; index < 1005; index++) {
            log(`event-${index}`);
        }
        await vi.runOnlyPendingTimersAsync();

        expect(console.log).toHaveBeenCalledTimes(1005);
        const truncation = box.querySelector<HTMLElement>('[data-esj-log-truncation="true"]')!;
        expect(truncation.dataset.esjLogTruncationCount).toBe("5");
        expect(box.textContent).not.toContain("event-4\n");
        expect(box.textContent).toContain("event-5\n");
        expect(box.textContent).toContain("event-1004\n");
    });
});
