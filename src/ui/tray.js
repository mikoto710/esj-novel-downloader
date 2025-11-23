export function createMinimizedTray(progressText) {
    const old = document.querySelector("#esj-min-tray");
    if (old) old.remove();

    const tray = document.createElement("div");
    tray.id = "esj-min-tray";
    tray.title = "点击恢复下载窗口";
    tray.innerHTML = `<span>📘</span><span id="esj-tray-text">${progressText || "下载中..."}</span>`;

    tray.onclick = () => {
        const popup = document.querySelector("#esj-popup");
        if (popup) {
            popup.style.display = "flex";
            tray.remove();
        }
    };
    document.body.appendChild(tray);
    return tray;
}

export function updateTrayText(text) {
    const el = document.querySelector("#esj-tray-text");
    if (el) el.textContent = text;
}