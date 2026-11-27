import { createStorageError } from "../storage/cache/storage-error";
import type { DownloadCancellationPort, DownloadSchedulerPort } from "./contracts";

export const CANCELLATION_CACHE_FLUSH_TIMEOUT_MS = 10_000;

/**
 * 从首次取消计时，允许调用方停止等待未返回的操作
 */
export function createCancellationDeadline(
    cancellation: DownloadCancellationPort,
    schedule: DownloadSchedulerPort["schedule"]
) {
    const controller = new AbortController();
    const { signal } = controller;
    const requestSignal = cancellation.signal;
    let cancelTimer: (() => void) | undefined;
    const start = () => {
        if (cancelTimer || signal.aborted) {
            return;
        }
        const now = Date.now();
        const remaining = (cancellation.requestedAt ?? now) + CANCELLATION_CACHE_FLUSH_TIMEOUT_MS - now;
        const expire = () => controller.abort(createStorageError("flush-timeout", "flush"));
        if (remaining <= 0) {
            expire();
        } else {
            cancelTimer = schedule(remaining, expire);
        }
    };
    const unsubscribe = requestSignal
        ? () => requestSignal.removeEventListener("abort", start)
        : cancellation.subscribeCancellation(start);
    if (requestSignal?.aborted) {
        start();
    } else {
        requestSignal?.addEventListener("abort", start, { once: true });
    }

    return {
        signal,
        async wait<T>(pending: Promise<T>): Promise<T> {
            let onDeadline!: () => void;
            const expired = new Promise<never>((_resolve, reject) => {
                onDeadline = () => reject(signal.reason);
                if (signal.aborted) {
                    onDeadline();
                } else {
                    signal.addEventListener("abort", onDeadline, { once: true });
                }
            });
            try {
                return await Promise.race([expired, pending]);
            } finally {
                signal.removeEventListener("abort", onDeadline);
            }
        },
        dispose(): void {
            unsubscribe();
            cancelTimer?.();
        }
    };
}

export type CancellationDeadline = ReturnType<typeof createCancellationDeadline>;
