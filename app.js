/* app.js */
'use strict';

const STORAGE_KEY   = 'cost_record_v1';
const DRIVE_PREFIX  = 'cost-record-backup';
const DEFAULT_CATEGORIES = [
  { name: '平日消費', subs: ['早餐', '午餐', '晚餐', '點心', '飲料'] },
  { name: '家庭消費', subs: ['市場', '家電', '出遊'] }
];
const CAT_ICONS = {
  '早餐': '🍳', '午餐': '🍱', '晚餐': '🍜', '點心': '🧁', '飲料': '🧋',
  '市場': '🛒', '家電': '📺', '出遊': '🚗',
  '待分類': '📋', '其他': '💰'
};
const GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.0-pro'];

class DataStore {
  constructor() { this.data = this._load(); }
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.error('Load error', e); }
    return this._default();
  }
  _default() {
    return {
      schemaVersion: 1, expenses: [], categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      settings: { geminiApiKey: '', geminiModel: 'gemini-1.5-flash', googleClientId: '' },
      importedInvoiceNos: [], lastSync: null, storeMapping: []
    };
  }
  save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
  addExpense(exp) {
    exp.id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    exp.createdAt = new Date().toISOString();
    this.data.expenses.push(exp); this.save(); return exp;
  }
  updateExpense(id, updates) {
    const idx = this.data.expenses.findIndex(e => e.id === id);
    if (idx < 0) return null;
    this.data.expenses[idx] = { ...this.data.expenses[idx], ...updates, updatedAt: new Date().toISOString() };
    this.save(); return this.data.expenses[idx];
  }
  deleteExpense(id) { this.data.expenses = this.data.expenses.filter(e => e.id !== id); this.save(); }
  getByDate(dateStr) { return this.data.expenses.filter(e => e.date === dateStr).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.data.expenses.filter(e => e.date && e.date.startsWith(prefix));
  }
  getDatesWithExpenses(year, month) {
    const set = new Set(); this.getByMonth(year, month).forEach(e => set.add(e.date)); return set;
  }
  search(kw) {
    if (!kw || kw.trim() === '') return [...this.data.expenses];
    const q = kw.toLowerCase();
    return this.data.expenses.filter(e =>
      (e.description||'').toLowerCase().includes(q) || (e.store||'').toLowerCase().includes(q) ||
      (e.category1||'').toLowerCase().includes(q) || (e.category2||'').toLowerCase().includes(q) ||
      (e.invoiceNo||'').toLowerCase().includes(q)
    ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  getInvoiceItems(invoiceNo) { return invoiceNo ? this.data.expenses.filter(e => e.invoiceNo === invoiceNo) : []; }
  isInvoiceImported(invNo) { return this.data.importedInvoiceNos.includes(invNo); }
  markInvoiceImported(invNo) {
    if (!this.data.importedInvoiceNos.includes(invNo)) { this.data.importedInvoiceNos.push(invNo); this.save(); }
  }
  export() { return JSON.parse(JSON.stringify(this.data)); }
  import(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('無效的備份格式');
    this.data = { ...this._default(), ...raw }; this.save();
  }
}

class CsvInvoiceParser {
  parse(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const HEADER_COLS = ['載具自訂名稱','發票日期','發票號碼','發票金額','發票狀態','折讓','賣方統一編號','賣方名稱','賣方地址','買方統編','消費明細_數量','消費明細_單價','消費明細_金額','消費明細_品名'];
    const rows = []; let headerFound = false, colMap = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('捐贈或作廢') || line.startsWith('注意')) continue;
      const cols = this._splitCsv(line);

      if (!headerFound) {
        if (cols.some(c => c.includes('發票日期') || c.includes('發票號碼'))) {
          headerFound = true; cols.forEach((c, i) => { colMap[c.trim()] = i; }); continue;
        }
        if (cols.length >= 14 && /^\d{8}$/.test(cols[1])) {
          headerFound = true; HEADER_COLS.forEach((h, i) => { colMap[h] = i; });
        } else continue;
      }
      if (cols.length < 4) continue;
      const get = key => (cols[colMap[key]] || '').trim();
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
      if (!map.has(r.invoiceNo)) map.set(r.invoiceNo, { invoiceNo: r.invoiceNo, date: r.date, store: r.store, items: [] });
      map.get(r.invoiceNo).items.push(r);
    }
    return [...map.values()];
  }
  _splitCsv(line) {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur); return result;
  }
}

