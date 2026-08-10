interface PageActionLockState {
    initialDisabled: boolean;
    owners: Set<symbol>;
}

const lockStates = new WeakMap<HTMLButtonElement, PageActionLockState>();

/**
 * 锁定指定页面操作按钮，并在当前持有者释放后恢复加锁前状态
 */
export function acquirePageActionLock(elements: ArrayLike<Element>): () => void {
    const owner = Symbol("page-action-lock");
    const buttons = Array.from(new Set(Array.from(elements))).filter(
        (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
    );

    for (const button of buttons) {
        let state = lockStates.get(button);
        if (!state) {
            state = {
                initialDisabled: button.disabled,
                owners: new Set()
            };
            lockStates.set(button, state);
        }
        state.owners.add(owner);
        button.disabled = true;
    }

    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;

        for (const button of buttons) {
            const state = lockStates.get(button);
            if (!state) {
                continue;
            }
            state.owners.delete(owner);
            if (state.owners.size > 0) {
                button.disabled = true;
                continue;
            }
            button.disabled = state.initialDisabled;
            lockStates.delete(button);
        }
    };
}

/**
 * 锁定当前页面由脚本注入的下载和设置入口
 */
export function acquirePageActionGroupLock(): () => void {
    return acquirePageActionLock(document.querySelectorAll(".esj-download-trigger,.esj-settings-trigger"));
}
