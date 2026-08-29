/* =====================================================================
   VaultBit — user application (index.html)
   Custom auth over the `users` table · localStorage session · realtime
   ===================================================================== */

/* ---------- 1 · Supabase config (anon/publishable key ONLY) ---------- */
const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';   // ← replace
const SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-ANON-KEY';           // ← replace (anon key only)
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- 2 · Constants ---------- */
const COINS = {
  BTC :{name:'Bitcoin',  glyph:'₿', col:'btc_balance',  cg:'bitcoin',     color:'#F7931A', fee:0.00012},
  ETH :{name:'Ethereum', glyph:'Ξ', col:'eth_balance',  cg:'ethereum',    color:'#627EEA', fee:0.0009},
  USDT:{name:'Tether',   glyph:'₮', col:'usdt_balance', cg:'tether',      color:'#26A17B', fee:0.35},
  SOL :{name:'Solana',   glyph:'◎', col:'sol_balance',  cg:'solana',      color:'#7A5AF8', fee:0.005},
  XRP :{name:'XRP',      glyph:'✕', col:'xrp_balance',  cg:'ripple',      color:'#23292F', fee:0.2},
  DOGE:{name:'Dogecoin', glyph:'Ð', col:'doge_balance', cg:'dogecoin',    color:'#C2A633', fee:0.8},
  BNB :{name:'BNB',      glyph:'◆', col:'bnb_balance',  cg:'binancecoin', color:'#F0B90B', fee:0.0005},
};
const ASSET_INR = {name:'Indian Rupee', glyph:'₹', col:'inr_balance', color:'#0CA678'};
const ANN_ICON = {General:'megaphone', Market:'trending-up', Maintenance:'wrench', Security:'shield-alert'};
const LS = {
  session:'vaultbit_session', theme:'vaultbit_theme',
  watch:'vaultbit_watch_', twofa:'vaultbit_2fa_', dismiss:'vaultbit_dismissed_',
  logins:'vaultbit_logins_', notifpref:'vaultbit_notifpref_'
};

/* ---------- 3 · State ---------- */
const state = {
  user:null, wallet:null, prices:{}, spark:{}, txs:[], names:{},
  withdrawals:[], notifs:[], announcements:[], watch:[],
  view:'home', actFilter:'all', mktFilter:'all', mktQuery:'',
  pchart:null, cchart:null, priceTimer:null, wrMethod:'UPI'
};

/* ---------- 4 · Tiny helpers ---------- */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtINR = (n,d=2)=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtAmt = n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:8});
const round8 = v=>Math.round(v*1e8)/1e8;
const fmtDT = iso=>new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
const fmtD  = iso=>new Date(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const badge = s=>`<span class="badge ${esc(s)}">${esc(s)}</span>`;
const hex = n=>[...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,'0')).join('');
const txHash = ()=>'0x'+hex(32);
const genAddr = ()=>'0x'+hex(20);
function icons(){ if(window.lucide) lucide.createIcons(); }

function toast(msg,type='info'){
  const ic = {success:'check-circle-2', error:'alert-triangle', info:'info'}[type]||'info';
  const el = document.createElement('div');
  el.className = 'toast '+type;
  el.innerHTML = `<i data-lucide="${ic}"></i><span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el); icons();
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),260); }, 3200);
}
function openModal(id){ const m=$('#'+id); m.hidden=false; requestAnimationFrame(()=>m.classList.add('open')); }
function closeModal(id){ const m=$('#'+id); m.classList.remove('open'); setTimeout(()=>m.hidden=true,240); }
function showSuccess(title,msg){
  $('#sc-title').textContent=title; $('#sc-msg').textContent=msg; openModal('modal-success');
}
let _cfCb=null;
function askConfirm(title,msg,yesLabel,cb,danger=true){
  $('#cf-title').textContent=title; $('#cf-msg').textContent=msg;
  const y=$('#cf-yes'); y.textContent=yesLabel;
  y.className='btn '+(danger?'btn-danger':'btn-primary');
  _cfCb=cb; openModal('modal-confirm');
}
function countUp(el,to,fmt=fmtINR,dur=850){
  const from = Number(el.dataset.v||0); el.dataset.v = to;
  if (Math.abs(to-from) < 0.005){ el.textContent=fmt(to); return; }
  const t0=performance.now();
  (function f(t){ const p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
    el.textContent=fmt(from+(to-from)*e);
    if(p<1) requestAnimationFrame(f); })(t0);
}
function copyText(txt){
  if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(txt).then(()=>toast('Copied to clipboard','success')); }
  else{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied to clipboard','success'); }
}
function shortDevice(){
  const ua=navigator.userAgent;
  return /Mobi|Android|iPhone/i.test(ua) ? 'Mobile device' : 'Desktop browser';
}
function addBusinessDays(days){
  const d=new Date(); let a=0;
  while(a<days){ d.setDate(d.getDate()+1); const w=d.getDay(); if(w!==0&&w!==6) a++; }
  return d;
}

/* ---------- 5 · Password hashing (simulator grade) ---------- */
async function hashPassword(pw,salt){
  const s = salt+'::'+pw;
  if (window.crypto?.subtle){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  let h1=5381,h2=52711;                              // insecure-context fallback
  for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); h1=(h1*33^c)>>>0; h2=(h2*37^c)>>>0; }
  return 'fb'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
const makeSalt = ()=>hex(8);
async function verifyPassword(pw,stored){
  const [salt,old]=String(stored).split('$');
  return (await hashPassword(pw,salt))===old;
}

/* ---------- 6 · Session ---------- */
const getSession = ()=>{ try{ return JSON.parse(localStorage.getItem(LS.session)); }catch{ return null; } };
function saveSession(u){ localStorage.setItem(LS.session, JSON.stringify(
  {user_id:u.id, username:u.username, role:u.role, logged_in:true})); }
const clearSession = ()=>localStorage.removeItem(LS.session);

/* ---------- 7 · Theme ---------- */
function setTheme(t){
  document.documentElement.dataset.theme=t; localStorage.setItem(LS.theme,t);
  const sw=$('#set-theme'); if(sw) sw.checked = (t==='dark');
  if(state.pchart) renderPortfolioChart();               // re-tint chart for theme
}
const applyTheme = ()=>setTheme(localStorage.getItem(LS.theme) ||
  (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));

/* ---------- 8 · Auth: signup / login ---------- */
async function handleSignup(e){
  e.preventDefault();
  const username=$('#su-username').value.trim(), mobile=$('#su-mobile').value.replace(/\s/g,''),
        email=$('#su-email').value.trim().toLowerCase(), pw=$('#su-password').value,
        cf=$('#su-confirm').value;
  if(username.length<3)                       return toast('Username must be at least 3 characters.','error');
  if(!/^\+?\d{10,15}$/.test(mobile))          return toast('Enter a valid mobile number.','error');
  if(email && !/^\S+@\S+\.\S+$/.test(email))  return toast('Enter a valid email address.','error');
  if(pw.length<6)                             return toast('Password must be at least 6 characters.','error');
  if(pw!==cf)                                 return toast('Passwords do not match.','error');
  if(!$('#su-terms').checked)                 return toast('Please accept the Terms to continue.','error');
  const btn=$('#su-btn'); btn.classList.add('loading');
  try{
    const dupe = await db.from('users').select('id,username,email,mobile')
      .or(`username.eq.${username},mobile.eq.${mobile}`+(email?`,email.eq.${email}`:''));
    if(dupe.error) throw dupe.error;
    if(dupe.data?.some(u=>u.username===username)) return fail(btn,'Username is already taken.');
    if(dupe.data?.some(u=>u.mobile===mobile))     return fail(btn,'Mobile number is already registered.');
    if(email && dupe.data?.some(u=>u.email===email)) return fail(btn,'Email is already registered.');

    const password_hash = (await hashPassword(pw,makeSalt()))+'$';
    const {data:u,error}=await db.from('users')
      .insert({username, mobile, email:email||null, password_hash, role:'user'}).select().single();
    if(error) throw error;

    let addr=genAddr();                                        // unique simulated address
    for(let i=0;i<3;i++){
      const ex=await db.from('wallets').select('id').eq('wallet_address',addr).maybeSingle();
      if(!ex.data) break; addr=genAddr();
    }
    const wErr=(await db.from('wallets').insert({user_id:u.id, wallet_address:addr})).error;
    if(wErr) throw wErr;
    await db.from('notifications').insert({user_id:u.id, title:'Welcome to VaultBit',
      message:'Your simulated wallet has been created. This is a demo environment — no real funds are involved.'});

    await db.from('users').update({last_login:new Date().toISOString()}).eq('id',u.id);
    saveSession(u); btn.classList.remove('loading');
    await enterApp(u);
    toast(`Welcome, ${u.username}! Wallet created.`,'success');
  }catch(err){ console.error(err); fail(btn,'Something went wrong. Please try again.'); }
  function fail(b,m){ b.classList.remove('loading'); toast(m,'error'); }
}

async function handleLogin(e){
  e.preventDefault();
  const id=$('#li-identifier').value.trim(), pw=$('#li-password').value;
  if(!id||!pw) return toast('Enter your credentials to sign in.','error');
  const btn=$('#li-btn'); btn.classList.add('loading');
  try{
    const isEmail=/^\S+@\S+\.\S+$/.test(id);
    const q=db.from('users').select('*');
    const {data:u,error}= isEmail ? await q.eq('email',id.toLowerCase()).maybeSingle()
                                  : await q.eq('mobile',id.replace(/\s/g,'')).maybeSingle();
    if(error) throw error;
    if(!u || !(await verifyPassword(pw,u.password_hash)))
      return fail(btn,'Invalid credentials. Please check and try again.');
    if(!u.is_active) return fail(btn,'Your account has been temporarily disabled.');
    await db.from('users').update({last_login:new Date().toISOString()}).eq('id',u.id);
    saveSession(u); btn.classList.remove('loading');
    await enterApp(u);
    await db.from('notifications').insert({user_id:u.id, title:'New login detected',
      message:`VaultBit was signed in from a ${shortDevice()}. If this wasn't you, contact the administrator.`});
  }catch(err){ console.error(err); fail(btn,'Something went wrong. Please try again.'); }
  function fail(b,m){ b.classList.remove('loading'); toast(m,'error'); }
}

