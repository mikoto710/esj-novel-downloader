// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { t } from "../../src/ui/locale";
import { log, refreshUiLogTruncationText, setUiLogTruncationFormatter } from "../../src/utils/index";

describe("log rendering", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<pre id="esj-log"></pre>';
        setInterfaceLocalePreference("zh-CN");
        setUiLogTruncationFormatter((count) => t("log.truncated", { count }));
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("renders the first UI line immediately and batches following lines", async () => {
        const box = document.querySelector("#esj-log") as HTMLElement;
        const append = vi.spyOn(box, "append");
        Object.defineProperty(box, "clientHeight", { configurable: true, value: 10 });
        Object.defineProperty(box, "scrollHeight", { configurable: true, value: 100 });
        box.scrollTop = 90;

        log("第一条");

        expect(console.log).toHaveBeenCalledOnce();
        expect(append).toHaveBeenCalledOnce();
        expect(box.textContent).toContain("第一条\n");

        log("第二条");

        expect(console.log).toHaveBeenCalledTimes(2);
        expect(append).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(50);

        expect(append).toHaveBeenCalledTimes(2);
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

    it("keeps the latest 1000 UI events while preserving every console event", async () => {
        const box = document.querySelector("#esj-log") as HTMLElement;

        for (let index = 0; index < 1005; index++) {
            log(`event-${index}`);
        }
        await vi.advanceTimersByTimeAsync(50);

        expect(console.log).toHaveBeenCalledTimes(1005);
        expect(box.querySelector('[data-esj-log-truncation="true"]')?.textContent).toContain("已省略 5 条较早日志");
        expect(box.textContent).not.toContain("event-4\n");
        expect(box.textContent).toContain("event-5\n");
        expect(box.textContent).toContain("event-1004\n");

        setInterfaceLocalePreference("zh-TW");
        refreshUiLogTruncationText();
        expect(box.querySelector('[data-esj-log-truncation="true"]')?.textContent).toContain("已省略 5 筆較早紀錄");
    });
});
