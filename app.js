/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V0.1
   Modules: DataStore · InvoiceService · DriveService · App
───────────────────────────────────────────────────────────── */
'use strict';

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY   = 'cost_record_v1';
const DRIVE_PREFIX  = 'cost-record-backup';

const DEFAULT_CATEGORIES = [
  {
    name: '平日消費',
    subs: ['早餐', '午餐', '晚餐', '點心', '飲料']
  },
  {
    name: '家庭消費',
    subs: ['市場', '家電', '出遊']
  }
];

const CAT_ICONS = {
  '早餐': '🍳', '午餐': '🍱', '晚餐': '🍜', '點心': '🧁', '飲料': '🧋',
  '市場': '🛒', '家電': '📺', '出遊': '🚗',
  '待分類': '📋', '其他': '💰'
};

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
        invoiceCardNo:      '',
        invoiceCardEncrypt: '',
        invoiceAppId:       '',
        invoiceApiKey:      '',
        geminiApiKey:       '',
        geminiModel:        'gemini-1.5-flash',
        googleClientId:     ''
      },
      importedInvoiceNos: [],
      lastSync: null
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) { console.error('Save error', e); }
  }

  // ── Expense CRUD ──────────────────────────────────────────
  addExpense(exp) {
    exp.id        = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

  isInvoiceImported(invNo) {
    return this.data.importedInvoiceNos.includes(invNo);
  }

  markInvoiceImported(invNo) {
    if (!this.data.importedInvoiceNos.includes(invNo)) {
      this.data.importedInvoiceNos.push(invNo);
      this.save();
    }
  }

  // ── Export / Import ──────────────────────────────────────
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
// INVOICE SERVICE — 財政部電子發票 API
// ══════════════════════════════════════════════════════════════
class InvoiceService {
  constructor() { }

  async _sign(message, key) {
    const enc     = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  // Query carrier invoice list
  async fetchInvoices(settings, startDate, endDate) {
    const { invoiceCardNo, invoiceCardEncrypt, invoiceAppId, invoiceApiKey } = settings;
    if (!invoiceCardNo || !invoiceCardEncrypt || !invoiceAppId || !invoiceApiKey) {
      throw new Error('請先至設定頁面填寫完整的電子發票 API 資訊');
    }

    const ts   = Math.floor(Date.now() / 1000).toString();
    const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;

    const qStr = [
      `action=carrierInvChk`,
      `appID=${invoiceAppId}`,
      `cardEncrypt=${encodeURIComponent(invoiceCardEncrypt)}`,
      `cardType=3J0002`,
      `expTimeStamp=2147483647`,
      `invStatus=all`,
      `timeStamp=${ts}`,
      `uuid=${uuid}`,
      `version=0.5`
    ].join('&');

    const signature = await this._sign(qStr, invoiceApiKey);

    const body = new URLSearchParams({
      version:     '0.5',
      cardType:    '3J0002',
      cardNo:      invoiceCardNo,
      expTimeStamp:'2147483647',
      action:      'carrierInvChk',
      timeStamp:   ts,
      invStatus:   'all',
      uuid,
      appID:       invoiceAppId,
      cardEncrypt: invoiceCardEncrypt,
      signature
    });
    if (startDate) body.append('startDate', startDate);
    if (endDate)   body.append('endDate',   endDate);

    const res = await fetch(
      'https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invServ/InvServ',
      { method: 'POST', body }
    );
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    const data = await res.json();
    if (data.code && data.code !== 200) throw new Error(data.msg || `API 錯誤碼 ${data.code}`);
    return data;
  }

  // Parse invoice date string like "20260322" → "2026-03-22"
  parseInvoiceDate(ds) {
    if (!ds || ds.length < 8) return null;
    return `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}`;
  }
}

// ══════════════════════════════════════════════════════════════
// GOOGLE DRIVE SERVICE
// ══════════════════════════════════════════════════════════════
class DriveService {
  constructor() {
    this.token  = null;
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
      s.src   = 'https://accounts.google.com/gsi/client';
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
        scope:     'https://www.googleapis.com/auth/drive.file',
        callback:  r => r.error ? reject(new Error(r.error)) : resolve((this.token = r.access_token))
      });
      tc.requestAccessToken({ prompt: 'select_account' });
    });
  }

  async listBackups() {
    const token = await this.getToken();
    const q = encodeURIComponent(`name contains '${DRIVE_PREFIX}' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    const d = await res.json();
    return d.files || [];
  }

  async uploadBackup(data) {
    const token    = await this.getToken();
    const fileName = `${DRIVE_PREFIX}-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const content  = JSON.stringify(data, null, 2);
    const boundary = '-------cost_record_backup';
    const body     = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: fileName, mimeType: 'application/json' }),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
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
    const res   = await fetch(
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
  money: n => `$${Number(n || 0).toLocaleString('zh-TW')}`,
  date:  d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${y}/${m}/${day}`;
  },
  monthLabel: (y, m) => `${y} 年 ${m} 月`,
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
};

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
}

function getCatIcon(cat2) {
  return CAT_ICONS[cat2] || CAT_ICONS['其他'];
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.store   = new DataStore();
    this.invoice = new InvoiceService();
    this.drive   = new DriveService();
    this.view    = 'home';
    this.today   = fmt.today();
    this.selected = fmt.today();  // selected date in calendar
    this.calendarYear  = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth() + 1;
    this._toastTimer = null;
    this._editId = null;
  }

  // ─────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────
  init() {
    this._setupNav();
    this._setupUpdateBanner();
    this._registerSW();
    this.renderView();

    // Init drive if clientId is set
    const { googleClientId } = this.store.data.settings;
    if (googleClientId) {
      this.drive.init(googleClientId).catch(()=>{});
    }

    // Bind add button (delegated)
    document.addEventListener('click', e => {
      if (e.target.closest('#add-expense-btn')) this.openExpenseModal(null);
      if (e.target.closest('#invoice-fetch-btn')) this.fetchInvoices();
    });
  }

  _setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        this.view = v;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
        this.renderView();
      });
    });
  }

  _setupUpdateBanner() {
    const banner = document.getElementById('update-banner');
    banner.addEventListener('click', () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    });
  }

  _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('update-banner').style.display = 'block';
          }
        });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }

  renderView() {
    const main = document.getElementById('main-content');
    const h1   = document.querySelector('#app-header h1');
    switch (this.view) {
      case 'home':     main.innerHTML = this._buildHome();     h1.textContent = '記帳本'; break;
      case 'search':   main.innerHTML = this._buildSearch();   h1.textContent = '搜尋';   break;
      case 'settings': main.innerHTML = this._buildSettings(); h1.textContent = '設定';   break;
      case 'backup':   main.innerHTML = this._buildBackup();   h1.textContent = '備份';   break;
    }
    this._attachViewEvents();
  }

  // ─────────────────────────────────────────────────────────
  // HOME VIEW
  // ─────────────────────────────────────────────────────────
  _buildHome() {
    const { calendarYear: y, calendarMonth: m } = this;
    const monthlyExpenses = this.store.getByMonth(y, m);
    const total = monthlyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pendingCount = monthlyExpenses.filter(e => e.status === 'pending').length;
    const datesSet = this.store.getDatesWithExpenses(y, m);

    // Category breakdown for current month
    const catMap = {};
    monthlyExpenses.forEach(e => {
      const k = e.category1 || '未分類';
      catMap[k] = (catMap[k] || 0) + Number(e.amount || 0);
    });
    const catEntries = Object.entries(catMap).sort((a,b) => b[1]-a[1]);

    const dayExpenses = this.store.getByDate(this.selected);
    const dayTotal    = dayExpenses.reduce((s,e) => s + Number(e.amount||0), 0);

    return `
      <!-- Month Navigator -->
      <div class="month-nav">
        <div class="month-nav-title">${fmt.monthLabel(y, m)}</div>
        <div class="month-nav-btns">
          <button class="today-btn" id="goto-today-btn">回到當日</button>
          <button class="icon-btn" id="prev-month-btn">‹</button>
          <button class="icon-btn" id="next-month-btn">›</button>
        </div>
      </div>

      <!-- Calendar -->
      <div class="calendar-wrap">
        ${this._buildCalendar(y, m, datesSet)}
      </div>

      <!-- Monthly Summary -->
      <div class="month-summary">
        <div class="month-summary-title">📊 ${y}/${String(m).padStart(2,'0')} 消費總覽</div>
        <div class="month-stats">
          <div class="stat-item">
            <div class="stat-label">總支出</div>
            <div class="stat-value big">${fmt.money(total)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">筆數</div>
            <div class="stat-value">${monthlyExpenses.length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">待分類</div>
            <div class="stat-value" style="color:${pendingCount>0?'#f87171':'var(--text2)'}">
              ${pendingCount}
            </div>
          </div>
        </div>
        ${catEntries.length ? `
          <div class="divider" style="margin-top:12px;margin-bottom:10px;"></div>
          <div class="cat-breakdown">
            ${catEntries.map(([name, amt]) => `
              <div class="cat-row">
                <div class="cat-row-name">${name}</div>
                <div class="cat-row-bar-wrap">
                  <div class="cat-row-bar" style="width:${Math.round((amt/total)*100)}%"></div>
                </div>
                <div class="cat-row-amount">${fmt.money(amt)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Day Panel -->
      <div class="day-panel">
        <div class="day-panel-header">
          <div class="day-panel-title">
            ${fmt.date(this.selected)}
            ${dayTotal > 0 ? `<span style="color:var(--amber);font-family:var(--font-mono);font-size:13px;margin-left:8px;">${fmt.money(dayTotal)}</span>` : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="invoice-fetch-btn" id="invoice-fetch-btn">
              <span class="icon">🧾</span>發票匯入
            </button>
            <button class="add-btn" id="add-expense-btn">
              <span class="icon">＋</span>記帳
            </button>
          </div>
        </div>
        <div class="expense-list">
          ${dayExpenses.length
            ? dayExpenses.map(e => this._buildExpenseCard(e)).join('')
            : `<div class="empty-state"><div class="icon">📭</div><p>這天還沒有消費記錄</p></div>`
          }
        </div>
      </div>
    `;
  }

  _buildCalendar(year, month, datesSet) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysInPrev  = new Date(year, month - 1, 0).getDate();

    const dowLabels = ['日','一','二','三','四','五','六'];
    let html = '<div class="cal-grid">';
    html += dowLabels.map((d,i) => `<div class="cal-dow" style="${i===0?'color:#f87171':i===6?'color:#60a5fa':''}">${d}</div>`).join('');

    // Prev month trailing days
    for (let i = 0; i < firstDay; i++) {
      const d = daysInPrev - firstDay + 1 + i;
      const dateStr = `${year}-${String(month - 1 || 12).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday    = dateStr === this.today;
      const isSelected = dateStr === this.selected;
      const hasDots    = datesSet.has(dateStr);
      const dow        = new Date(year, month-1, d).getDay();
      const isSun = dow === 0, isSat = dow === 6;

      let cls = 'cal-day';
      if (isToday)    cls += ' today';
      if (isSelected) cls += ' selected';
      if (isSun)      cls += ' is-sun';
      if (isSat)      cls += ' is-sat';

      html += `
        <div class="${cls}" data-date="${dateStr}">
          <div class="cal-day-num">${d}</div>
          <div class="cal-dot-wrap">
            ${hasDots ? '<div class="cal-dot"></div>' : ''}
          </div>
        </div>`;
    }

    // Next month leading days
    const totalCells = firstDay + daysInMonth;
    const remaining  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
    }

    html += '</div>';
    return html;
  }

  _buildExpenseCard(e) {
    const icon = getCatIcon(e.category2 || (e.status === 'pending' ? '待分類' : '其他'));
    const isPending = e.status === 'pending';
    const isInvoice = e.source === 'invoice';
    return `
      <div class="expense-card" data-id="${e.id}">
        <div class="expense-cat-icon">${icon}</div>
        <div class="expense-info">
          <div class="expense-desc">${e.description || '(未命名)'}</div>
          <div class="expense-meta">
            ${e.store ? `<span class="expense-store">🏪 ${e.store}</span>` : ''}
            ${isPending
              ? `<span class="expense-cat-badge pending">待分類</span>`
              : e.category1
                ? `<span class="expense-cat-badge">${e.category1}${e.category2 ? ' · ' + e.category2 : ''}</span>`
                : ''
            }
            ${isInvoice ? `<span class="expense-cat-badge invoice">🧾 發票</span>` : ''}
          </div>
        </div>
        <div class="expense-amount">${fmt.money(e.amount)}</div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────
  // SEARCH VIEW
  // ─────────────────────────────────────────────────────────
  _buildSearch() {
    return `
      <div class="search-wrap">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input id="search-input" class="form-input" style="padding-left:42px;"
            placeholder="搜尋消費項目、店家、分類..." type="search" autocomplete="off">
        </div>
        <div class="search-results-info" id="search-info">輸入關鍵字以搜尋記帳歷史</div>
        <div class="expense-list" id="search-results"></div>
      </div>`;
  }

  _attachSearchEvents() {
    const input = document.getElementById('search-input');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._doSearch(input.value), 250);
    });
    // Delegate expense card clicks in search results
    document.getElementById('search-results')?.addEventListener('click', ev => {
      const card = ev.target.closest('.expense-card[data-id]');
      if (card) this.openExpenseModal(card.dataset.id);
    });
  }

  _doSearch(kw) {
    const results = this.store.search(kw);
    const info    = document.getElementById('search-info');
    const list    = document.getElementById('search-results');
    if (!info || !list) return;
    if (!kw.trim()) {
      info.textContent = '輸入關鍵字以搜尋記帳歷史';
      list.innerHTML   = '';
      return;
    }
    info.textContent = `找到 ${results.length} 筆記錄`;
    list.innerHTML   = results.length
      ? results.map(e => `
          <div class="expense-card" data-id="${e.id}">
            <div class="expense-cat-icon">${getCatIcon(e.category2 || '其他')}</div>
            <div class="expense-info">
              <div class="expense-desc">${e.description || '(未命名)'}</div>
              <div class="expense-meta">
                ${e.store ? `<span class="expense-store">🏪 ${e.store}</span>` : ''}
                <span class="expense-cat-badge" style="color:var(--text3);">${fmt.date(e.date)}</span>
                ${e.status==='pending' ? `<span class="expense-cat-badge pending">待分類</span>` : ''}
                ${e.source==='invoice' ? `<span class="expense-cat-badge invoice">🧾</span>` : ''}
              </div>
            </div>
            <div class="expense-amount">${fmt.money(e.amount)}</div>
          </div>`).join('')
      : `<div class="empty-state"><div class="icon">🔎</div><p>找不到符合的記錄</p></div>`;
  }

  // ─────────────────────────────────────────────────────────
  // SETTINGS VIEW
  // ─────────────────────────────────────────────────────────
  _buildSettings() {
    const s = this.store.data.settings;
    const cats = this.store.data.categories;

    return `
      <div class="settings-wrap">

        <!-- Categories -->
        <div class="settings-section">
          <div class="settings-section-title">分類管理</div>
          <div class="cat-tree" id="cat-tree">
            ${cats.map((cat, ci) => this._buildCatNode(cat, ci)).join('')}
          </div>
          <div style="padding:12px 16px;">
            <button class="btn-primary" id="add-parent-cat-btn" style="width:100%;">＋ 新增大分類</button>
          </div>
        </div>

        <!-- E-Invoice API -->
        <div class="settings-section">
          <div class="settings-section-title">📋 電子發票 API</div>
          <div class="modal-body" style="padding:14px 16px;gap:12px;">
            <div class="form-group">
              <label class="form-label">手機條碼（載具）</label>
              <input class="form-input" id="s-cardNo" placeholder="/XXXXXXX" value="${s.invoiceCardNo || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">驗證碼</label>
              <div class="api-key-wrap">
                <input class="form-input" id="s-cardEnc" type="password" placeholder="請輸入驗證碼" value="${s.invoiceCardEncrypt || ''}">
                <button class="api-key-toggle" data-target="s-cardEnc">👁</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">App ID</label>
              <input class="form-input" id="s-appId" placeholder="財政部核發的 AppID" value="${s.invoiceAppId || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">API Key</label>
              <div class="api-key-wrap">
                <input class="form-input" id="s-apiKey" type="password" placeholder="財政部核發的 API Key" value="${s.invoiceApiKey || ''}">
                <button class="api-key-toggle" data-target="s-apiKey">👁</button>
              </div>
            </div>
            <p style="font-size:11px;color:var(--text3);line-height:1.6;">
              💡 請至<a href="https://www.einvoice.nat.gov.tw/APMEMBERVAN/APIService/Trial" target="_blank" style="color:var(--amber);">財政部電子發票平台</a>申請開發者帳號，取得 AppID 與 API Key。
            </p>
            <button class="btn-primary" id="save-invoice-settings-btn">儲存發票設定</button>
          </div>
        </div>

        <!-- Gemini AI -->
        <div class="settings-section">
          <div class="settings-section-title">🤖 Gemini AI（選用）</div>
          <div class="modal-body" style="padding:14px 16px;gap:12px;">
            <div class="form-group">
              <label class="form-label">Gemini API Key</label>
              <div class="api-key-wrap">
                <input class="form-input" id="s-geminiKey" type="password" placeholder="僅暫存於本機，不會上傳" value="${s.geminiApiKey || ''}">
                <button class="api-key-toggle" data-target="s-geminiKey">👁</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">選擇模型</label>
              <select class="form-select" id="s-geminiModel">
                ${GEMINI_MODELS.map(m => `<option value="${m}" ${s.geminiModel===m?'selected':''}>${m}</option>`).join('')}
              </select>
            </div>
            <p style="font-size:11px;color:var(--text3);line-height:1.6;">
              💡 API Key 僅儲存於本機，不會上傳至任何伺服器。
            </p>
            <button class="btn-primary" id="save-gemini-settings-btn">儲存 AI 設定</button>
          </div>
        </div>

        <!-- Google Drive -->
        <div class="settings-section">
          <div class="settings-section-title">☁️ Google Drive</div>
          <div class="modal-body" style="padding:14px 16px;gap:12px;">
            <div class="form-group">
              <label class="form-label">Google OAuth Client ID</label>
              <input class="form-input" id="s-gClientId" placeholder="xxxx.apps.googleusercontent.com" value="${s.googleClientId || ''}">
            </div>
            <p style="font-size:11px;color:var(--text3);line-height:1.6;">
              💡 請至 <a href="https://console.cloud.google.com" target="_blank" style="color:var(--amber);">Google Cloud Console</a> 建立 OAuth 2.0 用戶端 ID（網頁應用程式），並加入此頁面的網址為授權來源。
            </p>
            <button class="btn-primary" id="save-drive-settings-btn">儲存 Drive 設定</button>
          </div>
        </div>

      </div>`;
  }

  _buildCatNode(cat, ci) {
    return `
      <div class="cat-parent" data-ci="${ci}">
        <div class="cat-parent-row">
          <button class="cat-toggle" data-ci="${ci}">▶</button>
          <div class="cat-parent-name">${cat.name}</div>
          <div class="cat-action-btns">
            <button class="cat-action-btn" data-action="rename-cat" data-ci="${ci}">改名</button>
            <button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button>
          </div>
        </div>
        <div class="cat-children" id="cat-children-${ci}">
          ${(cat.subs || []).map((sub, si) => `
            <div class="cat-child-row" data-ci="${ci}" data-si="${si}">
              <div class="cat-child-name">${getCatIcon(sub)} ${sub}</div>
              <div class="cat-action-btns">
                <button class="cat-action-btn" data-action="rename-sub" data-ci="${ci}" data-si="${si}">改名</button>
                <button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button>
              </div>
            </div>`).join('')}
          <div class="cat-add-row">
            <input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類...">
            <button class="btn-primary" data-action="add-sub" data-ci="${ci}">新增</button>
          </div>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────
  // BACKUP VIEW
  // ─────────────────────────────────────────────────────────
  _buildBackup() {
    const lastSync = this.store.data.lastSync;
    return `
      <div class="backup-wrap">

        <!-- Local -->
        <div class="backup-card">
          <div class="backup-card-title">💾 本機備份</div>
          <div class="backup-card-sub">將目前資料匯出為 JSON 檔案儲存至裝置，或從本機 JSON 檔案匯入。</div>
          <div class="backup-action-row">
            <button class="btn-primary" id="export-local-btn">📤 匯出 JSON</button>
            <button class="btn-secondary" id="import-local-btn">📥 匯入 JSON</button>
          </div>
          <input type="file" id="import-file-input" accept=".json" style="display:none">
        </div>

        <!-- Cloud -->
        <div class="backup-card">
          <div class="backup-card-title">☁️ Google Drive 備份</div>
          <div class="backup-card-sub">
            將資料備份至您的 Google Drive（需先在設定中填寫 Client ID）。<br>
            匯入時可選擇最近五筆備份記錄。
            ${lastSync ? `<br><span class="last-sync-info">最後同步：${lastSync}</span>` : ''}
          </div>
          <div class="backup-action-row">
            <button class="btn-primary" id="drive-upload-btn">☁️ 上傳備份</button>
            <button class="btn-secondary" id="drive-list-btn">📂 載入備份清單</button>
          </div>
          <div id="drive-backup-list" class="backup-list"></div>
        </div>

        <!-- Danger Zone -->
        <div class="backup-card">
          <div class="backup-card-title" style="color:var(--red);">⚠️ 危險操作</div>
          <div class="backup-card-sub">清除所有本機記帳資料，此操作無法復原，請先備份。</div>
          <button class="btn-danger" id="clear-data-btn">清除所有資料</button>
        </div>

      </div>`;
  }

  // ─────────────────────────────────────────────────────────
  // ATTACH EVENTS PER VIEW
  // ─────────────────────────────────────────────────────────
  _attachViewEvents() {
    switch (this.view) {
      case 'home':     this._attachHomeEvents();     break;
      case 'search':   this._attachSearchEvents();   break;
      case 'settings': this._attachSettingsEvents(); break;
      case 'backup':   this._attachBackupEvents();   break;
    }
  }

  _attachHomeEvents() {
    // Calendar day click
    document.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        this.selected = el.dataset.date;
        this.renderView();
        // Smooth scroll to day panel
        setTimeout(() => {
          document.querySelector('.day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      });
    });

    document.getElementById('prev-month-btn')?.addEventListener('click', () => {
      this.calendarMonth--;
      if (this.calendarMonth < 1) { this.calendarMonth = 12; this.calendarYear--; }
      this.renderView();
    });
    document.getElementById('next-month-btn')?.addEventListener('click', () => {
      this.calendarMonth++;
      if (this.calendarMonth > 12) { this.calendarMonth = 1; this.calendarYear++; }
      this.renderView();
    });
    document.getElementById('goto-today-btn')?.addEventListener('click', () => {
      const now = new Date();
      this.calendarYear  = now.getFullYear();
      this.calendarMonth = now.getMonth() + 1;
      this.selected = fmt.today();
      this.today    = fmt.today();
      this.renderView();
    });

    // Expense card click
    document.querySelectorAll('.expense-card[data-id]').forEach(el => {
      el.addEventListener('click', () => this.openExpenseModal(el.dataset.id));
    });
  }

  _attachSettingsEvents() {
    // Category tree toggles
    document.querySelectorAll('.cat-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const ci       = btn.dataset.ci;
        const children = document.getElementById(`cat-children-${ci}`);
        const isOpen   = children.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
        btn.textContent = isOpen ? '▼' : '▶';
      });
    });

    // Category action buttons
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, ci, si } = btn.dataset;
        this._handleCatAction(action, +ci, si !== undefined ? +si : null);
      });
    });

    // Add parent category
    document.getElementById('add-parent-cat-btn')?.addEventListener('click', () => {
      this._promptCatName('新增大分類', '', name => {
        this.store.data.categories.push({ name, subs: [] });
        this.store.save();
        this.renderView();
        this.toast('已新增大分類', 'success');
      });
    });

    // Invoice settings
    document.getElementById('save-invoice-settings-btn')?.addEventListener('click', () => {
      this.store.data.settings.invoiceCardNo      = document.getElementById('s-cardNo').value.trim();
      this.store.data.settings.invoiceCardEncrypt = document.getElementById('s-cardEnc').value.trim();
      this.store.data.settings.invoiceAppId       = document.getElementById('s-appId').value.trim();
      this.store.data.settings.invoiceApiKey      = document.getElementById('s-apiKey').value.trim();
      this.store.save();
      this.toast('發票設定已儲存', 'success');
    });

    // Gemini settings
    document.getElementById('save-gemini-settings-btn')?.addEventListener('click', () => {
      this.store.data.settings.geminiApiKey  = document.getElementById('s-geminiKey').value.trim();
      this.store.data.settings.geminiModel   = document.getElementById('s-geminiModel').value;
      this.store.save();
      this.toast('AI 設定已儲存', 'success');
    });

    // Drive settings
    document.getElementById('save-drive-settings-btn')?.addEventListener('click', () => {
      const clientId = document.getElementById('s-gClientId').value.trim();
      this.store.data.settings.googleClientId = clientId;
      this.store.save();
      if (clientId) this.drive.init(clientId).catch(() => {});
      this.toast('Drive 設定已儲存', 'success');
    });

    // Password toggle
    document.querySelectorAll('.api-key-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '👁' : '🙈';
      });
    });
  }

  _handleCatAction(action, ci, si) {
    const cats = this.store.data.categories;
    if (action === 'rename-cat') {
      this._promptCatName('修改大分類名稱', cats[ci].name, name => {
        cats[ci].name = name;
        this.store.save();
        this.renderView();
        this.toast('已更新', 'success');
      });
    } else if (action === 'del-cat') {
      if (!confirm(`確定刪除「${cats[ci].name}」及其所有小分類？`)) return;
      cats.splice(ci, 1);
      this.store.save();
      this.renderView();
      this.toast('已刪除', 'success');
    } else if (action === 'add-sub') {
      const input = document.getElementById(`sub-input-${ci}`);
      const name  = input?.value.trim();
      if (!name) { this.toast('請輸入名稱', 'error'); return; }
      cats[ci].subs.push(name);
      this.store.save();
      this.renderView();
      this.toast('已新增小分類', 'success');
    } else if (action === 'rename-sub') {
      this._promptCatName('修改小分類名稱', cats[ci].subs[si], name => {
        cats[ci].subs[si] = name;
        this.store.save();
        this.renderView();
        this.toast('已更新', 'success');
      });
    } else if (action === 'del-sub') {
      if (!confirm(`確定刪除「${cats[ci].subs[si]}」？`)) return;
      cats[ci].subs.splice(si, 1);
      this.store.save();
      this.renderView();
      this.toast('已刪除', 'success');
    }
  }

  _promptCatName(title, defaultVal, callback) {
    const name = prompt(title, defaultVal);
    if (name && name.trim()) callback(name.trim());
  }

  _attachBackupEvents() {
    document.getElementById('export-local-btn')?.addEventListener('click', () => this.exportLocal());
    document.getElementById('import-local-btn')?.addEventListener('click', () => {
      document.getElementById('import-file-input')?.click();
    });
    document.getElementById('import-file-input')?.addEventListener('change', e => this.importLocal(e));
    document.getElementById('drive-upload-btn')?.addEventListener('click', () => this.driveUpload());
    document.getElementById('drive-list-btn')?.addEventListener('click', () => this.driveList());
    document.getElementById('clear-data-btn')?.addEventListener('click', () => {
      if (!confirm('確定要清除所有資料嗎？此操作無法復原！')) return;
      if (!confirm('再次確認：所有記帳資料將永久清除。')) return;
      localStorage.removeItem(STORAGE_KEY);
      this.store.data = this.store._default();
      this.toast('已清除所有資料', 'info');
      this.renderView();
    });
  }

  // ─────────────────────────────────────────────────────────
  // EXPENSE MODAL
  // ─────────────────────────────────────────────────────────
  openExpenseModal(id) {
    const expense = id ? this.store.data.expenses.find(e => e.id === id) : null;
    this._editId   = id || null;
    const cats     = this.store.data.categories;
    const isEdit   = !!expense;
    const e        = expense || {
      date:        this.selected,
      description: '',
      store:       '',
      amount:      '',
      category1:   '',
      category2:   '',
      status:      'categorized',
      source:      'manual'
    };

    const cat1Options = cats.map(c =>
      `<option value="${c.name}" ${e.category1===c.name?'selected':''}>${c.name}</option>`
    ).join('');

    const cat2Options = e.category1
      ? (cats.find(c => c.name === e.category1)?.subs || [])
          .map(s => `<option value="${s}" ${e.category2===s?'selected':''}>${s}</option>`).join('')
      : '';

    document.getElementById('modal-content').innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">${isEdit ? '編輯消費' : '新增消費'}</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">日期</label>
          <input class="form-input" type="date" id="f-date" value="${e.date || this.selected}">
        </div>
        <div class="form-group">
          <label class="form-label">金額</label>
          <div class="form-amount-wrap">
            <span class="form-amount-prefix">$</span>
            <input class="form-input amount-input" type="number" id="f-amount" placeholder="0"
              value="${e.amount || ''}" inputmode="decimal" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">消費項目</label>
          <input class="form-input" id="f-desc" placeholder="請輸入消費項目" value="${e.description || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">消費店家</label>
          <input class="form-input" id="f-store" placeholder="例如：7-11、全聯" value="${e.store || ''}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">大分類</label>
            <select class="form-select" id="f-cat1">
              <option value="">-- 選擇 --</option>
              ${cat1Options}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">小分類</label>
            <select class="form-select" id="f-cat2">
              <option value="">-- 選擇 --</option>
              ${cat2Options}
            </select>
          </div>
        </div>
        ${isEdit && e.invoiceNo ? `<div style="font-size:11px;color:var(--text3);">🧾 發票號碼：${e.invoiceNo}</div>` : ''}
      </div>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn-danger" id="modal-delete-btn">刪除</button>` : ''}
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="modal-save-btn">${isEdit ? '儲存' : '新增'}</button>
      </div>`;

    document.getElementById('modal-overlay').classList.remove('hidden');

    // Category cascade
    document.getElementById('f-cat1')?.addEventListener('change', e2 => {
      const cat1 = e2.target.value;
      const subs = cats.find(c => c.name === cat1)?.subs || [];
      const sel  = document.getElementById('f-cat2');
      sel.innerHTML = `<option value="">-- 選擇 --</option>` +
        subs.map(s => `<option value="${s}">${s}</option>`).join('');
    });

    // Close / cancel
    ['modal-close-btn', 'modal-cancel-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => this.closeModal());
    });

    // Save
    document.getElementById('modal-save-btn')?.addEventListener('click', () => {
      const date   = document.getElementById('f-date').value;
      const amount = parseFloat(document.getElementById('f-amount').value);
      const desc   = document.getElementById('f-desc').value.trim();
      const store  = document.getElementById('f-store').value.trim();
      const cat1   = document.getElementById('f-cat1').value;
      const cat2   = document.getElementById('f-cat2').value;

      if (!date)       { this.toast('請選擇日期', 'error'); return; }
      if (isNaN(amount) || amount <= 0) { this.toast('請輸入有效金額', 'error'); return; }
      if (!desc)       { this.toast('請輸入消費項目', 'error'); return; }

      const data = {
        date, amount, description: desc, store, category1: cat1, category2: cat2,
        status: (cat1 && cat2) ? 'categorized' : (e.status === 'pending' ? 'pending' : 'categorized'),
        source: e.source || 'manual',
        invoiceNo: e.invoiceNo || ''
      };

      if (isEdit) {
        this.store.updateExpense(this._editId, data);
        this.toast('已更新', 'success');
      } else {
        this.store.addExpense(data);
        this.toast('已新增', 'success');
        // Update selected date to match the new expense date
        this.selected = date;
        const d = new Date(date);
        this.calendarYear  = d.getFullYear();
        this.calendarMonth = d.getMonth() + 1;
      }
      this.closeModal();
      this.renderView();
    });

    // Delete
    document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
      if (!confirm('確定刪除這筆消費？')) return;
      this.store.deleteExpense(this._editId);
      this.toast('已刪除', 'success');
      this.closeModal();
      this.renderView();
    });

    // Close on overlay click
    document.getElementById('modal-overlay')?.addEventListener('click', e2 => {
      if (e2.target === document.getElementById('modal-overlay')) this.closeModal();
    });
  }

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
    this._editId = null;
  }

  // ─────────────────────────────────────────────────────────
  // INVOICE FETCH
  // ─────────────────────────────────────────────────────────
  async fetchInvoices() {
    const btn = document.getElementById('invoice-fetch-btn');
    if (btn) btn.innerHTML = '<span class="spinner"></span> 查詢中...';

    try {
      const end   = new Date();
      const start = new Date(end); start.setDate(start.getDate() - 90);
      const fmt6  = d => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;

      const result = await this.invoice.fetchInvoices(
        this.store.data.settings,
        fmt6(start),
        fmt6(end)
      );

      const invList = result.details || result.invoiceList || [];
      let imported = 0;

      for (const inv of invList) {
        const invNo = inv.invNum || inv.invoiceNumber || '';
        if (!invNo || this.store.isInvoiceImported(invNo)) continue;

        const rawDate  = inv.invDate || inv.invoiceDate || '';
        const dateStr  = this.invoice.parseInvoiceDate(rawDate.replace(/\//g,''));
        const amount   = Number(inv.amount || inv.invAmount || 0);

        this.store.addExpense({
          date:        dateStr || fmt.today(),
          amount,
          description: inv.sellerName || inv.storeName || `發票 ${invNo}`,
          store:       inv.sellerName || '',
          category1:   '',
          category2:   '',
          status:      'pending',
          source:      'invoice',
          invoiceNo:   invNo
        });
        this.store.markInvoiceImported(invNo);
        imported++;
      }

      this.toast(imported > 0 ? `已匯入 ${imported} 張新發票` : '沒有新的發票', imported > 0 ? 'success' : 'info');
      if (imported > 0) this.renderView();
    } catch (err) {
      this.toast(`發票查詢失敗：${err.message}`, 'error');
    } finally {
      if (btn) btn.innerHTML = '<span class="icon">🧾</span>發票匯入';
    }
  }

  // ─────────────────────────────────────────────────────────
  // BACKUP: LOCAL
  // ─────────────────────────────────────────────────────────
  exportLocal() {
    const data = this.store.export();
    data._exportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cost-record-backup-${fmt.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('已匯出備份', 'success');
  }

  importLocal(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw = JSON.parse(e.target.result);
        // Show preview of last 5 expenses
        const preview = (raw.expenses || []).slice(-5).reverse();
        const msg = preview.length
          ? `備份包含 ${(raw.expenses||[]).length} 筆記錄\n最近 5 筆：\n` +
            preview.map(ex => `• ${ex.date} ${ex.description} ${ex.amount}`).join('\n') +
            '\n\n確定要匯入此備份？'
          : '確定匯入此備份？';
        if (!confirm(msg)) return;
        this.store.import(raw);
        this.toast('備份匯入成功', 'success');
        this.renderView();
      } catch (err) {
        this.toast('匯入失敗：' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // ─────────────────────────────────────────────────────────
  // BACKUP: GOOGLE DRIVE
  // ─────────────────────────────────────────────────────────
  async driveUpload() {
    const btn = document.getElementById('drive-upload-btn');
    if (btn) { btn.textContent = '上傳中...'; btn.disabled = true; }
    try {
      const clientId = this.store.data.settings.googleClientId;
      await this.drive.init(clientId);
      const data = this.store.export();
      data._exportedAt = new Date().toISOString();
      await this.drive.uploadBackup(data);
      this.store.data.lastSync = new Date().toLocaleString('zh-TW');
      this.store.save();
      this.toast('已上傳至 Google Drive', 'success');
      this.renderView();
    } catch (err) {
      this.toast('上傳失敗：' + err.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ 上傳備份'; btn.disabled = false; }
    }
  }

  async driveList() {
    const btn = document.getElementById('drive-list-btn');
    if (btn) { btn.textContent = '載入中...'; btn.disabled = true; }
    const listEl = document.getElementById('drive-backup-list');
    try {
      const clientId = this.store.data.settings.googleClientId;
      await this.drive.init(clientId);
      const files = await this.drive.listBackups();
      if (!listEl) return;
      if (!files.length) {
        listEl.innerHTML = '<p style="font-size:12px;color:var(--text3);padding:8px 0;">尚無雲端備份</p>';
        return;
      }
      listEl.innerHTML = files.slice(0, 5).map(f => `
        <div class="backup-item">
          <div class="backup-item-info">
            <div class="backup-item-name">🗂 ${f.name}</div>
            <div class="backup-item-date">${new Date(f.modifiedTime).toLocaleString('zh-TW')}</div>
          </div>
          <button class="backup-item-btn" data-file-id="${f.id}">匯入</button>
        </div>`).join('');

      listEl.querySelectorAll('.backup-item-btn').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('確定從雲端匯入此備份？本機資料將被覆蓋。')) return;
          b.textContent = '載入中...'; b.disabled = true;
          try {
            const data = await this.drive.downloadBackup(b.dataset.fileId);
            const preview = (data.expenses || []).slice(-5).reverse();
            const msg = `備份包含 ${(data.expenses||[]).length} 筆記錄\n確定匯入？`;
            if (!confirm(msg)) { b.textContent = '匯入'; b.disabled = false; return; }
            this.store.import(data);
            this.toast('已從 Drive 匯入', 'success');
            this.renderView();
          } catch (err) {
            this.toast('匯入失敗：' + err.message, 'error');
            b.textContent = '匯入'; b.disabled = false;
          }
        });
      });
    } catch (err) {
      this.toast('載入失敗：' + err.message, 'error');
    } finally {
      if (btn) { btn.textContent = '📂 載入備份清單'; btn.disabled = false; }
    }
  }

  // ─────────────────────────────────────────────────────────
  // TOAST NOTIFICATION
  // ─────────────────────────────────────────────────────────
  toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.className = ''; }, 2800);
  }
}

// ══════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  window._app = new App();
  window._app.init();
});
