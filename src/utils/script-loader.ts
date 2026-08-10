/**
 * 获取兼容油猴沙箱的全局变量
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
 * @param srcs 按顺序重试的 URL 列表
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
