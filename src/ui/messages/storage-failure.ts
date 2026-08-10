import type { StorageFailure, StorageFailureReason } from "../../core/cache/storage-error";
import type { LocaleKey } from "../../core/locale";
import { t } from "../locale";

const STORAGE_FAILURE_KEYS = {
    "quota-exceeded": "download.storage.quotaExceeded",
    "ownership-lost": "download.storage.ownershipLost",
    "transaction-aborted": "download.storage.transactionAborted",
    "database-unavailable": "download.storage.databaseUnavailable",
    "migration-failed": "download.storage.migrationFailed",
    "flush-timeout": "download.storage.flushTimeout",
    "unknown-storage-error": "download.storage.unknown"
} as const satisfies Readonly<Record<StorageFailureReason, LocaleKey>>;

/**
 * 按当前界面语言格式化存储失败原因，未知原因保留原值并避免重复附加详情
 */
export function formatStorageFailureText(reason: string, detail = ""): string {
    const key = STORAGE_FAILURE_KEYS[reason as StorageFailureReason];
    const summary = key ? t(key) : reason;
    return detail && detail !== summary ? `${summary}：${detail}` : summary;
}

export function formatStorageFailure(failure: StorageFailure): string {
    const detail = typeof failure.params?.detail === "string" ? failure.params.detail : "";
    return formatStorageFailureText(failure.reason, detail);
}
