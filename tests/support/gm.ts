import { vi } from "vitest";

type GmRequestDetails = Tampermonkey.Request<unknown>;
type GmLoadResponse = Tampermonkey.Response<unknown>;
type GmErrorResponse = Tampermonkey.ErrorResponse;
const GM_READY_STATE_DONE = 4 as Tampermonkey.ReadyState;

interface PendingGmRequest {
    details: GmRequestDetails;
    aborted: boolean;
    settled: boolean;
    abort: ReturnType<typeof vi.fn>;
}

/**
 * 用户脚本 API 测试替身及其可控请求队列
 */
export interface UserscriptApiMocks {
    readonly values: Map<string, unknown>;
    readonly requests: PendingGmRequest[];
    readonly getValue: ReturnType<typeof vi.fn>;
    readonly setValue: ReturnType<typeof vi.fn>;
    readonly xmlhttpRequest: ReturnType<typeof vi.fn>;
    respond(index: number, response?: Partial<GmLoadResponse>): void;
    fail(index: number, response?: Partial<GmErrorResponse>): void;
    timeout(index: number): void;
}

let installedMocks: UserscriptApiMocks | null = null;

/**
 * 安装用户脚本 API 测试替身
 */
export function installUserscriptApiMocks(initialValues: Record<string, unknown> = {}): UserscriptApiMocks {
    const values = new Map<string, unknown>(Object.entries(initialValues));
    const requests: PendingGmRequest[] = [];
    const getValue = vi.fn((key: string, defaultValue?: unknown) => (values.has(key) ? values.get(key) : defaultValue));
    const setValue = vi.fn((key: string, value: unknown) => {
        values.set(key, value);
    });
    const xmlhttpRequest = vi.fn((details: GmRequestDetails) => {
        const pending: PendingGmRequest = {
            details,
            aborted: false,
            settled: false,
            abort: vi.fn()
        };
        pending.abort.mockImplementation(() => {
            if (pending.settled) {
                return;
            }
            pending.settled = true;
            pending.aborted = true;
            details.onabort?.();
        });
        requests.push(pending);
        return { abort: pending.abort };
    });

    const mocks: UserscriptApiMocks = {
        values,
        requests,
        getValue,
        setValue,
        xmlhttpRequest,
        respond: (index, response) => {
            const pending = getPendingRequest(requests, index);
            markRequestSettled(pending, index);
            const loaded = createGmResponse(response);
            pending.details.onload?.call(loaded, loaded);
        },
        fail: (index, response) => {
            const pending = getPendingRequest(requests, index);
            markRequestSettled(pending, index);
            const failed = createGmErrorResponse(response);
            pending.details.onerror?.call(failed, failed);
        },
        timeout: (index) => {
            const pending = getPendingRequest(requests, index);
            markRequestSettled(pending, index);
            pending.details.ontimeout?.();
        }
    };

    vi.stubGlobal("GM_getValue", getValue);
    vi.stubGlobal("GM_setValue", setValue);
    vi.stubGlobal("GM_xmlhttpRequest", xmlhttpRequest);
    vi.stubGlobal("GM_info", {
        script: { version: "0.0.0-test" },
        scriptHandler: "Tampermonkey",
        version: "0.0.0-test"
    });
    vi.stubGlobal("unsafeWindow", globalThis);
    installedMocks = mocks;
    return mocks;
}

function markRequestSettled(pending: PendingGmRequest, index: number): void {
    if (pending.settled) {
        throw new Error(`GM request ${index} is already settled`);
    }
    pending.settled = true;
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

function getPendingRequest(requests: PendingGmRequest[], index: number): PendingGmRequest {
    const pending = requests[index];
    if (!pending) {
        throw new Error(`GM request ${index} does not exist`);
    }
    return pending;
}

function createGmResponse(overrides: Partial<GmLoadResponse> = {}): GmLoadResponse {
    return {
        finalUrl: "https://www.esjzone.cc/forum/1/2.html",
        readyState: GM_READY_STATE_DONE,
        status: 200,
        statusText: "OK",
        responseHeaders: "",
        response: "",
        responseText: "",
        responseXML: null,
        context: undefined,
        ...overrides
    };
}

function createGmErrorResponse(overrides: Partial<GmErrorResponse> = {}): GmErrorResponse {
    return {
        readyState: GM_READY_STATE_DONE,
        status: 500,
        statusText: "error",
        responseHeaders: "",
        response: "",
        responseText: "",
        responseXML: null,
        error: "error",
        ...overrides
    };
}
