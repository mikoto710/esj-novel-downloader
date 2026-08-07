import { ZH_CN_MESSAGES } from "./locales/zh-CN";
import { ZH_TW_MESSAGES } from "./locales/zh-TW";

export { ZH_CN_MESSAGES, ZH_TW_MESSAGES };

/**
 * 脚本界面语言
 */
export type InterfaceLocale = "zh-CN" | "zh-TW";

export const INTERFACE_LOCALE_PREFERENCES = ["auto", "zh-CN", "zh-TW"] as const;
export type InterfaceLocalePreference = (typeof INTERFACE_LOCALE_PREFERENCES)[number];

/**
 * 检查界面语言偏好是否有效
 */
export function isInterfaceLocalePreference(value: unknown): value is InterfaceLocalePreference {
    return INTERFACE_LOCALE_PREFERENCES.some((preference) => preference === value);
}

/**
 * 按优先级解析界面语言
 */
export function resolveInterfaceLocale(
    preference: InterfaceLocalePreference,
    websiteLocale: InterfaceLocale | null,
    browserLocale: InterfaceLocale
): InterfaceLocale {
    return preference === "auto" ? (websiteLocale ?? browserLocale) : preference;
}

export type LocaleMessageValue = string | number | boolean;
export type LocaleMessageParams = Readonly<Record<string, LocaleMessageValue>>;
export type LocaleCatalog = Readonly<Record<string, string>>;
export type LocaleCatalogs = Readonly<Record<InterfaceLocale, LocaleCatalog>>;

/**
 * 基础文案键，后续迁移按需扩充
 */
