const UI_LOG_BATCH_DELAY_MS = 50;
const UI_LOG_EVENT_LIMIT = 1000;
let pendingUiLogLines: string[] = [];
let uiLogFlushTimer: ReturnType<typeof setTimeout> | null = null;
interface UiLogState {
    nodes: Text[];
    omittedCount: number;
    truncationMarker: HTMLElement | null;
}
const uiLogStates = new WeakMap<Element, UiLogState>();
type UiLogTruncationFormatter = (count: number) => string;
let uiLogTruncationFormatter: UiLogTruncationFormatter | null = null;

/**
 * 设置 UI 日志截断标记的展示格式，调用后需用 refreshUiLogTruncationText 更新已挂载标记
 */
export function setUiLogTruncationFormatter(formatter: UiLogTruncationFormatter): void {
    uiLogTruncationFormatter = formatter;
}

function formatUiLogTruncation(count: number): string {
    return uiLogTruncationFormatter?.(count) ?? `… ${count}\n`;
}

/**
 * 使用当前格式化器原地刷新指定根节点内已有的日志截断标记
 */
export function refreshUiLogTruncationText(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>("[data-esj-log-truncation-count]").forEach((marker) => {
        const count = Number(marker.dataset.esjLogTruncationCount || 0);
        marker.textContent = formatUiLogTruncation(count);
    });
}

function getUiLogState(box: Element): UiLogState {
    const existing = uiLogStates.get(box);
    if (existing && existing.nodes.every((node) => node.parentNode === box)) {
        return existing;
    }
    const state: UiLogState = { nodes: [], omittedCount: 0, truncationMarker: null };
    uiLogStates.set(box, state);
    return state;
}

function trimUiLogs(box: Element, state: UiLogState): void {
    const overflow = state.nodes.length - UI_LOG_EVENT_LIMIT;
    if (overflow <= 0) {
        return;
    }

    for (const node of state.nodes.splice(0, overflow)) {
        node.remove();
    }
    state.omittedCount += overflow;
    if (!state.truncationMarker) {
        state.truncationMarker = document.createElement("span");
        state.truncationMarker.dataset.esjLogTruncation = "true";
        box.prepend(state.truncationMarker);
    }
    state.truncationMarker.dataset.esjLogTruncationCount = String(state.omittedCount);
    state.truncationMarker.textContent = formatUiLogTruncation(state.omittedCount);
}

// 批量追加日志避免重复复制历史内容
function flushPendingUiLogs(): void {
    uiLogFlushTimer = null;
    const lines = pendingUiLogLines;
    pendingUiLogLines = [];
    if (lines.length === 0) {
        return;
    }

    // 日志也会被无 DOM 的基础设施适配器复用，此时只保留控制台与诊断记录，不刷新 UI
    if (typeof document === "undefined") {
        return;
    }
    const box = document.querySelector("#esj-log");
    if (!box) {
        return;
    }
    const isAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
    const state = getUiLogState(box);
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
        const node = document.createTextNode(line);
        state.nodes.push(node);
        fragment.append(node);
    }
    box.append(fragment);
    trimUiLogs(box, state);
    if (isAtBottom) {
        box.scrollTop = box.scrollHeight;
    }
}

function scheduleUiLogFlush(): void {
    if (uiLogFlushTimer !== null) {
        return;
    }

    // 每批首条日志立即写入，后续日志在 50 ms 窗口内合并
    if (typeof document !== "undefined" && document.querySelector("#esj-log")) {
        flushPendingUiLogs();
    }
    uiLogFlushTimer = setTimeout(flushPendingUiLogs, UI_LOG_BATCH_DELAY_MS);
}

/**
 * 输出日志到 UI 面板和控制台
 * @param msg 日志内容
 */
export function log(msg: string): void {
    const prefix = new Date().toLocaleTimeString();
    const line = `[${prefix}] ${msg}`;
    console.log(line);

    pendingUiLogLines.push(line + "\n");
    scheduleUiLogFlush();
}
