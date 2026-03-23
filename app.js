/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V0.9
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
      lastSync: null,
      storeMapping: []
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
// MAIN APP BELOW

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
function getCatIcon(cat2) { return CAT_ICONS[cat2]||CAT_ICONS['其他']; }

// Color palette for charts
const CHART_COLORS = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];

// ══════════════════════════════════════════════════════════════
// MAIN APP  V0.6
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.store      = new DataStore();
    this.invoice    = new InvoiceService();
    this.csvParser  = new CsvInvoiceParser();
    this.drive      = new DriveService();
    this.view       = 'home';
    this.today      = fmt.today();
    this.selected   = fmt.today();
    this.calendarYear  = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth()+1;
    this.statsYear  = new Date().getFullYear();
    this.statsMonth = new Date().getMonth()+1;
    this.statsCustom = false;
    this.statsSortMode = 'amount-desc'; // 'amount-desc'|'amount-asc'|'date-desc'|'date-asc'
    this._statsOpenCats = new Set(); // preserve expanded state across sorts
    this._toastTimer = null;
    this._editId = null;
    this._swipeStartX = null;
    this._swipeStartY = null;
  }

  // ─── INIT ────────────────────────────────────────────────────
  init() {
    this._setupNav();
    this._setupUpdateBanner();
    this._registerSW();
    this.renderView();
    const {googleClientId}=this.store.data.settings;
    if(googleClientId) this.drive.init(googleClientId).catch(()=>{});
    // Hidden CSV input
    const ci=document.createElement('input');
    ci.type='file';ci.id='csv-invoice-input';ci.accept='.csv';ci.style.display='none';
    document.body.appendChild(ci);
    ci.addEventListener('change',e=>this._handleCsvFile(e));
    // FAB click
    document.addEventListener('click',e=>{
      if(e.target.closest('#nav-add-btn')) this.openExpenseModal(null);
    });
  }

  _setupNav() {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const v=btn.dataset.view;
        this.view=v;
        document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
        this.renderView();
      });
    });
  }

  _setupUpdateBanner() {
    document.getElementById('update-banner')?.addEventListener('click',()=>{
      navigator.serviceWorker?.controller?.postMessage({type:'SKIP_WAITING'});
      window.location.reload();
    });
  }

  _registerSW() {
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js').then(reg=>{
      reg.addEventListener('updatefound',()=>{
        reg.installing?.addEventListener('statechange',()=>{
          if(reg.installing?.state==='installed'&&navigator.serviceWorker.controller)
            document.getElementById('update-banner').style.display='block';
        });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange',()=>window.location.reload());
  }

  renderView() {
    const main=document.getElementById('main-content');
    const h1=document.querySelector('#app-header h1');
    main.classList.toggle('home-mode', this.view==='home');
    switch(this.view) {
      case 'home':     main.innerHTML=this._buildHome();     h1.textContent='記帳本'; break;
      case 'search':   main.innerHTML=this._buildSearch();   h1.textContent='搜尋';   break;
      case 'settings': main.innerHTML=this._buildSettings(); h1.textContent='設定';   break;
      case 'stats':    main.innerHTML=this._buildStats();    h1.textContent='統計';   break;
    }
    this._attachViewEvents();
  }

  // ─── HOME ─────────────────────────────────────────────────────
  _buildHome() {
    const {calendarYear:y,calendarMonth:m}=this;
    const monthly=this.store.getByMonth(y,m);
    const total=monthly.reduce((s,e)=>s+Number(e.amount||0),0);
    const pending=monthly.filter(e=>e.status==='pending').length;
    const datesSet=this.store.getDatesWithExpenses(y,m);
    const catMap={};
    monthly.forEach(e=>{const k=e.category1||'未分類';catMap[k]=(catMap[k]||0)+Number(e.amount||0);});
    const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    const day=this.store.getByDate(this.selected);
    const dayTotal=day.reduce((s,e)=>s+Number(e.amount||0),0);
    const pendingEl=pending>0
      ?`<span class="pending-badge" id="pending-badge">${pending}</span>`
      :`<span style="color:var(--text2)">${pending}</span>`;
    const groups=this._groupExpenses(day);
    return `
      <div class="home-top">
        <div class="month-nav">
          <div class="month-nav-title">${fmt.monthLabel(y,m)}</div>
          <div class="month-nav-btns">
            <button class="today-btn" id="goto-today-btn">今日</button>
            <button class="icon-btn" id="prev-month-btn">‹</button>
            <button class="icon-btn" id="next-month-btn">›</button>
          </div>
        </div>
        <div class="cal-swipe-wrap" id="cal-swipe-wrap">
          <div class="calendar-wrap">${this._buildCalendar(y,m,datesSet)}</div>
        </div>
        <div class="month-summary">
          <div class="month-stats">
            <div class="stat-item"><div class="stat-label">當月支出</div><div class="stat-value big">${fmt.money(total)}</div></div>
            <div class="stat-item"><div class="stat-label">筆數</div><div class="stat-value">${monthly.length}</div></div>
            <div class="stat-item"><div class="stat-label">待分類</div><div class="stat-value">${pendingEl}</div></div>
          </div>
          ${catEntries.length?`<div class="cat-breakdown">${catEntries.slice(0,3).map(([name,amt])=>`
            <div class="cat-row">
              <div class="cat-row-name">${name}</div>
              <div class="cat-row-bar-wrap"><div class="cat-row-bar" style="width:${Math.round((amt/total)*100)}%"></div></div>
              <div class="cat-row-amount">${fmt.money(amt)}</div>
            </div>`).join('')}</div>`:''}
        </div>
      </div>
      <div class="home-bottom">
        <div class="day-panel-header">
          <div class="day-panel-title">
            ${fmt.date(this.selected)}
            ${dayTotal>0?`<span class="day-total-amt">${fmt.money(dayTotal)}</span>`:''}
          </div>
          <div style="display:flex;gap:5px;">
            <button class="btn-day-action btn-import" id="invoice-fetch-btn">🧾 發票</button>
            <button class="btn-day-action btn-add" id="add-expense-btn">＋ 記帳</button>
          </div>
        </div>
        <div class="expense-list">
          ${groups.length
            ?groups.map(g=>g.type==='invoice-group'?this._buildGroupCard(g):this._buildSingleCard(g)).join('')
            :`<div class="empty-state"><div class="icon">📭</div><p>這天沒有消費記錄</p></div>`}
        </div>
      </div>`;
  }


  _groupExpenses(expenses) {
    const result=[],invMap=new Map();
    const sorted=[...expenses].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
    for(const e of sorted){
      if(e.source==='invoice'&&e.invoiceNo){
        if(!invMap.has(e.invoiceNo)){
          const g={type:'invoice-group',invoiceNo:e.invoiceNo,store:e.store||'',date:e.date,items:[]};
          invMap.set(e.invoiceNo,g);result.push(g);
        }
        invMap.get(e.invoiceNo).items.push(e);
      } else {
        result.push({type:'single',...e});
      }
    }
    return result;
  }

  _buildGroupCard(g) {
    const total=g.items.reduce((s,i)=>s+Number(i.amount||0),0);
    const pendingN=g.items.filter(i=>i.status==='pending').length;
    const cats=[...new Set(g.items.filter(i=>i.category1).map(i=>i.category1))];
    const first=g.items[0];
    const moreCount=g.items.length-1;
    return `
      <div class="ref-card" data-grp="${g.invoiceNo}">
        <div class="ref-card-icon">${this._storeIcon(g.store)}</div>
        <div class="ref-card-body">
          <div class="ref-card-title">${g.store||'電子發票'}</div>
          <div class="ref-card-sub">${first?.description||'(未命名)'}${moreCount>0?` <span class="ref-more">+${moreCount}項</span>`:''}</div>
          <div class="ref-card-tags">
            ${pendingN>0?`<span class="ref-tag pending">待分類${pendingN>1?' '+pendingN:''}</span>`:''}
            ${cats.slice(0,2).map(c=>`<span class="ref-tag">${c}</span>`).join('')}
            <span class="ref-tag inv">🧾</span>
          </div>
        </div>
        <div class="ref-card-right">
          <div class="ref-card-amount">${fmt.money(total)}</div>
          <div class="ref-card-count">${g.items.length} 項</div>
        </div>
      </div>`;
  }

  _buildSingleCard(e) {
    const icon=getCatIcon(e.category2||(e.status==='pending'?'待分類':'其他'));
    const title=e.category2||e.category1||(e.status==='pending'?'待分類':'未分類');
    return `
      <div class="ref-card" data-id="${e.id}">
        <div class="ref-card-icon">${icon}</div>
        <div class="ref-card-body">
          <div class="ref-card-title">${title}</div>
          <div class="ref-card-sub">${e.description||'(未命名)'}</div>
          <div class="ref-card-tags">
            ${e.status==='pending'?`<span class="ref-tag pending">待分類</span>`:''}
            ${e.category1&&e.status!=='pending'?`<span class="ref-tag">${e.category1}</span>`:''}
            ${e.source==='invoice'?`<span class="ref-tag inv">🧾</span>`:''}
            ${e.store?`<span class="ref-tag store">🏪 ${e.store}</span>`:''}
          </div>
        </div>
        <div class="ref-card-right">
          <div class="ref-card-amount">${fmt.money(e.amount)}</div>
        </div>
      </div>`;
  }

  _storeIcon(store) {
    if(!store) return '🧾';
    const s=store.toLowerCase();
    if(s.includes('全家')||s.includes('family')) return '🏪';
    if(s.includes('7-11')||s.includes('統一')) return '🏪';
    if(s.includes('全聯')||s.includes('家福')) return '🛒';
    if(s.includes('大創')||s.includes('daiso')) return '🛍️';
    if(s.includes('麥當勞')) return '🍔';
    if(s.includes('星巴克')) return '☕';
    return '🧾';
  }

  _getWeekNum(year,month,day) {
    // US week number: week 1 contains Jan 1, weeks start on Sunday
    const date=new Date(year,month-1,day);
    const jan1=new Date(year,0,1);
    const jan1dow=jan1.getDay(); // 0=Sun
    const dayOfYear=Math.round((date-jan1)/86400000);
    return Math.floor((dayOfYear+jan1dow)/7)+1;
  }

  _buildCalendar(year,month,datesSet) {
    const first=new Date(year,month-1,1).getDay();
    const days=new Date(year,month,0).getDate();
    const prevDays=new Date(year,month-1,0).getDate();
    const dows=['日','一','二','三','四','五','六'];
    // Grid has 8 cols: week-num + 7 days
    let h='<div class="cal-grid-wk">';
    // Header row: blank week col + day headers
    h+='<div class="cal-dow cal-wk-hdr">週</div>';
    h+=dows.map(d=>`<div class="cal-dow">${d}</div>`).join('');

    // Always render exactly 6 rows = 42 cells (fixed height, no jump between months)
    const FIXED_ROWS = 6;
    const totalRows = FIXED_ROWS;

    for(let row=0;row<totalRows;row++){
      // Determine the Sunday date for this row to get week number
      const rowStartCell=row*7; // 0-based
      // Which actual date is cell rowStartCell?
      let wkYear=year,wkMonth=month,wkDay;
      const cellDayOfMonth=rowStartCell-first+1;
      if(cellDayOfMonth<1){
        // in prev month
        const prevDate=new Date(year,month-2,prevDays+cellDayOfMonth);
        wkYear=prevDate.getFullYear();wkMonth=prevDate.getMonth()+1;wkDay=prevDate.getDate();
      } else if(cellDayOfMonth>days){
        // in next month
        const nextDate=new Date(year,month,cellDayOfMonth-days);
        wkYear=nextDate.getFullYear();wkMonth=nextDate.getMonth()+1;wkDay=nextDate.getDate();
      } else {
        wkDay=cellDayOfMonth;
      }
      const wkNum=this._getWeekNum(wkYear,wkMonth,wkDay);
      h+=`<div class="cal-wk-num">WK${wkNum}</div>`;

      // 7 day cells for this row
      for(let col=0;col<7;col++){
        const cell=row*7+col;
        if(cell<first){
          const d=prevDays-first+1+cell;
          h+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
        } else if(cell>=first+days){
          // Next month trailing days (grey out)
          const nextDate=new Date(year,month,cell-first-days+1);
          const d=nextDate.getDate();
          h+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
        } else {
          const d=cell-first+1;
          const ds=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const isT=ds===this.today,isSel=ds===this.selected,hasDot=datesSet.has(ds);
          const dow=new Date(year,month-1,d).getDay();
          let cls='cal-day';
          if(isT) cls+=' today'; if(isSel) cls+=' selected';
          if(dow===0) cls+=' is-sun'; if(dow===6) cls+=' is-sat';
          h+=`<div class="${cls}" data-date="${ds}"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap">${hasDot?'<div class="cal-dot"></div>':''}</div></div>`;
        }
      }
    }
    return h+'</div>';
  }

  // ─── SEARCH ───────────────────────────────────────────────────
  _buildSearch() {
    return `<div class="search-wrap">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input id="search-input" placeholder="搜尋消費項目、店家、分類…" type="search" autocomplete="off" autocorrect="off" autocapitalize="off">
        <button class="search-clear hidden" id="search-clear" title="清除">✕</button>
      </div>
      <div class="search-results-info" id="search-info">輸入關鍵字以搜尋</div>
      <div id="search-results" class="expense-list" style="padding:0;gap:5px;"></div>
    </div>`;
  }

  // ─── SETTINGS ─────────────────────────────────────────────────
  _buildSettings() {
    const s=this.store.data.settings;
    const cats=this.store.data.categories;
    const lastSync=this.store.data.lastSync;
    const storeMap=this.store.data.storeMapping||[];
    return `<div class="settings-wrap">
      <div class="settings-section">
        <div class="settings-section-title">分類管理</div>
        <div class="cat-tree" id="cat-tree">${cats.map((cat,ci)=>this._buildCatNode(cat,ci)).join('')}</div>
        <div style="padding:8px 12px;">
          <button class="btn-primary" id="add-parent-cat-btn" style="width:100%;font-size:12px;">＋ 新增大分類</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🏪 消費店家自動分類</div>
        <div class="settings-item" id="open-store-mapping-btn">
          <div>
            <div class="settings-item-label">店家分類規則</div>
            <div class="settings-item-sub">共 ${storeMap.length} 條規則，匯入發票時自動套用</div>
          </div>
          <span class="settings-item-arrow">›</span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">📋 電子發票 API</div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
          <div class="form-group"><label class="form-label">手機條碼</label>
            <input class="form-input" id="s-cardNo" placeholder="/XXXXXXX" value="${s.invoiceCardNo||''}"></div>
          <div class="form-group"><label class="form-label">驗證碼</label>
            <div class="api-key-wrap"><input class="form-input" id="s-cardEnc" type="password" placeholder="驗證碼" value="${s.invoiceCardEncrypt||''}">
            <button class="api-key-toggle" data-target="s-cardEnc">👁</button></div></div>
          <div class="form-row-2">
            <div class="form-group"><label class="form-label">App ID</label>
              <input class="form-input" id="s-appId" placeholder="AppID" value="${s.invoiceAppId||''}"></div>
            <div class="form-group"><label class="form-label">API Key</label>
              <div class="api-key-wrap"><input class="form-input" id="s-apiKey" type="password" placeholder="Key" value="${s.invoiceApiKey||''}">
              <button class="api-key-toggle" data-target="s-apiKey">👁</button></div></div>
          </div>
          <button class="btn-primary" id="save-invoice-settings-btn" style="font-size:12px;">儲存發票設定</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🤖 Gemini AI</div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
          <div class="form-group"><label class="form-label">API Key</label>
            <div class="api-key-wrap"><input class="form-input" id="s-geminiKey" type="password" placeholder="Gemini API Key" value="${s.geminiApiKey||''}">
            <button class="api-key-toggle" data-target="s-geminiKey">👁</button></div></div>
          <div class="form-group"><label class="form-label">模型</label>
            <select class="form-select" id="s-geminiModel">${GEMINI_MODELS.map(m=>`<option value="${m}" ${s.geminiModel===m?'selected':''}>${m}</option>`).join('')}</select></div>
          <button class="btn-primary" id="save-gemini-settings-btn" style="font-size:12px;">儲存 AI 設定</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">☁️ Google Drive 備份</div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
          <div class="form-group"><label class="form-label">OAuth Client ID</label>
            <input class="form-input" id="s-gClientId" placeholder="xxxx.apps.googleusercontent.com" value="${s.googleClientId||''}"></div>
          <button class="btn-primary" id="save-drive-settings-btn" style="font-size:12px;">儲存</button>
          ${lastSync?`<div class="last-sync-info">上次同步：${lastSync}</div>`:''}
          <div class="backup-action-row">
            <button class="btn-primary" id="drive-upload-btn" style="font-size:12px;">☁️ 上傳備份</button>
            <button class="btn-secondary" id="drive-list-btn" style="font-size:12px;">📂 備份清單</button>
          </div>
          <div id="drive-backup-list" class="backup-list"></div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">💾 本機備份</div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
          <div class="backup-action-row">
            <button class="btn-primary" id="export-local-btn" style="font-size:12px;">📤 匯出 JSON</button>
            <button class="btn-secondary" id="import-local-btn" style="font-size:12px;">📥 匯入 JSON</button>
          </div>
          <input type="file" id="import-file-input" accept=".json" style="display:none">
          <button class="btn-danger" id="clear-data-btn">⚠️ 清除所有資料</button>
        </div>
      </div>
    </div>`;
  }

  _buildCatNode(cat,ci) {
    return `<div class="cat-parent" data-ci="${ci}">
      <div class="cat-parent-row">
        <button class="cat-toggle" data-ci="${ci}">▶</button>
        <div class="cat-parent-name">${cat.name}</div>
        <div class="cat-action-btns">
          <button class="cat-action-btn" data-action="rename-cat" data-ci="${ci}">改名</button>
          <button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button>
        </div>
      </div>
      <div class="cat-children" id="cat-children-${ci}">
        ${(cat.subs||[]).map((sub,si)=>`
          <div class="cat-child-row" data-ci="${ci}" data-si="${si}">
            <div class="cat-child-name">${getCatIcon(sub)} ${sub}</div>
            <div class="cat-action-btns">
              <button class="cat-action-btn" data-action="rename-sub" data-ci="${ci}" data-si="${si}">改名</button>
              <button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button>
            </div>
          </div>`).join('')}
        <div class="cat-add-row">
          <input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類…">
          <button class="btn-primary" data-action="add-sub" data-ci="${ci}" style="padding:5px 11px;font-size:11px;">新增</button>
        </div>
      </div>
    </div>`;
  }

  // ─── STATS ────────────────────────────────────────────────────
  _buildStats() {
    return `<div class="stats-wrap">
      <div class="stats-month-nav">
        <button class="stats-month-btn" id="stats-prev">‹</button>
        <div class="stats-month-display" id="stats-month-label">${this.statsYear} 年 ${this.statsMonth} 月</div>
        <button class="stats-month-btn" id="stats-next">›</button>
        <button class="stats-custom-btn${this.statsCustom?' active':''}" id="stats-custom-btn">自訂</button>
      </div>
      <div class="stats-custom-range${this.statsCustom?' open':''}" id="stats-custom-range">
        <input class="stats-range-input" type="date" id="stats-from" value="${this._statsFromDefault()}">
        <span class="stats-range-sep">—</span>
        <input class="stats-range-input" type="date" id="stats-to" value="${fmt.today()}">
        <button class="stats-range-btn" id="stats-range-apply">套用</button>
      </div>
      <div id="stats-content"></div>
    </div>`;
  }

  _statsFromDefault() {
    return `${this.statsYear}-${String(this.statsMonth).padStart(2,'0')}-01`;
  }

  _renderStats(expenses) {
    const total=expenses.reduce((s,e)=>s+Number(e.amount||0),0);
    // Build cat maps
    const catMap={};
    const subMap={};
    const catExpenses={};
    expenses.forEach(e=>{
      const k1=e.category1||'未分類';
      catMap[k1]=(catMap[k1]||0)+Number(e.amount||0);
      if(!catExpenses[k1]) catExpenses[k1]=[];
      catExpenses[k1].push(e);
      const k2=k1+'||'+(e.category2||'(未分小類)');
      if(!subMap[k2]) subMap[k2]={amount:0,items:[]};
      subMap[k2].amount+=Number(e.amount||0);
      subMap[k2].items.push(e);
    });
    const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);

    const el=document.getElementById('stats-content');
    if(!el) return;

    // Sort cat entries
    const sortedCatEntries = (() => {
      const e = [...catEntries];
      if(this.statsSortMode==='amount-desc') return e.sort((a,b)=>b[1]-a[1]);
      if(this.statsSortMode==='amount-asc')  return e.sort((a,b)=>a[1]-b[1]);
      const latestDate = (name)=> (catExpenses[name]||[]).reduce((mx,x)=>x.date>mx?x.date:mx,'');
      if(this.statsSortMode==='date-desc') return e.sort((a,b)=>latestDate(b[0]).localeCompare(latestDate(a[0])));
      if(this.statsSortMode==='date-asc')  return e.sort((a,b)=>latestDate(a[0]).localeCompare(latestDate(b[0])));
      return e.sort((a,b)=>b[1]-a[1]);
    })();

    el.innerHTML=`
      <div class="stats-total-card">
        <div class="stats-total-label">總支出</div>
        <div class="stats-total-amt">${fmt.money(total)}</div>
        <div class="stats-total-sub">${expenses.length} 筆記錄</div>
      </div>

      <div class="stats-chart-row">
        <div class="stats-pie-wrap">
          <canvas id="stats-pie" width="160" height="160"></canvas>
        </div>
        <div class="stats-legend" id="stats-legend">
          ${catEntries.map(([name,amt],i)=>{
            const pct=total>0?((amt/total)*100).toFixed(1):0;
            return `<div class="stats-legend-item">
              <span class="stats-cat-dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>
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

      <div class="stats-cat-list" id="stats-cat-list">
        ${sortedCatEntries.length?sortedCatEntries.map(([name,amt],i)=>{
          const pct=total>0?((amt/total)*100).toFixed(1):0;
          const color=CHART_COLORS[catEntries.findIndex(([n])=>n===name)%CHART_COLORS.length];
          // sub-categories for this cat
          const subs=Object.entries(subMap).filter(([k])=>k.startsWith(name+'||')).sort((a,b)=>b[1].amount-a[1].amount);
          return `<div class="stats-cat-item" data-cat="${name}">
            <div class="stats-cat-header">
              <span class="stats-cat-dot-big" style="background:${color}"></span>
              <span class="stats-cat-name">${name}</span>
              <div class="stats-cat-bar-wrap"><div class="stats-cat-bar" style="width:${pct}%;background:${color}"></div></div>
              <span class="stats-cat-pct">${pct}%</span>
              <span class="stats-cat-amt">${fmt.money(amt)}</span>
              <span class="stats-cat-toggle">▼</span>
            </div>
            <div class="stats-cat-sub-list" id="scat-${name.replace(/\s/g,'_')}">
              ${subs.map(([k,sd])=>{
                const subName=k.split('||')[1];
                const sp=total>0?((sd.amount/total)*100).toFixed(1):0;
                const sortedItems=(()=>{
                  const it=[...sd.items];
                  if(this.statsSortMode==='amount-desc') return it.sort((a,b)=>Number(b.amount)-Number(a.amount));
                  if(this.statsSortMode==='amount-asc')  return it.sort((a,b)=>Number(a.amount)-Number(b.amount));
                  if(this.statsSortMode==='date-asc')    return it.sort((a,b)=>a.date.localeCompare(b.date));
                  return it.sort((a,b)=>b.date.localeCompare(a.date));
                })();
                return `<div class="stats-sub-cat-header">
                    <span class="stats-sub-cat-label">${subName}</span>
                    <span class="stats-sub-cat-pct">${sp}%</span>
                    <span class="stats-sub-cat-amt">${fmt.money(sd.amount)}</span>
                  </div>
                  ${sortedItems.map(it=>`
                    <div class="stats-expense-row" data-id="${it.id}">
                      <span class="stats-expense-date">${fmt.date(it.date)}</span>
                      <span class="stats-expense-desc">${it.description||'(未命名)'}</span>
                      ${it.store?`<span class="stats-expense-store">${it.store}</span>`:''}
                      <span class="stats-expense-amt">${fmt.money(it.amount)}</span>
                    </div>`).join('')}`;
              }).join('')}
            </div>
          </div>`;
        }).join(''):`<div class="empty-state"><div class="icon">📊</div><p>此期間無記錄</p></div>`}
      </div>`;

    // Draw donut pie with sub-segments
    requestAnimationFrame(()=>this._drawPie(catEntries,subMap,total));
  }

  _drawPie(catEntries,subMap,total) {
    const canvas=document.getElementById('stats-pie');
    if(!canvas||!catEntries.length){canvas&&(canvas.style.display='none');return;}
    const ctx=canvas.getContext('2d');
    const cx=80,cy=80,outerR=72,innerR=42,midR=58;
    ctx.clearRect(0,0,160,160);
    let angle=-Math.PI/2;

    catEntries.forEach(([name,amt],i)=>{
      const color=CHART_COLORS[i%CHART_COLORS.length];
      const catSlice=total>0?(amt/total)*Math.PI*2:0;
      // Draw outer ring: sub-categories within this slice
      const subs=Object.entries(subMap).filter(([k])=>k.startsWith(name+'||')).sort((a,b)=>b[1].amount-a[1].amount);
      if(subs.length>1){
        let subAngle=angle;
        subs.forEach(([,sd],si)=>{
          const subSlice=total>0?(sd.amount/total)*Math.PI*2:0;
          const alpha=0.6+0.4*(1-si/subs.length);
          ctx.beginPath(); ctx.moveTo(cx,cy);
          ctx.arc(cx,cy,outerR,subAngle,subAngle+subSlice); ctx.closePath();
          ctx.fillStyle=color+'CC';
          // Alternate shade
          const shade=si%2===0?color:`${color}88`;
          ctx.fillStyle=shade;
          ctx.fill();
          ctx.strokeStyle='#181825'; ctx.lineWidth=1.5; ctx.stroke();
          // Inner separator line for sub
          if(si>0){
            ctx.beginPath(); ctx.moveTo(cx,cy);
            ctx.lineTo(cx+Math.cos(subAngle)*outerR, cy+Math.sin(subAngle)*outerR);
            ctx.strokeStyle='rgba(24,24,37,.8)'; ctx.lineWidth=1; ctx.stroke();
          }
          subAngle+=subSlice;
        });
      } else {
        ctx.beginPath(); ctx.moveTo(cx,cy);
        ctx.arc(cx,cy,outerR,angle,angle+catSlice); ctx.closePath();
        ctx.fillStyle=color; ctx.fill();
        ctx.strokeStyle='#181825'; ctx.lineWidth=1.5; ctx.stroke();
      }
      angle+=catSlice;
    });

    // Donut hole
    ctx.beginPath(); ctx.arc(cx,cy,innerR,0,Math.PI*2);
    ctx.fillStyle='#181825'; ctx.fill();

    // Center text
    ctx.fillStyle='#eeeef8'; ctx.textAlign='center';
    ctx.font='bold 11px DM Mono,monospace';
    ctx.fillText(fmt.money(total),cx,cy+4);
  }

  // ─── VIEW EVENTS ──────────────────────────────────────────────
  _attachViewEvents() {
    switch(this.view){
      case 'home':     this._attachHomeEvents();     break;
      case 'search':   this._attachSearchEvents();   break;
      case 'settings': this._attachSettingsEvents(); break;
      case 'stats':    this._attachStatsEvents();    break;
    }
  }

  _attachHomeEvents() {
    // Calendar click
    document.querySelectorAll('.cal-day[data-date]').forEach(el=>{
      el.addEventListener('click',()=>{
        this.selected=el.dataset.date;
        this.renderView();
        setTimeout(()=>document.querySelector('.home-bottom')?.scrollTo({top:0,behavior:'smooth'}),50);
      });
    });
    // Month navigation
    document.getElementById('prev-month-btn')?.addEventListener('click',()=>this._changeMonth(-1));
    document.getElementById('next-month-btn')?.addEventListener('click',()=>this._changeMonth(1));
    document.getElementById('goto-today-btn')?.addEventListener('click',()=>{
      const now=new Date();
      this.calendarYear=now.getFullYear(); this.calendarMonth=now.getMonth()+1;
      this.selected=fmt.today(); this.today=fmt.today(); this.renderView();
    });
    // Calendar swipe
    this._attachSwipe(document.getElementById('cal-swipe-wrap'));
    // ref-card: single→edit, group→open group detail sheet
    document.querySelectorAll('.ref-card[data-id]').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();this.openExpenseModal(el.dataset.id);});
    });
    document.querySelectorAll('.ref-card[data-grp]').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();this._openInvoiceGroupSheet(el.dataset.grp);});
    });
    // Pending badge
    document.getElementById('pending-badge')?.addEventListener('click',()=>this._openPendingModal());
    // Day panel buttons
    document.getElementById('add-expense-btn')?.addEventListener('click',()=>this.openExpenseModal(null));
    document.getElementById('invoice-fetch-btn')?.addEventListener('click',()=>this.openInvoiceImportModal());
  }

  _changeMonth(delta) {
    const dir = delta > 0 ? 'left' : 'right';
    const wrap = document.getElementById('cal-swipe-wrap');
    if(wrap){
      wrap.classList.add('cal-exit-'+dir);
      setTimeout(()=>{
        this.calendarMonth+=delta;
        if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;}
        if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;}
        this.renderView();
        // enter animation
        const newWrap=document.getElementById('cal-swipe-wrap');
        if(newWrap){
          newWrap.classList.add('cal-enter-'+dir);
          requestAnimationFrame(()=>requestAnimationFrame(()=>{newWrap.classList.remove('cal-enter-'+dir);}));
        }
      },160);
    } else {
      this.calendarMonth+=delta;
      if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;}
      if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;}
      this.renderView();
    }
  }

  _attachSwipe(el) {
    if(!el) return;
    el.addEventListener('touchstart',e=>{
      this._swipeStartX=e.touches[0].clientX;
      this._swipeStartY=e.touches[0].clientY;
    },{passive:true});
    el.addEventListener('touchend',e=>{
      if(this._swipeStartX===null) return;
      const dx=e.changedTouches[0].clientX-this._swipeStartX;
      const dy=e.changedTouches[0].clientY-this._swipeStartY;
      if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){
        this._changeMonth(dx<0?1:-1);
      }
      this._swipeStartX=null; this._swipeStartY=null;
    },{passive:true});
  }

  _attachSearchEvents() {
    const input=document.getElementById('search-input');
    const clearBtn=document.getElementById('search-clear');
    if(!input) return;
    let timer;
    input.addEventListener('input',()=>{
      clearTimeout(timer);
      clearBtn?.classList.toggle('hidden',!input.value);
      timer=setTimeout(()=>this._doSearch(input.value),200);
    });
    clearBtn?.addEventListener('click',()=>{
      input.value='';
      clearBtn.classList.add('hidden');
      document.getElementById('search-info').textContent='輸入關鍵字以搜尋';
      document.getElementById('search-results').innerHTML='';
    });
    document.getElementById('search-results')?.addEventListener('click',ev=>{
      const card=ev.target.closest('[data-id]');
      if(card) this.openExpenseModal(card.dataset.id);
    });
    // Prevent zoom on focus - handled by CSS font-size:16px
  }

  _doSearch(kw) {
    const results=this.store.search(kw);
    const info=document.getElementById('search-info');
    const list=document.getElementById('search-results');
    if(!info||!list) return;
    if(!kw.trim()){info.textContent='輸入關鍵字以搜尋';list.innerHTML='';return;}
    info.textContent=`找到 ${results.length} 筆記錄`;
    list.innerHTML=results.length
      ?results.map(e=>`
        <div class="expense-card" data-id="${e.id}">
          <div class="expense-cat-icon">${getCatIcon(e.category2||'其他')}</div>
          <div class="expense-info">
            <div class="expense-desc">${e.description||'(未命名)'}</div>
            <div class="expense-meta">
              ${e.store?`<span class="expense-store">🏪 ${e.store}</span>`:''}
              <span class="expense-cat-badge" style="color:var(--text3)">${fmt.date(e.date)}</span>
              ${e.status==='pending'?`<span class="expense-cat-badge pending">待分類</span>`:''}
            </div>
          </div>
          <div class="expense-amount">${fmt.money(e.amount)}</div>
        </div>`).join('')
      :`<div class="empty-state"><div class="icon">🔎</div><p>找不到</p></div>`;
  }

  _attachSettingsEvents() {
    // Cat tree toggles
    document.querySelectorAll('.cat-toggle').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const ci=btn.dataset.ci;
        const ch=document.getElementById('cat-children-'+ci);
        const open=ch.classList.toggle('open');
        btn.classList.toggle('open',open);
        btn.textContent=open?'▼':'▶';
      });
    });
    document.querySelectorAll('[data-action]').forEach(btn=>{
      btn.addEventListener('click',()=>this._handleCatAction(btn.dataset.action,+btn.dataset.ci,btn.dataset.si!==undefined?+btn.dataset.si:null));
    });
    document.getElementById('add-parent-cat-btn')?.addEventListener('click',()=>{
      this._promptCatName('新增大分類','',name=>{this.store.data.categories.push({name,subs:[]});this.store.save();this.renderView();this.toast('已新增大分類','success');});
    });
    // Store mapping page
    document.getElementById('open-store-mapping-btn')?.addEventListener('click',()=>this._openStoreMappingPage());
    // Invoice settings
    document.getElementById('save-invoice-settings-btn')?.addEventListener('click',()=>{
      const s=this.store.data.settings;
      s.invoiceCardNo=document.getElementById('s-cardNo').value.trim();
      s.invoiceCardEncrypt=document.getElementById('s-cardEnc').value.trim();
      s.invoiceAppId=document.getElementById('s-appId').value.trim();
      s.invoiceApiKey=document.getElementById('s-apiKey').value.trim();
      this.store.save(); this.toast('已儲存','success');
    });
    document.getElementById('save-gemini-settings-btn')?.addEventListener('click',()=>{
      this.store.data.settings.geminiApiKey=document.getElementById('s-geminiKey').value.trim();
      this.store.data.settings.geminiModel=document.getElementById('s-geminiModel').value;
      this.store.save(); this.toast('已儲存','success');
    });
    document.getElementById('save-drive-settings-btn')?.addEventListener('click',()=>{
      const cid=document.getElementById('s-gClientId').value.trim();
      this.store.data.settings.googleClientId=cid;
      this.store.save();
      if(cid) this.drive.init(cid).catch(()=>{});
      this.toast('已儲存','success');
    });
    document.querySelectorAll('.api-key-toggle').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const inp=document.getElementById(btn.dataset.target);
        if(!inp) return;
        inp.type=inp.type==='password'?'text':'password';
        btn.textContent=inp.type==='password'?'👁':'🙈';
      });
    });
    document.getElementById('export-local-btn')?.addEventListener('click',()=>this.exportLocal());
    document.getElementById('import-local-btn')?.addEventListener('click',()=>document.getElementById('import-file-input')?.click());
    document.getElementById('import-file-input')?.addEventListener('change',e=>this.importLocal(e));
    document.getElementById('drive-upload-btn')?.addEventListener('click',()=>this.driveUpload());
    document.getElementById('drive-list-btn')?.addEventListener('click',()=>this.driveList());
    document.getElementById('clear-data-btn')?.addEventListener('click',()=>{
      if(!confirm('確定清除所有資料？無法復原！')) return;
      if(!confirm('再次確認：永久清除所有記帳資料。')) return;
      localStorage.removeItem(STORAGE_KEY);
      this.store.data=this.store._default();
      this.toast('已清除','info'); this.renderView();
    });
  }

  _handleCatAction(action,ci,si) {
    const cats=this.store.data.categories;
    if(action==='rename-cat') this._promptCatName('修改大分類',cats[ci].name,name=>{cats[ci].name=name;this.store.save();this.renderView();this.toast('已更新','success');});
    else if(action==='del-cat'){if(!confirm(`刪除「${cats[ci].name}」？`))return;cats.splice(ci,1);this.store.save();this.renderView();this.toast('已刪除','success');}
    else if(action==='add-sub'){const inp=document.getElementById('sub-input-'+ci);const n=inp?.value.trim();if(!n){this.toast('請輸入名稱','error');return;}cats[ci].subs.push(n);this.store.save();this.renderView();this.toast('已新增','success');}
    else if(action==='rename-sub') this._promptCatName('修改小分類',cats[ci].subs[si],name=>{cats[ci].subs[si]=name;this.store.save();this.renderView();this.toast('已更新','success');});
    else if(action==='del-sub'){if(!confirm(`刪除「${cats[ci].subs[si]}」？`))return;cats[ci].subs.splice(si,1);this.store.save();this.renderView();this.toast('已刪除','success');}
  }
  _promptCatName(title,def,cb){const n=prompt(title,def);if(n&&n.trim())cb(n.trim());}

  _attachStatsEvents() {
    this._renderStats(this.store.getByMonth(this.statsYear,this.statsMonth));
    document.getElementById('stats-prev')?.addEventListener('click',()=>{
      this.statsMonth--; if(this.statsMonth<1){this.statsMonth=12;this.statsYear--;}
      this.statsCustom=false;
      document.getElementById('stats-month-label').textContent=`${this.statsYear} 年 ${this.statsMonth} 月`;
      document.getElementById('stats-custom-range')?.classList.remove('open');
      document.getElementById('stats-custom-btn')?.classList.remove('active');
      this._renderStats(this.store.getByMonth(this.statsYear,this.statsMonth));
    });
    document.getElementById('stats-next')?.addEventListener('click',()=>{
      this.statsMonth++; if(this.statsMonth>12){this.statsMonth=1;this.statsYear++;}
      this.statsCustom=false;
      document.getElementById('stats-month-label').textContent=`${this.statsYear} 年 ${this.statsMonth} 月`;
      document.getElementById('stats-custom-range')?.classList.remove('open');
      document.getElementById('stats-custom-btn')?.classList.remove('active');
      this._renderStats(this.store.getByMonth(this.statsYear,this.statsMonth));
    });
    document.getElementById('stats-custom-btn')?.addEventListener('click',()=>{
      this.statsCustom=!this.statsCustom;
      document.getElementById('stats-custom-range')?.classList.toggle('open',this.statsCustom);
      document.getElementById('stats-custom-btn')?.classList.toggle('active',this.statsCustom);
    });
    document.getElementById('stats-range-apply')?.addEventListener('click',()=>{
      const from=document.getElementById('stats-from')?.value;
      const to=document.getElementById('stats-to')?.value;
      if(!from||!to){this.toast('請選擇日期區間','error');return;}
      if(from>to){this.toast('起始不能晚於結束','error');return;}
      const exps=this.store.data.expenses.filter(e=>e.date>=from&&e.date<=to);
      document.getElementById('stats-month-label').textContent=`${from} ~ ${to}`;
      this._renderStats(exps);
    });
    // Sort buttons (delegated, re-render)
    document.getElementById('stats-content')?.addEventListener('click',e=>{
      const sortBtn=e.target.closest('.stats-sort-btn');
      if(sortBtn && sortBtn.dataset.sort){
        // Save currently open cats before re-render
        this._statsOpenCats=new Set();
        document.querySelectorAll('.stats-cat-sub-list.open').forEach(el=>{
          const catItem=el.closest('.stats-cat-item');
          if(catItem?.dataset.cat) this._statsOpenCats.add(catItem.dataset.cat);
        });
        this.statsSortMode=sortBtn.dataset.sort;
        const from=document.getElementById('stats-from')?.value||this._statsFromDefault();
        const to=document.getElementById('stats-to')?.value||fmt.today();
        const exps=this.statsCustom
          ?this.store.data.expenses.filter(ex=>ex.date>=from&&ex.date<=to)
          :this.store.getByMonth(this.statsYear,this.statsMonth);
        this._renderStats(exps);
        // Re-open previously open cats
        this._statsOpenCats.forEach(cat=>{
          const id='scat-'+cat.replace(/\s/g,'_');
          const sub=document.getElementById(id);
          const hdr=sub?.closest('.stats-cat-item')?.querySelector('.stats-cat-toggle');
          if(sub){sub.classList.add('open');hdr?.classList.add('open');}
        });
        return;
      }
      // Cat accordion toggle
      const catHeader=e.target.closest('.stats-cat-header');
      if(catHeader){
        const catItem=catHeader.closest('.stats-cat-item');
        const catName=catItem?.dataset.cat;
        if(!catName) return;
        const subList=document.getElementById('scat-'+catName.replace(/\s/g,'_'));
        const tog=catHeader.querySelector('.stats-cat-toggle');
        if(subList){const open=subList.classList.toggle('open');tog?.classList.toggle('open',open);}
        return;
      }
      // Expense row in stats → edit
      const expRow=e.target.closest('.stats-expense-row[data-id]');
      if(expRow) this.openExpenseModal(expRow.dataset.id);
    });
  }

  // ─── INVOICE GROUP EDIT ──────────────────────────────────────
  // Open the whole invoice as ONE editing unit (category applies to all items)
  _openInvoiceGroupSheet(invoiceNo) {
    const items=this.store.data.expenses.filter(e=>e.invoiceNo===invoiceNo);
    if(!items.length) return;
    const total=items.reduce((s,i)=>s+Number(i.amount||0),0);
    const store=items[0]?.store||'電子發票';
    const date=items[0]?.date||fmt.today();
    // Combine all descriptions for the notes field
    const combinedDesc=items.map(it=>`${it.description||'(未命名)'}  $${Number(it.amount||0).toLocaleString('zh-TW')}`).join('\n');
    const firstCat1=items.find(i=>i.category1)?.category1||'';
    const firstCat2=items.find(i=>i.category2)?.category2||'';

    const cats=this.store.data.categories;
    const selectedCat=cats.find(c=>c.name===firstCat1);
    const cat1Html=cats.map(cat=>`
      <button class="edit-cat-btn${firstCat1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${CAT_ICONS[cat.subs?.[0]]||'📁'}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');
    const cat2Html=selectedCat?(selectedCat.subs||[]).map(sub=>`
      <button class="edit-cat-btn${firstCat2===sub?' selected':''}" data-cat1="${selectedCat.name}" data-cat2="${sub}">
        <div class="edit-cat-circle">${getCatIcon(sub)}</div>
        <div class="edit-cat-label">${sub}</div>
      </button>`).join(''):'';

    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');
    content.innerHTML=`
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">${store}</div>
        <button class="modal-topbar-btn confirm" id="grp-save-btn">✓</button>
      </div>
      <div class="modal-body">
        <div class="cat-level-wrap">
          <div class="cat-level-label">大分類（套用至全部 ${items.length} 項）</div>
          <div class="edit-category-row" id="grp-cat1-row">${cat1Html}</div>
          <div class="cat-sub-area${selectedCat?'':' hidden'}" id="grp-cat2-area">
            <div class="cat-level-label" style="padding:6px 8px 2px">小分類</div>
            <div class="edit-category-row" id="grp-cat2-row">${cat2Html}</div>
          </div>
        </div>

        <div class="edit-amount-display" style="pointer-events:none;">
          <span class="edit-amount-currency">TWD</span>
          <input class="edit-amount-input" type="number" id="grp-amount" value="${total}" readonly style="color:var(--text2)">
        </div>

        <div class="edit-field-grid">
          <div class="edit-field"><div class="edit-field-label">日期</div>
            <div class="edit-field-value" style="color:var(--text3)">${fmt.date(date)}</div></div>
          <div class="edit-field"><div class="edit-field-label">消費店家</div>
            <div class="edit-field-value" style="color:var(--text3)">${store}</div></div>
          <div class="edit-field edit-field-full"><div class="edit-field-label">發票號碼</div>
            <div class="edit-field-value" style="color:var(--text3)">${invoiceNo}</div></div>
        </div>

        <div class="edit-notes-area" style="pointer-events:none;">
          <div class="edit-notes-label">消費項目明細（共 ${items.length} 項，${fmt.money(total)}）</div>
          <textarea class="edit-notes-input" id="grp-desc" readonly tabindex="-1" style="color:var(--text2);min-height:80px;max-height:160px;overflow-y:auto;pointer-events:none;" aria-label="發票明細">${combinedDesc}</textarea>
        </div>
      </div>`;

    overlay.classList.remove('hidden');
    backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));

    // Cat1 selection
    document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        const cat1=btn.dataset.cat1;
        const cat=cats.find(c=>c.name===cat1);
        const area=document.getElementById('grp-cat2-area');
        const row=document.getElementById('grp-cat2-row');
        if(cat&&cat.subs?.length){
          row.innerHTML=cat.subs.map(sub=>`
            <button class="edit-cat-btn" data-cat1="${cat1}" data-cat2="${sub}">
              <div class="edit-cat-circle">${getCatIcon(sub)}</div>
              <div class="edit-cat-label">${sub}</div>
            </button>`).join('');
          area.classList.remove('hidden');
          row.querySelectorAll('.edit-cat-btn').forEach(b=>{
            b.addEventListener('click',()=>{row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');});
          });
        } else { area.classList.add('hidden'); }
      });
    });
    document.querySelectorAll('#grp-cat2-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{document.querySelectorAll('#grp-cat2-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');});
    });

    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});

    document.getElementById('grp-save-btn')?.addEventListener('click',()=>{
      const cat1Btn=document.querySelector('#grp-cat1-row .edit-cat-btn.selected');
      const cat2Btn=document.querySelector('#grp-cat2-row .edit-cat-btn.selected');
      const cat1=cat1Btn?.dataset.cat1||'';
      const cat2=cat2Btn?.dataset.cat2||'';
      if(!cat1){this.toast('請選擇大分類','error');return;}
      // Apply to ALL items in this invoice
      items.forEach(it=>{
        this.store.updateExpense(it.id,{category1:cat1,category2:cat2,status:'categorized'});
      });
      this.toast(`✅ 已更新 ${items.length} 筆分類`,'success');
      this.closeModal(()=>this.renderView());
    });
  }

  // ─── STORE MAPPING FULL PAGE ────────────────────────────────
  _openStoreMappingPage() {
    this._smSortMode = this._smSortMode || 'name'; // 'name'|'time'
    const rules = this.store.data.storeMapping || [];
    const sorted = [...rules.entries()].map(([i,r])=>({...r,_idx:i}));
    if(this._smSortMode==='name') sorted.sort((a,b)=>a.store.localeCompare(b.store,'zh-TW'));
    else sorted.sort((a,b)=>(b._idx-a._idx)); // time: newest first

    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');
    content.innerHTML=`
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">店家自動分類</div>
        <button class="modal-topbar-btn confirm" id="sm-add-new-btn" title="新增">＋</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 14px 6px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <span style="font-size:10px;color:var(--text3);">排序：</span>
        <button class="stats-sort-btn${this._smSortMode==='name'?' active':''}" data-sm-sort="name">名稱</button>
        <button class="stats-sort-btn${this._smSortMode==='time'?' active':''}" data-sm-sort="time">新增時間</button>
        <span style="margin-left:auto;font-size:10px;color:var(--text3);">${rules.length} 條規則</span>
      </div>
      <div style="flex:1;overflow-y:auto;min-height:0;padding:6px 0;" id="sm-list-wrap">
        ${sorted.length?sorted.map(r=>`
          <div class="sm-rule-row" data-ridx="${r._idx}">
            <div class="sm-rule-store">${r.store}</div>
            <div class="sm-rule-cats">${r.cat1}${r.cat2?' › '+r.cat2:''}</div>
            <div class="sm-rule-actions">
              <button class="sm-rule-btn edit" data-ridx="${r._idx}">✏️</button>
              <button class="sm-rule-btn del" data-ridx="${r._idx}">🗑</button>
            </div>
          </div>`).join('')
          :`<div class="empty-state"><div class="icon">🏪</div><p>尚無規則，點右上角＋新增</p></div>`}
      </div>`;
    overlay.classList.remove('hidden');
    backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});
    document.getElementById('sm-add-new-btn')?.addEventListener('click',()=>{this.closeModal();setTimeout(()=>this._openStoreMappingModal(null),320);});
    document.querySelectorAll('[data-sm-sort]').forEach(btn=>{
      btn.addEventListener('click',()=>{this._smSortMode=btn.dataset.smSort;this.closeModal();setTimeout(()=>this._openStoreMappingPage(),320);});
    });
    document.querySelectorAll('.sm-rule-btn.edit').forEach(btn=>{
      btn.addEventListener('click',e=>{e.stopPropagation();const idx=+btn.dataset.ridx;this.closeModal();setTimeout(()=>this._openStoreMappingModal(idx),320);});
    });
    document.querySelectorAll('.sm-rule-btn.del').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        const idx=+btn.dataset.ridx;
        if(!confirm(`刪除「${this.store.data.storeMapping[idx]?.store}」規則？`)) return;
        this.store.data.storeMapping.splice(idx,1);
        this.store.save();this.toast('已刪除','success');
        this.closeModal();setTimeout(()=>this._openStoreMappingPage(),320);
      });
    });
  }

  // ─── STORE MAPPING MODAL ──────────────────────────────────────
  _openStoreMappingModal(existingIdx) {
    const cats=this.store.data.categories;
    const catOptions=cats.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
    const existing=existingIdx!==null?this.store.data.storeMapping[existingIdx]:null;
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">🏪 店家自動分類規則</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <p style="font-size:11px;color:var(--text2);line-height:1.7;">
          設定後，當匯入發票資料時，符合店家名稱（支援部分匹配）的消費將自動套用對應分類。
        </p>
        <div class="form-group">
          <label class="form-label">店家名稱（關鍵字）</label>
          <input class="form-input" id="sm-store" placeholder="例如：全聯、麥當勞、IKEA" value="${existing?.store||''}">
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">大分類</label>
            <select class="form-select" id="sm-cat1">
              <option value="">-- 選擇 --</option>${catOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">小分類</label>
            <select class="form-select" id="sm-cat2" disabled>
              <option value="">-- 選擇 --</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="sm-save-btn">儲存規則</button>
      </div>`);
    const sel1=document.getElementById('sm-cat1');
    const sel2=document.getElementById('sm-cat2');
    if(existing){sel1.value=existing.cat1;this._populateSelect2(sel1.value,sel2,existing.cat2);}
    sel1.addEventListener('change',()=>this._populateSelect2(sel1.value,sel2,''));
    document.getElementById('sm-save-btn')?.addEventListener('click',()=>{
      const store=document.getElementById('sm-store').value.trim();
      const cat1=sel1.value;const cat2=sel2.value;
      if(!store||!cat1){this.toast('請填寫店家名稱與大分類','error');return;}
      const rule={store,cat1,cat2};
      if(!this.store.data.storeMapping) this.store.data.storeMapping=[];
      if(existingIdx!==null) this.store.data.storeMapping[existingIdx]=rule;
      else this.store.data.storeMapping.push(rule);
      this.store.save();this.toast('規則已儲存','success');this.closeModal(()=>this.renderView());
    });
  }

  _populateSelect2(cat1,sel2,selectedCat2) {
    const cats=this.store.data.categories;
    const subs=cats.find(c=>c.name===cat1)?.subs||[];
    sel2.innerHTML='<option value="">-- 選擇 --</option>'+subs.map(s=>`<option value="${s}" ${s===selectedCat2?'selected':''}>${s}</option>`).join('');
    sel2.disabled=!subs.length;
  }

  // ─── EXPENSE MODAL ────────────────────────────────────────────
  openExpenseModal(id) {
    const expense=id?this.store.data.expenses.find(e=>e.id===id):null;
    this._editId=id||null;
    const cats=this.store.data.categories;
    const isEdit=!!expense;
    const e=expense||{date:this.selected,description:'',store:'',amount:'',category1:'',category2:'',status:'categorized',source:'manual'};

    // Two-level: first show cat1 circles, then cat2
    const cat1CirclesHtml=cats.map((cat,i)=>`
      <button class="edit-cat-btn${e.category1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${CAT_ICONS[cat.subs?.[0]]||'📁'}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');

    const selectedCat=cats.find(c=>c.name===e.category1);
    const cat2CirclesHtml=selectedCat?(selectedCat.subs||[]).map(sub=>`
      <button class="edit-cat-btn${e.category2===sub?' selected':''}" data-cat1="${selectedCat.name}" data-cat2="${sub}">
        <div class="edit-cat-circle">${getCatIcon(sub)}</div>
        <div class="edit-cat-label">${sub}</div>
      </button>`).join(''):'';

    const invItems=(isEdit&&e.invoiceNo)?this.store.getInvoiceItems(e.invoiceNo):[];
    const invHtml=invItems.length>1?`
      <div class="inv-items-section">
        <div class="inv-items-section-title">同張發票 · ${e.invoiceNo}</div>
        ${invItems.map(it=>`
          <div class="inv-item-row ${it.id===e.id?'inv-item-current':''}" ${it.id!==e.id?`data-inv-id="${it.id}"`:''}>
            <span class="inv-item-name">${it.description||'(未命名)'}</span>
            <span class="inv-item-amt">${fmt.money(it.amount)}</span>
            ${it.id===e.id?`<span class="inv-item-current-badge">本筆</span>`:`<span class="inv-item-cat${it.status==='pending'?' pending':''}">${it.status==='pending'?'待分類':(it.category1||'未分類')}</span>`}
          </div>`).join('')}
      </div>`:'';

    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');
    content.innerHTML=`
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">${isEdit?'編輯消費':'新增消費'}</div>
        <button class="modal-topbar-btn confirm" id="modal-save-btn">✓</button>
      </div>
      <div class="modal-body">
        <!-- Level 1: 大分類 -->
        <div class="cat-level-wrap">
          <div class="cat-level-label">大分類</div>
          <div class="edit-category-row" id="cat1-row">${cat1CirclesHtml}</div>
          <!-- Level 2: 小分類 (shown after cat1 selected) -->
          <div class="cat-sub-area${selectedCat?'':' hidden'}" id="cat2-area">
            <div class="cat-level-label" style="padding:6px 8px 2px">小分類</div>
            <div class="edit-category-row" id="cat2-row">${cat2CirclesHtml}</div>
          </div>
        </div>

        <div class="edit-amount-display">
          <span class="edit-amount-currency">TWD</span>
          <input class="edit-amount-input" type="number" id="f-amount" placeholder="0"
            value="${e.amount||''}" inputmode="decimal" min="0">
        </div>

        <div class="edit-field-grid">
          <div class="edit-field"><div class="edit-field-label">日期</div>
            <input class="edit-field-value" type="date" id="f-date" value="${e.date||this.selected}"></div>
          <div class="edit-field"><div class="edit-field-label">消費店家</div>
            <input class="edit-field-value" id="f-store" placeholder="店家名稱" value="${e.store||''}"></div>
          ${isEdit&&e.invoiceNo?`<div class="edit-field edit-field-full"><div class="edit-field-label">發票號碼</div><div class="edit-field-value" style="color:var(--text3)">${e.invoiceNo}</div></div>`:''}
        </div>

        <div class="edit-notes-area">
          <div class="edit-notes-label">消費項目說明</div>
          <textarea class="edit-notes-input" id="f-desc" placeholder="請輸入消費項目說明" style="max-height:120px;overflow-y:auto;">${e.description||''}</textarea>
        </div>

        ${invHtml}
        ${isEdit?`<button class="edit-delete-btn" id="modal-delete-btn">🗑 刪除這筆消費</button>`:''}
      </div>`;

    overlay.classList.remove('hidden');
    backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));

    // Cat1 selection → show cat2
    document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        const cat1=btn.dataset.cat1;
        const cat=cats.find(c=>c.name===cat1);
        const area=document.getElementById('cat2-area');
        const row=document.getElementById('cat2-row');
        if(cat&&cat.subs?.length){
          row.innerHTML=cat.subs.map(sub=>`
            <button class="edit-cat-btn" data-cat1="${cat1}" data-cat2="${sub}">
              <div class="edit-cat-circle">${getCatIcon(sub)}</div>
              <div class="edit-cat-label">${sub}</div>
            </button>`).join('');
          area.classList.remove('hidden');
          // Attach cat2 click
          row.querySelectorAll('.edit-cat-btn').forEach(b=>{
            b.addEventListener('click',()=>{
              row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected'));
              b.classList.add('selected');
            });
          });
        } else {
          area.classList.add('hidden');
        }
      });
    });
    // Existing cat2 selection
    document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Invoice item jump
    document.querySelectorAll('.inv-item-row[data-inv-id]').forEach(row=>{
      row.addEventListener('click',()=>{this.closeModal(()=>this.openExpenseModal(row.dataset.invId));});
    });

    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});
    document.getElementById('modal-save-btn')?.addEventListener('click',()=>this._saveExpense(e,isEdit));
    document.getElementById('modal-delete-btn')?.addEventListener('click',()=>{
      if(!confirm('確定刪除這筆消費？'))return;
      this.store.deleteExpense(this._editId);
      this.toast('已刪除','success');this.closeModal(()=>this.renderView());
    });
  }

  _saveExpense(e,isEdit) {
    const date=document.getElementById('f-date')?.value;
    const amount=parseFloat(document.getElementById('f-amount')?.value);
    const desc=document.getElementById('f-desc')?.value.trim();
    const store=document.getElementById('f-store')?.value.trim();
    const cat1Btn=document.querySelector('#cat1-row .edit-cat-btn.selected');
    const cat2Btn=document.querySelector('#cat2-row .edit-cat-btn.selected');
    const cat1=cat1Btn?.dataset.cat1||'';
    const cat2=cat2Btn?.dataset.cat2||'';
    if(!date){this.toast('請選擇日期','error');return;}
    if(isNaN(amount)||amount<=0){this.toast('請輸入有效金額','error');return;}
    if(!desc){this.toast('請輸入消費項目','error');return;}
    const data={date,amount,description:desc,store,category1:cat1,category2:cat2,
      status:cat1?'categorized':'pending',source:e.source||'manual',invoiceNo:e.invoiceNo||''};
    if(isEdit){this.store.updateExpense(this._editId,data);this.toast('已更新','success');}
    else{this.store.addExpense(data);this.toast('已新增','success');this.selected=date;
      const d=new Date(date);this.calendarYear=d.getFullYear();this.calendarMonth=d.getMonth()+1;}
    this.closeModal(()=>this.renderView());
  }

  closeModal(cb) {
    const content=document.getElementById('modal-content');
    const overlay=document.getElementById('modal-overlay');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('slide-in');
    backdrop.classList.remove('visible');
    setTimeout(()=>{
      overlay.classList.add('hidden');
      content.innerHTML='';
      content.classList.remove('sheet-mode');
      this._editId=null;
      if(cb) cb();
    },300);
  }

  // ─── PENDING MODAL ────────────────────────────────────────────
  _openPendingModal() {
    const {calendarYear:y,calendarMonth:m}=this;
    const pending=this.store.getByMonth(y,m).filter(e=>e.status==='pending').sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    if(!pending.length){this.toast('本月沒有待分類項目','info');return;}
    const cats=this.store.data.categories;
    const catOptions=cats.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div class="modal-title">待分類 (${pending.length} 筆)</div>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body-scroll">
        <div style="font-size:10px;color:var(--text3);margin-bottom:7px;">為每筆選擇分類後，點「儲存所有分類」一次完成</div>
        <div id="pending-list" style="display:flex;flex-direction:column;gap:8px;">
          ${pending.map(e=>`
            <div class="pending-row" data-pid="${e.id}">
              <div class="pending-row-top"><div class="pending-desc">${e.description||'(未命名)'}</div><div class="pending-amt">${fmt.money(e.amount)}</div></div>
              <div class="pending-row-meta"><span class="pending-date">${fmt.date(e.date)}</span>${e.store?`<span class="pending-store">🏪 ${e.store}</span>`:''}</div>
              <div class="pending-row-selects">
                <select class="form-select pending-cat1" data-pid="${e.id}"><option value="">大分類</option>${catOptions}</select>
                <select class="form-select pending-cat2" data-pid="${e.id}" disabled><option value="">小分類</option></select>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="pending-save-all-btn">儲存所有分類</button>
      </div>`);
    document.querySelectorAll('.pending-cat1').forEach(sel=>{
      sel.addEventListener('change',()=>{
        const pid=sel.dataset.pid,cat1=sel.value;
        const sel2=document.querySelector(`.pending-cat2[data-pid="${pid}"]`);
        const subs=cats.find(c=>c.name===cat1)?.subs||[];
        sel2.innerHTML='<option value="">小分類</option>'+subs.map(s=>`<option value="${s}">${s}</option>`).join('');
        sel2.disabled=!subs.length;
      });
    });
    document.getElementById('pending-save-all-btn')?.addEventListener('click',()=>{
      let saved=0;
      document.querySelectorAll('.pending-row[data-pid]').forEach(row=>{
        const pid=row.dataset.pid;
        const cat1=row.querySelector(`.pending-cat1[data-pid="${pid}"]`)?.value||'';
        const cat2=row.querySelector(`.pending-cat2[data-pid="${pid}"]`)?.value||'';
        if(!cat1) return;
        this.store.updateExpense(pid,{category1:cat1,category2:cat2,status:'categorized'});
        saved++;
      });
      this.toast(`已更新 ${saved} 筆分類`,'success');this.closeModal(()=>this.renderView());
    });
  }

  // ─── INVOICE IMPORT ───────────────────────────────────────────
  openInvoiceImportModal() {
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">🧾 發票匯入</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="gap:9px;">
        <p style="font-size:11px;color:var(--text2);line-height:1.6;">選擇匯入方式</p>
        <div class="import-choice-card" id="choice-csv">
          <div class="import-choice-icon">📂</div>
          <div><div class="import-choice-title">匯入 CSV 檔案</div><div class="import-choice-sub">從財政部平台下載的 CSV（免 API）</div></div>
          <div class="import-choice-arrow">›</div>
        </div>
        <div class="import-choice-card" id="choice-api">
          <div class="import-choice-icon">☁️</div>
          <div><div class="import-choice-title">財政部 API 查詢</div><div class="import-choice-sub">需設定 AppID / API Key</div></div>
          <div class="import-choice-arrow">›</div>
        </div>
      </div>`);
    document.getElementById('choice-csv')?.addEventListener('click',()=>{this.closeModal();setTimeout(()=>document.getElementById('csv-invoice-input')?.click(),350);});
    document.getElementById('choice-api')?.addEventListener('click',()=>{this.closeModal();this._fetchInvoicesApi();});
  }

  _openSheet(html) {
    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.add('sheet-mode');
    content.innerHTML=html;
    overlay.classList.remove('hidden');
    backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    ['modal-close-btn','modal-cancel-btn'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>this.closeModal()));
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.closeModal();},{once:true});
  }

  // ─── Apply store mapping to imported items ────────────────────
  _applyStoreMapping(storeNameRaw) {
    const rules=this.store.data.storeMapping||[];
    for(const rule of rules){
      if(storeNameRaw.toLowerCase().includes(rule.store.toLowerCase())){
        return {cat1:rule.cat1,cat2:rule.cat2};
      }
    }
    return {cat1:'',cat2:''};
  }

  _handleCsvFile(event) {
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=e=>{
      try {
        const rows=this.csvParser.parse(e.target.result);
        if(!rows.length){this.toast('CSV 中沒有有效資料','error');return;}
        this._showCsvPreviewModal(rows);
      } catch(err){this.toast('CSV 解析失敗：'+err.message,'error');}
    };
    reader.readAsText(file,'utf-8');
    event.target.value='';
  }

  _showCsvPreviewModal(rows) {
    const groups=this.csvParser.groupByInvoice(rows);
    const newRows=rows.filter(r=>!this.store.isInvoiceImported(r.invoiceNo+'_'+r.description));
    const skipCount=rows.length-newRows.length;
    const invoiceHTML=groups.slice(0,20).map(g=>{
      const tot=g.items.reduce((s,r)=>s+r.amount,0);
      const dup=g.items.every(r=>this.store.isInvoiceImported(r.invoiceNo+'_'+r.description));
      return `<div class="csv-invoice-group${dup?' already-imported':''}">
        <div class="csv-inv-header"><span class="csv-inv-no">${g.invoiceNo}</span><span class="csv-inv-store">${g.store}</span><span class="csv-inv-total">$${tot.toLocaleString()}</span>${dup?'<span class="csv-inv-dup">已匯入</span>':''}</div>
        <div class="csv-inv-date">${g.date}</div>
        <div class="csv-inv-items">${g.items.map(r=>`<div class="csv-inv-item"><span class="csv-inv-item-name">${r.description}</span><span class="csv-inv-item-amt">$${r.amount.toLocaleString()}</span></div>`).join('')}</div>
      </div>`;
    }).join('');
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">📋 發票預覽</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="padding-bottom:0;">
        <div class="csv-summary">
          <div><div class="csv-summary-num">${rows.length}</div><div class="csv-summary-label">總品項</div></div>
          <div><div class="csv-summary-num">${groups.length}</div><div class="csv-summary-label">發票</div></div>
          <div><div class="csv-summary-num" style="color:var(--amber)">$${rows.reduce((s,r)=>s+r.amount,0).toLocaleString()}</div><div class="csv-summary-label">總金額</div></div>
          <div><div class="csv-summary-num" style="color:${newRows.length>0?'var(--green)':'var(--text3)'}">${newRows.length}</div><div class="csv-summary-label">待匯入</div></div>
        </div>
        ${skipCount>0?`<div class="csv-skip-note">⚠ ${skipCount} 筆已匯入，將略過</div>`:''}
        <div style="max-height:300px;overflow-y:auto;margin:0 -14px;padding:0 14px 14px;">${invoiceHTML}</div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="csv-confirm-btn" ${newRows.length===0?'disabled':''}>匯入 ${newRows.length} 筆</button>
      </div>`);
    document.getElementById('csv-confirm-btn')?.addEventListener('click',()=>{if(newRows.length)this._importCsvRows(newRows);});
  }

  _importCsvRows(rows) {
    let imported=0;
    for(const r of rows){
      const key=r.invoiceNo+'_'+r.description;
      if(this.store.isInvoiceImported(key)) continue;
      const mapped=this._applyStoreMapping(r.store);
      this.store.addExpense({date:r.date,amount:r.amount,description:r.description,store:r.store,
        category1:mapped.cat1,category2:mapped.cat2,
        status:mapped.cat1?'categorized':'pending',source:'invoice',invoiceNo:r.invoiceNo});
      this.store.markInvoiceImported(key);imported++;
    }
    this.toast(`✅ 已匯入 ${imported} 筆發票明細`,'success');
    if(rows.length>0&&rows[0].date){const d=new Date(rows[0].date);this.calendarYear=d.getFullYear();this.calendarMonth=d.getMonth()+1;this.selected=rows[0].date;}
    this.closeModal(()=>this.renderView());
  }

  async _fetchInvoicesApi() {
    this.toast('連線財政部 API…','info');
    try {
      const end=new Date(),start=new Date(end);start.setDate(start.getDate()-90);
      const f6=d=>`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      const result=await this.invoice.fetchInvoices(this.store.data.settings,f6(start),f6(end));
      const list=result.details||result.invoiceList||[];
      let imported=0;
      for(const inv of list){
        const no=inv.invNum||inv.invoiceNumber||'';
        if(!no||this.store.isInvoiceImported(no)) continue;
        const rawDate=inv.invDate||inv.invoiceDate||'';
        const ds=this.invoice.parseInvoiceDate(rawDate.replace(/\//g,''));
        const mapped=this._applyStoreMapping(inv.sellerName||'');
        this.store.addExpense({date:ds||fmt.today(),amount:Number(inv.amount||inv.invAmount||0),
          description:inv.sellerName||`發票 ${no}`,store:inv.sellerName||'',
          category1:mapped.cat1,category2:mapped.cat2,
          status:mapped.cat1?'categorized':'pending',source:'invoice',invoiceNo:no});
        this.store.markInvoiceImported(no);imported++;
      }
      this.toast(imported>0?`已匯入 ${imported} 張新發票`:'沒有新的發票',imported>0?'success':'info');
      if(imported>0) this.renderView();
    } catch(err){this.toast(`失敗：${err.message}`,'error');}
  }

  // ─── BACKUP ───────────────────────────────────────────────────
  exportLocal() {
    const data=this.store.export();data._exportedAt=new Date().toISOString();
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
    a.download=`cost-record-backup-${fmt.today()}.json`;a.click();URL.revokeObjectURL(url);
    this.toast('已匯出備份','success');
  }
  importLocal(event) {
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=e=>{
      try {
        const raw=JSON.parse(e.target.result);
        const msg=`備份包含 ${(raw.expenses||[]).length} 筆記錄\n確定匯入？`;
        if(!confirm(msg)) return;
        this.store.import(raw);this.toast('備份匯入成功','success');this.renderView();
      } catch(err){this.toast('匯入失敗：'+err.message,'error');}
    };
    reader.readAsText(file);event.target.value='';
  }
  async driveUpload() {
    const btn=document.getElementById('drive-upload-btn');
    if(btn){btn.textContent='上傳中…';btn.disabled=true;}
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const data=this.store.export();data._exportedAt=new Date().toISOString();
      await this.drive.uploadBackup(data);
      this.store.data.lastSync=new Date().toLocaleString('zh-TW');this.store.save();
      this.toast('已上傳至 Google Drive','success');this.renderView();
    } catch(err){this.toast('上傳失敗：'+err.message,'error');}
    finally{if(btn){btn.textContent='☁️ 上傳備份';btn.disabled=false;}}
  }
  async driveList() {
    const btn=document.getElementById('drive-list-btn');
    if(btn){btn.textContent='載入中…';btn.disabled=true;}
    const listEl=document.getElementById('drive-backup-list');
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const files=await this.drive.listBackups();
      if(!listEl) return;
      if(!files.length){listEl.innerHTML='<p style="font-size:10px;color:var(--text3);">尚無雲端備份</p>';return;}
      listEl.innerHTML=files.slice(0,5).map(f=>`
        <div class="backup-item">
          <div class="backup-item-info"><div class="backup-item-name">${f.name}</div><div class="backup-item-date">${new Date(f.modifiedTime).toLocaleString('zh-TW')}</div></div>
          <button class="backup-item-btn" data-file-id="${f.id}">匯入</button>
        </div>`).join('');
      listEl.querySelectorAll('.backup-item-btn').forEach(b=>{
        b.addEventListener('click',async()=>{
          if(!confirm('確定從雲端匯入此備份？本機資料將被覆蓋。'))return;
          b.textContent='載入中…';b.disabled=true;
          try {
            const data=await this.drive.downloadBackup(b.dataset.fileId);
            if(!confirm(`備份包含 ${(data.expenses||[]).length} 筆記錄\n確定匯入？`)){b.textContent='匯入';b.disabled=false;return;}
            this.store.import(data);this.toast('已從 Drive 匯入','success');this.renderView();
          } catch(err){this.toast('匯入失敗：'+err.message,'error');b.textContent='匯入';b.disabled=false;}
        });
      });
    } catch(err){this.toast('載入失敗：'+err.message,'error');}
    finally{if(btn){btn.textContent='📂 備份清單';btn.disabled=false;}}
  }

  // ─── TOAST ────────────────────────────────────────────────────
  toast(msg,type='info') {
    const el=document.getElementById('toast'); if(!el) return;
    el.textContent=msg; el.className=`show ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer=setTimeout(()=>{el.className='';},2800);
  }
}

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{window._app=new App();window._app.init();});
