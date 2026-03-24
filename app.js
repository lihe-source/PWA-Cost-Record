'use strict';

const STORAGE_KEY = 'cost_record_v1';
const DRIVE_PREFIX = 'cost-record-backup';
const DRIVE_FOLDER_NAME = 'PWA-Cost-Record';

const DEFAULT_CATEGORIES = [
  { name: '飲食', subs: ['早餐', '午餐', '晚餐', '飲料', '點心', '宵夜'] },
  { name: '交通', subs: ['捷運', '公車', '火車', '高鐵', '加油費', '停車費', '摩托車'] }
];

const MAIN_CAT_ICONS = {
  '飲食': '🍽️', '交通': '🚗', '購物': '🛍️', '娛樂': '🎬', '居家': '🏠',
  '醫療': '🏥', '學習': '📚', '人際': '🤝', '財務': '💰', '其他': '📦',
  '平日消費': '📅', '家庭消費': '🏡'
};

const CAT_ICONS = {
  '早餐': '🍳', '午餐': '🍱', '晚餐': '🍜', '點心': '🧁', '飲料': '🧋', '宵夜': '🍗', '水果': '🍎', '咖啡': '☕',
  '捷運': '🚇', '公車': '🚌', '火車': '🚆', '高鐵': '🚄', '計程車': '🚕', '加油費': '⛽', '停車費': '🅿️', '摩托車': '🛵', '保養': '🔧',
  '衣服': '👕', '鞋子': '👟', '配件': '👜', '保養品': '🧴', '3C': '📱', '市場': '🛒', '日用品': '🧻', '生鮮': '🥩',
  '房租': '🔑', '水電': '💧', '瓦斯': '🔥', '網路': '🌐', '電信': '📞', '裝潢': '🔨', '家電': '📺', '家具': '🛋️',
  '看診': '🩺', '藥品': '💊', '保健食品': '🌿', '運動': '🏃',
  '電影': '🍿', '遊戲': '🎮', '旅遊': '✈️', '聚餐': '🍻', '展覽': '🖼️',
  '待分類': '📋', '其他': '💰'
};

function getCatIcon(cat1, cat2) {
  if (cat2 && CAT_ICONS[cat2]) return CAT_ICONS[cat2];
  if (cat1 && MAIN_CAT_ICONS[cat1]) return MAIN_CAT_ICONS[cat1];
  return '📌';
}

class DataStore {
  constructor() { this.data = this._load(); }
  _load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return this._default();
  }
  _default() {
    return {
      schemaVersion: 1, expenses: [], categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      settings: { googleClientId: '' }, importedInvoiceNos: [], lastSync: null
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
      (e.category1||'').toLowerCase().includes(q) || (e.category2||'').toLowerCase().includes(q)
    ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  export() { return JSON.parse(JSON.stringify(this.data)); }
  import(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('無效的備份格式');
    this.data = { ...this._default(), ...raw }; this.save();
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
    if (!this.clientId) throw new Error('請先設定 Google Client ID');
    await this._loadGIS();
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId, scope: 'https://www.googleapis.com/auth/drive.file',
        callback: r => r.error ? reject(new Error(r.error)) : resolve((this.token = r.access_token))
      });
      tc.requestAccessToken({ prompt: 'select_account' });
    });
  }
  async _getOrCreateFolder() {
    const token = await this.getToken();
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    return (await createRes.json()).id;
  }
  async listBackups() {
    const token = await this.getToken();
    const q = encodeURIComponent(`name contains '${DRIVE_PREFIX}' and mimeType='application/json' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size)`, { headers: { Authorization: `Bearer ${token}` } });
    return (await res.json()).files || [];
  }
  async uploadBackup(data) {
    const token = await this.getToken();
    const folderId = await this._getOrCreateFolder();
    const fileName = `${DRIVE_PREFIX}-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const boundary = '-------cost_record_backup';
    const metadata = { name: fileName, mimeType: 'application/json', parents: [folderId] };
    const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata), `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(data, null, 2), `--${boundary}--`].join('\r\n');
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
    return res.json();
  }
  async downloadBackup(fileId) {
    const token = await this.getToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
  }
}

