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
 * 输出日志到 UI 面板和控制台
 */
export function log(msg: string): void {
    const prefix = new Date().toLocaleTimeString();
    const line = `[${prefix}] ${msg}`;
    console.log(line);
    
    const box = document.querySelector("#esj-log");
    if (box) {
        box.textContent += line + "\n";
        (box as HTMLElement).scrollTop = box.scrollHeight;
    }
}