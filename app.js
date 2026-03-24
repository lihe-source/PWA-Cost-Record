/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V1.2
   Modules: DataStore · CsvInvoiceParser · DriveService · App
───────────────────────────────────────────────────────────── */
'use strict';

// ══════════════════════════════════════════════════════════════
// CONSTANTS & ICONS
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY       = 'cost_record_v1';
const DRIVE_PREFIX      = 'cost-record-backup';
const DRIVE_FOLDER_NAME = 'PWA-Cost-Record';

const DEFAULT_CATEGORIES = [
  { name: '飲食', subs: ['早餐', '午餐', '晚餐', '飲料', '點心', '宵夜'] },
  { name: '交通', subs: ['捷運', '公車', '火車', '高鐵', '加油費', '停車費', '摩托車'] }
];

// 擴充主類別預設圖示
const MAIN_CAT_ICONS = {
  '飲食': '🍽️', '交通': '🚗', '購物': '🛍️', '娛樂': '🎬', '居家': '🏠',
  '醫療': '🏥', '學習': '📚', '人際': '🤝', '財務': '💰', '其他': '📦',
  '平日消費': '📅', '家庭消費': '🏡'
};

// 擴充子類別預設圖示
const CAT_ICONS = {
  // 飲食
  '早餐': '🍳', '午餐': '🍱', '晚餐': '🍜', '點心': '🧁', '飲料': '🧋', '宵夜': '🍗', '水果': '🍎', '咖啡': '☕',
  // 交通
  '捷運': '🚇', '公車': '🚌', '火車': '🚆', '高鐵': '🚄', '計程車': '🚕', '加油費': '⛽', '停車費': '🅿️', '摩托車': '🛵', '保養': '🔧',
  // 購物
  '衣服': '👕', '鞋子': '👟', '配件': '👜', '保養品': '🧴', '3C': '📱', '市場': '🛒', '日用品': '🧻', '生鮮': '🥩',
  // 居家
  '房租': '🔑', '水電': '💧', '瓦斯': '🔥', '網路': '🌐', '電信': '📞', '裝潢': '🔨', '家電': '📺', '家具': '🛋️',
  // 醫療/健康
  '看診': '🩺', '藥品': '💊', '保健食品': '🌿', '運動': '🏃',
  // 娛樂
  '電影': '🍿', '遊戲': '🎮', '旅遊': '✈️', '聚餐': '🍻', '展覽': '🖼️',
  // 狀態
  '待分類': '📋', '其他': '💰'
};

function getCatIcon(cat1, cat2) {
  if (cat2 && CAT_ICONS[cat2]) return CAT_ICONS[cat2];
  if (cat1 && MAIN_CAT_ICONS[cat1]) return MAIN_CAT_ICONS[cat1];
  return '📌'; // 若都找不到，給個預設圖釘
}

const GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro'
];

