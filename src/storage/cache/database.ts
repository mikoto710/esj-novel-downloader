import { createStore } from "idb-keyval";

type CacheTransactionResult<T> = (value: T) => void;

const CACHE_V3_DATABASE = "esj-novel-downloader-cache-v3";
const CACHE_V3_STORE = "records";
export const cacheV3Store = createStore(CACHE_V3_DATABASE, CACHE_V3_STORE);

function createCacheAbortError(): DOMException {
    return new DOMException("缓存事务已中止", "AbortError");
}

// 在事务提交后返回已登记的业务结果，同步回调只负责安排 IDB 请求
export function runWriteTransaction<T>(
    operation: (store: IDBObjectStore, setResult: CacheTransactionResult<T>) => void,
    signal?: AbortSignal,
    useStore = cacheV3Store
): Promise<T> {
    return useStore(
        "readwrite",
        (store) =>
            new Promise<T>((resolve, reject) => {
                let result: T;
                let hasResult = false;
                let operationFailed = false;
                let operationError: unknown;
                const transaction = store.transaction;
                const cleanupAbortListener = () => signal?.removeEventListener("abort", onSignalAbort);
                const onSignalAbort = () => {
                    try {
                        transaction.abort();
                    } catch {
                        // 事务已经完成时无需重复中止
                        cleanupAbortListener();
                        reject(createCacheAbortError());
                    }
                    // abort() 只发起中止，等待 onabort 后才能向调用方交还 writer
                };

                // 请求回调只登记结果，事务提交后才向上层确认；回调中不插入非 IDB 异步等待
                transaction.oncomplete = () => {
                    cleanupAbortListener();
                    if (!hasResult) {
                        reject(new Error("缓存事务未返回结果"));
                        return;
                    }
                    resolve(result);
                };
                // 请求错误默认中止事务，统一在 onabort 结束等待，避免错误事件先于回滚完成
                transaction.onabort = () => {
                    cleanupAbortListener();
                    reject(operationFailed ? operationError : (transaction.error ?? createCacheAbortError()));
                };

                if (signal?.aborted) {
                    onSignalAbort();
                    return;
                }
                signal?.addEventListener("abort", onSignalAbort, { once: true });

                try {
                    operation(store, (value) => {
                        result = value;
                        hasResult = true;
                    });
                } catch (error) {
                    operationFailed = true;
                    operationError = error;
                    try {
                        transaction.abort();
                    } catch {
                        // 同步异常发生在事务完成边界时无需重复中止
                        cleanupAbortListener();
                        reject(error);
                    }
                }
            })
    );
}
