export function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (window.JSZip) return resolve(window.JSZip);
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => reject(new Error("加载脚本失败: " + src));
        document.head.appendChild(s);
    });
}

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export function log(msg) {
    const prefix = new Date().toLocaleTimeString();
    const line = `[${prefix}] ${msg}`;
    console.log(line);
    const box = document.querySelector("#esj-log");
    if (box) {
        box.textContent += line + "\n";
        box.scrollTop = box.scrollHeight;
    }
}

export function escapeXml(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function escapeHtmlPreserveLine(s) {
    if (!s) return "";
    const escaped = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const parts = escaped.split(/\n{2,}|\r\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
    return parts.map(p => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
}