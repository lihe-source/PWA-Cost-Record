/* ─────────────────────────────────────────────────────────────
   Cost Record PWA — app.js  V4.8
   Modules: DataStore · DriveService · CurrencyService · App
───────────────────────────────────────────────────────────── */
'use strict';

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY   = 'cost_record_v1';
const DRIVE_FOLDER  = '#PWA-Cost-Record';

// CURRENCIES defined below

const DEFAULT_CATEGORIES = [
  { name:'飲食',  icon:'🍱', subs:['早餐','午餐','晚餐','點心','飲料','宵夜','水果','酒類'] },
  { name:'交通',  icon:'🚗', subs:['加油費','停車費','摩托車','汽車','火車','計程車','單車'] },
  { name:'購物',  icon:'🛒', subs:['市場','衣物','鞋子','電子產品','美妝保養','禮物','配件'] },
  { name:'家居',  icon:'🏠', subs:['家具','家電','日常用品','電費','水費','網路費','管理費','燃料費','洗衣費','電話費','新屋支出','裝飾'] },
  { name:'娛樂',  icon:'🎮', subs:['影音','電影','運動','遊戲','展覽','遊樂園','消遣','博弈'] },
  { name:'學習',  icon:'📚', subs:['書籍','課程','教材','文具','證書'] },
  { name:'醫療',  icon:'💊', subs:['門診','藥品','保健食品','牙齒保健','健康檢查','醫療用品'] },
  { name:'個人',  icon:'💼', subs:['保險','稅金','理髮','捐款','通話費','社交'] },
  { name:'家庭',  icon:'👨‍👩‍👧', subs:['才藝','玩具','禮金','結婚'] },
  { name:'生活',  icon:'🌸', subs:['旅行','住宿','按摩','派對','美容美髮','蜜月旅行','出遊- 東京行','出遊- 泰國行'] },
  { name:'其他',  icon:'📦', subs:['其他'] }
];

// Full icon map for categories
const CAT_ICONS = {
  // 大分類
  '飲食':'🍽️','交通':'🚗','購物':'🛍️','家居':'🏠','娛樂':'🎮',
  '學習':'📚','醫療':'🏥','個人':'👤','家庭':'👨‍👩‍👧‍👦','生活':'🌟',
  '平日消費':'📅','家庭消費':'🏡',
  // 飲食
  '早餐':'🍳','午餐':'🍱','晚餐':'🍜','點心':'🧁','飲料':'🧋',
  '宵夜':'🌙','水果':'🍎','酒類':'🍺',
  // 交通
  '加油費':'⛽','停車費':'🅿️','摩托車':'🏍️','汽車':'🚗',
  '火車':'🚆','計程車':'🚕','單車':'🚲',
  // 購物
  '市場':'🛒','衣物':'👗','鞋子':'👟','電子產品':'💻',
  '美妝保養':'💄','禮物':'🎁','配件':'⌚',
  // 家居
  '家具':'🛋️','家電':'📺','日常用品':'🧴','電費':'⚡',
  '水費':'💧','網路費':'📶','管理費':'🏢','燃料費':'🔥',
  '新屋支出':'🏗️','裝飾':'🪴','電話費':'📱','洗衣費':'👕',
  // 娛樂
  '影音':'🎬','電影':'🎥','運動':'⚽','遊戲':'🎮',
  '展覽':'🖼️','遊樂園':'🎡','消遣':'🎯','博弈':'🎰',
  // 學習
  '書籍':'📖','課程':'📝','教材':'📓','文具':'✏️','證書':'🎓',
  // 個人
  '保險':'🛡️','稅金':'📋','理髮':'💇','捐款':'❤️',
  '通話費':'📞','社交':'👥',
  // 家庭
  '才藝':'🎨','玩具':'🧸','禮金':'🧧','結婚':'💒',
  // 生活
  '旅行':'✈️','住宿':'🏨','按摩':'💆','派對':'🎉',
  '美容美髮':'💅','蜜月旅行':'💑',
  '出遊- 東京行':'🗼','出遊- 泰國行':'🏖️',
  // 醫療
  '門診':'🏥','藥品':'💊','保健食品':'🌿','牙齒保健':'🦷',
  '健康檢查':'🩺','醫療用品':'🩹',
  '待分類':'📋','其他':'💰'
};

// Available icons for icon picker

const GEMINI_MODELS = ['gemini-1.5-flash','gemini-1.5-pro','gemini-2.0-flash','gemini-2.0-pro'];

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
        // Migrate: ensure categories have icon field
        if (d.categories) {
          d.categories = d.categories.map(c => ({
            icon: CAT_ICON_MAP[c.name] || '📦',
            ...c,
            subs: (c.subs||[]).map(s => typeof s === 'string' ? {name:s, icon:CAT_ICON_MAP[s]||'📦'} : s)
          }));
        }
        // Migrate: ensure settings has currency
        if (!d.settings) d.settings = {};
        if (!d.settings.defaultCurrency) d.settings.defaultCurrency = 'TWD';
        if (!d.storeMapping) d.storeMapping = [];
        return d;
      }
    } catch(e) { console.error('Load error', e); }
    return this._default();
  }

  _default() {
    return {
      schemaVersion: 2,
      expenses: [],
      categories: DEFAULT_CATEGORIES.map(c => ({
        ...c,
        subs: c.subs.map(s => ({ name: s, icon: CAT_ICON_MAP[s]||'📦' }))
      })),
      settings: {
        geminiApiKey: '', geminiModel: 'gemini-1.5-flash',
        googleClientId: '', defaultCurrency: 'TWD'
      },
      importedInvoiceNos: [], lastSync: null, storeMapping: []
    };
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
    catch(e) { console.error('Save error', e); }
  }

  addExpense(exp) {
    exp.id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    exp.createdAt = new Date().toISOString();
    this.data.expenses.push(exp); this.save(); return exp;
  }
  updateExpense(id, updates) {
    const idx = this.data.expenses.findIndex(e=>e.id===id);
    if(idx<0) return null;
    this.data.expenses[idx] = {...this.data.expenses[idx], ...updates, updatedAt: new Date().toISOString()};
    this.save(); return this.data.expenses[idx];
  }
  deleteExpense(id) { this.data.expenses = this.data.expenses.filter(e=>e.id!==id); this.save(); }
  getByDate(dateStr) { return this.data.expenses.filter(e=>e.date===dateStr).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')); }
  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2,'0')}`;
    return this.data.expenses.filter(e=>e.date&&e.date.startsWith(prefix));
  }
  getDatesWithExpenses(year, month) {
    const set = new Set();
    this.getByMonth(year, month).forEach(e=>set.add(e.date)); return set;
  }
  search(kw) {
    if(!kw||!kw.trim()) return [...this.data.expenses];
    const q = kw.toLowerCase();
    return this.data.expenses.filter(e=>
      (e.description||'').toLowerCase().includes(q)||(e.store||'').toLowerCase().includes(q)||
      (e.category1||'').toLowerCase().includes(q)||(e.category2||'').toLowerCase().includes(q)||
      (e.invoiceNo||'').toLowerCase().includes(q)
    ).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  }
  getInvoiceItems(invNo) { return this.data.expenses.filter(e=>e.invoiceNo===invNo); }
  isInvoiceImported(invNo) { return this.data.importedInvoiceNos.includes(invNo); }
  markInvoiceImported(invNo) {
    if(!this.data.importedInvoiceNos.includes(invNo)){
      this.data.importedInvoiceNos.push(invNo); this.save();
    }
  }
  export() { return JSON.parse(JSON.stringify(this.data)); }
  import(raw) {
    if(!raw||typeof raw!=='object') throw new Error('無效的備份格式');
    this.data = {...this._default(), ...raw};
    this.save();
  }
  getCatSubName(catIdx, subIdx) {
    const cat = this.data.categories[catIdx];
    if(!cat) return '';
    const sub = cat.subs[subIdx];
    return typeof sub === 'string' ? sub : (sub?.name||'');
  }
  getCatSubIcon(cat1Name, cat2Name) {
    const cat = this.data.categories.find(c=>c.name===cat1Name);
    if(!cat) return CAT_ICON_MAP[cat2Name]||'📦';
    const sub = cat.subs.find(s=>(typeof s==='string'?s:s.name)===cat2Name);
    if(typeof sub==='string') return CAT_ICON_MAP[sub]||'📦';
    return sub?.icon || CAT_ICON_MAP[cat2Name]||'📦';
  }
}

// ══════════════════════════════════════════════════════════════
// GOOGLE DRIVE SERVICE — with #PWA-Cost-Record folder
// ══════════════════════════════════════════════════════════════
class DriveService {
  constructor() {
    this.token = null;
    this._tokenExpiry = 0;
    this._ready = false;
    this._folderId = null;
    this._email = null;
    this._loadCachedToken();
  }

  // ── Token persistence ─────────────────────────────────────────
  _loadCachedToken() {
    try {
      const raw = localStorage.getItem('drive_token');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.expiry > Date.now() + 60000) {
          this.token = d.token;
          this._tokenExpiry = d.expiry;
          this._email = d.email || null;
        }
      }
    } catch(e) {}
  }

  _saveToken(token, expiresIn, email) {
    this.token = token;
    this._email = email || this._email;
    this._tokenExpiry = Date.now() + (expiresIn || 3500) * 1000;
    try {
      localStorage.setItem('drive_token', JSON.stringify({
        token: this.token, expiry: this._tokenExpiry, email: this._email
      }));
    } catch(e) {}
  }

  clearToken() {
    this.token = null; this._tokenExpiry = 0;
    this._email = null; this._folderId = null;
    try { localStorage.removeItem('drive_token'); } catch(e) {}
  }

  isSignedIn() { return !!this.token && Date.now() < this._tokenExpiry; }
  getEmail()   { return this._email; }

  // ── Load GIS script with timeout ──────────────────────────────
  _loadGIS() {
    if (window.google?.accounts) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google 身份驗證庫載入逾時，請檢查網路連線')), 10000);
      const done = () => { clearTimeout(timer); resolve(); };
      if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
        const wait = setInterval(() => {
          if (window.google?.accounts) { clearInterval(wait); done(); }
        }, 100);
        setTimeout(() => { clearInterval(wait); reject(new Error('GIS 載入等待逾時')); }, 10000);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = done;
      s.onerror = () => { clearTimeout(timer); reject(new Error('無法載入 Google 登入庫，請確認網路連線')); };
      document.head.appendChild(s);
    });
  }

  async init(clientId) {
    if (!clientId) throw new Error('請先填寫 Google Client ID');
    this.clientId = clientId;
    await this._loadGIS();
    this._ready = true;
  }

  // ── Get OAuth token — with 90s timeout so buttons never stay stuck ──
  async getToken(forcePrompt = false) {
    if (!forcePrompt && this.isSignedIn()) return this.token;
    if (!this.clientId) throw new Error('請先在設定中填寫 Google Client ID');
    if (!this._ready) await this.init(this.clientId);

    return new Promise((resolve, reject) => {
      // 90 second timeout — if OAuth popup is dismissed or blocked, reject cleanly
      const timer = setTimeout(() => {
        reject(new Error('登入逾時（90秒），請重試'));
      }, 90000);

      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: async r => {
          clearTimeout(timer);
          if (r.error) {
            const msgs = {
              'access_denied': '已拒絕授權',
              'popup_closed_by_user': '登入視窗已關閉，請重試',
              'popup_blocked_by_browser': '彈出視窗被封鎖，請允許後重試',
            };
            reject(new Error(msgs[r.error] || `授權錯誤：${r.error}`));
            return;
          }
          // Fetch email from tokeninfo (best-effort)
          let email = this._email;
          try {
            const info = await fetch(
              `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${r.access_token}`
            ).then(x => x.json());
            email = info.email || null;
          } catch(e) {}
          this._saveToken(r.access_token, r.expires_in, email);
          resolve(this.token);
        },
        error_callback: err => {
          clearTimeout(timer);
          reject(new Error(err?.message || '授權流程發生錯誤'));
        }
      });
      // 'select_account' forces picker; '' attempts silent re-auth
      tc.requestAccessToken({ prompt: forcePrompt ? 'select_account' : 'consent' });
    });
  }

  async signIn()  { return this.getToken(true); }
  async signOut() {
    if (this.token) {
      try { google.accounts.oauth2.revoke(this.token, () => {}); } catch(e) {}
    }
    this.clearToken();
  }

  // ── Drive API helpers ─────────────────────────────────────────
  async _fetch(url, opts = {}) {
    const token = await this.getToken();
    const headers = { Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      // Token expired — clear and retry once with fresh token
      this.clearToken();
      const token2 = await this.getToken(true);
      const headers2 = { Authorization: `Bearer ${token2}`, ...(opts.headers || {}) };
      const res2 = await fetch(url, { ...opts, headers: headers2 });
      if (!res2.ok) throw new Error(`Drive API ${res2.status}`);
      return res2;
    }
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    return res;
  }

  async getFolderId() {
    if (this._folderId) return this._folderId;
    const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const d = await res.json();
    if (d.files?.length > 0) { this._folderId = d.files[0].id; return this._folderId; }
    const cr = await this._fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
    });
    const nd = await cr.json();
    this._folderId = nd.id; return this._folderId;
  }

  async listBackups() {
    const folderId = await this.getFolderId();
    const q = encodeURIComponent(`'${folderId}' in parents and name contains 'backup' and trashed=false`);
    const res = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,modifiedTime,size)`
    );
    const d = await res.json();
    return d.files || [];
  }

  async uploadBackup(data) {
    const folderId = await this.getFolderId();
    const fileName = `backup-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    const content = JSON.stringify(data, null, 2);
    const boundary = '-------cost_record_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8', '',
      JSON.stringify({ name: fileName, mimeType: 'application/json', parents: [folderId] }),
      `--${boundary}`, 'Content-Type: application/json', '', content, `--${boundary}--`
    ].join('\r\n');
    const res = await this._fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    // Prune old backups — keep only 5
    try {
      const all = await this.listBackups();
      if (all.length > 5) {
        for (const f of all.slice(5)) {
          await this._fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }).catch(()=>{});
        }
      }
    } catch(e) {}
    return res.json();
  }

  async downloadBackup(fileId) {
    const res = await this._fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return res.json();
  }
}

// ══════════════════════════════════════════════════════════════
// CURRENCY SERVICE — Free exchange rate API
// ══════════════════════════════════════════════════════════════
class CurrencyService {
  constructor() {
    this._cache = {};      // { baseCurrency: { rates, timestamp } }
    this._TTL   = 3600000; // 1 hour cache
    // Fallback rates relative to TWD (used when API is unavailable)
    this._fallbackToTwd = {
      TWD:1, USD:0.031, EUR:0.029, JPY:4.7, CNY:0.22,
      THB:1.09, VND:795, KRW:41.5, MYR:0.145, HKD:0.243, SGD:0.042
    };
  }

  // Returns rates object { CURRENCY: rate } relative to baseCurrency
  async getRates(baseCurrency='TWD') {
    const cached = this._cache[baseCurrency];
    if (cached && Date.now() - cached.timestamp < this._TTL) return cached.rates;
    try {
      // open.er-api.com provides daily rates for free, no key required
      const res = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.result !== 'success') throw new Error('API returned error');
      this._cache[baseCurrency] = { rates: d.rates, timestamp: Date.now() };
      return d.rates;
    } catch(e) {
      console.warn('Exchange rate API failed, using fallback:', e.message);
      // Build cross-rates from TWD-based fallback
      const twdBased = this._fallbackToTwd;
      const baseToTwd = 1 / (twdBased[baseCurrency] || 1);
      const rates = {};
      for (const [code, twdRate] of Object.entries(twdBased)) {
        rates[code] = twdRate * baseToTwd;
      }
      return rates;
    }
  }

  // Get today's rate between two currencies (cached for 1 hr)
  async getRate(from, to) {
    if (from === to) return 1;
    const rates = await this.getRates(from);
    return rates[to] || 1;
  }

  async convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;
    const rate = await this.getRate(fromCurrency, toCurrency);
    return Math.round(amount * rate * 100) / 100;
  }

  // Get display rate string "1 TWD ≈ X XXX" — live if possible
  async getDisplayRate(from, to) {
    if (from === to) return null;
    try {
      const rate = await this.getRate(from, to);
      const val = rate >= 1000 ? Math.round(rate) : rate >= 10 ? rate.toFixed(1) : rate.toFixed(3);
      return `1 ${from} = ${val} ${to}`;
    } catch(e) { return null; }
  }
}

// ══════════════════════════════════════════════════════════════
// CSV INVOICE PARSER
// ══════════════════════════════════════════════════════════════
class CsvInvoiceParser {
  parse(text) {
    const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const HEADER_COLS=['載具自訂名稱','發票日期','發票號碼','發票金額','發票狀態','折讓','賣方統一編號','賣方名稱','賣方地址','買方統編','消費明細_數量','消費明細_單價','消費明細_金額','消費明細_品名'];
    const rows=[];let headerFound=false,colMap={};
    for(const rawLine of lines){
      const line=rawLine.trim();if(!line) continue;
      if(line.startsWith('捐贈或作廢')||line.startsWith('注意')) continue;
      const cols=this._splitCsv(line);
      if(!headerFound){
        if(cols.some(c=>c.includes('發票日期')||c.includes('發票號碼'))){
          headerFound=true;cols.forEach((c,i)=>{colMap[c.trim()]=i;});continue;
        }
        if(cols.length>=14&&/^\d{8}$/.test(cols[1])){
          headerFound=true;HEADER_COLS.forEach((h,i)=>{colMap[h]=i;});
        }else{continue;}
      }
      if(cols.length<4) continue;
      const get=key=>(cols[colMap[key]]||'').trim();
      const amount=parseFloat(get('消費明細_金額')||get('發票金額')||'0');
      const rawDate=get('發票日期');
      if(amount<=0||!/^\d{8}$/.test(rawDate)) continue;
      rows.push({date:`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`,invoiceNo:get('發票號碼'),amount,description:get('消費明細_品名')||get('賣方名稱')||'(未命名)',store:get('賣方名稱'),status:get('發票狀態'),carrier:get('載具自訂名稱')});
    }
    return rows;
  }
  groupByInvoice(rows){
    const map=new Map();
    for(const r of rows){if(!map.has(r.invoiceNo)){map.set(r.invoiceNo,{invoiceNo:r.invoiceNo,date:r.date,store:r.store,items:[]});}map.get(r.invoiceNo).items.push(r);}
    return [...map.values()];
  }
  _splitCsv(line){const result=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){inQ=!inQ;continue;}if(ch===','&&!inQ){result.push(cur);cur='';continue;}cur+=ch;}result.push(cur);return result;}
}

// ══════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════════════════════
const fmt = {
  money: (n, currency) => {
    const sym = {TWD:'$',JPY:'¥',CNY:'¥',EUR:'€',USD:'$'}[currency||'TWD']||'$';
    const val = Number(n||0);
    return `${sym}${val%1===0?val.toLocaleString('zh-TW'):val.toFixed(2)}`;
  },
  date: d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${y}/${m}/${day}`; },
  monthLabel: (y,m) => `${y} 年 ${m} 月`,
  today: () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
};
function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

