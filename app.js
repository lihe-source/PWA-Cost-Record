/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V0.4
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
// CSV INVOICE PARSER — 財政部電子發票 CSV 格式
// ══════════════════════════════════════════════════════════════
class CsvInvoiceParser {

  // Parse raw CSV text → array of row objects
  parse(text) {
    // Normalize line endings
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const HEADER_COLS = [
      '載具自訂名稱','發票日期','發票號碼','發票金額','發票狀態',
      '折讓','賣方統一編號','賣方名稱','賣方地址','買方統編',
      '消費明細_數量','消費明細_單價','消費明細_金額','消費明細_品名'
    ];

    const rows = [];
    let headerFound = false;
    let colMap = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Skip footer notes
      if (line.startsWith('捐贈或作廢') || line.startsWith('注意')) continue;

      const cols = this._splitCsv(line);

      // Detect header row
      if (!headerFound) {
        if (cols.some(c => c.includes('發票日期') || c.includes('發票號碼'))) {
          headerFound = true;
          cols.forEach((c, i) => { colMap[c.trim()] = i; });
          continue;
        }
        // Try positional fallback (no header row in file)
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

      // Skip zero/negative item amounts (折扣行)
      if (amount <= 0) continue;
      // Skip invalid dates
      if (!/^\d{8}$/.test(rawDate)) continue;

      rows.push({
        date:      `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`,
        invoiceNo: get('發票號碼'),
        amount,
        description: get('消費明細_品名') || get('賣方名稱') || '(未命名)',
        store:     get('賣方名稱'),
        status:    get('發票狀態'),
        carrier:   get('載具自訂名稱')
      });
    }

    return rows;
  }

  // Group parsed rows by invoice number for preview display
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

  // Minimal CSV split that handles quoted fields
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
    this.csvParser = new CsvInvoiceParser();
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

    // Create hidden CSV file input
    const csvInput = document.createElement('input');
    csvInput.type = 'file'; csvInput.id = 'csv-invoice-input';
    csvInput.accept = '.csv'; csvInput.style.display = 'none';
    document.body.appendChild(csvInput);
    csvInput.addEventListener('change', e => this._handleCsvFile(e));

