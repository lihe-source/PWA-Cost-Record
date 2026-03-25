
'use strict';

const STORAGE_KEY = 'cost_record_v1';
const DRIVE_FOLDER_NAME = '#PWA-Cost-Record';
const DRIVE_FILE_PREFIX = 'cost-record-backup';
const RATE_CACHE_KEY = 'cost_record_fx_cache_v1';

const ICON_LIBRARY = [
  '🍽️','🍳','🍱','🍜','🥤','☕','🧋','🍔','🍞','🍰','🍓',
  '🛒','🏪','🛍️','📦','💻','📱','📺','🛠️','🏠','🚗','⛽',
  '🚌','🚕','🚄','✈️','🎁','🎮','🎬','📚','💊','🏥','🐶',
  '👶','🎓','💼','💡','💳','💰','📋','⭐','🧾','🏦','🧹'
];

const CURRENCIES = {
  TWD: { label: '台幣', symbol: 'NT$' },
  JPY: { label: '日幣', symbol: '¥' },
  CNY: { label: '人民幣', symbol: '¥' },
  EUR: { label: '歐元', symbol: '€' },
  USD: { label: '美金', symbol: '$' }
};

const DEFAULT_CATEGORIES = [
  {
    id: uid('cat'),
    name: '餐飲',
    icon: '🍽️',
    subs: [
      { id: uid('sub'), name: '早餐', icon: '🍳' },
      { id: uid('sub'), name: '午餐', icon: '🍱' },
      { id: uid('sub'), name: '晚餐', icon: '🍜' },
      { id: uid('sub'), name: '點心', icon: '🍰' },
      { id: uid('sub'), name: '飲料', icon: '🧋' }
    ]
  },
  {
    id: uid('cat'),
    name: '交通',
    icon: '🚗',
    subs: [
      { id: uid('sub'), name: '加油', icon: '⛽' },
      { id: uid('sub'), name: '停車', icon: '🚕' },
      { id: uid('sub'), name: '大眾運輸', icon: '🚌' }
    ]
  },
  {
    id: uid('cat'),
    name: '生活',
    icon: '🛒',
    subs: [
      { id: uid('sub'), name: '家用品', icon: '🏠' },
      { id: uid('sub'), name: '購物', icon: '🛍️' },
      { id: uid('sub'), name: '醫療', icon: '💊' }
    ]
  }
];

function uid(prefix='id'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

const fmt = {
  date(ds) {
    if (!ds) return '';
    const [y,m,d] = ds.split('-');
    return `${y}/${m}/${d}`;
  },
  datetime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    let hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    const ap = hh >= 12 ? '下午' : '上午';
    hh = hh % 12 || 12;
    return `${y}/${m}/${day} ${ap}${hh}:${mm}:${ss}`;
  },
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },
  currency(amount, code='TWD') {
    const meta = CURRENCIES[code] || CURRENCIES.TWD;
    const n = Number(amount || 0);
    const decimals = ['JPY','TWD'].includes(code) ? 0 : 2;
    return `${meta.symbol}${n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: decimals })}`;
  }
};