function logout(){
  askConfirm('Log out','You will need to sign in again to access your wallet.','Log out',()=>{
    if(state.priceTimer) clearInterval(state.priceTimer);
    db.removeAllChannels(); clearSession(); location.reload();
  }, false);
}

/* ---------- 9 · Data loaders ---------- */
async function loadWallet(){
  const {data,error}=await db.from('wallets').select('*').eq('user_id',state.user.id).maybeSingle();
  if(error||!data) throw new Error('wallet');
  state.wallet=data;
}
async function loadTxs(){
  const uid=state.user.id;
  const {data,error}=await db.from('transactions').select('*')
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`).order('created_at',{ascending:false}).limit(150);
  if(error) return;
  state.txs=data||[];
  const ids=[...new Set(state.txs.flatMap(t=>[t.sender_id,t.receiver_id]).filter(Boolean))];
  if(ids.length){
    const {data:us}=await db.from('users').select('id,username').in('id',ids);
    (us||[]).forEach(u=>state.names[u.id]=u.username);
  }
}
async function loadWithdrawals(){
  const {data}=await db.from('withdrawals').select('*').eq('user_id',state.user.id)
    .order('created_at',{ascending:false});
  state.withdrawals=data||[];
}
async function loadNotifs(){
  const {data}=await db.from('notifications').select('*').eq('user_id',state.user.id)
    .order('created_at',{ascending:false}).limit(60);
  state.notifs=data||[]; updateBadge();
}
async function loadAnnouncements(){
  const {data}=await db.from('announcements').select('*').order('created_at',{ascending:false}).limit(6);
  state.announcements=data||[];
}

/* ---------- 10 · Live prices (CoinGecko → DB fallback) ---------- */
async function fetchPrices(){
  const ids=Object.values(COINS).map(c=>c.cg).join(',');
  try{
    const res=await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`);
    if(!res.ok) throw 0;
    const arr=await res.json();
    arr.forEach(d=>{
      const sym=Object.keys(COINS).find(s=>COINS[s].cg===d.id); if(!sym) return;
      state.prices[sym]={inr:d.current_price||0, chg:d.price_change_percentage_24h||0};
      state.spark[sym]=d.sparkline_in_7d?.price||[];
    });
    upsertPrices();                       // best-effort mirror into market_prices
  }catch{
    const {data}=await db.from('market_prices').select('*');   // offline fallback
    (data||[]).forEach(p=>{ if(COINS[p.symbol]) state.prices[p.symbol]={inr:p.current_price_inr, chg:p.change_percentage}; });
  }
  const live=$('#bc-live');
  if(live) live.innerHTML='<span class="dot"></span>Live · updated '+new Date().toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});
}
async function upsertPrices(){
  try{
    const rows=Object.keys(COINS).filter(s=>state.prices[s]).map(s=>({
      symbol:s, coin_name:COINS[s].name, current_price_inr:state.prices[s].inr,
      change_percentage:state.prices[s].chg, updated_at:new Date().toISOString() }));
    if(rows.length) await db.from('market_prices').upsert(rows,{onConflict:'symbol'});
  }catch{/* non-fatal */}
}

/* ---------- 11 · Portfolio math ---------- */
function portfolioTotals(){
  let total=Number(state.wallet?.inr_balance||0), chg=0;
  for(const s in COINS){
    const bal=Number(state.wallet?.[COINS[s].col]||0), p=state.prices[s];
    if(!p||!bal) continue;
    total+=bal*p.inr; chg+=bal*p.inr*(p.chg||0)/100;
  }
  const pct = total>0 ? (chg/(total-chg))*100 : 0;
  return {total,chg,pct};
}
function portfolioSeries(){
  const n=Math.min(...Object.values(state.spark).map(a=>a.length).filter(l=>l>1).concat([168]));
  const series=new Array(Math.max(n,2)).fill(Number(state.wallet?.inr_balance||0));
  for(const s in COINS){
    const bal=Number(state.wallet?.[COINS[s].col]||0), sp=state.spark[s];
    if(!bal||!sp||sp.length<2) continue;
    const off=sp.length-series.length;
    for(let i=0;i<series.length;i++) series[i]+= (sp[Math.min(i+Math.max(off,0), sp.length-1)]||0)*bal;
  }
  return series;
}

