
const CFG = window.CHY_ADMIN_CONFIG;
const CHY_ADMIN_LOCAL_VERSION = CFG.appVersion || "unknown";
window.CHY_ADMIN_JS_READY = true;

async function checkAdminVersionLight(){
  try{
    const r = await fetch('/CHYPluginReleases/admin/admin-version.json?_='+Date.now(), {cache:'no-store'});
    if(!r.ok) return;
    const x = await r.json();
    const remote = String(x.version||'');
    if(remote && remote !== CHY_ADMIN_LOCAL_VERSION){
      const u = new URL(location.href);
      u.searchParams.set('_v', remote);
      u.searchParams.set('_t', Date.now());
      location.replace(u.toString());
    }
  }catch(e){
    console.warn('CHY version check skipped', e);
  }
}

let token = localStorage.getItem('chyAdminToken') || sessionStorage.getItem('chyAdminToken') || '';
let currentTab = 'pending';
let users = [];
let currentPermUser = '';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(action, params={}) {
  const body = new URLSearchParams({action, ...params});
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(),15000);
  try{
    const res = await fetch(CFG.appsScriptUrl, {
      method:'POST',
      body,
      redirect:'follow',
      cache:'no-store',
      signal:ctrl.signal
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { throw new Error('서버 응답을 읽을 수 없습니다: ' + text.slice(0,160)); }
  }catch(e){
    if(e && e.name==='AbortError') throw new Error('서버 응답이 지연되어 요청을 중단했습니다.');
    throw e;
  }finally{
    clearTimeout(timer);
  }
}
function busy(v){ document.body.classList.toggle('busy', !!v); }
function msg(text, ok=true){ const m=$('msg'); m.textContent=text; m.className='msg '+(ok?'ok':'err'); setTimeout(()=>m.className='msg',3000); }
function authExpired(){ localStorage.removeItem('chyAdminToken'); sessionStorage.removeItem('chyAdminToken'); token=''; $('app').hidden=true; $('loginBox').hidden=false; msg('로그인 세션이 만료되었습니다.',false); }

async function initOneSignal(){
  if(!CFG.oneSignalAppId || CFG.oneSignalAppId.includes('PASTE_')){
    window.CHYOneSignalReady=false;
    updatePushButton();
    return false;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  return new Promise((resolve)=>{
    OneSignalDeferred.push(async function(OneSignal){
      try{
        await OneSignal.init({
          appId: CFG.oneSignalAppId,
          safari_web_id: CFG.oneSignalSafariWebId,
          serviceWorkerPath: "CHYPluginReleases/admin/push/onesignal/OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: "/CHYPluginReleases/admin/push/onesignal/" },
          notifyButton: { enable:false },
          welcomeNotification: { disable:true },
          autoResubscribe: true
        });

        window.CHYOneSignal=OneSignal;
        window.CHYOneSignalReady=true;

        const id=localStorage.getItem('chyAdminId');
        if(token && id){
          await OneSignal.login(id);
        }

        try{
          OneSignal.User.PushSubscription.addEventListener('change', function(event){
            console.log('OneSignal PushSubscription change', event);
            if(event && event.current && event.current.token){
              console.log('OneSignal push token created');
            }
            updatePushButton();
          });
        }catch(e){}

        updatePushButton();
        resolve(true);
      }catch(e){
        console.error("OneSignal init failed",e);
        window.CHYOneSignalReady=false;
        updatePushButton();
        resolve(false);
      }
    });
  });
}


async function repairOneSignalWorker(){
  if(!('serviceWorker' in navigator)){
    alert('Service Worker를 지원하지 않는 환경입니다.');
    return;
  }
  try{
    const reg = await navigator.serviceWorker.register(
      '/CHYPluginReleases/admin/push/onesignal/OneSignalSDKWorker.js',
      {scope:'/CHYPluginReleases/admin/push/onesignal/'}
    );
    await navigator.serviceWorker.ready.catch(()=>{});
    alert('Service Worker 등록 요청 완료\nscope: '+reg.scope+'\n앱을 완전히 종료 후 다시 실행한 뒤 알림 허용을 눌러주세요.');
  }catch(e){
    alert('Service Worker 등록 실패: '+(e&&e.message?e.message:String(e)));
  }
}

async function showPushStatus(){
  const lines=[];
  lines.push('현재 URL: '+location.href);
  lines.push('알림 권한: '+(Notification.permission||'-'));
  lines.push('Safari Web ID: '+(CFG.oneSignalSafariWebId?'설정됨':'없음'));

  if(!window.CHYOneSignalReady || !window.CHYOneSignal){
    lines.push('OneSignal 초기화: 실패/미완료');
  }else{
    const O=window.CHYOneSignal;
    lines.push('OneSignal 초기화: 완료');
    lines.push('OneSignal 구독: '+(O.User.PushSubscription.optedIn?'Subscribed':'Unsubscribed'));
    lines.push('Subscription ID: '+(O.User.PushSubscription.id||'-'));
    lines.push('Push Token: '+(O.User.PushSubscription.token?'생성됨':'없음'));
  }

  if('serviceWorker' in navigator){
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      if(!regs.length) lines.push('Service Worker: 없음');
      regs.forEach((r,i)=>{
        lines.push('SW'+(i+1)+' scope: '+r.scope);
        const u=(r.active||r.waiting||r.installing);
        lines.push('SW'+(i+1)+' script: '+(u?u.scriptURL:'-'));
      });
    }catch(e){
      lines.push('Service Worker 확인 실패: '+e.message);
    }
  }else{
    lines.push('Service Worker: 미지원');
  }

  alert(lines.join('\n'));
}

async function enablePush(){
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if(!standalone){
    alert('아이폰에서는 Safari 공유 → 홈 화면에 추가 후, 홈 화면의 CHY 관리자 아이콘으로 실행해주세요.');
    return;
  }

  if(!window.CHYOneSignalReady || !window.CHYOneSignal){
    const ok = await initOneSignal();
    if(!ok || !window.CHYOneSignal){
      alert('OneSignal 초기화에 실패했습니다. 관리자앱을 완전히 종료한 뒤 다시 실행해주세요.');
      return;
    }
  }

  try{
    const OneSignal=window.CHYOneSignal;

    if(!OneSignal.Notifications.isPushSupported()){
      alert('현재 실행 환경에서는 Web Push를 지원하지 않습니다.');
      return;
    }

    const id=localStorage.getItem('chyAdminId');
    if(id) await OneSignal.login(id);

    if(!OneSignal.Notifications.permission){
      await OneSignal.Notifications.requestPermission();
    }

    if(!OneSignal.Notifications.permission){
      alert('iPhone 알림 권한이 허용되지 않았습니다. 설정 > 알림 > CHY 관리자에서 알림을 허용해주세요.');
      updatePushButton();
      return;
    }

    await OneSignal.User.PushSubscription.optIn();

    // Give iOS/OneSignal a moment to finish creating the web-push token.
    for(let i=0;i<20;i++){
      if(OneSignal.User.PushSubscription.optedIn && OneSignal.User.PushSubscription.id){
        break;
      }
      await new Promise(r=>setTimeout(r,500));
    }

    const subscribed = !!OneSignal.User.PushSubscription.optedIn;
    const subId = OneSignal.User.PushSubscription.id || '';

    updatePushButton();

    if(subscribed && subId){
      msg('푸시 알림 구독이 완료되었습니다.');
    }else{
      alert('iPhone 알림 권한은 허용됐지만 OneSignal 푸시 구독이 아직 완료되지 않았습니다. 앱을 완전히 종료 후 다시 열어 알림 버튼을 한 번 더 눌러주세요.');
    }
  }catch(e){
    console.error("Push opt-in failed",e);
    msg('푸시 구독 실패: '+(e&&e.message?e.message:String(e)),false);
  }
}
function updatePushButton(){
  const labels=[$('pushBtn'),$('pushBtn2')].filter(Boolean);
  if(!window.CHYOneSignalReady || !window.CHYOneSignal){
    labels.forEach(b=>{b.textContent='알림 설정';b.disabled=false});
    return;
  }

  const subscribed = !!window.CHYOneSignal.User.PushSubscription.optedIn;
  const subId = window.CHYOneSignal.User.PushSubscription.id || '';
  labels.forEach(b=>{
    b.textContent = subscribed && subId ? '알림 사용중' : '알림 허용';
    b.disabled = subscribed && !!subId;
  });
}

async function login(){
  const id=$('id').value.trim(), pw=$('pw').value;
  const remember=!!$('rememberLogin')?.checked;
  if(!id||!pw){ alert('아이디와 비밀번호를 입력해주세요.'); return; }
  busy(true);
  try{
    const r=await api('mobileApiLogin',{id,password:pw});
    if(!r.ok){ alert(r.message||'로그인 실패'); return; }

    token=r.token;
    localStorage.setItem('chyAdminName',r.name||r.id);

    if(remember){
      localStorage.setItem('chyAdminToken',token);
      localStorage.setItem('chyAdminId',r.id);
      localStorage.setItem('chyAdminRemember','1');
      sessionStorage.removeItem('chyAdminToken');
    }else{
      sessionStorage.setItem('chyAdminToken',token);
      localStorage.removeItem('chyAdminToken');
      localStorage.removeItem('chyAdminId');
      localStorage.removeItem('chyAdminRemember');
    }

    // Do not manually store the password. Keeping the value until navigation
    // helps Safari/iOS Password AutoFill offer Keychain save/update.
    $('adminName').textContent=r.name||r.id;
    $('loginBox').hidden=true; $('app').hidden=false;
    if(window.CHYOneSignal) await window.CHYOneSignal.login(r.id);
    showTab('pending');
  }catch(e){ alert(e.message); } finally{ busy(false); }
}
async function logout(){
  try{ if(token) await api('mobileApiLogout',{token}); }catch(e){}
  if(window.CHYOneSignal) try{ await window.CHYOneSignal.logout(); }catch(e){}
  localStorage.removeItem('chyAdminToken');
  sessionStorage.removeItem('chyAdminToken');
  token='';
  // Saved ID is intentionally preserved when "아이디 저장" was enabled.
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
    const sel=new Set(r.selectedIds||[]),psel=new Set(r.selectedPluginIds||[]),pl=$('permList');pl.innerHTML='';
    const fhead=document.createElement('div');fhead.className='permSection';fhead.innerHTML='<b>기능 · 핫키 권한</b><div class="small">기존 기능 권한</div>';pl.appendChild(fhead);
    (r.functions||[]).forEach(f=>{
      const d=document.createElement('label');d.className='perm';const num=String(parseInt(f.id.replace('FN',''),10));
      d.innerHTML=`<input type="checkbox" data-kind="function" data-fid="${esc(f.id)}" ${sel.has(f.id)?'checked':''}><div><div class="permName">${esc(num)}. ${esc(f.name)}</div><div class="permHotkey">${esc(f.id)} · ${esc(f.hotkey)}</div></div>`;pl.appendChild(d);
    });
    const phead=document.createElement('div');phead.className='permSection pluginSection';phead.innerHTML='<b>플러그인 권한</b><div class="small">서버 카탈로그 기준 · 새 플러그인은 자동 추가됩니다.</div>';pl.appendChild(phead);
    (r.plugins||[]).forEach(p=>{const d=document.createElement('label');d.className='perm';d.innerHTML=`<input type="checkbox" data-kind="plugin" data-pid="${esc(p.id)}" ${psel.has(p.id)?'checked':''}><div><div class="permName">${esc(p.name||p.id)}</div><div class="permHotkey">${esc(p.id)} · v${esc(p.version||'-')}</div></div>`;pl.appendChild(d);});$('permSave').hidden=false;
  }catch(e){msg(e.message,false);}finally{busy(false);}
}
async function savePermissions(){
  if(!currentPermUser)return;
  const ids=[...document.querySelectorAll('#permList input[data-kind="function"]:checked')].map(x=>x.dataset.fid);
  const pluginIds=[...document.querySelectorAll('#permList input[data-kind="plugin"]:checked')].map(x=>x.dataset.pid);
  if(!confirm(`기능 ${ids.length}개 / 플러그인 ${pluginIds.length}개 권한을 저장할까요?\n체크 해제한 항목은 차단됩니다.`))return;
  const r=await api('mobileApiSavePermissions',{token,targetId:currentPermUser,selectedIds:ids.join(';'),selectedPluginIds:pluginIds.join(';')});
  msg(r.message||'권한을 저장했습니다.',!!r.ok);
}

window.addEventListener('load',async()=>{
  setTimeout(()=>checkAdminVersionLight(),1500);
  const remembered = localStorage.getItem('chyAdminRemember')==='1';
  $('rememberLogin').checked=remembered;
  $('id').value=remembered ? (localStorage.getItem('chyAdminId')||'') : '';

  await initOneSignal();

  if(token){
    $('adminName').textContent=localStorage.getItem('chyAdminName')||localStorage.getItem('chyAdminId')||'관리자';
    $('loginBox').hidden=true;$('app').hidden=false;showTab('pending');
  }
});
setInterval(()=>{if(token&&currentTab==='online')loadOnline();},30000);

setInterval(()=>{ if(!document.hidden) checkAdminVersionLight(); },300000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) checkAdminVersionLight(); });
