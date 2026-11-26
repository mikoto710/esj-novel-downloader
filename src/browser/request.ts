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
        const cancelled = () => new Error("User Aborted");
        if (cancelSignal?.aborted) {
            reject(cancelled());
            return;
        }

        function fail(error: unknown): void {
            cancelSignal?.removeEventListener("abort", onAbort);
            reject(error);
        }

        let requestHandle: { abort: () => void } | undefined;

        function onAbort(): void {
            fail(cancelled());
            requestHandle?.abort();
        }

        cancelSignal?.addEventListener("abort", onAbort, { once: true });
        try {
            requestHandle = GM_xmlhttpRequest({
                method: (options.method as "GET" | "POST") || "GET",
                url,
                headers: options.headers as Record<string, string>,
                ...(options.body == null ? {} : { data: options.body }),
                timeout,
                responseType: "blob",
                anonymous: options.credentials === "omit",

                onload: (res) => {
                    cancelSignal?.removeEventListener("abort", onAbort);
                    try {
                        const { status, statusText, finalUrl } = res;
                        if (status < 200 || status >= 300) {
                            throw new Error(`HTTP Error Status ${status}`);
                        }
                        const body = status === 204 || status === 205 ? null : res.response;
                        const response = new Response(body, { status, statusText });
                        Object.defineProperty(response, "url", { value: finalUrl });
                        resolve(response);
                    } catch (error) {
                        reject(error);
                    }
                },
                ontimeout: () => fail(new Error("Timeout")),
                onerror: () => fail(new Error("Network Error")),
                onabort: () => fail(cancelled())
            });
        } catch (error) {
            fail(error);
        }
    });
}
