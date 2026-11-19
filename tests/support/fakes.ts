import { createDeferred } from "./async";
import type {
    DownloadSelectionDecision,
    DownloadSelectionPopup,
    DownloadSelectionPopupOptions
} from "../../src/ui/dialogs/download-selection";

/**
 * 模拟选择窗口，准备完成后接受预设决策，关闭后忽略晚到结果
 */
export function createSelectionPopupFake(
    options: DownloadSelectionPopupOptions,
    choose: (options: DownloadSelectionPopupOptions) => Promise<DownloadSelectionDecision>
): DownloadSelectionPopup {
    const decision = createDeferred<DownloadSelectionDecision>();
    const showReady: DownloadSelectionPopup["showReady"] = (preview) => {
        if (!decision.settled) {
            void choose({ ...options, ...preview }).then((value) => {
                if (!decision.settled) {
                    decision.resolve(value);
                }
            });
        }
    };
    if (!options.preparationStage) {
        showReady(options);
    }
    return {
        decision: decision.promise,
        get closed() {
            return decision.settled;
        },
        showPreparing: () => undefined,
        showReady,
        close: () => decision.resolve({ action: "cancel" })
    };
}

/**
 * 记录下载核心发布的事件
 */
export class RecordingDownloadEvents<TEvent = unknown> {
    readonly events: TEvent[] = [];

    emit(event: TEvent): void {
        this.events.push(event);
    }

    ofType<TType extends string>(type: TType): TEvent[] {
        return this.events.filter(
            (event) => typeof event === "object" && event !== null && "type" in event && event.type === type
        );
    }
}
