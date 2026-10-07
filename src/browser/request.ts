/**
 * @deprecated 原生超时请求已弃用，请使用 fetchWithTimeout
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
 * 原生请求页面文本，期限覆盖响应正文读取，取消与超时分别抛出 AbortError 和 TimeoutError
 */
export async function fetchPageText(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<string> {
    const signal = options.signal;
    if (signal?.aborted) {
        throw new DOMException("Page request cancelled", "AbortError");
    }
    const controller = new AbortController();
    let rejectInterruption!: (reason: unknown) => void;
    const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
    });
    const interrupt = (reason: DOMException) => {
        controller.abort(reason);
        rejectInterruption(reason);
    };
    const onAbort = () => interrupt(new DOMException("Page request cancelled", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => interrupt(new DOMException("Page request timed out", "TimeoutError")), timeoutMs);
    try {
        // 即使底层读取尚未响应中止，也先结束调用方等待；晚到结果由 race 消费
        const responseText = (async () => {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }
            return response.text();
        })();
        return await Promise.race([responseText, interruption]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}

/**
 * 通过 GM 发起支持超时和外部中断的请求
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

        // 中止在途 GM 请求，并以取消错误结束等待
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