// ── Category Icons ──────────────────────────────────────────
const ICON_LIST = [
  '🍳','🍱','🍜','🍔','🍕','🍣','🧁','🧋','🥤','🍺','🥗','🍰',
  '🚗','🚌','🚊','✈️','🚕','⛽','🛵','🚲','🚢',
  '🏠','💡','💧','📱','💻','📺','🛋','🧹','🔧',
  '👕','👟','👜','💄','💍','🕶️',
  '🎮','🎬','🎵','📚','🎨','🏋️','⚽','🎳','🎭',
  '💊','🏥','🦷','🩺',
  '📖','✏️','🎓','🔬',
  '💼','💰','📊','🏦','💳',
  '🎁','🎉','👨‍👩‍👧','🌸','🎀',
  '🛒','🧺','🌿','☕','🍵',
  '💅','✂️','🧴','🪥',
  '📦','📋','❓','💬','⭐','🏷️','📌'
];

const CAT_ICON_MAP = {
  // 大分類
  '飲食':'🍱','交通':'🚗','家居':'🏠','購物':'🛒','娛樂':'🎮','醫療':'💊',
  '學習':'📚','生活':'🌸','個人':'💼','家庭':'👨‍👩‍👧','其他':'📦',
  // 飲食
  '早餐':'🍳','午餐':'🍱','晚餐':'🍜','宵夜':'🌙','點心':'🧁','飲料':'🧋',
  '水果':'🍎','酒類':'🍺',
  // 交通
  '加油費':'⛽','停車費':'🅿️','火車':'🚊','計程車':'🚕','摩托車':'🛵','汽車':'🚗','單車':'🚲',
  // 家居
  '家具':'🛋️','家電':'📺','日常用品':'🧹','電費':'💡','水費':'💧','網路費':'📡',
  '管理費':'🏢','燃料費':'🔥','洗衣費':'👕','電話費':'📞',
  '新屋支出':'🏗️','裝飾':'🪴',
  // 購物
  '市場':'🛒','衣物':'👗','鞋子':'👟','電子產品':'💻','美妝保養':'💄',
  '配件':'⌚','禮物':'🎁',
  // 娛樂
  '電影':'🎬','影音':'🎵','運動':'⚽','遊戲':'🎮','展覽':'🖼️','遊樂園':'🎡','消遣':'☕','博弈':'🎲',
  // 醫療
  '門診':'🏥','藥品':'💊','保健食品':'🌿','牙齒保健':'🦷','健康檢查':'🩺','醫療用品':'🩹',
  // 學習
  '書籍':'📖','課程':'🎓','教材':'✏️','文具':'📝','證書':'🏆',
  // 生活
  '住宿':'🏨','旅行':'✈️','按摩':'💆','派對':'🎉',
  '蜜月旅行':'💑','美容美髮':'💇',
  '出遊- 東京行':'🗼','出遊- 泰國行':'🏖️',
  // 個人
  '保險':'🛡️','稅金':'📋','理髮':'✂️','捐款':'🤝','通話費':'📱','社交':'👥',
  // 家庭
  '才藝':'🎨','玩具':'🪆','禮金':'🧧','結婚':'💍',
  // 其他
  '其他':'📦'
};

function getCatIcon2(name, customIcons) {
  if(customIcons && customIcons[name]) return customIcons[name];
  return CAT_ICON_MAP[name] || '📦';
}

// Helper: safely extract name string from sub (may be string or {name,icon} object)
function subName(sub) { return typeof sub === 'string' ? sub : (sub?.name || ''); }
// Helper: safely extract icon from sub object, falling back to CAT_ICON_MAP
function subIcon(sub, customIcons) {
  if(typeof sub === 'object' && sub !== null) {
    if(customIcons && customIcons[sub.name]) return customIcons[sub.name];
    return sub.icon || CAT_ICON_MAP[sub.name] || '📦';
  }
  return getCatIcon2(sub, customIcons);
}

// Exchange rates (relative to TWD)
const CURRENCIES = {
  TWD: { symbol:'$',   name:'台幣 TWD',      flag:'🇹🇼', rate:1        },
  USD: { symbol:'$',   name:'美金 USD',      flag:'🇺🇸', rate:0.031    },
  EUR: { symbol:'€',   name:'歐元 EUR',      flag:'🇪🇺', rate:0.029    },
  JPY: { symbol:'¥',   name:'日幣 JPY',      flag:'🇯🇵', rate:4.7      },
  CNY: { symbol:'¥',   name:'人民幣 CNY',    flag:'🇨🇳', rate:0.22     },
  THB: { symbol:'฿',   name:'泰銖 THB',      flag:'🇹🇭', rate:1.09     },
  VND: { symbol:'₫',   name:'越盾 VND',      flag:'🇻🇳', rate:795      },
  KRW: { symbol:'₩',   name:'韓元 KRW',      flag:'🇰🇷', rate:41.5     },
  MYR: { symbol:'RM',  name:'令吉 MYR',      flag:'🇲🇾', rate:0.145    },
  HKD: { symbol:'HK$', name:'港幣 HKD',      flag:'🇭🇰', rate:0.243    },
  SGD: { symbol:'S$',  name:'新加坡幣 SGD',  flag:'🇸🇬', rate:0.042    },
};

const CHART_COLORS = ['#f59e0b','#3b82f6','#22c55e','#f43f5e','#a78bfa','#f97316','#2dd4bf','#f472b6','#84cc16','#fb923c'];

