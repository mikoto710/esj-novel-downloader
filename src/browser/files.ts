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
    try {
        document.body.appendChild(a);
        a.click();
        // 触发标记先于移除和回收，后续清理失败不能抹去已触发事实
        options.onTriggered?.();
    } finally {
        try {
            if (revokeDelayMs === 0) {
                if (a.parentNode) {
                    document.body.removeChild(a);
                }
            } else {
                a.remove();
            }
        } finally {
            if (revokeDelayMs === 0) {
                URL.revokeObjectURL(a.href);
            } else {
                setTimeout(() => URL.revokeObjectURL(a.href), revokeDelayMs);
            }
        }
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
