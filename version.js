// Cost Record PWA - Version Control
const VERSION_ROOT = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined' ? self : this);

VERSION_ROOT.APP_VERSION_INFO = {
  version: 'V1_2',
  build: '1_2',
  cacheName: 'cost-record-v1_2',
  // 若部署在 GitHub Pages，同站的 ./version.json 會直接成為遠端版次來源。
  // 若正式版與 GitHub 發布來源不同，可改成完整 URL，例如 raw.githubusercontent.com 的 version.json。
  githubVersionUrl: './version.json',
  versionCheckIntervalMs: 5 * 60 * 1000
};

const APP_VERSION = VERSION_ROOT.APP_VERSION_INFO.version;
const APP_BUILD   = VERSION_ROOT.APP_VERSION_INFO.build;
const CACHE_NAME  = VERSION_ROOT.APP_VERSION_INFO.cacheName;
