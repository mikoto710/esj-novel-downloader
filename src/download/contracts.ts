import type { DownloadSelection } from "./plan";
import type { ExportSnapshot } from "../export/snapshot";
import type { CacheMeta } from "../storage/cache/model";
import type { BookCover, Chapter, SourcePageType } from "../content/model";
import type { DomainMessage, DomainMessageParams } from "../messages";
import type { StorageFailure } from "../storage/cache/storage-error";
import type { MappingFontErrorCode, MappingFontErrorReason, NormalizedChapterMapping } from "../content/mapping-font";

/**
 * 取消请求决定尚未落盘缓存的处理方式
 */
export type DownloadCancellationMode = "flush" | "discard";

/**
 * 下载核心接收的单章任务
 */
export interface DownloadTask {
    index: number;
    url: string;
    title: string;
}

export type DownloadLogCode =
    | "cover-cache-hit"
    | "cover-cache-read-failed"
    | "cover-cache-saved"
    | "cover-cache-write-ownership-lost"
    | "cover-cache-write-failed"
    | "restored-mapping-font-invalid"
    | "cache-restored"
    | "cache-restored-with-invalidated"
    | "cache-write-retry"
    | "chapter-fetch-failed"
    | "chapter-mapping-font-failed"
    | "chapter-processed"
    | "chapter-processed-with-images"
    | "chapter-processed-with-image-failures"
    | "chapter-skipped-non-site"
    | "protected-chapter-retry-skipped"
    | "protected-chapter-redetected"
    | "protected-chapter-queued"
    | "protected-chapter-skipped"
    | "protected-chapter-connection-retry"
    | "protected-chapter-connection-failed"
    | "protected-chapter-password-rejected"
    | "protected-chapter-protocol-failed"
    | "protected-chapter-unlocked"
    | "integrity-check-started"
    | "integrity-check-passed"
    | "integrity-check-failed"
    | "chapter-integrity-retry"
    | "missing-chapter-retry"
    | "missing-chapter-export-with-placeholders"
    | "missing-chapter-retry-started"
    | "missing-chapter-retry-saved"
    | "cancellation-cache-write-skipped-lock-lost"
    | "cancellation-cache-discard-requested"
    | "cancellation-cache-write-started"
    | "cancellation-finished"
    | "cache-restore-started"
    | "download-started"
    | "download-main-flush-started"
    | "download-integrity-flush-started"
    | "export-preparation-started"
    | "download-completed"
    | "download-storage-failed"
    | "cache-discard-failed";

export type DownloadLog = DomainMessage<DownloadLogCode>;

export type DownloadChapterFailureCode = string;

export type ProtectedChapterProtocolErrorCode =
    | "token-invalid"
    | "response-invalid"
    | "unknown-status"
    | "content-invalid";

export type ProtectedChapterPromptMessageCode =
    | "connection-failed"
    | "password-rejected"
    | ProtectedChapterProtocolErrorCode;

export type ProtectedChapterUnlockResult =
    | { kind: "unlocked"; html: string }
    | { kind: "password-rejected"; message?: string }
    | { kind: "protocol-error"; code: ProtectedChapterProtocolErrorCode; params?: DomainMessageParams };

/**
 * 站点密码授权由 site/protected-chapter 实现；核心只编排结构化结果，不接触密码协议和 DOM
 */
export interface ProtectedChapterAuthPort {
    unlock(
        task: DownloadTask,
        protectedPageHtml: string,
        password: string,
        signal?: AbortSignal
    ): Promise<ProtectedChapterUnlockResult>;
}

/**
 * 由站点实现密码正文识别，下载核心仅接收判断结果
 */
export interface ProtectedChapterDetectorPort {
    isProtected(html: string): boolean;
}

/**
 * 密码决策弹窗的任务位置、原站提示和重试输入，密码仅留任务内存
 */
export interface ProtectedChapterPrompt {
    task: DownloadTask;
    // 范围内 1-based 顺序；原书位置继续由 task.index 表示
    taskOrder?: number;
    totalChapters: number;
    sourceTotalChapters?: number;
    selectionMode?: DownloadSelection["mode"];
    pendingCount: number;
    // 仅保留 ESJZone status 206 返回的原始站点提示
    message?: string;
    messageCode?: ProtectedChapterPromptMessageCode;
    messageParams?: DomainMessageParams;
    initialPassword?: string;
    rememberPassword?: boolean;
    retryConnection?: boolean;
}

export type ProtectedChapterDecision =
    | { action: "submit"; password: string; rememberPassword: boolean }
    | { action: "skip-current" }
    | { action: "skip-all" }
    | { action: "cancel" };

/**
 * 单书应用流程传入下载内核的任务数据
 */
