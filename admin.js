/* =====================================================================
   VaultBit — admin console (admin.html)
   Same custom auth (users table, role='admin') · separate session key
   ===================================================================== */
const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';   // ← replace
const SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-ANON-KEY';          // ← replace (anon key only)
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const COINS = {
  BTC:{name:'Bitcoin',glyph:'₿',col:'btc_balance',color:'#F7931A'},
  ETH:{name:'Ethereum',glyph:'Ξ',col:'eth_balance',color:'#627EEA'},
  USDT:{name:'Tether',glyph:'₮',col:'usdt_balance',color:'#26A17B'},
  SOL:{name:'Solana',glyph:'◎',col:'sol_balance',color:'#7A5AF8'},
  XRP:{name:'XRP',glyph:'✕',col:'xrp_balance',color:'#23292F'},
  DOGE:{name:'Dogecoin',glyph:'Ð',col:'doge_balance',color:'#C2A633'},
  BNB:{name:'BNB',glyph:'◆',col:'bnb_balance',color:'#F0B90B'},
};
const ASSETS={...COINS, INR:{name:'Indian Rupee',glyph:'₹',col:'inr_balance',color:'#0CA678'}};
const ADM_SESSION='vaultbit_admin_session';
const SEC_TITLES={dashboard:'Dashboard',users:'Users',wallets:'Wallets & Balance Management',
  withdrawals:'Withdrawals',transactions:'Transactions',notifications:'Notifications',
  announcements:'Announcements',settings:'Settings'};

const state={admin:null,users:[],wallets:[],txs:[],wds:[],prices:{},sec:'dashboard',bmAction:'credit',charts:{}};

