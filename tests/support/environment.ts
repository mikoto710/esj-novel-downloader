import { vi } from "vitest";
import { installUserscriptApiMocks, resetUserscriptApiMocks } from "./gm";

/**
 * 重置 DOM、存储和用户脚本 API 测试环境
 */
export function resetTestEnvironment(): void {
    if (typeof document !== "undefined") {
        installInnerTextShim();
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

// 补齐 jsdom 缺失的 innerText 行为
function installInnerTextShim(): void {
    if (typeof HTMLElement === "undefined" || "innerText" in HTMLElement.prototype) {
        return;
    }
    Object.defineProperty(HTMLElement.prototype, "innerText", {
        configurable: true,
        get(this: HTMLElement) {
            return this.textContent ?? "";
        },
        set(this: HTMLElement, value: string) {
            this.textContent = value;
        }
    });
}

/**
 * 回收测试资源，并在发现泄漏时使测试失败
 */
export function cleanupTestEnvironment(): void {
    const pendingTimers = vi.isFakeTimers() ? vi.getTimerCount() : 0;
    if (vi.isFakeTimers()) {
        vi.clearAllTimers();
        vi.useRealTimers();
    }

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

    if (pendingTimers > 0) {
        throw new Error(`Test leaked resources: timer:${pendingTimers} pending fake timer(s)`);
    }
}
