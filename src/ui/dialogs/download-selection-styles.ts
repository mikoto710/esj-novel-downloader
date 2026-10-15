/**
 * 章节选择弹窗的局部样式，保持作用域限定在弹窗内
 */
export const DOWNLOAD_SELECTION_STYLES = `
/* 弹窗容器与通用控件 */
#esj-range-selection {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
    font: 14px/1.5 sans-serif;
    color: #333;
    text-align: left;
    box-sizing: border-box;
    background: #fff;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 0 18px #0005;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    overflow-anchor: none;
}

#esj-range-selection[data-esj-selecting="true"] {
    width: 500px;
}

#esj-range-selection [hidden] {
    display: none !important;
}

#esj-range-selection button,
#esj-range-selection input {
    font: inherit;
    line-height: 1.5;
    box-sizing: border-box;
    margin: 0;
    min-height: 0;
}

#esj-range-selection button {
    width: auto;
    text-transform: none;
    padding: 6px 9px;
    border: 1px solid #c5cdd3;
    border-radius: 5px;
    background: #f4f7f9;
    color: #333;
    cursor: pointer;
}

#esj-range-selection button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

#esj-range-selection label {
    margin: 0;
    font: inherit;
    color: inherit;
}

#esj-range-selection .esj-common-header {
    font-size: 16px;
    flex-shrink: 0;
}

/* 书名、状态与下载模式 */
#esj-range-selection .esj-selection-body {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    max-height: 50dvh;
    overflow: auto;
    flex: 0 0 auto;
}

#esj-range-selection .esj-selection-book {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px 12px;
}

#esj-range-selection .esj-selection-book-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1 1 180px;
    min-width: 0;
}

#esj-range-selection .esj-selection-book-title {
    font-weight: 600;
    overflow-wrap: anywhere;
}

#esj-range-selection #esj-range-open-previous {
    flex-shrink: 0;
    margin-left: auto;
    padding: 8px 12px;
}

#esj-range-selection .esj-selection-filename {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 16px 12px;
    flex-shrink: 0;
}

#esj-download-filename {
    width: 100%;
    min-width: 0;
    padding: 8px;
    border: 1px solid #b8c4ce;
    border-radius: 5px;
    background: #fff;
    color: #333;
}

#esj-range-selection .esj-selection-summary {
    display: flex;
    gap: 6px 16px;
    flex-wrap: wrap;
    font-size: 13px;
    color: #555;
}

#esj-range-selection .esj-selection-summary strong {
    font-weight: 600;
}

#esj-range-cache-reuse strong {
    color: #287eaf;
}

#esj-range-selection .esj-selection-modes {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 6px;
    background: #f1f4f7;
    flex-shrink: 0;
}

#esj-range-selection .esj-selection-modes label {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1;
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
}

/* 保留原生单选键盘行为，仅隐藏分段选项中重复的圆点 */
#esj-range-selection .esj-selection-modes input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

#esj-range-selection .esj-selection-modes label:has(input:checked) {
    background: #fff;
    color: #1976aa;
    font-weight: 600;
    box-shadow: 0 1px 4px #0001;
}

#esj-range-selection .esj-selection-modes label:has(input:focus-visible) {
    outline: 2px solid #1976aa;
    outline-offset: 2px;
}

#esj-range-selection input[type="checkbox"],
#esj-range-selection input[type="radio"] {
    appearance: auto;
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    padding: 0;
    accent-color: #1976aa;
}

/* 搜索输入与结果下拉 */
#esj-range-selection .esj-selection-fields {
    padding: 0 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    flex: 0 1 auto;
}

#esj-range-selection .esj-selection-search {
    position: relative;
    flex-shrink: 0;
    z-index: 2;
}

#esj-range-selection .esj-search-entry {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid #b8c4ce;
    border-radius: 5px;
    padding: 0 8px;
    background: #fff;
}

#esj-range-selection .esj-search-entry:focus-within {
    border-color: #1976aa;
    box-shadow: 0 0 0 2px #1976aa33;
}

#esj-range-search {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 8px 6px;
    border: 0;
    background: transparent;
    color: #333;
    appearance: none;
    outline: none;
    box-shadow: none;
}

#esj-range-search::-webkit-search-cancel-button,
#esj-range-search::-webkit-search-decoration {
    display: none;
}

#esj-range-selection .esj-search-clear {
    border: 0;
    background: transparent;
    padding: 2px 5px;
    color: #666;
    font-size: 18px;
}

#esj-range-selection .esj-search-results {
    position: absolute;
    box-sizing: border-box;
    left: 0;
    right: 0;
    top: calc(100% + 5px);
    background: #fff;
    border: 1px solid #bcc8d1;
    border-radius: 6px;
    box-shadow: 0 7px 22px #0003;
    overflow: hidden;
}

#esj-range-selection .esj-search-results[data-above] {
    top: auto;
    bottom: calc(100% + 5px);
}

#esj-range-selection .esj-search-result-header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    background: #f1f4f7;
    padding: 7px 10px;
    font-size: 12px;
    color: #596571;
}

#esj-chapter-matches {
    max-height: 230px;
    overflow: auto;
    overscroll-behavior: contain;
    list-style: none;
    margin: 0;
    padding: 0;
}

#esj-chapter-matches li {
    cursor: pointer;
    padding: 9px 10px;
    border-bottom: 1px solid #e0e6eb;
    overflow-wrap: anywhere;
}

#esj-chapter-matches li:last-child {
    border-bottom: 0;
}

#esj-chapter-matches li[aria-selected="true"] {
    background: #eaf4fb;
}

#esj-range-selection .esj-search-title,
#esj-range-selection .esj-search-context {
    display: block;
}

#esj-range-selection .esj-search-context {
    font-size: 12px;
    color: #596571;
    margin-top: 2px;
}

#esj-range-selection .esj-search-empty {
    padding: 12px 10px;
    color: #666;
}

/* 短视口保留单行章名和目录位置，避免结果本身被挤成半行 */
#esj-range-selection .esj-search-results[data-compact] li {
    padding: 2px 10px;
}

#esj-range-selection .esj-search-results[data-compact] .esj-search-title,
#esj-range-selection .esj-search-results[data-compact] .esj-search-context {
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

#esj-range-selection .esj-search-results[data-compact] .esj-search-context {
    margin-top: 0;
}

/* 勾选工具栏与原目录 */
#esj-range-selection .esj-selection-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    flex-shrink: 0;
}

#esj-range-selection .esj-selection-toolbar button {
    color: #1976aa;
    padding: 2px 0;
    background: transparent;
    border: 0;
}

#esj-range-selection .esj-selection-directory {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 0 1 auto;
}

#esj-range-selection .esj-chapter-directory {
    width: 100%;
    height: clamp(120px, 32dvh, 250px);
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    overflow-anchor: none;
    box-sizing: border-box;
    border: 1px solid #d3dce3;
    border-radius: 5px;
}

#esj-range-selection .esj-chapter-directory details {
    border-bottom: 1px solid #d3dce3;
    margin: 0;
}

#esj-range-selection .esj-chapter-directory summary {
    cursor: pointer;
    padding: 8px;
    background: #f4f7f9;
    overflow-wrap: anywhere;
}

#esj-range-selection .esj-chapter-directory summary input {
    margin: 0 6px 0 2px;
    vertical-align: middle;
}

#esj-range-selection .esj-chapter-group-count {
    margin-left: 9px;
    color: #666;
    font-size: 12px;
    font-weight: normal;
}

#esj-range-selection .esj-chapter-directory p {
    margin: 2px 0;
}

#esj-range-selection .esj-chapter-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid #e0e6eb;
    cursor: pointer;
}

#esj-range-selection details .esj-chapter-row {
    padding-left: 20px;
}

#esj-range-selection .esj-chapter-selector {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-shrink: 0;
}

#esj-range-selection .esj-chapter-row input {
    align-self: center;
}

#esj-range-selection .esj-chapter-position {
    flex: 0 0 var(--esj-chapter-position-width, 2ch);
    text-align: right;
    color: #666;
    font-size: inherit;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

#esj-range-selection .esj-chapter-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

#esj-range-selection [data-esj-selected] {
    background: #eaf4fb;
}

#esj-range-selection [data-esj-search-current] {
    background: #fff0bd;
}

/* 缓存提示与底部操作 */
#esj-range-selection .esj-selection-cache-warning {
    padding: 8px;
    border: 1px solid #d97706;
    background: #fff7e6;
    color: #8a5a00;
    border-radius: 5px;
    font-size: 13px;
}

#esj-range-selection .esj-selection-footer {
    padding: 0 16px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
}

#esj-range-selection .esj-selection-footer button {
    padding: 8px 12px;
}

#esj-selection-count {
    color: #1976aa;
    font-weight: 600;
}

#esj-range-selection .esj-selection-total {
    color: #666;
    font-size: 12px;
}

#esj-range-selection .esj-selection-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

#esj-range-selection .esj-selection-download {
    background: #287eaf;
    color: #fff;
    border: none;
}

/* 显示偏好与小屏适配 */
@media (forced-colors: active) {
    #esj-range-selection .esj-search-entry:focus-within {
        outline: 2px solid Highlight;
        outline-offset: 2px;
    }
}

@media (max-height: 500px) {
    #esj-range-selection .esj-selection-body {
        flex-shrink: 1;
    }
}

@media (max-width: 600px) {
    #esj-range-selection {
        max-width: calc(100vw - 16px);
        max-height: calc(100dvh - 16px);
    }

    #esj-range-selection .esj-selection-body {
        padding: 10px;
    }

    #esj-range-selection .esj-selection-fields {
        padding: 0 10px 10px;
    }

    #esj-range-selection .esj-selection-filename {
        padding: 0 10px 10px;
    }

    #esj-range-selection .esj-selection-footer {
        padding: 0 10px 10px;
    }
}

@media (max-width: 420px) {
    #esj-range-selection .esj-selection-book-info {
        flex-basis: 100%;
    }

    #esj-range-selection #esj-range-open-previous {
        margin-left: 0;
    }
}

@media (pointer: coarse) {
    #esj-range-selection button,
    #esj-range-selection .esj-selection-modes label {
        min-height: 44px;
    }

    #esj-range-selection .esj-chapter-row,
    #esj-range-selection summary,
    #esj-chapter-matches li {
        min-height: 44px;
    }

    #esj-range-search {
        font-size: 16px;
    }
}
`;
