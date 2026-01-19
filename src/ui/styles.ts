const STYLES = `
    /* 遮罩与弹窗基础 */
    #esj-popup {
        position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
        width: 520px; background: #fff; border-radius: 8px;
        border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28);
        z-index: 999999; display: flex; flex-direction: column;
        font-family: sans-serif;
    }
    
    /* 头部 */
    #esj-header, #esj-confirm-header, #esj-format-header #esj-settings-header {
        padding: 10px; background: #2b9bd7; color: #fff;
        display: flex; justify-content: space-between; align-items: center;
        cursor: move; border-radius: 8px 8px 0 0;
    }

    /* 按钮通用 */
    .btn { cursor: pointer; } 
    
    /* 最小化托盘 */
    #esj-min-tray {
        position: fixed; bottom: 20px; left: 20px;
        background: rgba(43, 155, 215, 0.9); color: #fff;
        padding: 10px 15px; border-radius: 25px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        cursor: pointer; z-index: 9999999; /* 确保层级够高 */
        font-size: 14px; font-weight: bold;
        display: flex; align-items: center; gap: 8px;
        transition: transform 0.2s;
    }
    #esj-min-tray:hover { transform: scale(1.05); }

    /* 进度条 */
    #esj-progress { width: 0%; height: 100%; background: #2b9bd7; transition: width .2s; }

    /* 确认弹窗 & 格式弹窗 */
    #esj-confirm, #esj-format {
        position: fixed; top: 30%; left: 50%; transform: translateX(-50%);
        width: 380px; background: #fff; border: 1px solid #aaa;
        border-radius: 8px; box-shadow: 0 0 18px rgba(0,0,0,0.28);
        z-index: 999999; display: flex; flex-direction: column;
    }
        
    #esj-format { 
        width: 420px; 
    }

    /* 开关样式 (Toggle Switch) */
    .esj-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        vertical-align: middle;
    }

    .esj-switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .esj-slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: #ccc;
        transition: .4s;
        border-radius: 24px;
    }

    .esj-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }

    input:checked + .esj-slider {
        background-color: #2b9bd7; /* ESJ 蓝色 */
    }

    input:focus + .esj-slider {
        box-shadow: 0 0 1px #2b9bd7;
    }

    input:checked + .esj-slider:before {
        transform: translateX(20px);
    }

`;

export function injectStyles(): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLES;
    // 尝试插入 head，如果 document-start 阶段 head 不存在，则插入 html 根节点
    (document.head || document.documentElement).appendChild(styleEl);
}
