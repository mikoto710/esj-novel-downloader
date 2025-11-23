import fs from 'fs';

export default function getMeta() {
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

  return {
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
    // icon: 'https://www.esjzone.cc/favicon.ico', 
  };
}