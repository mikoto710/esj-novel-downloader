/**
 * 导出弹窗固定操作区，过长的选择摘要与资源提示在信息区内滚动
 */
export const FORMAT_CHOICE_STYLES = `
#esj-format {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 420px;
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
    box-sizing: border-box;
    background: #fff;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 0 18px #0005;
    z-index: 999999;
    padding: 0;
    display: flex;
    flex-direction: column;
}

#esj-format .esj-common-header,
#esj-format .esj-format-actions,
#esj-format #esj-format-txt-disabled-reason {
    flex-shrink: 0;
}

#esj-format .esj-format-info {
    padding: 20px;
    font-size: 14px;
    line-height: 1.5;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
}

#esj-format .esj-format-actions {
    display: flex;
    gap: 15px;
    justify-content: center;
    padding: 0 20px 15px;
}

#esj-format #esj-format-txt-disabled-reason {
    padding: 0 20px 16px;
    color: #a45b00;
    font-size: 12px;
    line-height: 1.5;
}
`;
