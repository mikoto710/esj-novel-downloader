import type { Chapter } from "../../types";
import type { DownloadEventSink, DownloadPhase, DownloadSnapshot, DownloadUiPort } from "./contracts";
import type { DownloadScope } from "./download-scope";
import { DownloadStateMachine } from "./state-machine";

/**
 * 唯一的进度写入口；范围计数从整书章节表中取本次任务的交集
 */
export class DownloadProgress {
    private readonly machine: DownloadStateMachine;
    constructor(
        private readonly scope: DownloadScope,
        private readonly chapters: Map<number, Chapter>,
        events: DownloadEventSink,
        private readonly ui: Pick<DownloadUiPort, "update">
    ) {
        this.machine = new DownloadStateMachine(scope.options.tasks.length, scope.readyCount(chapters), events);
    }
    get snapshot(): DownloadSnapshot {
        return this.machine.snapshot;
    }
    transition(phase: DownloadPhase): void {
        this.ui.update(this.machine.transition(phase));
    }
    update(values: Partial<Omit<DownloadSnapshot, "phase" | "readyChapterCount" | "cachedChapterCount">>): void {
        const readyChapterCount = this.scope.readyCount(this.chapters);
        this.ui.update(this.machine.update({ ...values, readyChapterCount, cachedChapterCount: readyChapterCount }));
    }
}
