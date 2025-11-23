import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
import getMeta from './script-meta.js';

function getUserscriptHeader() {
  const meta = getMeta();
  
  let header = '// ==UserScript==\n';
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      value.forEach(v => header += `// @${key.padEnd(13)} ${v}\n`);
    } else {
      header += `// @${key.padEnd(13)} ${value}\n`;
    }
  }
  header += '// ==/UserScript==\n';
  return header;
}

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/esj-novel-downloader.user.js',
    format: 'iife',
    name: 'EsjNovelDownloader',
    sourcemap: false,
    // 在 watch 模式下动态读取 package.json
    banner: getUserscriptHeader,
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    esbuild({
      minify: false, 
      target: 'es2020', 
    }),
  ],
};