// ══════════════════════════════════════════════════════════════
// DATA STORE
// ══════════════════════════════════════════════════════════════
class DataStore {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.error('Load error', e); }
    return this._default();
  }

  _default() {
    return {
      schemaVersion: 1,
      expenses: [],
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      settings: {
        geminiApiKey: '',
        geminiModel: 'gemini-1.5-flash',
        googleClientId: ''
      },
      importedInvoiceNos: [],
      lastSync: null,
      storeMapping: []
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) { console.error('Save error', e); }
  }

  addExpense(exp) {
    exp.id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    exp.createdAt = new Date().toISOString();
    this.data.expenses.push(exp);
    this.save();
    return exp;
  }

  updateExpense(id, updates) {
    const idx = this.data.expenses.findIndex(e => e.id === id);
    if (idx < 0) return null;
    this.data.expenses[idx] = { ...this.data.expenses[idx], ...updates, updatedAt: new Date().toISOString() };
    this.save();
    return this.data.expenses[idx];
  }

  deleteExpense(id) {
    this.data.expenses = this.data.expenses.filter(e => e.id !== id);
    this.save();
  }

  getByDate(dateStr) {
    return this.data.expenses
      .filter(e => e.date === dateStr)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.data.expenses.filter(e => e.date && e.date.startsWith(prefix));
  }

  getDatesWithExpenses(year, month) {
    const set = new Set();
    this.getByMonth(year, month).forEach(e => set.add(e.date));
    return set;
  }

  search(kw) {
    if (!kw || kw.trim() === '') return [...this.data.expenses];
    const q = kw.toLowerCase();
    return this.data.expenses.filter(e =>
      (e.description  || '').toLowerCase().includes(q) ||
      (e.store        || '').toLowerCase().includes(q) ||
      (e.category1    || '').toLowerCase().includes(q) ||
      (e.category2    || '').toLowerCase().includes(q) ||
      (e.invoiceNo    || '').toLowerCase().includes(q)
    ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  getInvoiceItems(invoiceNo) {
    if (!invoiceNo) return [];
    return this.data.expenses.filter(e => e.invoiceNo === invoiceNo);
  }

  isInvoiceImported(invNo) {
    return this.data.importedInvoiceNos.includes(invNo);
  }

  markInvoiceImported(invNo) {
    if (!this.data.importedInvoiceNos.includes(invNo)) {
      this.data.importedInvoiceNos.push(invNo);
      this.save();
    }
  }

  export() {
    return JSON.parse(JSON.stringify(this.data));
  }

  import(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('無效的備份格式');
    this.data = { ...this._default(), ...raw };
    this.save();
  }
}

// ══════════════════════════════════════════════════════════════
// CSV INVOICE PARSER (載具 CSV)
// ══════════════════════════════════════════════════════════════
class CsvInvoiceParser {
  parse(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const HEADER_COLS = ['載具自訂名稱','發票日期','發票號碼','發票金額','發票狀態','折讓','賣方統一編號','賣方名稱','賣方地址','買方統編','消費明細_數量','消費明細_單價','消費明細_金額','消費明細_品名'];
    const rows = [];
    let headerFound = false;
    let colMap = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('捐贈或作廢') || line.startsWith('注意')) continue;
      const cols = this._splitCsv(line);

      if (!headerFound) {
        if (cols.some(c => c.includes('發票日期') || c.includes('發票號碼'))) {
          headerFound = true;
          cols.forEach((c, i) => { colMap[c.trim()] = i; });
          continue;
        }
        if (cols.length >= 14 && /^\d{8}$/.test(cols[1])) {
          headerFound = true;
          HEADER_COLS.forEach((h, i) => { colMap[h] = i; });
        } else {
          continue;
        }
      }

      if (cols.length < 4) continue;

      const get = key => (cols[colMap[key]] || '').trim();
      const amount = parseFloat(get('消費明細_金額') || get('發票金額') || '0');
      const rawDate = get('發票日期');

      if (amount <= 0 || !/^\d{8}$/.test(rawDate)) continue;

      rows.push({
        date: `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`,
        invoiceNo: get('發票號碼'),
        amount,
        description: get('消費明細_品名') || get('賣方名稱') || '(未命名)',
        store: get('賣方名稱'),
        status: get('發票狀態'),
        carrier: get('載具自訂名稱')
      });
    }
    return rows;
  }

  groupByInvoice(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.invoiceNo)) {
        map.set(r.invoiceNo, { invoiceNo: r.invoiceNo, date: r.date, store: r.store, items: [] });
      }
      map.get(r.invoiceNo).items.push(r);
    }
    return [...map.values()];
  }

  _splitCsv(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur);
    return result;
  }
}

// ══════════════════════════════════════════════════════════════
// GOOGLE DRIVE SERVICE
// ══════════════════════════════════════════════════════════════
class DriveService {
  constructor() {
    this.token = null;
    this._ready = false;
  }

  async init(clientId) {
    if (this._ready || !clientId) return;
    this.clientId = clientId;
    await this._loadGIS();
    this._ready = true;
  }

  _loadGIS() {
    if (window.google && window.google.accounts) return Promise.resolve();
    return new Promise(resolve => {
      if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
        const wait = setInterval(() => {
          if (window.google && window.google.accounts) {
            clearInterval(wait);
            resolve();
          }
        }, 100);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  async getToken() {
    if (this.token) return this.token;
    if (!this.clientId) throw new Error('請先在設定中填寫 Google Client ID');
    await this._loadGIS();
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: r => r.error ? reject(new Error(r.error)) : resolve((this.token = r.access_token))
      });
      tc.requestAccessToken({ prompt: 'select_account' });
    });
  }

  // 自動取得或建立 PWA-Cost-Record 資料夾
  async _getOrCreateFolder() {
    const token = await this.getToken();
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;
    
    // 建立新資料夾
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!createRes.ok) throw new Error('無法在 Drive 建立資料夾');
    const createData = await createRes.json();
    return createData.id;
  }

  async listBackups() {
    const token = await this.getToken();
    // 取前 5 筆最新的備份資料
    const q = encodeURIComponent(`name contains '${DRIVE_PREFIX}' and mimeType='application/json' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    const d = await res.json();
    return d.files || [];
  }

  async uploadBackup(data) {
    const token = await this.getToken();
    const folderId = await this._getOrCreateFolder();
    
    const fileName = `${DRIVE_PREFIX}-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const boundary = '-------cost_record_backup';
    const metadata = { 
      name: fileName, 
      mimeType: 'application/json',
      parents: [folderId] // 放置於指定資料夾
    };

    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      JSON.stringify(data, null, 2),
      `--${boundary}--`
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      }
    );
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    return res.json();
  }

  async downloadBackup(fileId) {
    const token = await this.getToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    return res.json();
  }
}

