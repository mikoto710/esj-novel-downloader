import type {
    BookDownloadLock,
    BookCover,
    CacheMeta,
    CachedData,
    Chapter,
    DownloadCancellationMode,
    RuntimeCacheSession,
    SourcePageType
} from "../../types";
import type { DomainMessage, DomainMessageParams } from "../messages";
import type { StorageFailure } from "../cache/storage-error";
import type { MappingFontErrorCode, MappingFontErrorReason } from "../mapping-font";

/**
 * 下载核心接收的单章任务
 */
export interface DownloadTask {
    index: number;
    url: string;
    title: string;
}

/**
 * detail／forum 书籍下载所覆盖的原书章节范围
 * 索引固定为 0-based，用户界面和持久化摘要在各自边界转换为 1-based
 */
export interface DownloadSelection {
    mode: "all" | "range";
    sourceTotalChapters: number;
    startIndex: number;
    endIndex: number;
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
 * 站点密码授权由浏览器 adapter 实现；核心只编排结构化结果，不接触密码协议和 DOM
 */
export interface ProtectedChapterAuthPort {
    unlock(
        task: DownloadTask,
        protectedPageHtml: string,
        password: string,
        signal?: AbortSignal
    ): Promise<ProtectedChapterUnlockResult>;
}

export interface ProtectedChapterDetectorPort {
    isProtected(html: string): boolean;
}

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
 * 页面适配层启动一次全本下载所需的数据
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
 * 用户可观察的下载业务阶段
 * 锁的 preparing/running/released 状态由 BookLockService 单独维护，不与此状态机混用
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
    | "completed"
    | "cancelling"
    | "cancelled"
    | "failed"
    | "releasing-lock"
    | "released";

/**
 * 取消终态对应的缓存处理结果
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
 * 下载核心对外发布的进度快照
 * restored fetched processed persisted 分别表示恢复获取处理和持久化进度
 * completedCount 兼容现有任务决策计数
 * readyChapterCount 表示可进入导出的正文数
 */
export interface DownloadSnapshot {
    phase: DownloadPhase;
    scheduledCount: number;
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
    cachedChapterCount: number;
    cancellationRequested: boolean;
    cancellationOutcome: DownloadCancellationOutcome | null;
    storageFailure: StorageFailure | null;
    hasExportData: boolean;
}

/**
 * 当前任务已经确认的映射字体章节摘要
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
}

/**
 * 核心流程产生的结构化事件
 * 观察者不得通过事件直接修改下载状态
 */
export type DownloadEvent =
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
 * 当前页面运行状态的兼容边界
 * coordinator 通过该接口使用章节和取消状态，不直接访问全局 state 单例
 */
export interface DownloadRuntimePort {
    readonly chapters: Map<number, Chapter>;
    readonly signal: AbortSignal | undefined;
    readonly activeBookLock: BookDownloadLock | null;
    readonly originalTitle: string;
    isCancellationRequested(): boolean;
    requestCancellation(mode?: DownloadCancellationMode): void;
    subscribeCancellation(listener: (mode: DownloadCancellationMode) => void): () => void;
    startCacheSession(meta: CacheMeta, taskId: string, initialChapterCount: number): void;
    updateCacheSession(progress: Partial<RuntimeCacheSession>): void;
    setExportData(data: CachedData): void;
}

/**
 * DOM、标题、进度条和弹窗更新接口
 */
export interface DownloadUiPort {
    prepare(): void;
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
    showFormatChoice(): void;
}

/**
 * 章节 HTML 获取接口，重试策略由 coordinator 控制
 */
export interface ChapterFetcherPort {
    fetch(task: DownloadTask, signal?: AbortSignal): Promise<string>;
}

/**
 * 章节解析和图片处理接口
 */
export interface ChapterProcessorPort {
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
 * 下载核心所需的缓存操作
 * 写入接口只接收本批发生变化的章节
 */
export interface ChapterCacheRepository {
    putBatch(
        bookId: string,
        taskId: string,
        entries: ReadonlyMap<number, Chapter>,
        meta: CacheMeta,
        signal?: AbortSignal
    ): Promise<boolean>;
    clearForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean>;
}

/**
 * 下载锁查询接口，锁的获取与释放由外层任务生命周期负责
 */
export interface BookLockService {
    owns(lock: BookDownloadLock | null): Promise<boolean>;
    shouldDiscardCache(lock: BookDownloadLock | null): Promise<boolean>;
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
 * 下载设置读取接口
 */
export interface DownloadSettingsPort {
    getConcurrency(): number;
}

/**
 * 当前 URL 和系统时间接口
 */
export interface DownloadEnvironmentPort {
    currentUrl(): string;
    now(): number;
}

/**
 * 完成一次下载所需的业务端口
 */
export interface DownloadPorts {
    runtime: DownloadRuntimePort;
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
 * coordinator 的完整构造参数
 */
export interface DownloadDependencies extends DownloadPorts {
    scheduler: DownloadSchedulerPort;
    settings: DownloadSettingsPort;
    environment: DownloadEnvironmentPort;
    log(message: DownloadLog): void;
}
