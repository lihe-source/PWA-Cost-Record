/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V2.0
   Features: Multi-Currency · Google Drive (#PWA-Cost-Record)
             Category Icons · Full-Page Layout · CSV Import
─────────────────────────────────────────────────────────────── */
'use strict';

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY        = 'cost_record_v1';
const EXCHANGE_RATE_KEY  = 'cost_record_fx';
const DRIVE_FOLDER_NAME  = '#PWA-Cost-Record';
const DRIVE_FILE_PREFIX  = 'cost-record-backup';
const FX_TTL_MS          = 6 * 60 * 60 * 1000; // 6h cache

const CURRENCIES = {
  TWD: { name:'台幣',  symbol:'NT$', code:'TWD' },
  JPY: { name:'日幣',  symbol:'¥',  code:'JPY' },
  CNY: { name:'人民幣',symbol:'¥',  code:'CNY' },
  EUR: { name:'歐元',  symbol:'€',  code:'EUR' },
  USD: { name:'美金',  symbol:'$',  code:'USD' },
};

const ICON_LIBRARY = [
  '🍽️','🍳','🍱','🍜','🍔','🍕','🍣','🍦','🧁','🧋','☕','🍺','🍷','🥤','🥗',
  '🛍️','🛒','👗','👟','💄','💍','🧴','📦','🎒','🧸',
  '🚗','🚌','✈️','⛽','🚊','🏍️','🅿️','🚢','🛵','🚲',
  '🎮','🎬','🎵','🎤','📺','🎭','🎨','🎪','🎯','🎲',
  '🏥','💊','🏋️','⚕️','🧘','🏃','🛁','🧬','💆','🌿',
  '🏠','💡','🔧','🧹','🛋️','🏗️','🔑','📐','🪴','🧺',
  '💰','💳','🏦','📊','💹','🧾','💎','🏷️','💸','🪙',
  '📚','✏️','🎓','💻','📱','🖊️','📐','🔬','🧩','📝',
  '🏨','🗺️','🗼','🌏','🏖️','🏕️','🗽','🎡','⛷️','🤿',
  '🎁','🌸','☀️','⭐','🎉','🐶','📋','❓','🔖','🍀',
  '🐱','🌈','🌙','❄️','🔥','💫','🦋','🍁','🌊','⚽',
];

const BUILTIN_ICONS = {
  '餐飲':'🍽️','早餐':'🍳','午餐':'🍱','晚餐':'🍜','點心':'🧁','飲料':'🧋','咖啡':'☕',
  '購物':'🛍️','超市':'🛒','市場':'🛒','服飾':'👗','日用品':'🧴',
  '交通':'🚗','油費':'⛽','大眾運輸':'🚌','停車費':'🅿️','停車':'🅿️',
  '娛樂':'🎮','電影':'🎬','音樂':'🎵','遊戲':'🎮',
  '醫療健康':'🏥','醫療':'🏥','藥品':'💊','運動健身':'🏃','健身':'🏋️',
  '家庭':'🏠','家電':'📺','租金':'🏠','出遊':'✈️',
  '教育':'📚','書籍':'📖',
  '平日消費':'📋','家庭消費':'🏠',
  '待分類':'❓','其他':'💰','未分類':'📋',
};

const DEFAULT_CATEGORIES = [
  { id:'cat_food', name:'餐飲', icon:'🍽️', subs:[
    {id:'sub_bk',   name:'早餐',    icon:'🍳'},
    {id:'sub_ln',   name:'午餐',    icon:'🍱'},
    {id:'sub_dn',   name:'晚餐',    icon:'🍜'},
    {id:'sub_sn',   name:'點心',    icon:'🧁'},
    {id:'sub_dr',   name:'飲料',    icon:'🧋'},
  ]},
  {id:'cat_home', name:'家庭', icon:'🏠', subs:[
    {id:'sub_mkt',  name:'市場',    icon:'🛒'},
    {id:'sub_appl', name:'家電',    icon:'📺'},
    {id:'sub_trip', name:'出遊',    icon:'✈️'},
  ]},
  {id:'cat_trans', name:'交通', icon:'🚗', subs:[
    {id:'sub_fuel', name:'油費',    icon:'⛽'},
    {id:'sub_bus',  name:'大眾運輸',icon:'🚌'},
    {id:'sub_park', name:'停車費',  icon:'🅿️'},
  ]},
  {id:'cat_shop', name:'購物', icon:'🛍️', subs:[
    {id:'sub_cl',   name:'服飾',    icon:'👗'},
    {id:'sub_dl',   name:'日用品',  icon:'🧴'},
  ]},
  {id:'cat_health', name:'醫療健康', icon:'🏥', subs:[
    {id:'sub_med',  name:'醫療',    icon:'🏥'},
    {id:'sub_drug', name:'藥品',    icon:'💊'},
    {id:'sub_sp',   name:'運動健身',icon:'🏃'},
  ]},
  {id:'cat_ent', name:'娛樂', icon:'🎮', subs:[
    {id:'sub_mv',   name:'電影',    icon:'🎬'},
    {id:'sub_gm',   name:'遊戲',    icon:'🎮'},
    {id:'sub_mu',   name:'音樂',    icon:'🎵'},
  ]},
];

const GEMINI_MODELS = ['gemini-1.5-flash','gemini-1.5-pro','gemini-2.0-flash','gemini-2.0-pro'];
const CHART_COLORS  = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];
const DAYS_TW       = ['日','一','二','三','四','五','六'];

// ══════════════════════════════════════════════════════════════
// DATA STORE
// ══════════════════════════════════════════════════════════════
class DataStore {
  constructor() { this.data = this._load(); }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.categories = this._migrateCats(d.categories || []);
        if (!d.settings) d.settings = {};
        d.settings.preferredCurrency = d.settings.preferredCurrency || 'TWD';
        d.settings.autoSync = d.settings.autoSync || false;
        d.settings.googleEmail = d.settings.googleEmail || '';
        // Remove old invoice API keys silently (they stay but won't be shown)
        return d;
      }
    } catch(e) { console.error('Load error', e); }
    return this._default();
  }

  _default() {
    return {
      schemaVersion: 2,
      expenses: [],
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      settings: {
        geminiApiKey: '', geminiModel: 'gemini-1.5-flash',
        googleClientId: '', googleEmail: '',
        preferredCurrency: 'TWD', autoSync: false,
      },
      importedInvoiceNos: [],
      lastSync: null,
      storeMapping: [],
    };
  }

  _migrateCats(cats) {
    if (!Array.isArray(cats) || cats.length === 0) return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    return cats.map((cat, ci) => {
      const subsRaw = cat.subs || [];
      const subs = subsRaw.map((sub, si) => {
        if (typeof sub === 'string') {
          return { id: sub.id || `sub_${ci}_${si}`, name: sub, icon: BUILTIN_ICONS[sub] || '💰' };
        }
        return { id: sub.id || `sub_${ci}_${si}`, name: sub.name, icon: sub.icon || BUILTIN_ICONS[sub.name] || '💰' };
      });
      return { id: cat.id || `cat_${ci}`, name: cat.name, icon: cat.icon || BUILTIN_ICONS[cat.name] || '📋', subs };
    });
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
    catch(e) { console.error('Save error', e); }
  }

  addExpense(exp) {
    exp.id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    exp.createdAt = new Date().toISOString();
    if (!exp.currency) exp.currency = this.data.settings.preferredCurrency || 'TWD';
    this.data.expenses.push(exp);
    this.save(); return exp;
  }

  updateExpense(id, updates) {
    const idx = this.data.expenses.findIndex(e => e.id === id);
    if (idx < 0) return null;
    this.data.expenses[idx] = { ...this.data.expenses[idx], ...updates, updatedAt: new Date().toISOString() };
    this.save(); return this.data.expenses[idx];
  }

  deleteExpense(id) { this.data.expenses = this.data.expenses.filter(e => e.id !== id); this.save(); }

  getByDate(ds) {
    return this.data.expenses.filter(e => e.date === ds).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  }

  getByMonth(y, m) {
    const prefix = `${y}-${String(m).padStart(2,'0')}`;
    return this.data.expenses.filter(e => e.date && e.date.startsWith(prefix));
  }

  getActiveDatesInMonth(y, m) {
    const s = new Set(); this.getByMonth(y,m).forEach(e => s.add(e.date)); return s;
  }

  search(kw) {
    if (!kw?.trim()) return [...this.data.expenses];
    const q = kw.toLowerCase();
    return this.data.expenses.filter(e =>
      (e.description||'').toLowerCase().includes(q) ||
      (e.store||'').toLowerCase().includes(q) ||
      (e.category1||'').toLowerCase().includes(q) ||
      (e.category2||'').toLowerCase().includes(q)
    ).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }

  getPendingExpenses() { return this.data.expenses.filter(e => e.status === 'pending'); }

  export() { return JSON.parse(JSON.stringify(this.data)); }

  import(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('無效的備份格式');
    const d = { ...this._default(), ...raw };
    d.categories = this._migrateCats(d.categories || []);
    if (!d.settings) d.settings = this._default().settings;
    d.settings.preferredCurrency = d.settings.preferredCurrency || 'TWD';
    this.data = d; this.save();
  }

  getCatIcon(catName) {
    const cat = this.data.categories.find(c => c.name === catName);
    return cat?.icon || BUILTIN_ICONS[catName] || '📋';
  }

  getSubIcon(catName, subName) {
    const cat = this.data.categories.find(c => c.name === catName);
    const sub = cat?.subs?.find(s => s.name === subName);
    return sub?.icon || BUILTIN_ICONS[subName] || '💰';
  }

  getExpenseIcon(e) {
    if (e.status === 'pending') return '❓';
    return this.getSubIcon(e.category1, e.category2) || this.getCatIcon(e.category1) || '💰';
  }
}

// ══════════════════════════════════════════════════════════════
// EXCHANGE RATE SERVICE
// ══════════════════════════════════════════════════════════════
class FxService {
  constructor() { this._cache = null; }

  // Load from localStorage or fetch fresh
  async getRates(forceRefresh = false) {
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(EXCHANGE_RATE_KEY);
        if (raw) {
          const c = JSON.parse(raw);
          if (Date.now() - c.ts < FX_TTL_MS) { this._cache = c.rates; return c.rates; }
        }
      } catch(e) {}
    }
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/TWD', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('FX API error');
      const data = await res.json();
      const rates = data.rates || {};
      rates.TWD = 1;
      localStorage.setItem(EXCHANGE_RATE_KEY, JSON.stringify({ ts: Date.now(), rates }));
      this._cache = rates; return rates;
    } catch(e) {
      // Fallback approximate rates
      const fallback = { TWD:1, JPY:4.74, CNY:0.22, EUR:0.028, USD:0.031 };
      this._cache = fallback; return fallback;
    }
  }

  getCached() { return this._cache || { TWD:1, JPY:4.74, CNY:0.22, EUR:0.028, USD:0.031 }; }

  // Convert amount from fromCurrency to toCurrency using rates (base TWD)
  convert(amount, fromCurrency, toCurrency, rates) {
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return amount;
    const r = rates || this.getCached();
    const twdAmount = amount / (r[fromCurrency] || 1);
    return twdAmount * (r[toCurrency] || 1);
  }

  formatSymbol(currency) { return CURRENCIES[currency]?.symbol || currency; }
}