class RateService {
  constructor() {
    this.cache = this._load();
  }
  _load() {
    try {
      return JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || '{}');
    } catch {
      return {};
    }
  }
  _save() {
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(this.cache));
  }
  _key(date, currency) {
    return `${date}_${currency}`;
  }
  async getTwdTo(currency, date) {
    if (!currency || currency === 'TWD') return 1;
    const key = this._key(date, currency);
    if (this.cache[key]) return this.cache[key];
    const url = `https://api.frankfurter.dev/v2/rates?date=${date}&base=TWD&quotes=${currency}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`匯率取得失敗 (${res.status})`);
    const arr = await res.json();
    const rate = Array.isArray(arr) ? arr.find(x => x.quote === currency)?.rate : null;
    if (!rate) throw new Error(`找不到 ${currency} 匯率`);
    this.cache[key] = rate;
    this._save();
    return rate;
  }
  async convertFromTwd(amountTwd, targetCurrency, date) {
    if (targetCurrency === 'TWD') return Number(amountTwd || 0);
    const rate = await this.getTwdTo(targetCurrency, date);
    return Number(amountTwd || 0) * rate;
  }
  async convertToTwd(amount, sourceCurrency, date) {
    if (sourceCurrency === 'TWD') return Number(amount || 0);
    const rate = await this.getTwdTo(sourceCurrency, date);
    return Number(amount || 0) / rate;
  }
}

class DataStore {
  constructor() {
    this.data = this._migrate(this._load());
  }
  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || this._default();
    } catch {
      return this._default();
    }
  }
  _default() {
    return {
      schemaVersion: 2,
      expenses: [],
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      settings: {
        geminiApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        googleClientId: '',
        displayCurrency: 'TWD',
        autoSyncOnOpen: false
      },
      lastSync: null,
      storeMapping: []
    };
  }
  _migrate(data) {
    const base = this._default();
    const merged = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };

    if (!Array.isArray(merged.categories) || !merged.categories.length) {
      merged.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    } else {
      merged.categories = merged.categories.map(cat => {
        const subs = (cat.subs || []).map(sub => {
          if (typeof sub === 'string') {
            return { id: uid('sub'), name: sub, icon: this._guessSubIcon(sub) };
          }
          return { id: sub.id || uid('sub'), name: sub.name, icon: sub.icon || this._guessSubIcon(sub.name) };
        });
        return {
          id: cat.id || uid('cat'),
          name: cat.name,
          icon: cat.icon || this._guessCatIcon(cat.name),
          subs
        };
      });
    }

    merged.expenses = (merged.expenses || []).map(e => {
      const currency = e.currency || 'TWD';
      const amount = Number(e.amount || 0);
      let amountTwd = Number(e.amountTwd);
      if (!Number.isFinite(amountTwd)) {
        amountTwd = currency === 'TWD' ? amount : amount;
      }
      return {
        id: e.id || uid('exp'),
        date: e.date || fmt.today(),
        amount,
        amountTwd,
        currency,
        description: e.description || '',
        store: e.store || '',
        category1: e.category1 || '',
        category2: e.category2 || '',
        status: e.status || (e.category1 ? 'categorized' : 'pending'),
        source: e.source || 'manual',
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: e.updatedAt || null
      };
    });
    this.data = merged;
    this.save();
    return merged;
  }
  _guessCatIcon(name='') {
    if (name.includes('餐') || name.includes('飲')) return '🍽️';
    if (name.includes('交')) return '🚗';
    if (name.includes('家')) return '🏠';
    if (name.includes('醫')) return '💊';
    if (name.includes('旅')) return '✈️';
    return '📁';
  }
  _guessSubIcon(name='') {
    const pairs = [
      ['早餐','🍳'],['午餐','🍱'],['晚餐','🍜'],['飲料','🧋'],['點心','🍰'],
      ['加油','⛽'],['停車','🚕'],['車','🚗'],['捷運','🚌'],['醫','💊'],
      ['家','🏠'],['購','🛍️'],['市場','🛒'],['費','💰']
    ];
    for (const [k, v] of pairs) if (name.includes(k)) return v;
    return '📋';
  }
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }
  export() {
    return JSON.parse(JSON.stringify(this.data));
  }
  importData(payload, mode='replace') {
    if (!payload || typeof payload !== 'object') throw new Error('匯入格式錯誤');
    if (payload.expenses && Array.isArray(payload.expenses)) {
      const normalized = this._migrate(payload).expenses;
      if (mode === 'merge') {
        const exists = new Set(this.data.expenses.map(e => `${e.date}|${e.amount}|${e.description}|${e.store}`));
        normalized.forEach(e => {
          const key = `${e.date}|${e.amount}|${e.description}|${e.store}`;
          if (!exists.has(key)) this.data.expenses.push({ ...e, id: uid('exp') });
        });
        const byName = new Map(this.data.categories.map(c => [c.name, c]));
        (payload.categories || []).forEach(cat => {
          const hit = byName.get(cat.name);
          if (!hit) {
            this.data.categories.push(cat);
          } else {
            (cat.subs || []).forEach(sub => {
              if (!hit.subs.some(x => x.name === sub.name)) hit.subs.push(sub);
            });
          }
        });
      } else {
        this.data = this._migrate(payload);
      }
      this.save();
      return;
    }
    throw new Error('不支援的匯入格式');
  }
  addExpense(exp) {
    const item = { ...exp, id: uid('exp'), createdAt: new Date().toISOString() };
    this.data.expenses.push(item);
    this.save();
    return item;
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
  getByDate(ds) {
    return this.data.expenses.filter(e => e.date === ds).sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
  }
  getRecent(limit=30) {
    return [...this.data.expenses].sort((a,b)=> (b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0, limit);
  }
  getMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2,'0')}`;
    return this.data.expenses.filter(e => (e.date || '').startsWith(prefix));
  }
}