    // Bind add button (delegated)
    document.addEventListener('click', e => {
      if (e.target.closest('#add-expense-btn')) this.openExpenseModal(null);
      if (e.target.closest('#invoice-fetch-btn')) this.openInvoiceImportModal();
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
    main.classList.toggle('home-mode', this.view === 'home');
    switch (this.view) {
      case 'home':     main.innerHTML = this._buildHome();     h1.textContent = '記帳本'; break;
      case 'search':   main.innerHTML = this._buildSearch();   h1.textContent = '搜尋';   break;
      case 'settings': main.innerHTML = this._buildSettings(); h1.textContent = '設定';   break;
      case 'backup':   main.innerHTML = this._buildBackup();   h1.textContent = '備份';   break;
      case 'stats':    main.innerHTML = this._buildStats();    h1.textContent = '統計';    break;
    }
    this._attachViewEvents();
  }

  // ─────────────────────────────────────────────────────────
  // HOME VIEW
  // ─────────────────────────────────────────────────────────
  _buildHome() {
    const { calendarYear: y, calendarMonth: m } = this;
    const monthlyExpenses = this.store.getByMonth(y, m);
    const total       = monthlyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pendingCount = monthlyExpenses.filter(e => e.status === 'pending').length;
    const datesSet    = this.store.getDatesWithExpenses(y, m);

    const catMap = {};
    monthlyExpenses.forEach(e => {
      const k = e.category1 || '未分類';
      catMap[k] = (catMap[k] || 0) + Number(e.amount || 0);
    });
    const catEntries = Object.entries(catMap).sort((a,b) => b[1]-a[1]);

    const dayExpenses = this.store.getByDate(this.selected);
    const dayTotal    = dayExpenses.reduce((s,e) => s + Number(e.amount||0), 0);

    const pendingClickable = pendingCount > 0
      ? `<span class="pending-badge" id="pending-badge">${pendingCount}</span>`
      : `<span style="color:var(--text2)">${pendingCount}</span>`;

    return `
      <!-- ── HOME TOP (compact, non-scroll) ── -->
      <div class="home-top">

        <!-- Month Navigator -->
        <div class="month-nav">
          <div class="month-nav-title">${fmt.monthLabel(y, m)}</div>
          <div class="month-nav-btns">
            <button class="today-btn" id="goto-today-btn">回到當日</button>
            <button class="icon-btn" id="prev-month-btn">‹</button>
            <button class="icon-btn" id="next-month-btn">›</button>
          </div>
        </div>

        <!-- Compact Calendar -->
        <div class="calendar-wrap">
          ${this._buildCalendar(y, m, datesSet)}
        </div>

        <!-- Monthly Summary (compact) -->
        <div class="month-summary">
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
              <div class="stat-label">待分類 <span style="font-size:9px;color:var(--amber);">(點擊)</span></div>
              <div class="stat-value">${pendingClickable}</div>
            </div>
          </div>
          ${catEntries.length ? `
            <div class="cat-breakdown" style="margin-top:8px;">
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
      </div>

      <!-- ── HOME BOTTOM (independently scrollable) ── -->
      <div class="home-bottom">
        <div class="day-panel-header">
          <div class="day-panel-title">
            ${fmt.date(this.selected)}
            ${dayTotal > 0 ? `<span class="day-total-amt">${fmt.money(dayTotal)}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="invoice-fetch-btn" id="invoice-fetch-btn">
              <span class="icon">🧾</span>發票
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
  // PENDING BATCH CATEGORIZATION MODAL
  // ─────────────────────────────────────────────────────────
  _openPendingModal() {
    const { calendarYear: y, calendarMonth: m } = this;
    const pending = this.store.getByMonth(y, m)
      .filter(e => e.status === 'pending')
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!pending.length) { this.toast('本月沒有待分類項目', 'info'); return; }

    const cats = this.store.data.categories;
    const catOptions = cats.map(c =>
      `<option value="${c.name}">${c.name}</option>`
    ).join('');

    const rows = pending.map(e => `
      <div class="pending-row" data-pid="${e.id}">
        <div class="pending-row-top">
          <div class="pending-desc">${e.description || '(未命名)'}</div>
          <div class="pending-amt">${fmt.money(e.amount)}</div>
        </div>
        <div class="pending-row-meta">
          <span class="pending-date">${fmt.date(e.date)}</span>
          ${e.store ? `<span class="pending-store">🏪 ${e.store}</span>` : ''}
        </div>
        <div class="pending-row-selects">
          <select class="form-select form-select-sm pending-cat1" data-pid="${e.id}">
            <option value="">大分類</option>
            ${catOptions}
          </select>
          <select class="form-select form-select-sm pending-cat2" data-pid="${e.id}" disabled>
            <option value="">小分類</option>
          </select>
        </div>
      </div>`).join('');

    document.getElementById('modal-content').innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">待分類 (${pending.length} 筆)</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body modal-body-scroll" style="padding:0;">
        <div style="padding:10px 16px 4px;font-size:11px;color:var(--text3);">
          為每筆選擇分類後，點「儲存所有分類」一次完成
        </div>
        <div id="pending-list" style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px;">
          ${rows}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="pending-save-all-btn">儲存所有分類</button>
      </div>`;

    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());

    // Cat1 → populate cat2 for each row
    document.querySelectorAll('.pending-cat1').forEach(sel => {
      sel.addEventListener('change', () => {
        const pid  = sel.dataset.pid;
        const cat1 = sel.value;
        const sel2 = document.querySelector(`.pending-cat2[data-pid="${pid}"]`);
        const subs = cats.find(c => c.name === cat1)?.subs || [];
        sel2.innerHTML = '<option value="">小分類</option>' +
          subs.map(s => `<option value="${s}">${s}</option>`).join('');
        sel2.disabled = !subs.length;
      });
    });

    // Save all
    document.getElementById('pending-save-all-btn')?.addEventListener('click', () => {
      let saved = 0;
      document.querySelectorAll('.pending-row[data-pid]').forEach(row => {
        const pid  = row.dataset.pid;
        const cat1 = row.querySelector(`.pending-cat1[data-pid="${pid}"]`)?.value || '';
        const cat2 = row.querySelector(`.pending-cat2[data-pid="${pid}"]`)?.value || '';
        if (!cat1) return;
        this.store.updateExpense(pid, {
          category1: cat1, category2: cat2,
          status: 'categorized'
        });
        saved++;
      });
      this.closeModal();
      this.toast(`已更新 ${saved} 筆分類`, 'success');
      this.renderView();
    });
  }

  // ─────────────────────────────────────────────────────────
  // STATS VIEW — Pie chart + category ranking
  // ─────────────────────────────────────────────────────────
  _buildStats() {
    return `<div class="stats-wrap" id="stats-wrap">
      <div class="stats-period-row">
        <button class="stats-period-btn active" data-period="month">本月</button>
        <button class="stats-period-btn" data-period="3month">近3月</button>
        <button class="stats-period-btn" data-period="6month">近6月</button>
        <button class="stats-period-btn" data-period="all">全部</button>
      </div>
      <div id="stats-content"></div>
    </div>`;
  }

  _renderStats(period) {
    const now   = new Date();
    let expenses;

    if (period === 'month') {
      expenses = this.store.getByMonth(now.getFullYear(), now.getMonth() + 1);
    } else if (period === '3month') {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
      expenses = this.store.data.expenses.filter(e => e.date >= cutoff.toISOString().slice(0,10));
    } else if (period === '6month') {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6);
      expenses = this.store.data.expenses.filter(e => e.date >= cutoff.toISOString().slice(0,10));
    } else {
      expenses = [...this.store.data.expenses];
    }

    const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    // Build category map (cat1 level)
    const catMap = {};
    expenses.forEach(e => {
      const k = e.category1 || '未分類';
      catMap[k] = (catMap[k] || 0) + Number(e.amount || 0);
    });

    // Sub-category map
    const subMap = {};
    expenses.forEach(e => {
      const k1 = e.category1 || '未分類';
      const k2 = e.category2 || '';
      const key = k1 + '||' + (k2 || '(未選小分類)');
      subMap[key] = (subMap[key] || 0) + Number(e.amount || 0);
    });

    const catEntries = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
    const COLORS = ['#f59e0b','#3b82f6','#22c55e','#ef4444','#a855f7','#f97316','#06b6d4','#84cc16'];

    const catItemsHtml = catEntries.map(([name, amt], i) => {
      const pct  = total > 0 ? ((amt / total) * 100).toFixed(1) : 0;
      const color = COLORS[i % COLORS.length];
      // Sub-items for this cat
      const subs = Object.entries(subMap)
        .filter(([k]) => k.startsWith(name + '||'))
        .sort((a,b) => b[1]-a[1]);
      return `
        <div class="stats-cat-item">
          <div class="stats-cat-header">
            <span class="stats-cat-dot" style="background:${color}"></span>
            <span class="stats-cat-name">${name}</span>
            <div style="flex:1;margin:0 10px;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .5s;"></div>
            </div>
            <span class="stats-cat-pct">${pct}%</span>
            <span class="stats-cat-amt">${fmt.money(amt)}</span>
          </div>
          ${subs.length > 1 ? `
            <div class="stats-sub-list">
              ${subs.map(([k, sa]) => {
                const subName = k.split('||')[1];
                const sp = total > 0 ? ((sa/total)*100).toFixed(1) : 0;
                return `<div class="stats-sub-item">
                  <span class="stats-sub-name">${subName}</span>
                  <span class="stats-sub-amt">${fmt.money(sa)}</span>
                  <span class="stats-sub-pct">${sp}%</span>
                </div>`;
              }).join('')}
            </div>` : ''}
        </div>`;
    }).join('');

    const el = document.getElementById('stats-content');
    if (!el) return;

    el.innerHTML = `
      <div class="stats-total-card">
        <div class="stats-total-label">總支出</div>
        <div class="stats-total-amt">${fmt.money(total)}</div>
        <div class="stats-total-sub">${expenses.length} 筆記錄</div>
      </div>

      <canvas id="stats-pie" width="220" height="220" style="display:block;margin:0 auto 8px;"></canvas>

      <div class="stats-legend">
        ${catEntries.map(([name, amt], i) => `
          <div class="stats-legend-item">
            <span class="stats-cat-dot" style="background:${COLORS[i%COLORS.length]}"></span>
            <span>${name}</span>
          </div>`).join('')}
      </div>

      <div class="stats-cat-list">
        ${catItemsHtml || '<div class="empty-state"><div class="icon">📊</div><p>尚無資料</p></div>'}
      </div>`;

    // Draw pie chart
    requestAnimationFrame(() => {
      const canvas = document.getElementById('stats-pie');
      if (!canvas || !catEntries.length) return;
      const ctx = canvas.getContext('2d');
      const cx = 110, cy = 110, r = 85, inner = 48;
      let angle = -Math.PI / 2;

      catEntries.forEach(([, amt], i) => {
        const slice = total > 0 ? (amt / total) * Math.PI * 2 : 0;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, angle, angle + slice);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.stroke();
        angle += slice;
      });

      // Donut hole
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      // Center text
      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 13px DM Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fmt.money(total), cx, cy + 5);
    });
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
      case 'stats':    this._attachStatsEvents();    break;
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

    // Pending badge click → batch categorize modal
    document.getElementById('pending-badge')?.addEventListener('click', () => {
      this._openPendingModal();
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

  _attachStatsEvents() {
    this._renderStats('month');
    document.querySelectorAll('.stats-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.stats-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderStats(btn.dataset.period);
      });
    });
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

    // Build invoice sibling items list
    const invItems = (isEdit && e.invoiceNo)
      ? this.store.getInvoiceItems(e.invoiceNo) : [];
    const invItemsHtml = invItems.length > 1 ? `
      <div class="form-group">
        <label class="form-label">同張發票品項 (${e.invoiceNo})</label>
        <div class="inv-items-list">
          ${invItems.map(it => `
            <div class="inv-item-row ${it.id === e.id ? 'inv-item-current' : ''}" data-inv-id="${it.id}">
              <span class="inv-item-name">${it.description || '(未命名)'}</span>
              <span class="inv-item-amt">${fmt.money(it.amount)}</span>
              ${it.id !== e.id ? `<span class="inv-item-cat ${it.status==='pending'?'pending':''}">${it.status==='pending'?'待分類':(it.category1?it.category1+(it.category2?'·'+it.category2:''):'')}</span>` : '<span class="inv-item-current-badge">本筆</span>'}
            </div>`).join('')}
        </div>
      </div>` : '';

    document.getElementById('modal-content').innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">${isEdit ? '編輯消費' : '新增消費'}</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body modal-body-scroll">
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">日期</label>
            <input class="form-input form-input-sm" type="date" id="f-date" value="${e.date || this.selected}">
          </div>
          <div class="form-group">
            <label class="form-label">金額</label>
            <div class="form-amount-wrap">
              <span class="form-amount-prefix">$</span>
              <input class="form-input form-input-sm amount-input" type="number" id="f-amount" placeholder="0"
                value="${e.amount || ''}" inputmode="decimal" min="0">
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">消費店家</label>
          <input class="form-input form-input-sm" id="f-store" placeholder="例如：7-11、全聯" value="${e.store || ''}">
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">大分類</label>
            <select class="form-select form-select-sm" id="f-cat1">
              <option value="">-- 選擇 --</option>
              ${cat1Options}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">小分類</label>
            <select class="form-select form-select-sm" id="f-cat2">
              <option value="">-- 選擇 --</option>
              ${cat2Options}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">消費項目</label>
          <input class="form-input form-input-sm" id="f-desc" placeholder="請輸入消費項目" value="${e.description || ''}">
        </div>
        ${invItemsHtml}
      </div>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn-danger" id="modal-delete-btn">刪除</button>` : ''}
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="modal-save-btn">${isEdit ? '儲存' : '新增'}</button>
      </div>`;

    document.getElementById('modal-overlay').classList.remove('hidden');

    // Invoice item row click → switch to that expense
    document.querySelectorAll('.inv-item-row[data-inv-id]').forEach(row => {
      if (row.classList.contains('inv-item-current')) return;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        this.closeModal();
        this.openExpenseModal(row.dataset.invId);
      });
    });

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
  // INVOICE IMPORT — Choice Modal
  // ─────────────────────────────────────────────────────────
  openInvoiceImportModal() {
    document.getElementById('modal-content').innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">🧾 發票匯入</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <p style="font-size:13px;color:var(--text2);line-height:1.7;">
          請選擇匯入方式。<br>
          若尚未申請財政部 API，可使用「匯入 CSV 檔」方式。
        </p>

        <!-- CSV import card -->
        <div class="import-choice-card" id="choice-csv">
          <div class="import-choice-icon">📂</div>
          <div class="import-choice-info">
            <div class="import-choice-title">匯入 CSV 檔案</div>
            <div class="import-choice-sub">從財政部電子發票平台下載的 CSV 檔案匯入（免申請 API）</div>
          </div>
          <div class="import-choice-arrow">›</div>
        </div>

        <!-- API fetch card -->
        <div class="import-choice-card" id="choice-api">
          <div class="import-choice-icon">☁️</div>
          <div class="import-choice-info">
            <div class="import-choice-title">財政部 API 自動查詢</div>
            <div class="import-choice-sub">需先在設定填寫 AppID / API Key（可查近 90 天）</div>
          </div>
          <div class="import-choice-arrow">›</div>
        </div>

        <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;">
          <div style="font-size:11px;color:var(--text3);line-height:1.8;">
            📋 <strong style="color:var(--text2);">如何下載 CSV？</strong><br>
            1. 登入 <a href="https://www.einvoice.nat.gov.tw" target="_blank" style="color:var(--amber);">財政部電子發票平台</a><br>
            2. 左側「雲端發票」→「消費明細下載」<br>
            3. 選擇月份 → 下載 CSV 格式
          </div>
        </div>
      </div>`;

    document.getElementById('modal-overlay').classList.remove('hidden');

    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay')?.addEventListener('click', e2 => {
      if (e2.target === document.getElementById('modal-overlay')) this.closeModal();
    });

    document.getElementById('choice-csv')?.addEventListener('click', () => {
      this.closeModal();
      document.getElementById('csv-invoice-input')?.click();
    });

    document.getElementById('choice-api')?.addEventListener('click', () => {
      this.closeModal();
      this._fetchInvoicesApi();
    });
  }

  // ─────────────────────────────────────────────────────────
  // CSV INVOICE IMPORT
  // ─────────────────────────────────────────────────────────
  _handleCsvFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = this.csvParser.parse(e.target.result);
        if (!rows.length) { this.toast('CSV 中沒有找到有效的發票資料', 'error'); return; }
        this._showCsvPreviewModal(rows);
      } catch (err) {
        this.toast('CSV 解析失敗：' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  }

  _showCsvPreviewModal(rows) {
    const groups   = this.csvParser.groupByInvoice(rows);
    const newRows  = rows.filter(r => !this.store.isInvoiceImported(r.invoiceNo + '_' + r.description));
    const skipCount = rows.length - newRows.length;

    const invoiceHTML = groups.slice(0, 20).map(g => {
      const invTotal = g.items.reduce((s, r) => s + r.amount, 0);
      const alreadyImported = g.items.every(r =>
        this.store.isInvoiceImported(r.invoiceNo + '_' + r.description)
      );
      return `
        <div class="csv-invoice-group ${alreadyImported ? 'already-imported' : ''}">
          <div class="csv-inv-header">
            <span class="csv-inv-no">${g.invoiceNo}</span>
            <span class="csv-inv-store">${g.store}</span>
            <span class="csv-inv-total">$${invTotal.toLocaleString()}</span>
            ${alreadyImported ? '<span class="csv-inv-dup">已匯入</span>' : ''}
          </div>
          <div class="csv-inv-date">${g.date}</div>
          <div class="csv-inv-items">
            ${g.items.map(r => `
              <div class="csv-inv-item">
                <span class="csv-inv-item-name">${r.description}</span>
                <span class="csv-inv-item-amt">$${r.amount.toLocaleString()}</span>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    document.getElementById('modal-content').innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">📋 發票明細預覽</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body" style="padding-bottom:0;">
        <div class="csv-summary">
          <div class="csv-summary-item">
            <div class="csv-summary-num">${rows.length}</div>
            <div class="csv-summary-label">總品項</div>
          </div>
          <div class="csv-summary-item">
            <div class="csv-summary-num">${groups.length}</div>
            <div class="csv-summary-label">張發票</div>
          </div>
          <div class="csv-summary-item">
            <div class="csv-summary-num" style="color:var(--amber);">$${rows.reduce((s,r)=>s+r.amount,0).toLocaleString()}</div>
            <div class="csv-summary-label">總金額</div>
          </div>
          <div class="csv-summary-item">
            <div class="csv-summary-num" style="color:${newRows.length>0?'var(--green)':'var(--text3)'};">${newRows.length}</div>
            <div class="csv-summary-label">待匯入</div>
          </div>
        </div>
        ${skipCount > 0 ? `<div class="csv-skip-note">⚠️ ${skipCount} 筆已匯入過，將自動略過</div>` : ''}
        <div style="max-height:340px;overflow-y:auto;margin:0 -18px;padding:0 18px 16px;">
          ${invoiceHTML}
          ${groups.length > 20 ? `<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px;">...還有 ${groups.length-20} 張發票</div>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="csv-confirm-btn" ${newRows.length===0?'disabled style="opacity:.5;"':''}>
          匯入 ${newRows.length} 筆
        </button>
      </div>`;

    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());

    document.getElementById('csv-confirm-btn')?.addEventListener('click', () => {
      if (newRows.length === 0) return;
      this._importCsvRows(newRows);
    });
  }

  _importCsvRows(rows) {
    let imported = 0;
    for (const r of rows) {
      const key = r.invoiceNo + '_' + r.description;
      if (this.store.isInvoiceImported(key)) continue;
      this.store.addExpense({
        date:        r.date,
        amount:      r.amount,
        description: r.description,
        store:       r.store,
        category1:   '',
        category2:   '',
        status:      'pending',
        source:      'invoice',
        invoiceNo:   r.invoiceNo
      });
      this.store.markInvoiceImported(key);
      imported++;
    }
    this.closeModal();
    this.toast(`✅ 已匯入 ${imported} 筆發票明細`, 'success');
    // Jump calendar to the month of first imported item
    if (rows.length > 0 && rows[0].date) {
      const d = new Date(rows[0].date);
      this.calendarYear  = d.getFullYear();
      this.calendarMonth = d.getMonth() + 1;
      this.selected      = rows[0].date;
    }
    this.renderView();
  }

  // ─────────────────────────────────────────────────────────
  // INVOICE FETCH via API (original flow)
  // ─────────────────────────────────────────────────────────
  async _fetchInvoicesApi() {
    this.toast('連線財政部 API...', 'info');
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

        const rawDate = inv.invDate || inv.invoiceDate || '';
        const dateStr = this.invoice.parseInvoiceDate(rawDate.replace(/\//g,''));
        const amount  = Number(inv.amount || inv.invAmount || 0);

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
