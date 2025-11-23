export function enableDrag(popup, headerSelector) {
    const header = popup.querySelector(headerSelector);
    if (!header) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener("mousedown", (e) => {
        dragging = true;
        const rect = popup.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
    });
    function onMove(e) {
        if (!dragging) return;
        popup.style.left = (e.clientX - offsetX) + "px";
        popup.style.top = (e.clientY - offsetY) + "px";
        popup.style.transform = "none";
    }
    function onUp() {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
    }
}

export function fullCleanup(originalTitle) {
    document.querySelector("#esj-popup")?.remove();
    document.querySelector("#esj-min-tray")?.remove();
    document.querySelector("#esj-confirm")?.remove();
    document.querySelector("#esj-format")?.remove();
    if (originalTitle) document.title = originalTitle;
}