/* ---------- 12 · Rendering: shared row builders ---------- */
function assetRow(sym){
  const c=COINS[sym], bal=Number(state.wallet?.[c.col]||0), p=state.prices[sym]||{inr:0,chg:0};
  const val=bal*p.inr, up=(p.chg||0)>=0;
  return `<button class="arow" data-sym="${sym}">
    <span class="coin-ic" style="background:${c.color}">${c.glyph}</span>
    <span class="ar-main"><b>${c.name}</b><small>${fmtAmt(bal)} ${sym} · ${sym}</small></span>
    <span class="ar-right"><b>${fmtINR(val)}</b><small class="${up?'up':'down'}">${up?'+':''}${(p.chg||0).toFixed(2)}%</small></span>
  </button>`;
}
const TX_META={
  sent:{icon:'arrow-up-right',cls:'out',t:id=>`Sent to ${state.names[id]||'wallet'}`},
  received:{icon:'arrow-down-left',cls:'in',t:id=>`Received from ${state.names[id]||'wallet'}`},
  withdrawal:{icon:'arrow-down-to-line',cls:'out',t:()=>`Withdrawal`},
  admin_credit:{icon:'plus-circle',cls:'in',t:()=>'Credited by platform'},
  admin_debit:{icon:'minus-circle',cls:'out',t:()=>'Debited by platform'},
  deposit:{icon:'plus-circle',cls:'in',t:()=>'Funds added'},
};
function txRow(t){
  const m=TX_META[t.transaction_type]||TX_META.sent;
  const dir=['sent','withdrawal','admin_debit'].includes(t.transaction_type)?'out':'in';
  return `<button class="arow" data-tx="${t.id}">
    <span class="tx-ic ${m.cls}"><i data-lucide="${m.icon}"></i></span>
    <span class="ar-main"><b>${esc(m.t(dir==='out'?t.receiver_id:t.sender_id))}</b>
      <small>${fmtINR(t.amount_inr)} · ${fmtDT(t.created_at)}</small></span>
    <span class="ar-right"><b class="${dir==='in'?'up':'down'}">${dir==='in'?'+':'−'}${fmtAmt(t.amount)} ${t.coin}</b>${badge(t.status)}</span>
  </button>`;
}
function wdRow(w){
  return `<button class="arow" data-wd="${w.id}">
    <span class="tx-ic out"><i data-lucide="arrow-down-to-line"></i></span>
    <span class="ar-main"><b>Withdraw · ${w.coin}</b>
      <small>${w.withdrawal_method} · ${fmtD(w.created_at)}</small></span>
    <span class="ar-right"><b>${fmtINR(w.amount_inr)}</b>${badge(w.status)}</span>
  </button>`;
}