/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtINR=(n,d=2)=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtAmt=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:8});
const round8=v=>Math.round(v*1e8)/1e8;
const fmtDT=iso=>new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
const fmtD=iso=>new Date(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const badge=s=>`<span class="badge ${esc(s)}">${esc(s)}</span>`;
const icons=()=>{ if(window.lucide) lucide.createIcons(); };
const usdtLike=n=>Number(n)<1?4:2;
function toast(msg,type='info'){
  const ic={success:'check-circle-2',error:'alert-triangle',info:'info'}[type]||'info';
  const el=document.createElement('div'); el.className='toast '+type;
  el.innerHTML=`<i data-lucide="${ic}"></i><span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el); icons();
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),260);},3200);
}
function openModal(id){const m=$('#'+id);m.hidden=false;requestAnimationFrame(()=>m.classList.add('open'));}
function closeModal(id){const m=$('#'+id);m.classList.remove('open');setTimeout(()=>m.hidden=true,240);}
let _cfCb=null;
function askConfirm(title,msg,yesLabel,cb,danger=true){
  $('#ac-title').textContent=title; $('#ac-msg').textContent=msg;
  const y=$('#ac-yes'); y.textContent=yesLabel; y.className='btn '+(danger?'btn-danger':'btn-primary');
  _cfCb=cb; openModal('am-confirm');
}

/* ---------- password (same scheme as app.js) ---------- */
async function hashPassword(pw,salt){
  const s=salt+'::'+pw;
  if(window.crypto?.subtle){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  let h1=5381,h2=52711;
  for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=(h1*33^c)>>>0;h2=(h2*37^c)>>>0;}
  return 'fb'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
async function verifyPassword(pw,stored){
  const [salt,old]=String(stored).split('$');
  return (await hashPassword(pw,salt))===old;
}

/* ---------- theme ---------- */
function setTheme(t){
  document.documentElement.dataset.theme=t;
  localStorage.setItem('vaultbit_theme',t);
  $('#ad-theme').innerHTML=`<i data-lucide="${t==='dark'?'sun':'moon'}"></i>`; icons();
  Object.values(state.charts).forEach(c=>{try{c.destroy()}catch{}}); state.charts={};
  if(state.sec==='dashboard') renderCharts();
}

/* ---------- login ---------- */
async function handleLogin(e){
  e.preventDefault();
  const id=$('#ad-id').value.trim(), pw=$('#ad-pw').value;
  const btn=$('#ad-btn'); btn.classList.add('loading');
  try{
    const isEmail=/^\S+@\S+\.\S+$/.test(id);
    const {data:u,error}=isEmail
      ? await db.from('users').select('*').eq('email',id.toLowerCase()).maybeSingle()
      : await db.from('users').select('*').eq('mobile',id.replace(/\s/g,'')).maybeSingle();
    if(error) throw error;
    if(!u || !(await verifyPassword(pw,u.password_hash)))
      return fail('Invalid credentials.');
    if(!u.is_active) return fail('Your account has been temporarily disabled.');
    if(u.role!=='admin') return showDenied();
    await db.from('users').update({last_login:new Date().toISOString()}).eq('id',u.id);
    localStorage.setItem(ADM_SESSION,JSON.stringify({user_id:u.id,role:'admin'}));
    btn.classList.remove('loading');
    enterAdmin(u);
  }catch(err){ console.error(err); fail('Something went wrong.'); }
  function fail(m){ btn.classList.remove('loading'); toast(m,'error'); }
}
function showDenied(){
  $('#ad-login').hidden=true; $('#ad-denied').hidden=false; icons();
}

/* ---------- boot / load ---------- */
async function enterAdmin(u){
  state.admin=u;
  $('#ad-login').hidden=true; $('#ad-denied').hidden=true; $('#ad-app').hidden=false;
  $('#ad-name').textContent=u.username; $('#ad-avatar').textContent=u.username.slice(0,2).toUpperCase();
  $('#st-url').textContent=SUPABASE_URL; $('#st-key').textContent=SUPABASE_ANON_KEY.slice(0,10)+'…';
  $('#st-admin').textContent=u.username;
  await loadCore(); renderSection('dashboard');
  setConn(true);
  db.channel('admin-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'withdrawals'},()=>quietRefresh())
    .on('postgres_changes',{event:'*',schema:'public',table:'users'},()=>quietRefresh())
    .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>quietRefresh())
    .subscribe();
}
async function quietRefresh(){
  await loadCore();
  if(['dashboard','users','wallets','withdrawals','transactions'].includes(state.sec)) renderSection(state.sec);
}
function setConn(on){
  $('#conn-dot').classList.toggle('on',on);
  $('#conn-label').textContent=on?'Realtime connected':'Connecting…';
}
async function loadCore(){
  const [us,wl,tx,wd,pr]=await Promise.all([
    db.from('users').select('*').order('created_at',{ascending:false}),
    db.from('wallets').select('*, users!wallets_user_id_fkey(username, email, mobile, is_active)'),
    db.from('transactions').select(`*, sender:users!transactions_sender_id_fkey(username),
      receiver:users!transactions_receiver_id_fkey(username)`).order('created_at',{ascending:false}).limit(300),
    db.from('withdrawals').select('*, users(username, mobile)').order('created_at',{ascending:false}),
    db.from('market_prices').select('*'),
  ]);
  state.users=us.data||[]; state.wallets=wl.data||[]; state.txs=tx.data||[];
  state.wds=wd.data||[];
  (pr.data||[]).forEach(p=>state.prices[p.symbol]={inr:p.current_price_inr,chg:p.change_percentage});
}

/* ---------- dashboard ---------- */
function walletINRValue(w){
  let t=Number(w?.inr_balance||0);
  for(const s in COINS) t+=Number(w?.[COINS[s].col]||0)*(state.prices[s]?.inr||0);
  return t;
}
function renderStats(){
  const active=state.users.filter(u=>u.is_active).length;
  const totalINR=state.wallets.reduce((a,w)=>a+walletINRValue(w),0);
  const pend=state.wds.filter(w=>w.status==='Processing').length;
  const done=state.wds.filter(w=>w.status==='Completed').length;
  $('#stat-grid').innerHTML=[
    ['Total users',state.users.length,'registered accounts'],
    ['Active users',active,`${state.users.length-active} disabled`],
    ['Total portfolio',fmtINR(totalINR,0),'all wallets (INR value)'],
    ['Transactions',state.txs.length,'recent records'],
    ['Pending withdrawals',pend,'awaiting processing'],
    ['Completed withdrawals',done,'paid out (simulated)'],
  ].map(([l,v,s])=>`<div class="stat"><span>${l}</span><b>${v}</b><small>${s}</small></div>`).join('');
}
function last14(){
  return [...Array(14)].map((_,i)=>{const d=new Date(Date.now()-(13-i)*864e5);
    return {k:d.toISOString().slice(0,10), l:d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})};});
}
function renderCharts(){
  if(!window.Chart) return;
  const days=last14(), grid=dark=>dark?'rgba(255,255,255,.08)':'rgba(14,21,38,.07)';
  const tick=getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim();
  const dk=document.documentElement.dataset.theme==='dark';
  const base={responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:tick,font:{size:10}}},
      y:{grid:{color:grid(dk)},border:{display:false},ticks:{color:tick,font:{size:10}},beginAtZero:true,precision:0}}};
  const mk=(id,cfg)=>{ if(state.charts[id]) state.charts[id].destroy();
    state.charts[id]=new Chart($(id),cfg); };
  const uc=days.map(d=>state.users.filter(u=>(u.created_at||'').slice(0,10)===d.k).length);
  mk('#ch-users',{type:'line',data:{labels:days.map(d=>d.l),datasets:[{data:uc,borderColor:'#0CA678',
    backgroundColor:'rgba(12,166,120,.14)',fill:true,tension:.35,pointRadius:2}]},options:{...base}});
  const tc=days.map(d=>state.txs.filter(t=>(t.created_at||'').slice(0,10)===d.k).length);
  mk('#ch-tx',{type:'bar',data:{labels:days.map(d=>d.l),datasets:[{data:tc,backgroundColor:'#7466F0',borderRadius:5}]},options:{...base}});
  const wc=days.map(d=>state.wds.filter(w=>(w.created_at||'').slice(0,10)===d.k).length);
  mk('#ch-wd',{type:'bar',data:{labels:days.map(d=>d.l),datasets:[{data:wc,backgroundColor:'#E8A33D',borderRadius:5}]},options:{...base}});
}

/* ---------- users ---------- */
function renderUsers(){
  const q=$('#us-search').value.trim().toLowerCase(), f=$('#us-filter').value;
  let list=state.users.filter(u=>{
    if(f==='active'&&!u.is_active) return false;
    if(f==='disabled'&&u.is_active) return false;
    if(f==='admins'&&u.role!=='admin') return false;
    if(q&&!`${u.username} ${u.email||''} ${u.mobile}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $('#us-table').innerHTML=`<thead><tr><th>User</th><th>Mobile</th><th>Email</th>
    <th>Role</th><th>Status</th><th>Joined</th><th>Portfolio</th><th>Actions</th></tr></thead><tbody>`+
    (list.length?list.map(u=>{
      const w=state.wallets.find(x=>x.user_id===u.id);
      return `<tr>
        <td><div class="rowuser"><span class="coin-ic" style="background:#101828">${esc(u.username.slice(0,2).toUpperCase())}</span>
          <span><b>${esc(u.username)}</b><small>ID ${u.id.slice(0,8)}</small></span></div></td>
        <td>${esc(u.mobile)}</td><td>${esc(u.email||'—')}</td>
        <td>${u.role==='admin'?'<span class="role-chip">ADMIN</span>':'user'}</td>
        <td class="${u.is_active?'status-on':'status-off'}">${u.is_active?'Active':'Disabled'}</td>
        <td>${fmtD(u.created_at)}</td><td>${w?fmtINR(walletINRValue(w),0):'—'}</td>
        <td><div class="actions">
          <button class="iconbtn" data-act="view" data-id="${u.id}" title="Details"><i data-lucide="eye"></i></button>
          <button class="iconbtn ${u.is_active?'danger':''}" data-act="toggle" data-id="${u.id}"
            title="${u.is_active?'Disable':'Enable'}"><i data-lucide="power"></i></button>
          <button class="iconbtn" data-act="role" data-id="${u.id}" title="Change role"><i data-lucide="user-check"></i></button>
        </div></td></tr>`;
    }).join(''):`<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:26px">No users match.</td></tr>`)+`</tbody>`;
  icons();
}
async function toggleUser(id){
  const u=state.users.find(x=>x.id===id); if(!u) return;
  const to=!u.is_active;
  askConfirm(to?'Disable account':'Enable account',
    `${to?'Disable':'Enable'} @${u.username}'s account? ${to?'They will be locked out at next request.':''}`,
    to?'Disable':'Enable', async()=>{
      const err=(await db.from('users').update({is_active:to}).eq('id',id)).error;
      if(err) return toast('Update failed.','error');
      await db.from('notifications').insert({user_id:id,
        title:to?'Account disabled':'Account enabled',
        message:to?'Your account has been temporarily disabled by the platform.':'Your account has been re-enabled.'});
      toast(`@${u.username} ${to?'disabled':'enabled'}.`,'success');
      await loadCore(); renderSection('users');
    });
}
function changeRole(id){
  const u=state.users.find(x=>x.id===id); if(!u) return;
  const to=u.role==='admin'?'user':'admin';
  askConfirm('Change role',`Change @${u.username}'s role from ${u.role} to ${to}?`,'Change',async()=>{
    const err=(await db.from('users').update({role:to}).eq('id',id)).error;
    if(err) return toast('Update failed.','error');
    toast(`Role updated to ${to}.`,'success');
    await loadCore(); renderSection('users');
  });
}
async function openUserDetail(id){
  const u=state.users.find(x=>x.id===id); if(!u) return;
  const w=state.wallets.find(x=>x.user_id===id);
  const [txr,wdr]=await Promise.all([
    db.from('transactions').select('*').or(`sender_id.eq.${id},receiver_id.eq.${id}`)
      .order('created_at',{ascending:false}).limit(6),
    db.from('withdrawals').select('*').eq('user_id',id).order('created_at',{ascending:false}).limit(5),
  ]);
  const balRows=Object.keys(ASSETS).map(s=>{
    const v=Number(w?.[ASSETS[s].col]||0);
    const inr=s==='INR'?v:v*(state.prices[s]?.inr||0);
    return `<div class="cs-stat"><span>${s}</span><b>${fmtAmt(v)}</b>
      <small class="muted" style="font-weight:600">${fmtINR(inr)}</small></div>`;
  }).join('');
  $('#am-body').innerHTML=`
    <div class="sheet-head"><h3>@${esc(u.username)}</h3><button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    ${badge(u.is_active?'Completed':'Failed').replace('Completed','Active').replace('Failed','Disabled')}
    <div class="kv-card" style="margin-top:12px">
      <div class="kv"><span>Mobile</span><b>${esc(u.mobile)}</b></div>
      <div class="kv"><span>Email</span><b>${esc(u.email||'—')}</b></div>
      <div class="kv"><span>Role</span><b>${u.role}</b></div>
      <div class="kv"><span>Joined</span><b>${fmtDT(u.created_at)}</b></div>
      <div class="kv"><span>Last login</span><b>${u.last_login?fmtDT(u.last_login):'—'}</b></div>
      <div class="kv"><span>Wallet address</span><b class="mono">${esc(w?.wallet_address||'—')}</b></div>
    </div>
    <h4 class="group-label">Wallet</h4>
    <div class="cs-stats">${balRows}</div>
    <h4 class="group-label">Recent transactions</h4>
    <div class="kv-card">${(txr.data||[]).map(t=>`<div class="kv"><span>${esc(t.transaction_type)} · ${esc(t.coin)}</span>
      <b>${fmtAmt(t.amount)} · ${fmtINR(t.amount_inr)}</b></div>`).join('')||'<div class="kv"><span>None</span></div>'}</div>
    <h4 class="group-label">Withdrawals</h4>
    <div class="kv-card">${(wdr.data||[]).map(x=>`<div class="kv"><span>${esc(x.coin)} · ${esc(x.withdrawal_method)}</span>
      <b>${fmtINR(x.amount_inr)} ${badge(x.status)}</b></div>`).join('')||'<div class="kv"><span>None</span></div>'}</div>
    <div class="am-actions">
      <button class="btn btn-ghost" id="ud-credit"><i data-lucide="plus"></i> Credit funds</button>
      <button class="btn btn-ghost" id="ud-toggle"><i data-lucide="power"></i> ${u.is_active?'Disable':'Enable'} account</button>
    </div>`;
  icons(); openModal('am-modal');
  $('#ud-credit').onclick=()=>{ closeModal('am-modal'); goSection('wallets');
    $('#bm-user').value=id; bmPreview(); };
  $('#ud-toggle').onclick=()=>{ closeModal('am-modal'); toggleUser(id); };
}

/* ---------- balance management ---------- */
function fillBmSelects(){
  $('#bm-user').innerHTML=state.users.map(u=>`<option value="${u.id}">@${esc(u.username)} (${esc(u.mobile)})</option>`).join('');
  $('#bm-asset').innerHTML=Object.keys(ASSETS).map(s=>`<option value="${s}">${ASSETS[s].name} · ${s}</option>`).join('');
}
function bmPreview(){
  const uid=$('#bm-user').value, asset=$('#bm-asset').value,
        amt=parseFloat($('#bm-amount').value)||0;
  const w=state.wallets.find(x=>x.user_id===uid);
  const cur=Number(w?.[ASSETS[asset].col]||0);
  if(!w){ $('#bm-preview').textContent='No wallet found for this user.'; return; }
  const next=state.bmAction==='credit'?cur+amt:cur-amt;
  $('#bm-preview').innerHTML=asset==='INR'
    ? `Current: ${fmtINR(cur)} → After ${state.bmAction}: <u>${fmtINR(next)}</u>`
    : `Current: ${fmtAmt(cur)} ${asset} → After ${state.bmAction}: <u>${fmtAmt(round8(next))} ${asset}</u> (≈ ${fmtINR(next*(state.prices[asset]?.inr||0))})`;
}
async function execAdjust(){
  const uid=$('#bm-user').value, asset=$('#bm-asset').value,
        amt=parseFloat($('#bm-amount').value);
  if(!uid) return toast('Select a user.','error');
  if(!(amt>0)) return toast('Enter a valid amount.','error');
  const u=state.users.find(x=>x.id===uid);
  const w=state.wallets.find(x=>x.user_id===uid);
  const col=ASSETS[asset].col, cur=Number(w?.[col]||0);
  if(state.bmAction==='debit'&&amt>cur)
    return toast(`Insufficient balance — user only has ${fmtAmt(cur)} ${asset}.`,'error');
  const next=state.bmAction==='credit'?round8(cur+amt):round8(cur-amt);
  const note=$('#bm-note').value.trim();
  const assetLabel=asset==='INR'?fmtINR(amt):`${fmtAmt(amt)} ${asset} (≈ ${fmtINR(amt*(state.prices[asset]?.inr||0))})`;
  askConfirm(`${state.bmAction==='credit'?'Credit':'Debit'} funds`,
    `${state.bmAction==='credit'?'Credit':'Debit'} ${assetLabel} ${state.bmAction==='credit'?'to':'from'} @${u?.username}? New balance: ${asset==='INR'?fmtINR(next):fmtAmt(next)+' '+asset}.`,
    state.bmAction==='credit'?'Credit':'Debit', async()=>{
      const err=(await db.from('wallets').update({[col]:next}).eq('user_id',uid)).error;
      if(err) return toast('Adjustment failed.','error');
      const credit=state.bmAction==='credit';
      await db.from('transactions').insert({
        sender_id:credit?null:uid, receiver_id:credit?uid:null,
        coin:asset, amount:amt,
        amount_inr:asset==='INR'?amt:amt*(state.prices[asset]?.inr||0),
        tx_hash:'0x'+[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''),
        status:'Completed', confirmations:3,
        transaction_type:credit?'admin_credit':'admin_debit', note:note||null});
      await db.from('notifications').insert({user_id:uid,
        title:credit?'Balance credited':'Balance debited',
        message:`${assetLabel} was ${credit?'credited to':'debited from'} your wallet${note?' — '+note:''} by the platform.`});
      $('#bm-amount').value=''; $('#bm-note').value='';
      toast('Balance updated & user notified.','success');
      await loadCore(); renderSection('wallets');
    }, false);
}

/* ---------- withdrawals ---------- */
function renderWds(){
  const q=$('#wd-search').value.trim().toLowerCase(),
        f=$('#wd-filter').value, m=$('#wd-method').value;
  const list=state.wds.filter(w=>{
    if(f!=='all'&&w.status!==f) return false;
    if(m!=='all'&&w.withdrawal_method!==m) return false;
    if(q&&!`${w.users?.username||''} ${w.users?.mobile||''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $('#wd-table').innerHTML=`<thead><tr><th>User</th><th>Crypto</th><th>INR</th><th>Method</th>
    <th>Payout detail</th><th>Status</th><th>Requested</th><th>ETA</th><th>Actions</th></tr></thead><tbody>`+
    (list.length?list.map(w=>{
      const canAct=w.status==='Processing';
      const detail=w.withdrawal_method==='UPI'?esc(w.upi_id||'—')
        :`${esc(w.bank_name||'')} · ${esc(w.account_number||'')}`;
      return `<tr>
        <td><b>${esc(w.users?.username||'—')}</b></td>
        <td>${fmtAmt(w.crypto_amount)} ${esc(w.coin)}</td>
        <td>${fmtINR(w.amount_inr)}</td><td>${w.withdrawal_method}</td>
        <td class="mono" style="max-width:170px;overflow:hidden;text-overflow:ellipsis">${detail}</td>
        <td>${badge(w.status)}</td>
        <td>${fmtD(w.created_at)}</td>
        <td>${w.estimated_arrival?fmtD(w.estimated_arrival):'—'}</td>
        <td><div class="actions">
          <button class="iconbtn" data-wd="view" data-id="${w.id}" title="Details"><i data-lucide="eye"></i></button>
          ${canAct?`
          <button class="iconbtn" data-wd="approve" data-id="${w.id}" title="Approve"><i data-lucide="check"></i></button>
          <button class="iconbtn" data-wd="complete" data-id="${w.id}" title="Mark completed"><i data-lucide="check-circle-2"></i></button>
          <button class="iconbtn danger" data-wd="reject" data-id="${w.id}" title="Reject"><i data-lucide="x-circle"></i></button>
          <button class="iconbtn danger" data-wd="fail" data-id="${w.id}" title="Mark failed"><i data-lucide="alert-triangle"></i></button>`:''}
        </div></td></tr>`;
    }).join(''):`<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:26px">No withdrawals match.</td></tr>`)+`</tbody>`;
  icons();
}
async function wdAction(id,action){
  const w=state.wds.find(x=>x.id===id); if(!w) return;
  const u=w.users?.username||'user';
  const amtLabel=`${fmtAmt(w.crypto_amount)} ${w.coin} (≈ ${fmtINR(w.amount_inr)})`;
  const plans={
    approve:{t:'Approve withdrawal',m:`Approve @${u}'s withdrawal of ${amtLabel}? Transfer will move into processing.`,y:'Approve'},
    complete:{t:'Mark completed',m:`Mark @${u}'s withdrawal of ${amtLabel} as Completed and notify "Funds Successfully Delivered"?`,y:'Mark completed'},
    reject:{t:'Reject withdrawal',m:`Reject @${u}'s withdrawal of ${amtLabel}? The crypto will be refunded to their wallet.`,y:'Reject & refund'},
    fail:{t:'Mark failed',m:`Mark @${u}'s withdrawal of ${amtLabel} as Failed? The crypto will be refunded to their wallet.`,y:'Mark failed'},
  }[action];
  askConfirm(plans.t,plans.m,plans.y,async()=>{
    let patch={};
    let msg='';
    if(action==='approve'){ patch={status:'Processing',processing_days_remaining:1};
      msg=`Your withdrawal of ${amtLabel} has been approved and is now being transferred.`; }
    if(action==='complete'){ patch={status:'Completed',completed_at:new Date().toISOString(),processing_days_remaining:0};
      msg=`Funds Successfully Delivered — ${amtLabel} has been delivered via ${w.withdrawal_method==='UPI'?'UPI':'bank transfer'}.`; }
    if(action==='reject'||action==='fail'){
      patch={status:action==='reject'?'Rejected':'Failed'};
      const wl=state.wallets.find(x=>x.user_id===w.user_id);
      if(wl){ const col=COINS[w.coin].col;
        await db.from('wallets').update({[col]:round8(Number(wl[col]||0)+Number(w.crypto_amount))}).eq('user_id',w.user_id); }
      msg=`Your withdrawal of ${amtLabel} was ${patch.status.toLowerCase()}. The crypto has been returned to your wallet.`;
    }
    const err=(await db.from('withdrawals').update(patch).eq('id',id)).error;
    if(err) return toast('Status update failed.','error');
    if(w.tx_hash) await db.from('transactions').update({
      status:patch.status==='Processing'?'Processing':patch.status,
      confirmations:patch.status==='Completed'?3:0}).eq('tx_hash',w.tx_hash);
    await db.from('notifications').insert({user_id:w.user_id,
      title:action==='complete'?'Funds Successfully Delivered':`Withdrawal ${patch.status.toLowerCase()}`, message:msg});
    toast(`Withdrawal ${action==='approve'?'approved':patch.status.toLowerCase()} & user notified.`,'success');
    await loadCore(); renderSection('withdrawals');
  }, action!=='approve'&&action!=='complete');
}
function openWdDetail(id){
  const w=state.wds.find(x=>x.id===id); if(!w) return;
  $('#am-body').innerHTML=`
    <div class="sheet-head"><h3>Withdrawal · @${esc(w.users?.username||'')}</h3>
      <button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    ${badge(w.status)}
    <div class="wd-detail-grid" style="margin-top:14px">
      <div><span>Crypto</span><b>${fmtAmt(w.crypto_amount)} ${esc(w.coin)}</b></div>
      <div><span>INR value</span><b>${fmtINR(w.amount_inr)}</b></div>
      <div><span>Method</span><b>${w.withdrawal_method}</b></div>
      ${w.withdrawal_method==='UPI'
        ?`<div><span>UPI ID</span><b>${esc(w.upi_id||'—')}</b></div>`
        :`<div><span>Bank</span><b>${esc(w.bank_name||'—')}</b></div>
          <div><span>Holder</span><b>${esc(w.account_holder_name||'—')}</b></div>
          <div><span>Account</span><b class="mono">${esc(w.account_number||'—')}</b></div>
          <div><span>IFSC</span><b class="mono">${esc(w.ifsc_code||'—')}</b></div>`}
      <div><span>Requested</span><b>${fmtDT(w.created_at)}</b></div>
      <div><span>ETA (3 business days)</span><b>${w.estimated_arrival?fmtD(w.estimated_arrival):'—'}</b></div>
      ${w.completed_at?`<div><span>Completed</span><b>${fmtDT(w.completed_at)}</b></div>`:''}
      <div><span>TX hash</span><b class="mono">${esc(w.tx_hash||'—')}</b></div>
    </div>
    <p class="sim-note small"><i data-lucide="shield-alert"></i> Simulator record — no real payout has been or will be made.</p>`;
  icons(); openModal('am-modal');
}

/* ---------- transactions ---------- */
function renderTxs(){
  const q=$('#tx-search').value.trim().toLowerCase(),
        c=$('#tx-coin').value, s=$('#tx-status').value, t=$('#tx-type').value;
  const list=state.txs.filter(x=>{
    if(c!=='all'&&x.coin!==c) return false;
    if(s!=='all'&&x.status!==s) return false;
    if(t!=='all'&&x.transaction_type!==t) return false;
    if(q&&!x.tx_hash.toLowerCase().includes(q)) return false;
    return true;
  });
  $('#tx-table').innerHTML=`<thead><tr><th>Hash</th><th>From → To</th><th>Coin</th><th>Amount</th>
    <th>INR</th><th>Type</th><th>Status</th><th>Date</th></tr></thead><tbody>`+
    (list.length?list.map(x=>{
      const who=`${esc(x.sender?.username||'system')} → ${esc(x.receiver?.username||x.transaction_type==='withdrawal'?'external':'—')}`;
      return `<tr style="cursor:pointer" data-tx="${x.id}">
        <td class="mono">${esc(x.tx_hash.slice(0,12))}…</td><td>${who}</td>
        <td>${esc(x.coin)}</td><td>${fmtAmt(x.amount)}</td><td>${fmtINR(x.amount_inr)}</td>
        <td>${esc(x.transaction_type)}</td><td>${badge(x.status)}</td><td>${fmtD(x.created_at)}</td></tr>`;
    }).join(''):`<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:26px">No transactions match.</td></tr>`)+`</tbody>`;
  icons();
}
function openTxDetail(id){
  const x=state.txs.find(t=>t.id===id); if(!x) return;
  $('#am-body').innerHTML=`
    <div class="sheet-head"><h3>Transaction detail</h3><button class="iconbtn" data-close><i data-lucide="x"></i></button></div>
    ${badge(x.status)}
    <div class="kv-card" style="margin-top:12px">
      <div class="kv"><span>Type</span><b>${esc(x.transaction_type)}</b></div>
      <div class="kv"><span>Amount</span><b>${fmtAmt(x.amount)} ${esc(x.coin)}</b></div>
      <div class="kv"><span>INR value</span><b>${fmtINR(x.amount_inr)}</b></div>
      <div class="kv"><span>Sender</span><b>${esc(x.sender?.username||'system')}</b></div>
      <div class="kv"><span>Receiver</span><b>${esc(x.receiver?.username||'—')}</b></div>
      <div class="kv"><span>Confirmations</span><b>${x.confirmations} / 3</b></div>
      <div class="kv"><span>Date</span><b>${fmtDT(x.created_at)}</b></div>
      ${x.note?`<div class="kv"><span>Note</span><b>${esc(x.note)}</b></div>`:''}
    </div>
    <div class="addr-box"><code class="mono">${esc(x.tx_hash)}</code></div>
    <p class="sim-note small"><i data-lucide="shield-alert"></i> Simulated hash — no real blockchain record exists.</p>`;
  openModal('am-modal');
}

/* ---------- notifications / announcements ---------- */
async function sendNotification(){
  const target=$('#nf-target').value, title=$('#nf-title').value.trim(),
        message=$('#nf-message').value.trim();
  if(!title||!message) return toast('Enter a title and message.','error');
  const btn=$('#nf-send'); btn.classList.add('loading');
  try{
    const rows=(target==='all'?state.users:state.users.filter(u=>u.id===target))
      .map(u=>({user_id:u.id,title,message}));
    if(!rows.length) throw 0;
    const err=(await db.from('notifications').insert(rows)).error;
    if(err) throw err;
    $('#nf-title').value=''; $('#nf-message').value='';
    toast(`Notification sent to ${rows.length} user${rows.length>1?'s':''}.`,'success');
    loadRecentNotifs();
  }catch{ toast('Failed to send notification.','error'); }
  btn.classList.remove('loading');
}
async function loadRecentNotifs(){
  const {data}=await db.from('notifications').select('*, users(username)')
    .order('created_at',{ascending:false}).limit(12);
  $('#nf-table').innerHTML=`<thead><tr><th>User</th><th>Title</th><th>Message</th><th>Sent</th></tr></thead><tbody>`+
    (data||[]).map(n=>`<tr><td><b>@${esc(n.users?.username||'—')}</b></td>
      <td>${esc(n.title)}</td><td style="max-width:320px;white-space:normal">${esc(n.message)}</td>
      <td>${fmtDT(n.created_at)}</td></tr>`).join('')+`</tbody>`;
}
async function publishAnnouncement(){
  const title=$('#an-title').value.trim(), message=$('#an-message').value.trim(),
        type=$('#an-type').value;
  if(!title||!message) return toast('Enter a title and message.','error');
  const err=(await db.from('announcements').insert({title,message,type,created_by:state.admin.id})).error;
  if(err) return toast('Failed to publish.','error');
  $('#an-title').value=''; $('#an-message').value='';
  toast('Announcement published — visible on all dashboards.','success');
  loadAnnouncements();
}
async function loadAnnouncements(){
  const {data}=await db.from('announcements').select('*').order('created_at',{ascending:false}).limit(20);
  $('#an-table').innerHTML=`<thead><tr><th>Title</th><th>Type</th><th>Message</th><th>Published</th><th></th></tr></thead><tbody>`+
    ((data||[]).map(a=>`<tr><td><b>${esc(a.title)}</b></td><td>${esc(a.type)}</td>
      <td style="max-width:320px;white-space:normal">${esc(a.message)}</td><td>${fmtDT(a.created_at)}</td>
      <td><button class="iconbtn danger" data-del="${a.id}"><i data-lucide="trash-2"></i></button></td></tr>`).join('')
      ||`<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:22px">No announcements yet.</td></tr>`)+`</tbody>`;
  icons();
}

/* ---------- settings ---------- */
async function refreshPrices(){
  const btn=$('#st-prices'); btn.classList.add('loading');
  try{
    const ids='bitcoin,ethereum,tether,solana,ripple,dogecoin,binancecoin';
    const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=inr&include_24hr_change=true`);
    const arr=await res.json();
    const map={bitcoin:'BTC',ethereum:'ETH',tether:'USDT',solana:'SOL',ripple:'XRP',dogecoin:'DOGE',binancecoin:'BNB'};
    const names={BTC:'Bitcoin',ETH:'Ethereum',USDT:'Tether',SOL:'Solana',XRP:'XRP',DOGE:'Dogecoin',BNB:'BNB'};
    const rows=Object.entries(arr).map(([id,v])=>({symbol:map[id],coin_name:names[map[id]],
      current_price_inr:v.inr,change_percentage:v.inr_24h_change||0,updated_at:new Date().toISOString()}));
    await db.from('market_prices').upsert(rows,{onConflict:'symbol'});
    toast('Market prices refreshed into the database.','success');
    await loadCore(); if(state.sec==='dashboard') renderSection('dashboard');
  }catch{ toast('Could not reach CoinGecko.','error'); }
  btn.classList.remove('loading');
}

/* ---------- section switching ---------- */
function goSection(sec){
  state.sec=sec;
  $$('.anav').forEach(b=>b.classList.toggle('active',b.dataset.sec===sec));
  $$('.asec').forEach(s=>s.classList.toggle('is-active',s.id==='sec-'+sec));
  $('#sec-title').textContent=SEC_TITLES[sec];
  renderSection(sec);
}
function renderSection(sec){
  if(sec==='dashboard'){ renderStats(); renderCharts(); }
  if(sec==='users'){ fillBmSelects(); renderUsers(); }
  if(sec==='wallets'){ fillBmSelects(); renderWalletsTable(); bmPreview(); }
  if(sec==='withdrawals') renderWds();
  if(sec==='transactions') renderTxs();
  if(sec==='notifications') loadRecentNotifs();
  if(sec==='announcements') loadAnnouncements();
}
function renderWalletsTable(){
  $('#wal-table').innerHTML=`<thead><tr><th>User</th><th>Address</th>
    ${Object.keys(COINS).map(s=>`<th>${s}</th>`).join('')}<th>INR</th><th>Total value</th></tr></thead><tbody>`+
    state.wallets.map(w=>`<tr>
      <td><b>${esc(w.users?.username||'—')}</b></td>
      <td class="mono" style="max-width:130px;overflow:hidden;text-overflow:ellipsis">${esc(w.wallet_address)}</td>
      ${Object.keys(COINS).map(s=>`<td>${fmtAmt(w[COINS[s].col])}</td>`).join('')}
      <td>${fmtINR(w.inr_balance,0)}</td><td><b>${fmtINR(walletINRValue(w),0)}</b></td></tr>`).join('')+`</tbody>`;
}

/* ---------- boot ---------- */
async function boot(){
  setTheme(localStorage.getItem('vaultbit_theme')||'light');
  document.addEventListener('click',e=>{
    const cl=e.target.closest('[data-close]');
    if(cl) closeModal(cl.closest('.modal').id);
  });
  $('#ad-login-form').addEventListener('submit',handleLogin);
  $$('[data-eye]').forEach(b=>b.addEventListener('click',()=>{
    const i=$('#'+b.dataset.eye); i.type=i.type==='password'?'text':'password';
    b.innerHTML=`<i data-lucide="${i.type==='password'?'eye':'eye-off'}"></i>`; icons();
  }));
  $$('.anav').forEach(b=>b.onclick=()=>goSection(b.dataset.sec));
  $('#ad-theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  $('#ad-logout').onclick=()=>askConfirm('Log out','End this admin session?','Log out',()=>{
    localStorage.removeItem(ADM_SESSION); location.reload();
  }, false);
  $('#ac-yes').onclick=()=>{ closeModal('am-confirm'); if(_cfCb) _cfCb(); _cfCb=null; };
  $('#ac-no').onclick =()=>{ closeModal('am-confirm'); _cfCb=null; };
  // users toolbar + table delegation
  $('#us-search').addEventListener('input',renderUsers);
  $('#us-filter').addEventListener('change',renderUsers);
  $('#us-table').addEventListener('click',e=>{
    const b=e.target.closest('[data-act]'); if(!b) return;
    if(b.dataset.act==='view') openUserDetail(b.dataset.id);
    if(b.dataset.act==='toggle') toggleUser(b.dataset.id);
    if(b.dataset.act==='role') changeRole(b.dataset.id);
  });
  // balance management
  $('#bm-user').addEventListener('change',bmPreview);
  $('#bm-asset').addEventListener('change',bmPreview);
  $('#bm-amount').addEventListener('input',bmPreview);
  $$('#sec-wallets .seg button').forEach(b=>b.onclick=()=>{
    state.bmAction=b.dataset.a;
    $$('#sec-wallets .seg button').forEach(x=>x.classList.toggle('active',x===b));
    bmPreview();
  });
  $('#bm-exec').onclick=execAdjust;
  // withdrawals
  ['wd-search','wd-filter','wd-method'].forEach(id=>$('#'+id).addEventListener('input',renderWds));
  $('#wd-filter').addEventListener('change',renderWds);
  $('#wd-method').addEventListener('change',renderWds);
  $('#wd-table').addEventListener('click',e=>{
    const b=e.target.closest('[data-wd]'); if(!b) return;
    if(b.dataset.wd==='view') openWdDetail(b.dataset.id);
    else wdAction(b.dataset.id,b.dataset.wd);
  });
  // transactions
  ['tx-search','tx-coin','tx-status','tx-type'].forEach(id=>$('#'+id).addEventListener('input',renderTxs));
  $$('#sec-transactions select').forEach(s=>s.addEventListener('change',renderTxs));
  $('#tx-table').addEventListener('click',e=>{
    const r=e.target.closest('[data-tx]'); if(r) openTxDetail(r.dataset.tx);
  });
  // notifications & announcements
  $('#nf-send').onclick=sendNotification;
  $('#an-publish').onclick=publishAnnouncement;
  $('#an-table').addEventListener('click',e=>{
    const d=e.target.closest('[data-del]'); if(!d) return;
    askConfirm('Delete announcement','Remove this announcement from all dashboards?','Delete',async()=>{
      await db.from('announcements').delete().eq('id',d.dataset.del);
      toast('Announcement deleted.','success'); loadAnnouncements();
    });
  });
  // settings
  $('#st-prices').onclick=refreshPrices;
  $('#st-maint').onclick=()=>{ goSection('announcements'); $('#an-type').value='Maintenance';
    $('#an-title').value='Scheduled maintenance'; $('#an-message').value='';
    $('#an-message').focus(); toast('Fill in the details and publish.','info'); };
  icons();
  // resume session
  const s=JSON.parse(localStorage.getItem(ADM_SESSION)||'null');
  if(s?.user_id){
    const {data:u}=await db.from('users').select('*').eq('id',s.user_id).maybeSingle();
    if(u&&u.is_active&&u.role==='admin') return enterAdmin(u);
    localStorage.removeItem(ADM_SESSION);
  }
}
document.addEventListener('DOMContentLoaded',boot);
