import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import esbuild from "rollup-plugin-esbuild";
import process from "node:process";
import getMeta from "./script-meta.js";

const isWatchMode = process.env.ROLLUP_WATCH === "true";

function getUserscriptHeader() {
    const meta = getMeta();

    let header = "// ==UserScript==\n";
    for (const [key, value] of Object.entries(meta)) {
        if (Array.isArray(value)) {
            value.forEach((v) => (header += `// @${key.padEnd(13)} ${v}\n`));
        } else {
            header += `// @${key.padEnd(13)} ${value}\n`;
        }
    }
    header += "// ==/UserScript==\n";
    return header;
}

function userscriptHeader() {
    return {
        name: "userscript-header",
        generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
                if (output.type === "chunk" && output.isEntry) {
                    output.code = getUserscriptHeader() + output.code;
                }
            }
        }
    };
}

export default {
    input: "src/index.ts",
    output: {
        file: "dist/esj-novel-downloader.user.js",
        format: "iife",
        name: "EsjNovelDownloader",
        sourcemap: false
    },
    plugins: [
        resolve({
            browser: true,
            preferBuiltins: false
        }),
        commonjs(),
        esbuild({
            minify: !isWatchMode,
            target: "es2020"
        }),
        // 压缩完成后再注入 metadata，避免 userscript header 被移除
        userscriptHeader()
    ]
};
