/**
 * 持久缓存失败的稳定原因码
 */
export type StorageFailureReason =
    | "quota-exceeded"
    | "ownership-lost"
    | "transaction-aborted"
    | "database-unavailable"
    | "migration-failed"
    | "flush-timeout"
    | "unknown-storage-error";

/**
 * 发生存储失败时正在执行的操作
 */
export type StorageOperation = "read" | "claim" | "migrate" | "write" | "clear" | "flush";

import type { DomainMessageParams } from "../messages";

/**
 * 可安全传递给 Coordinator、事件和 UI 的存储失败摘要
 * message 仅保留稳定技术摘要，展示文案由外层决定
 */
export interface StorageFailure {
    reason: StorageFailureReason;
    operation: StorageOperation;
    message: string;
    params?: DomainMessageParams;
    causeReason?: Exclude<StorageFailureReason, "migration-failed">;
}

function getErrorName(error: unknown): string {
    return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorParams(error: unknown): DomainMessageParams | undefined {
    if (error instanceof StorageError && error.params) {
        return error.params;
    }
    const name = getErrorName(error);
    const detail = getErrorMessage(error);
    if (!name && !detail) {
        return undefined;
    }
    return {
        ...(name ? { errorName: name } : {}),
        ...(detail ? { detail } : {})
    };
}

function classifyBaseReason(error: unknown): Exclude<StorageFailureReason, "migration-failed"> {
    const name = getErrorName(error);
    const message = getErrorMessage(error);
    if (name === "QuotaExceededError" || /quota|storage space/i.test(message)) {
        return "quota-exceeded";
    }
    if (name === "AbortError") {
        return "transaction-aborted";
    }
    if (
        ["InvalidStateError", "NotSupportedError", "SecurityError", "UnknownError"].includes(name) ||
        /indexeddb.*(?:unavailable|disabled|denied|not defined)/i.test(message)
    ) {
        return "database-unavailable";
    }
    return "unknown-storage-error";
}

/**
 * 带稳定原因码的存储异常；cause 仅用于控制台诊断，不进入用户诊断摘要
 */
export class StorageError extends Error {
    readonly reason: StorageFailureReason;
    readonly operation: StorageOperation;
    readonly params?: DomainMessageParams;
    readonly causeReason?: Exclude<StorageFailureReason, "migration-failed">;

    constructor(failure: StorageFailure, options?: { cause?: unknown }) {
        super(failure.message, options);
        this.name = "StorageError";
        this.reason = failure.reason;
        this.operation = failure.operation;
        if (failure.params !== undefined) {
            this.params = failure.params;
        }
        if (failure.causeReason !== undefined) {
            this.causeReason = failure.causeReason;
        }
    }
}

/**
 * 将浏览器差异化的 IndexedDB 异常归一为稳定原因码
 */
export function normalizeStorageError(
    error: unknown,
    operation: StorageOperation,
    options: { migration?: boolean } = {}
): StorageError {
    if (error instanceof StorageError && !options.migration) {
        return error;
    }

    const causeReason =
        error instanceof StorageError
            ? error.reason === "migration-failed"
                ? error.causeReason || "unknown-storage-error"
                : error.reason
            : classifyBaseReason(error);
    const reason = options.migration ? "migration-failed" : causeReason;
    const params = getErrorParams(error);
    return new StorageError(
        {
            reason,
            operation,
            message: `${reason}:${operation}`,
            ...(params === undefined ? {} : { params }),
            ...(options.migration
                ? { causeReason: causeReason as Exclude<StorageFailureReason, "migration-failed"> }
                : {})
        },
        { cause: error }
    );
}

/**
 * 创建不依赖浏览器原始异常的业务存储错误
 */
export function createStorageError(reason: StorageFailureReason, operation: StorageOperation): StorageError {
    return new StorageError({ reason, operation, message: `${reason}:${operation}` });
}

/**
 * 提取不包含正文或底层对象的失败摘要
 */
export function toStorageFailure(error: StorageError): StorageFailure {
    return {
        reason: error.reason,
        operation: error.operation,
        message: error.message,
        ...(error.params === undefined ? {} : { params: error.params }),
        ...(error.causeReason === undefined ? {} : { causeReason: error.causeReason })
    };
}

/**
 * 用户取消主动中止的事务不属于存储故障
 */
export function isExpectedStorageCancellation(error: unknown, signal?: AbortSignal): boolean {
    return Boolean(signal?.aborted && getErrorName(error) === "AbortError");
}
