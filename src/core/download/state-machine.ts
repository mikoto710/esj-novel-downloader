import type { DownloadEventSink, DownloadPhase, DownloadSnapshot } from "./contracts";

// 取消和失败可以从多个运行阶段进入，因此与单向主流程分开描述
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

// 锁释放由外层生命周期负责，下载成功停在 export-ready
const FORWARD_TRANSITIONS: Readonly<Record<DownloadPhase, ReadonlySet<DownloadPhase>>> = {
    idle: new Set(["preparing"]),
    preparing: new Set(["restoring-cache"]),
    "restoring-cache": new Set(["downloading"]),
    downloading: new Set(["flushing-cache"]),
    "checking-integrity": new Set(["flushing-cache", "preparing-export"]),
    "flushing-cache": new Set(["checking-integrity", "preparing-export"]),
    "preparing-export": new Set(["export-ready"]),
    "export-ready": new Set(),
    cancelling: new Set(["cancelled", "failed"]),
    cancelled: new Set(),
    failed: new Set()
};

/**
 * 判断业务阶段转换是否合法，允许相同阶段幂等更新
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
     * 校验并切换阶段，变化时发布事件，非法转换抛错
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
