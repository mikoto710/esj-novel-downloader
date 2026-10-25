import type {
    DownloadDependencies,
    DownloadTask,
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterPromptMessageCode
} from "./contracts";
import type { DomainMessageParams } from "../messages";
import type { DownloadProgress } from "./progress";
import type { DownloadPlan } from "./plan";
import { ProtectedChapterQueue, type ProtectedChapterWorkItem } from "./protected-chapter-queue";
import { runUserDecision, UserDecisionGate } from "./user-decision-gate";
import { isCancellationError } from "./errors";

export type ChapterTaskResult = "completed" | "failed" | "cancelled" | "deferred";

export type ProtectedChapterResolution =
    | { kind: "unlocked"; html: string }
    | { kind: "skipped" }
    | { kind: "cancelled" };

type ProtectedPorts = Pick<DownloadDependencies, "cancellation" | "protectedChapterAuth" | "events" | "log"> & {
    workSignal: AbortSignal;
    ui: Pick<DownloadDependencies["ui"], "promptProtectedChapterPassword">;
};

/**
 * 密码仅保存在当前任务内存；密码、映射字体和缺章决策共用串行弹窗入口
 */
export function createProtectedChapters(
    ports: ProtectedPorts,
    plan: DownloadPlan,
    progress: DownloadProgress,
    decisions: UserDecisionGate
) {
    const protectedQueue = new ProtectedChapterQueue();
    const protectedDetectedIndexes = new Set<number>();
    const protectedResolvedIndexes = new Set<number>();
    const protectedSkippedIndexes = new Set<number>();
    let protectedPendingCount = 0;

    function publishProtectedSummary(): void {
        progress.recordProtectedSummary({
            protectedDetectedCount: protectedDetectedIndexes.size,
            protectedPendingCount,
            protectedResolvedCount: protectedResolvedIndexes.size,
            protectedSkippedCount: protectedSkippedIndexes.size
        });
    }

    let rememberedPassword: string | null = null;
    let rememberPassword = false;
    let skipRemainingProtectedRetries = false;

    function registerProtectedDetection(task: DownloadTask, skipped: boolean): void {
        protectedDetectedIndexes.add(task.index);
        if (skipped) {
            protectedSkippedIndexes.add(task.index);
        } else {
            protectedPendingCount++;
        }
        publishProtectedSummary();
    }

    function reopenProtectedChapterForRetry(task: DownloadTask): void {
        protectedResolvedIndexes.delete(task.index);
        protectedSkippedIndexes.delete(task.index);
        protectedDetectedIndexes.add(task.index);
        protectedPendingCount++;
        publishProtectedSummary();
    }

    function beginProtectedRetryRound(): void {
        // 新的补抓轮次重新允许处理密码章节
        skipRemainingProtectedRetries = false;
    }

    async function promptForProtectedChapter(
        item: ProtectedChapterWorkItem,
        message?: string,
        messageCode?: ProtectedChapterPromptMessageCode,
        messageParams?: DomainMessageParams,
        retryConnection = false
    ): Promise<ProtectedChapterDecision> {
        const prompt: ProtectedChapterPrompt = {
            task: item.task,
            totalChapters: plan.tasks.length,
            ...(plan.selection.mode === "selected"
                ? {
                      taskOrder: plan.position(item.task).index,
                      sourceTotalChapters: plan.selection.sourceTotalChapters,
                      selectionMode: plan.selection.mode
                  }
                : {}),
            pendingCount: protectedPendingCount,
            rememberPassword: rememberPassword,
            retryConnection,
            ...(rememberedPassword ? { initialPassword: rememberedPassword } : {}),
            ...(message ? { message } : {}),
            ...(messageCode ? { messageCode } : {}),
            ...(messageParams ? { messageParams } : {})
        };
        return runUserDecision(
            decisions,
            ports.cancellation,
            () => ports.ui.promptProtectedChapterPassword(prompt, ports.workSignal),
            { action: "cancel" },
            ports.workSignal
        );
    }

    // 依次处理密码提交、跳过和取消，只重试连接故障
    async function resolveProtectedChapter(
        item: ProtectedChapterWorkItem,
        isRetry = false
    ): Promise<ProtectedChapterResolution> {
        let message: string | undefined;
        let messageCode: ProtectedChapterPromptMessageCode | undefined;
        let messageParams: DomainMessageParams | undefined;
        let useRememberedPassword = Boolean(rememberedPassword);
        let retryConnection = false;

        while (!ports.workSignal.aborted) {
            // 记住的密码只自动尝试一次，失败后交回用户处理
            const decision: ProtectedChapterDecision =
                useRememberedPassword && rememberedPassword
                    ? { action: "submit", password: rememberedPassword, rememberPassword: true }
                    : await promptForProtectedChapter(item, message, messageCode, messageParams, retryConnection);
            useRememberedPassword = false;

            if (decision.action === "cancel") {
                if (!ports.workSignal.aborted) {
                    ports.cancellation.requestCancellation("flush");
                }
                return { kind: "cancelled" };
            }
            if (decision.action === "skip-current" || decision.action === "skip-all") {
                if (isRetry && decision.action === "skip-all") {
                    skipRemainingProtectedRetries = true;
                }

                // 选择跳过全部时，首轮清空密码队列；补抓轮只跳过该轮后续密码章节
                const skippedItems =
                    decision.action === "skip-all" && !isRetry ? protectedQueue.skipAllRemaining() : [];
                for (const skipped of [item, ...skippedItems]) {
                    protectedSkippedIndexes.add(skipped.task.index);
                    ports.log({
                        code: "protected-chapter-skipped",
                        params: { ...plan.position(skipped.task), title: skipped.task.title }
                    });
                }
                protectedPendingCount = Math.max(0, protectedPendingCount - skippedItems.length - 1);
                publishProtectedSummary();
                return { kind: "skipped" };
            }

            rememberPassword = decision.rememberPassword;
            rememberedPassword = decision.rememberPassword ? decision.password : null;

            // 连接故障重试一次；密码拒绝不会进入自动重试
            let result;
            let technicalFailure = false;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    result = await ports.protectedChapterAuth.unlock(
                        item.task,
                        item.pageHtml,
                        decision.password,
                        ports.workSignal
                    );
                    break;
                } catch (error) {
                    if (ports.workSignal.aborted || isCancellationError(error)) {
                        return { kind: "cancelled" };
                    }
                    if (attempt === 0) {
                        ports.log({
                            code: "protected-chapter-connection-retry",
                            params: { ...plan.position(item.task), title: item.task.title }
                        });
                        continue;
                    }
                    technicalFailure = true;
                }
            }
            if (ports.workSignal.aborted) {
                return { kind: "cancelled" };
            }
            if (technicalFailure || !result) {
                ports.events.emit({
                    type: "chapter-failed",
                    task: item.task,
                    stage: "protected-auth",
                    code: "network-error",
                    params: plan.position(item.task),
                    retry: false
                });
                ports.log({
                    code: "protected-chapter-connection-failed",
                    params: { ...plan.position(item.task), title: item.task.title }
                });
                message = undefined;
                messageCode = "connection-failed";
                messageParams = undefined;
                retryConnection = true;
                continue;
            }

            if (result.kind === "password-rejected") {
                rememberedPassword = null;
                rememberPassword = false;
                message = result.message;
                messageCode = result.message ? undefined : "password-rejected";
                messageParams = undefined;
                retryConnection = false;
                ports.events.emit({ type: "protected-chapter-password-rejected", task: item.task });
                ports.log({
                    code: "protected-chapter-password-rejected",
                    params: { ...plan.position(item.task), title: item.task.title }
                });
                continue;
            }
            if (result.kind === "protocol-error") {
                ports.events.emit({
                    type: "chapter-failed",
                    task: item.task,
                    stage: "protected-auth",
                    code: result.code,
                    params: {
                        ...plan.position(item.task),
                        ...(result.params || {})
                    },
                    retry: false
                });
                ports.log({
                    code: "protected-chapter-protocol-failed",
                    params: {
                        ...plan.position(item.task),
                        title: item.task.title,
                        errorCode: result.code,
                        ...(result.params || {})
                    }
                });
                message = undefined;
                messageCode = result.code;
                messageParams = result.params;
                retryConnection = true;
                continue;
            }

            // 授权成功后回到普通正文处理路径，复用解析与落盘
            protectedResolvedIndexes.add(item.task.index);
            protectedPendingCount = Math.max(0, protectedPendingCount - 1);
            publishProtectedSummary();
            return { kind: "unlocked", html: result.html };
        }
        return { kind: "cancelled" };
    }

    return {
        beginRetryRound: beginProtectedRetryRound,
        take: () => protectedQueue.take(ports.workSignal),
        resolveProtectedChapter,
        closeProducer: () => protectedQueue.closeProducer(),
        async handle(
            task: DownloadTask,
            html: string,
            isRetry: boolean
        ): Promise<ProtectedChapterResolution | { kind: "deferred" }> {
            if (isRetry) {
                if (skipRemainingProtectedRetries) {
                    if (!protectedDetectedIndexes.has(task.index)) {
                        registerProtectedDetection(task, true);
                    }
                    ports.log({
                        code: "protected-chapter-retry-skipped",
                        params: { ...plan.position(task), title: task.title }
                    });
                    return { kind: "skipped" };
                }
                reopenProtectedChapterForRetry(task);
                ports.log({
                    code: "protected-chapter-redetected",
                    params: { ...plan.position(task), title: task.title }
                });
                return resolveProtectedChapter({ task, pageHtml: html }, true);
            }
            const queued = protectedQueue.enqueue({ task, pageHtml: html });
            if (queued.kind !== "duplicate") {
                registerProtectedDetection(task, queued.kind === "skipped");
            }
            if (queued.kind === "queued") {
                ports.log({
                    code: "protected-chapter-queued",
                    params: { ...plan.position(task), title: task.title }
                });
            } else if (queued.kind === "skipped") {
                ports.log({
                    code: "protected-chapter-skipped",
                    params: { ...plan.position(task), title: task.title }
                });
            }
            return { kind: "deferred" };
        },
        dispose() {
            protectedQueue.cancel();
            rememberedPassword = null;
        }
    };
}