class DriveService {
  constructor() { this.token = null; this._ready = false; }
  async init(clientId) {
    if (this._ready || !clientId) return;
    this.clientId = clientId; await this._loadGIS(); this._ready = true;
  }
  _loadGIS() {
    if (window.google && window.google.accounts) return Promise.resolve();
    return new Promise(resolve => {
      if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
        const wait = setInterval(() => { if (window.google && window.google.accounts) { clearInterval(wait); resolve(); } }, 100);
        return;
      }
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = resolve; document.head.appendChild(s);
    });
  }
  async getToken() {
    if (this.token) return this.token;
    if (!this.clientId) throw new Error('請先在設定中填寫 Google Client ID');
    await this._loadGIS();
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId, scope: 'https://www.googleapis.com/auth/drive.file',
        callback: r => r.error ? reject(new Error(r.error)) : resolve((this.token = r.access_token))
      });
      tc.requestAccessToken({ prompt: 'select_account' });
    });
  }
  async listBackups() {
    const token = await this.getToken();
    const q = encodeURIComponent(`name contains '${DRIVE_PREFIX}' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size)`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    return (await res.json()).files || [];
  }
  async uploadBackup(data) {
    const token = await this.getToken();
    const fileName = `${DRIVE_PREFIX}-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const boundary = '-------cost_record_backup';
    const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name: fileName, mimeType: 'application/json' }), `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(data, null, 2), `--${boundary}--`].join('\r\n');
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    return res.json();
  }
  async downloadBackup(fileId) {
    const token = await this.getToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    return res.json();
  }
}

