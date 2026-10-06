/**
 * 触发文件下载；单章即时回收，书籍保留下载消费 URL 的时间
 */
export function triggerDownload(
    blob: Blob,
    filename: string,
    options: { revokeDelayMs?: number; onTriggered?: () => void } = {}
): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    const revokeDelayMs = options.revokeDelayMs ?? 60_000;
    document.body.appendChild(a);
    a.click();
    options.onTriggered?.();
    if (revokeDelayMs === 0) {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } else {
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), revokeDelayMs);
    }
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
