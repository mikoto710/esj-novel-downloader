import type { Chapter } from "../../content/model";
import type { DownloadPlan } from "../../download/plan";
import type { DownloadEventSink, DownloadPhase, DownloadSnapshot, DownloadUiPort } from "./contracts";

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
        cancellationRequested: false,
        cancellationOutcome: null,
        storageFailure: null,
        hasExportData: false
    };
}

/**
 * 统一阶段校验和进度写入，范围就绪数从任务章节表计算
 */
export class DownloadProgress {
    private current: DownloadSnapshot;
    constructor(
        private readonly plan: DownloadPlan,
        private readonly chapters: Map<number, Chapter>,
        private readonly events: DownloadEventSink,
        private readonly ui: Pick<DownloadUiPort, "update">
    ) {
        this.current = createInitialDownloadSnapshot(plan.tasks.length, plan.readyCount(chapters));
    }

    /**
     * 返回显示快照，调用方修改不影响任务状态
     */
    get snapshot(): DownloadSnapshot {
        return { ...this.current };
    }

    /**
     * 校验阶段后发布事件并更新界面
     */
    transition(phase: DownloadPhase): void {
        const previous = this.current.phase;
        if (!canTransitionDownloadPhase(previous, phase)) {
            throw new Error(`非法下载状态转换: ${previous} -> ${phase}`);
        }
        if (previous !== phase) {
            this.current = { ...this.current, phase };
            this.events.emit({ type: "phase-changed", previous, current: phase, snapshot: this.snapshot });
        }
        this.ui.update(this.snapshot);
    }

    /**
     * 更新业务计数并重新计算本次范围内的正文数
     */
    update(values: Partial<Omit<DownloadSnapshot, "phase" | "readyChapterCount">>): void {
        this.current = { ...this.current, ...values, readyChapterCount: this.plan.readyCount(this.chapters) };
        this.events.emit({ type: "snapshot-updated", snapshot: this.snapshot });
        this.ui.update(this.snapshot);
    }
}