class DriveService {
  constructor() {
    this.token = null;
    this.clientId = '';
  }
  async init(clientId) {
    this.clientId = clientId;
    await this._loadGIS();
  }
  async _loadGIS() {
    if (window.google?.accounts?.oauth2) return;
    await new Promise(resolve => {
      if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
        const timer = setInterval(() => {
          if (window.google?.accounts?.oauth2) {
            clearInterval(timer);
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
    if (!this.clientId) throw new Error('請先設定 Google OAuth Client ID');
    await this._loadGIS();
    return await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: resp => {
          if (resp.error) reject(new Error(resp.error));
          else {
            this.token = resp.access_token;
            resolve(this.token);
          }
        }
      });
      client.requestAccessToken({ prompt: 'select_account' });
    });
  }
  async _fetchJson(url, options={}) {
    const token = await this.getToken();
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    if (!res.ok) throw new Error(`Google Drive API ${res.status}`);
    return res.json();
  }
  async ensureFolder() {
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const result = await this._fetchJson(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    if (result.files?.length) return result.files[0];
    return await this._fetchJson('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
  }
  async uploadBackup(data) {
    const folder = await this.ensureFolder();
    const token = await this.getToken();
    const fileName = `${DRIVE_FILE_PREFIX}-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const boundary = '----costrecord';
    const metadata = {
      name: fileName,
      parents: [folder.id],
      mimeType: 'application/json'
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
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (!res.ok) throw new Error(`上傳失敗 (${res.status})`);
    return res.json();
  }
  async listRecentBackups(limit=5) {
    const folder = await this.ensureFolder();
    const q = encodeURIComponent(`'${folder.id}' in parents and trashed=false`);
    const result = await this._fetchJson(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=${limit}&fields=files(id,name,createdTime,size)`);
    return result.files || [];
  }
  async downloadBackup(fileId) {
    const token = await this.getToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
    return res.json();
  }
  signOut() {
    this.token = null;
  }
}

class App {
  constructor() {
    this.store = new DataStore();
    this.rateService = new RateService();
    this.drive = new DriveService();
    this.view = 'home';
    this.selectedDate = fmt.today();
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth()+1;
    this._editId = null;
    this._tempCategoryDraft = null;
  }

  async init() {
    this._bindNav();
    this.render();
    const cid = this.store.data.settings.googleClientId;
    if (cid) this.drive.init(cid).catch(()=>{});
    if (cid && this.store.data.settings.autoSyncOnOpen) {
      this.syncUpload(false).catch(()=>{});
    }
  }

  render() {
    const main = document.getElementById('main-content');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === this.view));
    if (this.view === 'home') main.innerHTML = this._buildHome();
    if (this.view === 'search') main.innerHTML = this._buildSearch();
    if (this.view === 'stats') main.innerHTML = this._buildStats();
    if (this.view === 'settings') main.innerHTML = this._buildSettings();
    this._attachViewEvents();
  }