// ══════════════════════════════════════════════════════════════
// MAIN APP  V3.7
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.store       = new DataStore();
    this.csvParser   = new CsvInvoiceParser();
    this.drive       = new DriveService();
    this.currencySvc = new CurrencyService();
    this.view        = 'home';
    this.today     = fmt.today();
    this.selected  = fmt.today();
    this.calendarYear  = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth()+1;
    this.statsYear  = new Date().getFullYear();
    this.statsMonth = new Date().getMonth()+1;
    this.statsCustom = false;
    this.statsSortMode = 'amount-desc';
    this._statsOpenCats = new Set();
    this._toastTimer = null;
    this._editId = null;
    this._swipeStartX = null;
    this._swipeStartY = null;
    this._swipeCooling = false;
    this._statsSwipeCooling = false;
    // Default is light; only dark when explicitly saved as 'dark'
    // Theme already applied by inline <script> in <head>; read actual DOM state
    this._isDarkMode = !document.body.classList.contains('light-mode');
    this._currency = this.store.data.currency || 'TWD';
    this._liveRates = null; // populated async after init
    this._updateCheckTimer = null;
    this._updateCheckBound = false;
  }

  // ─── HELPERS ──────────────────────────────────────────────────
  get currency() { return this._currency; }
  set currency(v) {
    this._currency = v;
    this.store.data.currency = v;
    this.store.save();
    const _cb=document.getElementById('currency-btn');if(_cb)_cb.textContent=v;
  }
  get customIcons() { return this.store.data.categoryIcons || {}; }
  catIcon(name) {
    if(typeof name === 'object' && name !== null) return subIcon(name, this.customIcons);
    return getCatIcon2(name, this.customIcons);
  }
  money(n) { return fmt.money(n, this._currency); }

  // ─── INIT ────────────────────────────────────────────────────
  init() {
    this._setupNav();
    this._setupUpdateBanner();
    this._registerSW();
    this.renderView();
    const {googleClientId}=this.store.data.settings;
    if(googleClientId) this.drive.init(googleClientId).catch(()=>{});
    // Fetch live exchange rates on startup (non-blocking)
    this.currencySvc.getRates('TWD').then(rates=>{ this._liveRates=rates; }).catch(()=>{});
    // CSV input
    const ci=document.createElement('input');
    ci.type='file';ci.id='csv-invoice-input';ci.accept='.csv';ci.style.display='none';
    document.body.appendChild(ci);
    ci.addEventListener('change',e=>this._handleCsvFile(e));
    // FAB
    document.addEventListener('click',e=>{
      if(e.target.closest('#nav-add-btn')) this.openExpenseModal(null);
    });
    // Theme
    // Sync toggle button icon with current theme (already applied by inline <script>)
    const _syncThemeIcon = () => {
      const btn = document.getElementById('theme-toggle-btn');
      if(btn) btn.textContent = this._isDarkMode ? '🌙' : '☀️';
    };
    _syncThemeIcon();
    document.getElementById('theme-toggle-btn')?.addEventListener('click',()=>{
      this._isDarkMode=!this._isDarkMode;
      localStorage.setItem('theme',this._isDarkMode?'dark':'light');
      this._applyTheme(this._isDarkMode);
    });
    // Currency
    const cb=document.getElementById('currency-btn');if(cb) cb.textContent=this._currency;
    document.getElementById('currency-btn')?.addEventListener('click',()=>this._openCurrencyPicker());
    // Global swipe-right → close current full-screen modal
    this._setupGlobalSwipeBack();
  }

  _applyTheme(dark) {
    document.body.classList.toggle('light-mode',!dark);
    const btn=document.getElementById('theme-toggle-btn');
    if(btn) btn.textContent=dark?'🌙':'☀️';
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

    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
      .then(reg => {
        // When a new SW is found, it installs & activates automatically (skipWaiting in SW)
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'activated') {
              // New version is live — reload to get fresh files
              window.location.reload();
            }
          });
        });
        this._startUpdateMonitoring(reg);
      })
      .catch(err => console.warn('SW register failed:', err));

    // If SW controller swaps out (new SW took over), reload immediately
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }

  _startUpdateMonitoring(reg) {
    const runChecks = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      try { await reg.update(); } catch(e) {}
      this._checkRemoteVersion();
    };

    runChecks();

    if (!this._updateCheckTimer) {
      // Reduce background polling to preserve battery and avoid unnecessary work on mobile PWAs.
      this._updateCheckTimer = window.setInterval(runChecks, 15 * 60 * 1000);
    }

    if (this._updateCheckBound) return;
    this._updateCheckBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') runChecks();
    });
    window.addEventListener('online', runChecks);
  }

  _showUpdateBanner() {
    const b = document.getElementById('update-banner');
    if(b) b.style.display = 'block';
  }

  async _checkRemoteVersion() {
    try {
      const r = await fetch('./version.js?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const text = await r.text();
      const m = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (m && m[1] && m[1] !== APP_VERSION) {
        // Version mismatch — trigger SW update which will auto-reload
        if (navigator.serviceWorker?.controller) {
          const reg = await navigator.serviceWorker.getRegistration();
          reg?.update();
        } else {
          window.location.reload();
        }
      }
    } catch(e) { /* offline, ignore */ }
  }

  // _setupGlobalSwipeBack: implemented below (V3.6)

  _initCatDragOrder() { /* replaced by sort-mode UI */ }
  renderView() {
    try {
      const main=document.getElementById('main-content');
      const h1=document.querySelector('#app-header h1');
      if(!main) return;
      main.classList.toggle('home-mode',this.view==='home');
      switch(this.view){
        case 'home':     main.innerHTML=this._buildHome();     if(h1)h1.textContent='記帳本'; break;
        case 'search':   main.innerHTML=this._buildSearch();   if(h1)h1.textContent='搜尋';   break;
        case 'settings': main.innerHTML=this._buildSettings(); if(h1)h1.textContent='設定';   break;
        case 'stats':    main.innerHTML=this._buildStats();    if(h1)h1.textContent='統計';   break;
      }
      this._attachViewEvents();
    } catch(err) {
      console.error('renderView error:', err);
      const main=document.getElementById('main-content');
      if(main) main.innerHTML=`<div class="empty-state" style="margin-top:80px;"><div class="icon">⚠️</div><p style="color:var(--red);font-size:12px;">載入失敗：${err.message}<br><small>請重新整理頁面</small></p></div>`;
    }
  }

  // ─── CURRENCY PICKER ──────────────────────────────────────────
  _openCurrencyPicker() {
    const cur = this._currency;
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">💱 選擇幣別</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="gap:8px;">
        <p style="font-size:11px;color:var(--text2);line-height:1.7;">選擇後，所有金額顯示將換算為該幣別。匯率為預設固定值（非即時），如需精確請至設定頁自訂。</p>
        ${Object.entries(CURRENCIES).map(([code,info])=>`
          <div class="currency-item${cur===code?' active':''}" data-code="${code}">
            <div class="currency-symbol">${info.symbol}</div>
            <div class="currency-info">
              <div class="currency-name">${info.name}</div>
              <div class="currency-rate" id="rate-${code}">1 TWD ≈ ${code==='TWD'?'1':(CURRENCIES[code].rate)} ${code} (載入中…)</div>
            </div>
            ${cur===code?'<span class="currency-check">✓</span>':''}
          </div>`).join('')}
        <div style="padding:10px 0;border-top:1px solid var(--border);font-size:11px;color:var(--text3);">
          💡 幣別轉換使用固定匯率，如需更新請在設定頁修改。
        </div>
      </div>`);
    document.querySelectorAll('.currency-item[data-code]').forEach(el=>{
      el.addEventListener('click',()=>{
        this.currency = el.dataset.code;
        this.closeModal();
        this.renderView();
        this.toast(`已切換至 ${CURRENCIES[el.dataset.code].name}`,'success');
      });
    });
    // Load live rates for display (non-blocking)
    Object.keys(CURRENCIES).forEach(async code=>{
      if(code==='TWD') return;
      const el=document.getElementById(`rate-${code}`);
      if(!el) return;
      try{
        const rate=await this.currencySvc.getRate('TWD',code);
        const val=rate>=1000?Math.round(rate):rate>=10?rate.toFixed(1):rate.toFixed(3);
        el.textContent=`1 TWD = ${val} ${code} (即時匯率)`;
      } catch(e){ el.textContent=`1 TWD ≈ ${CURRENCIES[code].rate} ${code} (離線)`; }
    });
  }

  // ─── HOME ─────────────────────────────────────────────────────
  _buildHome() {
    const {calendarYear:y,calendarMonth:m}=this;
    const monthly=this.store.getByMonth(y,m);
    const total=monthly.reduce((s,e)=>s+this._displayAmt(e),0);
    const pending=monthly.filter(e=>e.status==='pending').length;
    const datesSet=this.store.getDatesWithExpenses(y,m);
    const catMap={};
    monthly.forEach(e=>{const k=e.category1||'未分類';catMap[k]=(catMap[k]||0)+this._displayAmt(e);});
    const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    const day=this.store.getByDate(this.selected);
    const dayTotal=day.reduce((s,e)=>s+this._displayAmt(e),0);
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
            <div class="stat-item"><div class="stat-label">當月支出</div><div class="stat-value big">${this.money(total)}</div></div>
            <div class="stat-item"><div class="stat-label">筆數</div><div class="stat-value">${monthly.length}</div></div>
            <div class="stat-item"><div class="stat-label">待分類</div><div class="stat-value">${pendingEl}</div></div>
          </div>
          ${catEntries.length?`<div class="cat-breakdown">${catEntries.slice(0,3).map(([name,amt])=>`
            <div class="cat-row">
              <div class="cat-row-icon">${this.catIcon(name)}</div>
              <div class="cat-row-name">${name}</div>
              <div class="cat-row-bar-wrap"><div class="cat-row-bar" style="width:${Math.round((amt/total)*100)}%"></div></div>
              <div class="cat-row-amount">${this.money(amt)}</div>
            </div>`).join('')}</div>`:''}
        </div>
      </div>
      <div class="home-bottom">
        <div class="day-panel-header">
          <div class="day-panel-title">${fmt.date(this.selected)}${dayTotal>0?`<span class="day-total-amt">${this.money(dayTotal)}</span>`:''}</div>
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

  _displayAmt(e) {
    const amt = Number(e.amount||0);
    const origCur = e.currency || 'TWD';
    const dispCur = this._currency;
    if(origCur === dispCur) return amt;
    // Use live rates if available, else fallback to static
    if(this._liveRates) {
      const toTwd = origCur==='TWD' ? amt : amt / (this._liveRates[origCur] || CURRENCIES[origCur]?.rate || 1);
      return dispCur==='TWD' ? toTwd : toTwd * (this._liveRates[dispCur] || CURRENCIES[dispCur]?.rate || 1);
    }
    // Convert: origCur → TWD → dispCur
    const toTwd = origCur==='TWD' ? amt : amt / (CURRENCIES[origCur]?.rate||1);
    return dispCur==='TWD' ? toTwd : toTwd * (CURRENCIES[dispCur]?.rate||1);
  }

  _groupExpenses(expenses) {
    const result=[],invMap=new Map();
    for(const e of [...expenses].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''))){
      if(e.source==='invoice'&&e.invoiceNo){
        if(!invMap.has(e.invoiceNo)){
          const g={type:'invoice-group',invoiceNo:e.invoiceNo,store:e.store||'',date:e.date,items:[]};
          invMap.set(e.invoiceNo,g);result.push(g);
        }
        invMap.get(e.invoiceNo).items.push(e);
      } else { result.push({type:'single',...e}); }
    }
    return result;
  }

  _buildGroupCard(g) {
    const total=g.items.reduce((s,i)=>s+this._displayAmt(i),0);
    const pendingN=g.items.filter(i=>i.status==='pending').length;
    const cats=[...new Set(g.items.filter(i=>i.category1).map(i=>i.category1))];
    const first=g.items[0];
    const more=g.items.length-1;
    return `
      <div class="ref-card" data-grp="${g.invoiceNo}">
        <div class="ref-card-icon">${this.catIcon(cats[0]||'其他')}</div>
        <div class="ref-card-body">
          <div class="ref-card-title">${g.store||'電子發票'}</div>
          <div class="ref-card-sub">${first?.description||'(未命名)'}${more>0?` <span class="ref-more">+${more}項</span>`:''}</div>
          <div class="ref-card-tags">
            ${pendingN>0?`<span class="ref-tag pending">待分類${pendingN>1?' '+pendingN:''}</span>`:''}
            ${cats.slice(0,2).map(c=>`<span class="ref-tag">${c}</span>`).join('')}
            <span class="ref-tag inv">🧾</span>
          </div>
        </div>
        <div class="ref-card-right"><div class="ref-card-amount">${this.money(total)}</div><div class="ref-card-count">${g.items.length}項</div></div>
      </div>`;
  }

  _buildSingleCard(e) {
    const icon=this.catIcon(e.category2||e.category1||(e.status==='pending'?'待分類':'其他'));
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
            ${e.store?`<span class="ref-tag store">${e.store}</span>`:''}
            ${e.currency&&e.currency!=='TWD'?`<span class="ref-tag cur">${e.currency}</span>`:''}
          </div>
        </div>
        <div class="ref-card-right"><div class="ref-card-amount">${this.money(this._displayAmt(e))}</div></div>
      </div>`;
  }

  _getWeekNum(year,month,day) {
    const date=new Date(year,month-1,day);
    const jan1=new Date(year,0,1);
    const jan1dow=jan1.getDay();
    const dayOfYear=Math.round((date-jan1)/86400000);
    return Math.floor((dayOfYear+jan1dow)/7)+1;
  }

  _buildCalendar(year,month,datesSet) {
    const first=new Date(year,month-1,1).getDay();
    const days=new Date(year,month,0).getDate();
    const prevDays=new Date(year,month-1,0).getDate();
    const dows=['日','一','二','三','四','五','六'];
    let h='<div class="cal-grid-wk">';
    h+='<div class="cal-dow cal-wk-hdr">週</div>';
    h+=dows.map(d=>`<div class="cal-dow">${d}</div>`).join('');
    const FIXED_ROWS=6;
    for(let row=0;row<FIXED_ROWS;row++){
      const rowStartCell=row*7;
      let wkYear=year,wkMonth=month,wkDay;
      const cmd=rowStartCell-first+1;
      if(cmd<1){const pd=new Date(year,month-2,prevDays+cmd);wkYear=pd.getFullYear();wkMonth=pd.getMonth()+1;wkDay=pd.getDate();}
      else if(cmd>days){const nd=new Date(year,month,cmd-days);wkYear=nd.getFullYear();wkMonth=nd.getMonth()+1;wkDay=nd.getDate();}
      else{wkDay=cmd;}
      h+=`<div class="cal-wk-num">WK${this._getWeekNum(wkYear,wkMonth,wkDay)}</div>`;
      for(let col=0;col<7;col++){
        const cell=row*7+col;
        if(cell<first){
          const d=prevDays-first+1+cell;
          h+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div><div class="cal-dot-wrap"></div></div>`;
        } else if(cell>=first+days){
          const nd=new Date(year,month,cell-first-days+1);
          h+=`<div class="cal-day other-month"><div class="cal-day-num">${nd.getDate()}</div><div class="cal-dot-wrap"></div></div>`;
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
        <button class="search-clear hidden" id="search-clear">✕</button>
      </div>
      <div class="search-results-info" id="search-info">輸入關鍵字以搜尋</div>
      <div id="search-results" class="expense-list" style="padding:0;gap:5px;"></div>
    </div>`;
  }

  // ─── SETTINGS ─────────────────────────────────────────────────
  _buildSettings() {
    const s=this.store.data.settings;
    const storeMap=this.store.data.storeMapping||[];
    const lastSync=this.store.data.lastSync;
    return `<div class="settings-wrap">

      <div class="settings-group-label">帳務設定</div>

      <!-- Categories -->
      <div class="settings-card" id="open-categories-btn">
        <div class="settings-card-icon">${this.catIcon('飲食')}</div>
        <div class="settings-card-body">
          <div class="settings-card-title">分類管理</div>
          <div class="settings-card-sub">大/小分類編輯、圖示設定</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <!-- Store Mapping -->
      <div class="settings-card" id="open-store-mapping-btn">
        <div class="settings-card-icon">🏪</div>
        <div class="settings-card-body">
          <div class="settings-card-title">店家自動分類</div>
          <div class="settings-card-sub">共 ${storeMap.length} 條規則</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <!-- Currency -->
      <div class="settings-card" id="open-currency-settings-btn">
        <div class="settings-card-icon">💱</div>
        <div class="settings-card-body">
          <div class="settings-card-title">幣別設定</div>
          <div class="settings-card-sub">目前：${CURRENCIES[this._currency]?.name||'台幣 TWD'}</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <div class="settings-group-label">備份與同步</div>

      <!-- Google Drive -->
      <div class="settings-card" id="open-drive-settings-btn">
        <div class="settings-card-icon">☁️</div>
        <div class="settings-card-body">
          <div class="settings-card-title">Google Drive 備份</div>
          <div class="settings-card-sub">${lastSync?`上次同步：${lastSync}`:'尚未同步'}</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <!-- Local Backup -->
      <div class="settings-card" id="open-local-backup-btn">
        <div class="settings-card-icon">💾</div>
        <div class="settings-card-body">
          <div class="settings-card-title">本機備份</div>
          <div class="settings-card-sub">匯出 / 匯入 JSON 檔案</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <!-- CSV Import -->
      <div class="settings-card" id="open-csv-import-btn">
        <div class="settings-card-icon">📂</div>
        <div class="settings-card-body">
          <div class="settings-card-title">發票 CSV 匯入</div>
          <div class="settings-card-sub">財政部 CSV 格式</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <div class="settings-group-label">AI 助手</div>

      <!-- Gemini -->
      <div class="settings-card" id="open-gemini-settings-btn">
        <div class="settings-card-icon">🤖</div>
        <div class="settings-card-body">
          <div class="settings-card-title">Gemini AI</div>
          <div class="settings-card-sub">${s.geminiApiKey?'已設定 API Key':'未設定'}</div>
        </div>
        <span class="settings-arrow">›</span>
      </div>

      <div class="settings-group-label">其他</div>

      <div class="settings-card danger" id="clear-data-btn">
        <div class="settings-card-icon">⚠️</div>
        <div class="settings-card-body">
          <div class="settings-card-title">清除所有資料</div>
          <div class="settings-card-sub">此操作無法復原</div>
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

  _attachStatsSwipe(el) {
    if(!el) return;
    let sx=null, sy=null, fired=false;
    const onStart = e => {
      if(this._statsSwipeCooling) return;
      sx=e.touches[0].clientX; sy=e.touches[0].clientY; fired=false;
    };
    const onEnd = e => {
      if(sx===null||fired||this._statsSwipeCooling) return;
      const dx=e.changedTouches[0].clientX-sx;
      const dy=e.changedTouches[0].clientY-sy;
      if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*2) {
        fired=true;
        this._statsSwipeCooling=true;
        this._changeStatsMonth(dx<0 ? 1 : -1);
        setTimeout(()=>{this._statsSwipeCooling=false;},500);
      }
      sx=null; sy=null;
    };
    el.addEventListener('touchstart',onStart,{passive:true});
    el.addEventListener('touchend',onEnd,{passive:true});
  }

  _changeStatsMonth(delta) {
    const dir = delta > 0 ? 'left' : 'right';
    this.statsMonth += delta;
    if(this.statsMonth<1){this.statsMonth=12;this.statsYear--;}
    if(this.statsMonth>12){this.statsMonth=1;this.statsYear++;}
    this.statsCustom = false;
    const lbl = document.getElementById('stats-month-label');
    if(lbl) lbl.textContent = `${this.statsYear} 年 ${this.statsMonth} 月`;
    document.getElementById('stats-custom-range')?.classList.remove('open');
    document.getElementById('stats-custom-btn')?.classList.remove('active');
    this._renderStats(this.store.getByMonth(this.statsYear, this.statsMonth));
    // Animate stats-content
    const el = document.getElementById('stats-content');
    if(el){
      el.classList.remove('stats-slide-left','stats-slide-right');
      void el.offsetWidth; // force reflow
      el.classList.add('stats-slide-'+dir);
    }
  }

  _statsFromDefault() { return `${this.statsYear}-${String(this.statsMonth).padStart(2,'0')}-01`; }

  _renderStats(expenses) {
    const total=expenses.reduce((s,e)=>s+this._displayAmt(e),0);
    const catMap={},subMap={},catExpenses={};
    expenses.forEach(e=>{
      const k1=e.category1||'未分類';
      const amt=this._displayAmt(e);
      catMap[k1]=(catMap[k1]||0)+amt;
      if(!catExpenses[k1]) catExpenses[k1]=[];
      catExpenses[k1].push(e);
      const k2=k1+'||'+(e.category2||'(未分小類)');
      if(!subMap[k2]) subMap[k2]={amount:0,items:[]};
      subMap[k2].amount+=amt; subMap[k2].items.push(e);
    });
    const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    const sortedCatEntries=(()=>{
      const e=[...catEntries];
      if(this.statsSortMode==='amount-desc') return e.sort((a,b)=>b[1]-a[1]);
      if(this.statsSortMode==='amount-asc')  return e.sort((a,b)=>a[1]-b[1]);
      const ld=(n)=>(catExpenses[n]||[]).reduce((mx,x)=>x.date>mx?x.date:mx,'');
      if(this.statsSortMode==='date-desc') return e.sort((a,b)=>ld(b[0]).localeCompare(ld(a[0])));
      if(this.statsSortMode==='date-asc')  return e.sort((a,b)=>ld(a[0]).localeCompare(ld(b[0])));
      return e;
    })();
    const el=document.getElementById('stats-content');
    if(!el) return;
    el.innerHTML=`
      <div class="stats-total-card">
        <div class="stats-total-label">總支出</div>
        <div class="stats-total-amt">${this.money(total)}</div>
        <div class="stats-total-sub">${expenses.length} 筆記錄 · ${CURRENCIES[this._currency]?.name||'TWD'}</div>
      </div>
      <div class="stats-chart-row">
        <div class="stats-pie-wrap"><canvas id="stats-pie" width="160" height="160"></canvas></div>
        <div class="stats-legend">
          ${catEntries.map(([name,amt],i)=>{
            const pct=total>0?((amt/total)*100).toFixed(1):0;
            return `<div class="stats-legend-item">
              <span class="stats-cat-dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>
              <span class="stats-legend-icon">${this.catIcon(name)}</span>
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
        <button class="stats-sort-btn${this.statsSortMode==='date-desc'?' active':''}" data-sort="date-desc">最新</button>
        <button class="stats-sort-btn${this.statsSortMode==='date-asc'?' active':''}" data-sort="date-asc">最舊</button>
      </div>
      <div class="stats-cat-list">
        ${sortedCatEntries.length?sortedCatEntries.map(([name,amt])=>{
          const pct=total>0?((amt/total)*100).toFixed(1):0;
          const ci=catEntries.findIndex(([n])=>n===name);
          const color=CHART_COLORS[ci%CHART_COLORS.length];
          const subs=Object.entries(subMap).filter(([k])=>k.startsWith(name+'||')).sort((a,b)=>b[1].amount-a[1].amount);
          return `<div class="stats-cat-item" data-cat="${name}">
            <div class="stats-cat-header">
              <span style="font-size:16px;margin-right:2px;">${this.catIcon(name)}</span>
              <span class="stats-cat-dot-big" style="background:${color}"></span>
              <span class="stats-cat-name">${name}</span>
              <div class="stats-cat-bar-wrap"><div class="stats-cat-bar" style="width:${pct}%;background:${color}"></div></div>
              <span class="stats-cat-pct">${pct}%</span>
              <span class="stats-cat-amt">${this.money(amt)}</span>
              <span class="stats-cat-toggle">▼</span>
            </div>
            <div class="stats-cat-sub-list" id="scat-${name.replace(/[\s\/]/g,'_')}">
              ${subs.map(([k,sd])=>{
                const subName=k.split('||')[1];
                const sp=total>0?((sd.amount/total)*100).toFixed(1):0;
                const sortedItems=this.statsSortMode==='amount-asc'
                  ?[...sd.items].sort((a,b)=>this._displayAmt(a)-this._displayAmt(b))
                  :this.statsSortMode==='date-asc'
                    ?[...sd.items].sort((a,b)=>a.date.localeCompare(b.date))
                    :this.statsSortMode==='date-desc'
                      ?[...sd.items].sort((a,b)=>b.date.localeCompare(a.date))
                      :[...sd.items].sort((a,b)=>this._displayAmt(b)-this._displayAmt(a));
                return `<div class="stats-sub-cat-header">
                    <span style="font-size:13px;margin-right:4px;">${this.catIcon(subName)}</span>
                    <span class="stats-sub-cat-label">${subName}</span>
                    <span class="stats-sub-cat-pct">${sp}%</span>
                    <span class="stats-sub-cat-amt">${this.money(sd.amount)}</span>
                  </div>
                  ${sortedItems.map(it=>`
                    <div class="stats-expense-row" data-id="${it.id}">
                      <span class="stats-expense-date">${fmt.date(it.date)}</span>
                      <span class="stats-expense-desc">${it.description||'(未命名)'}</span>
                      ${it.store?`<span class="stats-expense-store">${it.store}</span>`:''}
                      <span class="stats-expense-amt">${this.money(this._displayAmt(it))}</span>
                    </div>`).join('')}`;
              }).join('')}
            </div>
          </div>`;
        }).join(''):`<div class="empty-state"><div class="icon">📊</div><p>此期間無記錄</p></div>`}
      </div>`;
    requestAnimationFrame(()=>this._drawPie(catEntries,subMap,total));
  }

  _drawPie(catEntries,subMap,total) {
    const canvas=document.getElementById('stats-pie');
    if(!canvas||!catEntries.length){canvas&&(canvas.style.display='none');return;}
    const ctx=canvas.getContext('2d');
    const cx=80,cy=80,outerR=72,innerR=42;
    const pieBg=getComputedStyle(document.body).getPropertyValue('--bg').trim()||'#181825';
    const pieText=getComputedStyle(document.body).getPropertyValue('--text').trim()||'#eeeef8';
    ctx.clearRect(0,0,160,160);
    let angle=-Math.PI/2;
    catEntries.forEach(([name,amt],i)=>{
      const color=CHART_COLORS[i%CHART_COLORS.length];
      const catSlice=total>0?(amt/total)*Math.PI*2:0;
      const subs=Object.entries(subMap).filter(([k])=>k.startsWith(name+'||')).sort((a,b)=>b[1].amount-a[1].amount);
      if(subs.length>1){
        let sa=angle;
        subs.forEach(([,sd],si)=>{
          const ss=total>0?(sd.amount/total)*Math.PI*2:0;
          ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,outerR,sa,sa+ss);ctx.closePath();
          ctx.fillStyle=si%2===0?color:`${color}88`;ctx.fill();
          ctx.strokeStyle=pieBg;ctx.lineWidth=1.5;ctx.stroke();
          sa+=ss;
        });
      } else {
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,outerR,angle,angle+catSlice);ctx.closePath();
        ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=pieBg;ctx.lineWidth=1.5;ctx.stroke();
      }
      angle+=catSlice;
    });
    ctx.beginPath();ctx.arc(cx,cy,innerR,0,Math.PI*2);ctx.fillStyle=pieBg;ctx.fill();
    ctx.fillStyle=pieText;ctx.textAlign='center';ctx.font='bold 11px DM Mono,monospace';
    ctx.fillText(this.money(total),cx,cy+4);
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
    document.querySelectorAll('.cal-day[data-date]').forEach(el=>{
      el.addEventListener('click',()=>{
        this.selected=el.dataset.date;this.renderView();
        setTimeout(()=>document.querySelector('.home-bottom')?.scrollTo({top:0,behavior:'smooth'}),50);
      });
    });
    document.getElementById('prev-month-btn')?.addEventListener('click',()=>this._changeMonth(-1));
    document.getElementById('next-month-btn')?.addEventListener('click',()=>this._changeMonth(1));
    document.getElementById('goto-today-btn')?.addEventListener('click',()=>{
      const now=new Date();this.calendarYear=now.getFullYear();this.calendarMonth=now.getMonth()+1;
      this.selected=fmt.today();this.today=fmt.today();this.renderView();
    });
    this._attachHomeSwipe(document.getElementById('main-content'));
    document.querySelectorAll('.ref-card[data-id]').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();this.openExpenseModal(el.dataset.id);});
    });
    document.querySelectorAll('.ref-card[data-grp]').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();this._openInvoiceGroupSheet(el.dataset.grp);});
    });
    document.getElementById('pending-badge')?.addEventListener('click',()=>this._openPendingModal());
    document.getElementById('add-expense-btn')?.addEventListener('click',()=>this.openExpenseModal(null));
    document.getElementById('invoice-fetch-btn')?.addEventListener('click',()=>this.openInvoiceImportModal());
  }

  _changeMonth(delta) {
    const dir=delta>0?'left':'right';
    const wrap=document.getElementById('cal-swipe-wrap');
    if(wrap){
      wrap.classList.add('cal-exit-'+dir);
      setTimeout(()=>{
        this.calendarMonth+=delta;
        if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;}
        if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;}
        this.renderView();
        const nw=document.getElementById('cal-swipe-wrap');
        if(nw){nw.classList.add('cal-enter-'+dir);requestAnimationFrame(()=>requestAnimationFrame(()=>nw.classList.remove('cal-enter-'+dir)));}
      },160);
    } else {
      this.calendarMonth+=delta;
      if(this.calendarMonth<1){this.calendarMonth=12;this.calendarYear--;}
      if(this.calendarMonth>12){this.calendarMonth=1;this.calendarYear++;}
      this.renderView();
    }
  }

  _attachHomeSwipe(el) {
    if(!el) return;
    let sx=null,sy=null,fired=false;
    el.addEventListener('touchstart',e=>{if(this._swipeCooling)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;fired=false;},{passive:true});
    el.addEventListener('touchend',e=>{
      if(sx===null||fired||this._swipeCooling)return;
      const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
      if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*2){
        fired=true;this._swipeCooling=true;
        this._changeMonth(dx<0?1:-1);
        setTimeout(()=>{this._swipeCooling=false;},500);
      }
      sx=null;sy=null;
    },{passive:true});
  }

  _attachSearchEvents() {
    const input=document.getElementById('search-input');
    const clearBtn=document.getElementById('search-clear');
    if(!input) return;
    let timer;
    input.addEventListener('input',()=>{
      clearTimeout(timer);clearBtn?.classList.toggle('hidden',!input.value);
      timer=setTimeout(()=>this._doSearch(input.value),200);
    });
    clearBtn?.addEventListener('click',()=>{
      input.value='';clearBtn.classList.add('hidden');
      document.getElementById('search-info').textContent='輸入關鍵字以搜尋';
      document.getElementById('search-results').innerHTML='';
    });
    document.getElementById('search-results')?.addEventListener('click',ev=>{
      const card=ev.target.closest('[data-id]');if(card)this.openExpenseModal(card.dataset.id);
    });
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
        <div class="ref-card" data-id="${e.id}">
          <div class="ref-card-icon">${this.catIcon(e.category2||e.category1||'其他')}</div>
          <div class="ref-card-body">
            <div class="ref-card-title">${e.category2||e.category1||'未分類'}</div>
            <div class="ref-card-sub">${e.description||'(未命名)'}${e.store?' · '+e.store:''}</div>
            <div class="ref-card-tags"><span class="ref-tag" style="color:var(--text3)">${fmt.date(e.date)}</span>${e.status==='pending'?`<span class="ref-tag pending">待分類</span>`:''}</div>
          </div>
          <div class="ref-card-right"><div class="ref-card-amount">${this.money(this._displayAmt(e))}</div></div>
        </div>`).join('')
      :`<div class="empty-state"><div class="icon">🔎</div><p>找不到</p></div>`;
  }

  _attachSettingsEvents() {
    document.getElementById('open-categories-btn')?.addEventListener('click',()=>this._openCategoriesPage());
    document.getElementById('open-store-mapping-btn')?.addEventListener('click',()=>this._openStoreMappingPage());
    document.getElementById('open-currency-settings-btn')?.addEventListener('click',()=>this._openCurrencyPicker());
    document.getElementById('open-drive-settings-btn')?.addEventListener('click',()=>this._openDriveSettingsPage());
    document.getElementById('open-local-backup-btn')?.addEventListener('click',()=>this._openLocalBackupSheet());
    document.getElementById('open-csv-import-btn')?.addEventListener('click',()=>this.openInvoiceImportModal());
    document.getElementById('open-gemini-settings-btn')?.addEventListener('click',()=>this._openGeminiSettings());
    document.getElementById('clear-data-btn')?.addEventListener('click',()=>{
      if(!confirm('確定清除所有資料？')) return;
      if(!confirm('再次確認：永久清除所有記帳資料。')) return;
      localStorage.removeItem('cost_record_v1');this.store.data=this.store._default();
      this.toast('已清除','info');this.renderView();
    });
  }

  _attachStatsEvents() {
    this._renderStats(this.store.getByMonth(this.statsYear,this.statsMonth));
    document.getElementById('stats-prev')?.addEventListener('click',()=>this._changeStatsMonth(-1));
    document.getElementById('stats-next')?.addEventListener('click',()=>this._changeStatsMonth(1));
    document.getElementById('stats-custom-btn')?.addEventListener('click',()=>{
      this.statsCustom=!this.statsCustom;
      document.getElementById('stats-custom-range')?.classList.toggle('open',this.statsCustom);
      document.getElementById('stats-custom-btn')?.classList.toggle('active',this.statsCustom);
    });
    document.getElementById('stats-range-apply')?.addEventListener('click',()=>{
      const from=document.getElementById('stats-from')?.value;
      const to=document.getElementById('stats-to')?.value;
      if(!from||!to){this.toast('請選擇日期區間','error');return;}
      const exps=this.store.data.expenses.filter(e=>e.date>=from&&e.date<=to);
      document.getElementById('stats-month-label').textContent=`${from}~${to}`;
      this._renderStats(exps);
    });
    // Stats swipe: left=next month, right=prev month
    this._attachStatsSwipe(document.getElementById('main-content'));

    document.getElementById('stats-content')?.addEventListener('click',e=>{
      const sortBtn=e.target.closest('.stats-sort-btn');
      if(sortBtn&&sortBtn.dataset.sort){
        this._statsOpenCats=new Set();
        document.querySelectorAll('.stats-cat-sub-list.open').forEach(el=>{
          const ci=el.closest('.stats-cat-item');if(ci?.dataset.cat)this._statsOpenCats.add(ci.dataset.cat);
        });
        this.statsSortMode=sortBtn.dataset.sort;
        const from=document.getElementById('stats-from')?.value||this._statsFromDefault();
        const to=document.getElementById('stats-to')?.value||fmt.today();
        const exps=this.statsCustom?this.store.data.expenses.filter(ex=>ex.date>=from&&ex.date<=to):this.store.getByMonth(this.statsYear,this.statsMonth);
        this._renderStats(exps);
        this._statsOpenCats.forEach(cat=>{
          const id='scat-'+cat.replace(/[\s\/]/g,'_');
          const sub=document.getElementById(id);
          const hdr=sub?.closest('.stats-cat-item')?.querySelector('.stats-cat-toggle');
          if(sub){sub.classList.add('open');hdr?.classList.add('open');}
        });
        return;
      }
      const catHeader=e.target.closest('.stats-cat-header');
      if(catHeader){
        const ci=catHeader.closest('.stats-cat-item');const cn=ci?.dataset.cat;if(!cn)return;
        const sl=document.getElementById('scat-'+cn.replace(/[\s\/]/g,'_'));
        const tg=catHeader.querySelector('.stats-cat-toggle');
        if(sl){const op=sl.classList.toggle('open');tg?.classList.toggle('open',op);}
        return;
      }
      const er=e.target.closest('.stats-expense-row[data-id]');
      if(er)this.openExpenseModal(er.dataset.id);
    });
  }

  // ─── CATEGORIES PAGE ──────────────────────────────────────────
  _openCategoriesPage(sortMode=false) {
    const cats=this.store.data.categories;
    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');

    // ── renders just the cat-list HTML (reused for in-place refresh) ──────────
    const buildCatList = (sm) => cats.map((cat,ci)=>`
      <div class="cat2-section" data-ci="${ci}">
        <div class="cat2-section-header">
          ${sm ? `
            <div class="cat-sort-arrows">
              <button class="cat-order-btn" data-order="up"   data-ci="${ci}" ${ci===0?'disabled':''}>▲</button>
              <button class="cat-order-btn" data-order="down" data-ci="${ci}" ${ci===cats.length-1?'disabled':''}>▼</button>
            </div>
            <span class="cat2-section-icon">${this.catIcon(cat.name)}</span>
            <span class="cat2-section-name">${cat.name}</span>
          ` : `
            <span class="cat2-section-icon" data-action="icon-cat" data-ci="${ci}">${this.catIcon(cat.name)}</span>
            <span class="cat2-section-name">${cat.name}</span>
            <div style="display:flex;gap:4px;margin-left:auto;">
              <button class="cat-action-btn" data-action="rename-cat" data-ci="${ci}">改名</button>
              <button class="cat-action-btn danger" data-action="del-cat" data-ci="${ci}">刪除</button>
            </div>
          `}
        </div>
        ${!sm ? `
        <div class="cat2-sub-list">
          ${(cat.subs||[]).map((sub,si)=>`
            <div class="cat2-sub-item">
              <span class="cat2-sub-icon" data-action="icon-sub" data-ci="${ci}" data-si="${si}">${this.catIcon(sub)}</span>
              <span class="cat2-sub-name">${subName(sub)}</span>
              <div style="display:flex;gap:4px;margin-left:auto;">
                <button class="cat-action-btn" data-action="rename-sub" data-ci="${ci}" data-si="${si}">改名</button>
                <button class="cat-action-btn danger" data-action="del-sub" data-ci="${ci}" data-si="${si}">刪除</button>
              </div>
            </div>`).join('')}
          <div class="cat2-add-row">
            <input class="cat-add-input" id="sub-input-${ci}" placeholder="新增小分類…">
            <button class="btn-primary" data-action="add-sub" data-ci="${ci}" style="padding:5px 11px;font-size:11px;">新增</button>
          </div>
        </div>` : ''}
      </div>`).join('');

    // ── bind sort ▲▼ buttons — animate swap then re-render in-place ──────────
    const bindSortBtns = () => {
      document.querySelectorAll('.cat-order-btn').forEach(btn=>{
        btn.addEventListener('click', e=>{
          e.stopPropagation();
          const ci=+btn.dataset.ci, dir=btn.dataset.order;
          const swapWith = dir==='up' ? ci-1 : ci+1;
          if(swapWith < 0 || swapWith >= cats.length) return;

          const listEl = document.getElementById('cat-list');
          if(!listEl) return;
          const sections = [...listEl.querySelectorAll('.cat2-section')];
          const elA = sections[ci];       // element being moved
          const elB = sections[swapWith]; // element it swaps with
          if(!elA || !elB) return;

          // Measure distance to slide
          const hA = elA.getBoundingClientRect().height;
          const hB = elB.getBoundingClientRect().height;
          const moveA = dir==='up' ? -hB : hB;   // elA slides up or down
          const moveB = dir==='up' ?  hA : -hA;  // elB slides the opposite way

          // Lock dimensions, disable further clicks during animation
          listEl.style.pointerEvents = 'none';

          // Apply slide transforms
          elA.style.transition = 'transform 0.22s cubic-bezier(.4,0,.2,1)';
          elB.style.transition = 'transform 0.22s cubic-bezier(.4,0,.2,1)';
          elA.style.transform  = `translateY(${moveA}px)`;
          elB.style.transform  = `translateY(${moveB}px)`;

          // After animation, swap in data and re-render
          setTimeout(() => {
            elA.style.transition = '';
            elB.style.transition = '';
            elA.style.transform  = '';
            elB.style.transform  = '';
            [cats[ci], cats[swapWith]] = [cats[swapWith], cats[ci]];
            this.store.save();
            listEl.innerHTML = buildCatList(true);
            listEl.style.pointerEvents = '';
            bindSortBtns();
          }, 230);
        });
      });
    };

    // ── full modal HTML ───────────────────────────────────────────────────────
    content.innerHTML=`
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">分類管理</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="modal-topbar-btn${sortMode?' confirm':''}" id="cat-sort-mode-btn" title="調整順序" style="font-size:20px;">⇅</button>
          ${!sortMode?'<button class="modal-topbar-btn confirm" id="cat-add-parent-btn">＋</button>':''}
        </div>
      </div>
      <div class="modal-body" style="padding:8px 0;">
        ${sortMode?'<div style="font-size:11px;color:var(--amber);text-align:center;padding:4px 0 8px;font-weight:600;">排序模式：點 ▲▼ 移動，再按 ⇅ 完成</div>':''}
        <div id="cat-list">${buildCatList(sortMode)}</div>
      </div>`;

    overlay.classList.remove('hidden'); backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));

    // ── event bindings ────────────────────────────────────────────────────────
    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});

    // Sort-mode toggle: just re-init the whole page in sort/normal mode
    document.getElementById('cat-sort-mode-btn')?.addEventListener('click',()=>{
      // Re-render in-place without close/reopen
      const newSortMode = !sortMode;
      sortMode = newSortMode;
      const listEl = document.getElementById('cat-list');
      const btnEl  = document.getElementById('cat-sort-mode-btn');
      const addBtn = document.getElementById('cat-add-parent-btn');
      const hint   = listEl?.previousElementSibling;

      // Update hint text
      if(hint && hint.style) hint.style.display = newSortMode ? '' : 'none';
      if(listEl) listEl.innerHTML = buildCatList(newSortMode);
      if(btnEl)  btnEl.classList.toggle('confirm', newSortMode);
      if(addBtn) addBtn.style.display = newSortMode ? 'none' : '';

      if(newSortMode) bindSortBtns();
      else            bindActionBtns();
    });

    const bindActionBtns = () => {
      document.getElementById('cat-add-parent-btn')?.addEventListener('click',()=>{
        this._promptCatName('新增大分類','',name=>{
          this.store.data.categories.push({name,icon:'📦',subs:[]});
          this.store.save();
          this.closeModal();
          setTimeout(()=>this._openCategoriesPage(),320);
          this.toast('已新增','success');
        });
      });
      document.querySelectorAll('[data-action]').forEach(btn=>{
        btn.addEventListener('click',e=>{
          e.stopPropagation();
          const {action,ci,si}=btn.dataset;
          this._handleCatAction(action,+ci,si!==undefined?+si:null);
        });
      });
    };

    if(sortMode)  bindSortBtns();
    else          bindActionBtns();
  }
  _openIconPicker(title, currentIcon, onSelect) {
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">${title}</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="padding:8px;">
        <div class="icon-picker-grid">
          ${ICON_LIST.map(ico=>`<button class="icon-picker-item${ico===currentIcon?' active':''}" data-ico="${ico}">${ico}</button>`).join('')}
        </div>
      </div>`);
    document.querySelectorAll('.icon-picker-item').forEach(btn=>{
      btn.addEventListener('click',()=>{onSelect(btn.dataset.ico);this.closeModal();});
    });
  }

  _handleCatAction(action,ci,si) {
    const cats=this.store.data.categories;
    if(action==='rename-cat') this._promptCatName('修改大分類',cats[ci].name,name=>{cats[ci].name=name;this.store.save();this.closeModal();setTimeout(()=>this._openCategoriesPage(),320);this.toast('已更新','success');});
    else if(action==='del-cat'){if(!confirm(`刪除「${cats[ci].name}」？`))return;cats.splice(ci,1);this.store.save();this.closeModal();setTimeout(()=>this._openCategoriesPage(),320);this.toast('已刪除','success');}
    else if(action==='add-sub'){const inp=document.getElementById('sub-input-'+ci);const n=inp?.value.trim();if(!n){this.toast('請輸入名稱','error');return;}cats[ci].subs.push({name:n,icon:CAT_ICON_MAP[n]||'📦'});this.store.save();this.closeModal();setTimeout(()=>this._openCategoriesPage(),320);this.toast('已新增','success');}
    else if(action==='rename-sub') this._promptCatName('修改小分類',subName(cats[ci].subs[si]),name=>{const old=cats[ci].subs[si];cats[ci].subs[si]=typeof old==='object'?{...old,name}:{name,icon:CAT_ICON_MAP[name]||'📦'};this.store.save();this.closeModal();setTimeout(()=>this._openCategoriesPage(),320);this.toast('已更新','success');});
    else if(action==='del-sub'){if(!confirm(`刪除「${subName(cats[ci].subs[si])}」？`))return;cats[ci].subs.splice(si,1);this.store.save();this.closeModal();setTimeout(()=>this._openCategoriesPage(),320);this.toast('已刪除','success');}
    else if(action==='icon-cat'){
      const cur=this.catIcon(cats[ci].name);
      this.closeModal();
      setTimeout(()=>this._openIconPicker(`${cats[ci].name} 圖示`,cur,ico=>{if(!this.store.data.categoryIcons)this.store.data.categoryIcons={};this.store.data.categoryIcons[cats[ci].name]=ico;this.store.save();setTimeout(()=>this._openCategoriesPage(),320);this.toast('圖示已更新','success');}),320);
    }
    else if(action==='icon-sub'){
      const sub=cats[ci].subs[si];const sn=subName(sub);const cur=this.catIcon(sub);
      this.closeModal();
      setTimeout(()=>this._openIconPicker(`${sn} 圖示`,cur,ico=>{
        const s=cats[ci].subs[si];
        if(typeof s==='object') cats[ci].subs[si]={...s,icon:ico};
        else cats[ci].subs[si]={name:sn,icon:ico};
        this.store.save();setTimeout(()=>this._openCategoriesPage(),320);this.toast('圖示已更新','success');
      }),320);
    }
  }
  _promptCatName(title,def,cb){const n=prompt(title,def);if(n&&n.trim())cb(n.trim());}

  // ─── DRIVE SETTINGS PAGE ──────────────────────────────────────
  _openDriveSettingsPage() {
    const s = this.store.data.settings;
    const lastSync = this.store.data.lastSync;
    const isSignedIn = this.drive.isSignedIn();
    const email = this.drive.getEmail();
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const backdrop = document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');
    content.innerHTML = `
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">Google Drive 備份</div>
        <div style="width:36px;"></div>
      </div>
      <div class="modal-body" style="gap:14px;">
        <div class="form-group">
          <label class="form-label">OAuth Client ID</label>
          <input class="form-input" id="s-gClientId" placeholder="xxxx.apps.googleusercontent.com" value="${s.googleClientId||''}">
        </div>
        <button class="btn-primary" id="save-drive-settings-btn" style="width:100%;">儲存設定</button>

        <!-- Login Status Card -->
        <div class="drive-login-card" id="drive-login-card">
          ${isSignedIn ? `
            <div class="drive-login-status signed-in">
              <span class="drive-login-icon">✅</span>
              <div class="drive-login-info">
                <div class="drive-login-label">已登入 Google</div>
                <div class="drive-login-email">${email || '帳戶已授權'}</div>
              </div>
              <button class="drive-signout-btn" id="drive-signout-btn">登出</button>
            </div>
          ` : `
            <div class="drive-login-status signed-out">
              <span class="drive-login-icon">🔐</span>
              <div class="drive-login-info">
                <div class="drive-login-label">尚未登入</div>
                <div class="drive-login-email">登入後可直接上傳/下載</div>
              </div>
              <button class="btn-primary drive-signin-btn" id="drive-signin-btn" style="padding:6px 14px;font-size:12px;">登入</button>
            </div>
          `}
        </div>

        ${lastSync ? `<div class="last-sync-info">上次同步：${lastSync}</div>` : ''}
        <div class="drive-action-row">
          <button class="drive-action-btn upload" id="drive-upload-btn">
            <span class="drive-action-icon">☁️</span>
            <span>上傳到雲端</span>
          </button>
          <button class="drive-action-btn download" id="drive-list-btn">
            <span class="drive-action-icon">📥</span>
            <span>從雲端下載</span>
          </button>
        </div>
        <div id="drive-backup-list"></div>
        <div style="font-size:10px;color:var(--text3);line-height:1.7;padding:8px;background:var(--bg3);border-radius:var(--radius-sm);">
          📂 備份存放於 Google Drive 的 <strong>#PWA-Cost-Record</strong> 資料夾，最多保留 5 份。
        </div>
      </div>`;
    overlay.classList.remove('hidden'); backdrop.classList.add('visible');
    requestAnimationFrame(() => content.classList.add('slide-in'));
    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    backdrop.addEventListener('click', () => this.closeModal(), { once: true });
    document.getElementById('save-drive-settings-btn')?.addEventListener('click', () => {
      const cid = document.getElementById('s-gClientId').value.trim();
      s.googleClientId = cid; this.store.save();
      if (cid) this.drive.init(cid).catch(() => {});
      this.toast('已儲存', 'success');
    });
    document.getElementById('drive-signin-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('drive-signin-btn');
      if (!s.googleClientId) { this.toast('請先填寫 Client ID', 'error'); return; }
      btn.textContent = '登入中…'; btn.disabled = true;
      try {
        await this.drive.init(s.googleClientId);
        await this.drive.signIn();
        this.toast('登入成功 ✅', 'success');
        this.closeModal(); setTimeout(() => this._openDriveSettingsPage(), 320);
      } catch(err) {
        this.toast('❌ ' + err.message, 'error');
        // Always reset button so user isn't stuck
        btn.textContent = '重試登入'; btn.disabled = false;
      }
    });
    document.getElementById('drive-signout-btn')?.addEventListener('click', async () => {
      if (!confirm('確定要登出 Google 帳戶？')) return;
      await this.drive.signOut();
      this.toast('已登出', 'info');
      this.closeModal(); setTimeout(() => this._openDriveSettingsPage(), 320);
    });
    document.getElementById('drive-upload-btn')?.addEventListener('click', () => this._driveUploadFromPage());
    document.getElementById('drive-list-btn')?.addEventListener('click', () => this._driveListModal());
  }

  async _driveUploadFromPage() {
    const btn=document.getElementById('drive-upload-btn');
    const setLabel = t => { const sp=btn?.querySelector('span:last-child'); if(sp) sp.textContent=t; };
    if(btn){ setLabel('上傳中…'); btn.disabled=true; }
    try {
      const cid = this.store.data.settings.googleClientId;
      if (!cid) throw new Error('請先填寫 Client ID 並儲存');
      await this.drive.init(cid);
      const data=this.store.export(); data._exportedAt=new Date().toISOString();
      await this.drive.uploadBackup(data);
      this.store.data.lastSync=new Date().toLocaleString('zh-TW'); this.store.save();
      this.toast('✅ 已上傳至 Google Drive','success');
      const sub=document.querySelector('#open-drive-settings-btn .settings-card-sub');
      if(sub) sub.textContent=`上次同步：${this.store.data.lastSync}`;
      // Refresh login card
      this.closeModal(); setTimeout(()=>this._openDriveSettingsPage(),320);
    } catch(err){
      this.toast('❌ ' + err.message, 'error');
    } finally {
      setLabel('上傳到雲端'); if(btn) btn.disabled=false;
    }
  }

  async _driveListModal() {
    const btn=document.getElementById('drive-list-btn');
    const setLabel = t => { const sp=btn?.querySelector('span:last-child'); if(sp) sp.textContent=t; };
    const listEl=document.getElementById('drive-backup-list');
    if(btn){ setLabel('讀取中…'); btn.disabled=true; }
    try {
      const cid = this.store.data.settings.googleClientId;
      if (!cid) throw new Error('請先填寫 Client ID 並儲存');
      await this.drive.init(cid);
      const files = await this.drive.listBackups();
      if(!listEl) return;
      if(!files.length){
        listEl.innerHTML='<p style="font-size:12px;color:var(--text3);text-align:center;padding:20px;">尚無雲端備份</p>';
        return;
      }
      // Show file list immediately — no pre-download of contents
      const fmtSize = b => b > 1024*1024 ? (b/1024/1024).toFixed(1)+'MB' : b > 1024 ? (b/1024).toFixed(0)+'KB' : b+'B';
      listEl.innerHTML=`
        <div class="drive-list-title" style="font-size:12px;color:var(--text2);margin-bottom:6px;">點擊選擇要還原的版本</div>
        ${files.map((f,i)=>`
          <div class="drive-version-item" data-file-id="${f.id}" style="cursor:pointer;">
            <div style="flex:1">
              <div class="drive-version-time">${new Date(f.modifiedTime).toLocaleString('zh-TW')}
                ${i===0?'<span class="drive-version-badge" style="margin-left:6px;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;">最新</span>':''}
              </div>
              <div class="drive-version-info">${f.size ? fmtSize(+f.size) : ''}</div>
            </div>
            <span style="font-size:18px;color:var(--text3)">›</span>
          </div>`).join('')}`;
      listEl.querySelectorAll('.drive-version-item').forEach(item=>{
        item.addEventListener('click', async () => {
          if(!confirm('\u78ba\u5b9a\u5f9e\u6b64\u5099\u4efd\u9084\u539f\uff1f\n\u672c\u6a5f\u73fe\u6709\u8cc7\u6599\u5c07\u88ab\u8986\u84cb\u3002')) return;
          item.style.opacity='0.5';
          const origText = item.querySelector('.drive-version-time')?.textContent || '';
          try {
            this.toast('下載中，請稍候…','info');
            const data = await this.drive.downloadBackup(item.dataset.fileId);
            this.store.import(data);
            this.toast('✅ 已從 Drive 還原','success');
            this.closeModal(()=>this.renderView());
          } catch(err){
            this.toast('❌ 還原失敗：'+err.message,'error');
            item.style.opacity='';
          }
        });
      });
    } catch(err){
      this.toast('❌ ' + err.message, 'error');
      if(listEl) listEl.innerHTML=`<p style="font-size:12px;color:var(--red);text-align:center;padding:16px;">${err.message}</p>`;
    } finally {
      setLabel('從雲端下載'); if(btn) btn.disabled=false;
    }
  }

  _openLocalBackupSheet() {
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">💾 本機備份</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="gap:12px;">
        <p style="font-size:12px;color:var(--text2);line-height:1.7;">將所有記帳資料匯出為 JSON 檔案，或從備份檔案匯入。</p>
        <button class="btn-primary" id="export-local-btn" style="width:100%;">📤 匯出 JSON 備份</button>
        <button class="btn-secondary" id="import-local-btn" style="width:100%;">📥 匯入 JSON 備份</button>
        <input type="file" id="import-file-input" accept=".json" style="display:none">
      </div>`);
    document.getElementById('export-local-btn')?.addEventListener('click',()=>this.exportLocal());
    document.getElementById('import-local-btn')?.addEventListener('click',()=>document.getElementById('import-file-input')?.click());
    document.getElementById('import-file-input')?.addEventListener('change',e=>this.importLocal(e));
  }

  _openGeminiSettings() {
    const s=this.store.data.settings;
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">🤖 Gemini AI 設定</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="gap:10px;">
        <p style="font-size:11px;color:var(--text2);line-height:1.7;">Gemini AI 用於自動產生例句等 AI 功能。請至 <strong>Google AI Studio</strong> 申請免費 API Key。</p>
        <div class="form-group">
          <label class="form-label">API Key</label>
          <div class="api-key-wrap">
            <input class="form-input" id="s-geminiKey" type="password" placeholder="Gemini API Key" value="${s.geminiApiKey||''}">
            <button class="api-key-toggle" data-target="s-geminiKey">👁</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">模型</label>
          <select class="form-select" id="s-geminiModel">
            ${['gemini-1.5-flash','gemini-1.5-pro','gemini-2.0-flash','gemini-2.0-pro'].map(m=>`<option value="${m}" ${s.geminiModel===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary" id="save-gemini-btn" style="width:100%;">儲存</button>
      </div>`);
    document.querySelectorAll('.api-key-toggle').forEach(btn=>{
      btn.addEventListener('click',()=>{const inp=document.getElementById(btn.dataset.target);if(!inp)return;inp.type=inp.type==='password'?'text':'password';btn.textContent=inp.type==='password'?'👁':'🙈';});
    });
    document.getElementById('save-gemini-btn')?.addEventListener('click',()=>{
      s.geminiApiKey=document.getElementById('s-geminiKey').value.trim();
      s.geminiModel=document.getElementById('s-geminiModel').value;
      this.store.save();this.toast('已儲存','success');this.closeModal(()=>this.renderView());
    });
  }

  // ─── INVOICE GROUP EDIT ───────────────────────────────────────
  _openInvoiceGroupSheet(invoiceNo) {
    const items=this.store.data.expenses.filter(e=>e.invoiceNo===invoiceNo);
    if(!items.length)return;
    const total=items.reduce((s,i)=>s+this._displayAmt(i),0);
    const store=items[0]?.store||'電子發票';
    const date=items[0]?.date||fmt.today();
    const combinedDesc=items.map(it=>`${it.description||'(未命名)'}  ${this.money(this._displayAmt(it))}`).join('\n');
    const firstCat1=items.find(i=>i.category1)?.category1||'';
    const firstCat2=items.find(i=>i.category2)?.category2||'';
    const cats=this.store.data.categories;
    const selectedCat=cats.find(c=>c.name===firstCat1);
    const cat1Html=cats.map(cat=>`
      <button class="edit-cat-btn${firstCat1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${this.catIcon(cat.name)}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');
    const cat2Html=selectedCat?(selectedCat.subs||[]).map(sub=>`
      <button class="edit-cat-btn${firstCat2===subName(sub)?' selected':''}" data-cat1="${selectedCat.name}" data-cat2="${subName(sub)}">
        <div class="edit-cat-circle">${this.catIcon(sub)}</div>
        <div class="edit-cat-label">${subName(sub)}</div>
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
        <div class="edit-field-grid">
          <div class="edit-field"><div class="edit-field-label">日期</div><div class="edit-field-value" style="color:var(--text3)">${fmt.date(date)}</div></div>
          <div class="edit-field"><div class="edit-field-label">消費店家</div><div class="edit-field-value" style="color:var(--text3)">${store}</div></div>
          <div class="edit-field edit-field-full"><div class="edit-field-label">發票號碼</div><div class="edit-field-value" style="color:var(--text3)">${invoiceNo}</div></div>
        </div>
        <div class="edit-notes-area">
          <div class="edit-notes-label">消費項目明細（${items.length} 項，${this.money(total)}）</div>
          <textarea class="edit-notes-input" readonly tabindex="-1" style="color:var(--text2);min-height:80px;max-height:160px;overflow-y:auto;pointer-events:none;">${combinedDesc}</textarea>
        </div>
      </div>`;
    overlay.classList.remove('hidden');backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#grp-cat1-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');
        const cat=cats.find(c=>c.name===btn.dataset.cat1);
        const area=document.getElementById('grp-cat2-area');const row=document.getElementById('grp-cat2-row');
        if(cat&&cat.subs?.length){
          row.innerHTML=cat.subs.map(sub=>`<button class="edit-cat-btn" data-cat1="${btn.dataset.cat1}" data-cat2="${subName(sub)}"><div class="edit-cat-circle">${this.catIcon(sub)}</div><div class="edit-cat-label">${subName(sub)}</div></button>`).join('');
          area.classList.remove('hidden');
          row.querySelectorAll('.edit-cat-btn').forEach(b=>{b.addEventListener('click',()=>{row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');});});
        } else {area.classList.add('hidden');}
      });
    });
    document.querySelectorAll('#grp-cat2-row .edit-cat-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('#grp-cat2-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');});});
    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});
    document.getElementById('grp-save-btn')?.addEventListener('click',()=>{
      const cat1=document.querySelector('#grp-cat1-row .edit-cat-btn.selected')?.dataset.cat1||'';
      const cat2=document.querySelector('#grp-cat2-row .edit-cat-btn.selected')?.dataset.cat2||'';
      if(!cat1){this.toast('請選擇大分類','error');return;}
      items.forEach(it=>this.store.updateExpense(it.id,{category1:cat1,category2:cat2,status:'categorized'}));
      this.toast(`✅ 已更新 ${items.length} 筆分類`,'success');
      this.closeModal(()=>this.renderView());
    });
  }

  // ─── STORE MAPPING ────────────────────────────────────────────
  _openStoreMappingPage() {
    this._smSortMode=this._smSortMode||'name';
    const rules=this.store.data.storeMapping||[];
    const sorted=[...rules.entries()].map(([i,r])=>({...r,_idx:i}));
    if(this._smSortMode==='name') sorted.sort((a,b)=>a.store.localeCompare(b.store,'zh-TW'));
    else sorted.sort((a,b)=>b._idx-a._idx);
    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('sheet-mode');
    content.innerHTML=`
      <div class="modal-topbar">
        <button class="modal-topbar-btn" id="modal-close-btn">✕</button>
        <div class="modal-topbar-title">店家自動分類</div>
        <button class="modal-topbar-btn confirm" id="sm-add-new-btn">＋</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 14px 6px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <span style="font-size:10px;color:var(--text3);">排序：</span>
        <button class="stats-sort-btn${this._smSortMode==='name'?' active':''}" data-sm-sort="name">名稱</button>
        <button class="stats-sort-btn${this._smSortMode==='time'?' active':''}" data-sm-sort="time">新增時間</button>
        <span style="margin-left:auto;font-size:10px;color:var(--text3);">${rules.length} 條</span>
      </div>
      <div style="flex:1;overflow-y:auto;min-height:0;">
        ${sorted.length?sorted.map(r=>`
          <div class="sm-rule-row" data-ridx="${r._idx}">
            <div class="sm-rule-store">${r.store}</div>
            <div class="sm-rule-cats">${r.cat1}${r.cat2?' › '+r.cat2:''}</div>
            <div class="sm-rule-actions">
              <button class="sm-rule-btn edit" data-ridx="${r._idx}">✏️</button>
              <button class="sm-rule-btn del" data-ridx="${r._idx}">🗑</button>
            </div>
          </div>`).join('')
          :`<div class="empty-state"><div class="icon">🏪</div><p>尚無規則</p></div>`}
      </div>`;
    overlay.classList.remove('hidden');backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    document.getElementById('modal-close-btn')?.addEventListener('click',()=>this.closeModal());
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});
    document.getElementById('sm-add-new-btn')?.addEventListener('click',()=>{this.closeModal();setTimeout(()=>this._openStoreMappingModal(null),320);});
    document.querySelectorAll('[data-sm-sort]').forEach(btn=>{btn.addEventListener('click',()=>{this._smSortMode=btn.dataset.smSort;this.closeModal();setTimeout(()=>this._openStoreMappingPage(),320);});});
    document.querySelectorAll('.sm-rule-btn.edit').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const idx=+btn.dataset.ridx;this.closeModal();setTimeout(()=>this._openStoreMappingModal(idx),320);});});
    document.querySelectorAll('.sm-rule-btn.del').forEach(btn=>{
      btn.addEventListener('click',e=>{e.stopPropagation();const idx=+btn.dataset.ridx;if(!confirm(`刪除「${this.store.data.storeMapping[idx]?.store}」規則？`))return;this.store.data.storeMapping.splice(idx,1);this.store.save();this.toast('已刪除','success');this.closeModal();setTimeout(()=>this._openStoreMappingPage(),320);});
    });
  }

  _openStoreMappingModal(existingIdx) {
    const cats=this.store.data.categories;
    const catOptions=cats.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
    const existing=existingIdx!==null?this.store.data.storeMapping[existingIdx]:null;
    this._openSheet(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">🏪 店家分類規則</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body" style="gap:10px;">
        <div class="form-group"><label class="form-label">店家名稱（關鍵字）</label>
          <input class="form-input" id="sm-store" placeholder="例：全聯、麥當勞" value="${existing?.store||''}"></div>
        <div class="form-row-2">
          <div class="form-group"><label class="form-label">大分類</label>
            <select class="form-select" id="sm-cat1"><option value="">-- 選擇 --</option>${catOptions}</select></div>
          <div class="form-group"><label class="form-label">小分類</label>
            <select class="form-select" id="sm-cat2" disabled><option value="">-- 選擇 --</option></select></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="modal-cancel-btn">取消</button>
        <button class="btn-primary" id="sm-save-btn">儲存</button>
      </div>`);
    const sel1=document.getElementById('sm-cat1'),sel2=document.getElementById('sm-cat2');
    if(existing){sel1.value=existing.cat1;this._populateSelect2(sel1.value,sel2,existing.cat2);}
    sel1.addEventListener('change',()=>this._populateSelect2(sel1.value,sel2,''));
    document.getElementById('sm-save-btn')?.addEventListener('click',()=>{
      const store=document.getElementById('sm-store').value.trim();const cat1=sel1.value;const cat2=sel2.value;
      if(!store||!cat1){this.toast('請填寫店家與分類','error');return;}
      const rule={store,cat1,cat2};
      if(!this.store.data.storeMapping)this.store.data.storeMapping=[];
      if(existingIdx!==null)this.store.data.storeMapping[existingIdx]=rule;
      else this.store.data.storeMapping.push(rule);
      this.store.save();this.toast('已儲存','success');this.closeModal(()=>this.renderView());
    });
  }

  _populateSelect2(cat1,sel2,selectedCat2) {
    const subs=this.store.data.categories.find(c=>c.name===cat1)?.subs||[];
    sel2.innerHTML='<option value="">-- 選擇 --</option>'+subs.map(s=>`<option value="${subName(s)}" ${subName(s)===selectedCat2?'selected':''}>${subName(s)}</option>`).join('');
    sel2.disabled=!subs.length;
  }

  // ─── EXPENSE MODAL ────────────────────────────────────────────
  openExpenseModal(id) {
    const expense=id?this.store.data.expenses.find(e=>e.id===id):null;
    this._editId=id||null;
    const cats=this.store.data.categories;
    const isEdit=!!expense;
    const e=expense||{date:this.selected,description:'',store:'',amount:'',currency:'TWD',category1:'',category2:'',status:'categorized',source:'manual'};
    const eCur=e.currency||'TWD';
    const cat1Html=cats.map(cat=>`
      <button class="edit-cat-btn${e.category1===cat.name?' selected':''}" data-cat1="${cat.name}" data-cat2="">
        <div class="edit-cat-circle">${this.catIcon(cat.name)}</div>
        <div class="edit-cat-label">${cat.name}</div>
      </button>`).join('');
    const selectedCat=cats.find(c=>c.name===e.category1);
    const cat2Html=selectedCat?(selectedCat.subs||[]).map(sub=>`
      <button class="edit-cat-btn${e.category2===subName(sub)?' selected':''}" data-cat1="${selectedCat.name}" data-cat2="${subName(sub)}">
        <div class="edit-cat-circle">${this.catIcon(sub)}</div>
        <div class="edit-cat-label">${subName(sub)}</div>
      </button>`).join(''):'';
    const invItems=(isEdit&&e.invoiceNo)?this.store.getInvoiceItems(e.invoiceNo):[];
    const invHtml=invItems.length>1?`
      <div class="inv-items-section">
        <div class="inv-items-section-title">同張發票 · ${e.invoiceNo}</div>
        ${invItems.map(it=>`
          <div class="inv-item-row ${it.id===e.id?'inv-item-current':''}" ${it.id!==e.id?`data-inv-id="${it.id}"`:''}>
            <span class="inv-item-name">${it.description||'(未命名)'}</span>
            <span class="inv-item-amt">${this.money(this._displayAmt(it))}</span>
            ${it.id===e.id?`<span class="inv-item-current-badge">本筆</span>`:`<span class="inv-item-cat${it.status==='pending'?' pending':''}">${it.status==='pending'?'待分類':(it.category1||'未分類')}</span>`}
          </div>`).join('')}
      </div>`:'';
    const currencyOptions=Object.entries(CURRENCIES).map(([code,info])=>`<option value="${code}" ${eCur===code?'selected':''}>${info.flag} ${info.name.split(' ')[0]} (${code})</option>`).join('');
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
      <div class="modal-body expense-form">
        <div class="cat-level-wrap">
          <div class="cat-level-label">大分類</div>
          <div class="edit-category-row" id="cat1-row">${cat1Html}</div>
          <div class="cat-sub-area${selectedCat?'':' hidden'}" id="cat2-area">
            <div class="cat-level-label" style="padding:6px 8px 2px">小分類</div>
            <div class="edit-category-row" id="cat2-row">${cat2Html}</div>
          </div>
        </div>
        <div class="edit-amount-display">
          <select class="edit-amount-currency-select" id="f-currency">${currencyOptions}</select>
          <input class="edit-amount-input" type="number" id="f-amount" placeholder="0" value="${e.amount||''}" inputmode="decimal" min="0">
        </div>
        <div class="edit-field-grid">
          <div class="edit-field"><div class="edit-field-label">日期</div>
            <input class="edit-field-value" type="date" id="f-date" value="${e.date||this.selected}"></div>
          <div class="edit-field"><div class="edit-field-label">消費店家</div>
            <input class="edit-field-value" id="f-store" placeholder="店家名稱" value="${e.store||''}"></div>
          ${isEdit&&e.invoiceNo?`<div class="edit-field edit-field-full"><div class="edit-field-label">發票號碼</div><div class="edit-field-value" style="color:var(--text3)">${e.invoiceNo}</div></div>`:''}
        </div>
        ${invHtml}
        <div class="edit-notes-area">
          <div class="edit-notes-label">消費項目說明</div>
          <textarea class="edit-notes-input" id="f-desc" placeholder="請輸入消費項目說明">${e.description||''}</textarea>
        </div>
        ${isEdit?`<div style="padding:10px 0 16px;flex-shrink:0"><button class="edit-delete-btn" id="modal-delete-btn">🗑 刪除這筆消費</button></div>`:'<div style="padding-bottom:16px;flex-shrink:0"></div>'}
      </div>`;
    overlay.classList.remove('hidden');backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    this._attachModalSwipeBack(content,()=>{
      const isDirty=document.getElementById('f-amount')?.value!==String(e.amount||'')
        ||document.getElementById('f-desc')?.value.trim()!==(e.description||'')
        ||document.getElementById('f-store')?.value.trim()!==(e.store||'');
      if(isDirty){const ch=confirm('是否要儲存已編輯的內容？\n確定 → 儲存並關閉\n取消 → 不儲存直接關閉');if(ch){this._saveExpense(e,isEdit);return;}}
      this.closeModal();
    });
    document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#cat1-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');
        const cat=cats.find(c=>c.name===btn.dataset.cat1);
        const area=document.getElementById('cat2-area');const row=document.getElementById('cat2-row');
        if(cat&&cat.subs?.length){
          row.innerHTML=cat.subs.map(sub=>`<button class="edit-cat-btn" data-cat1="${btn.dataset.cat1}" data-cat2="${subName(sub)}"><div class="edit-cat-circle">${this.catIcon(sub)}</div><div class="edit-cat-label">${subName(sub)}</div></button>`).join('');
          area.classList.remove('hidden');
          row.querySelectorAll('.edit-cat-btn').forEach(b=>{b.addEventListener('click',()=>{row.querySelectorAll('.edit-cat-btn').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');});});
        } else {area.classList.add('hidden');}
      });
    });
    document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('#cat2-row .edit-cat-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');});});

    // ── Fix 3: Auto-apply store mapping when store name is entered ────────────
    const _applyStoreToUI = (storeName) => {
      if (!storeName) return;
      const mapped = this._applyStoreMapping(storeName);
      if (!mapped.cat1) return; // no matching rule
      // Select cat1
      const cat1Btns = document.querySelectorAll('#cat1-row .edit-cat-btn');
      let matchedCat = null;
      cat1Btns.forEach(b => {
        b.classList.remove('selected');
        if (b.dataset.cat1 === mapped.cat1) { b.classList.add('selected'); matchedCat = b; }
      });
      // Build and select cat2
      if (matchedCat && mapped.cat2) {
        const cat = cats.find(c => c.name === mapped.cat1);
        const area = document.getElementById('cat2-area');
        const row  = document.getElementById('cat2-row');
        if (cat && cat.subs?.length) {
          row.innerHTML = cat.subs.map(sub =>
            `<button class="edit-cat-btn${subName(sub)===mapped.cat2?' selected':''}" data-cat1="${mapped.cat1}" data-cat2="${subName(sub)}">
              <div class="edit-cat-circle">${this.catIcon(sub)}</div>
              <div class="edit-cat-label">${subName(sub)}</div>
            </button>`
          ).join('');
          area.classList.remove('hidden');
          row.querySelectorAll('.edit-cat-btn').forEach(b => {
            b.addEventListener('click', () => {
              row.querySelectorAll('.edit-cat-btn').forEach(x => x.classList.remove('selected'));
              b.classList.add('selected');
            });
          });
        }
        this.toast(`已自動帶入「${mapped.cat1} › ${mapped.cat2}」`, 'info');
      }
    };
    // Trigger on blur (when user finishes typing store name)
    const storeInput = document.getElementById('f-store');
    if (storeInput) {
      storeInput.addEventListener('blur', () => {
        // Only auto-fill if cat1 not already selected
        const alreadySelected = document.querySelector('#cat1-row .edit-cat-btn.selected');
        if (!alreadySelected) _applyStoreToUI(storeInput.value.trim());
      });
      // Also trigger immediately if store value already populated (edit mode)
      if (storeInput.value.trim() && !e.category1) {
        setTimeout(() => _applyStoreToUI(storeInput.value.trim()), 100);
      }
    }
    document.querySelectorAll('.inv-item-row[data-inv-id]').forEach(row=>{row.addEventListener('click',()=>{this.closeModal(()=>this.openExpenseModal(row.dataset.invId));});});
    // Use pointerdown so buttons respond instantly without waiting for keyboard dismiss
    const _addFastBtn = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      let _fired = false;
      el.addEventListener('pointerdown', () => { _fired = false; });
      el.addEventListener('pointerup', (e) => { if(!_fired){ _fired=true; e.preventDefault(); fn(); } });
      el.addEventListener('click', (e) => { e.preventDefault(); if(!_fired){ _fired=true; fn(); } });
    };
    _addFastBtn('modal-close-btn', () => this.closeModal());
    _addFastBtn('modal-save-btn', () => this._saveExpense(e, isEdit));
    backdrop.addEventListener('click',()=>this.closeModal(),{once:true});

    // ── Currency auto-conversion ──
    let _curPrev = eCur; // track previous currency for conversion
    document.getElementById('f-currency')?.addEventListener('change', async(ev)=>{
      const toCur = ev.target.value;
      const fromCur = _curPrev;
      if(fromCur === toCur) return;
      const amtEl = document.getElementById('f-amount');
      const amt = parseFloat(amtEl?.value);
      if(!amtEl || isNaN(amt) || amt <= 0) { _curPrev = toCur; return; }
      // Show converting indicator
      const sel = document.getElementById('f-currency');
      const origText = sel.options[sel.selectedIndex]?.text;
      amtEl.disabled = true;
      amtEl.style.opacity = '0.5';
      try {
        const converted = await this.currencySvc.convert(amt, fromCur, toCur);
        amtEl.value = String(converted);
        const srcInfo = CURRENCIES[fromCur]?.symbol||fromCur;
        const dstInfo = CURRENCIES[toCur]?.symbol||toCur;
        this.toast(srcInfo+amt+' → '+dstInfo+converted, 'info');
      } catch(err) {
        this.toast('匯率取得失敗，已保留原金額', 'error');
        ev.target.value = fromCur; // revert
      } finally {
        amtEl.disabled = false;
        amtEl.style.opacity = '';
        _curPrev = toCur;
      }
    });
    document.getElementById('modal-delete-btn')?.addEventListener('click',()=>{
      if(!confirm('確定刪除？'))return;
      this.store.deleteExpense(this._editId);this.toast('已刪除','success');this.closeModal(()=>this.renderView());
    });
  }

  _saveExpense(e,isEdit) {
    const date=document.getElementById('f-date')?.value;
    const amount=parseFloat(document.getElementById('f-amount')?.value);
    const desc=document.getElementById('f-desc')?.value.trim();
    const store=document.getElementById('f-store')?.value.trim();
    const currency=document.getElementById('f-currency')?.value||'TWD';
    const cat1=document.querySelector('#cat1-row .edit-cat-btn.selected')?.dataset.cat1||'';
    const cat2=document.querySelector('#cat2-row .edit-cat-btn.selected')?.dataset.cat2||'';
    if(!date){this.toast('請選擇日期','error');return;}
    if(isNaN(amount)||amount<=0){this.toast('請輸入有效金額','error');return;}
    if(!desc){this.toast('請輸入消費項目','error');return;}
    const data={date,amount,description:desc,store,currency,category1:cat1,category2:cat2,
      status:cat1?'categorized':'pending',source:e.source||'manual',invoiceNo:e.invoiceNo||''};
    if(isEdit){this.store.updateExpense(this._editId,data);this.toast('已更新','success');}
    else{this.store.addExpense(data);this.toast('已新增','success');this.selected=date;const d=new Date(date);this.calendarYear=d.getFullYear();this.calendarMonth=d.getMonth()+1;}
    this.closeModal(()=>this.renderView());
  }

  _setupGlobalSwipeBack() {
    // EDGE-ONLY swipe-back: only activates when touch starts within 22px of left edge.
    // This prevents any accidental triggering when tapping buttons, scrolling lists, etc.
    const EDGE_ZONE   = 22;   // px from left edge to start swipe
    const MIN_DIST    = 10;   // px before we commit to a direction
    const DISMISS_PCT = 0.38; // fraction of screen width to trigger close

    let sx=null, sy=null, dx=0, dy=0, phase='idle';

    const onStart = e => {
      // Only watch touches that BEGIN in the left edge zone
      if (e.touches[0].clientX > EDGE_ZONE) return;
      const overlay = document.getElementById('modal-overlay');
      if (!overlay || overlay.classList.contains('hidden')) return;
      const content = document.getElementById('modal-content');
      if (!content || content.classList.contains('sheet-mode')) return;
      sx=e.touches[0].clientX; sy=e.touches[0].clientY; dx=0; dy=0; phase='deciding';
    };

    const onMove = e => {
      if (phase === 'idle' || phase === 'dead') return;
      dx = e.touches[0].clientX - sx;
      dy = e.touches[0].clientY - sy;
      if (phase === 'deciding') {
        if (Math.abs(dx) < MIN_DIST && Math.abs(dy) < MIN_DIST) return;
        if (dx > 0 && Math.abs(dx) >= Math.abs(dy)) {
          phase = 'swiping';
        } else {
          phase = 'dead'; // vertical or leftward — abort
          return;
        }
      }
      if (phase === 'swiping' && dx > 0) {
        e.preventDefault();
        const content = document.getElementById('modal-content');
        if (content) {
          content.style.transform = `translateX(${Math.min(dx, window.innerWidth)}px)`;
          content.style.transition = 'none';
        }
      }
    };

    const onEnd = () => {
      if (phase === 'swiping') {
        const content = document.getElementById('modal-content');
        if (content) {
          content.style.transition = '';
          if (dx > window.innerWidth * DISMISS_PCT) {
            this.closeModal();
          } else {
            content.style.transform = content.classList.contains('slide-in') ? 'translateX(0)' : '';
          }
        }
      }
      sx=null; sy=null; dx=0; dy=0; phase='idle';
    };

    document.addEventListener('touchstart', onStart, {passive:true});
    document.addEventListener('touchmove',  onMove,  {passive:false});
    document.addEventListener('touchend',   onEnd,   {passive:true});
    document.addEventListener('touchcancel',onEnd,   {passive:true});
  }

  closeModal(cb) {
    const content=document.getElementById('modal-content');
    const overlay=document.getElementById('modal-overlay');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.remove('slide-in');backdrop.classList.remove('visible');
    setTimeout(()=>{overlay.classList.add('hidden');content.innerHTML='';content.classList.remove('sheet-mode');this._editId=null;if(cb)cb();},300);
  }

  _attachModalSwipeBack(el,onClose) {
    // No-op: global swipe-back (_setupGlobalSwipeBack) handles all modals uniformly.
    // Keeping this method signature so existing callers don't break.
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
      <div class="modal-header"><div class="modal-title">待分類 (${pending.length} 筆)</div><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="modal-body-scroll">
        <div style="font-size:10px;color:var(--text3);margin-bottom:7px;">為每筆選擇分類後，點「儲存所有分類」</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${pending.map(e=>`
            <div class="pending-row" data-pid="${e.id}">
              <div class="pending-row-top"><div class="pending-desc">${e.description||'(未命名)'}</div><div class="pending-amt">${this.money(this._displayAmt(e))}</div></div>
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
        const sel2=document.querySelector(`.pending-cat2[data-pid="${sel.dataset.pid}"]`);
        const subs=cats.find(c=>c.name===sel.value)?.subs||[];
        sel2.innerHTML='<option value="">小分類</option>'+subs.map(s=>`<option value="${subName(s)}">${subName(s)}</option>`).join('');
        sel2.disabled=!subs.length;
      });
    });
    document.getElementById('pending-save-all-btn')?.addEventListener('click',()=>{
      let saved=0;
      document.querySelectorAll('.pending-row[data-pid]').forEach(row=>{
        const pid=row.dataset.pid;
        const cat1=row.querySelector(`.pending-cat1[data-pid="${pid}"]`)?.value||'';
        const cat2=row.querySelector(`.pending-cat2[data-pid="${pid}"]`)?.value||'';
        if(!cat1)return;
        this.store.updateExpense(pid,{category1:cat1,category2:cat2,status:'categorized'});saved++;
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
        <div class="import-choice-card" id="choice-csv">
          <div class="import-choice-icon">📂</div>
          <div><div class="import-choice-title">匯入 CSV 檔案</div><div class="import-choice-sub">財政部平台下載的 CSV（免 API）</div></div>
          <div class="import-choice-arrow">›</div>
        </div>
      </div>`);
    document.getElementById('choice-csv')?.addEventListener('click',()=>{this.closeModal();setTimeout(()=>document.getElementById('csv-invoice-input')?.click(),350);});
  }

  _openSheet(html) {
    const overlay=document.getElementById('modal-overlay');
    const content=document.getElementById('modal-content');
    const backdrop=document.getElementById('modal-backdrop');
    content.classList.add('sheet-mode');content.innerHTML=html;
    overlay.classList.remove('hidden');backdrop.classList.add('visible');
    requestAnimationFrame(()=>content.classList.add('slide-in'));
    ['modal-close-btn','modal-cancel-btn'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>this.closeModal()));
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.closeModal();},{once:true});
  }

  _applyStoreMapping(storeName) {
    const rules=this.store.data.storeMapping||[];
    for(const rule of rules){if(storeName.toLowerCase().includes(rule.store.toLowerCase()))return{cat1:rule.cat1,cat2:rule.cat2};}
    return{cat1:'',cat2:''};
  }

  _handleCsvFile(event) {
    const file=event.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=e=>{
      try{const rows=this.csvParser.parse(e.target.result);if(!rows.length){this.toast('無有效資料','error');return;}this._showCsvPreviewModal(rows);}
      catch(err){this.toast('CSV 解析失敗：'+err.message,'error');}
    };
    reader.readAsText(file,'utf-8');event.target.value='';
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
        ${skipCount>0?`<div class="csv-skip-note">⚠ ${skipCount} 筆已匯入，略過</div>`:''}
        <div style="max-height:280px;overflow-y:auto;margin:0 -14px;padding:0 14px 14px;">${invoiceHTML}</div>
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
      if(this.store.isInvoiceImported(key))continue;
      const mapped=this._applyStoreMapping(r.store);
      this.store.addExpense({date:r.date,amount:r.amount,description:r.description,store:r.store,currency:'TWD',
        category1:mapped.cat1,category2:mapped.cat2,status:mapped.cat1?'categorized':'pending',source:'invoice',invoiceNo:r.invoiceNo});
      this.store.markInvoiceImported(key);imported++;
    }
    this.toast(`✅ 已匯入 ${imported} 筆`,'success');
    if(rows.length>0&&rows[0].date){const d=new Date(rows[0].date);this.calendarYear=d.getFullYear();this.calendarMonth=d.getMonth()+1;this.selected=rows[0].date;}
    this.closeModal(()=>this.renderView());
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
    const file=event.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=e=>{
      try{const raw=JSON.parse(e.target.result);if(!confirm(`備份包含 ${(raw.expenses||[]).length} 筆記錄\n確定匯入？`))return;this.store.import(raw);this.toast('備份匯入成功','success');this.closeModal(()=>this.renderView());}
      catch(err){this.toast('匯入失敗：'+err.message,'error');}
    };
    reader.readAsText(file);event.target.value='';
  }

  // ─── TOAST ────────────────────────────────────────────────────
  toast(msg,type='info') {
    const el=document.getElementById('toast');if(!el)return;
    el.textContent=msg;el.className=`show ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer=setTimeout(()=>{el.className='';},2800);
  }
}

// ── BOOT ──────────────────────────────────────────────────────
// ── Boot: resilient for iOS PWA (DOMContentLoaded may fire late or early)
(function boot() {
  function startApp() {
    if (window._app) return; // already started
    try {
      window._app = new App();
      window._app.init();
    } catch(err) {
      console.error('App boot error:', err);
      const m = document.getElementById('main-content');
      if (m) m.innerHTML = `<div class="empty-state" style="margin-top:80px;"><div class="icon">⚠️</div><p style="color:#f43f5e;font-size:12px;">啟動失敗：${err.message}<br><small>請嘗試重新整理</small></p></div>`;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp(); // DOM already ready
  }
})();

