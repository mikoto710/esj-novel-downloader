/**
 * Tampermonkey 全局变量声明
 */

// unsafeWindow 沙箱
declare const unsafeWindow: any;

interface GM_Response {
    finalUrl: string;
    readyState: number;
    status: number;
    statusText: string;
    responseHeaders: string;
    response: any;
    responseText: string;
    responseXML: Document | null;
}

interface GM_RequestDetails {
    method?: "GET" | "POST" | "HEAD";
    url: string;
    headers?: Record<string, string>;
    data?: any;
    cookie?: string;
    binary?: boolean;
    nocache?: boolean;
    revalidate?: boolean;
    timeout?: number;
    context?: any;
    responseType?: "text" | "json" | "blob" | "arraybuffer" | "stream";
    overrideMimeType?: string;
    anonymous?: boolean;
    fetch?: boolean;
    username?: string;
    password?: string;
    onload?: (response: GM_Response) => void;
    onloadstart?: (response: GM_Response) => void;
    onloadend?: (response: GM_Response) => void;
    onprogress?: (response: GM_Response) => void;
    onreadystatechange?: (response: GM_Response) => void;
    ontimeout?: (response: GM_Response) => void;
    onabort?: (response: GM_Response) => void;
    onerror?: (response: GM_Response) => void;
}

// GM API 类型定义
declare function GM_setValue(key: string, value: any): void;
declare function GM_getValue<T>(key: string, defaultValue?: T): T;
declare function GM_xmlhttpRequest(details: GM_RequestDetails): { abort: () => void };
