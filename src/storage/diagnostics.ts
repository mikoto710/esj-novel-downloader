import {
    createEmptyDiagnosticStore,
    DIAGNOSTIC_SCHEMA_VERSION,
    type DiagnosticRepository,
    type DiagnosticStore
} from "../diagnostics/manager";

const DIAGNOSTIC_STORAGE_KEY = "esj_diagnostic_sessions_v1";

export class GmDiagnosticRepository implements DiagnosticRepository {
    /**
     * 读取诊断记录，版本或结构不兼容时回退为空存储，避免旧数据阻断诊断流程
     */
    load(): DiagnosticStore {
        try {
            const stored = GM_getValue<DiagnosticStore | null>(DIAGNOSTIC_STORAGE_KEY, null);
            if (
                !stored ||
                stored.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION ||
                !Array.isArray(stored.active) ||
                !Array.isArray(stored.history)
            ) {
                return createEmptyDiagnosticStore();
            }
            return stored;
        } catch (error) {
            console.warn("读取诊断日志失败", error);
            return createEmptyDiagnosticStore();
        }
    }

    save(store: DiagnosticStore): void {
        try {
            GM_setValue(DIAGNOSTIC_STORAGE_KEY, store);
        } catch (error) {
            // 诊断功能不得反向中断下载、缓存或导出流程
            console.warn("保存诊断日志失败", error);
        }
    }
}
