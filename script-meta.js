import fs from 'fs';

export default function getMeta() {
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

  return {
    name: 'ESJZone 全本下载',
    namespace: 'http://tampermonkey.net/',
    version: pkg.version,
    description: '在 ESJZone 小说详情页/论坛页注入下载按钮，支持 TXT/EPUB 全本导出，支持阅读页单章节下载',
    author: 'Shigure Sora',
    match: [
      'https://www.esjzone.cc/detail/*',
      'https://www.esjzone.one/detail/*',
      'https://www.esjzone.cc/forum/*',
      'https://www.esjzone.one/forum/*'
    ],
    'run-at': 'document-start',
    grant: [
      'GM_setValue',
      'GM_getValue',
      'unsafeWindow',
    ],
    // icon: 'https://www.esjzone.cc/favicon.ico', 
  };
}