// ══════════════════════════════════════════════════════════════
// GOOGLE DRIVE SERVICE
// ══════════════════════════════════════════════════════════════
class DriveService {
  constructor() { this.token = null; this._ready = false; this._folderId = null; }

  async init(clientId) {
    if (!clientId) return;
    this.clientId = clientId;
    await this._loadGIS();
    this._ready = true;
  }

  _loadGIS() {
    if (window.google?.accounts) return Promise.resolve();
    return new Promise(resolve => {
      if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
        const w = setInterval(() => { if (window.google?.accounts) { clearInterval(w); resolve(); }}, 100);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  async getToken(prompt = '') {
    if (this.token) return this.token;
    if (!this.clientId) throw new Error('請先在設定中填寫 Google OAuth Client ID');
    await this._loadGIS();
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file profile email',
        callback: r => r.error ? reject(new Error(r.error)) : resolve((this.token = r.access_token))
      });
      tc.requestAccessToken({ prompt: prompt || 'select_account' });
    });
  }

  async getUserEmail() {
    const token = await this.getToken();
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json(); return d.email || '';
  }

  // Find or create "#PWA-Cost-Record" folder
  async ensureFolder(token) {
    if (this._folderId) return this._folderId;
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (d.files?.length > 0) { this._folderId = d.files[0].id; return this._folderId; }
    const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    const folder = await cr.json();
    this._folderId = folder.id; return this._folderId;
  }

  async listBackups() {
    const token = await this.getToken('');
    const folderId = await this.ensureFolder(token);
    const q = encodeURIComponent(`'${folderId}' in parents and name contains '${DRIVE_FILE_PREFIX}' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size,description)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    const d = await res.json(); return d.files || [];
  }

  async uploadBackup(data) {
    const token = await this.getToken('');
    const folderId = await this.ensureFolder(token);
    const now = new Date();
    const fileName = `${DRIVE_FILE_PREFIX}-${now.toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const content = JSON.stringify(data, null, 2);
    const desc = JSON.stringify({ expenseCount: data.expenses?.length || 0, categoryCount: data.categories?.length || 0 });
    const boundary = '-------crboundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: fileName, mimeType: 'application/json', parents: [folderId], description: desc }),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`
    ].join('\r\n');
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    );
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    return res.json();
  }

  async downloadBackup(fileId) {
    const token = await this.getToken('');
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    return res.json();
  }

  revoke() { this.token = null; this._folderId = null; }
}

// ══════════════════════════════════════════════════════════════
// CSV PARSERS
// ══════════════════════════════════════════════════════════════
class CsvInvoiceParser {
  parse(text) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const HEADER = ['載具自訂名稱','發票日期','發票號碼','發票金額','發票狀態','折讓','賣方統一編號','賣方名稱','賣方地址','買方統編','消費明細_數量','消費明細_單價','消費明細_金額','消費明細_品名'];
    const rows = []; let hFound = false, cMap = {};
    for (const rawLine of lines) {
      const line = rawLine.trim(); if (!line) continue;
      if (line.startsWith('捐贈或作廢') || line.startsWith('注意')) continue;
      const cols = this._split(line);
      if (!hFound) {
        if (cols.some(c => c.includes('發票日期') || c.includes('發票號碼'))) {
          hFound = true; cols.forEach((c,i) => { cMap[c.trim()] = i; }); continue;
        }
        if (cols.length >= 14 && /^\d{8}$/.test(cols[1])) { hFound = true; HEADER.forEach((h,i) => { cMap[h] = i; }); }
        else continue;
      }
      if (cols.length < 4) continue;
      const get = k => (cols[cMap[k]]||'').trim();
      const amount = parseFloat(get('消費明細_金額') || get('發票金額') || '0');
      const rawDate = get('發票日期');
      if (amount <= 0 || !/^\d{8}$/.test(rawDate)) continue;
      rows.push({
        date: `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`,
        invoiceNo: get('發票號碼'), amount, description: get('消費明細_品名') || get('賣方名稱') || '(未命名)',
        store: get('賣方名稱'), status: get('發票狀態'), carrier: get('載具自訂名稱')
      });
    }
    return rows;
  }
  groupByInvoice(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.invoiceNo)) map.set(r.invoiceNo, { invoiceNo:r.invoiceNo, date:r.date, store:r.store, items:[] });
      map.get(r.invoiceNo).items.push(r);
    }
    return [...map.values()];
  }
  _split(line) {
    const res = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { res.push(cur); cur = ''; continue; }
      cur += ch;
    }
    res.push(cur); return res;
  }
}

// Generic CSV Expense Parser (for other apps)
class GenericCsvParser {
  detectColumns(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase();
      if (!map.date  && (lower.includes('日期') || lower.includes('date') || lower.includes('時間'))) map.date = i;
      if (!map.amount && (lower.includes('金額') || lower.includes('amount') || lower.includes('費用') || lower.includes('price'))) map.amount = i;
      if (!map.desc  && (lower.includes('說明') || lower.includes('description') || lower.includes('備注') || lower.includes('項目') || lower.includes('name'))) map.desc = i;
      if (!map.cat1  && (lower.includes('大分類') || lower.includes('category') || lower.includes('類別'))) map.cat1 = i;
      if (!map.cat2  && (lower.includes('小分類') || lower.includes('subcategory'))) map.cat2 = i;
      if (!map.store && (lower.includes('店家') || lower.includes('store') || lower.includes('merchant'))) map.store = i;
    });
    return map;
  }

  parse(text, colMap) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this._split(lines[i]);
      if (cols.length < 2) continue;
      const get = k => colMap[k] !== undefined ? (cols[colMap[k]]||'').trim() : '';
      let rawDate = get('date');
      let parsedDate = this._parseDate(rawDate);
      if (!parsedDate) continue;
      const rawAmt = get('amount').replace(/[,$,，,NT$,¥,€]/g,'').trim();
      const amount = parseFloat(rawAmt);
      if (!amount || isNaN(amount) || amount <= 0) continue;
      results.push({
        date: parsedDate, amount,
        description: get('desc') || '(未命名)',
        category1: get('cat1') || '',
        category2: get('cat2') || '',
        store: get('store') || '',
        currency: 'TWD',
        source: 'csv-import',
        status: get('cat1') ? 'categorized' : 'pending',
      });
    }
    return results;
  }

  _parseDate(s) {
    if (!s) return null;
    // Try YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, YYYYMMDD
    let m;
    if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/))) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    if ((m = s.match(/^(\d{8})$/))) return `${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`;
    return null;
  }

  _split(line) {
    const res=[]; let cur='', inQ=false;
    for (const ch of line) {
      if (ch==='"'){inQ=!inQ;continue;}
      if (ch===','&&!inQ){res.push(cur);cur='';continue;}
      cur+=ch;
    }
    res.push(cur); return res;
  }

  getHeaders(text) {
    const firstLine = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')[0] || '';
    return this._split(firstLine).map(h => h.trim());
  }
}

// ══════════════════════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════════════════════
let _appRef = null; // set after App construction

