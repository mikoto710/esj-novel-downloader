import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import esbuild from "rollup-plugin-esbuild";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
import process from "node:process";
import getMeta from "./script-meta.js";

const isWatchMode = process.env.ROLLUP_WATCH === "true";

function inlineCss() {
    const suffix = "?inline";

    return {
        name: "inline-css",
        async resolveId(source, importer) {
            if (!source.endsWith(`.css${suffix}`)) {
                return null;
            }
            const resolved = await this.resolve(source.slice(0, -suffix.length), importer, { skipSelf: true });
            return resolved ? `${resolved.id}${suffix}` : null;
        },
        async load(id) {
            if (!id.endsWith(`.css${suffix}`)) {
                return null;
            }
            const filename = id.slice(0, -suffix.length);
            this.addWatchFile(filename);
            const css = await readFile(filename, "utf8");
            const result = await transform(css, {
                loader: "css",
                minifyWhitespace: !isWatchMode,
                charset: "utf8",
                legalComments: "none"
            });
            return `export default ${JSON.stringify(result.code.trim())};`;
        }
    };
}

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
        inlineCss(),
        resolve({
            browser: true,
            preferBuiltins: false
        }),
        commonjs(),
        esbuild({
            minify: !isWatchMode,
            charset: "utf8",
            target: "es2020"
        }),
        // 压缩完成后再注入 metadata，避免 userscript header 被移除
        userscriptHeader()
    ]
};
