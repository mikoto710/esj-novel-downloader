import type { DiagnosticSession, DiagnosticLogRecord } from "./manager";

function safeFilenamePart(value: string): string {
    return (
        value
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60) || "book"
    );
}

/**
 * 生成详情预览和实际下载共用的诊断文件名
 */
export function createDiagnosticFilename(bookTitle: string, updatedAt: number): string {
    const date = new Date(updatedAt)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return `esj-diagnostic-${safeFilenamePart(bookTitle)}-${date}.json`;
}

/**
 * 生成适合本地保存的文件名和诊断 JSON，由调用方提供书名回退和当前语言日志文本
 */
export function createDiagnosticExport(
    session: DiagnosticSession,
    presentation: { bookTitle: string; formatLog: (entry: DiagnosticLogRecord) => string }
): { filename: string; json: string } {
    return {
        filename: createDiagnosticFilename(presentation.bookTitle, session.updatedAt),
        json: JSON.stringify(
            {
                session: {
                    ...session,
                    // 展示日志写入输出副本，不能修改存储中的中性记录
                    logs: session.logs.map((entry) => ({ ...entry, message: presentation.formatLog(entry) }))
                }
            },
            null,
            2
        )
    };
}
