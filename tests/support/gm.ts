import { vi } from "vitest";

/**
 * 用户脚本 API 测试替身
 */
export interface UserscriptApiMocks {
    readonly values: Map<string, unknown>;
    readonly getValue: ReturnType<typeof vi.fn>;
    readonly setValue: ReturnType<typeof vi.fn>;
}

let installedMocks: UserscriptApiMocks | null = null;

/**
 * 安装用户脚本 API 测试替身
 */
export function installUserscriptApiMocks(): UserscriptApiMocks {
    const values = new Map<string, unknown>();
    const getValue = vi.fn((key: string, defaultValue?: unknown) => (values.has(key) ? values.get(key) : defaultValue));
    const setValue = vi.fn((key: string, value: unknown) => {
        values.set(key, value);
    });
    const mocks: UserscriptApiMocks = { values, getValue, setValue };

    vi.stubGlobal("GM_getValue", getValue);
    vi.stubGlobal("GM_setValue", setValue);
    vi.stubGlobal(
        "GM_xmlhttpRequest",
        vi.fn((details: Tampermonkey.Request<unknown>) => {
            return { abort: vi.fn().mockImplementationOnce(() => details.onabort?.()) };
        })
    );
    vi.stubGlobal("GM_info", {
        script: { version: "0.0.0-test" },
        scriptHandler: "Tampermonkey",
        version: "0.0.0-test"
    });
    vi.stubGlobal("unsafeWindow", globalThis);
    installedMocks = mocks;
    return mocks;
}

/**
 * 获取当前安装的用户脚本 API 测试替身
 */
export function getUserscriptApiMocks(): UserscriptApiMocks {
    if (!installedMocks) {
        throw new Error("Userscript API mocks are not installed");
    }
    return installedMocks;
}

/**
 * 清除用户脚本 API 测试替身引用
 */
export function resetUserscriptApiMocks(): void {
    installedMocks = null;
}