export interface DownloadOptions {
    bookId: string;
    taskId: string;
    bookName: string;
    rawBookName?: string;
    author?: string;
    introTxt: string;
    description: string;
    tags: string[];
    coverUrl?: string;
    pageUrl?: string;
    sourcePageType?: SourcePageType;
    imageEnabled: boolean;
    tasks: DownloadTask[];
    selection?: DownloadSelection;
}

/**
 * 用户可观察的下载业务阶段，锁状态由外层生命周期维护
 */
export type DownloadPhase =
    | "idle"
    | "preparing"
    | "restoring-cache"
    | "downloading"
    | "checking-integrity"
    | "flushing-cache"
    | "preparing-export"
    | "export-ready"
    | "cancelling"
    | "cancelled"
    | "failed";

/**
 * 取消终态对应的待写缓存处理结果，discarded 不表示持久缓存已清除
 */
export type DownloadCancellationOutcome = "saved" | "save-failed" | "save-timed-out" | "discarded" | "ownership-lost";

export type DownloadTerminalFailure =
    | {
          kind: "download";
          code: DownloadChapterFailureCode;
          params: DomainMessageParams;
          storageFailure: StorageFailure | null;
      }
    | {
          kind: "cancellation";
          outcome: Exclude<DownloadCancellationOutcome, "saved" | "discarded">;
          storageFailure: StorageFailure | null;
      };

/**
 * 本次下载范围的阶段和计数快照
 */
export interface DownloadSnapshot {
    phase: DownloadPhase;
    scheduledCount: number;
    // 恢复、获取、处理和落盘分别计数，正文就绪数独立计算
    restoredCount: number;
    fetchedCount: number;
    processedCount: number;
    persistedCount: number;
    retryPendingCount: number;
    failedCount: number;
    completedCount: number;
    readyChapterCount: number;
    protectedDetectedCount: number;
    protectedPendingCount: number;
    protectedResolvedCount: number;
    protectedSkippedCount: number;
    cancellationRequested: boolean;
    cancellationOutcome: DownloadCancellationOutcome | null;
    storageFailure: StorageFailure | null;
    hasExportData: boolean;
}

/**
 * 已识别的映射字体章节摘要，不代表用户已经同意继续
 */
export interface MappingFontSummary {
    chapterCount: number;
    fontBytes: number;
}

/**
 * 首次发现映射正文时提供给 UI 的确认信息
 */
export interface MappingFontDetection extends MappingFontSummary {
    task: DownloadTask;
    // 弹窗出现后仍可能完成的最大在途章节数；缓存恢复阶段尚未发出请求，因此为 0
    inFlightLimit: number;
}

/**
 * 与原章节任务关联的字体错误，供补抓与最终失败说明使用
 */
export interface MappingFontFailure {
    task: DownloadTask;
    code: MappingFontErrorCode;
    reason: MappingFontErrorReason;
    params: DomainMessageParams;
}

export type IncompleteChapterDecision = "retry" | "export-with-placeholders" | "cancel";

/**
 * 自动补抓和落盘完成后仍缺失的正文摘要
 */
export interface IncompleteChapterDetection {
    missingTasks: readonly DownloadTask[];
    totalChapters: number;
    sourceTotalChapters?: number;
    selectionMode?: DownloadSelection["mode"];
    taskOrderByIndex?: ReadonlyMap<number, number>;
}

/**
 * 核心流程产生的结构化事件，观察者不得通过事件修改下载状态
 */
export type DownloadEvent =
    | { type: "task-started"; meta: CacheMeta; taskId: string; bookChapterCount: number }
    | { type: "phase-changed"; previous: DownloadPhase; current: DownloadPhase; snapshot: DownloadSnapshot }
    | { type: "snapshot-updated"; snapshot: DownloadSnapshot }
    | { type: "cache-write-started"; chapterCount: number }
    | { type: "cache-write-finished"; chapterCount: number; saved: boolean; failure: StorageFailure | null }
    | { type: "chapter-restored"; task: DownloadTask }
    | { type: "chapter-processed"; task: DownloadTask; retry: boolean }
    | {
          type: "chapter-failed";
          task: DownloadTask;
          stage: "fetch" | "mapping-font" | "protected-auth";
          code: DownloadChapterFailureCode;
          params: DomainMessageParams;
          retry: boolean;
      }
    | { type: "protected-chapter-password-rejected"; task: DownloadTask }
    | { type: "mapping-font-updated"; summary: MappingFontSummary }
    | {
          type: "incomplete-chapters-decided";
          missingCount: number;
          decision: IncompleteChapterDecision;
      }
    | {
          type: "download-failed";
          code: DownloadChapterFailureCode;
          params: DomainMessageParams;
          snapshot: DownloadSnapshot;
      };

/**
 * 取消能力独立于章节数据和页面状态
 */
export interface DownloadCancellationPort {
    readonly signal: AbortSignal | undefined;
    isCancellationRequested(): boolean;
    requestCancellation(mode?: DownloadCancellationMode): void;
    subscribeCancellation(listener: (mode: DownloadCancellationMode) => void): () => void;
}

