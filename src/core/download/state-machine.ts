import type { DownloadEventSink, DownloadPhase, DownloadSnapshot } from "./contracts";

// 取消和失败可以从多个运行阶段进入，因此与单向主流程分开描述
const TERMINAL_PHASES = new Set<DownloadPhase>(["completed", "cancelled", "failed"]);
const CANCELLABLE_PHASES = new Set<DownloadPhase>([
    "preparing",
    "restoring-cache",
    "downloading",
    "checking-integrity",
    "flushing-cache",
    "preparing-export"
]);
const RUNNING_PHASES = new Set<DownloadPhase>([
    "preparing",
    "restoring-cache",
    "downloading",
    "checking-integrity",
    "flushing-cache",
    "preparing-export",
    "export-ready"
]);

// 主流程只允许向前推进，releasing-lock/released 暂时由页面任务 finalizer 驱动
const FORWARD_TRANSITIONS: Readonly<Record<DownloadPhase, ReadonlySet<DownloadPhase>>> = {
    idle: new Set(["preparing"]),
    preparing: new Set(["restoring-cache"]),
    "restoring-cache": new Set(["downloading"]),
    downloading: new Set(["flushing-cache"]),
    "checking-integrity": new Set(["flushing-cache", "preparing-export"]),
    "flushing-cache": new Set(["checking-integrity", "preparing-export"]),
    "preparing-export": new Set(["export-ready"]),
    "export-ready": new Set(["completed", "releasing-lock"]),
    completed: new Set(["releasing-lock"]),
    cancelling: new Set(["cancelled", "failed"]),
    cancelled: new Set(["releasing-lock"]),
    failed: new Set(["releasing-lock"]),
    "releasing-lock": new Set(["released"]),
    released: new Set()
};

/**
 * 判断业务阶段转换是否合法
 * 相同阶段用于幂等更新，不视为错误
 */
export function canTransitionDownloadPhase(from: DownloadPhase, to: DownloadPhase): boolean {
    if (from === to) {
        return true;
    }
    if (to === "cancelling" && CANCELLABLE_PHASES.has(from)) {
        return true;
    }
    if (to === "failed" && RUNNING_PHASES.has(from)) {
        return true;
    }
    if (to === "releasing-lock" && TERMINAL_PHASES.has(from)) {
        return true;
    }
    return FORWARD_TRANSITIONS[from].has(to);
}

/**
 * 创建下载任务的初始进度快照
 */
export function createInitialDownloadSnapshot(scheduledCount: number, restoredCount: number): DownloadSnapshot {
    return {
        phase: "idle",
        scheduledCount,
        restoredCount,
        fetchedCount: 0,
        processedCount: 0,
        persistedCount: 0,
        retryPendingCount: 0,
        failedCount: 0,
        completedCount: 0,
        readyChapterCount: restoredCount,
        protectedDetectedCount: 0,
        protectedPendingCount: 0,
        protectedResolvedCount: 0,
        protectedSkippedCount: 0,
        cachedChapterCount: restoredCount,
        cancellationRequested: false,
        cancellationOutcome: null,
        storageFailure: null,
        hasExportData: false
    };
}

/**
 * 下载业务状态机
 * 只负责合法转换、进度快照和事件发布，不执行网络、缓存、锁或 UI 操作
 */
export class DownloadStateMachine {
    private current: DownloadSnapshot;

    constructor(
        scheduledCount: number,
        restoredCount: number,
        private readonly events: DownloadEventSink
    ) {
        this.current = createInitialDownloadSnapshot(scheduledCount, restoredCount);
    }

    /**
     * 返回当前下载快照的副本，调用方修改不会影响状态机
     */
    get snapshot(): DownloadSnapshot {
        // 始终返回副本，避免 UI 或事件观察者修改状态机内部数据
        return { ...this.current };
    }

    /**
     * 校验并应用业务阶段转换，阶段变化时发布事件且非法转换抛出错误
     * 相同阶段只返回当前快照，不重复发布阶段事件
     */
    transition(phase: DownloadPhase): DownloadSnapshot {
        const previous = this.current.phase;
        if (!canTransitionDownloadPhase(previous, phase)) {
            // 非法阶段通常表示 coordinator 实现错误，应立即暴露而不是静默纠正
            throw new Error(`非法下载状态转换: ${previous} -> ${phase}`);
        }
        if (previous !== phase) {
            this.current = { ...this.current, phase };
            this.events.emit({ type: "phase-changed", previous, current: phase, snapshot: this.snapshot });
        }
        return this.snapshot;
    }

    /**
     * 合并不含阶段的进度字段，发布快照事件并返回新副本
     */
    update(progress: Partial<Omit<DownloadSnapshot, "phase">>): DownloadSnapshot {
        this.current = { ...this.current, ...progress };
        const snapshot = this.snapshot;
        this.events.emit({ type: "snapshot-updated", snapshot });
        return snapshot;
    }
}
