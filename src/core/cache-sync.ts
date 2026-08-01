/**
 * 跨页面同步的缓存变更事件
 */
export type CacheSyncEvent =
    | { type: "cache-claimed"; bookId: string; taskId: string }
    | { type: "cache-cleared"; bookId: string }
    | { type: "cache-saved"; bookId: string; taskId: string };

type CacheSyncListener = (event: CacheSyncEvent) => void;

const CHANNEL_NAME = "esj-novel-downloader-cache-sync";
const listeners = new Set<CacheSyncListener>();
let channel: BroadcastChannel | null = null;
let channelUnavailable = false;

function isCacheSyncEvent(value: unknown): value is CacheSyncEvent {
    if (!value || typeof value !== "object") {
        return false;
    }

    const event = value as { type?: unknown; bookId?: unknown; taskId?: unknown };
    if (typeof event.bookId !== "string" || typeof event.type !== "string") {
        return false;
    }

    return (
        event.type === "cache-cleared" ||
        (typeof event.taskId === "string" && (event.type === "cache-claimed" || event.type === "cache-saved"))
    );
}

function getChannel(): BroadcastChannel | null {
    if (channel || channelUnavailable || typeof BroadcastChannel === "undefined") {
        return channel;
    }

    try {
        // BroadcastChannel 不可用时禁用跨标签页同步，不阻塞当前页面流程
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.addEventListener("message", (message: MessageEvent<unknown>) => {
            const event = message.data;
            if (!isCacheSyncEvent(event)) {
                return;
            }
            listeners.forEach((listener) => listener(event));
        });
    } catch {
        channelUnavailable = true;
    }

    return channel;
}

/**
 * 向其他标签页发布缓存变更事件
 */
export function publishCacheSyncEvent(event: CacheSyncEvent): void {
    getChannel()?.postMessage(event);
}

/**
 * 订阅其他标签页发送的缓存变更事件
 */
export function subscribeCacheSync(listener: CacheSyncListener): () => void {
    getChannel();
    listeners.add(listener);
    return () => listeners.delete(listener);
}
