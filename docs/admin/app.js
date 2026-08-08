
const CFG = window.CHY_ADMIN_CONFIG;
let token = localStorage.getItem('chyAdminToken') || '';
let currentTab = 'pending';
let users = [];
let currentPermUser = '';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(action, params={}) {
  const body = new URLSearchParams({action, ...params});
  const res = await fetch(CFG.appsScriptUrl, {method:'POST', body, redirect:'follow'});
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('서버 응답을 읽을 수 없습니다: ' + text.slice(0,160)); }
}
function busy(v){ document.body.classList.toggle('busy', !!v); }
function msg(text, ok=true){ const m=$('msg'); m.textContent=text; m.className='msg '+(ok?'ok':'err'); setTimeout(()=>m.className='msg',3000); }
function authExpired(){ localStorage.removeItem('chyAdminToken'); token=''; $('app').hidden=true; $('loginBox').hidden=false; msg('로그인 세션이 만료되었습니다.',false); }

async function initOneSignal(){
  if(!CFG.oneSignalAppId || CFG.oneSignalAppId.includes('PASTE_')) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal){
    await OneSignal.init({
      appId: CFG.oneSignalAppId,
      serviceWorkerPath: "OneSignalSDKWorker.js",
      serviceWorkerParam: { scope: "./" },
      notifyButton: { enable:false },
      welcomeNotification: { disable:true }
    });
    window.CHYOneSignal = OneSignal;
    if(token){
      const id=localStorage.getItem('chyAdminId');
      if(id) await OneSignal.login(id);
    }
    updatePushButton();
  });
}
async function enablePush(){
  if(!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone){
    alert('아이폰에서는 먼저 이 페이지를 홈 화면에 추가한 뒤, 홈 화면의 CHY 관리자 아이콘으로 실행해주세요.');
    return;
  }
  if(!window.CHYOneSignal){ alert('OneSignal 설정이 아직 완료되지 않았습니다.'); return; }
  try{
    await window.CHYOneSignal.Notifications.requestPermission();
    await window.CHYOneSignal.User.PushSubscription.optIn();
    const id=localStorage.getItem('chyAdminId');
    if(id) await window.CHYOneSignal.login(id);
    updatePushButton();
    msg('푸시 알림이 활성화되었습니다.');
  }catch(e){ msg('알림 설정 실패: '+e.message,false); }
}
function updatePushButton(){
  const b=$('pushBtn'); if(!b) return;
  if(!window.CHYOneSignal){ b.textContent='푸시 설정 필요'; return; }
  const granted = Notification.permission === 'granted';
  b.textContent = granted ? '알림 사용중' : '알림 허용';
  b.disabled = granted;
}

