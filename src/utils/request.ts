/**
 * 支持超时和外部中断的 fetch
 * @param url 请求地址
 * @param options fetch配置
 * @param timeout 超时时间 (ms)
 * @param cancelSignal 外部取消信号
 * @deprecated 请使用 fetchWithTimeout 代替
 */
export async function fetchWithTimeoutNative(
    url: string,
    options: RequestInit = {},
    timeout = 10000,
    cancelSignal?: AbortSignal
): Promise<Response> {
    // 超时控制器
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    // 监听外部取消信号
    let onCancel: (() => void) | undefined;

    // 立即拒绝 Promise 结束 await
    const abortPromise = new Promise<never>((_, reject) => {
        if (cancelSignal?.aborted) {
            return reject(new Error("User Aborted"));
        }
        onCancel = () => reject(new Error("User Aborted"));
        cancelSignal?.addEventListener("abort", onCancel);
    });

    // 发起请求
    const fetchPromise = fetch(url, {
        ...options,
        signal: controller.signal
    }).then((res) => {
        if (!res.ok) {
            throw new Error(`Status ${res.status}`);
        }
        return res;
    });

    try {
        const response = await Promise.race([fetchPromise, abortPromise]);
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        controller.abort();
        throw e;
    } finally {
        if (cancelSignal && onCancel) {
            cancelSignal.removeEventListener("abort", onCancel);
        }
    }
}

/**
 * 基于 GM_xmlhttpRequest 的请求封装，支持超时和外部中断
 * @param url 请求地址
 * @param options fetch配置
 * @param timeout 超时时间 (ms)
 * @param cancelSignal 外部取消信号
 */
export function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = 15000,
    cancelSignal?: AbortSignal
): Promise<Response> {
    return new Promise((resolve, reject) => {
        // 如果信号开局就已经中断，直接返回
        if (cancelSignal?.aborted) {
            return reject(new Error("User Aborted"));
        }

        let requestHandle: { abort: () => void } | null = null;

        // GM 提供的物理中断
        const onAbort = () => {
            if (requestHandle) {
                requestHandle.abort();
            }
            reject(new Error("User Aborted"));
        };

        // 挂载中断监听
        if (cancelSignal) {
            cancelSignal.addEventListener("abort", onAbort);
        }

        // 发起 GM 请求
        requestHandle = GM_xmlhttpRequest({
            method: (options.method as "GET" | "POST") || "GET",
            url: url,
            headers: options.headers as Record<string, string>,
            ...(options.body == null ? {} : { data: options.body }),
            timeout: timeout,
            responseType: "blob",
            anonymous: options.credentials === "omit",

            onload: (res) => {
                // 清理监听
                if (cancelSignal) {
                    cancelSignal.removeEventListener("abort", onAbort);
                }

                if (res.status >= 200 && res.status < 300) {
                    const response = new Response(res.response, {
                        status: res.status,
                        statusText: res.statusText
                    });

                    Object.defineProperty(response, "url", { value: res.finalUrl });

                    resolve(response);
                } else {
                    reject(new Error(`HTTP Error Status ${res.status}`));
                }
            },

            ontimeout: () => {
                if (cancelSignal) {
                    cancelSignal.removeEventListener("abort", onAbort);
                }
                reject(new Error("Timeout"));
            },

            onerror: () => {
                if (cancelSignal) {
                    cancelSignal.removeEventListener("abort", onAbort);
                }
                reject(new Error("Network Error"));
            }
        });
    });
}