const fmt = {
  money: n => `$${Number(n||0).toLocaleString('zh-TW')}`,
  date: d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${y}/${m}/${day}`; },
  monthLabel: (y,m) => `${y} 年 ${m} 月`,
  today: () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
};
function getCatIcon(cat2) { return CAT_ICONS[cat2]||CAT_ICONS['其他']; }
const CHART_COLORS = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];

class App {
  constructor() {
    this.store = new DataStore(); this.csvParser = new CsvInvoiceParser(); this.drive = new DriveService();
    this.view = 'home'; this.today = fmt.today(); this.selected = fmt.today();
    this.calendarYear = new Date().getFullYear(); this.calendarMonth = new Date().getMonth()+1;
    this.statsYear = new Date().getFullYear(); this.statsMonth = new Date().getMonth()+1;
    this.statsCustom = false; this.statsSortMode = 'amount-desc';
    this._statsOpenCats = new Set(); this._toastTimer = null; this._editId = null;
    this._isDarkMode = localStorage.getItem('theme') !== 'light';
  }

  async init() {
    this._checkForUpdates();
    this._setupNav();
    this._registerSW();
    this.renderView();
    if(this.store.data.settings.googleClientId) this.drive.init(this.store.data.settings.googleClientId).catch(()=>{});
    
    const ci = document.createElement('input'); ci.type='file'; ci.id='csv-invoice-input'; ci.accept='.csv'; ci.style.display='none';
    const mc = document.createElement('input'); mc.type='file'; mc.id='moze-csv-input'; mc.accept='.csv'; mc.style.display='none';
    document.body.appendChild(ci); document.body.appendChild(mc);
    ci.addEventListener('change', e => this._handleCsvFile(e));
    mc.addEventListener('change', e => this._handleMozeCsvFile(e));

    document.addEventListener('click', e => { if(e.target.closest('#nav-add-btn')) this.openExpenseModal(null); });
    this._applyTheme(this._isDarkMode);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      this._isDarkMode = !this._isDarkMode; localStorage.setItem('theme', this._isDarkMode ? 'dark' : 'light'); this._applyTheme(this._isDarkMode);
    });
  }

  async _checkForUpdates() {
    try {
      const res = await fetch('./version.js?t=' + Date.now());
      const text = await res.text();
      const match = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
      if (match && match[1] !== APP_VERSION) {
         if (navigator.serviceWorker && navigator.serviceWorker.controller) {
           navigator.serviceWorker.controller.postMessage({type: 'SKIP_WAITING'});
         }
         const banner = document.getElementById('update-banner');
         if(banner) { banner.style.display = 'block'; setTimeout(()=>window.location.reload(), 1500); }
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
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn=>{
      btn.addEventListener('click', () => {
        this.view=btn.dataset.view; document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===this.view)); this.renderView();
      });
    });
  }

  _registerSW() {
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js').then(reg=>{
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => {
          if(reg.installing?.state==='installed' && navigator.serviceWorker.controller) {
             navigator.serviceWorker.controller.postMessage({type: 'SKIP_WAITING'});
             document.getElementById('update-banner').style.display='block';
             setTimeout(()=>window.location.reload(), 1500);
          }
        });
      });
    });
  }

  renderView() {
    const main=document.getElementById('main-content'), h1=document.querySelector('#app-header h1');
    main.classList.toggle('home-mode', this.view==='home');
    switch(this.view) {
      case 'home':     main.innerHTML=this._buildHome();     h1.textContent='記帳本'; break;
      case 'search':   main.innerHTML=this._buildSearch();   h1.textContent='搜尋';   break;
      case 'settings': main.innerHTML=this._buildSettings(); h1.textContent='設定';   break;
      case 'stats':    main.innerHTML=this._buildStats();    h1.textContent='統計';   break;
    }
    this._attachViewEvents();
  }

  _buildHome() {
    const {calendarYear:y,calendarMonth:m}=this; const monthly=this.store.getByMonth(y,m);
    const total=monthly.reduce((s,e)=>s+Number(e.amount||0),0), pending=monthly.filter(e=>e.status==='pending').length;
    const datesSet=this.store.getDatesWithExpenses(y,m), catMap={};
    monthly.forEach(e=>{const k=e.category1||'未分類';catMap[k]=(catMap[k]||0)+Number(e.amount||0);});
    const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]), day=this.store.getByDate(this.selected);
    const dayTotal=day.reduce((s,e)=>s+Number(e.amount||0),0);
    const groups=this._groupExpenses(day);
    return `
      <div class="home-top">
        <div class="month-nav">
          <div class="month-nav-title">${fmt.monthLabel(y,m)}</div>
          <div class="month-nav-btns"><button class="today-btn" id="goto-today-btn">今日</button><button class="icon-btn" id="prev-month-btn">‹</button><button class="icon-btn" id="next-month-btn">›</button></div>
        </div>
        <div class="cal-swipe-wrap" id="cal-swipe-wrap"><div class="calendar-wrap">${this._buildCalendar(y,m,datesSet)}</div></div>
        <div class="month-summary">
          <div class="month-stats">
            <div class="stat-item"><div class="stat-label">當月支出</div><div class="stat-value big">${fmt.money(total)}</div></div>
            <div class="stat-item"><div class="stat-label">筆數</div><div class="stat-value">${monthly.length}</div></div>
            <div class="stat-item"><div class="stat-label">待分類</div><div class="stat-value">${pending>0?`<span class="pending-badge" id="pending-badge">${pending}</span>`:`<span style="color:var(--text2)">0</span>`}</div></div>
          </div>
          ${catEntries.length?`<div class="cat-breakdown">${catEntries.slice(0,3).map(([name,amt])=>`<div class="cat-row"><div class="cat-row-name">${name}</div><div class="cat-row-bar-wrap"><div class="cat-row-bar" style="width:${Math.round((amt/total)*100)}%"></div></div><div class="cat-row-amount">${fmt.money(amt)}</div></div>`).join('')}</div>`:''}
        </div>
      </div>
      <div class="home-bottom">
        <div class="day-panel-header">
          <div class="day-panel-title">${fmt.date(this.selected)}${dayTotal>0?`<span class="day-total-amt">${fmt.money(dayTotal)}</span>`:''}</div>
          <div style="display:flex;gap:5px;">
            <button class="btn-day-action btn-import" id="invoice-fetch-btn">🧾 載具 CSV</button>
            <button class="btn-day-action btn-add" id="add-expense-btn">＋ 記帳</button>
          </div>
        </div>
        <div class="expense-list">${groups.length ? groups.map(g=>g.type==='invoice-group'?this._buildGroupCard(g):this._buildSingleCard(g)).join('') : `<div class="empty-state"><div class="icon">📭</div><p>這天沒有消費記錄</p></div>`}</div>
      </div>`;
  }

  _groupExpenses(expenses) {
    const result=[], invMap=new Map(), sorted=[...expenses].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
    for(const e of sorted){
      if(e.source==='invoice'&&e.invoiceNo){
        if(!invMap.has(e.invoiceNo)){ const g={type:'invoice-group',invoiceNo:e.invoiceNo,store:e.store||'',date:e.date,items:[]}; invMap.set(e.invoiceNo,g); result.push(g); }
        invMap.get(e.invoiceNo).items.push(e);
      } else result.push({type:'single',...e});
    }
    return result;
  }

  _buildGroupCard(g) {
    const total=g.items.reduce((s,i)=>s+Number(i.amount||0),0), pendingN=g.items.filter(i=>i.status==='pending').length;
    const cats=[...new Set(g.items.filter(i=>i.category1).map(i=>i.category1))], first=g.items[0], moreCount=g.items.length-1;
    return `<div class="ref-card" data-grp="${g.invoiceNo}"><div class="ref-card-icon">🧾</div><div class="ref-card-body"><div class="ref-card-title">${g.store||'電子發票'}</div><div class="ref-card-sub">${first?.description||'(未命名)'}${moreCount>0?` <span class="ref-more">+${moreCount}項</span>`:''}</div><div class="ref-card-tags">${pendingN>0?`<span class="ref-tag pending">待分類${pendingN>1?' '+pendingN:''}</span>`:''}${cats.slice(0,2).map(c=>`<span class="ref-tag">${c}</span>`).join('')}<span class="ref-tag inv">🧾</span></div></div><div class="ref-card-right"><div class="ref-card-amount">${fmt.money(total)}</div><div class="ref-card-count">${g.items.length} 項</div></div></div>`;
  }

  _buildSingleCard(e) {
    const icon=getCatIcon(e.category2||(e.status==='pending'?'待分類':'其他')), title=e.category2||e.category1||(e.status==='pending'?'待分類':'未分類');
    return `<div class="ref-card" data-id="${e.id}"><div class="ref-card-icon">${icon}</div><div class="ref-card-body"><div class="ref-card-title">${title}</div><div class="ref-card-sub">${e.description||'(未命名)'}</div><div class="ref-card-tags">${e.status==='pending'?`<span class="ref-tag pending">待分類</span>`:''}${e.category1&&e.status!=='pending'?`<span class="ref-tag">${e.category1}</span>`:''}${e.source==='invoice'?`<span class="ref-tag inv">🧾</span>`:''}${e.store?`<span class="ref-tag store">🏪 ${e.store}</span>`:''}</div></div><div class="ref-card-right"><div class="ref-card-amount">${fmt.money(e.amount)}</div></div></div>`;
  }

  _getWeekNum(year,month,day) {
    const date=new Date(year,month-1,day), jan1=new Date(year,0,1);
    return Math.floor((Math.round((date-jan1)/86400000)+jan1.getDay())/7)+1;
  }

  _buildCalendar(year,month,datesSet) {
    const first=new Date(year,month-1,1).getDay(), days=new Date(year,month,0).getDate(), prevDays=new Date(year,month-1,0).getDate();
    let h='<div class="cal-grid-wk"><div class="cal-dow cal-wk-hdr">週</div>' + ['日','一','二','三','四','五','六'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
    for(let row=0;row<6;row++){
      const rStart=row*7, cellDay=rStart-first+1; let wy=year,wm=month,wd=cellDay;
      if(cellDay<1){wy=year;wm=month-1;wd=prevDays+cellDay;} else if(cellDay>days){wy=year;wm=month+1;wd=cellDay-days;}
      h+=`<div class="cal-wk-num">WK${this._getWeekNum(wy,wm,wd)}</div>`;
      for(let col=0;col<7;col++){
        const cell=row*7+col;
        if(cell<first || cell>=first+days){
          const d=cell<first ? prevDays-first+1+cell : cell-first-days+1;
          h+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
        } else {
          const d=cell-first+1, ds=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const cls=`cal-day${ds===this.today?' today':''}${ds===this.selected?' selected':''}${col===0?' is-sun':''}${col===6?' is-sat':''}`;
          h+=`<div class="${cls}" data-date="${ds}"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap">${datesSet.has(ds)?'<div class="cal-dot"></div>':''}</div></div>`;
        }
      }
    }
    return h+'</div>';
  }

  _buildSearch() {
    return `<div class="search-wrap"><div class="search-box"><span class="search-icon">🔍</span><input id="search-input" placeholder="搜尋…"><button class="search-clear hidden" id="search-clear">✕</button></div><div class="search-results-info" id="search-info">輸入關鍵字以搜尋</div><div id="search-results" class="expense-list" style="padding:0;gap:5px;"></div></div>`;
  }

  _buildSettings() {
    const s=this.store.data.settings, cats=this.store.data.categories, lastSync=this.store.data.lastSync, storeMap=this.store.data.storeMapping||[];
    return `<div class="settings-wrap">
      <div class="settings-section"><div class="settings-section-title">分類管理</div><div class="cat-tree" id="cat-tree">${cats.map((cat,ci)=>this._buildCatNode(cat,ci)).join('')}</div><div style="padding:8px 12px;"><button class="btn-primary" id="add-parent-cat-btn" style="width:100%;">＋ 新增大分類</button></div></div>
      <div class="settings-section"><div class="settings-section-title">🏪 店家自動分類</div><div class="settings-item" id="open-store-mapping-btn"><div><div class="settings-item-label">規則設定</div><div class="settings-item-sub">共 ${storeMap.length} 條規則</div></div><span class="settings-item-arrow">›</span></div></div>
      <div class="settings-section"><div class="settings-section-title">🤖 Gemini AI</div><div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;"><div class="form-group"><label class="form-label">API Key</label><div class="api-key-wrap"><input class="form-input" id="s-geminiKey" type="password" placeholder="Gemini API Key" value="${s.geminiApiKey||''}"><button class="api-key-toggle" data-target="s-geminiKey">👁</button></div></div><div class="form-group"><label class="form-label">模型</label><select class="form-select" id="s-geminiModel">${GEMINI_MODELS.map(m=>`<option value="${m}" ${s.geminiModel===m?'selected':''}>${m}</option>`).join('')}</select></div><button class="btn-primary" id="save-gemini-settings-btn">儲存 AI 設定</button></div></div>
      <div class="settings-section"><div class="settings-section-title">☁️ Google Drive 同步</div><div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;"><div class="form-group"><label class="form-label">OAuth Client ID</label><input class="form-input" id="s-gClientId" placeholder="填入 Google Cloud 申請的 Client ID" value="${s.googleClientId||''}"></div><button class="btn-primary" id="save-drive-settings-btn">儲存憑證</button>${lastSync?`<div class="last-sync-info">上次備份時間：${lastSync}</div>`:''}<div class="backup-action-row"><button class="btn-primary" id="drive-upload-btn">☁️ 建立新備份</button><button class="btn-secondary" id="drive-list-btn">📂 選擇備份還原</button></div><div id="drive-backup-list" class="backup-list"></div></div></div>
      <div class="settings-section"><div class="settings-section-title">💾 系統設定</div><div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;"><div class="backup-action-row"><button class="btn-primary" id="import-moze-btn">💼 匯入 MOZE</button><button class="btn-secondary" id="export-local-btn">📤 匯出</button><button class="btn-secondary" id="import-local-btn">📥 匯入</button></div><button class="btn-danger" id="clear-data-btn">⚠️ 清除所有資料</button></div></div>
    </div>`;
  }

  _buildCatNode(cat,ci) {
    return `<div class="cat-parent" data-ci="${ci}"><div class="cat-parent-row"><button class="cat-toggle" data-ci="${ci}">▶</button><div class="cat-parent-name">${cat.name}</div><div class="cat-action-btns"><button class="cat-action-btn" data-action="rename-cat" data-ci="${ci}">改名</button><button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button></div></div><div class="cat-children" id="cat-children-${ci}">${(cat.subs||[]).map((sub,si)=>`<div class="cat-child-row" data-ci="${ci}" data-si="${si}"><div class="cat-child-name">${getCatIcon(sub)} ${sub}</div><div class="cat-action-btns"><button class="cat-action-btn" data-action="rename-sub" data-ci="${ci}" data-si="${si}">改名</button><button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button></div></div>`).join('')}<div class="cat-add-row"><input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類…"><button class="btn-primary" data-action="add-sub" data-ci="${ci}" style="padding:5px;">新增</button></div></div></div>`;
  }

  _buildStats() { /* Omitted for brevity, remains identical to V1.0 internally */ return `<div class="stats-wrap"><div class="stats-month-nav"><button class="stats-month-btn" id="stats-prev">‹</button><div class="stats-month-display" id="stats-month-label">${this.statsYear} 年 ${this.statsMonth} 月</div><button class="stats-month-btn" id="stats-next">›</button><button class="stats-custom-btn${this.statsCustom?' active':''}" id="stats-custom-btn">自訂</button></div><div class="stats-custom-range${this.statsCustom?' open':''}" id="stats-custom-range"><input class="stats-range-input" type="date" id="stats-from" value="${this._statsFromDefault()}"><span class="stats-range-sep">—</span><input class="stats-range-input" type="date" id="stats-to" value="${fmt.today()}"><button class="stats-range-btn" id="stats-range-apply">套用</button></div><div id="stats-content"></div></div>`; }
  _statsFromDefault() { return `${this.statsYear}-${String(this.statsMonth).padStart(2,'0')}-01`; }
  _renderStats(expenses) { /* Omitted for brevity */ }
  _drawPie(catEntries,subMap,total) { /* Omitted for brevity */ }

  _attachViewEvents() {
    switch(this.view){
      case 'home': this._attachHomeEvents(); break;
      case 'search': this._attachSearchEvents(); break;
      case 'settings': this._attachSettingsEvents(); break;
      case 'stats': this._attachStatsEvents(); break;
    }
  }

  _attachHomeEvents() {
    document.querySelectorAll('.cal-day[data-date]').forEach(el=>el.addEventListener('click',()=>{this.selected=el.dataset.date;this.renderView();}));
    document.getElementById('prev-month-btn')?.addEventListener('click',()=>this._changeMonth(-1));
    document.getElementById('next-month-btn')?.addEventListener('click',()=>this._changeMonth(1));
    document.getElementById('goto-today-btn')?.addEventListener('click',()=>{const now=new Date();this.calendarYear=now.getFullYear();this.calendarMonth=now.getMonth()+1;this.selected=fmt.today();this.today=fmt.today();this.renderView();});
    document.querySelectorAll('.ref-card[data-id]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();this.openExpenseModal(el.dataset.id);}));
    document.querySelectorAll('.ref-card[data-grp]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();this._openInvoiceGroupSheet(el.dataset.grp);}));
    document.getElementById('pending-badge')?.addEventListener('click',()=>this._openPendingModal());
    document.getElementById('add-expense-btn')?.addEventListener('click',()=>this.openExpenseModal(null));
    document.getElementById('invoice-fetch-btn')?.addEventListener('click',()=>document.getElementById('csv-invoice-input')?.click());
  }

  _changeMonth(delta) {
    this.calendarMonth+=delta;
    if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;}
    if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;}
    this.renderView();
  }

  _attachSearchEvents() {
    const input=document.getElementById('search-input'), clearBtn=document.getElementById('search-clear');
    if(!input) return; let timer;
    input.addEventListener('input',()=>{ clearTimeout(timer); clearBtn?.classList.toggle('hidden',!input.value); timer=setTimeout(()=>this._doSearch(input.value),200); });
    clearBtn?.addEventListener('click',()=>{ input.value=''; clearBtn.classList.add('hidden'); document.getElementById('search-info').textContent='輸入關鍵字以搜尋'; document.getElementById('search-results').innerHTML=''; });
    document.getElementById('search-results')?.addEventListener('click',ev=>{ const card=ev.target.closest('[data-id]'); if(card) this.openExpenseModal(card.dataset.id); });
  }
  _doSearch(kw) { /* Standard search rendering */ }

  _attachSettingsEvents() {
    document.querySelectorAll('.cat-toggle').forEach(btn=>btn.addEventListener('click',()=>{const ch=document.getElementById('cat-children-'+btn.dataset.ci);const open=ch.classList.toggle('open');btn.classList.toggle('open',open);btn.textContent=open?'▼':'▶';}));
    document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>this._handleCatAction(btn.dataset.action,+btn.dataset.ci,btn.dataset.si!==undefined?+btn.dataset.si:null)));
    document.getElementById('add-parent-cat-btn')?.addEventListener('click',()=>this._promptCatName('新增大分類','',name=>{this.store.data.categories.push({name,subs:[]});this.store.save();this.renderView();}));
    document.getElementById('open-store-mapping-btn')?.addEventListener('click',()=>this._openStoreMappingPage());
    document.getElementById('save-gemini-settings-btn')?.addEventListener('click',()=>{
      this.store.data.settings.geminiApiKey=document.getElementById('s-geminiKey').value.trim();
      this.store.data.settings.geminiModel=document.getElementById('s-geminiModel').value;
      this.store.save(); this.toast('已儲存','success');
    });
    document.getElementById('save-drive-settings-btn')?.addEventListener('click',()=>{
      const cid=document.getElementById('s-gClientId').value.trim();
      this.store.data.settings.googleClientId=cid; this.store.save();
      if(cid) this.drive.init(cid).catch(()=>{}); this.toast('憑證儲存成功','success');
    });
    document.querySelectorAll('.api-key-toggle').forEach(btn=>btn.addEventListener('click',()=>{const inp=document.getElementById(btn.dataset.target); if(inp){inp.type=inp.type==='password'?'text':'password';btn.textContent=inp.type==='password'?'👁':'🙈';}}));
    
    // MOZE Import
    document.getElementById('import-moze-btn')?.addEventListener('click',()=>document.getElementById('moze-csv-input')?.click());
    
    document.getElementById('export-local-btn')?.addEventListener('click',()=>this.exportLocal());
    document.getElementById('import-local-btn')?.addEventListener('click',()=>document.getElementById('import-file-input')?.click());
    const inp = document.getElementById('import-file-input'); if(inp) { const n = inp.cloneNode(true); inp.parentNode.replaceChild(n,inp); n.addEventListener('change',e=>this.importLocal(e)); }
    document.getElementById('drive-upload-btn')?.addEventListener('click',()=>this.driveUpload());
    document.getElementById('drive-list-btn')?.addEventListener('click',()=>this.driveList());
    document.getElementById('clear-data-btn')?.addEventListener('click',()=>{
      if(!confirm('確定清除所有資料？無法復原！')) return;
      localStorage.removeItem(STORAGE_KEY); this.store.data=this.store._default(); this.toast('已清除','info'); this.renderView();
    });
  }
  _handleCatAction(action,ci,si) { /* Omitted */ }
  _promptCatName(title,def,cb){const n=prompt(title,def);if(n&&n.trim())cb(n.trim());}
  _attachStatsEvents() { /* Omitted */ }
  _openInvoiceGroupSheet(invoiceNo) { /* Omitted */ }
  _openStoreMappingPage() { /* Omitted */ }
  _openStoreMappingModal(existingIdx) { /* Omitted */ }
  _populateSelect2(cat1,sel2,selectedCat2) { /* Omitted */ }
  openExpenseModal(id) { /* Omitted - same as V1.0 */ }
  _attachModalSwipeBack(el, onClose) { /* Omitted */ }
  _saveExpense(e,isEdit) { /* Omitted */ }
  closeModal(cb) {
    const content=document.getElementById('modal-content'), overlay=document.getElementById('modal-overlay'), backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('slide-in'); backdrop.classList.remove('visible');
    setTimeout(()=>{overlay.classList.add('hidden'); content.innerHTML=''; content.classList.remove('sheet-mode'); this._editId=null; if(cb) cb();},300);
  }
  _openPendingModal() { /* Omitted */ }
  
  _openSheet(html) {
    const overlay=document.getElementById('modal-overlay'), content=document.getElementById('modal-content'), backdrop=document.getElementById('modal-backdrop');
    content.classList.add('sheet-mode'); content.innerHTML=html; overlay.classList.remove('hidden'); backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    ['modal-close-btn','modal-cancel-btn'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>this.closeModal()));
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.closeModal();},{once:true});
  }

  _applyStoreMapping(storeNameRaw) {
    const rules=this.store.data.storeMapping||[];
    for(const rule of rules) if(storeNameRaw.toLowerCase().includes(rule.store.toLowerCase())) return {cat1:rule.cat1,cat2:rule.cat2};
    return {cat1:'',cat2:''};
  }

  _handleCsvFile(event) {
    const file=event.target.files[0]; if(!file) return; const reader=new FileReader();
    reader.onload=e=>{
      try { const rows=this.csvParser.parse(e.target.result); if(!rows.length){this.toast('CSV 內無效資料','error');return;} this._showCsvPreviewModal(rows); } catch(err){this.toast('解析失敗','error');}
    };
    reader.readAsText(file,'utf-8'); event.target.value='';
  }
  _showCsvPreviewModal(rows) { /* Omitted */ }
  _importCsvRows(rows) { /* Omitted */ }

  // ── MOZE CSV IMPORT ──
  _parseRobustCSV(text) {
    const rows = []; let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i+1] === '"') { field += '"'; i++; } else { inQ = false; }
        } else { field += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          cur.push(field); rows.push(cur); cur = []; field = '';
          if (c === '\r' && text[i+1] === '\n') i++;
        } else { field += c; }
      }
    }
    if (cur.length || field) { cur.push(field); rows.push(cur); }
    return rows;
  }

  _handleMozeCsvFile(event) {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const rows = this._parseRobustCSV(text);
        if (rows.length < 2) throw new Error('無效的 CSV 內容');
        
        const clean = str => (str||'').replace(/\\s*/g, '').trim();
        const headers = rows[0].map(clean);
        const dateIdx = headers.indexOf('日期');
        const amtIdx = headers.indexOf('金額');
        const cat1Idx = headers.indexOf('主類別');
        const cat2Idx = headers.indexOf('子類別');
        const storeIdx = headers.indexOf('商家');
        const nameIdx = headers.indexOf('名稱');
        const descIdx = headers.indexOf('描述');
        
        if(dateIdx < 0 || amtIdx < 0) throw new Error('找不到必要欄位 (日期 或 金額)，確認是否為 MOZE 格式');
        
        let imported = 0;
        for(let i=1; i<rows.length; i++) {
          const r = rows[i];
          if (r.length < 5) continue;
          const rawDate = clean(r[dateIdx]);
          if (!rawDate) continue;
          
          const dateStr = rawDate.replace(/\//g, '-');
          const amount = Math.abs(parseFloat(clean(r[amtIdx])) || 0);
          if (amount === 0) continue;
          
          const cat1 = clean(r[cat1Idx]);
          const cat2 = clean(r[cat2Idx]);
          const store = clean(r[storeIdx]);
          const desc = clean(r[nameIdx]) || clean(r[descIdx]) || store || '(未命名)';
          
          if (cat1 && !this.store.data.categories.find(c => c.name === cat1)) {
            this.store.data.categories.push({ name: cat1, subs: cat2 ? [cat2] : [] });
          } else if (cat1 && cat2) {
            const c = this.store.data.categories.find(c => c.name === cat1);
            if (c && !c.subs) c.subs = [];
            if (c && !c.subs.includes(cat2)) c.subs.push(cat2);
          }
          
          this.store.addExpense({
            date: dateStr, amount, description: desc, store: store,
            category1: cat1, category2: cat2, status: cat1 ? 'categorized' : 'pending', source: 'moze', invoiceNo: ''
          });
          imported++;
        }
        this.store.save(); this.toast(`✅ 成功匯入 ${imported} 筆 MOZE 記錄`, 'success'); this.renderView();
      } catch(err) {
        this.toast('匯入失敗：' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8'); event.target.value = '';
  }

  // ── Drive ──
  exportLocal() {
    const data=this.store.export(); data._exportedAt=new Date().toISOString();
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
    a.download=`cost-record-backup-${fmt.today()}.json`; a.click(); URL.revokeObjectURL(url); this.toast('已匯出備份','success');
  }
  importLocal(event) {
    const file=event.target.files[0]; if(!file) return; const reader=new FileReader();
    reader.onload=e=>{
      try{ const raw=JSON.parse(e.target.result); if(!confirm(`備份包含 ${(raw.expenses||[]).length} 筆記錄\n確定匯入？`))return;
      this.store.import(raw); this.toast('備份匯入成功','success'); this.renderView(); } catch(err){this.toast('匯入失敗','error');}
    };
    reader.readAsText(file); event.target.value='';
  }
  async driveUpload() {
    const btn=document.getElementById('drive-upload-btn'); if(btn){btn.textContent='上傳中…';btn.disabled=true;}
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const data=this.store.export(); data._exportedAt=new Date().toISOString();
      await this.drive.uploadBackup(data);
      this.store.data.lastSync=new Date().toLocaleString('zh-TW'); this.store.save();
      this.toast('已上傳備份至 Google Drive','success'); this.renderView();
    } catch(err){this.toast('上傳失敗：'+err.message,'error');} finally{if(btn){btn.textContent='☁️ 建立新備份';btn.disabled=false;}}
  }
  async driveList() {
    const btn=document.getElementById('drive-list-btn'); if(btn){btn.textContent='載入中…';btn.disabled=true;}
    const listEl=document.getElementById('drive-backup-list');
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const files=await this.drive.listBackups(); // Already limits to 5, sorts descending
      if(!listEl) return;
      if(!files.length){listEl.innerHTML='<p style="font-size:10px;color:var(--text3);">尚無雲端備份</p>';return;}
      listEl.innerHTML=files.map(f=>`
        <div class="backup-item">
          <div class="backup-item-info"><div class="backup-item-name">${f.name}</div><div class="backup-item-date">${new Date(f.modifiedTime).toLocaleString('zh-TW')}</div></div>
          <button class="backup-item-btn" data-file-id="${f.id}">選擇還原</button>
        </div>`).join('');
      listEl.querySelectorAll('.backup-item-btn').forEach(b=>{
        b.addEventListener('click',async()=>{
          if(!confirm('確定從雲端匯入此備份？本機現有資料將被覆蓋。'))return;
          b.textContent='還原中…'; b.disabled=true;
          try {
            const data=await this.drive.downloadBackup(b.dataset.fileId);
            this.store.import(data); this.toast('✅ 已成功從 Google Drive 還原資料','success'); this.renderView();
          } catch(err){this.toast('還原失敗：'+err.message,'error'); b.textContent='選擇還原'; b.disabled=false;}
        });
      });
    } catch(err){this.toast('載入失敗：'+err.message,'error');} finally{if(btn){btn.textContent='📂 選擇備份還原';btn.disabled=false;}}
  }

  toast(msg,type='info') {
    const el=document.getElementById('toast'); if(!el) return;
    el.textContent=msg; el.className=`show ${type}`; clearTimeout(this._toastTimer);
    this._toastTimer=setTimeout(()=>{el.className='';},2800);
  }
}

document.addEventListener('DOMContentLoaded', () => { window._app=new App(); window._app.init(); });