import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import fs from 'fs';

const pkgContent = fs.readFileSync('./package.json', 'utf-8');
const pkg = JSON.parse(pkgContent);;

const meta = {
  name: 'ESJZone 全本下载',
  namespace: 'http://tampermonkey.net/',
  version: pkg.version, 
  description: '在 ESJZone 小说详情页注入 "全本下载" 按钮，支持 TXT/EPUB 导出',
  author: 'Shigure Sora',
  match: [
    'https://www.esjzone.cc/detail/*',
    'https://www.esjzone.one/detail/*',
    'https://www.esjzone.net/detail/*',
    'https://www.esjzone.me/detail/*'
  ],
  'run-at': 'document-start',
  grant: 'none',
};

function getUserscriptHeader() {
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
  input: 'src/index.js',
  output: {
    file: 'dist/esj-novel-downloader.user.js',
    format: 'iife',
    name: 'EsjNovelDownloader',
    sourcemap: false,
    banner: getUserscriptHeader,
  },
  plugins: [
    resolve(),
    commonjs(),
  ],
};