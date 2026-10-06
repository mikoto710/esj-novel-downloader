import type {
    DownloadDependencies,
    DownloadTask,
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterPromptMessageCode
} from "./contracts";
import type { DomainMessageParams } from "../messages";
import type { DownloadProgress } from "./download-progress";
import type { DownloadPlan } from "../../download/plan";
import { ProtectedChapterQueue, type ProtectedChapterWorkItem } from "./protected-chapter-queue";
import { runUserDecision, UserDecisionGate } from "./user-decision-gate";
import { isCancellationError } from "./errors";

export type ChapterTaskResult = "completed" | "failed" | "cancelled" | "deferred";
type ProcessUnlockedChapter = (task: DownloadTask, html: string, retry: boolean) => Promise<ChapterTaskResult>;
type ProtectedPorts = Pick<DownloadDependencies, "cancellation" | "protectedChapterAuth" | "events" | "log"> & {
    ui: Pick<DownloadDependencies["ui"], "promptProtectedChapterPassword" | "closeProtectedChapterPrompt">;
};

/**
 * 密码仅在当前任务内存中保存；密码决策与正文抓取共用串行弹窗入口
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
    let rememberedPassword: string | null = null;
    let rememberPassword = false;
    let skipRemainingProtectedRetries = false;
    function registerProtectedDetection(task: DownloadTask, skipped: boolean): void {
        const snapshot = progress.snapshot;
        const firstDetection = !protectedDetectedIndexes.has(task.index);
        protectedDetectedIndexes.add(task.index);
        if (skipped) {
            protectedSkippedIndexes.add(task.index);
        }
        progress.update({
            protectedDetectedCount: snapshot.protectedDetectedCount + (firstDetection ? 1 : 0),
            protectedPendingCount: snapshot.protectedPendingCount + (skipped ? 0 : 1),
            protectedSkippedCount: snapshot.protectedSkippedCount + (skipped ? 1 : 0)
        });
    }

    function reopenProtectedChapterForRetry(task: DownloadTask): void {
        const snapshot = progress.snapshot;
        const firstDetection = !protectedDetectedIndexes.has(task.index);
        const wasResolved = protectedResolvedIndexes.delete(task.index);
        const wasSkipped = protectedSkippedIndexes.delete(task.index);
        protectedDetectedIndexes.add(task.index);
        progress.update({
            protectedDetectedCount: snapshot.protectedDetectedCount + (firstDetection ? 1 : 0),
            protectedPendingCount: snapshot.protectedPendingCount + 1,
            protectedResolvedCount: Math.max(0, snapshot.protectedResolvedCount - (wasResolved ? 1 : 0)),
            protectedSkippedCount: Math.max(0, snapshot.protectedSkippedCount - (wasSkipped ? 1 : 0))
        });
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
            ...(plan.selection.mode === "range"
                ? {
                      taskOrder: plan.position(item.task).index,
                      sourceTotalChapters: plan.selection.sourceTotalChapters,
                      selectionMode: plan.selection.mode
                  }
                : {}),
            pendingCount: progress.snapshot.protectedPendingCount,
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
            () =>
                ports.ui.promptProtectedChapterPassword(prompt, ports.cancellation.signal, (decision) => {
                    if (decision.action === "cancel") {
                        ports.cancellation.requestCancellation("flush");
                    }
                }),
            { action: "cancel" }
        );
    }

    /**
     * 依次处理密码提交、跳过和取消，只重试连接故障
     */
    async function resolveProtectedChapter(
        item: ProtectedChapterWorkItem,
        processChapter: ProcessUnlockedChapter,
        isRetry = false
    ): Promise<ChapterTaskResult> {
        let message: string | undefined;
        let messageCode: ProtectedChapterPromptMessageCode | undefined;
        let messageParams: DomainMessageParams | undefined;
        let useRememberedPassword = Boolean(rememberedPassword);
        let retryConnection = false;

        while (!ports.cancellation.isCancellationRequested()) {
            // 记住的密码只自动尝试一次，失败后交回用户处理
            const decision: ProtectedChapterDecision =
                useRememberedPassword && rememberedPassword
                    ? { action: "submit", password: rememberedPassword, rememberPassword: true }
                    : await promptForProtectedChapter(item, message, messageCode, messageParams, retryConnection);
            useRememberedPassword = false;

            if (decision.action === "cancel") {
                ports.cancellation.requestCancellation("flush");
                return "cancelled";
            }
            if (decision.action === "skip-current" || decision.action === "skip-all") {
                ports.ui.closeProtectedChapterPrompt();
                if (isRetry && decision.action === "skip-all") {
                    skipRemainingProtectedRetries = true;
                }
                // 首轮清空等待队列；补抓轮只跳过该轮后续密码章节
                const skippedItems =
                    decision.action === "skip-all" && !isRetry ? protectedQueue.skipAllRemaining() : [];
                for (const skipped of [item, ...skippedItems]) {
                    protectedSkippedIndexes.add(skipped.task.index);
                    ports.log({
                        code: "protected-chapter-skipped",
                        params: { ...plan.position(skipped.task), title: skipped.task.title }
                    });
                }
                progress.update({
                    protectedPendingCount: Math.max(
                        0,
                        progress.snapshot.protectedPendingCount - skippedItems.length - 1
                    ),
                    protectedSkippedCount: progress.snapshot.protectedSkippedCount + skippedItems.length + 1
                });
                return "failed";
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
                        ports.cancellation.signal
                    );
                    break;
                } catch (error) {
                    if (ports.cancellation.isCancellationRequested() || isCancellationError(error)) {
                        return "cancelled";
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
            ports.ui.closeProtectedChapterPrompt();
            protectedResolvedIndexes.add(item.task.index);
            progress.update({
                protectedPendingCount: Math.max(0, progress.snapshot.protectedPendingCount - 1),
                protectedResolvedCount: progress.snapshot.protectedResolvedCount + 1
            });
            const processed = await processChapter(item.task, result.html, isRetry);
            if (processed === "completed") {
                ports.log({
                    code: "protected-chapter-unlocked",
                    params: { ...plan.position(item.task), title: item.task.title }
                });
            }
            return processed;
        }
        return "cancelled";
    }

    /**
     * 串行处理新发现的密码章节，直到生产端关闭
     */
    async function consumeProtectedChapters(processChapter: ProcessUnlockedChapter): Promise<void> {
        while (!ports.cancellation.isCancellationRequested()) {
            const item = await protectedQueue.take(ports.cancellation.signal);
            if (!item) {
                return;
            }
            await resolveProtectedChapter(item, processChapter);
        }
    }
    return {
        beginRetryRound: beginProtectedRetryRound,
        consume: consumeProtectedChapters,
        closeProducer: () => protectedQueue.closeProducer(),
        async handle(
            task: DownloadTask,
            html: string,
            isRetry: boolean,
            processChapter: ProcessUnlockedChapter
        ): Promise<ChapterTaskResult> {
            if (isRetry) {
                if (skipRemainingProtectedRetries) {
                    if (!protectedDetectedIndexes.has(task.index)) {
                        registerProtectedDetection(task, true);
                    }
                    ports.log({
                        code: "protected-chapter-retry-skipped",
                        params: { ...plan.position(task), title: task.title }
                    });
                    return "failed";
                }
                reopenProtectedChapterForRetry(task);
                ports.log({
                    code: "protected-chapter-redetected",
                    params: { ...plan.position(task), title: task.title }
                });
                return resolveProtectedChapter({ task, pageHtml: html }, processChapter, true);
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
            return "deferred";
        },
        dispose() {
            protectedQueue.cancel();
            rememberedPassword = null;
            ports.ui.closeProtectedChapterPrompt();
        }
    };
}
