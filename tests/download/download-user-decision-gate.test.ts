import { describe, expect, it } from "vitest";
import { UserDecisionGate } from "../../src/core/download/user-decision-gate";
import { createDeferred } from "../support";

describe("UserDecisionGate", () => {
    it("runs decisions in request order without overlap", async () => {
        const gate = new UserDecisionGate();
        const first = createDeferred<void>();
        const order: string[] = [];
        const firstResult = gate.run(async () => {
            order.push("first-start");
            await first.promise;
            order.push("first-end");
            return 1;
        });
        const secondResult = gate.run(async () => {
            order.push("second");
            return 2;
        });

        await Promise.resolve();
        expect(order).toEqual(["first-start"]);
        first.resolve();

        await expect(firstResult).resolves.toBe(1);
        await expect(secondResult).resolves.toBe(2);
        expect(order).toEqual(["first-start", "first-end", "second"]);
    });

    it("removes a cancelled decision while it is waiting", async () => {
        const gate = new UserDecisionGate();
        const active = createDeferred<void>();
        const activeResult = gate.run(async () => active.promise);
        const controller = new AbortController();
        const waiting = gate.run(async () => "unexpected", controller.signal);

        controller.abort();
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        active.resolve();
        await expect(activeResult).resolves.toBeUndefined();
    });

    it("releases the next decision when an active operation rejects", async () => {
        const gate = new UserDecisionGate();
        const failed = gate.run(async () => {
            throw new Error("decision failed");
        });
        const next = gate.run(async () => "continued");

        await expect(failed).rejects.toThrow("decision failed");
        await expect(next).resolves.toBe("continued");
    });
});
