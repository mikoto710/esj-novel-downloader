import { vi } from "vitest";

/**
 * 测试资源类型
 */
export type TestResourceKind = "timer" | "listener" | "channel" | "database" | "custom";

interface TrackedResource {
    kind: TestResourceKind;
    label: string;
    cleanup: () => void | Promise<void>;
}

/**
 * 跟踪测试创建的外部资源，并在用例结束后统一回收
 */
export class TestResourceTracker {
    private readonly resources = new Map<symbol, TrackedResource>();

    track(kind: TestResourceKind, label: string, cleanup: () => void | Promise<void>): () => void {
        const token = Symbol(label);
        this.resources.set(token, { kind, label, cleanup });
        let released = false;

        return () => {
            if (released) {
                return;
            }
            released = true;
            this.resources.delete(token);
        };
    }

    list(): string[] {
        return Array.from(this.resources.values(), ({ kind, label }) => `${kind}:${label}`);
    }

    async cleanup(): Promise<string[]> {
        const leaked = this.list();
        const resources = Array.from(this.resources.values()).reverse();
        this.resources.clear();
        await Promise.allSettled(resources.map(({ cleanup }) => cleanup()));
        return leaked;
    }
}

/**
 * 当前测试环境共享的资源跟踪器
 */
export const testResources = new TestResourceTracker();

type MessageListener = (event: MessageEvent<unknown>) => void;

/**
 * 在同一进程内模拟 BroadcastChannel 的消息广播行为
 */
export class FakeBroadcastChannel {
    private static readonly groups = new Map<string, Set<FakeBroadcastChannel>>();

    readonly name: string;
    onmessage: MessageListener | null = null;
    onmessageerror: MessageListener | null = null;
    private readonly listeners = new Set<MessageListener>();
    private closed = false;
    private readonly releaseResource: () => void;

    constructor(name: string) {
        this.name = name;
        const group = FakeBroadcastChannel.groups.get(name) ?? new Set<FakeBroadcastChannel>();
        group.add(this);
        FakeBroadcastChannel.groups.set(name, group);
        this.releaseResource = testResources.track("channel", name, () => this.close());
    }

    postMessage(message: unknown): void {
        this.ensureOpen();
        const peers = FakeBroadcastChannel.groups.get(this.name) ?? new Set<FakeBroadcastChannel>();
        for (const peer of peers) {
            if (peer !== this && !peer.closed) {
                queueMicrotask(() => peer.dispatchMessage(message));
            }
        }
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type !== "message") {
            return;
        }
        this.listeners.add(toMessageListener(listener));
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type !== "message") {
            return;
        }
        this.listeners.delete(toMessageListener(listener));
    }

    dispatchEvent(event: Event): boolean {
        if (event.type === "message") {
            this.dispatchMessage((event as MessageEvent<unknown>).data);
        }
        return true;
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.listeners.clear();
        const group = FakeBroadcastChannel.groups.get(this.name);
        group?.delete(this);
        if (group?.size === 0) {
            FakeBroadcastChannel.groups.delete(this.name);
        }
        this.releaseResource();
    }

    static reset(): void {
        for (const group of this.groups.values()) {
            for (const channel of Array.from(group)) {
                channel.close();
            }
        }
        this.groups.clear();
    }

    private dispatchMessage(data: unknown): void {
        const event = { data, type: "message" } as MessageEvent<unknown>;
        this.onmessage?.(event);
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    private ensureOpen(): void {
        if (this.closed) {
            throw new DOMException("BroadcastChannel is closed", "InvalidStateError");
        }
    }
}

const objectListenerWrappers = new WeakMap<EventListenerObject, MessageListener>();

function toMessageListener(listener: EventListenerOrEventListenerObject): MessageListener {
    if (typeof listener === "function") {
        return listener as MessageListener;
    }
    let wrapper = objectListenerWrappers.get(listener);
    if (!wrapper) {
        wrapper = (event) => listener.handleEvent(event);
        objectListenerWrappers.set(listener, wrapper);
    }
    return wrapper;
}

/**
 * 将全局 BroadcastChannel 替换为测试实现
 */
export function installFakeBroadcastChannel(): typeof FakeBroadcastChannel {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as unknown as typeof BroadcastChannel);
    return FakeBroadcastChannel;
}
