// 读取脚本或油猴沙箱提供的指定全局变量
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
 * 复用已有全局对象或加载指定脚本，失败时拒绝
 */
export function loadSingleScript<T>(src: string, globalName: string): Promise<T> {
    return new Promise((resolve, reject) => {
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
 * 按 URL 顺序尝试加载脚本，全部失败时拒绝
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

    throw new Error(`All scripts failed: ${lastError?.message}`);
}
