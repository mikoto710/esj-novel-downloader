import { createStore, get, set } from "idb-keyval";
import { onTestFinished } from "vitest";

/**
 * 在当前用例的 IndexedDB 打开旧版默认仓库，避免复用上个用例的默认连接
 */
export function openLegacyCacheFixture() {
    const store = createStore("keyval-store", "keyval");
    onTestFinished(() => store("readonly", (objectStore) => objectStore.transaction.db.close()));
    return {
        get: (key: string) => get<unknown>(key, store),
        set: (key: string, value: unknown) => set(key, value, store)
    };
}