/* ---------- 13 · Rendering: views ---------- */
function renderHome(){
  $('#greet-line').textContent = ['Good morning','Good afternoon','Good evening'][
    new Date().getHours()<12?0:new Date().getHours()<17?1:2];
  $('#greet-name').textContent = state.user.username;
  const init=state.user.username.slice(0,2).toUpperCase();
  $('#home-avatar').textContent=init;
  const {total,chg,pct}=portfolioTotals();
  countUp($('#bc-amount'),total);
  const up=chg>=0;
  $('#bc-change').innerHTML = total>0
    ? `<span class="${up?'up':'down'}">${up?'▲':'▼'} ${fmtINR(Math.abs(chg))} (${up?'+':''}${pct.toFixed(2)}%)</span> · 24h`
    : '<span style="color:rgba(255,255,255,.5)">Add assets to see 24h movement</span>';
  const holdings=Object.keys(COINS).map(s=>({s,v:Number(state.wallet?.[COINS[s].col]||0)*(state.prices[s]?.inr||0)}))
    .filter(x=>x.v>0.000001).sort((a,b)=>b.v-a.v).slice(0,4);
  $('#home-assets').innerHTML = holdings.length
    ? holdings.map(x=>assetRow(x.s)).join('')
    : `<div class="card empty"><i data-lucide="wallet"></i><br>Your wallet is empty.<br>Ask the admin to credit simulated funds, or share your address to receive.</div>`;
  $('#home-activity').innerHTML = state.txs.length
    ? state.txs.slice(0,3).map(txRow).join('')
    : `<div class="card empty"><i data-lucide="history"></i><br>No transactions yet.</div>`;
  renderAnnouncements(); renderPortfolioChart(); icons();
}
function renderPortfolioChart(){
  const cv=$('#portfolio-chart'); if(!cv||!window.Chart) return;
  const series=portfolioSeries();
  if(state.pchart) state.pchart.destroy();
  const ctx=cv.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,110);
  g.addColorStop(0,'rgba(61,220,151,.30)'); g.addColorStop(1,'rgba(61,220,151,0)');
  state.pchart=new Chart(cv,{type:'line',
    data:{labels:series.map((_,i)=>i),datasets:[{data:series,borderColor:'#3DDC97',borderWidth:2,
      pointRadius:0,tension:.35,fill:true,backgroundColor:g}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{intersect:false,
        callbacks:{label:c=>fmtINR(c.parsed.y)}}},
      scales:{x:{display:false},y:{display:false}},animation:{duration:600}}});
}
function renderWalletView(){
  const {total,chg,pct}=portfolioTotals();
  countUp($('#wal-total'),total);
  const up=chg>=0;
  $('#wal-change').innerHTML = total>0
    ? `<span class="badge ${up?'Completed':'Failed'}">${up?'+':''}${fmtINR(chg)} · ${pct.toFixed(2)}% (24h)</span>` : '';
  const inrBal=Number(state.wallet?.inr_balance||0);
  let html=`<button class="arow" data-inr="1">
    <span class="coin-ic" style="background:${ASSET_INR.color}">${ASSET_INR.glyph}</span>
    <span class="ar-main"><b>Indian Rupee</b><small>INR · tap to add funds</small></span>
    <span class="ar-right"><b>${fmtINR(inrBal)}</b></span></button>`;
  html+=Object.keys(COINS).map(assetRow).join('');
  $('#wal-list').innerHTML=html; icons();
}
function drawSpark(cv,data,up){
  if(!cv) return;
  const w=cv.width,h=cv.height,ctx=cv.getContext('2d'); ctx.clearRect(0,0,w,h);
  const arr=(data&&data.length>1)?data:[0,0];
  const min=Math.min(...arr),max=Math.max(...arr),rng=(max-min)||1;
  ctx.beginPath();
  arr.forEach((v,i)=>{const x=i/(arr.length-1)*w,y=h-2.5-((v-min)/rng)*(h-5); i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  ctx.strokeStyle=up?'#12B981':'#E5484D'; ctx.lineWidth=1.6; ctx.lineJoin='round'; ctx.stroke();
}
function renderMarkets(){
  const list=$('#market-list');
  if(!Object.keys(state.prices).length){
    list.innerHTML=Array(5).fill('<div class="skel skel-row"></div>').join(''); return;
  }
  let syms=Object.keys(COINS);
  const q=state.mktQuery.toLowerCase();
  if(q) syms=syms.filter(s=>COINS[s].name.toLowerCase().includes(q)||s.toLowerCase().includes(q));
  const f=state.mktFilter;
  if(f==='gainers')  syms=syms.filter(s=>(state.prices[s]?.chg||0)>0).sort((a,b)=>state.prices[b].chg-state.prices[a].chg);
  if(f==='losers')   syms=syms.filter(s=>(state.prices[s]?.chg||0)<0).sort((a,b)=>state.prices[a].chg-state.prices[b].chg);
  if(f==='trending') syms=syms.sort((a,b)=>Math.abs(state.prices[b]?.chg||0)-Math.abs(state.prices[a]?.chg||0)).slice(0,4);
  if(f==='watch')    syms=syms.filter(s=>state.watch.includes(s));
  list.innerHTML = syms.length ? syms.map(sym=>{
    const c=COINS[sym],p=state.prices[sym]||{inr:0,chg:0},up=(p.chg||0)>=0;
    const star=state.watch.includes(sym);
    return `<div class="arow" data-sym="${sym}" role="button" tabindex="0">
      <span class="coin-ic" style="background:${c.color}">${c.glyph}</span>
      <span class="ar-main"><b>${c.name}</b><small>${sym}</small></span>
      <span class="ar-act" data-watch="${sym}" title="Watchlist">
        <i data-lucide="${star?'star':'star'}" style="width:16px;height:16px;${star?'color:#F0B90B;fill:#F0B90B':''}"></i></span>
      <canvas class="spark" data-sym="${sym}" width="64" height="28" style="width:64px;height:28px;flex:none"></canvas>
      <span class="ar-right"><b>${fmtINR(p.inr,p.inr<1?4:2)}</b><small class="${up?'up':'down'}">${up?'+':''}${(p.chg||0).toFixed(2)}%</small></span>
    </div>`;
  }).join('') : `<div class="card empty"><i data-lucide="search"></i><br>No coins match your search.</div>`;
  const ups=syms.filter(s=>(state.prices[s]?.chg||0)>0).length;
  $('#mkt-mover').textContent=`${ups} gaining · ${syms.length-ups} declining · prices in INR`;
  icons();
  $$('.spark',list).forEach(cv=>drawSpark(cv,state.spark[cv.dataset.sym],(state.prices[cv.dataset.sym]?.chg||0)>=0));
}
function renderActivity(){
  const f=state.actFilter;
  let list=state.txs.filter(t=>{
    if(f==='all')return true;
    if(f==='withdrawal')return t.transaction_type==='withdrawal';
    if(f==='credits')return['admin_credit','admin_debit','deposit'].includes(t.transaction_type);
    return t.transaction_type===f;
  });
  const el=$('#act-list');
  if(!list.length){ el.innerHTML=`<div class="card empty"><i data-lucide="history"></i><br>No activity in this filter yet.</div>`; icons(); return; }
  let html='',lastDay='';
  list.forEach(t=>{
    const d=fmtD(t.created_at);
    if(d!==lastDay){
      const today=fmtD(new Date()), yd=fmtD(new Date(Date.now()-864e5));
      html+=`<div class="date-sep">${d===today?'Today':d===yd?'Yesterday':d}</div>`; lastDay=d;
    }
    html+=txRow(t);
  });
  el.innerHTML=html; icons();
}
function renderProfile(){
  const u=state.user,init=u.username.slice(0,2).toUpperCase();
  $('#pf-avatar').textContent=init; $('#pf-username').textContent=u.username;
  $('#pf-email').textContent=u.email||'No email added';
  $('#pf-role').textContent=u.role.toUpperCase();
  $('#pf-mobile').textContent=u.mobile;
  $('#pf-address').textContent=state.wallet?.wallet_address||'—';
  $('#pf-created').textContent=u.created_at?fmtD(u.created_at):'—';
  $('#set-theme').checked=document.documentElement.dataset.theme==='dark';
  $('#set-notif').checked=localStorage.getItem(LS.notifpref+u.id)!=='0';
}
function renderAnnouncements(){
  const dismissed=JSON.parse(localStorage.getItem(LS.dismiss+state.user.id)||'[]');
  const list=state.announcements.filter(a=>!dismissed.includes(a.id)).slice(0,3);
  const w=$('#announce-wrap');
  w.hidden=!list.length;
  w.innerHTML=list.map(a=>`<div class="announce t-${esc(a.type)}">
    <div class="an-head"><i data-lucide="${ANN_ICON[a.type]||'megaphone'}"></i><b>${esc(a.title)}</b>
      <button class="an-x" data-an="${a.id}"><i data-lucide="x"></i></button></div>
    <p>${esc(a.message)}</p></div>`).join('');
  icons();
}
function updateBadge(){
  const n=state.notifs.filter(n=>!n.read_status).length;
  const b=$('#notif-badge'); b.hidden=!n; b.textContent=n>9?'9+':n;
}
function renderNotifs(){
  $('#notif-list').innerHTML = state.notifs.length ? state.notifs.map(n=>{
    const t=n.title.toLowerCase();
    const ic = t.includes('received')?'arrow-down-left':t.includes('sent')?'arrow-up-right':
      t.includes('withdrawal')?'arrow-down-to-line':t.includes('login')||t.includes('security')?'shield-alert':
      t.includes('deliver')?'check-circle-2':'bell';
    return `<div class="notif ${n.read_status?'':'unread'}">
      <span class="tx-ic"><i data-lucide="${ic}"></i></span>
      <div style="flex:1"><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${fmtDT(n.created_at)}</small></div>
    </div>`;
  }).join('') : `<div class="card empty"><i data-lucide="bell"></i><br>You're all caught up.</div>`;
  icons();
}
function renderWithdrawalHistory(){
  $('#wr-history').innerHTML = state.withdrawals.length ? state.withdrawals.map(wdRow).join('')
    : `<div class="card empty"><i data-lucide="landmark"></i><br>No withdrawals yet.</div>`;
  icons();
}
function renderAll(){
  renderHome(); renderWalletView(); renderMarkets(); renderActivity(); renderProfile();
}

/* ---------- 14 · Navigation ---------- */
function showView(v){
  state.view=v;
  $$('.view').forEach(s=>s.classList.toggle('is-active', s.id==='view-'+v));
  $$('#bottomnav .bn-item').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  $('#views').scrollTo({top:0});
  if(v==='activity') renderActivity();
  if(v==='markets')  renderMarkets();
  if(v==='wallet')   renderWalletView();
  if(v==='profile')  renderProfile();
}

/* ---------- 15 · Send ---------- */
function fillCoinSelect(sel,filterBal=false){
  sel.innerHTML=Object.keys(COINS).map(s=>{
    const bal=Number(state.wallet?.[COINS[s].col]||0);
    return `<option value="${s}">${COINS[s].name} · ${s}${filterBal&&bal<=0?' — no balance':''}</option>`;
  }).join('');
}
function openSend(sym){
  fillCoinSelect($('#sd-coin'));
  if(sym) $('#sd-coin').value=sym;
  $('#sd-address').value=''; $('#sd-amount').value=''; $('#sd-note').value='';
  $('#sd-addr-err').hidden=true; sendCalc(); openModal('modal-send');
}
function sendCalc(){
  const sym=$('#sd-coin').value, amt=parseFloat($('#sd-amount').value)||0;
  const bal=Number(state.wallet?.[COINS[sym].col]||0), p=state.prices[sym]||{inr:0};
  $('#sd-avail').textContent=`${fmtAmt(bal)} ${sym}`;
  $('#sd-inr').textContent=fmtINR(amt*p.inr);
  $('#sd-fee').textContent=`${COINS[sym].fee} ${sym} (covered)`;
  $('#sd-total').textContent=`${fmtAmt(amt)} ${sym}`;
}
async function submitSend(e){
  e.preventDefault();
  const sym=$('#sd-coin').value, addr=$('#sd-address').value.trim(),
        amt=parseFloat($('#sd-amount').value), note=$('#sd-note').value.trim();
  if(!/^0x[a-fA-F0-9]{40}$/.test(addr)) return toast('Invalid wallet address format.','error');
  if(!(amt>0))                          return toast('Enter a valid amount.','error');
  const col=COINS[sym].col, bal=Number(state.wallet?.[col]||0);
  if(amt>bal)                           return toast('Insufficient balance.','error');
  const btn=$('#sd-submit'); btn.classList.add('loading');
  try{
    const {data:rw}=await db.from('wallets').select('user_id, users(username)').eq('wallet_address',addr).maybeSingle();
    if(!rw){ $('#sd-addr-err').hidden=false; btn.classList.remove('loading');
             return toast('Wallet address not found.','error'); }
    if(rw.user_id===state.user.id){ btn.classList.remove('loading');
             return toast('You cannot send to your own address.','error'); }
    const {data:rwFull}=await db.from('wallets').select('*').eq('user_id',rw.user_id).maybeSingle();
    if(!rwFull) throw new Error('receiver wallet missing');
    const price=state.prices[sym]?.inr||0, inr=amt*price, hash=txHash();
    const u1=await db.from('wallets').update({[col]:round8(bal-amt)}).eq('user_id',state.user.id);
    const u2=await db.from('wallets').update({[col]:round8(Number(rwFull[col]||0)+amt)}).eq('user_id',rw.user_id);
    if(u1.error||u2.error) throw u1.error||u2.error;
    await db.from('transactions').insert([
      {sender_id:state.user.id, receiver_id:rw.user_id, coin:sym, amount:amt, amount_inr:inr,
       tx_hash:hash, status:'Processing', confirmations:0, transaction_type:'sent', note:note||null},
      {sender_id:state.user.id, receiver_id:rw.user_id, coin:sym, amount:amt, amount_inr:inr,
       tx_hash:hash, status:'Processing', confirmations:0, transaction_type:'received'}
    ]);
    await db.from('notifications').insert([
      {user_id:state.user.id, title:'Crypto sent',
       message:`You sent ${fmtAmt(amt)} ${sym} (≈ ${fmtINR(inr)}) to @${rw.users?.username||'a VaultBit wallet'}.`},
      {user_id:rw.user_id, title:'Crypto received',
       message:`You received ${fmtAmt(amt)} ${sym} (≈ ${fmtINR(inr)}) from @${state.user.username}.`}
    ]);
    state.names[rw.user_id]=rw.users?.username||state.names[rw.user_id];
    state.wallet[col]=round8(bal-amt);
    renderAll();
    simulateConfirmations(hash);
    btn.classList.remove('loading'); closeModal('modal-send');
    showSuccess('Transaction sent',`You sent ${fmtAmt(amt)} ${sym} to @${rw.users?.username||'wallet'}. It will confirm in a few seconds (simulated).`);
  }catch(err){ console.error(err); btn.classList.remove('loading'); toast('Transaction failed. Please try again.','error'); }
}
function simulateConfirmations(hash){
  let c=0;
  const step=()=>{
    c++;
    db.from('transactions').update({confirmations:c}).eq('tx_hash',hash).then(()=>{
      state.txs.forEach(t=>{ if(t.tx_hash===hash) t.confirmations=c; });
      if(c>=3){
        db.from('transactions').update({status:'Completed'}).eq('tx_hash',hash).then(()=>{
          state.txs.forEach(t=>{ if(t.tx_hash===hash) t.status='Completed'; });
          if(state.view==='activity') renderActivity();
          if(state.view==='home') renderHome();
        });
      } else setTimeout(step,2500);
    });
  };
  setTimeout(step,2500);
}

/* ---------- 16 · Receive ---------- */
function openReceive(sym){
  fillCoinSelect($('#rc-coin'));
  if(sym) $('#rc-coin').value=sym;
  renderReceive(); openModal('modal-receive');
}
function renderReceive(){
  const sym=$('#rc-coin').value, addr=state.wallet?.wallet_address||'';
  $('#rc-address').textContent=addr; $('#rc-qr-coin').textContent=sym;
  const box=$('#rc-qr'); box.innerHTML='';
  if(window.QRCode) new QRCode(box,{text:addr,width:164,height:164,colorDark:'#101828',
    colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
}

/* ---------- 17 · Add funds (simulated INR deposit) ---------- */
async function submitFunds(){
  const amt=parseFloat($('#fd-amount').value);
  if(!(amt>0)) return toast('Enter a valid amount.','error');
  const btn=$('#fd-submit'); btn.classList.add('loading');
  try{
    const {data:w}=await db.from('wallets').select('inr_balance').eq('user_id',state.user.id).single();
    const nb=round8(Number(w.inr_balance)+amt);
    const err=(await db.from('wallets').update({inr_balance:nb}).eq('user_id',state.user.id)).error;
    if(err) throw err;
    await db.from('transactions').insert({receiver_id:state.user.id, coin:'INR', amount:amt,
      amount_inr:amt, tx_hash:txHash(), status:'Completed', confirmations:3, transaction_type:'deposit'});
    await db.from('notifications').insert({user_id:state.user.id, title:'Deposit successful',
      message:`${fmtINR(amt)} has been added to your INR balance (simulated deposit).`});
    state.wallet.inr_balance=nb; renderAll();
    btn.classList.remove('loading'); closeModal('modal-funds');
    showSuccess('Funds added',`${fmtINR(amt)} has been added to your wallet (simulated — no real money moved).`);
  }catch(err){ console.error(err); btn.classList.remove('loading'); toast('Deposit failed. Please try again.','error'); }
}

/* ---------- 18 · Withdrawal ---------- */
function openWithdraw(){
  fillCoinSelect($('#wr-coin'),true);
  $('#wr-amount').value=''; $('#wr-upi').value=''; 
  ['wr-bank','wr-acname','wr-acno','wr-ifsc'].forEach(id=>$('#'+id).value='');
  setWrMethod('UPI'); wrCalc();
  $('#wr-form').hidden=false; $('#wr-success').hidden=true;
  setWrTab('new'); renderWithdrawalHistory();
  $('#wr-overlay').hidden=false; requestAnimationFrame(()=>$('#wr-overlay').classList.add('open'));
}
function closeWithdraw(){ $('#wr-overlay').classList.remove('open'); setTimeout(()=>$('#wr-overlay').hidden=true,320); }
function setWrTab(t){
  $$('#wr-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
  $('#wr-form').hidden = t!=='new' || !$('#wr-success').hidden===false;
  $('#wr-form').hidden = !(t==='new' && $('#wr-success').hidden);
  $('#wr-success').hidden = t!=='new' || !$('#wr-success').hidden ? true : $('#wr-success').hidden;
  $('#wr-form').hidden = (t!=='new');
  $('#wr-history').hidden = (t!=='history');
  $('#wr-success').hidden = $('#wr-success').hidden || t!=='new';
}
function setWrMethod(m){
  state.wrMethod=m;
  $$('#wr-form .method').forEach(b=>b.classList.toggle('active',b.dataset.m===m));
  $('#wr-upi-fields').hidden = m!=='UPI';
  $('#wr-bank-fields').hidden = m!=='BANK';
}
function wrCalc(){
  const sym=$('#wr-coin').value, amt=parseFloat($('#wr-amount').value)||0;
  const bal=Number(state.wallet?.[COINS[sym].col]||0), p=state.prices[sym]||{inr:0};
  $('#wr-avail').textContent=`${fmtAmt(bal)} ${sym}`;
  $('#wr-price').textContent=fmtINR(p.inr,p.inr<1?4:2)+` / ${sym}`;
  $('#wr-est').textContent=fmtINR(amt*p.inr);
}
async function submitWithdrawal(e){
  e.preventDefault();
  const sym=$('#wr-coin').value, amt=parseFloat($('#wr-amount').value);
  const bal=Number(state.wallet?.[COINS[sym].col]||0);
  if(!(amt>0))                    return toast('Enter a valid amount.','error');
  if(amt>bal)                     return toast('Insufficient wallet balance.','error');
  const m=state.wrMethod; let dest={};
  if(m==='UPI'){
    const upi=$('#wr-upi').value.trim();
    if(!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return toast('Enter a valid UPI ID (e.g. name@upi).','error');
    dest={upi_id:upi};
  }else{
    const bank=$('#wr-bank').value.trim(), name=$('#wr-acname').value.trim(),
          no=$('#wr-acno').value.trim(), ifsc=$('#wr-ifsc').value.trim().toUpperCase();
    if(!bank||!name)                    return toast('Enter bank name and account holder name.','error');
    if(!/^\d{9,18}$/.test(no))          return toast('Account number must be 9–18 digits.','error');
    if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return toast('Enter a valid IFSC code.','error');
    dest={bank_name:bank, account_holder_name:name, account_number:no, ifsc_code:ifsc};
  }
  const price=state.prices[sym]?.inr||0, inr=amt*price, hash=txHash();
  const arrival=addBusinessDays(3);
  const btn=$('#wr-submit'); btn.classList.add('loading');
  try{
    const err=(await db.from('wallets').update({[COINS[sym].col]:round8(bal-amt)}).eq('user_id',state.user.id)).error;
    if(err) throw err;
    const wdErr=(await db.from('withdrawals').insert({user_id:state.user.id, coin:sym, crypto_amount:amt,
      amount_inr:inr, withdrawal_method:m, ...dest, status:'Processing', processing_days_remaining:3,
      estimated_arrival:arrival.toISOString(), tx_hash:hash}).select().single());
    if(wdErr.error) throw wdErr.error;
    const txErr=(await db.from('transactions').insert({sender_id:state.user.id, coin:sym, amount:amt,
      amount_inr:inr, tx_hash:hash, status:'Processing', confirmations:0, transaction_type:'withdrawal'})).error;
    if(txErr) throw txErr;
    await db.from('notifications').insert({user_id:state.user.id, title:'Withdrawal submitted',
      message:`Your withdrawal of ${fmtAmt(amt)} ${sym} (≈ ${fmtINR(inr)}) via ${m==='UPI'?'UPI':'bank transfer'} has been submitted. Estimated arrival: ${fmtD(arrival)} (3 business days).`});
    state.wallet[COINS[sym].col]=round8(bal-amt);
    renderAll(); renderWithdrawalHistory();
    // success screen
    $('#wr-s-amount').textContent=`${fmtAmt(amt)} ${sym} · ${fmtINR(inr)}`;
    $('#wr-s-method').textContent=m==='UPI'?`UPI · ${dest.upi_id}`:`Bank · ${dest.bank_name}`;
    $('#wr-s-arrival').textContent=fmtD(arrival);
    const steps=['Request Submitted','Processing','Verification','Transfer Processing','Completed'];
    $('#wr-timeline').innerHTML=steps.map((s,i)=>`
      <div class="tl-step ${i===0?'done':''} ${i===1?'now':''}">
        <span class="tl-dot">${i===0?'<i data-lucide="check"></i>':i+1}</span>
        <span><b>${s}</b><small>${i===0?'Just now':i===1?'In progress':'Pending'}</small></span>
      </div>`).join('');
    $('#wr-form').hidden=true; $('#wr-success').hidden=false;
    icons();
  }catch(err){ console.error(err); toast('Withdrawal request failed. Please try again.','error'); }
  btn.classList.remove('loading');
}
async function autoCompleteWithdrawals(){
  const now=Date.now(); let changed=false;
  for(const w of state.withdrawals){
    if(w.status==='Processing' && new Date(w.estimated_arrival).getTime()<=now){
      await db.from('withdrawals').update({status:'Completed', completed_at:new Date().toISOString(),
        processing_days_remaining:0}).eq('id',w.id);
      if(w.tx_hash) await db.from('transactions').update({status:'Completed', confirmations:3}).eq('tx_hash',w.tx_hash);
      await db.from('notifications').insert({user_id:w.user_id, title:'Funds Successfully Delivered',
        message:`Your withdrawal of ${fmtAmt(w.crypto_amount)} ${w.coin} (≈ ${fmtINR(w.amount_inr)}) has been completed.`});
      changed=true; toast('Withdrawal completed — funds delivered.','success');
    }
  }
  if(changed){ await loadWithdrawals(); renderWithdrawalHistory(); }
}

/* ---------- 19 · Detail modals ---------- */
function kvRow(k,v,copyId){ return `<div class="info-row"><span>${k}</span><b ${copyId?`id="${copyId}"`:''}>${v}</b>${copyId?'<button class="iconbtn sm" data-copy-target="'+copyId+'"><i data-lucide="copy"></i></button>':''}</div>`; }
function openTxDetail(id){
  const t=state.txs.find(x=>x.id===id); if(!t) return;
  const m=TX_META[t.transaction_type]||TX_META.sent;
  const from=t.sender_id?(state.names[t.sender_id]||'—'):'Platform / System';
  const to=t.receiver_id?(state.names[t.receiver_id]||'—'):(t.transaction_type==='withdrawal'?'External payout':'—');
  $('#tx-body').innerHTML=`
    <div class="sheet-head"><h3 style="display:flex;align-items:center;gap:10px">
      <span class="tx-ic ${m.cls}"><i data-lucide="${m.icon}"></i></span>${esc(m.t(t.receiver_id||t.sender_id))}</h3>
      <button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    ${badge(t.status)}
    <div class="kv-card" style="margin-top:14px">
      <div class="kv"><span>Amount</span><b>${fmtAmt(t.amount)} ${t.coin}</b></div>
      <div class="kv"><span>INR value</span><b>${fmtINR(t.amount_inr)}</b></div>
      <div class="kv"><span>From</span><b>${esc(from)}</b></div>
      <div class="kv"><span>To</span><b>${esc(to)}</b></div>
      <div class="kv"><span>Confirmations</span><b>${t.confirmations} / 3</b></div>
      <div class="kv"><span>Date</span><b>${fmtDT(t.created_at)}</b></div>
    </div>
    <div class="field"><label>Transaction hash (simulated)</label>
      <div class="addr-box"><code class="mono">${esc(t.tx_hash)}</code>
      <button class="iconbtn" data-copy-text="${esc(t.tx_hash)}"><i data-lucide="copy"></i></button></div></div>
    ${t.note?`<p class="muted" style="font-size:13px">Note: ${esc(t.note)}</p>`:''}
    <p class="sim-note small"><i data-lucide="shield-alert"></i> Simulated transaction — no real blockchain was involved.</p>`;
  icons(); openModal('modal-tx');
}
function openWdDetail(id){
  const w=state.withdrawals.find(x=>x.id===id); if(!w) return;
  const steps=['Request Submitted','Processing','Verification','Transfer Processing','Completed'];
  const idx={'Processing':1,'Completed':4,'Failed':4,'Rejected':4}[w.status]??1;
  $('#tx-body').innerHTML=`
    <div class="sheet-head"><h3>Withdrawal details</h3><button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    ${badge(w.status)}
    <div class="kv-card" style="margin-top:14px">
      <div class="kv"><span>Crypto</span><b>${fmtAmt(w.crypto_amount)} ${w.coin}</b></div>
      <div class="kv"><span>INR value</span><b>${fmtINR(w.amount_inr)}</b></div>
      <div class="kv"><span>Method</span><b>${w.withdrawal_method}</b></div>
      ${w.withdrawal_method==='UPI'
        ?`<div class="kv"><span>UPI ID</span><b>${esc(w.upi_id||'—')}</b></div>`
        :`<div class="kv"><span>Bank</span><b>${esc(w.bank_name||'—')}</b></div>
          <div class="kv"><span>Account</span><b>${esc(w.account_holder_name||'')} · ${esc(w.account_number||'')}</b></div>
          <div class="kv"><span>IFSC</span><b>${esc(w.ifsc_code||'—')}</b></div>`}
      <div class="kv"><span>Requested</span><b>${fmtDT(w.created_at)}</b></div>
      <div class="kv"><span>Estimated arrival</span><b>${w.estimated_arrival?fmtD(w.estimated_arrival):'—'} (3 business days)</b></div>
      ${w.completed_at?`<div class="kv"><span>Completed</span><b>${fmtDT(w.completed_at)}</b></div>`:''}
    </div>
    <div class="tl">${steps.map((s,i)=>{
      const done=i===0||w.status==='Completed'&&i===4||(['Failed','Rejected'].includes(w.status)&&i===4);
      return `<div class="tl-step ${i===0||i<=idx&&w.status!=='Processing'?'done':''} ${w.status==='Processing'&&i===1?'now':''} ${done?'done':''}">
        <span class="tl-dot">${done?'<i data-lucide="check"></i>':i+1}</span><span><b>${s}</b></span></div>`;
    }).join('')}</div>
    <p class="sim-note small"><i data-lucide="shield-alert"></i> Simulated payout — no real UPI or bank transfer occurs.</p>`;
  icons(); openModal('modal-tx');
}
function openCoinSheet(sym){
  const c=COINS[sym],p=state.prices[sym]||{inr:0,chg:0},up=(p.chg||0)>=0;
  const bal=Number(state.wallet?.[c.col]||0), sp=state.spark[sym]||[];
  const hi=sp.length?Math.max(...sp):0, lo=sp.length?Math.min(...sp):0;
  $('#coin-body').innerHTML=`
    <div class="sheet-head"><button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    <div class="cs-head"><span class="coin-ic lg" style="background:${c.color}">${c.glyph}</span>
      <span class="ar-main"><b style="font-size:17px">${c.name}</b><small>${sym} · 7d chart (INR)</small></span>
      <span class="cs-price"><b>${fmtINR(p.inr,p.inr<1?4:2)}</b>
        <small class="${up?'up':'down'}" style="font-weight:800">${up?'+':''}${(p.chg||0).toFixed(2)}% 24h</small></span></div>
    <div class="chart-box-lg"><canvas id="coin-chart"></canvas></div>
    <div class="cs-stats">
      <div class="cs-stat"><span>7d high</span><b>${fmtINR(hi)}</b></div>
      <div class="cs-stat"><span>7d low</span><b>${fmtINR(lo)}</b></div>
      <div class="cs-stat"><span>Your balance</span><b>${fmtAmt(bal)} ${sym}</b></div>
      <div class="cs-stat"><span>Value</span><b>${fmtINR(bal*p.inr)}</b></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="cs-send"><i data-lucide="arrow-up-right"></i>Send</button>
      <button class="btn btn-ghost" id="cs-recv"><i data-lucide="arrow-down-left"></i>Receive</button>
    </div>
    <p class="sim-note small"><i data-lucide="shield-alert"></i> Live market data via CoinGecko. Prices never modify your balances.</p>`;
  icons();
  const cv=$('#coin-chart');
  if(state.cchart) state.cchart.destroy();
  if(sp.length>1&&window.Chart){
    const g=cv.getContext('2d').createLinearGradient(0,0,0,140);
    g.addColorStop(0,'rgba(12,166,120,.22)'); g.addColorStop(1,'rgba(12,166,120,0)');
    state.cchart=new Chart(cv,{type:'line',data:{labels:sp.map((_,i)=>i),
      datasets:[{data:sp,borderColor:up?'#12B981':'#E5484D',borderWidth:2,pointRadius:0,tension:.3,fill:true,backgroundColor:g}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},
        tooltip:{callbacks:{label:c=>fmtINR(c.parsed.y)}}},scales:{x:{display:false},y:{display:false}}}});
  }
  $('#cs-send').onclick=()=>{ closeModal('modal-coin'); openSend(sym); };
  $('#cs-recv').onclick=()=>{ closeModal('modal-coin'); openReceive(sym); };
  openModal('modal-coin');
}

/* ---------- 20 · Security sheet (interface simulation) ---------- */
function openSecurity(){
  const uid=state.user.id;
  const twofa=localStorage.getItem(LS.twofa+uid)==='1';
  const hasEmail=!!state.user.email;
  const score=40+(twofa?30:0)+(hasEmail?15:0)+15;
  const logs=JSON.parse(localStorage.getItem(LS.logins+uid)||'[]').slice(-5).reverse();
  $('#sec-body').innerHTML=`
    <div class="sheet-head"><h3>Security</h3><button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    <div class="ring" style="background:conic-gradient(var(--brand) ${score*3.6}deg, var(--line) 0)">
      <div class="ring-in"><b>${score}</b><span>/ 100</span></div></div>
    <p class="muted" style="text-align:center;font-size:12.5px;margin-bottom:14px">Simulated security score</p>
    <div class="card set-list" style="margin-bottom:12px">
      <div class="set-row"><span><i data-lucide="key-round"></i>Two-factor authentication</span>
        <label class="switch"><input type="checkbox" id="sec-2fa" ${twofa?'checked':''}><i></i></label></div>
      <div class="set-row"><span><i data-lucide="mail"></i>Email added</span>
        <b class="${hasEmail?'up':'down'}" style="font-size:12px;font-weight:800">${hasEmail?'YES':'NO'}</b></div>
      <div class="set-row"><span><i data-lucide="monitor"></i>Device verified</span><b class="up" style="font-size:12px;font-weight:800">YES</b></div>
    </div>
    <h4 class="group-label">Login activity</h4>
    <div class="card" style="margin-bottom:12px">
      ${logs.length?logs.map(l=>`<div class="info-row"><span><i data-lucide="log-in"></i>${esc(l.d)}</span><b>${fmtDT(l.t)}</b></div>`).join(''):'<p class="muted" style="font-size:13px">No recorded logins yet.</p>'}
    </div>
    <h4 class="group-label">Session</h4>
    <div class="card">
      <div class="info-row"><span><i data-lucide="clock"></i>Signed in</span><b>${fmtDT(new Date())}</b></div>
      <div class="info-row"><span><i data-lucide="shield-alert"></i>Storage</span><b>This device (localStorage)</b></div>
    </div>
    <p class="sim-note small"><i data-lucide="shield-alert"></i> These security controls are interface simulations only and do not provide real protection.</p>`;
  icons(); openModal('modal-security');
  $('#sec-2fa').addEventListener('change',e=>{
    localStorage.setItem(LS.twofa+uid, e.target.checked?'1':'0');
    toast(e.target.checked?'2FA simulation enabled.':'2FA simulation disabled.','success');
  });
}

/* ---------- 21 · Realtime ---------- */
function subscribeRealtime(){
  const uid=state.user.id;
  db.channel('user-'+uid)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+uid},
      p=>{ state.notifs.unshift(p.new); updateBadge(); if(!$('#modal-notif').hidden) renderNotifs();
           if(localStorage.getItem(LS.notifpref+uid)!=='0') toast(p.new.title,'info'); })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'wallets',filter:'user_id=eq.'+uid},
      p=>{ state.wallet=p.new; renderAll(); })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'transactions',filter:'receiver_id=eq.'+uid},
      ()=>{ loadTxs().then(()=>{ if(state.view==='activity')renderActivity(); if(state.view==='home')renderHome(); }); })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'transactions',filter:'receiver_id=eq.'+uid},
      ()=>loadTxs())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'withdrawals',filter:'user_id=eq.'+uid},
      p=>{ const old=state.withdrawals.find(w=>w.id===p.new.id);
           if(old&&old.status!==p.new.status&&p.new.status!=='Completed')
             toast(`Withdrawal ${p.new.status.toLowerCase()}.`,'info');
           loadWithdrawals().then(()=>{ renderWithdrawalHistory(); autoCompleteWithdrawals(); }); })
    .subscribe();
}