async function login(){
  const id=$('id').value.trim(), pw=$('pw').value;
  if(!id||!pw){ alert('아이디와 비밀번호를 입력해주세요.'); return; }
  busy(true);
  try{
    const r=await api('mobileApiLogin',{id,password:pw});
    $('pw').value='';
    if(!r.ok){ alert(r.message||'로그인 실패'); return; }
    token=r.token;
    localStorage.setItem('chyAdminToken',token);
    localStorage.setItem('chyAdminId',r.id);
    localStorage.setItem('chyAdminName',r.name||r.id);
    $('adminName').textContent=r.name||r.id;
    $('loginBox').hidden=true; $('app').hidden=false;
    if(window.CHYOneSignal) await window.CHYOneSignal.login(r.id);
    showTab('pending');
  }catch(e){ alert(e.message); } finally{ busy(false); }
}
async function logout(){
  try{ if(token) await api('mobileApiLogout',{token}); }catch(e){}
  if(window.CHYOneSignal) try{ await window.CHYOneSignal.logout(); }catch(e){}
  localStorage.removeItem('chyAdminToken'); token='';
  location.reload();
}
function showTab(n){
  currentTab=n;
  ['pending','users','online','perm'].forEach(x=>{
    $(x+'Pane').hidden=x!==n;
    $('tab'+x[0].toUpperCase()+x.slice(1)).classList.toggle('on',x===n);
  });
  if(n==='pending') loadPendingAll();
  if(n==='users') loadUsers();
  if(n==='online') loadOnline();
  if(n==='perm' && !users.length) loadUsers(true);
}
async function loadPendingAll(){ await Promise.all([loadPending(),loadResets()]); }
async function loadPending(){
  try{
    const r=await api('mobileApiListPending',{token});
    if(!r.ok){ if(r.auth===false)return authExpired(); throw new Error(r.message||'조회 실패');}
    $('pendingCount').textContent='가입 승인 대기 '+r.count+'명';
    const list=$('pendingList'); list.innerHTML='';
    if(!r.items.length){list.innerHTML='<div class="card empty">승인 대기 사용자가 없습니다.</div>';return;}
    r.items.forEach(x=>{
      const d=document.createElement('div'); d.className='card';
      d.innerHTML=`<div class="name">${esc(x.name||x.id)} <span class="badge">승인대기</span></div>
      <div class="meta">아이디: ${esc(x.id)}<br>사번: ${esc(x.employeeNo)}<br>신청: ${esc(x.requestedAt)}${x.pcName?'<br>PC: '+esc(x.pcName):''}</div>
      <div class="row topgap"><button class="approve">승인</button><button class="reject">거절</button></div>`;
      d.querySelector('.approve').onclick=()=>approve(x.id,x.name);
      d.querySelector('.reject').onclick=()=>rejectUser(x.id,x.name);
      list.appendChild(d);
    });
  }catch(e){msg(e.message,false);}
}
async function approve(id,name){
  if(!confirm((name||id)+'님을 승인할까요?\n기본 권한: 1,2,3,20,21,22,32,34,35,36,37'))return;
  const r=await api('mobileApiApprove',{token,targetId:id});
  msg(r.message||'처리했습니다.',!!r.ok); if(r.ok)loadPending();
}
async function rejectUser(id,name){
  if(!confirm((name||id)+'님의 가입을 거절할까요?'))return;
  const r=await api('mobileApiReject',{token,targetId:id});
  msg(r.message||'처리했습니다.',!!r.ok); if(r.ok)loadPending();
}
async function loadResets(){
  try{
    const r=await api('mobileApiListPasswordResets',{token});
    if(!r.ok)return;
    $('resetCount').textContent='비밀번호 재설정 대기 '+r.count+'명';
    const list=$('resetList');list.innerHTML='';
    if(!r.items.length){list.innerHTML='<div class="card empty">재설정 요청이 없습니다.</div>';return;}
    r.items.forEach(x=>{
      const d=document.createElement('div');d.className='card';
      d.innerHTML=`<div class="name">${esc(x.id)} <span class="badge">재설정 대기</span></div><div class="meta">사번: ${esc(x.employeeNo)}<br>신청: ${esc(x.requestedAt)}</div><div class="row topgap"><button class="approve">승인</button><button class="reject">거절</button></div>`;
      d.querySelector('.approve').onclick=()=>resetAction('mobileApiApprovePasswordReset',x.requestId);
      d.querySelector('.reject').onclick=()=>resetAction('mobileApiRejectPasswordReset',x.requestId);
      list.appendChild(d);
    });
  }catch(e){msg(e.message,false);}
}
async function resetAction(action,requestId){
  const r=await api(action,{token,requestId});msg(r.message||'처리했습니다.',!!r.ok);if(r.ok)loadResets();
}
async function loadUsers(silent=false){
  if(!silent)busy(true);
  try{
    const r=await api('mobileApiListUsers',{token});
    if(!r.ok){if(r.auth===false)return authExpired();throw new Error(r.message||'회원조회 실패');}
    users=r.items||[];$('userCount').textContent=`전체 ${users.length}명 · 현재 접속 ${r.onlineCount||0}명`;
    renderUsers();fillPermUsers();
  }catch(e){msg(e.message,false);}finally{busy(false);}
}
function renderUsers(){
  const q=($('userSearch').value||'').toLowerCase(), list=$('userList');list.innerHTML='';
  const a=users.filter(x=>!q||[x.name,x.id,x.employeeNo].join(' ').toLowerCase().includes(q));
  if(!a.length){list.innerHTML='<div class="card empty">검색된 회원이 없습니다.</div>';return;}
  a.forEach(x=>{
    const d=document.createElement('div');d.className='card userCard';
    d.innerHTML=`<div class="name">${esc(x.name||x.id)} <span class="badge">${esc(x.role)}</span> ${x.online?'<span class="badge green">● 접속중</span>':'<span class="badge gray">오프라인</span>'}</div>
    <div class="meta">아이디: ${esc(x.id)}<br>사번: ${esc(x.employeeNo)}<br><b>가입일: ${esc(x.createdAt||'-')}</b><br>승인일: ${esc(x.approvedAt||'-')}${x.online?'<br>접속 PC: '+esc(x.onlinePc||'-')+'<br>마지막 통신: '+esc(x.lastSeen||'-'):''}</div>`;
    d.onclick=()=>{showTab('perm');$('permUserSelect').value=x.id;loadPermissions(x.id);};list.appendChild(d);
  });
}
async function loadOnline(){
  busy(true);
  try{
    const r=await api('mobileApiListOnline',{token});
    if(!r.ok){if(r.auth===false)return authExpired();throw new Error(r.message||'접속현황 조회 실패');}
    $('onlineCount').textContent=`현재 접속 ${r.count}명 · 약 ${Math.ceil((r.timeoutSec||180)/60)}분 이상 통신 없으면 오프라인`;
    const list=$('onlineList');list.innerHTML='';
    if(!r.items.length){list.innerHTML='<div class="card empty">현재 접속 사용자가 없습니다.</div>';return;}
    r.items.forEach(x=>{
      const d=document.createElement('div');d.className='card';
      d.innerHTML=`<div class="name">${esc(x.name||x.id)} <span class="badge green">● 접속중</span></div><div class="meta">아이디: ${esc(x.id)} · 사번: ${esc(x.employeeNo||'-')}<br>PC: ${esc(x.pcName||'-')}<br>로그인: ${esc(x.loginAt||'-')}<br>마지막 통신: ${esc(x.lastSeen||'-')}<br>버전: ${esc(x.version||'-')}${x.plugins?'<br>실행 플러그인: '+esc(x.plugins):''}</div>`;
      list.appendChild(d);
    });
  }catch(e){msg(e.message,false);}finally{busy(false);}
}
function fillPermUsers(){
  const s=$('permUserSelect'),old=s.value;
  s.innerHTML='<option value="">사용자 선택</option>'+users.map(x=>`<option value="${esc(x.id)}">${esc((x.name||x.id)+' | '+x.id+' | '+x.employeeNo)}</option>`).join('');
  if(old)s.value=old;
}
async function loadPermissions(id){
  if(!id)return;currentPermUser=id;busy(true);
  try{
    const r=await api('mobileApiGetPermissions',{token,targetId:id});
    if(!r.ok)throw new Error(r.message||'권한조회 실패');
    $('permUserInfo').hidden=false;$('permUserInfo').innerHTML=`<div class="name">${esc(r.user.name||r.user.id)}</div><div class="meta">아이디: ${esc(r.user.id)} · 사번: ${esc(r.user.employeeNo)}<br>가입일: ${esc(r.user.createdAt||'-')}</div>`;
    const sel=new Set(r.selectedIds||[]),pl=$('permList');pl.innerHTML='';
    (r.functions||[]).forEach(f=>{
      const d=document.createElement('label');d.className='perm';const num=String(parseInt(f.id.replace('FN',''),10));
      d.innerHTML=`<input type="checkbox" data-fid="${esc(f.id)}" ${sel.has(f.id)?'checked':''}><div><div class="permName">${esc(num)}. ${esc(f.name)}</div><div class="permHotkey">${esc(f.id)} · ${esc(f.hotkey)}</div></div>`;
      pl.appendChild(d);
    });$('permSave').hidden=false;
  }catch(e){msg(e.message,false);}finally{busy(false);}
}
async function savePermissions(){
  if(!currentPermUser)return;
  const ids=[...document.querySelectorAll('#permList input:checked')].map(x=>x.dataset.fid);
  if(!confirm(`선택한 ${ids.length}개 기능만 허용할까요?\n체크하지 않은 기능은 차단됩니다.`))return;
  const r=await api('mobileApiSavePermissions',{token,targetId:currentPermUser,selectedIds:ids.join(';')});
  msg(r.message||'권한을 저장했습니다.',!!r.ok);
}

window.addEventListener('load',async()=>{
  $('id').value=localStorage.getItem('chyAdminId')||'';
  await initOneSignal();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./OneSignalSDKWorker.js').catch(()=>{});
  if(token){
    $('adminName').textContent=localStorage.getItem('chyAdminName')||localStorage.getItem('chyAdminId')||'관리자';
    $('loginBox').hidden=true;$('app').hidden=false;showTab('pending');
  }
});
setInterval(()=>{if(token&&currentTab==='online')loadOnline();},30000);