const fmt = {
  money: (n, currency) => {
    const sym = CURRENCIES[currency]?.symbol || 'NT$';
    const num = Math.round(Number(n||0));
    return `${sym}${num.toLocaleString('zh-TW')}`;
  },
  date: d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${y}/${m}/${day}`; },
  dateShort: d => { if(!d) return ''; const [,m,day]=d.split('-'); return `${+m}/${+day}`; },
  dateFull: d => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return `${d.replace(/-/g,'/')} 週${DAYS_TW[dt.getDay()]}`;
  },
  today: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  time: () => {
    const d = new Date();
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()>=12?'下午':'上午'}${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  },
  monthLabel: (y,m) => `${y} 年 ${m} 月`,
};

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.store     = new DataStore();
    this.fx        = new FxService();
    this.drive     = new DriveService();
    this.invoice   = new CsvInvoiceParser();
    this.csvParser = new GenericCsvParser();
    this.view      = 'home';
    this.today     = fmt.today();
    this.calYear   = new Date().getFullYear();
    this.calMonth  = new Date().getMonth() + 1;
    this.statsYear = new Date().getFullYear();
    this.statsMonth= new Date().getMonth() + 1;
    this.statsCustom = false;
    this.statsSortMode = 'amount-desc';
    this._statsOpenCats = new Set();
    this._toastTimer = null;
    this._editId = null;
    this._isDark = localStorage.getItem('theme') !== 'light';
    this._csvImportData = null; // pending CSV import
    _appRef = this;
  }

  get displayCurrency() { return this.store.data.settings.preferredCurrency || 'TWD'; }

  // Convert expense amount to display currency
  expenseDisplay(expense) {
    const fromCurr = expense.currency || 'TWD';
    const toCurr = this.displayCurrency;
    const rates = expense.ratesSnapshot || this.fx.getCached();
    return this.fx.convert(Number(expense.amount || 0), fromCurr, toCurr, rates);
  }

  fmtExp(expense) { return fmt.money(this.expenseDisplay(expense), this.displayCurrency); }

  // ─── INIT ─────────────────────────────────────────────────
  async init() {
    this._applyTheme(this._isDark);
    this._setupNav();
    this._setupUpdateBanner();
    this._registerSW();
    this._setupHeaderCurrency();
    this.renderView();

    // Load FX in background
    this.fx.getRates().then(() => this._updateCurrBadge());

    // Init Drive if configured
    const { googleClientId, googleEmail, autoSync } = this.store.data.settings;
    if (googleClientId) {
      this.drive.init(googleClientId).then(async () => {
        if (autoSync && googleEmail) {
          // Don't auto-upload silently - just check
        }
      }).catch(() => {});
    }

    // Theme toggle
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      this._isDark = !this._isDark;
      localStorage.setItem('theme', this._isDark ? 'dark' : 'light');
      this._applyTheme(this._isDark);
    });

    // FAB
    document.getElementById('nav-add-btn')?.addEventListener('click', () => this.openExpenseModal(null));

    // File inputs
    document.getElementById('csv-invoice-input')?.addEventListener('change', e => this._handleInvoiceCsv(e));
    document.getElementById('import-json-input')?.addEventListener('change', e => this._importJson(e));
    document.getElementById('import-csv-input')?.addEventListener('change', e => this._handleGenericCsv(e));
  }

  _applyTheme(dark) {
    document.body.classList.toggle('light-mode', !dark);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = dark ? '🌙' : '☀️';
    if (this.view === 'stats') this.renderView();
  }

  _setupHeaderCurrency() {
    document.getElementById('curr-badge')?.addEventListener('click', () => this._openCurrencyModal());
    this._updateCurrBadge();
  }
  _updateCurrBadge() {
    const badge = document.getElementById('curr-badge');
    if (badge) badge.textContent = CURRENCIES[this.displayCurrency]?.symbol || 'NT$';
  }

  _setupNav() {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view; this.view = v;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
        this.renderView();
      });
    });
  }

  _setupUpdateBanner() {
    document.getElementById('update-banner')?.addEventListener('click', () => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    });
  }

  _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => {
          if (reg.installing?.state === 'installed' && navigator.serviceWorker.controller)
            document.getElementById('update-banner').style.display = 'block';
        });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }

  renderView() {
    const main = document.getElementById('main-content');
    const title = document.getElementById('header-title');
    switch(this.view) {
      case 'home':     main.innerHTML = this._buildHome();     title.textContent = '記帳本'; break;
      case 'search':   main.innerHTML = this._buildSearch();   title.textContent = '搜尋'; break;
      case 'stats':    main.innerHTML = this._buildStats();    title.textContent = '統計'; break;
      case 'settings': main.innerHTML = this._buildSettings(); title.textContent = '設定'; break;
    }
    this._attachViewEvents();
  }

  // ─── HOME (Full-Page) ──────────────────────────────────────
  _buildHome() {
    const { calYear: y, calMonth: m } = this;
    const monthly = this.store.getByMonth(y, m);
    const total = monthly.reduce((s,e) => s + this.expenseDisplay(e), 0);
    const pending = monthly.filter(e => e.status === 'pending').length;
    const pendingEl = pending > 0
      ? `<div class="mstat-value warning" style="cursor:pointer" id="pending-badge">${pending}</div>`
      : `<div class="mstat-value">${pending}</div>`;

    // Group expenses by date (current month), newest first
    const dateMap = new Map();
    const sortedExp = [...monthly].sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
    for (const e of sortedExp) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, []);
      dateMap.get(e.date).push(e);
    }

    let listHtml = '';
    if (dateMap.size === 0) {
      listHtml = `<div class="empty-state"><div class="icon">📭</div><p>本月尚無記帳資料<br>點下方 ＋ 開始記帳</p></div>`;
    } else {
      for (const [date, exps] of dateMap) {
        const dayTotal = exps.reduce((s,e) => s + this.expenseDisplay(e), 0);
        const groups = this._groupExpenses(exps);
        listHtml += `<div class="date-group">
          <div class="date-group-header">
            <div class="date-group-label">${fmt.dateFull(date)}</div>
            <div class="date-group-total">${fmt.money(dayTotal, this.displayCurrency)}</div>
          </div>
          <div class="date-group-items">
            ${groups.map(g => g.type === 'invoice-group' ? this._buildGroupCard(g) : this._buildExpCard(g)).join('')}
          </div>
        </div>`;
      }
    }

    return `<div class="home-wrap">
      <div class="home-header-bar">
        <div class="month-nav">
          <div class="month-nav-title">${fmt.monthLabel(y, m)}</div>
          <div class="month-nav-btns">
            <button class="today-btn" id="goto-today-btn">今日</button>
            <button class="icon-btn" id="prev-month-btn">‹</button>
            <button class="icon-btn" id="next-month-btn">›</button>
          </div>
        </div>
        <div class="month-stats-row">
          <div class="mstat-card">
            <div class="mstat-label">當月支出</div>
            <div class="mstat-value highlight" style="font-size:14px">${fmt.money(total, this.displayCurrency)}</div>
          </div>
          <div class="mstat-card">
            <div class="mstat-label">筆數</div>
            <div class="mstat-value">${monthly.length}</div>
          </div>
          <div class="mstat-card">
            <div class="mstat-label">待分類</div>
            ${pendingEl}
          </div>
        </div>
      </div>
      <div class="home-expense-list" id="home-list">
        <div class="home-day-btns">
          <button class="btn-day-action btn-import" id="invoice-fetch-btn">🧾 匯入發票</button>
          <button class="btn-day-action btn-add" id="add-expense-btn">＋ 記帳</button>
        </div>
        ${listHtml}
      </div>
    </div>`;
  }

  _groupExpenses(expenses) {
    const result = [], invMap = new Map();
    for (const e of expenses) {
      if (e.source === 'invoice' && e.invoiceNo) {
        if (!invMap.has(e.invoiceNo)) {
          const g = { type:'invoice-group', invoiceNo:e.invoiceNo, store:e.store||'', date:e.date, items:[] };
          invMap.set(e.invoiceNo, g); result.push(g);
        }
        invMap.get(e.invoiceNo).items.push(e);
      } else {
        result.push({ type:'single', ...e });
      }
    }
    return result;
  }

  _buildExpCard(e) {
    const icon = this.store.getExpenseIcon(e);
    const title = e.category2 || e.category1 || (e.status==='pending' ? '待分類' : '未分類');
    const dispAmt = this.expenseDisplay(e);
    const showOrig = (e.currency && e.currency !== this.displayCurrency);
    return `<div class="exp-card" data-id="${e.id}">
      <div class="exp-card-icon">${icon}</div>
      <div class="exp-card-body">
        <div class="exp-card-title">${title}</div>
        <div class="exp-card-meta">
          ${e.status==='pending'?`<span class="exp-tag pending">待分類</span>`:''}
          ${e.category1&&e.status!=='pending'?`<span class="exp-tag">${e.category1}</span>`:''}
          ${e.source==='invoice'?`<span class="exp-tag inv">🧾</span>`:''}
          ${e.store?`<span class="exp-tag">🏪 ${e.store}</span>`:''}
          ${e.description?`<span class="exp-tag" style="color:var(--text3)">${e.description.slice(0,14)}${e.description.length>14?'…':''}</span>`:''}
        </div>
      </div>
      <div class="exp-card-right">
        <div class="exp-card-amount">${fmt.money(dispAmt, this.displayCurrency)}</div>
        ${showOrig?`<div class="exp-card-curr">${fmt.money(e.amount,e.currency)}</div>`:''}
      </div>
    </div>`;
  }

  _buildGroupCard(g) {
    const total = g.items.reduce((s,i) => s + this.expenseDisplay(i), 0);
    const pendingN = g.items.filter(i => i.status==='pending').length;
    return `<div class="exp-card" data-grp="${g.invoiceNo}">
      <div class="exp-card-icon">🧾</div>
      <div class="exp-card-body">
        <div class="exp-card-title">${g.store || '電子發票'}</div>
        <div class="exp-card-meta">
          ${pendingN>0?`<span class="exp-tag pending">待分類 ${pendingN}</span>`:''}
          <span class="exp-tag inv">🧾 ${g.invoiceNo}</span>
        </div>
      </div>
      <div class="exp-card-right">
        <div class="exp-card-amount">${fmt.money(total, this.displayCurrency)}</div>
        <div class="exp-card-count">${g.items.length} 項</div>
      </div>
    </div>`;
  }

  // ─── SEARCH ───────────────────────────────────────────────
  _buildSearch() {
    return `<div class="search-wrap">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input id="search-input" placeholder="搜尋消費項目、店家、分類…" type="search" autocomplete="off" autocorrect="off" autocapitalize="off">
        <button class="search-clear hidden" id="search-clear">✕</button>
      </div>
      <div class="search-results-info" id="search-info">輸入關鍵字以搜尋</div>
      <div id="search-results" class="search-list"></div>
    </div>`;
  }

  // ─── STATS ────────────────────────────────────────────────
  _buildStats() {
    return `<div class="stats-wrap">
      <div class="stats-month-nav">
        <button class="stats-month-btn" id="stats-prev">‹</button>
        <div class="stats-month-display" id="stats-month-label">${this.statsYear} 年 ${this.statsMonth} 月</div>
        <button class="stats-month-btn" id="stats-next">›</button>
        <button class="stats-custom-btn${this.statsCustom?' active':''}" id="stats-custom-btn">自訂</button>
      </div>
      <div class="stats-custom-range${this.statsCustom?' open':''}" id="stats-custom-range">
        <input class="stats-range-input" type="date" id="stats-from" value="${this.statsYear}-${String(this.statsMonth).padStart(2,'0')}-01">
        <span class="stats-range-sep">—</span>
        <input class="stats-range-input" type="date" id="stats-to" value="${fmt.today()}">
        <button class="stats-range-btn" id="stats-range-apply">套用</button>
      </div>
      <div id="stats-content"></div>
    </div>`;
  }

  _renderStats(expenses) {
    const total = expenses.reduce((s,e) => s + this.expenseDisplay(e), 0);
    const catMap = {}, subMap = {}, catExpenses = {};
    expenses.forEach(e => {
      const k1 = e.category1 || '未分類';
      catMap[k1] = (catMap[k1]||0) + this.expenseDisplay(e);
      if (!catExpenses[k1]) catExpenses[k1] = [];
      catExpenses[k1].push(e);
      const k2 = k1 + '||' + (e.category2||'(未分小類)');
      if (!subMap[k2]) subMap[k2] = { amount:0, items:[] };
      subMap[k2].amount += this.expenseDisplay(e);
      subMap[k2].items.push(e);
    });
    const catEntries = Object.entries(catMap).sort((a,b) => b[1]-a[1]);

    const sortedCatEntries = (() => {
      const e = [...catEntries];
      if (this.statsSortMode==='amount-desc') return e.sort((a,b)=>b[1]-a[1]);
      if (this.statsSortMode==='amount-asc')  return e.sort((a,b)=>a[1]-b[1]);
      const latest = n => (catExpenses[n]||[]).reduce((mx,x)=>x.date>mx?x.date:mx,'');
      if (this.statsSortMode==='date-desc') return e.sort((a,b)=>latest(b[0]).localeCompare(latest(a[0])));
      if (this.statsSortMode==='date-asc')  return e.sort((a,b)=>latest(a[0]).localeCompare(latest(b[0])));
      return e.sort((a,b)=>b[1]-a[1]);
    })();

    const el = document.getElementById('stats-content'); if (!el) return;
    el.innerHTML = `
      <div class="stats-total-card">
        <div class="stats-total-label">總支出 (${CURRENCIES[this.displayCurrency]?.name || 'TWD'})</div>
        <div class="stats-total-amt">${fmt.money(total, this.displayCurrency)}</div>
        <div class="stats-total-sub">${expenses.length} 筆記錄</div>
      </div>
      <div class="stats-chart-row">
        <div class="stats-pie-wrap"><canvas id="stats-pie" width="150" height="150"></canvas></div>
        <div class="stats-legend" id="stats-legend">
          ${catEntries.map(([name,amt],i)=>{
            const pct = total>0?((amt/total)*100).toFixed(1):0;
            const icon = this.store.getCatIcon(name);
            return `<div class="stats-legend-item">
              <span class="stats-cat-dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>
              <span style="font-size:13px">${icon}</span>
              <span class="stats-legend-name">${name}</span>
              <span class="stats-legend-pct">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="stats-sort-bar">
        <span class="stats-sort-label">排序：</span>
        <button class="stats-sort-btn${this.statsSortMode==='amount-desc'?' active':''}" data-sort="amount-desc">金額↓</button>
        <button class="stats-sort-btn${this.statsSortMode==='amount-asc'?' active':''}" data-sort="amount-asc">金額↑</button>
        <button class="stats-sort-btn${this.statsSortMode==='date-desc'?' active':''}" data-sort="date-desc">最新↓</button>
        <button class="stats-sort-btn${this.statsSortMode==='date-asc'?' active':''}" data-sort="date-asc">最舊↓</button>
      </div>
      <div class="stats-cat-list">
        ${sortedCatEntries.length ? sortedCatEntries.map(([name,amt])=>{
          const i = catEntries.findIndex(([n])=>n===name);
          const pct = total>0?((amt/total)*100).toFixed(1):0;
          const color = CHART_COLORS[i%CHART_COLORS.length];
          const icon = this.store.getCatIcon(name);
          const subs = Object.entries(subMap).filter(([k])=>k.startsWith(name+'||')).sort((a,b)=>b[1].amount-a[1].amount);
          return `<div class="stats-cat-item" data-cat="${name}">
            <div class="stats-cat-header">
              <span class="stats-cat-icon">${icon}</span>
              <span class="stats-cat-name">${name}</span>
              <div class="stats-cat-bar-wrap"><div class="stats-cat-bar" style="width:${pct}%;background:${color}"></div></div>
              <span class="stats-cat-pct">${pct}%</span>
              <span class="stats-cat-amt">${fmt.money(amt, this.displayCurrency)}</span>
              <span class="stats-cat-toggle">▼</span>
            </div>
            <div class="stats-cat-sub-list${this._statsOpenCats.has(name)?' open':''}" id="scat-${name.replace(/\s/g,'_')}">
              ${subs.map(([k,sd])=>{
                const subName = k.split('||')[1];
                const sp = total>0?((sd.amount/total)*100).toFixed(1):0;
                const sIcon = this.store.getSubIcon(name, subName);
                const sortedItems = [...sd.items].sort((a,b)=>this.expenseDisplay(b)-this.expenseDisplay(a));
                return `<div class="stats-sub-cat-header">
                  <span class="stats-sub-cat-icon">${sIcon}</span>
                  <span class="stats-sub-cat-label">${subName}</span>
                  <span class="stats-sub-cat-pct">${sp}%</span>
                  <span class="stats-sub-cat-amt">${fmt.money(sd.amount, this.displayCurrency)}</span>
                </div>
                ${sortedItems.map(it=>`<div class="stats-expense-row" data-id="${it.id}">
                  <span class="stats-expense-date">${fmt.dateShort(it.date)}</span>
                  <span class="stats-expense-desc">${it.description||'(未命名)'}</span>
                  ${it.store?`<span class="stats-expense-store">${it.store}</span>`:''}
                  <span class="stats-expense-amt">${fmt.money(this.expenseDisplay(it), this.displayCurrency)}</span>
                </div>`).join('')}`;
              }).join('')}
            </div>
          </div>`;
        }).join('') : `<div class="empty-state"><div class="icon">📊</div><p>此期間無記錄</p></div>`}
      </div>`;

    requestAnimationFrame(() => this._drawPie(catEntries, total));
  }

  _drawPie(catEntries, total) {
    const canvas = document.getElementById('stats-pie'); if (!canvas || !catEntries.length) return;
    const ctx = canvas.getContext('2d');
    const cx=75, cy=75, outerR=68, innerR=40;
    const pieBg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#181825';
    const pieText = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#eeeef8';
    ctx.clearRect(0,0,150,150); let angle = -Math.PI/2;
    catEntries.forEach(([,amt],i) => {
      const slice = total>0?(amt/total)*Math.PI*2:0;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,outerR,angle,angle+slice); ctx.closePath();
      ctx.fillStyle = CHART_COLORS[i%CHART_COLORS.length]; ctx.fill();
      ctx.strokeStyle = pieBg; ctx.lineWidth = 1.5; ctx.stroke();
      angle += slice;
    });
    ctx.beginPath(); ctx.arc(cx,cy,innerR,0,Math.PI*2); ctx.fillStyle=pieBg; ctx.fill();
    ctx.fillStyle=pieText; ctx.textAlign='center'; ctx.font='bold 10px DM Mono,monospace';
    ctx.fillText(fmt.money(total, this.displayCurrency).slice(0,10), cx, cy+4);
  }

  // ─── SETTINGS ─────────────────────────────────────────────
  _buildSettings() {
    const s = this.store.data.settings;
    const lastSync = this.store.data.lastSync;
    const storeMap = this.store.data.storeMapping || [];
    const catCount = this.store.data.categories.length;
    const currName = CURRENCIES[s.preferredCurrency]?.name || '台幣';
    const isOnline = !!s.googleEmail;
    const statusDot = `<span class="drive-status-dot${isOnline?' online':''}"></span>`;

    return `<div class="settings-wrap">

      <!-- Drive Section -->
      <div class="settings-section">
        <div class="settings-section-title">☁️ 雲端備份</div>
        <div class="settings-card">
          <div class="drive-status-wrap">
            ${isOnline ? `
              <div class="drive-account-row">${statusDot}<span class="drive-account-email">${s.googleEmail}</span></div>
              <div class="drive-sync-time">上次同步：${lastSync || '（尚未同步）'}</div>
              <div class="drive-btn-row">
                <button class="drive-btn primary" id="drive-upload-btn">☁ 上傳到雲端</button>
                <button class="drive-btn secondary" id="drive-download-btn">⬇ 從雲端下載</button>
              </div>
              <label class="drive-auto-sync">
                <input type="checkbox" id="drive-auto-sync" ${s.autoSync?'checked':''}>
                <span>每次開啟 APP 自動同步</span>
              </label>
              <div style="padding:8px 0 2px;display:flex;gap:8px">
                <button class="btn-secondary" id="drive-logout-btn" style="font-size:11px;padding:6px 10px;flex:1">登出帳號</button>
              </div>
            ` : `
              <div class="drive-account-row">${statusDot}<span class="drive-account-email" style="color:var(--text3)">尚未登入 Google 帳號</span></div>
              <div style="padding:8px 0">
                <div class="form-group" style="margin-bottom:8px">
                  <label class="form-label">Google OAuth Client ID</label>
                  <input class="form-input" id="s-gClientId" placeholder="xxxx.apps.googleusercontent.com" value="${s.googleClientId||''}">
                </div>
                <button class="btn-primary" id="drive-login-btn" style="width:100%;font-size:13px">🔐 登入 Google 帳號</button>
              </div>
            `}
          </div>
        </div>
      </div>

      <!-- Preferences -->
      <div class="settings-section">
        <div class="settings-section-title">個人偏好</div>
        <div class="settings-card">
          <div class="settings-row" id="open-currency-btn">
            <div class="settings-row-icon">💱</div>
            <div class="settings-row-body">
              <div class="settings-row-label">幣別設定</div>
              <div class="settings-row-sub">記帳與顯示幣別</div>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge green">${currName}</span>
              <span class="settings-arrow">›</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Data Management -->
      <div class="settings-section">
        <div class="settings-section-title">資料管理</div>
        <div class="settings-card">
          <div class="settings-row" id="open-category-btn">
            <div class="settings-row-icon">📂</div>
            <div class="settings-row-body">
              <div class="settings-row-label">分類設定</div>
              <div class="settings-row-sub">管理大小分類與 Icon</div>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge">${catCount} 個</span>
              <span class="settings-arrow">›</span>
            </div>
          </div>
          <div class="settings-row" id="open-store-mapping-btn">
            <div class="settings-row-icon">🏪</div>
            <div class="settings-row-body">
              <div class="settings-row-label">店家自動分類</div>
              <div class="settings-row-sub">匯入發票時自動套用分類</div>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge">${storeMap.length} 條</span>
              <span class="settings-arrow">›</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AI -->
      <div class="settings-section">
        <div class="settings-section-title">🤖 Gemini AI</div>
        <div class="settings-card">
          <div class="settings-row" id="open-gemini-btn">
            <div class="settings-row-icon">✨</div>
            <div class="settings-row-body">
              <div class="settings-row-label">Gemini API Key</div>
              <div class="settings-row-sub">${s.geminiApiKey ? '已設定' : '尚未設定'}</div>
            </div>
            <div class="settings-row-right">
              ${s.geminiApiKey ? `<span class="settings-badge green">已啟用</span>` : ''}
              <span class="settings-arrow">›</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Local Backup -->
      <div class="settings-section">
        <div class="settings-section-title">💾 本機備份</div>
        <div class="settings-card">
          <div class="settings-row" id="import-csv-btn">
            <div class="settings-row-icon">📄</div>
            <div class="settings-row-body">
              <div class="settings-row-label">匯入外部 CSV</div>
              <div class="settings-row-sub">從其他記帳程式匯入</div>
            </div>
            <span class="settings-arrow">›</span>
          </div>
          <div class="settings-row" id="export-local-btn">
            <div class="settings-row-icon">📤</div>
            <div class="settings-row-body">
              <div class="settings-row-label">匯出 JSON 備份</div>
              <div class="settings-row-sub">下載完整備份檔案</div>
            </div>
            <span class="settings-arrow">›</span>
          </div>
          <div class="settings-row" id="import-local-btn">
            <div class="settings-row-icon">📥</div>
            <div class="settings-row-body">
              <div class="settings-row-label">匯入 JSON 備份</div>
              <div class="settings-row-sub">從備份檔案還原資料</div>
            </div>
            <span class="settings-arrow">›</span>
          </div>
        </div>
      </div>

      <!-- Danger -->
      <div class="settings-section">
        <div class="settings-section-title">危險操作</div>
        <div class="settings-card">
          <div class="settings-row" id="clear-data-btn" style="color:var(--red)">
            <div class="settings-row-icon">⚠️</div>
            <div class="settings-row-body">
              <div class="settings-row-label" style="color:var(--red)">清除所有資料</div>
              <div class="settings-row-sub">無法復原，請先備份</div>
            </div>
            <span class="settings-arrow">›</span>
          </div>
        </div>
      </div>

      <div style="padding:16px;text-align:center;color:var(--text3);font-size:10px;font-family:var(--font-mono)">
        ${APP_VERSION} · Cost Record PWA
      </div>
    </div>`;
  }

  // ─── VIEW EVENTS ──────────────────────────────────────────
  _attachViewEvents() {
    switch(this.view) {
      case 'home':     this._attachHomeEvents();     break;
      case 'search':   this._attachSearchEvents();   break;
      case 'stats':    this._attachStatsEvents();    break;
      case 'settings': this._attachSettingsEvents(); break;
    }
  }

  _attachHomeEvents() {
    document.getElementById('prev-month-btn')?.addEventListener('click', () => this._changeMonth(-1));
    document.getElementById('next-month-btn')?.addEventListener('click', () => this._changeMonth(1));
    document.getElementById('goto-today-btn')?.addEventListener('click', () => {
      const n = new Date(); this.calYear = n.getFullYear(); this.calMonth = n.getMonth()+1; this.renderView();
    });
    document.getElementById('pending-badge')?.addEventListener('click', () => this._openPendingModal());
    document.getElementById('add-expense-btn')?.addEventListener('click', () => this.openExpenseModal(null));
    document.getElementById('invoice-fetch-btn')?.addEventListener('click', () => this.openInvoiceImportModal());
    document.getElementById('home-list')?.addEventListener('click', e => {
      const card = e.target.closest('.exp-card');
      if (!card) return;
      if (card.dataset.id) this.openExpenseModal(card.dataset.id);
      else if (card.dataset.grp) this._openInvoiceGroupSheet(card.dataset.grp);
    });
    // Swipe left/right on home to change month
    this._attachSwipe(document.getElementById('home-list'), delta => this._changeMonth(delta));
  }

  _changeMonth(delta) {
    this.calMonth += delta;
    if (this.calMonth < 1) { this.calMonth = 12; this.calYear--; }
    if (this.calMonth > 12) { this.calMonth = 1; this.calYear++; }
    this.renderView();
  }

  _attachSwipe(el, cb) {
    if (!el) return;
    let sx = null, sy = null;
    el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive:true});
    el.addEventListener('touchend', e => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) cb(dx < 0 ? 1 : -1);
      sx = null; sy = null;
    }, {passive:true});
  }

  _attachSearchEvents() {
    const input = document.getElementById('search-input');
    const clear = document.getElementById('search-clear');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer); clear?.classList.toggle('hidden', !input.value);
      timer = setTimeout(() => this._doSearch(input.value), 200);
    });
    clear?.addEventListener('click', () => {
      input.value = ''; clear.classList.add('hidden');
      document.getElementById('search-info').textContent = '輸入關鍵字以搜尋';
      document.getElementById('search-results').innerHTML = '';
    });
    document.getElementById('search-results')?.addEventListener('click', ev => {
      const card = ev.target.closest('[data-id]'); if (card) this.openExpenseModal(card.dataset.id);
    });
  }

  _doSearch(kw) {
    const results = this.store.search(kw);
    const info = document.getElementById('search-info');
    const list = document.getElementById('search-results');
    if (!info || !list) return;
    if (!kw.trim()) { info.textContent='輸入關鍵字以搜尋'; list.innerHTML=''; return; }
    info.textContent = `找到 ${results.length} 筆記錄`;
    list.innerHTML = results.length ? results.map(e => this._buildExpCard({type:'single',...e})).join('') : `<div class="empty-state"><div class="icon">🔎</div><p>找不到符合的記錄</p></div>`;
  }

  _attachStatsEvents() {
    this._renderStats(this.store.getByMonth(this.statsYear, this.statsMonth));
    document.getElementById('stats-prev')?.addEventListener('click', () => {
      this.statsMonth--; if (this.statsMonth<1){this.statsMonth=12;this.statsYear--;}
      this.statsCustom=false;
      document.getElementById('stats-month-label').textContent=`${this.statsYear} 年 ${this.statsMonth} 月`;
      document.getElementById('stats-custom-range')?.classList.remove('open');
      this._renderStats(this.store.getByMonth(this.statsYear, this.statsMonth));
    });
    document.getElementById('stats-next')?.addEventListener('click', () => {
      this.statsMonth++; if (this.statsMonth>12){this.statsMonth=1;this.statsYear++;}
      this.statsCustom=false;
      document.getElementById('stats-month-label').textContent=`${this.statsYear} 年 ${this.statsMonth} 月`;
      document.getElementById('stats-custom-range')?.classList.remove('open');
      this._renderStats(this.store.getByMonth(this.statsYear, this.statsMonth));
    });
    document.getElementById('stats-custom-btn')?.addEventListener('click', () => {
      this.statsCustom = !this.statsCustom;
      document.getElementById('stats-custom-range')?.classList.toggle('open', this.statsCustom);
      document.getElementById('stats-custom-btn')?.classList.toggle('active', this.statsCustom);
    });
    document.getElementById('stats-range-apply')?.addEventListener('click', () => {
      const from = document.getElementById('stats-from')?.value;
      const to = document.getElementById('stats-to')?.value;
      if (!from||!to) { this.toast('請選擇日期','error'); return; }
      this._renderStats(this.store.data.expenses.filter(e => e.date>=from && e.date<=to));
      document.getElementById('stats-month-label').textContent = `${from} ~ ${to}`;
    });
    document.getElementById('stats-content')?.addEventListener('click', e => {
      const sort = e.target.closest('.stats-sort-btn');
      if (sort) {
        this._statsOpenCats = new Set();
        document.querySelectorAll('.stats-cat-sub-list.open').forEach(el => {
          const ci = el.closest('.stats-cat-item'); if (ci?.dataset.cat) this._statsOpenCats.add(ci.dataset.cat);
        });
        this.statsSortMode = sort.dataset.sort;
        const exps = this.statsCustom
          ? this.store.data.expenses.filter(ex => { const f=document.getElementById('stats-from')?.value; const t=document.getElementById('stats-to')?.value; return ex.date>=f&&ex.date<=t; })
          : this.store.getByMonth(this.statsYear, this.statsMonth);
        this._renderStats(exps);
        this._statsOpenCats.forEach(cat => {
          const sub = document.getElementById('scat-'+cat.replace(/\s/g,'_'));
          const hdr = sub?.closest('.stats-cat-item')?.querySelector('.stats-cat-toggle');
          if (sub) { sub.classList.add('open'); hdr?.classList.add('open'); }
        });
        return;
      }
      const catHdr = e.target.closest('.stats-cat-header');
      if (catHdr) {
        const ci = catHdr.closest('.stats-cat-item'); const cn = ci?.dataset.cat; if (!cn) return;
        const sub = document.getElementById('scat-'+cn.replace(/\s/g,'_'));
        const tog = catHdr.querySelector('.stats-cat-toggle');
        if (sub) { const open=sub.classList.toggle('open'); tog?.classList.toggle('open',open); }
        return;
      }
      const row = e.target.closest('.stats-expense-row[data-id]');
      if (row) this.openExpenseModal(row.dataset.id);
    });
  }

  _attachSettingsEvents() {
    document.getElementById('open-currency-btn')?.addEventListener('click', () => this._openCurrencyModal());
    document.getElementById('open-category-btn')?.addEventListener('click', () => this._openCategoryPage());
    document.getElementById('open-store-mapping-btn')?.addEventListener('click', () => this._openStoreMappingPage());
    document.getElementById('open-gemini-btn')?.addEventListener('click', () => this._openGeminiSettings());
    document.getElementById('import-csv-btn')?.addEventListener('click', () => document.getElementById('import-csv-input')?.click());
    document.getElementById('export-local-btn')?.addEventListener('click', () => this._exportJson());
    document.getElementById('import-local-btn')?.addEventListener('click', () => document.getElementById('import-json-input')?.click());
    document.getElementById('clear-data-btn')?.addEventListener('click', () => {
      if (!confirm('確定清除所有資料？無法復原！')) return;
      if (!confirm('再次確認：永久清除全部記帳資料')) return;
      localStorage.removeItem(STORAGE_KEY); this.store.data = this.store._default();
      this.toast('已清除所有資料','info'); this.renderView();
    });
    // Drive
    document.getElementById('drive-login-btn')?.addEventListener('click', () => this._driveLogin());
    document.getElementById('drive-upload-btn')?.addEventListener('click', () => this._driveUpload());
    document.getElementById('drive-download-btn')?.addEventListener('click', () => this._driveShowVersions());
    document.getElementById('drive-logout-btn')?.addEventListener('click', () => this._driveLogout());
    document.getElementById('drive-auto-sync')?.addEventListener('change', e => {
      this.store.data.settings.autoSync = e.target.checked; this.store.save();
    });
    document.getElementById('s-gClientId')?.addEventListener('blur', e => {
      this.store.data.settings.googleClientId = e.target.value.trim(); this.store.save();
    });
  }

  // ─── CURRENCY MODAL ───────────────────────────────────────
  _openCurrencyModal() {
    const curr = this.displayCurrency;
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">選擇幣別</div>
        <div style="width:32px"></div>
      </div>
      <div class="modal-body" style="padding:8px 0">
        <div style="padding:6px 14px 10px;font-size:11px;color:var(--text3);line-height:1.6">
          💡 切換幣別後，所有金額將依記錄當時的匯率換算顯示。<br>
          匯率資料來源：open.er-api.com（不需要 AI API Key）
        </div>
        <div class="currency-list">
          ${Object.values(CURRENCIES).map(c => `
            <div class="currency-item${c.code===curr?' selected':''}" data-code="${c.code}">
              <div class="currency-symbol">${c.symbol}</div>
              <div class="currency-name">
                <div class="currency-name-main">${c.name}</div>
                <div class="currency-name-code">${c.code}</div>
              </div>
              ${c.code===curr?'<div class="currency-check">✓</div>':''}
            </div>`).join('')}
        </div>
      </div>`;
    this._openModal(html, false, () => {
      document.querySelectorAll('.currency-item').forEach(item => {
        item.addEventListener('click', async () => {
          const code = item.dataset.code;
          this.store.data.settings.preferredCurrency = code; this.store.save();
          this._updateCurrBadge();
          // Fetch fresh rates
          await this.fx.getRates(true);
          this.toast(`幣別切換為 ${CURRENCIES[code]?.name}`, 'success');
          this.closeModal(() => this.renderView());
        });
      });
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    });
  }

  // ─── CATEGORY MANAGEMENT PAGE ─────────────────────────────
  _openCategoryPage() {
    const cats = this.store.data.categories;
    const catsHtml = cats.map((cat, ci) => `
      <div class="cat-parent-card" id="cpc-${ci}">
        <div class="cat-parent-header" data-ci="${ci}">
          <div class="cat-parent-icon cat-icon-click" data-ci="${ci}" title="點擊更換 Icon">${cat.icon || '📋'}</div>
          <div class="cat-parent-name">${cat.name}</div>
          <div class="cat-parent-actions">
            <button class="cat-expand-btn" data-ci="${ci}">›</button>
            <button class="cat-action-btn" data-action="rename-cat" data-ci="${ci}">改名</button>
            <button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button>
          </div>
        </div>
        <div class="cat-subs-wrap" id="subs-${ci}">
          ${(cat.subs||[]).map((sub, si) => `
            <div class="cat-sub-row" data-ci="${ci}" data-si="${si}">
              <span class="cat-sub-icon sub-icon-click" data-ci="${ci}" data-si="${si}" title="點擊更換 Icon">${sub.icon || '💰'}</span>
              <span class="cat-sub-name">${sub.name}</span>
              <div class="cat-sub-actions">
                <button class="cat-action-btn" data-action="rename-sub" data-ci="${ci}" data-si="${si}">改名</button>
                <button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button>
              </div>
            </div>`).join('')}
          <div class="cat-add-sub-row">
            <input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類名稱…">
            <button class="btn-add-small" data-action="add-sub" data-ci="${ci}">新增</button>
          </div>
        </div>
      </div>`).join('');

    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">分類設定</div>
        <button class="modal-topbar-btn confirm" id="add-parent-cat-btn" style="font-size:18px">＋</button>
      </div>
      <div class="modal-body" style="padding:10px 12px;gap:8px">
        ${catsHtml}
        ${cats.length===0?'<div class="empty-state"><div class="icon">📂</div><p>尚無分類，點右上方 ＋ 新增</p></div>':''}
      </div>`;

    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal(() => this.renderView()));
      document.getElementById('add-parent-cat-btn')?.addEventListener('click', () => {
        const n = prompt('新大分類名稱'); if (!n?.trim()) return;
        const id = 'cat_' + Date.now();
        this.store.data.categories.push({ id, name:n.trim(), icon:'📋', subs:[] });
        this.store.save(); this.closeModal(() => this._openCategoryPage());
      });
      // Expand toggles
      document.querySelectorAll('.cat-expand-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const ci = btn.dataset.ci;
          const sw = document.getElementById(`subs-${ci}`);
          const open = sw.classList.toggle('open');
          btn.classList.toggle('open', open);
        });
      });
      // Cat/Sub icon click
      document.querySelectorAll('.cat-icon-click').forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); this._openIconPicker(+el.dataset.ci, null, el.textContent); });
      });
      document.querySelectorAll('.sub-icon-click').forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); this._openIconPicker(+el.dataset.ci, +el.dataset.si, el.textContent); });
      });
      // Actions
      document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this._handleCatAction(btn.dataset.action, +btn.dataset.ci, btn.dataset.si!==undefined ? +btn.dataset.si : null);
        });
      });
    });
  }

  _openIconPicker(ci, si, current) {
    const isCategory = si === null;
    const title = isCategory ? `選擇大分類 Icon` : `選擇小分類 Icon`;
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="ip-back-btn">‹</button>
        <div class="modal-topbar-title">${title}</div>
        <div style="width:32px"></div>
      </div>
      <div class="modal-body">
        <div class="icon-picker-grid" id="icon-picker-grid">
          ${ICON_LIBRARY.map(icon => `<div class="icon-picker-item${icon===current?' selected':''}" data-icon="${icon}">${icon}</div>`).join('')}
        </div>
      </div>`;
    this._openModal(html, false, () => {
      document.getElementById('ip-back-btn')?.addEventListener('click', () => { this.closeModal(() => this._openCategoryPage()); });
      document.querySelectorAll('.icon-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          const icon = item.dataset.icon;
          if (isCategory) {
            this.store.data.categories[ci].icon = icon;
          } else {
            this.store.data.categories[ci].subs[si].icon = icon;
          }
          this.store.save();
          this.toast('已更新 Icon','success');
          this.closeModal(() => this._openCategoryPage());
        });
      });
    });
  }

  _handleCatAction(action, ci, si) {
    const cats = this.store.data.categories;
    if (action === 'rename-cat') {
      const n = prompt('修改大分類名稱', cats[ci].name); if (!n?.trim()) return;
      cats[ci].name = n.trim(); this.store.save(); this.closeModal(() => this._openCategoryPage()); this.toast('已更新','success');
    } else if (action === 'del-cat') {
      if (!confirm(`刪除「${cats[ci].name}」及其所有小分類？`)) return;
      cats.splice(ci, 1); this.store.save(); this.closeModal(() => this._openCategoryPage()); this.toast('已刪除','success');
    } else if (action === 'add-sub') {
      const inp = document.getElementById(`sub-input-${ci}`); const n = inp?.value.trim(); if (!n) { this.toast('請輸入名稱','error'); return; }
      const id = 'sub_' + Date.now();
      cats[ci].subs.push({ id, name: n, icon: BUILTIN_ICONS[n] || '💰' });
      this.store.save(); this.closeModal(() => this._openCategoryPage()); this.toast('已新增','success');
    } else if (action === 'rename-sub') {
      const n = prompt('修改小分類名稱', cats[ci].subs[si].name); if (!n?.trim()) return;
      cats[ci].subs[si].name = n.trim(); this.store.save(); this.closeModal(() => this._openCategoryPage()); this.toast('已更新','success');
    } else if (action === 'del-sub') {
      if (!confirm(`刪除「${cats[ci].subs[si].name}」？`)) return;
      cats[ci].subs.splice(si, 1); this.store.save(); this.closeModal(() => this._openCategoryPage()); this.toast('已刪除','success');
    }
  }

  // ─── GOOGLE DRIVE ─────────────────────────────────────────
  async _driveLogin() {
    const clientId = document.getElementById('s-gClientId')?.value.trim();
    if (!clientId) { this.toast('請先填入 OAuth Client ID','error'); return; }
    this.store.data.settings.googleClientId = clientId; this.store.save();
    try {
      this.toast('正在登入…','info');
      await this.drive.init(clientId);
      const email = await this.drive.getUserEmail();
      this.store.data.settings.googleEmail = email; this.store.save();
      this.toast(`已登入：${email}`,'success'); this.renderView();
    } catch(e) { this.toast('登入失敗：' + e.message,'error'); }
  }

  async _driveUpload() {
    try {
      this.toast('上傳中…','info');
      await this.drive.uploadBackup(this.store.export());
      this.store.data.lastSync = fmt.time(); this.store.save();
      this.toast('✅ 已上傳到 Google Drive','success'); this.renderView();
    } catch(e) { this.toast('上傳失敗：' + e.message,'error'); }
  }

  async _driveShowVersions() {
    try {
      this.toast('載入備份清單…','info');
      const files = await this.drive.listBackups();
      if (!files.length) { this.toast('尚無備份檔案','info'); return; }

      const itemsHtml = files.map((f, idx) => {
        let meta = '';
        try { const d = JSON.parse(f.description||'{}'); meta = `記錄 ${d.expenseCount||0} 筆・分類 ${d.categoryCount||0} 個`; }
        catch(e) { meta = `${Math.round((f.size||0)/1024)} KB`; }
        const dt = new Date(f.modifiedTime);
        const dstr = `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()} ${dt.getHours()>=12?'下午':'上午'}${dt.getHours()%12||12}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
        return `<div class="backup-ver-item${idx===0?' latest':''}" data-fid="${f.id}">
          <div class="backup-ver-date">${dstr}${idx===0?'<span class="backup-ver-badge">最新</span>':''}</div>
          <div class="backup-ver-meta">${meta}</div>
        </div>`;
      }).join('');

      const html = `
        <div class="modal-topbar">
          <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
          <div class="modal-topbar-title">選擇備份版本</div>
          <div style="width:32px"></div>
        </div>
        <div class="modal-body" style="padding:6px 0">
          <div style="padding:6px 14px 10px;font-size:11px;color:var(--text3)">
            最多保留 5 份備份，每次上傳自動建立新版本。
          </div>
          <div class="backup-ver-list">${itemsHtml}</div>
        </div>`;

      this._openModal(html, false, () => {
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
        document.querySelectorAll('.backup-ver-item').forEach(item => {
          item.addEventListener('click', async () => {
            if (!confirm('確定要從此備份還原？目前資料將被覆蓋。')) return;
            try {
              this.toast('下載中…','info');
              const data = await this.drive.downloadBackup(item.dataset.fid);
              this.store.import(data); this.store.data.lastSync = fmt.time(); this.store.save();
              this.toast('✅ 已還原備份','success');
              this.closeModal(() => this.renderView());
            } catch(e) { this.toast('下載失敗：' + e.message,'error'); }
          });
        });
      });
    } catch(e) { this.toast('載入失敗：' + e.message,'error'); }
  }

  _driveLogout() {
    if (!confirm('確定登出 Google 帳號？')) return;
    this.drive.revoke();
    this.store.data.settings.googleEmail = ''; this.store.save();
    this.toast('已登出','info'); this.renderView();
  }

  // ─── GEMINI SETTINGS ──────────────────────────────────────
  _openGeminiSettings() {
    const s = this.store.data.settings;
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">Gemini AI 設定</div>
        <button class="modal-topbar-btn confirm" id="save-gemini-btn">✓</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Gemini API Key</label>
          <div class="api-key-wrap">
            <input class="form-input" id="s-geminiKey" type="password" placeholder="AIzaSy…" value="${s.geminiApiKey||''}">
            <button class="api-key-toggle" data-target="s-geminiKey">👁</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">模型</label>
          <select class="form-select" id="s-geminiModel">
            ${GEMINI_MODELS.map(m=>`<option value="${m}"${s.geminiModel===m?' selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:11px;color:var(--text3);line-height:1.6;background:var(--bg3);border-radius:var(--radius-sm);padding:10px">
          AI 功能目前用於電子發票智慧分類建議。<br>多幣別匯率換算不需要 AI，使用公開匯率 API 即可。
        </div>
      </div>`;
    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
      document.getElementById('save-gemini-btn')?.addEventListener('click', () => {
        s.geminiApiKey = document.getElementById('s-geminiKey').value.trim();
        s.geminiModel = document.getElementById('s-geminiModel').value;
        this.store.save(); this.toast('已儲存','success'); this.closeModal(() => this.renderView());
      });
      document.querySelectorAll('.api-key-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = document.getElementById(btn.dataset.target); if (!inp) return;
          inp.type = inp.type==='password'?'text':'password'; btn.textContent = inp.type==='password'?'👁':'🙈';
        });
      });
    });
  }

  // ─── STORE MAPPING ────────────────────────────────────────
  _openStoreMappingPage() {
    const rules = this.store.data.storeMapping || [];
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">店家自動分類</div>
        <button class="modal-topbar-btn confirm" id="sm-add-btn">＋</button>
      </div>
      <div style="flex:1;overflow-y:auto;min-height:0">
        ${rules.length ? rules.map((r,idx) => `
          <div class="sm-rule-row">
            <div class="sm-rule-store">${r.store}</div>
            <div class="sm-rule-cats">${r.cat1}${r.cat2?' › '+r.cat2:''}</div>
            <div class="sm-rule-actions">
              <button class="sm-rule-btn edit" data-ridx="${idx}">✏️</button>
              <button class="sm-rule-btn del" data-ridx="${idx}">🗑</button>
            </div>
          </div>`).join('')
          : `<div class="empty-state"><div class="icon">🏪</div><p>尚無規則，點右上角 ＋ 新增</p></div>`}
      </div>`;
    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal(() => this.renderView()));
      document.getElementById('sm-add-btn')?.addEventListener('click', () => { this.closeModal(() => setTimeout(() => this._openStoreMappingModal(null), 300)); });
      document.querySelectorAll('.sm-rule-btn.edit').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); this.closeModal(() => setTimeout(() => this._openStoreMappingModal(+btn.dataset.ridx), 300)); });
      });
      document.querySelectorAll('.sm-rule-btn.del').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation(); const idx = +btn.dataset.ridx;
          if (!confirm(`刪除「${rules[idx]?.store}」規則？`)) return;
          this.store.data.storeMapping.splice(idx, 1); this.store.save(); this.toast('已刪除','success');
          this.closeModal(() => this._openStoreMappingPage());
        });
      });
    });
  }

  _openStoreMappingModal(existingIdx) {
    const cats = this.store.data.categories;
    const catOpts = cats.map(c => `<option value="${c.name}">${c.icon||''} ${c.name}</option>`).join('');
    const existing = existingIdx !== null ? this.store.data.storeMapping[existingIdx] : null;
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">店家分類規則</div>
        <button class="modal-topbar-btn confirm" id="sm-save-btn">✓</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">店家名稱（關鍵字）</label>
          <input class="form-input" id="sm-store" placeholder="例如：全聯、麥當勞" value="${existing?.store||''}">
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">大分類</label>
            <select class="form-select" id="sm-cat1"><option value="">-- 選擇 --</option>${catOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">小分類</label>
            <select class="form-select" id="sm-cat2" disabled><option value="">-- 選擇 --</option></select>
          </div>
        </div>
      </div>`;
    this._openModal(html, false, () => {
      const sel1 = document.getElementById('sm-cat1'), sel2 = document.getElementById('sm-cat2');
      if (existing) { sel1.value=existing.cat1; this._populateSel2(sel1.value, sel2, existing.cat2); }
      sel1.addEventListener('change', () => this._populateSel2(sel1.value, sel2, ''));
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal(() => this._openStoreMappingPage()));
      document.getElementById('sm-save-btn')?.addEventListener('click', () => {
        const store = document.getElementById('sm-store').value.trim();
        const cat1 = sel1.value, cat2 = sel2.value;
        if (!store||!cat1) { this.toast('請填寫店家名稱與大分類','error'); return; }
        const rule = {store,cat1,cat2};
        if (!this.store.data.storeMapping) this.store.data.storeMapping=[];
        if (existingIdx !== null) this.store.data.storeMapping[existingIdx] = rule;
        else this.store.data.storeMapping.push(rule);
        this.store.save(); this.toast('已儲存','success'); this.closeModal(() => this._openStoreMappingPage());
      });
    });
  }

  _populateSel2(cat1, sel2, selected) {
    const subs = this.store.data.categories.find(c => c.name===cat1)?.subs || [];
    sel2.innerHTML = '<option value="">-- 選擇 --</option>' + subs.map(s=>`<option value="${s.name}"${s.name===selected?' selected':''}>${s.icon||''} ${s.name}</option>`).join('');
    sel2.disabled = !subs.length;
  }

  // ─── EXPENSE MODAL ────────────────────────────────────────
  async openExpenseModal(id) {
    const expense = id ? this.store.data.expenses.find(e => e.id===id) : null;
    this._editId = id || null;
    const cats = this.store.data.categories;
    const isEdit = !!expense;
    const today = fmt.today();
    const defaultCurr = this.displayCurrency;
    const e = expense || { date:today, description:'', store:'', amount:'', category1:'', category2:'', status:'categorized', source:'manual', currency:defaultCurr };

    // Fetch rates if not in cache
    const rates = await this.fx.getRates();

    const cat1Html = cats.map(cat => `
      <button class="edit-cat-btn${e.category1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${cat.icon||'📋'}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');

    const selCat = cats.find(c => c.name===e.category1);
    const cat2Html = selCat ? selCat.subs.map(sub => `
      <button class="edit-cat-btn${e.category2===sub.name?' selected':''}" data-cat1="${selCat.name}" data-cat2="${sub.name}">
        <div class="edit-cat-circle">${sub.icon||'💰'}</div>
        <div class="edit-cat-label">${sub.name}</div>
      </button>`).join('') : '';

    const expCurr = e.currency || defaultCurr;
    const currOpts = Object.values(CURRENCIES).map(c => `<option value="${c.code}"${c.code===expCurr?' selected':''}>${c.symbol} ${c.code}</option>`).join('');

    const invItems = isEdit && e.invoiceNo ? this.store.data.expenses.filter(ex=>ex.invoiceNo===e.invoiceNo) : [];
    const invHtml = invItems.length > 1 ? `<div class="inv-items-section">
      <div class="inv-items-section-title">同張發票・${e.invoiceNo}</div>
      ${invItems.map(it => `<div class="inv-item-row${it.id===e.id?' inv-item-current':''}" ${it.id!==e.id?`data-inv-id="${it.id}"`:''}">
        <span class="inv-item-name">${it.description||'(未命名)'}</span>
        <span class="inv-item-amt">${fmt.money(it.amount,it.currency||'TWD')}</span>
        ${it.id===e.id?'<span class="inv-item-current-badge">本筆</span>':`<span class="inv-item-cat${it.status==='pending'?' pending':''}">${it.status==='pending'?'待分類':(it.category1||'未分類')}</span>`}
      </div>`).join('')}
    </div>` : '';

    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">${isEdit?'編輯消費':'新增消費'}</div>
        <button class="modal-topbar-btn confirm" id="modal-save-btn">✓</button>
      </div>
      <div class="modal-body">
        <!-- Category selection -->
        <div class="cat-level-wrap">
          <div class="cat-level-label">大分類</div>
          <div class="edit-category-row" id="cat1-row">${cat1Html}</div>
          <div class="cat-sub-area${selCat?'':' hidden'}" id="cat2-area">
            <div class="cat-level-label" style="padding:6px 8px 2px">小分類</div>
            <div class="edit-category-row" id="cat2-row">${cat2Html}</div>
          </div>
        </div>
        <!-- Amount + Currency -->
        <div class="edit-amount-display">
          <select class="edit-amount-currency-sel" id="f-currency">${currOpts}</select>
          <input class="edit-amount-input" type="number" id="f-amount" placeholder="0" value="${e.amount||''}" inputmode="decimal" min="0">
        </div>
        <div class="edit-rate-note" id="rate-note"></div>
        <!-- Fields -->
        <div class="edit-field-grid">
          <div class="edit-field"><div class="edit-field-label">日期</div>
            <input class="edit-field-value" type="date" id="f-date" value="${e.date||today}"></div>
          <div class="edit-field"><div class="edit-field-label">消費店家</div>
            <input class="edit-field-value" id="f-store" placeholder="店家名稱" value="${e.store||''}"></div>
          ${isEdit&&e.invoiceNo?`<div class="edit-field edit-field-full"><div class="edit-field-label">發票號碼</div><div class="edit-field-value" style="color:var(--text3)">${e.invoiceNo}</div></div>`:''}
        </div>
        <!-- Invoice items (if applicable) -->
        ${invHtml}
        <!-- Description (at bottom) -->
        <div class="edit-notes-area">
          <div class="edit-notes-label">項目說明</div>
          <textarea class="edit-notes-input" id="f-desc" placeholder="請輸入消費項目說明（選填）">${e.description||''}</textarea>
        </div>
        ${isEdit ? `<button class="edit-delete-btn" id="modal-delete-btn">🗑 刪除這筆消費</button>` : ''}
      </div>`;

    this._openModal(html, false, () => {
      // Show rate note
      const showRateNote = () => {
        const curr = document.getElementById('f-currency')?.value;
        const note = document.getElementById('rate-note');
        if (!note) return;
        if (curr && curr !== 'TWD') {
          const rateVal = (rates[curr]||1).toFixed(3);
          note.textContent = `當前匯率：1 TWD ≈ ${rateVal} ${curr}（來源：open.er-api.com）`;
        } else { note.textContent = ''; }
      };
      showRateNote();
      document.getElementById('f-currency')?.addEventListener('change', showRateNote);

      // Category level 1
      document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const cat = cats.find(c => c.name===btn.dataset.cat1);
          const area = document.getElementById('cat2-area'), row = document.getElementById('cat2-row');
          if (cat?.subs?.length) {
            row.innerHTML = cat.subs.map(sub => `
              <button class="edit-cat-btn" data-cat1="${cat.name}" data-cat2="${sub.name}">
                <div class="edit-cat-circle">${sub.icon||'💰'}</div>
                <div class="edit-cat-label">${sub.name}</div>
              </button>`).join('');
            area.classList.remove('hidden');
            row.querySelectorAll('.edit-cat-btn').forEach(b => { b.addEventListener('click', () => { row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); }); });
          } else { area.classList.add('hidden'); }
        });
      });
      document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => { document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); });
      });

      // Save
      document.getElementById('modal-save-btn')?.addEventListener('click', async () => {
        const cat1Btn = document.querySelector('#cat1-row .edit-cat-btn.selected');
        const cat2Btn = document.querySelector('#cat2-row .edit-cat-btn.selected');
        const cat1 = cat1Btn?.dataset.cat1 || '';
        const cat2 = cat2Btn?.dataset.cat2 || '';
        const amount = parseFloat(document.getElementById('f-amount')?.value);
        const date = document.getElementById('f-date')?.value;
        const store = document.getElementById('f-store')?.value.trim() || '';
        const desc = document.getElementById('f-desc')?.value.trim() || '';
        const currency = document.getElementById('f-currency')?.value || defaultCurr;
        if (!amount || amount <= 0) { this.toast('請輸入金額','error'); return; }
        if (!date) { this.toast('請選擇日期','error'); return; }
        if (!cat1) { this.toast('請選擇大分類','error'); return; }
        const freshRates = await this.fx.getRates();
        const payload = { date, amount, currency, ratesSnapshot: freshRates, store, description: desc, category1: cat1, category2: cat2, status: cat1 ? 'categorized' : 'pending', source: (isEdit&&expense.source) || 'manual' };
        if (isEdit) { this.store.updateExpense(this._editId, payload); this.toast('✅ 已更新','success'); }
        else { this.store.addExpense(payload); this.toast('✅ 已記帳','success'); }
        this.closeModal(() => this.renderView());
      });

      // Delete
      document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
        if (!confirm('確定刪除此筆消費？')) return;
        this.store.deleteExpense(this._editId); this.toast('已刪除','success'); this.closeModal(() => this.renderView());
      });

      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
      document.getElementById('modal-backdrop')?.addEventListener('click', () => this.closeModal(), {once:true});

      // Inv items nav
      document.querySelectorAll('[data-inv-id]').forEach(row => {
        row.addEventListener('click', () => { this.closeModal(() => this.openExpenseModal(row.dataset.invId)); });
      });
    });
  }

  // ─── INVOICE GROUP EDIT ──────────────────────────────────
  _openInvoiceGroupSheet(invoiceNo) {
    const items = this.store.data.expenses.filter(e => e.invoiceNo===invoiceNo);
    if (!items.length) return;
    const total = items.reduce((s,i) => s + Number(i.amount||0), 0);
    const store = items[0]?.store || '電子發票';
    const cats = this.store.data.categories;
    const firstCat1 = items.find(i=>i.category1)?.category1||'';
    const selCat = cats.find(c=>c.name===firstCat1);
    const cat1Html = cats.map(cat => `
      <button class="edit-cat-btn${firstCat1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${cat.icon||'📋'}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');
    const cat2Html = selCat ? selCat.subs.map(sub => `
      <button class="edit-cat-btn" data-cat1="${selCat.name}" data-cat2="${sub.name}">
        <div class="edit-cat-circle">${sub.icon||'💰'}</div>
        <div class="edit-cat-label">${sub.name}</div>
      </button>`).join('') : '';

    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">${store}</div>
        <button class="modal-topbar-btn confirm" id="grp-save-btn">✓</button>
      </div>
      <div class="modal-body">
        <div class="cat-level-wrap">
          <div class="cat-level-label">大分類（套用至全部 ${items.length} 項）</div>
          <div class="edit-category-row" id="grp-cat1-row">${cat1Html}</div>
          <div class="cat-sub-area${selCat?'':' hidden'}" id="grp-cat2-area">
            <div class="cat-level-label" style="padding:6px 8px 2px">小分類</div>
            <div class="edit-category-row" id="grp-cat2-row">${cat2Html}</div>
          </div>
        </div>
        <div class="edit-amount-display" style="pointer-events:none">
          <span class="edit-amount-currency-sel" style="font-size:13px;color:var(--teal)">TWD</span>
          <input class="edit-amount-input" type="number" value="${total}" readonly style="color:var(--text2)">
        </div>
        <div class="edit-notes-area" style="pointer-events:none">
          <div class="edit-notes-label">消費明細（共 ${items.length} 項）</div>
          <textarea class="edit-notes-input" readonly style="color:var(--text2);min-height:80px">${items.map(it=>`${it.description||'(未命名)'}  ${fmt.money(it.amount,'TWD')}`).join('\n')}</textarea>
        </div>
      </div>`;

    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
      document.getElementById('modal-backdrop')?.addEventListener('click', () => this.closeModal(), {once:true});
      document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected');
          const cat = cats.find(c=>c.name===btn.dataset.cat1);
          const area = document.getElementById('grp-cat2-area'), row = document.getElementById('grp-cat2-row');
          if (cat?.subs?.length) {
            row.innerHTML = cat.subs.map(sub=>`<button class="edit-cat-btn" data-cat1="${cat.name}" data-cat2="${sub.name}"><div class="edit-cat-circle">${sub.icon||'💰'}</div><div class="edit-cat-label">${sub.name}</div></button>`).join('');
            area.classList.remove('hidden');
            row.querySelectorAll('.edit-cat-btn').forEach(b=>{b.addEventListener('click',()=>{row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');});});
          } else { area.classList.add('hidden'); }
        });
      });
      document.getElementById('grp-save-btn')?.addEventListener('click', () => {
        const c1 = document.querySelector('#grp-cat1-row .edit-cat-btn.selected'); if (!c1) { this.toast('請選擇大分類','error'); return; }
        const c2 = document.querySelector('#grp-cat2-row .edit-cat-btn.selected');
        items.forEach(it => this.store.updateExpense(it.id, { category1:c1.dataset.cat1, category2:c2?.dataset.cat2||'', status:'categorized' }));
        this.toast(`✅ 已更新 ${items.length} 筆分類`,'success'); this.closeModal(() => this.renderView());
      });
    });
  }

  // ─── INVOICE CSV IMPORT ───────────────────────────────────
  openInvoiceImportModal() {
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">匯入電子發票</div>
        <div style="width:32px"></div>
      </div>
      <div class="modal-body">
        <div style="font-size:12px;color:var(--text2);line-height:1.7;background:var(--bg3);border-radius:var(--radius-sm);padding:10px;margin-bottom:10px">
          上傳財政部電子發票平台匯出的 CSV 檔案（手機條碼載具）。<br>
          請至 <strong>電子發票整合服務平台</strong> → 消費明細 → 匯出 CSV
        </div>
        <div class="csv-drop-zone" id="invoice-drop-zone">
          <div class="csv-drop-icon">🧾</div>
          <div class="csv-drop-text">點擊或拖放 CSV 檔案<br><span style="font-size:10px">財政部電子發票格式</span></div>
        </div>
        <div id="invoice-preview"></div>
      </div>`;
    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
      document.getElementById('invoice-drop-zone')?.addEventListener('click', () => document.getElementById('csv-invoice-input')?.click());
    });
  }

  _handleInvoiceCsv(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = this.invoice.parse(e.target.result);
        if (!rows.length) { this.toast('未找到有效發票資料','error'); return; }
        const groups = this.invoice.groupByInvoice(rows);
        const preview = document.getElementById('invoice-preview');
        if (preview) {
          preview.innerHTML = `<div style="font-size:12px;color:var(--text2);padding:8px 2px">找到 ${groups.length} 張發票，共 ${rows.length} 筆消費</div>
            <div style="display:flex;gap:8px;padding-top:4px">
              <button class="btn-primary" id="inv-confirm-btn" style="flex:1">匯入 ${rows.length} 筆</button>
              <button class="btn-secondary" id="inv-cancel-btn">取消</button>
            </div>`;
          document.getElementById('inv-confirm-btn')?.addEventListener('click', () => {
            const sm = this.store.data.storeMapping || [];
            rows.forEach(row => {
              const rule = sm.find(r => row.store?.includes(r.store));
              const exp = {
                date: row.date, amount: row.amount, currency: 'TWD',
                ratesSnapshot: this.fx.getCached(),
                description: row.description, store: row.store,
                invoiceNo: row.invoiceNo, source: 'invoice',
                category1: rule?.cat1 || '', category2: rule?.cat2 || '',
                status: rule?.cat1 ? 'categorized' : 'pending',
              };
              this.store.addExpense(exp);
            });
            this.toast(`✅ 已匯入 ${rows.length} 筆`,'success'); this.closeModal(() => this.renderView());
          });
          document.getElementById('inv-cancel-btn')?.addEventListener('click', () => this.closeModal());
        }
      } catch(err) { this.toast('CSV 解析失敗：' + err.message,'error'); }
      event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ─── GENERIC CSV IMPORT ────────────────────────────────────
  _handleGenericCsv(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const headers = this.csvParser.getHeaders(text);
      const colMap = this.csvParser.detectColumns(headers);
      const colOpts = ['（不匯入）', ...headers].map((h,i) => `<option value="${i-1}"${i===0?' selected':''}>${h}</option>`).join('');
      const mapFields = [
        { key:'date', label:'日期欄' },
        { key:'amount', label:'金額欄' },
        { key:'desc', label:'說明欄' },
        { key:'cat1', label:'大分類欄' },
        { key:'store', label:'店家欄' },
      ];
      const mapHtml = mapFields.map(f => `
        <div class="csv-col-row">
          <div class="csv-col-label">${f.label}</div>
          <select class="csv-col-select" id="col-${f.key}">
            ${['（不匯入）', ...headers].map((h,i) => `<option value="${i-1}"${(colMap[f.key]===i-1&&i>0)?' selected':''}>${h}</option>`).join('')}
          </select>
        </div>`).join('');

      const html = `
        <div class="modal-topbar">
          <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
          <div class="modal-topbar-title">匯入外部 CSV</div>
          <button class="modal-topbar-btn confirm" id="csv-import-confirm">匯入</button>
        </div>
        <div class="modal-body">
          <div style="font-size:12px;color:var(--text2);line-height:1.6;background:var(--bg3);border-radius:var(--radius-sm);padding:10px;margin-bottom:10px">
            找到 ${headers.length} 個欄位，請對應以下欄位設定：
          </div>
          <div class="csv-col-map">${mapHtml}</div>
          <div style="margin-top:8px;font-size:11px;color:var(--text3)">找到 CSV 標題：${headers.join(', ')}</div>
        </div>`;

      this._openModal(html, false, () => {
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('csv-import-confirm')?.addEventListener('click', () => {
          const cm = {};
          mapFields.forEach(f => {
            const v = parseInt(document.getElementById(`col-${f.key}`)?.value);
            if (v >= 0) cm[f.key] = v;
          });
          if (cm.date === undefined) { this.toast('請選擇日期欄','error'); return; }
          if (cm.amount === undefined) { this.toast('請選擇金額欄','error'); return; }
          const rows = this.csvParser.parse(text, cm);
          if (!rows.length) { this.toast('未找到有效資料（請確認日期、金額格式）','error'); return; }
          rows.forEach(r => {
            r.ratesSnapshot = this.fx.getCached();
            this.store.addExpense(r);
          });
          this.toast(`✅ 已匯入 ${rows.length} 筆資料`,'success');
          this.closeModal(() => this.renderView());
        });
      });
      event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ─── PENDING MODAL ────────────────────────────────────────
  _openPendingModal() {
    const pending = this.store.getPendingExpenses().sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const html = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">待分類 (${pending.length})</div>
        <div style="width:32px"></div>
      </div>
      <div style="flex:1;overflow-y:auto;min-height:0">
        <div class="pending-list">
          ${pending.length ? pending.map(e => `
            <div class="pending-item" data-id="${e.id}">
              <div class="pending-item-icon">❓</div>
              <div class="pending-item-body">
                <div class="pending-item-desc">${e.description||e.store||'(未命名)'}</div>
                <div class="pending-item-meta">${fmt.date(e.date)} ${e.store?'· '+e.store:''}</div>
              </div>
              <div class="pending-item-amt">${this.fmtExp(e)}</div>
            </div>`).join('')
            : `<div class="empty-state"><div class="icon">✅</div><p>所有消費已分類</p></div>`}
        </div>
      </div>`;
    this._openModal(html, false, () => {
      document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
      document.querySelectorAll('.pending-item[data-id]').forEach(item => {
        item.addEventListener('click', () => { this.closeModal(() => this.openExpenseModal(item.dataset.id)); });
      });
    });
  }

  // ─── LOCAL EXPORT/IMPORT ──────────────────────────────────
  _exportJson() {
    const data = this.store.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cost-record-backup-${fmt.today()}.json`; a.click();
    URL.revokeObjectURL(url); this.toast('已匯出備份','success');
  }

  _importJson(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!confirm(`確定匯入備份？目前資料將被覆蓋。\n（備份包含 ${data.expenses?.length||0} 筆消費）`)) return;
        this.store.import(data); this.toast('✅ 已匯入備份','success'); this.renderView();
      } catch(err) { this.toast('匯入失敗：格式無效','error'); }
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  // ─── MODAL HELPERS ────────────────────────────────────────
  _openModal(html, sheetMode, attachFn) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const backdrop = document.getElementById('modal-backdrop');
    content.classList.toggle('sheet-mode', !!sheetMode);
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    backdrop.classList.add('visible');
    requestAnimationFrame(() => requestAnimationFrame(() => content.classList.add('slide-in')));
    if (attachFn) attachFn();
  }

  closeModal(cb) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const backdrop = document.getElementById('modal-backdrop');
    content.classList.remove('slide-in');
    backdrop.classList.remove('visible');
    setTimeout(() => {
      overlay.classList.add('hidden');
      content.innerHTML = '';
      if (cb) cb();
    }, 300);
  }

  toast(msg, type = '') {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.className = type ? `show ${type}` : 'show';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.className = ''; }, 2800);
  }
}

// ══════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