/* ---------- 22 · Boot ---------- */
async function enterApp(u){
  state.user=u;
  $('#auth').hidden=true; $('#app').hidden=false;
  try{
    const {data:w}=await db.from('wallets').select('wallet_address').eq('user_id',u.id).maybeSingle();
    state.watch=JSON.parse(localStorage.getItem(LS.watch+u.id)||'[]');
    await Promise.all([loadWallet(), fetchPrices()]);
    await Promise.all([loadTxs(), loadWithdrawals(), loadNotifs(), loadAnnouncements()]);
  }catch(err){ console.error(err); toast('Unable to load wallet. Retrying prices only.','error'); }
  renderAll(); updateBadge(); icons();
  subscribeRealtime(); autoCompleteWithdrawals();
  if(state.priceTimer) clearInterval(state.priceTimer);
  state.priceTimer=setInterval(async()=>{ await fetchPrices(); renderAll(); }, 60000);
}

async function boot(){
  applyTheme();
  // global delegated handlers
  document.addEventListener('click',e=>{
    const cp=e.target.closest('[data-copy-target]');
    if(cp){ const el=document.getElementById(cp.dataset.copyTarget); if(el) copyText(el.textContent.trim()); return; }
    const cpt=e.target.closest('[data-copy-text]');
    if(cpt){ copyText(cpt.dataset.copyText); return; }
    const cl=e.target.closest('[data-close]');
    if(cl){ closeModal(cl.closest('.modal').id); return; }
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='rc-coin') renderReceive();
    if(e.target.id==='sd-coin'||e.target.id==='wr-coin'){ sendCalc(); wrCalc(); }
  });
  // auth
  $('#login-form').addEventListener('submit',handleLogin);
  $('#signup-form').addEventListener('submit',handleSignup);
  $('#go-signup').onclick=()=>$('#auth-cards').classList.add('mode-signup');
  $('#go-login').onclick =()=>$('#auth-cards').classList.remove('mode-login');
  $('#li-forgot').onclick=()=>openModal('modal-forgot');
  $$('[data-eye]').forEach(b=>b.addEventListener('click',()=>{
    const i=$('#'+b.dataset.eye);
    i.type=i.type==='password'?'text':'password';
    b.innerHTML=`<i data-lucide="${i.type==='password'?'eye':'eye-off'}"></i>`; icons();
  }));
  // bottom nav
  $$('#bottomnav .bn-item').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  // quick actions
  $('#qa-send').onclick=()=>openSend();
  $('#qa-receive').onclick=()=>openReceive();
  $('#qa-withdraw').onclick=openWithdraw;
  $('#qa-funds').onclick=()=>{ $('#fd-amount').value=''; openModal('modal-funds'); };
  $('#home-avatar').onclick=()=>showView('profile');
  $('#bell-btn').onclick=()=>{ renderNotifs(); openModal('modal-notif'); };
  $('#assets-all').onclick=()=>showView('wallet');
  $('#activity-all').onclick=()=>showView('activity');
  // announcements dismiss (delegated)
  $('#announce-wrap').addEventListener('click',e=>{
    const x=e.target.closest('[data-an]'); if(!x) return;
    const k=LS.dismiss+state.user.id;
    const d=JSON.parse(localStorage.getItem(k)||'[]'); d.push(x.dataset.an);
    localStorage.setItem(k,JSON.stringify(d)); renderAnnouncements();
  });
  // markets
  $('#market-search').addEventListener('input',e=>{ state.mktQuery=e.target.value; renderMarkets(); });
  $('#market-chips').addEventListener('click',e=>{
    const c=e.target.closest('.chip'); if(!c) return;
    state.mktFilter=c.dataset.f;
    $$('#market-chips .chip').forEach(x=>x.classList.toggle('active',x===c)); renderMarkets();
  });
  $('#market-list').addEventListener('click',e=>{
    const w=e.target.closest('[data-watch]');
    if(w){ const s=w.dataset.watch, k=LS.watch+state.user.id;
      state.watch=state.watch.includes(s)?state.watch.filter(x=>x!==s):[...state.watch,s];
      localStorage.setItem(k,JSON.stringify(state.watch)); renderMarkets(); return; }
    const r=e.target.closest('[data-sym]'); if(r) openCoinSheet(r.dataset.sym);
  });
  // wallet
  $('#wal-recv').onclick=()=>openReceive();
  $('#wal-withdraw').onclick=openWithdraw;
  $('#wal-list').addEventListener('click',e=>{
    const r=e.target.closest('[data-inr]'); if(r) return $('#qa-funds').onclick();
    const a=e.target.closest('[data-sym]'); if(a) openCoinSheet(a.dataset.sym);
  });
  // activity
  $('#act-chips').addEventListener('click',e=>{
    const c=e.target.closest('.chip'); if(!c) return;
    state.actFilter=c.dataset.f;
    $$('#act-chips .chip').forEach(x=>x.classList.toggle('active',x===c)); renderActivity();
  });
  $('#act-list').addEventListener('click',e=>{
    const r=e.target.closest('[data-tx]'); if(r) openTxDetail(r.dataset.tx);
  });
  $('#home-activity').addEventListener('click',e=>{
    const r=e.target.closest('[data-tx]'); if(r) openTxDetail(r.dataset.tx);
  });
  // send / receive / funds
  $('#send-form').addEventListener('submit',submitSend);
  $('#sd-coin').addEventListener('change',sendCalc);
  $('#sd-amount').addEventListener('input',sendCalc);
  $('#sd-max').onclick=()=>{ const s=$('#sd-coin').value;
    $('#sd-amount').value=Number(state.wallet?.[COINS[s].col]||0); sendCalc(); };
  $('#sd-address').addEventListener('input',()=>$('#sd-addr-err').hidden=true);
  $('#rc-share').onclick=async()=>{
    const addr=state.wallet?.wallet_address||'';
    if(navigator.share){ try{ await navigator.share({title:'My VaultBit address',text:addr}); }catch{} }
    else copyText(addr);
  };
  $$('#modal-funds .fd-chips .chip').forEach(c=>c.onclick=()=>{
    $('#fd-amount').value=c.dataset.v;
    $$('#modal-funds .fd-chips .chip').forEach(x=>x.classList.toggle('active',x===c));
  });
  $('#fd-submit').onclick=submitFunds;
  // withdraw overlay
  $('#wr-back').onclick=closeWithdraw;
  $('#wr-tabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setWrTab(b.dataset.t); });
  $$('#wr-form .method').forEach(b=>b.onclick=()=>setWrMethod(b.dataset.m));
  $('#wr-coin').addEventListener('change',wrCalc);
  $('#wr-amount').addEventListener('input',wrCalc);
  $('#wr-max').onclick=()=>{ const s=$('#wr-coin').value;
    $('#wr-amount').value=Number(state.wallet?.[COINS[s].col]||0); wrCalc(); };
  $('#wr-form').addEventListener('submit',submitWithdrawal);
  $('#wr-view-hist').onclick=()=>setWrTab('history');
  $('#wr-done').onclick=closeWithdraw;
  $('#wr-history').addEventListener('click',e=>{
    const r=e.target.closest('[data-wd]'); if(r) openWdDetail(r.dataset.wd);
  });
  // notifications / profile / security
  $('#notif-mark').onclick=async()=>{
    await db.from('notifications').update({read_status:true})
      .eq('user_id',state.user.id).eq('read_status',false);
    state.notifs.forEach(n=>n.read_status=true); updateBadge(); renderNotifs();
  };
  $('#set-theme').addEventListener('change',e=>setTheme(e.target.checked?'dark':'light'));
  $('#set-notif').addEventListener('change',e=>{
    localStorage.setItem(LS.notifpref+state.user.id, e.target.checked?'1':'0');
    toast('Notification preference saved (simulation).','success');
  });
  $('#set-security').onclick=openSecurity;
  $('#lang-select').addEventListener('change',()=>toast('Language preference saved (interface simulation).','success'));
  $('#logout-btn').onclick=logout;
  $('#cf-yes').onclick=()=>{ closeModal('modal-confirm'); if(_cfCb) _cfCb(); _cfCb=null; };
  $('#cf-no').onclick =()=>{ closeModal('modal-confirm'); _cfCb=null; };
  icons();
  // resume session
  const s=getSession();
  if(s?.logged_in&&s.user_id){
    const {data:u}=await db.from('users').select('*').eq('id',s.user_id).maybeSingle();
    if(u&&u.is_active) return enterApp(u);
    clearSession();
    if(u&&!u.is_active) toast('Your account has been temporarily disabled.','error');
  }
}
document.addEventListener('DOMContentLoaded',boot);
