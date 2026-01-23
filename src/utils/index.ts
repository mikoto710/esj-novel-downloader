/**
 * 安全获取全局变量 (兼容油猴沙箱环境)
 * @param name 变量名，如 'JSZip'
 */
function getGlobalVar<T>(name: string): T | undefined {
    // 优先检查当前上下文
    const win = window as unknown as Record<string, unknown>;
    if (name in win && win[name]) {
        return win[name] as T;
    }

    // 检查沙箱环境
    if (typeof unsafeWindow !== "undefined") {
        const uw = unsafeWindow as unknown as Record<string, unknown>;
        if (name in uw && uw[name]) {
            return uw[name] as T;
        }
    }
    return undefined;
}

/**
 * 单脚本加载
 * @param src 脚本 URL
 * @param globalName 全局变量名，如 'JSZip'
 */
export function loadSingleScript<T>(src: string, globalName: string): Promise<T> {
    return new Promise((resolve, reject) => {
        // 检查是否存在
        const existing = getGlobalVar<T>(globalName);
        if (existing) {
            return resolve(existing);
        }

        // 动态注入 + 异步加载
        const s = document.createElement("script");
        s.src = src;
        s.async = true;

        s.onload = () => {
            const loaded = getGlobalVar<T>(globalName);
            if (loaded) {
                resolve(loaded);
            } else {
                reject(new Error(`Script loaded but global variable not found: ${globalName}`));
            }
        };

        s.onerror = () => {
            // 加载失败移除标签，保持 DOM 干净
            s.remove();
            reject(new Error(`Network Error: ${src}`));
        };

        document.head.appendChild(s);
    });
}

/**
 * 支持自动 Fallback 的脚本加载器
 * @param srcs 单个 URL 或 URL 数组 (按序重试)
 * @param globalName 全局变量名，如 'JSZip'
 */
export async function loadScript<T>(srcs: string | string[], globalName: string): Promise<T> {
    const urls = Array.isArray(srcs) ? srcs : [srcs];
    let lastError: Error | null = null;

    for (const url of urls) {
        try {
            return await loadSingleScript<T>(url, globalName);
        } catch (e: any) {
            console.warn(`failed to load script (${url}):`, e.message);
            lastError = e;
        }
    }

    // 如果循环结束还没返回，说明全挂了
    throw new Error(`All scripts failed: ${lastError?.message}`);
}

/**
 * 异步延迟
 * @param ms 延迟时间(ms)
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * 支持中断的异步延迟
 * @param ms 延迟时间(ms)
 * @param signal 中断信号
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            return resolve();
        }

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            resolve();
        };

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        signal?.addEventListener("abort", onAbort);
    });
}

/**
 * 触发浏览器下载逻辑
 */
export function triggerDownload(blob: Blob, filename: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/**
 * 输出日志到 UI 面板和控制台
 * @param msg 日志内容
 */
export function log(msg: string): void {
    const prefix = new Date().toLocaleTimeString();
    const line = `[${prefix}] ${msg}`;
    console.log(line);

    const box = document.querySelector("#esj-log");
    if (box) {
        const isAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
        box.textContent += line + "\n";
        if (isAtBottom) {
            box.scrollTop = box.scrollHeight;
        }
    }
}

/**
 * 支持超时和外部中断的 fetch
 * @param url 请求地址
 * @param options fetch配置
 * @param timeout 超时时间(ms)
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

    // 无论 fetch 在干什么，这个 Promise 会瞬间报错，强行结束 await
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
 * @param timeout 超时时间(ms)
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
            data: options.body,
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

/**
 * 将 Blob 转换为 Base64 DataURL
 */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
