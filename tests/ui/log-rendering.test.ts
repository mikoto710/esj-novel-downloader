// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../src/utils/index";

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

    it("batches UI lines into one append while preserving console output", async () => {
        const box = document.querySelector("#esj-log") as HTMLElement;
        const append = vi.spyOn(box, "append");
        Object.defineProperty(box, "clientHeight", { configurable: true, value: 10 });
        Object.defineProperty(box, "scrollHeight", { configurable: true, value: 100 });
        box.scrollTop = 90;

        log("第一条");
        log("第二条");

        expect(console.log).toHaveBeenCalledTimes(2);
        expect(append).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(50);

        expect(append).toHaveBeenCalledOnce();
        expect(box.textContent).toContain("第一条\n");
        expect(box.textContent).toContain("第二条\n");
        expect(box.scrollTop).toBe(100);
    });

    it("does not force scrolling when the user is reading older logs", async () => {
        const box = document.querySelector("#esj-log") as HTMLElement;
        Object.defineProperty(box, "clientHeight", { configurable: true, value: 10 });
        Object.defineProperty(box, "scrollHeight", { configurable: true, value: 100 });
        box.scrollTop = 20;

        log("保留当前位置");
        await vi.advanceTimersByTimeAsync(50);

        expect(box.scrollTop).toBe(20);
    });
});