export const LOCALE_KEYS = [
    "common.confirm",
    "common.cancel",
    "common.close",
    "common.minimize",
    "common.infoTitle",
    "common.warningTitle",
    "common.errorTitle",
    "common.viewDiagnostics",
    "common.preparing",
    "common.retry",
    "common.skip",
    "common.skipAll",
    "common.loading",
    "button.downloadAll",
    "button.settings",
    "settings.title",
    "settings.versionUnknown",
    "settings.concurrency",
    "settings.cache",
    "settings.history",
    "settings.diagnostics",
    "settings.diagnosticsButton",
    "settings.diagnosticsDescription",
    "settings.imageDownload",
    "settings.imageDownloadDescription",
    "settings.epubTagPage",
    "settings.epubTagPageDescription",
    "settings.relatedLinks",
    "settings.github",
    "settings.greasyFork",
    "settings.feedback",
    "settings.interfaceLanguage",
    "settings.interfaceLanguage.auto",
    "settings.interfaceLanguage.simplified",
    "settings.interfaceLanguage.traditional",
    "confirm.download.title",
    "confirm.download.cached",
    "confirm.download.empty",
    "confirm.imageSettings.title",
    "confirm.imageSettings.message",
    "confirm.imageSettings.continue",
    "download.progress",
    "download.status.stopped",
    "download.status.stopping",
    "download.status.initializing",
    "download.status.validatingCache",
    "download.status.preparingCache",
    "download.status.savingProgress",
    "download.status.checkingIntegrity",
    "download.status.preparingExport",
    "download.status.exportReady",
    "download.status.running",
    "download.status.runningProtected",
    "download.status.protectedTitle",
    "download.action.stopped",
    "download.action.stopping",
    "download.action.saving",
    "download.log.coverCacheHit",
    "download.log.coverCacheReadFailed",
    "download.log.coverCacheSaved",
    "download.log.coverCacheOwnershipLost",
    "download.log.coverCacheWriteFailed",
    "download.log.cacheRestored",
    "download.log.cacheRestoredInvalidated",
    "download.log.cacheWriteRetry",
    "download.log.chapterFetchFailed",
    "download.log.chapterProcessedBase",
    "download.log.chapterProcessedRetryBase",
    "download.log.chapterProcessed",
    "download.log.chapterProcessedRetry",
    "download.log.chapterProcessedImages",
    "download.log.chapterProcessedImageFailures",
    "download.log.chapterSkippedNonSite",
    "download.log.integrityStarted",
    "download.log.integrityPassed",
    "download.log.integrityFailed",
    "download.log.integrityRetry",
    "download.log.missingRetry",
    "download.log.missingPlaceholder",
    "download.log.missingRetryStarted",
    "download.log.missingRetrySaved",
    "download.log.lockLost",
    "download.log.discardRequested",
    "download.log.cacheWriteStarted",
    "download.log.cancelledOwnershipLost",
    "download.log.cancelledDiscarded",
    "download.log.cancelledSaved",
    "download.log.cancelledSaveTimeout",
    "download.log.cancelledSaveFailed",
    "download.log.cacheRestoreStarted",
    "download.log.started",
    "download.log.mainFlush",
    "download.log.integrityFlush",
    "download.log.exportPreparing",
    "download.log.completed",
    "download.log.storageFailed",
    "download.log.discardFailed",
    "download.storage.quotaExceeded",
    "download.storage.ownershipLost",
    "download.storage.transactionAborted",
    "download.storage.databaseUnavailable",
    "download.storage.migrationFailed",
    "download.storage.flushTimeout",
    "download.storage.unknown",
    "download.terminal.reason",
    "download.terminal.code",
    "download.terminal.operation",
    "download.terminal.progressNotSaved.title",
    "download.terminal.progressNotSaved.message",
    "download.terminal.failed.title",
    "download.terminal.failed.message",
    "download.terminal.ownershipLost.title",
    "download.terminal.ownershipLost.message",
    "download.terminal.saveTimeout.title",
    "download.terminal.saveTimeout.message",
    "download.terminal.saveFailed.title",
    "download.terminal.saveFailed.message",
    "download.terminal.discardFailed.title",
    "download.terminal.discardFailed.message",
    "protected.busy",
    "protected.busyShort",
    "protected.notice",
    "protected.required",
    "protected.position",
    "protected.openChapter",
    "protected.remember",
    "protected.passwordRequired",
    "protected.skipRemaining",
    "protected.retryConnection",
    "protected.submit",
    "protected.single.title",
    "protected.single.message",
    "protected.single.buttonTitle",
    "protected.single.notice",
    "protected.single.log",
    "protected.protocol.responseInvalid",
    "protected.protocol.passwordRejected",
    "protected.protocol.unknownStatus",
    "protected.protocol.contentInvalid",
    "protected.protocol.contentStillProtected",
    "protected.protocol.tokenInvalid",
    "protected.log.retrySkipped",
    "protected.log.redetected",
    "protected.log.queued",
    "protected.log.skipped",
    "protected.log.connectionRetry",
    "protected.log.connectionFailed",
    "protected.log.passwordRejected",
    "protected.log.protocolFailed",
    "protected.log.unlocked",
    "mapping.warning",
    "mapping.detected.title",
    "mapping.detected.message",
    "mapping.detected.summary",
    "mapping.detected.inflight",
    "mapping.detected.paused",
    "mapping.stop",
    "mapping.continue",
    "mapping.failure.title",
    "mapping.failure.message",
    "mapping.failure.remaining",
    "mapping.export.title",
    "mapping.export.message",
    "mapping.export.back",
    "mapping.export.continue",
    "mapping.single.txtTitle",
    "mapping.single.htmlTitle",
    "mapping.single.pending",
    "mapping.single.blocked",
    "mapping.single.txtDisabled",
    "mapping.single.warning",
    "mapping.single.failure",
    "mapping.single.failureFallback",
    "mapping.single.txtUnavailable",
    "mapping.single.htmlUnavailable",
    "export.none.title",
    "export.none.message",
    "export.title",
    "export.coverReady",
    "export.coverMissing",
    "export.images",
    "export.imagesFailed",
    "export.imagesNone",
    "export.bookReady",
    "export.chapterCount",
    "export.mappingWarning",
    "export.txtBlocked",
    "export.downloadTxt",
    "export.downloadEpub",
    "export.downloadHtml",
    "export.txtDisabled",
    "export.generating",
    "export.documentTitle",
    "export.failure.title",
    "export.failure.message",
    "export.failure.truncated",
    "cache.failure.title",
    "cache.failure.message",
    "cache.status.downloading",
    "cache.status.cancelled",
    "cache.status.exportReady",
    "cache.status.legacy",
    "cache.status.cached",
    "cache.confirm.title",
    "cache.action.clear",
    "cache.protection.title",
    "cache.title",
    "cache.action.refresh",
    "cache.action.clearPersistent",
    "cache.confirm.clearPersistent",
    "cache.action.clearAll",
    "cache.confirm.clearAll",
    "cache.protectedCount",
    "cache.empty",
    "cache.badge.runtime",
    "cache.badge.crossPage",
    "cache.badge.reexport",
    "cache.action.stopClear",
    "cache.confirm.stopClear",
    "cache.stop.notActive",
    "cache.stop.cleared",
    "cache.stop.cleanupFailed",
    "cache.stop.replaced",
    "cache.stop.stale",
    "cache.stop.timeout",
    "cache.action.clearIndexedDb",
    "cache.confirm.clearIndexedDb",
    "cache.protected",
    "cache.action.clearRuntime",
    "cache.confirm.clearRuntime",
    "cache.action.clearItemAll",
    "cache.confirm.clearItemAll",
    "cache.item.author",
    "cache.item.progress",
    "cache.item.source",
    "history.title",
    "history.confirm.title",
    "history.confirm.message",
    "history.action.clear",
    "history.source.detail",
    "history.source.forum",
    "history.source.single",
    "history.today",
    "history.yesterday",
    "history.image.legacy",
    "history.image.disabled",
    "history.image.none",
    "history.image.count",
    "history.image.progress",
    "history.filter.allType",
    "history.filter.book",
    "history.filter.single",
    "history.filter.allFormat",
    "history.filter.allSource",
    "history.column.book",
    "history.column.author",
    "history.column.type",
    "history.column.format",
    "history.column.source",
    "history.column.chapter",
    "history.column.image",
    "history.column.time",
    "history.column.action",
    "history.summary",
    "history.empty",
    "history.action.open",
    "history.action.delete",
    "history.type.book",
    "history.type.single",
    "history.action.clearAll",
    "diagnostics.title",
    "diagnostics.result.running",
    "diagnostics.result.success",
    "diagnostics.result.cancelled",
    "diagnostics.result.failed",
    "diagnostics.result.interrupted",
    "diagnostics.result.closed",
    "diagnostics.result.superseded",
    "diagnostics.result.exportFailed",
    "diagnostics.result.passwordPending",
    "diagnostics.reason.closed",
    "diagnostics.reason.superseded",
    "diagnostics.reason.interrupted",
    "diagnostics.action.download",
    "diagnostics.action.copy",
    "diagnostics.action.clearAll",
    "diagnostics.action.delete",
    "diagnostics.empty",
    "diagnostics.privacy",
    "diagnostics.file",
    "diagnostics.section.active",
    "diagnostics.section.unconfirmed",
    "diagnostics.section.recent",
    "diagnostics.retention",
    "diagnostics.confirm.title",
    "diagnostics.confirm.message",
    "page.bookIdMissing",
    "page.cacheReadFailed",
    "page.cacheUnavailable.title",
    "page.cacheUnavailable.message",
    "page.userCancelled",
    "page.cachePreparing",
    "page.cacheInvalidLegacyImage",
    "page.cacheInvalidImageMismatch",
    "page.startFailed.title",
    "page.structureChanged",
    "page.lockLost",
    "page.notStarted",
    "page.progressNotSaved",
    "page.flowFailed",
    "page.startFailed.message",
    "page.forumAnalyzing",
    "page.detailFetching",
    "page.detailFailed.title",
    "page.detailFailed.message",
    "page.metadataReady",
    "page.chaptersFound",
    "page.chaptersMissing.title",
    "page.chaptersMissing.message",
    "single.mappingFailure.message",
    "single.txtUnavailable.message",
    "single.bodyMissing.title",
    "single.bodyMissing.message",
    "single.downloadFailed.title",
    "single.downloadFailed.message",
    "diagnostics.summary.closed",
    "diagnostics.summary.superseded",
    "diagnostics.summary.interrupted",
    "diagnostics.summary.chapterFailure",
    "diagnostics.summary.imageFailure",
    "diagnostics.summary.singlePrefix",
    "diagnostics.summary.exportCancelled",
    "diagnostics.summary.exportSuccess",
    "diagnostics.summary.generateFailed",
    "diagnostics.summary.downloadFailed",
    "diagnostics.summary.presentation",
    "diagnostics.summary.book",
    "diagnostics.summary.link",
    "diagnostics.summary.result",
    "diagnostics.summary.chapters",
    "diagnostics.summary.protected",
    "diagnostics.summary.images",
    "diagnostics.summary.enabled",
    "diagnostics.summary.disabled",
    "diagnostics.summary.exports",
    "diagnostics.summary.failures",
    "diagnostics.summary.none",
    "image.processingFailure",
    "image.processingLog",
    "cover.start",
    "cover.tooSmall",
    "cover.invalidFormat",
    "cover.completed",
    "cover.skipped",
    "download.action.cancelTask",
    "download.action.skipChapter",
    "download.action.cancelKeepCache",
    "download.action.exportPlaceholder",
    "download.action.retryMissing",
    "download.missing.remaining",
    "download.missing.title",
    "download.missing.message",
    "download.conflict.detail",
    "download.conflict.forum",
    "download.conflict.title",
    "download.conflict.message",
    "download.conflict.acknowledge",
    "download.popup.saving",
    "download.popup.stoppingLog",
    "download.popup.running",
    "download.popup.title",
    "download.popup.progress",
    "download.export.txtDisabled",
    "cache.compatible",
    "cache.legacyImageUnknown",
    "cache.imageMismatch",
    "tray.restore",
    "download.log.integrityReasonMissing",
    "download.log.integrityReasonInvalidImage",
    "download.log.integrityReasonImageFailures",
    "download.log.mappingCacheInvalid",
    "download.log.mappingFailed",
    "single.log.started",
    "single.log.metadata",
    "single.log.images",
    "single.log.imagesEmbedded",
    "single.log.imagesFailed",
    "single.log.completed",
    "settings.log.image",
    "settings.log.epubTag",
    "settings.log.initialized"
] as const;