  _bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.view = btn.dataset.view;
        this.render();
      });
    });
    document.getElementById('nav-add-btn')?.addEventListener('click', () => this.openExpenseModal());
  }

  _attachViewEvents() {
    if (this.view === 'home') this._attachHomeEvents();
    if (this.view === 'search') this._attachSearchEvents();
    if (this.view === 'stats') this._attachStatsEvents();
    if (this.view === 'settings') this._attachSettingsEvents();
  }

  _buildHome() {
    const monthItems = this.store.getMonth(this.year, this.month);
    const totalTwd = monthItems.reduce((s, e) => s + Number(e.amountTwd || 0), 0);
    const pending = monthItems.filter(e => e.status === 'pending').length;
    const recent = this.store.getRecent(20);

    return `
      <section class="hero-card">
        <div class="hero-top">
          <div>
            <div class="hero-kicker">本月總覽</div>
            <div class="hero-value" data-money data-amount-twd="${totalTwd}" data-date="${fmt.today()}">${fmt.currency(totalTwd, 'TWD')}</div>
            <div class="hero-sub">目前顯示幣值：${this.store.data.settings.displayCurrency}</div>
          </div>
          <button class="hero-refresh" id="open-add-btn">＋</button>
        </div>
        <div class="summary-grid">
          <div class="summary-card"><div class="summary-label">本月筆數</div><div class="summary-value">${monthItems.length}</div></div>
          <div class="summary-card"><div class="summary-label">待分類</div><div class="summary-value">${pending}</div></div>
        </div>
      </section>

      <section class="section-head">
        <div class="section-title">月份</div>
        <div class="month-switch">
          <button class="ghost-btn" id="prev-month-btn">‹</button>
          <div class="month-label">${this.year}/${String(this.month).padStart(2,'0')}</div>
          <button class="ghost-btn" id="next-month-btn">›</button>
        </div>
      </section>

      <section class="records-section">
        <div class="records-title">近期紀錄</div>
        <div class="records-list">
          ${recent.length ? recent.map(e => this._buildRecordCard(e)).join('') : '<div class="empty-card">尚無資料</div>'}
        </div>
      </section>
    `;
  }

  _buildRecordCard(e) {
    const cat = this._findCategoryMeta(e.category1, e.category2);
    const icon = cat.icon || '📋';
    return `
      <button class="record-card" data-edit-id="${e.id}">
        <div class="record-icon">${icon}</div>
        <div class="record-body">
          <div class="record-top">
            <div class="record-title">${escapeHtml(e.description || '(未命名)')}</div>
            <div class="record-amount" data-money data-amount-twd="${Number(e.amountTwd || e.amount || 0)}" data-date="${e.date}">${fmt.currency(e.amountTwd || e.amount || 0, 'TWD')}</div>
          </div>
          <div class="record-meta">
            <span>${fmt.date(e.date)}</span>
            ${e.store ? `<span>${escapeHtml(e.store)}</span>` : ''}
            ${e.category1 ? `<span>${escapeHtml(e.category1)}${e.category2 ? ' / ' + escapeHtml(e.category2) : ''}</span>` : '<span>待分類</span>'}
          </div>
          <div class="record-orig">原始：${fmt.currency(e.amount, e.currency)}${e.currency !== this.store.data.settings.displayCurrency ? ` · 轉換顯示` : ''}</div>
        </div>
      </button>
    `;
  }

  _buildSearch() {
    return `
      <section class="search-panel">
        <input id="search-input" class="search-input" placeholder="搜尋說明、店家、分類">
        <div id="search-results" class="records-list"></div>
      </section>
    `;
  }

  _buildStats() {
    const items = this.store.getMonth(this.year, this.month);
    const byCat = {};
    items.forEach(e => {
      const key = e.category1 || '待分類';
      byCat[key] = (byCat[key] || 0) + Number(e.amountTwd || 0);
    });
    const rows = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    return `
      <section class="stat-page">
        <div class="section-head"><div class="section-title">分類統計</div></div>
        <div class="stat-list">
          ${rows.length ? rows.map(([name, amt]) => `
            <div class="stat-row">
              <div class="stat-name">${escapeHtml(name)}</div>
              <div class="stat-bar"><div class="stat-bar-inner" style="width:${Math.max(8, Math.round(amt / Math.max(rows[0][1],1) * 100))}%"></div></div>
              <div class="stat-amt" data-money data-amount-twd="${amt}" data-date="${fmt.today()}">${fmt.currency(amt, 'TWD')}</div>
            </div>
          `).join('') : '<div class="empty-card">本月尚無資料</div>'}
        </div>
      </section>
    `;
  }

  _buildSettings() {
    const s = this.store.data.settings;
    return `
      <section class="settings-group">
        <div class="settings-card">
          <div class="setting-row clickable" id="open-category-manager">
            <div>
              <div class="setting-title">分類</div>
              <div class="setting-sub">新增 / 編輯 / 刪除大分類與小分類，並設定 icon</div>
            </div>
            <div class="setting-arrow">›</div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-title">預設顯示幣值</div>
              <div class="setting-sub">所有清單與統計依此幣值換算顯示</div>
            </div>
            <select class="form-select compact" id="display-currency">
              ${Object.keys(CURRENCIES).map(code => `<option value="${code}" ${s.displayCurrency === code ? 'selected' : ''}>${code} / ${CURRENCIES[code].label}</option>`).join('')}
            </select>
          </div>
          <div class="setting-row">
            <label class="checkbox-line">
              <input type="checkbox" id="auto-sync-on-open" ${s.autoSyncOnOpen ? 'checked' : ''}>
              <span>每次開啟 APP 自動同步</span>
            </label>
          </div>
        </div>

        <div class="settings-card">
          <div class="sync-header">
            <div>
              <div class="setting-title">Google Drive 備份 / 同步</div>
              <div class="setting-sub">備份資料夾：${DRIVE_FOLDER_NAME}</div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Google OAuth Client ID</label>
            <input class="form-input" id="google-client-id" placeholder="xxxx.apps.googleusercontent.com" value="${escapeHtml(s.googleClientId || '')}">
          </div>
          ${this.store.data.lastSync ? `<div class="sync-chip">上次同步：${escapeHtml(this.store.data.lastSync)}</div>` : ''}
          <div class="action-grid">
            <button class="primary-btn" id="save-drive-settings">儲存設定</button>
            <button class="primary-btn strong" id="sync-upload-btn">上傳到雲端</button>
            <button class="secondary-btn" id="sync-download-btn">從雲端下載</button>
          </div>
        </div>

        <div class="settings-card">
          <div class="setting-title">AI 設定（選用）</div>
          <div class="setting-sub">幣值換算與 Google Drive 備份不需要 AI。</div>
          <div class="form-group">
            <label class="form-label">Gemini API Key</label>
            <input class="form-input" id="gemini-key" type="password" placeholder="選填" value="${escapeHtml(s.geminiApiKey || '')}">
          </div>
          <button class="secondary-btn" id="save-ai-settings">儲存 AI 設定</button>
        </div>

        <div class="settings-card">
          <div class="setting-title">資料匯入 / 匯出</div>
          <div class="action-grid">
            <button class="secondary-btn" id="export-json-btn">匯出 JSON</button>
            <button class="secondary-btn" id="import-json-btn">匯入 JSON</button>
          </div>
          <input type="file" id="import-json-file" accept=".json" hidden>
        </div>
      </section>
    `;
  }

  _attachHomeEvents() {
    document.getElementById('open-add-btn')?.addEventListener('click', () => this.openExpenseModal());
    document.getElementById('prev-month-btn')?.addEventListener('click', () => {
      this.month--;
      if (this.month < 1) { this.month = 12; this.year--; }
      this.render();
    });
    document.getElementById('next-month-btn')?.addEventListener('click', () => {
      this.month++;
      if (this.month > 12) { this.month = 1; this.year++; }
      this.render();
    });
    document.querySelectorAll('[data-edit-id]').forEach(btn => btn.addEventListener('click', () => this.openExpenseModal(btn.dataset.editId)));
    this._renderMoneyFields();
  }

  _attachSearchEvents() {
    const input = document.getElementById('search-input');
    const out = document.getElementById('search-results');
    const renderList = async () => {
      const q = (input.value || '').trim().toLowerCase();
      const items = this.store.data.expenses.filter(e =>
        !q ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.store || '').toLowerCase().includes(q) ||
        (e.category1 || '').toLowerCase().includes(q) ||
        (e.category2 || '').toLowerCase().includes(q)
      ).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
      out.innerHTML = items.length ? items.map(e => this._buildRecordCard(e)).join('') : '<div class="empty-card">找不到資料</div>';
      out.querySelectorAll('[data-edit-id]').forEach(btn => btn.addEventListener('click', () => this.openExpenseModal(btn.dataset.editId)));
      this._renderMoneyFields();
    };
    input?.addEventListener('input', renderList);
    renderList();
  }

  _attachStatsEvents() {
    this._renderMoneyFields();
  }

  _attachSettingsEvents() {
    document.getElementById('open-category-manager')?.addEventListener('click', () => this.openCategoryManager());
    document.getElementById('display-currency')?.addEventListener('change', e => {
      this.store.data.settings.displayCurrency = e.target.value;
      this.store.save();
      this.toast('已更新顯示幣值');
      this.render();
    });
    document.getElementById('auto-sync-on-open')?.addEventListener('change', e => {
      this.store.data.settings.autoSyncOnOpen = !!e.target.checked;
      this.store.save();
    });
    document.getElementById('save-drive-settings')?.addEventListener('click', async () => {
      const cid = document.getElementById('google-client-id').value.trim();
      this.store.data.settings.googleClientId = cid;
      this.store.save();
      if (cid) await this.drive.init(cid);
      this.toast('Google Drive 設定已儲存');
    });
    document.getElementById('sync-upload-btn')?.addEventListener('click', () => this.syncUpload(true));
    document.getElementById('sync-download-btn')?.addEventListener('click', () => this.openBackupSelector());
    document.getElementById('save-ai-settings')?.addEventListener('click', () => {
      this.store.data.settings.geminiApiKey = document.getElementById('gemini-key').value.trim();
      this.store.save();
      this.toast('AI 設定已儲存');
    });
    document.getElementById('export-json-btn')?.addEventListener('click', () => this.exportJson());
    document.getElementById('import-json-btn')?.addEventListener('click', () => document.getElementById('import-json-file').click());
    document.getElementById('import-json-file')?.addEventListener('change', e => this.importJsonFile(e));
  }

  async _renderMoneyFields() {
    const display = this.store.data.settings.displayCurrency || 'TWD';
    const nodes = document.querySelectorAll('[data-money]');
    for (const node of nodes) {
      const amtTwd = Number(node.dataset.amountTwd || 0);
      const date = node.dataset.date || fmt.today();
      try {
        const converted = await this.rateService.convertFromTwd(amtTwd, display, date);
        node.textContent = fmt.currency(converted, display);
      } catch {
        node.textContent = fmt.currency(amtTwd, 'TWD');
      }
    }
  }

  _findCategoryMeta(cat1, cat2) {
    const cat = this.store.data.categories.find(c => c.name === cat1);
    if (!cat) return { icon: '📋' };
    const sub = (cat.subs || []).find(s => s.name === cat2);
    return { icon: (sub && sub.icon) || cat.icon || '📁' };
  }

  openExpenseModal(id=null) {
    const existing = id ? this.store.data.expenses.find(e => e.id === id) : null;
    const item = existing || {
      date: this.selectedDate,
      amount: '',
      currency: this.store.data.settings.displayCurrency || 'TWD',
      description: '',
      store: '',
      category1: '',
      category2: ''
    };
    const content = `
      <div class="modal-sheet">
        <div class="modal-header">
          <div class="modal-title">${existing ? '編輯紀錄' : '新增紀錄'}</div>
          <button class="icon-close" id="close-modal-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label">日期</label>
              <input type="date" class="form-input" id="exp-date" value="${item.date}">
            </div>
            <div class="form-group">
              <label class="form-label">幣值</label>
              <select class="form-select" id="exp-currency">
                ${Object.keys(CURRENCIES).map(code => `<option value="${code}" ${item.currency === code ? 'selected' : ''}>${code}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">金額</label>
            <input type="number" class="form-input" id="exp-amount" value="${item.amount}" placeholder="請輸入金額">
          </div>
          <div class="form-group">
            <label class="form-label">店家</label>
            <input class="form-input" id="exp-store" value="${escapeHtml(item.store || '')}" placeholder="店家名稱">
          </div>
          <div class="form-group">
            <label class="form-label">大分類</label>
            <select class="form-select" id="exp-cat1">
              <option value="">請選擇</option>
              ${this.store.data.categories.map(c => `<option value="${escapeHtml(c.name)}" ${c.name===item.category1?'selected':''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">小分類</label>
            <select class="form-select" id="exp-cat2"></select>
          </div>
          <div class="form-group">
            <label class="form-label">項目說明</label>
            <textarea class="form-textarea" id="exp-desc" placeholder="請輸入項目說明">${escapeHtml(item.description || '')}</textarea>
          </div>
          <div class="modal-actions">
            ${existing ? '<button class="danger-btn" id="delete-exp-btn">刪除</button>' : ''}
            <button class="primary-btn strong" id="save-exp-btn">儲存</button>
          </div>
        </div>
      </div>
    `;
    this._showModal(content);
    const cat1 = document.getElementById('exp-cat1');
    const cat2 = document.getElementById('exp-cat2');
    const fillSub = (selected='') => {
      const chosen = this.store.data.categories.find(c => c.name === cat1.value);
      cat2.innerHTML = `<option value="">請選擇</option>` + (chosen?.subs || []).map(s => `<option value="${escapeHtml(s.name)}" ${s.name===selected?'selected':''}>${s.icon} ${escapeHtml(s.name)}</option>`).join('');
    };
    fillSub(item.category2 || '');
    cat1.addEventListener('change', () => fillSub());
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('save-exp-btn')?.addEventListener('click', async () => {
      const date = document.getElementById('exp-date').value;
      const currency = document.getElementById('exp-currency').value;
      const amount = Number(document.getElementById('exp-amount').value);
      const store = document.getElementById('exp-store').value.trim();
      const category1 = document.getElementById('exp-cat1').value;
      const category2 = document.getElementById('exp-cat2').value;
      const description = document.getElementById('exp-desc').value.trim();
      if (!date) return this.toast('請選擇日期', 'error');
      if (!Number.isFinite(amount) || amount <= 0) return this.toast('請輸入有效金額', 'error');
      if (!description) return this.toast('請輸入項目說明', 'error');
      let amountTwd = amount;
      try {
        amountTwd = await this.rateService.convertToTwd(amount, currency, date);
      } catch (err) {
        if (currency !== 'TWD') return this.toast('匯率查詢失敗，暫時無法儲存此幣值', 'error');
      }
      const payload = {
        date, currency, amount, amountTwd, store, category1, category2,
        description, status: category1 ? 'categorized' : 'pending', source: 'manual'
      };
      if (existing) this.store.updateExpense(existing.id, payload);
      else this.store.addExpense(payload);
      this.closeModal();
      this.toast(existing ? '已更新紀錄' : '已新增紀錄');
      this.render();
    });
    document.getElementById('delete-exp-btn')?.addEventListener('click', () => {
      if (!confirm('確定刪除這筆紀錄？')) return;
      this.store.deleteExpense(existing.id);
      this.closeModal();
      this.toast('已刪除紀錄');
      this.render();
    });
  }

  openCategoryManager() {
    const renderManager = () => {
      const html = `
        <div class="modal-sheet category-sheet">
          <div class="modal-header">
            <div class="modal-title">分類管理</div>
            <button class="icon-close" id="close-modal-btn">✕</button>
          </div>
          <div class="modal-body">
            <div class="action-grid">
              <button class="primary-btn" id="add-cat-btn">新增大分類</button>
            </div>
            <div class="category-list">
              ${this.store.data.categories.map(cat => `
                <div class="category-block" data-cat-id="${cat.id}">
                  <div class="category-head">
                    <div class="category-head-left"><span class="category-icon">${cat.icon}</span><span>${escapeHtml(cat.name)}</span></div>
                    <div class="category-tools">
                      <button class="tiny-btn" data-act="edit-cat" data-cat-id="${cat.id}">編輯</button>
                      <button class="tiny-btn danger" data-act="del-cat" data-cat-id="${cat.id}">刪除</button>
                    </div>
                  </div>
                  <div class="sub-list">
                    ${(cat.subs || []).map(sub => `
                      <div class="sub-row">
                        <div class="sub-left"><span>${sub.icon}</span><span>${escapeHtml(sub.name)}</span></div>
                        <div class="category-tools">
                          <button class="tiny-btn" data-act="edit-sub" data-cat-id="${cat.id}" data-sub-id="${sub.id}">編輯</button>
                          <button class="tiny-btn danger" data-act="del-sub" data-cat-id="${cat.id}" data-sub-id="${sub.id}">刪除</button>
                        </div>
                      </div>
                    `).join('')}
                    <button class="secondary-btn" data-act="add-sub" data-cat-id="${cat.id}">新增小分類</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
      this._showModal(html);
      document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
      document.getElementById('add-cat-btn')?.addEventListener('click', () => this.openCategoryEditor('cat'));
      document.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act;
          const cat = this.store.data.categories.find(c => c.id === btn.dataset.catId);
          const sub = cat?.subs?.find(s => s.id === btn.dataset.subId);
          if (act === 'edit-cat') this.openCategoryEditor('cat', cat);
          if (act === 'add-sub') this.openCategoryEditor('sub', { catId: cat.id, icon: '📋', name: '' });
          if (act === 'edit-sub') this.openCategoryEditor('sub', { ...sub, catId: cat.id });
          if (act === 'del-cat') {
            if (!confirm(`刪除「${cat.name}」？`)) return;
            this.store.data.categories = this.store.data.categories.filter(c => c.id !== cat.id);
            this.store.save();
            renderManager();
            this.render();
          }
          if (act === 'del-sub') {
            if (!confirm(`刪除「${sub.name}」？`)) return;
            cat.subs = cat.subs.filter(s => s.id !== sub.id);
            this.store.save();
            renderManager();
            this.render();
          }
        });
      });
    };
    renderManager();
  }

  openCategoryEditor(type, payload=null) {
    const isCat = type === 'cat';
    const current = payload || { id: uid(isCat ? 'cat' : 'sub'), icon: '📋', name: '' };
    const catOptions = this.store.data.categories.map(c => `<option value="${c.id}" ${payload?.catId===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
    const html = `
      <div class="modal-sheet">
        <div class="modal-header">
          <div class="modal-title">${isCat ? (payload ? '編輯大分類' : '新增大分類') : (payload?.name ? '編輯小分類' : '新增小分類')}</div>
          <button class="icon-close" id="close-modal-btn">✕</button>
        </div>
        <div class="modal-body">
          ${!isCat ? `<div class="form-group"><label class="form-label">所屬大分類</label><select class="form-select" id="editor-parent-cat">${catOptions}</select></div>` : ''}
          <div class="form-group">
            <label class="form-label">名稱</label>
            <input class="form-input" id="editor-name" value="${escapeHtml(current.name || '')}" placeholder="請輸入名稱">
          </div>
          <div class="form-group">
            <label class="form-label">icon</label>
            <div class="icon-picker">
              ${ICON_LIBRARY.map(icon => `<button class="icon-pick ${icon===current.icon?'selected':''}" data-icon="${icon}">${icon}</button>`).join('')}
            </div>
          </div>
          <div class="modal-actions">
            <button class="primary-btn strong" id="save-category-btn">儲存</button>
          </div>
        </div>
      </div>
    `;
    this._showModal(html);
    let selectedIcon = current.icon || '📋';
    document.querySelectorAll('.icon-pick').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-pick').forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
      selectedIcon = btn.dataset.icon;
    }));
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('save-category-btn')?.addEventListener('click', () => {
      const name = document.getElementById('editor-name').value.trim();
      if (!name) return this.toast('請輸入名稱', 'error');
      if (isCat) {
        const exists = this.store.data.categories.find(c => c.id === current.id);
        if (exists) {
          exists.name = name;
          exists.icon = selectedIcon;
        } else {
          this.store.data.categories.push({ id: current.id || uid('cat'), name, icon: selectedIcon || '📁', subs: [] });
        }
      } else {
        const parentId = document.getElementById('editor-parent-cat').value;
        const parent = this.store.data.categories.find(c => c.id === parentId);
        if (!parent) return this.toast('請選擇大分類', 'error');
        const exists = parent.subs.find(s => s.id === current.id);
        if (exists) {
          exists.name = name;
          exists.icon = selectedIcon;
        } else {
          parent.subs.push({ id: current.id || uid('sub'), name, icon: selectedIcon || '📋' });
        }
      }
      this.store.save();
      this.toast('分類已儲存');
      this.openCategoryManager();
      this.render();
    });
  }

  async syncUpload(showToast=true) {
    try {
      const cid = this.store.data.settings.googleClientId;
      if (!cid) return this.toast('請先設定 Google OAuth Client ID', 'error');
      await this.drive.init(cid);
      const result = await this.drive.uploadBackup(this.store.export());
      this.store.data.lastSync = fmt.datetime(new Date().toISOString());
      this.store.save();
      if (showToast) this.toast(`已上傳：${result.name}`);
      this.render();
    } catch (err) {
      this.toast(err.message || '上傳失敗', 'error');
    }
  }

  async openBackupSelector() {
    try {
      const cid = this.store.data.settings.googleClientId;
      if (!cid) return this.toast('請先設定 Google OAuth Client ID', 'error');
      await this.drive.init(cid);
      const list = await this.drive.listRecentBackups(5);
      const html = `
        <div class="modal-sheet">
          <div class="modal-header">
            <div class="modal-title">選擇備份版本</div>
            <button class="icon-close" id="close-modal-btn">✕</button>
          </div>
          <div class="modal-body">
            <div class="helper-text">最多顯示近期 5 份備份，由新到舊排列。</div>
            <div class="backup-select-list">
              ${list.length ? list.map((f, idx) => `
                <button class="backup-item" data-file-id="${f.id}">
                  <div class="backup-top">
                    <div class="backup-time">${fmt.datetime(f.createdTime)}</div>
                    ${idx === 0 ? '<span class="pill">最新</span>' : ''}
                  </div>
                  <div class="backup-meta">大小 ${Number(f.size || 0).toLocaleString('zh-TW')} bytes</div>
                </button>
              `).join('') : '<div class="empty-card">雲端目前沒有備份</div>'}
            </div>
          </div>
        </div>
      `;
      this._showModal(html);
      document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
      document.querySelectorAll('[data-file-id]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('確定要以此備份覆蓋目前資料？')) return;
        try {
          const data = await this.drive.downloadBackup(btn.dataset.fileId);
          this.store.importData(data, 'replace');
          this.store.data.lastSync = fmt.datetime(new Date().toISOString());
          this.store.save();
          this.closeModal();
          this.toast('已從雲端下載並套用');
          this.render();
        } catch (err) {
          this.toast(err.message || '下載失敗', 'error');
        }
      }));
    } catch (err) {
      this.toast(err.message || '讀取備份失敗', 'error');
    }
  }

  exportJson() {
    const blob = new Blob([JSON.stringify(this.store.export(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cost-record-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  importJsonFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        this.store.importData(data, 'merge');
        this.toast('JSON 已匯入並整合');
        this.render();
      } catch (err) {
        this.toast(err.message || '匯入失敗', 'error');
      }
    };
    fr.readAsText(file, 'utf-8');
    event.target.value = '';
  }

  _showModal(html) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
  }
  closeModal() {
    document.getElementById('modal-content').innerHTML = '';
    document.getElementById('modal-overlay').classList.add('hidden');
  }
  toast(msg, type='success') {
    const node = document.getElementById('toast');
    node.textContent = msg;
    node.className = `show ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => node.className = '', 2200);
  }
}

function escapeHtml(str='') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  window.app = app;
  await app.init();
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') app.closeModal();
  });
});