const fmt = {
  money: n => `$${Number(n||0).toLocaleString('zh-TW')}`,
  date: d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${y}/${m}/${day}`; },
  monthLabel: (y,m) => `${y} 年 ${m} 月`,
  today: () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
};
const CHART_COLORS = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];

class App {
  constructor() {
    this.store = new DataStore(); this.drive = new DriveService();
    this.view = 'home'; this.today = fmt.today(); this.selected = fmt.today();
    this.calendarYear = new Date().getFullYear(); this.calendarMonth = new Date().getMonth()+1;
    this.statsYear = new Date().getFullYear(); this.statsMonth = new Date().getMonth()+1;
    this._isDarkMode = localStorage.getItem('theme') !== 'light';
  }

  async init() {
    this._checkForUpdates();
    this._setupNav();
    this._registerSW();
    this.renderView();
    if(this.store.data.settings.googleClientId) this.drive.init(this.store.data.settings.googleClientId).catch(()=>{});
    
    const mc = document.createElement('input'); mc.type='file'; mc.id='moze-csv-input'; mc.accept='.csv'; mc.style.display='none';
    document.body.appendChild(mc);
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
         if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({type: 'SKIP_WAITING'});
         const banner = document.getElementById('update-banner');
         if(banner) { banner.style.display = 'block'; setTimeout(()=>window.location.reload(), 1500); }
      }
    } catch(e) {}
  }

  _applyTheme(dark) {
    document.body.classList.toggle('light-mode', !dark);
    const btn = document.getElementById('theme-toggle-btn');
    if(btn) btn.textContent = dark ? '🌙' : '☀️';
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
      case 'stats':    main.innerHTML=this._buildStats();    h1.textContent='統計';   this._attachStatsEvents(); break;
    }
    this._attachViewEvents();
  }

  _buildHome() {
    const {calendarYear:y,calendarMonth:m}=this; const monthly=this.store.getByMonth(y,m);
    const total=monthly.reduce((s,e)=>s+Number(e.amount||0),0);
    const datesSet=this.store.getDatesWithExpenses(y,m);
    const day=this.store.getByDate(this.selected);
    const dayTotal=day.reduce((s,e)=>s+Number(e.amount||0),0);
    
    return `
      <div class="home-top">
        <div class="month-nav">
          <div class="month-nav-title">${fmt.monthLabel(y,m)}</div>
          <div class="month-nav-btns"><button class="today-btn" id="goto-today-btn">今日</button><button class="icon-btn" id="prev-month-btn">‹</button><button class="icon-btn" id="next-month-btn">›</button></div>
        </div>
        <div class="cal-grid-wk"><div class="cal-dow">週</div>${['日','一','二','三','四','五','六'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}${this._buildCalendar(y,m,datesSet)}</div>
        <div class="month-stats"><div class="stat-item"><div class="stat-label">當月支出</div><div class="stat-value big">${fmt.money(total)}</div></div><div class="stat-item"><div class="stat-label">筆數</div><div class="stat-value">${monthly.length}</div></div></div>
      </div>
      <div class="home-bottom">
        <div class="day-panel-header">
          <div class="day-panel-title">${fmt.date(this.selected)}${dayTotal>0?`<span class="day-total-amt">${fmt.money(dayTotal)}</span>`:''}</div>
        </div>
        <div class="expense-list">${day.length ? day.map(e=>this._buildSingleCard(e)).join('') : `<div class="empty-state"><div class="icon">📭</div><p>這天沒有記錄</p></div>`}</div>
      </div>`;
  }

  _buildSingleCard(e) {
    const icon = getCatIcon(e.category1, e.category2); 
    const title = e.category2 || e.category1 || '未分類';
    return `<div class="ref-card" data-id="${e.id}"><div class="ref-card-icon">${icon}</div><div class="ref-card-body"><div class="ref-card-title">${title}</div><div class="ref-card-sub">${e.description||'(未命名)'}</div><div class="ref-card-tags">${e.category1?`<span class="ref-tag">${e.category1}</span>`:''}${e.store?`<span class="ref-tag store">🏪 ${e.store}</span>`:''}</div></div><div class="ref-card-right"><div class="ref-card-amount">${fmt.money(e.amount)}</div></div></div>`;
  }

  _getWeekNum(year,month,day) {
    const date=new Date(year,month-1,day), jan1=new Date(year,0,1);
    return Math.floor((Math.round((date-jan1)/86400000)+jan1.getDay())/7)+1;
  }

  _buildCalendar(year,month,datesSet) {
    const first=new Date(year,month-1,1).getDay(), days=new Date(year,month,0).getDate(), prevDays=new Date(year,month-1,0).getDate();
    let h='';
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
          const cls=`cal-day${ds===this.today?' today':''}${ds===this.selected?' selected':''}`;
          h+=`<div class="${cls}" data-date="${ds}"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap">${datesSet.has(ds)?'<div class="cal-dot"></div>':''}</div></div>`;
        }
      }
    }
    return h;
  }

  _buildSearch() {
    return `<div class="search-wrap"><div class="search-box"><span class="search-icon">🔍</span><input id="search-input" placeholder="輸入商家、分類或描述…"></div><div class="search-results-info" id="search-info">輸入關鍵字以搜尋</div><div id="search-results" class="expense-list"></div></div>`;
  }

  _buildSettings() {
    const s=this.store.data.settings, cats=this.store.data.categories, lastSync=this.store.data.lastSync;
    return `<div class="settings-wrap">
      <div class="settings-section"><div class="settings-section-title">分類管理</div><div class="cat-tree" id="cat-tree">${cats.map((cat,ci)=>this._buildCatNode(cat,ci)).join('')}</div><div style="padding:8px 15px;"><button class="btn-primary" id="add-parent-cat-btn">＋ 新增大分類</button></div></div>
      <div class="settings-section"><div class="settings-section-title">☁️ Google Drive 同步</div><div style="padding:15px;display:flex;flex-direction:column;gap:10px;"><div class="form-group"><label class="form-label">OAuth Client ID</label><input class="form-input" id="s-gClientId" placeholder="填入 Client ID" value="${s.googleClientId||''}"></div><button class="btn-secondary" id="save-drive-settings-btn">儲存憑證</button>${lastSync?`<div style="font-size:12px;color:var(--text2)">上次備份時間：${lastSync}</div>`:''}<div class="flex-row"><button class="btn-primary" id="drive-upload-btn">☁️ 雲端備份</button><button class="btn-secondary" id="drive-list-btn">📂 雲端還原</button></div><div id="drive-backup-list"></div></div></div>
      <div class="settings-section"><div class="settings-section-title">💾 系統資料</div><div style="padding:15px;display:flex;flex-direction:column;gap:10px;"><div class="flex-row"><button class="btn-primary" id="import-moze-btn">💼 匯入 MOZE</button><button class="btn-secondary" id="export-local-btn">📤 匯出本機</button><button class="btn-secondary" id="import-local-btn">📥 匯入本機</button></div><button class="btn-danger" id="clear-data-btn">⚠️ 清除資料</button></div></div>
    </div>`;
  }

  _buildCatNode(cat,ci) {
    const parentIcon = getCatIcon(cat.name, null);
    return `<div class="cat-parent" data-ci="${ci}"><div class="cat-parent-row"><button class="cat-toggle" data-ci="${ci}">▶</button><div class="cat-parent-name">${parentIcon} ${cat.name}</div><div class="cat-action-btns"><button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button></div></div><div class="cat-children" id="cat-children-${ci}">${(cat.subs||[]).map((sub,si)=>`<div class="cat-child-row"><div class="cat-child-name">${getCatIcon(cat.name, sub)} ${sub}</div><div class="cat-action-btns"><button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button></div></div>`).join('')}<div class="cat-add-row"><input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類…"><button class="btn-primary" data-action="add-sub" data-ci="${ci}" style="padding:5px;width:auto;">新增</button></div></div></div>`;
  }

  _buildStats() {
    return `<div class="stats-wrap">
      <div class="stats-month-nav"><button class="stats-month-btn" id="stats-prev">‹</button><div class="stats-month-display" id="stats-month-label">${this.statsYear} 年 ${this.statsMonth} 月</div><button class="stats-month-btn" id="stats-next">›</button></div>
      <div id="stats-content"></div>
    </div>`;
  }

  _attachStatsEvents() {
    document.getElementById('stats-prev')?.addEventListener('click',()=>{this.statsMonth--;if(this.statsMonth<1){this.statsMonth=12;this.statsYear--;}this.renderView();});
    document.getElementById('stats-next')?.addEventListener('click',()=>{this.statsMonth++;if(this.statsMonth>12){this.statsMonth=1;this.statsYear++;}this.renderView();});
    this._renderStats(this.store.getByMonth(this.statsYear, this.statsMonth));
  }

  _renderStats(expenses) {
    const content = document.getElementById('stats-content');
    if(!content) return;
    if(!expenses.length) { content.innerHTML = '<div class="empty-state">無資料</div>'; return; }
    
    let total = 0; const catMap = {};
    expenses.forEach(e => { total += Number(e.amount); const cat = e.category1 || '未分類'; catMap[cat] = (catMap[cat]||0) + Number(e.amount); });
    const sorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    
    let html = `<div style="text-align:center; font-size:22px; font-weight:bold; margin-bottom:20px; color:var(--amber);">總支出: ${fmt.money(total)}</div><div style="display:flex; flex-direction:column; gap:15px;">`;
    sorted.forEach(([cat, amt], i) => {
      const pct = Math.round((amt/total)*100); const color = CHART_COLORS[i % CHART_COLORS.length];
      html += `<div style="display:flex; justify-content:space-between; align-items:center;"><div style="width:60px;">${cat}</div><div style="flex:1; margin:0 10px; background:var(--bg3); height:12px; border-radius:6px; overflow:hidden;"><div style="width:${pct}%; background:${color}; height:100%;"></div></div><div style="width:70px; text-align:right;">${fmt.money(amt)} <span style="font-size:10px;color:var(--text2)">(${pct}%)</span></div></div>`;
    });
    content.innerHTML = html + `</div>`;
  }

  _attachViewEvents() {
    if(this.view==='home') {
      document.querySelectorAll('.cal-day[data-date]').forEach(el=>el.addEventListener('click',()=>{this.selected=el.dataset.date;this.renderView();}));
      document.getElementById('prev-month-btn')?.addEventListener('click',()=>this._changeMonth(-1));
      document.getElementById('next-month-btn')?.addEventListener('click',()=>this._changeMonth(1));
      document.getElementById('goto-today-btn')?.addEventListener('click',()=>{const now=new Date();this.calendarYear=now.getFullYear();this.calendarMonth=now.getMonth()+1;this.selected=fmt.today();this.today=fmt.today();this.renderView();});
      document.querySelectorAll('.ref-card[data-id]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();this.openExpenseModal(el.dataset.id);}));
    } else if(this.view==='search') {
      const input=document.getElementById('search-input'); let timer;
      if(input) input.addEventListener('input',()=>{ clearTimeout(timer); timer=setTimeout(()=>this._doSearch(input.value),300); });
      document.getElementById('search-results')?.addEventListener('click',ev=>{ const card=ev.target.closest('[data-id]'); if(card) this.openExpenseModal(card.dataset.id); });
    } else if(this.view==='settings') {
      document.querySelectorAll('.cat-toggle').forEach(btn=>btn.addEventListener('click',()=>{const ch=document.getElementById('cat-children-'+btn.dataset.ci);const open=ch.classList.toggle('open');btn.textContent=open?'▼':'▶';}));
      document.getElementById('add-parent-cat-btn')?.addEventListener('click',()=>this._promptCatName('新增大分類','',name=>{this.store.data.categories.push({name,subs:[]});this.store.save();this.renderView();}));
      document.querySelectorAll('[data-action="add-sub"]').forEach(btn=>btn.addEventListener('click',()=>{ const ci=btn.dataset.ci; const inp=document.getElementById('sub-input-'+ci); if(inp&&inp.value.trim()){ this.store.data.categories[ci].subs.push(inp.value.trim()); this.store.save(); this.renderView(); }}));
      document.querySelectorAll('[data-action="del-cat"]').forEach(btn=>btn.addEventListener('click',()=>{ if(confirm('確定刪除大分類？')){ this.store.data.categories.splice(btn.dataset.ci,1); this.store.save(); this.renderView(); }}));
      document.querySelectorAll('[data-action="del-sub"]').forEach(btn=>btn.addEventListener('click',()=>{ if(confirm('確定刪除小分類？')){ this.store.data.categories[btn.dataset.ci].subs.splice(btn.dataset.si,1); this.store.save(); this.renderView(); }}));
      
      document.getElementById('save-drive-settings-btn')?.addEventListener('click',()=>{
        const cid=document.getElementById('s-gClientId').value.trim(); this.store.data.settings.googleClientId=cid; this.store.save();
        if(cid) this.drive.init(cid).catch(()=>{}); this.toast('憑證儲存成功','success');
      });
      document.getElementById('import-moze-btn')?.addEventListener('click',()=>document.getElementById('moze-csv-input')?.click());
      document.getElementById('export-local-btn')?.addEventListener('click',()=>this.exportLocal());
      let inp = document.getElementById('import-file-input'); if(!inp){inp=document.createElement('input'); inp.type='file'; inp.id='import-file-input'; inp.style.display='none'; document.body.appendChild(inp);}
      inp.addEventListener('change',e=>this.importLocal(e), {once:true});
      document.getElementById('import-local-btn')?.addEventListener('click',()=>document.getElementById('import-file-input')?.click());
      document.getElementById('drive-upload-btn')?.addEventListener('click',()=>this.driveUpload());
      document.getElementById('drive-list-btn')?.addEventListener('click',()=>this.driveList());
      document.getElementById('clear-data-btn')?.addEventListener('click',()=>{
        if(confirm('確定清除所有資料？無法復原！')) { localStorage.removeItem(STORAGE_KEY); this.store.data=this.store._default(); this.toast('已清除','info'); this.renderView(); }
      });
    }
  }

  _changeMonth(delta) {
    this.calendarMonth+=delta; if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;} if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;} this.renderView();
  }

  _doSearch(kw) {
    const res = this.store.search(kw); const container = document.getElementById('search-results'); const info = document.getElementById('search-info');
    if(!container) return;
    if(res.length===0) { info.textContent = '找不到符合的記錄'; container.innerHTML = ''; return; }
    info.textContent = `找到 ${res.length} 筆記錄`; container.innerHTML = res.map(e => this._buildSingleCard(e)).join('');
  }

  _promptCatName(title,def,cb){const n=prompt(title,def);if(n&&n.trim())cb(n.trim());}

  openExpenseModal(id) {
    this._editId = id; const isEdit = !!id;
    let exp = { date: this.selected, amount: '', description: '', store: '', category1: '', category2: '' };
    if(isEdit) exp = this.store.data.expenses.find(e=>e.id===id) || exp;
    
    const catOptions = this.store.data.categories.map(c=>`<option value="${c.name}" ${exp.category1===c.name?'selected':''}>${c.name}</option>`).join('');
    const html = `
      <div style="padding:15px;">
        <h3 style="margin-bottom:15px;text-align:center;">${isEdit ? '編輯記錄' : '新增記錄'}</h3>
        <div class="form-group"><label class="form-label">日期</label><input type="date" class="form-input" id="f-date" value="${exp.date}"></div>
        <div class="form-group"><label class="form-label">金額</label><input type="number" class="form-input" id="f-amount" value="${exp.amount}"></div>
        <div class="form-group"><label class="form-label">項目說明</label><input type="text" class="form-input" id="f-desc" value="${exp.description}"></div>
        <div class="form-group"><label class="form-label">商家</label><input type="text" class="form-input" id="f-store" value="${exp.store}"></div>
        <div class="flex-row">
          <div class="form-group" style="flex:1;"><label class="form-label">主分類</label><select class="form-select" id="f-cat1"><option value="">未選擇</option>${catOptions}</select></div>
          <div class="form-group" style="flex:1;"><label class="form-label">子分類</label><input type="text" class="form-input" id="f-cat2" value="${exp.category2}" placeholder="自行輸入"></div>
        </div>
        <div class="flex-row" style="margin-top:20px;">
          <button class="btn-primary" id="save-exp-btn">儲存</button>
          ${isEdit ? `<button class="btn-danger" id="del-exp-btn">刪除</button>` : ''}
          <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        </div>
      </div>`;
    this._openSheet(html);
    
    document.getElementById('save-exp-btn')?.addEventListener('click', ()=>{
      const date = document.getElementById('f-date').value, amount = parseFloat(document.getElementById('f-amount').value);
      if(!date || isNaN(amount)) { this.toast('日期和金額為必填', 'error'); return; }
      const updates = { date, amount, description: document.getElementById('f-desc').value, store: document.getElementById('f-store').value, category1: document.getElementById('f-cat1').value, category2: document.getElementById('f-cat2').value, status: 'categorized' };
      if(isEdit) { this.store.updateExpense(id, updates); this.toast('已更新', 'success'); } else { this.store.addExpense(updates); this.toast('已新增', 'success'); }
      this.closeModal(()=>this.renderView());
    });
    if(isEdit) document.getElementById('del-exp-btn')?.addEventListener('click', ()=>{ if(confirm('確定刪除？')){ this.store.deleteExpense(id); this.closeModal(()=>this.renderView()); }});
  }

  _openSheet(html) {
    const overlay=document.getElementById('modal-overlay'), content=document.getElementById('modal-content'), backdrop=document.getElementById('modal-backdrop');
    content.innerHTML=html; overlay.classList.remove('hidden'); backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    ['modal-cancel-btn'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>this.closeModal()));
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.closeModal();},{once:true});
  }

  closeModal(cb) {
    const content=document.getElementById('modal-content'), overlay=document.getElementById('modal-overlay'), backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('slide-in'); backdrop.classList.remove('visible');
    setTimeout(()=>{overlay.classList.add('hidden'); content.innerHTML=''; this._editId=null; if(cb) cb();},300);
  }

  _parseRobustCSV(text) {
    const rows = []; let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { inQ = false; } } else { field += c; }
      } else {
        if (c === '"') { inQ = true; } else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n' || c === '\r') { cur.push(field); rows.push(cur); cur = []; field = ''; if (c === '\r' && text[i+1] === '\n') i++; } else { field += c; }
      }
    }
    if (cur.length || field) { cur.push(field); rows.push(cur); }
    return rows;
  }

  _handleMozeCsvFile(event) {
    const file = event.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = this._parseRobustCSV(e.target.result);
        if (rows.length < 2) throw new Error('無效的 CSV 內容');
        const clean = str => (str||'').replace(/\\s*/g, '').trim();
        const headers = rows[0].map(clean);
        const dateIdx = headers.indexOf('日期'), amtIdx = headers.indexOf('金額'), cat1Idx = headers.indexOf('主類別'), cat2Idx = headers.indexOf('子類別'), storeIdx = headers.indexOf('商家'), nameIdx = headers.indexOf('名稱'), descIdx = headers.indexOf('描述');
        if(dateIdx < 0 || amtIdx < 0) throw new Error('找不到必要欄位');
        let imported = 0;
        for(let i=1; i<rows.length; i++) {
          const r = rows[i]; if (r.length < 5) continue;
          const rawDate = clean(r[dateIdx]); if (!rawDate) continue;
          const dateStr = rawDate.replace(/\//g, '-'), amount = Math.abs(parseFloat(clean(r[amtIdx])) || 0);
          if (amount === 0) continue;
          const cat1 = clean(r[cat1Idx]), cat2 = clean(r[cat2Idx]), store = clean(r[storeIdx]), desc = clean(r[nameIdx]) || clean(r[descIdx]) || store || '(未命名)';
          if (cat1 && !this.store.data.categories.find(c => c.name === cat1)) this.store.data.categories.push({ name: cat1, subs: cat2 ? [cat2] : [] });
          else if (cat1 && cat2) { const c = this.store.data.categories.find(c => c.name === cat1); if (c && !c.subs) c.subs = []; if (c && !c.subs.includes(cat2)) c.subs.push(cat2); }
          this.store.addExpense({ date: dateStr, amount, description: desc, store: store, category1: cat1, category2: cat2, status: 'categorized', source: 'moze' });
          imported++;
        }
        this.store.save(); this.toast(`✅ 成功匯入 ${imported} 筆 MOZE 記錄`, 'success'); this.renderView();
      } catch(err) { this.toast('匯入失敗：' + err.message, 'error'); }
    };
    reader.readAsText(file, 'utf-8'); event.target.value = '';
  }

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
    }; reader.readAsText(file); event.target.value='';
  }
  
  async driveUpload() {
    const btn=document.getElementById('drive-upload-btn'); if(btn){btn.textContent='上傳中…';btn.disabled=true;}
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const data=this.store.export(); data._exportedAt=new Date().toISOString();
      await this.drive.uploadBackup(data);
      this.store.data.lastSync=new Date().toLocaleString('zh-TW'); this.store.save();
      this.toast('已上傳備份至 Google Drive 資料夾','success'); this.renderView();
    } catch(err){this.toast('上傳失敗：'+err.message,'error');} finally{if(btn){btn.textContent='☁️ 雲端備份';btn.disabled=false;}}
  }
  
  async driveList() {
    const btn=document.getElementById('drive-list-btn'); if(btn){btn.textContent='載入中…';btn.disabled=true;}
    const listEl=document.getElementById('drive-backup-list');
    try {
      await this.drive.init(this.store.data.settings.googleClientId);
      const files=await this.drive.listBackups();
      if(!listEl) return;
      if(!files.length){listEl.innerHTML='<p style="font-size:12px;color:var(--text3);margin-top:10px;">尚無雲端備份</p>';return;}
      listEl.innerHTML=files.map(f=>`
        <div class="backup-item" style="margin-top:10px;">
          <div class="backup-item-info">${f.name}<div class="backup-item-date" style="color:var(--text2);font-size:10px;">${new Date(f.modifiedTime).toLocaleString('zh-TW')}</div></div>
          <button class="backup-item-btn" data-file-id="${f.id}">還原</button>
        </div>`).join('');
      listEl.querySelectorAll('.backup-item-btn').forEach(b=>{
        b.addEventListener('click',async()=>{
          if(!confirm('確定從雲端匯入此備份？本機現有資料將被覆蓋。'))return;
          b.textContent='還原中…'; b.disabled=true;
          try {
            const data=await this.drive.downloadBackup(b.dataset.fileId);
            this.store.import(data); this.toast('✅ 已成功從 Google Drive 還原資料','success'); this.renderView();
          } catch(err){this.toast('還原失敗：'+err.message,'error'); b.textContent='還原'; b.disabled=false;}
        });
      });
    } catch(err){this.toast('載入失敗：'+err.message,'error');} finally{if(btn){btn.textContent='📂 雲端還原';btn.disabled=false;}}
  }

  toast(msg,type='info') {
    const el=document.getElementById('toast'); if(!el) return;
    el.textContent=msg; el.className=`show ${type}`; clearTimeout(this._toastTimer);
    this._toastTimer=setTimeout(()=>{el.className='';},2800);
  }
}

document.addEventListener('DOMContentLoaded', () => { window._app=new App(); window._app.init(); });
