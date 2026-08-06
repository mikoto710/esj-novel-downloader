import { describe, expect, it, vi } from "vitest";
import { BrowserRequestGate } from "../../src/adapters/browser-request-gate";
import { createDeferred } from "../support";

describe("browser request gate", () => {
    it("waits for active shared requests and blocks later requests until exclusive work finishes", async () => {
        const gate = new BrowserRequestGate();
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        const exclusive = createDeferred<void>();
        const order: string[] = [];

        const firstRun = gate.runShared(async () => {
            order.push("shared-1-start");
            await first.promise;
            order.push("shared-1-end");
        });
        const secondRun = gate.runShared(async () => {
            order.push("shared-2-start");
            await second.promise;
            order.push("shared-2-end");
        });
        const exclusiveRun = gate.runExclusive(async () => {
            order.push("exclusive-start");
            await exclusive.promise;
            order.push("exclusive-end");
        });
        const laterShared = gate.runShared(async () => {
            order.push("shared-3-start");
        });

        expect(order).toEqual(["shared-1-start", "shared-2-start"]);
        first.resolve();
        await firstRun;
        expect(order).not.toContain("exclusive-start");

        second.resolve();
        await vi.waitFor(() => expect(order).toContain("exclusive-start"));
        expect(order).not.toContain("shared-3-start");

        exclusive.resolve();
        await Promise.all([secondRun, exclusiveRun, laterShared]);
        expect(order).toEqual([
            "shared-1-start",
            "shared-2-start",
            "shared-1-end",
            "shared-2-end",
            "exclusive-start",
            "exclusive-end",
            "shared-3-start"
        ]);
    });

    it("removes a cancelled exclusive waiter without leaving shared requests blocked", async () => {
        const gate = new BrowserRequestGate();
        const activeShared = createDeferred<void>();
        const controller = new AbortController();
        const firstRun = gate.runShared(() => activeShared.promise);
        const exclusiveRun = gate.runExclusive(async () => undefined, controller.signal);

        controller.abort();
        await expect(exclusiveRun).rejects.toMatchObject({ name: "AbortError" });

        const laterShared = vi.fn(async () => undefined);
        await gate.runShared(laterShared);
        expect(laterShared).toHaveBeenCalledOnce();

        activeShared.resolve();
        await firstRun;
    });
});
