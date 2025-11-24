/**
 * 通过 CDN 动态加载外部脚本
 * @param src 脚本 URL
 */
export function loadScript(src: string): Promise<any> {
    return new Promise((resolve, reject) => {
        if (window.JSZip) return resolve(window.JSZip);

        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => reject(new Error("加载脚本失败: " + src));
        document.head.appendChild(s);
    });
}

/**
 * 异步延迟
 * @param ms 延迟时间(ms)
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * 支持中断的异步延迟
 * @param ms 延迟时间(ms)
 * @param signal 中断信号
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve();
        };

        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        signal?.addEventListener('abort', onAbort);
    });
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
        const isAtBottom = (box.scrollTop + box.clientHeight) >= (box.scrollHeight - 10);
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
 */
export async function fetchWithTimeout(
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
            return reject(new Error('User Aborted'));
        }
        onCancel = () => reject(new Error('User Aborted'));
        cancelSignal?.addEventListener('abort', onCancel);
    });

    // 发起请求
    const fetchPromise = fetch(url, {
        ...options,
        signal: controller.signal 
    }).then(res => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
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
            cancelSignal.removeEventListener('abort', onCancel);
        }
    }
}