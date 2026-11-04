import type { StorageFailure } from "../storage/cache/storage-error";
import type { Chapter } from "../content/model";
import type { DownloadPlan } from "./plan";
import type {
    DownloadEventSink,
    DownloadPhase,
    DownloadSnapshot,
    DownloadUiPort,
    DownloadCancellationOutcome
} from "./contracts";

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
        bookChapterCount: restoredCount,
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
 * 统一阶段校验和进度写入，本次就绪数从固定任务表计算
 */
export class DownloadProgress {
    private current: DownloadSnapshot;
    private readonly persistedIndexes: Set<number>;
    constructor(
        private readonly plan: DownloadPlan,
        private readonly chapters: ReadonlyMap<number, Chapter>,
        private readonly events: DownloadEventSink,
        private readonly ui: Pick<DownloadUiPort, "update">
    ) {
        this.current = createInitialDownloadSnapshot(plan.tasks.length, plan.readyCount(chapters));
        this.current.bookChapterCount = chapters.size;
        this.persistedIndexes = new Set(
            plan.tasks.filter((task) => chapters.has(task.index)).map((task) => task.index)
        );
    }

    /**
     * 返回顶层浅快照，嵌套失败摘要仍由任务持有，调用方不得改写
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
     * 有效恢复数同时成为初轮完成数和已持久化数
     */
    recordCacheRestored(): void {
        const restoredCount = this.plan.readyCount(this.chapters);
        this.update({ restoredCount, completedCount: restoredCount, persistedCount: restoredCount });
    }

    /**
     * 抓取累计包括补抓，密码授权请求不计入普通抓取
     */
    recordFetched(): void {
        this.update({ fetchedCount: this.current.fetchedCount + 1 });
    }

    /**
     * 初轮处理推进完成数；补抓只增加实际处理数
     */
    recordProcessed(isRetry = false): void {
        this.update({
            completedCount: this.current.completedCount + (isRetry ? 0 : 1),
            processedCount: this.current.processedCount + 1
        });
    }

    recordInitialFailure(): void {
        this.update({ completedCount: this.current.completedCount + 1, failedCount: this.current.failedCount + 1 });
    }

    /**
     * 仅确认提交的所选索引进入集合，重复写入不重复累计
     */
    recordCommitted(indexes: Iterable<number>): void {
        for (const index of indexes) {
            if (this.plan.indexes.has(index)) {
                this.persistedIndexes.add(index);
            }
        }
        this.update({ persistedCount: this.persistedIndexes.size });
    }

    invalidatePersistedChapter(index: number): void {
        this.persistedIndexes.delete(index);
    }

    /**
     * 完整性扫描可含图片问题；缺正文扫描由调用方明确传入自己的结果
     */
    recordIntegrityScan(failedCount: number, retryPendingCount = 0): void {
        this.update({ failedCount, retryPendingCount });
    }

    recordRetryFinished(completed: boolean): void {
        this.update({
            retryPendingCount: Math.max(0, this.current.retryPendingCount - 1),
            failedCount: Math.max(0, this.current.failedCount - (completed ? 1 : 0))
        });
    }

    /**
     * 密码模块持有集合和轮次规则，此处只接收它汇总的计数
     */
    recordProtectedSummary(
        summary: Pick<
            DownloadSnapshot,
            "protectedDetectedCount" | "protectedPendingCount" | "protectedResolvedCount" | "protectedSkippedCount"
        >
    ): void {
        this.update(summary);
    }

    recordExportReady(): void {
        this.update({ completedCount: this.plan.tasks.length, hasExportData: true });
    }

    recordCancellationRequested(): void {
        this.update({ cancellationRequested: true, hasExportData: false, protectedPendingCount: 0 });
    }

    recordCancellationFinished(
        cancellationOutcome: DownloadCancellationOutcome,
        storageFailure: StorageFailure | null
    ): void {
        this.update({ cancellationOutcome, storageFailure });
    }

    recordStorageFailure(storageFailure: StorageFailure): void {
        this.update({ storageFailure });
    }

    // 共用合并和发布留在内部，调用者不能任意改写快照
    private update(values: Partial<Omit<DownloadSnapshot, "phase" | "readyChapterCount" | "bookChapterCount">>): void {
        this.current = {
            ...this.current,
            ...values,
            readyChapterCount: this.plan.readyCount(this.chapters),
            bookChapterCount: this.chapters.size
        };
        this.events.emit({ type: "snapshot-updated", snapshot: this.snapshot });
        this.ui.update(this.snapshot);
    }
}
