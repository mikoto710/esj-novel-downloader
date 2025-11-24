interface Window {
    JSZip: any;
}

// GM API 类型定义
declare function GM_setValue(key: string, value: any): void;
declare function GM_getValue<T>(key: string, defaultValue?: T): T;