export type LocaleKey = (typeof LOCALE_KEYS)[number];

/**
 * 简体中文文案
 */
export const LOCALE_CATALOGS: LocaleCatalogs = Object.freeze({
    "zh-CN": ZH_CN_MESSAGES,
    "zh-TW": ZH_TW_MESSAGES
});

const LOCALE_PARAMETER_PATTERN = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export class MissingLocaleMessageError extends Error {
    readonly locale: InterfaceLocale;
    readonly key: string;

    constructor(locale: InterfaceLocale, key: string) {
        super(`Missing locale message: ${locale}.${key}`);
        this.name = "MissingLocaleMessageError";
        this.locale = locale;
        this.key = key;
    }
}

export class MissingLocaleParameterError extends Error {
    readonly key: string;
    readonly parameter: string;

    constructor(key: string, parameter: string) {
        super(`Missing locale message parameter: ${key}.{${parameter}}`);
        this.name = "MissingLocaleParameterError";
        this.key = key;
        this.parameter = parameter;
    }
}

export class IncompleteLocaleCatalogError extends Error {
    readonly missing: Readonly<Record<InterfaceLocale, readonly string[]>>;

    constructor(missing: Readonly<Record<InterfaceLocale, readonly string[]>>) {
        const details = (Object.entries(missing) as Array<[InterfaceLocale, readonly string[]]>)
            .filter(([, keys]) => keys.length > 0)
            .map(([locale, keys]) => `${locale}: ${keys.join(", ")}`)
            .join("; ");
        super(`Incomplete locale catalog: ${details}`);
        this.name = "IncompleteLocaleCatalogError";
        this.missing = missing;
    }
}

