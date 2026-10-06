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
 * 生成适合本地保存的文件名和诊断 JSON，由调用方提供书名回退和当前语言日志文本
 */
export function createDiagnosticExport(
    session: DiagnosticSession,
    presentation: { bookTitle: string; formatLog: (entry: DiagnosticLogRecord) => string }
): { filename: string; json: string } {
    const date = new Date(session.updatedAt)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return {
        filename: `esj-diagnostic-${safeFilenamePart(presentation.bookTitle)}-${date}.json`,
        json: JSON.stringify(
            {
                session: {
                    ...session,
                    logs: session.logs.map((entry) => ({ ...entry, message: presentation.formatLog(entry) }))
                }
            },
            null,
            2
        )
    };
}