// ══════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════════════════════
const fmt = {
  money: n => `$${Number(n||0).toLocaleString('zh-TW')}`,
  date: d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${y}/${m}/${day}`; },
  monthLabel: (y,m) => `${y} 年 ${m} 月`,
  today: () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
};

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
const CHART_COLORS = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];

// ══════════════════════════════════════════════════════════════
// MAIN APP V1.2
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.store = new DataStore();
    this.csvParser = new CsvInvoiceParser();
    this.drive = new DriveService();
    
    this.view = 'home';
    this.today = fmt.today();
    this.selected = fmt.today();
    this.calendarYear = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth()+1;
    this.statsYear = new Date().getFullYear();
    this.statsMonth = new Date().getMonth()+1;
    this.statsCustom = false;
    this.statsSortMode = 'amount-desc';
    this._statsOpenCats = new Set();
    this._toastTimer = null;
    this._editId = null;
    this._isDarkMode = localStorage.getItem('theme') !== 'light';
  }

  async init() {
    this._checkForUpdates(); // 檢查進版
    this._setupNav();
    this._registerSW();
    this.renderView();
    
    const {googleClientId} = this.store.data.settings;
    if(googleClientId) this.drive.init(googleClientId).catch(()=>{});

    // Hidden CSV inputs
    const ci = document.createElement('input'); 
    ci.type='file'; ci.id='csv-invoice-input'; ci.accept='.csv'; ci.style.display='none';
    document.body.appendChild(ci);
    ci.addEventListener('change', e => this._handleCsvFile(e));

    const mc = document.createElement('input'); 
    mc.type='file'; mc.id='moze-csv-input'; mc.accept='.csv'; mc.style.display='none';
    document.body.appendChild(mc);
    mc.addEventListener('change', e => this._handleMozeCsvFile(e));

    document.addEventListener('click', e => {
      if(e.target.closest('#nav-add-btn')) this.openExpenseModal(null);
    });

    this._applyTheme(this._isDarkMode);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      this._isDarkMode = !this._isDarkMode;
      localStorage.setItem('theme', this._isDarkMode ? 'dark' : 'light');
      this._applyTheme(this._isDarkMode);
    });
  }

  async _checkForUpdates() {
    try {
      const res = await fetch('./version.js?t=' + Date.now());
      const text = await res.text();
      // 假設 version.js 內有 const APP_VERSION = 'V1.x'
      const match = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
      if (match && window.APP_VERSION && match[1] !== window.APP_VERSION) {
         if (navigator.serviceWorker && navigator.serviceWorker.controller) {
           navigator.serviceWorker.controller.postMessage({type: 'SKIP_WAITING'});
         }
         const banner = document.getElementById('update-banner');
         if(banner) { 
           banner.style.display = 'block'; 
           setTimeout(() => window.location.reload(), 1500); 
         }
      }
    } catch(e) {}
  }

  _applyTheme(dark) {
    document.body.classList.toggle('light-mode', !dark);
    const btn = document.getElementById('theme-toggle-btn');
    if(btn) btn.textContent = dark ? '🌙' : '☀️';
    if(this.view === 'stats') this.renderView();
  }

  _setupNav() {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.view = btn.dataset.view;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === this.view));
        this.renderView();
      });
    });
  }

  _registerSW() {
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => {
          if(reg.installing?.state === 'installed' && navigator.serviceWorker.controller) {
             navigator.serviceWorker.controller.postMessage({type: 'SKIP_WAITING'});
             const banner = document.getElementById('update-banner');
             if(banner) {
               banner.style.display = 'block';
               setTimeout(() => window.location.reload(), 1500);
             }
          }
        });
      });
    });
  }

  renderView() {
