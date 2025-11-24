import { state } from '../core/state';

/**
 * 通过 CDN 动态加载外部脚本
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
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * 支持中断的异步延迟
 */
export async function sleepWithAbort(ms: number): Promise<void> {
    return new Promise(resolve => {
        const signal = state.abortController?.signal;
        if (signal?.aborted) return resolve();

        const id = setTimeout(() => {
            resolve();
            signal?.removeEventListener('abort', onAbort);
        }, ms);

        const onAbort = () => {
            clearTimeout(id);
            resolve();
        };

        signal?.addEventListener('abort', onAbort);
    });
}

/**
 * 输出日志到 UI 面板和控制台
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