/**
 * 成功携带导出快照；取消保留旧结果，持久清除仍由外层收尾确认
 */
export type DownloadResult =
    | { status: "ready"; data: ExportSnapshot }
    | { status: "cancelled"; outcome: DownloadCancellationOutcome };

/**
 * DOM、标题、进度条和弹窗更新接口
 */
export interface DownloadUiPort {
    prepare(selection: DownloadSelection): void;
    update(snapshot: DownloadSnapshot): void;
    confirmMappingFontDownload(detection: MappingFontDetection, signal?: AbortSignal): Promise<boolean>;
    confirmIncompleteChapters(
        detection: IncompleteChapterDetection,
        signal?: AbortSignal
    ): Promise<IncompleteChapterDecision>;
    promptProtectedChapterPassword(
        prompt: ProtectedChapterPrompt,
        signal?: AbortSignal,
        onPendingDecision?: (
            decision: Extract<ProtectedChapterDecision, { action: "skip-current" | "skip-all" | "cancel" }>
        ) => void
    ): Promise<ProtectedChapterDecision>;
    closeProtectedChapterPrompt(): void;
    updateMappingFontWarning(summary: MappingFontSummary): void;
    showMappingFontFailure(failures: readonly MappingFontFailure[]): void;
    showTerminalFailure(failure: DownloadTerminalFailure): void;
    cleanup(): void;
}

/**
 * 章节 HTML 获取接口，单章网络重试策略由 chapter-pipeline 控制
 */
export interface ChapterFetcherPort {
    fetch(task: DownloadTask, signal?: AbortSignal): Promise<string>;
}

/**
 * 章节解析和图片处理接口
 */
export interface ChapterProcessorPort {
    normalizeCached(chapter: Chapter, signal?: AbortSignal): Promise<NormalizedChapterMapping>;
    process(html: string, task: DownloadTask, imageEnabled: boolean, signal?: AbortSignal): Promise<Chapter>;
}

/**
 * 封面获取接口，封面失败不应中断章节下载
 */
export interface CoverFetcherPort {
    fetch(url: string, signal?: AbortSignal): Promise<BookCover | null>;
}

/**
 * 独立封面缓存接口；失败只影响封面复用，不改变正文缓存状态
 */
export interface CoverCacheRepository {
    load(bookId: string, coverUrl: string): Promise<BookCover | null>;
    put(bookId: string, taskId: string, coverUrl: string, cover: BookCover, signal?: AbortSignal): Promise<boolean>;
}

/**
 * 下载核心所需的缓存操作，写入接口只接收本批发生变化的章节
 */
export interface ChapterCacheRepository {
    putBatch(
        bookId: string,
        taskId: string,
        entries: ReadonlyMap<number, Chapter>,
        meta: CacheMeta,
        signal?: AbortSignal
    ): Promise<boolean>;
    finishForTask(bookId: string, taskId: string, meta: CacheMeta, signal?: AbortSignal): Promise<boolean>;
    clearForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean>;
}

/**
 * 下载锁查询接口，锁的获取与释放由外层任务生命周期负责
 */
export interface BookLockService {
    owns(): Promise<boolean>;
    shouldDiscardCache(): Promise<boolean>;
}

/**
 * 结构化事件的单向输出接口
 */
export interface DownloadEventSink {
    emit(event: DownloadEvent): void;
}

/**
 * 异步等待和随机延迟接口
 */
export interface DownloadSchedulerPort {
    sleep(ms: number): Promise<void>;
    sleepWithAbort(ms: number): Promise<void>;
    randomDelay(minInclusive: number, maxInclusive: number): number;
    schedule(delayMs: number, callback: () => void): () => void;
}

/**
 * 下载任务使用的章节表、取消状态与外部能力
 */
export interface DownloadPorts {
    chapters: Map<number, Chapter>;
    cancellation: DownloadCancellationPort;
    ui: DownloadUiPort;
    chapterFetcher: ChapterFetcherPort;
    chapterProcessor: ChapterProcessorPort;
    protectedChapterDetector: ProtectedChapterDetectorPort;
    protectedChapterAuth: ProtectedChapterAuthPort;
    coverFetcher: CoverFetcherPort;
    coverCache: CoverCacheRepository;
    cache: ChapterCacheRepository;
    lock: BookLockService;
    events: DownloadEventSink;
}

/**
 * runDownload 使用的运行能力与装配时固定的并发数、地址和启动时间
 */
export interface DownloadDependencies extends DownloadPorts {
    scheduler: DownloadSchedulerPort;
    // 仅在启动时读取，任务过程中不反查页面设置
    concurrency: number;
    fallbackPageUrl: string;
    startedAt: number;
    log(message: DownloadLog): void;
}