/**
 * 检查字典缺失的稳定键
 */
export function findMissingLocaleKeys(
    catalogs: LocaleCatalogs,
    expectedKeys: readonly string[] = LOCALE_KEYS
): Readonly<Record<InterfaceLocale, readonly string[]>> {
    return {
        "zh-CN": expectedKeys.filter((key) => !(key in catalogs["zh-CN"])),
        "zh-TW": expectedKeys.filter((key) => !(key in catalogs["zh-TW"]))
    };
}

/**
 * 断言字典包含完整稳定键
 */
export function assertLocaleCatalogsComplete(
    catalogs: LocaleCatalogs = LOCALE_CATALOGS,
    expectedKeys: readonly string[] = LOCALE_KEYS
): void {
    const missing = findMissingLocaleKeys(catalogs, expectedKeys);
    if (missing["zh-CN"].length > 0 || missing["zh-TW"].length > 0) {
        throw new IncompleteLocaleCatalogError(missing);
    }
}

/**
 * 替换文案参数
 */
export function interpolateLocaleMessage(key: string, template: string, params: LocaleMessageParams = {}): string {
    return template.replace(LOCALE_PARAMETER_PATTERN, (_placeholder, parameter: string) => {
        if (!Object.prototype.hasOwnProperty.call(params, parameter)) {
            throw new MissingLocaleParameterError(key, parameter);
        }
        return String(params[parameter]);
    });
}

/**
 * 生成指定语言的文案
 */
export function translate(locale: InterfaceLocale, key: LocaleKey, params?: LocaleMessageParams): string {
    const message = LOCALE_CATALOGS[locale][key];
    if (message === undefined) {
        throw new MissingLocaleMessageError(locale, key);
    }
    return interpolateLocaleMessage(key, message, params);
}
