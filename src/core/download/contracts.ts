import type {
    BookDownloadLock,
    CacheMeta,
    CachedData,
    Chapter,
    DownloadCancellationMode,
    RuntimeCacheSession,
    SourcePageType
} from "../../types";

/**
 * 下载核心接收的单章任务
 */
export interface DownloadTask {
    index: number;
    url: string;
    title: string;
}

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
    tasks: DownloadTask[];
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
 * 下载核心对外发布的进度快照
 * restored/fetched/processed/persisted 分别表示恢复、网络获取、内容处理和持久化进度，
 * completedCount 暂时兼容现有 UI 的章节完成数
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
    cachedChapterCount: number;
    cancellationRequested: boolean;
    hasExportData: boolean;
}

/**
 * 核心流程产生的结构化事件
 * 观察者不得通过事件直接修改下载状态
 */
export type DownloadEvent =
    | { type: "phase-changed"; previous: DownloadPhase; current: DownloadPhase; snapshot: DownloadSnapshot }
    | { type: "snapshot-updated"; snapshot: DownloadSnapshot }
    | { type: "cache-write-started"; chapterCount: number }
    | { type: "cache-write-finished"; chapterCount: number; saved: boolean }
    | { type: "chapter-restored"; task: DownloadTask }
    | { type: "chapter-processed"; task: DownloadTask; retry: boolean }
    | { type: "download-failed"; error: unknown; snapshot: DownloadSnapshot };

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
    fetch(url: string, signal?: AbortSignal): Promise<{ blob: Blob; ext: "jpg" | "png" } | null>;
}

/**
 * 下载核心所需的缓存操作
 * 写入接口只接收本批发生变化的章节
 */
export interface ChapterCacheRepository {
    putBatch(bookId: string, taskId: string, entries: ReadonlyMap<number, Chapter>, meta: CacheMeta): Promise<boolean>;
    clearForTask(bookId: string, taskId: string): Promise<boolean>;
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
    isImageDownloadEnabled(): boolean;
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
    coverFetcher: CoverFetcherPort;
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
    log(message: string): void;
}
