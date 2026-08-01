import { vi } from "vitest";
import { installUserscriptApiMocks, resetUserscriptApiMocks } from "./gm";
import { FakeBroadcastChannel, testResources } from "./resources";

export function resetTestEnvironment(): void {
    if (typeof document !== "undefined") {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        document.title = "ESJZone Test";
    }
    if (typeof localStorage !== "undefined") {
        localStorage.clear();
    }
    if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
    }
    installUserscriptApiMocks();
}

export async function cleanupTestEnvironment(): Promise<void> {
    const pendingTimers = vi.isFakeTimers() ? vi.getTimerCount() : 0;
    if (vi.isFakeTimers()) {
        vi.clearAllTimers();
        vi.useRealTimers();
    }

    const leakedResources = await testResources.cleanup();
    FakeBroadcastChannel.reset();
    resetUserscriptApiMocks();
    vi.unstubAllGlobals();

    if (typeof document !== "undefined") {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        document.title = "ESJZone Test";
    }
    if (typeof localStorage !== "undefined") {
        localStorage.clear();
    }
    if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
    }

    const leakMessages = [
        ...(pendingTimers > 0 ? [`timer:${pendingTimers} pending fake timer(s)`] : []),
        ...leakedResources
    ];
    if (leakMessages.length > 0) {
        throw new Error(`Test leaked resources: ${leakMessages.join(", ")}`);
    }
}
