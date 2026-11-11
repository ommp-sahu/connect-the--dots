const $=id=>document.getElementById(id);

const API_BASE = 'http://dot-universe.onrender.com';
let backendOnline = false;
const AUTH_TOKEN_KEY = 'ctd_access_token';
const authToken = () => localStorage.getItem(AUTH_TOKEN_KEY);
function setBackendStatus(online) {
 backendOnline = online;
 const el = $('backendStatus');
 if (!el) return;
 el.classList.toggle('online', online);
 el.innerHTML = `<i class="fa-solid fa-circle"></i><span>${online ? 'Python backend connected' : 'Backend offline'}</span>`;
}
async function apiRequest(path, options = {}) {
 const response = await fetch(`${API_BASE}${path}`, {
  ...options,
  headers: {'Content-Type':'application/json', ...(authToken() ? {'Authorization':`Bearer ${authToken()}`} : {}), ...(options.headers || {})}
 });
 if (!response.ok) {
  const detail = await response.json().catch(()=>({}));
  const error = new Error(detail.detail || `API request failed (${response.status})`); error.status = response.status; throw error;
 }
 return response.status === 204 ? null : response.json();
}
async function checkBackend() {
 if (!authToken()) { window.location.href = 'signin.html'; return; }
 try {
  const user = await apiRequest('/api/auth/me');
  setBackendStatus(true);
  const profile = document.querySelector('.guest div:last-child');
  if (profile) {
   profile.querySelector('strong').textContent = user.name;
   profile.querySelector('small').textContent = user.email;
  }
 } catch (_) {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  window.location.href = 'signin.html';
 }
}
function syncDotToBackend(dot) {
 apiRequest('/api/dots', {
  method:'POST',
  body:JSON.stringify({
   id:dot.id, universe_id:activeUniverse, name:dot.name,
   description:dot.description || '', x:dot.x, y:dot.y,
   color:dot.color, icon:dot.icon, created_at:dot.createdAt
  })
 }).then(()=>setBackendStatus(true)).catch(()=>setBackendStatus(false));
}
function syncConnectionToBackend(fromId, toId) {
 apiRequest('/api/connections', {
  method:'POST',
  body:JSON.stringify({universe_id:activeUniverse, from_dot_id:fromId, to_dot_id:toId})
 }).then(()=>setBackendStatus(true)).catch(()=>setBackendStatus(false));
}

const canvas=$('universeCanvas'),ctx=canvas.getContext('2d'),wrap=$('graphWrap');
let W=0,H=0,DPR=1,activeUniverse='root',selectedId=null,drag=null,connectMode=false,dragMoved=false,toastTimer;
const data={root:{id:'root',name:'My universe',dots:[],links:[],layoutLinks:[]}};
let universes=data;
const colors=['#47775a','#668b70','#824b52','#68808a','#9b805d','#7d7293'];
const icons=['fa-circle-nodes','fa-code','fa-book-open','fa-lightbulb','fa-dumbbell','fa-camera','fa-flask','fa-palette'];
function uid(){return 'd'+Math.random().toString(36).slice(2,10)}
function current(){return universes[activeUniverse]}
function dateLabel(d){return new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)}
function resize(){const r=wrap.getBoundingClientRect();W=r.width;H=r.height;DPR=Math.min(devicePixelRatio||1,2);canvas.width=W*DPR;canvas.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);draw()}
window.addEventListener('resize',resize);
function layoutDots(mode){
 const dots=current().dots;if(!dots.length)return;
  current().layoutLinks=[];
 const match=mode.match(/^pattern-(\d+)$/);
 const variant=match?Number(match[1]):0;
 const bases=['orbit','spiral','flower','grid','wave','star','random','double-orbit','rings','arc'];
 const shape=match?bases[variant%bases.length]:mode;
 const variation=match?Math.floor(variant/bases.length)+1:1;
 const cx=W/2,cy=H/2,rad=Math.min(W,H)*(.25+.018*(variation%6)),n=dots.length;
 const rotation=match?(variation*0.37):0,scale=1+((variation%4)*.08);
 dots.forEach((d,i)=>{
  const t=i/Math.max(1,n),a=t*Math.PI*2+rotation;
  let x=0,y=0;
  if(mode==='free')return;
  if(shape==='orbit'||shape==='double-orbit'){const ring=shape==='orbit'?i%3:i%2;const rr=rad*(shape==='orbit'?.38+ring*.27:.48+ring*.42);x=Math.cos(a*(shape==='orbit'?3:2))*rr;y=Math.sin(a*(shape==='orbit'?3:2))*rr}
  else if(shape==='spiral'){const rr=18+rad*t;x=Math.cos(a*(2.1+.12*variation))*rr;y=Math.sin(a*(2.1+.12*variation))*rr}
  else if(shape==='flower'){const petals=3+(variation%8);const rr=rad*(.58+.3*Math.sin(a*petals));x=Math.cos(a)*rr;y=Math.sin(a)*rr}
  else if(shape==='grid'){const cols=Math.ceil(Math.sqrt(n));x=(i%cols-(cols-1)/2)*Math.min(125,rad*.7);y=(Math.floor(i/cols)-(Math.ceil(n/cols)-1)/2)*Math.min(95,rad*.55)}
  else if(shape==='wave'){x=(t-.5)*rad*2;y=Math.sin(t*Math.PI*(3+variation%7))*rad*.65}
  else if(shape==='star'){const points=3+(variation%9),rr=rad*(i%2?.42:1);x=Math.cos(a)*rr;y=Math.sin(a)*rr;const pulse=1+.15*Math.sin(a*points);x*=pulse;y*=pulse}
  else if(shape==='random'){x=rand(-rad,rad);y=rand(-rad*.7,rad*.7)}
  else if(shape==='rings'){const ring=i%4;const rr=rad*(.25+ring*.22);x=Math.cos(a*4)*rr;y=Math.sin(a*4)*rr}
  else if(shape==='arc'){const arc=-Math.PI*.85+t*Math.PI*1.7;x=Math.cos(arc)*rad;y=Math.sin(arc)*rad*.7}
  d.x=cx+x*scale;d.y=cy+y*scale;
 });
 draw();
}
function rand(a,b){return a+Math.random()*(b-a)}
function autoConnectDots(){
 const u=current(),dots=u.dots||[];u.layoutLinks=[];
 if(dots.length<2){draw();persist();return}
 // Build a minimum-spanning set of visual links so every dot belongs to one network.
 const connected=new Set([dots[0].id]),edges=[];
 while(connected.size<dots.length){
  let best=null,bestDist=Infinity;
  for(const a of dots){if(!connected.has(a.id))continue;
   for(const b of dots){if(connected.has(b.id))continue;
    const dist=Math.hypot(a.x-b.x,a.y-b.y);
    if(dist<bestDist){bestDist=dist;best=[a.id,b.id]}
   }
  }
  if(!best)break;edges.push(best);connected.add(best[1]);
 }
 u.layoutLinks=edges;draw();persist();toast('Dots connected into a constellation');
}
function draw(){
 if(!ctx)return;ctx.clearRect(0,0,W,H);
 ctx.fillStyle='rgba(54,94,65,.07)';for(let x=18;x<W;x+=25)for(let y=18;y<H;y+=25){ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill()}
 const u=current();
 ([...((u.layoutLinks)||[]),...(u.links||[])]).forEach(([a,b],i)=>{const p=u.dots.find(d=>d.id===a),q=u.dots.find(d=>d.id===b);if(!p||!q)return;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=i<(u.layoutLinks||[]).length?'rgba(54,112,75,.38)':'rgba(130,75,82,.72)';ctx.lineWidth=i<(u.layoutLinks||[]).length?1.5:2;ctx.stroke()});
 u.dots.forEach(d=>{
  const sel=d.id===selectedId;ctx.beginPath();ctx.arc(d.x,d.y,sel?17:13,0,Math.PI*2);ctx.fillStyle=sel?'rgba(130,75,82,.12)':'rgba(255,255,255,.76)';ctx.fill();
  ctx.beginPath();ctx.arc(d.x,d.y,sel?9:7,0,Math.PI*2);ctx.fillStyle=d.color;ctx.shadowBlur=sel?17:9;ctx.shadowColor=d.color+'66';ctx.fill();ctx.shadowBlur=0;
  ctx.font='600 10px "DM Sans"';ctx.textAlign='center';ctx.fillStyle='#52665a';ctx.fillText(d.name,d.x,d.y+29);
 });
 $('graphEmpty').style.display=u.dots.length?'none':'flex';
}
function hit(pt){let best=null,dist=23;current().dots.forEach(d=>{const v=Math.hypot(pt.x-d.x,pt.y-d.y);if(v<dist){best=d;dist=v}});return best}
function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('pointerdown',e=>{
 const p=point(e),d=hit(p);canvas.setPointerCapture(e.pointerId);dragMoved=false;
 if(d){selectedId=d.id;drag={id:d.id,start:p,from:d.id};if(connectMode)drag.connect=true;else drag.move=true}
 else{selectedId=null;drag=null;closeInspector();draw()}
 draw();
});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;const p=point(e);if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>4)dragMoved=true;
 if(drag.move&&!connectMode){
  const target=hit(p);
  if(target&&target.id!==drag.id){drag.connectTarget=target.id}
  else{drag.connectTarget=null;const d=current().dots.find(x=>x.id===drag.id);if(d){d.x=p.x;d.y=p.y;draw()}}
 }
});
canvas.addEventListener('pointerup',e=>{
 if(!drag)return;const p=point(e),from=drag.id,to=hit(p);
 const targetId=to&&to.id!==from?to.id:drag.connectTarget;
 if(targetId&&dragMoved){
  const exists=current().links.some(([a,b])=>(a===from&&b===targetId)||(a===targetId&&b===from));
  if(!exists){current().links.push([from,targetId]);syncConnectionToBackend(from,targetId);toast('Connection added')}
 }else if(!dragMoved){const d=current().dots.find(x=>x.id===from);if(d)openInspector(d)}
 drag=null;connectMode=false;$('connectMode').classList.remove('primary');draw();persist();
});
canvas.addEventListener('pointercancel',()=>drag=null);
function closeInspector(){$('inspector').classList.remove('open')}
function openInspector(d){
 selectedId=d.id;$('topicIcon').innerHTML='<i class="fa-solid '+(d.icon||'fa-circle-nodes')+'"></i>';$('topicName').textContent=d.name;
 $('topicMeta').textContent='Created '+dateLabel(d.createdAt)+' · '+(d.logs?.length||0)+' learning entries';
 $('topicDescription').value=d.description||'';$('logTitle').value='';$('logBody').value='';
 $('logCount').textContent=(d.logs?.length||0)+' entries';
 $('logList').innerHTML='';
 (d.logs||[]).slice().reverse().forEach(item=>addLogCard(item));
 $('nestedHint').style.display='block';$('openUniverse').style.display='inline-block';
 $('inspector').classList.add('open');draw();
}
function addLogCard(item){
 const el=document.createElement('div');el.className='log-item';
 const title=document.createElement('strong');title.textContent=item.title;
 const date=document.createElement('small');date.textContent=dateLabel(item.date);
 const body=document.createElement('p');body.textContent=item.body;
 el.append(title,date,body);$('logList').appendChild(el);
}

function collectNestedDotIds(dot, ids=[]){
 if(!dot?.childUniverse || !universes[dot.childUniverse])return ids;
 const child=universes[dot.childUniverse];
 child.dots.forEach(nested=>{
  ids.push(nested.id);
  collectNestedDotIds(nested,ids);
 });
 return ids;
}
async function removeDotFromBackend(dotId){
 try{
  await apiRequest(`/api/dots/${encodeURIComponent(dotId)}`,{method:'DELETE'});
  return true;
 }catch(error){
  // A local-only dot may not have been synced to SQLite yet; that is safe to remove locally.
  if(error.status===404)return true;
  toast(error.message || 'Could not delete dot from the backend.');
  return false;
 }
}
async function deleteSelectedDot(){
 const dot=selectedDot();if(!dot)return;
 const confirmButton=$('confirmDeleteDot');
 confirmButton.disabled=true;confirmButton.textContent='Deleting…';
 const nestedIds=collectNestedDotIds(dot,[]);
 const allIds=[...nestedIds,dot.id];
 for(const id of allIds){
  const ok=await removeDotFromBackend(id);
  if(!ok){confirmButton.disabled=false;confirmButton.textContent='Delete permanently';return}
 }
 function removeUniverseTree(universeId){
  const universe=universes[universeId];if(!universe)return;
  universe.dots.forEach(child=>{if(child.childUniverse)removeUniverseTree(child.childUniverse)});
  delete universes[universeId];
 }
 if(dot.childUniverse)removeUniverseTree(dot.childUniverse);
 const u=current();
 u.dots=u.dots.filter(item=>item.id!==dot.id);
 u.links=(u.links||[]).filter(([a,b])=>a!==dot.id&&b!==dot.id);
 u.layoutLinks=(u.layoutLinks||[]).filter(([a,b])=>a!==dot.id&&b!==dot.id);
 selectedId=null;
 $('deleteConfirm').classList.remove('open');
 confirmButton.disabled=false;confirmButton.textContent='Delete permanently';
 closeInspector();draw();persist();toast('Dot deleted');
}

function selectedDot(){return current().dots.find(d=>d.id===selectedId)}
$('closeInspector').onclick=closeInspector;
$('deleteDotBtn').onclick=()=>{$('deleteConfirm').classList.add('open')};
$('cancelDeleteDot').onclick=()=>{$('deleteConfirm').classList.remove('open')};
$('confirmDeleteDot').onclick=deleteSelectedDot;
$('saveDescription').onclick=()=>{const d=selectedDot();if(!d)return;d.description=$('topicDescription').value;persist();toast('Description saved')};
$('addLog').onclick=()=>{
 const d=selectedDot(),title=$('logTitle').value.trim(),body=$('logBody').value.trim();if(!d||!title){toast('Add a learning title first');return}
 d.logs=d.logs||[];const item={title,body,date:new Date().toISOString()};d.logs.push(item);addLogCard(item);$('logTitle').value='';$('logBody').value='';$('logCount').textContent=d.logs.length+' entries';$('topicMeta').textContent='Created '+dateLabel(d.createdAt)+' · '+d.logs.length+' learning entries';persist();toast('Learning entry added');
};
$('openUniverse').onclick=()=>{
 const d=selectedDot();if(!d)return;
 if(!d.childUniverse){const id=uid();d.childUniverse=id;universes[id]={id,name:d.name+' universe',dots:[],links:[],layoutLinks:[],createdAt:new Date().toISOString(),parentUniverse:activeUniverse};}
 activeUniverse=d.childUniverse;selectedId=null;closeInspector();updateHeader();draw();persist();
};
$('rootCrumb').onclick=()=>{activeUniverse='root';selectedId=null;closeInspector();updateHeader();draw()};

function addExplorationEntry(id,name){
 const btn=document.createElement('button');btn.className='chat-entry';btn.type='button';
 const icon=document.createElement('i');icon.className='fa-regular fa-message';
 const span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');
 strong.textContent=name;small.textContent='Just created';span.append(strong,small);btn.append(icon,span);
 btn.addEventListener('click',()=>{activeUniverse=id;selectedId=null;closeInspector();document.querySelectorAll('.chat-entry').forEach(x=>x.classList.remove('active'));btn.classList.add('active');updateHeader();draw()});
 $('chatList').prepend(btn);
}
function createExploration(){
 const id=uid(),name='New exploration';
 universes[id]={id,name,dots:[],links:[],layoutLinks:[],createdAt:new Date().toISOString(),parentUniverse:null};
 activeUniverse=id;selectedId=null;closeInspector();
 addExplorationEntry(id,name);updateHeader();draw();persist();toast('New empty universe created');
}
$('newMessage').onclick=createExploration;
$('newExploration').onclick=createExploration;

function updateHeader(){
 const u=current();$('crumbCurrent').textContent=activeUniverse==='root'?'All topics':u.name;
 $('stageTitle').textContent=activeUniverse==='root'?'Your universe':u.name;
 $('stageSub').textContent=activeUniverse==='root'?'One topic. One dot. Your world grows with every new thing you explore.':'A smaller universe inside '+u.name+'. Add concepts, libraries, projects and practice.';
 $('rootCrumb').style.opacity=activeUniverse==='root'?'.5':'1';
}
function addTopic(name){
 name=(name||'').trim();if(!name)return;
 const d={id:uid(),name,description:'',createdAt:new Date().toISOString(),logs:[],x:rand(70,Math.max(100,W-70)),y:rand(70,Math.max(100,H-70)),color:colors[Math.floor(Math.random()*colors.length)],icon:icons[Math.floor(Math.random()*icons.length)]};
 current().dots.push(d);syncDotToBackend(d);selectedId=d.id;const layout=$('layoutSelect').value;if(layout!=='free'){layoutDots(layout);autoConnectDots()}else{draw();persist()}openInspector(d);toast('New dot added: '+name);
}
function showDotComposer(){
 const composer=$('dotComposer');composer.classList.add('open');
 $('dotNameInput').value='';$('dotNameInput').focus();
}
function hideDotComposer(){$('dotComposer').classList.remove('open')}
$('addTopic').onclick=showDotComposer;
$('dotComposer').addEventListener('submit',e=>{
 e.preventDefault();const name=$('dotNameInput').value.trim();
 if(!name){$('dotNameInput').focus();return}
 hideDotComposer();addTopic(name);
});
$('cancelDotComposer').onclick=hideDotComposer;
$('connectMode').onclick=()=>{
 connectMode=false;$('connectMode').classList.remove('primary');
 autoConnectDots();
};
$('layoutSelect').innerHTML='<option value="free">Free arrangement</option>'+Array.from({length:80},(_,i)=>`<option value="pattern-${i}">Constellation ${String(i+1).padStart(2,'0')}</option>`).join('');
$('layoutSelect').onchange=e=>{if(e.target.value==='free'){current().layoutLinks=[];draw();persist()}else{layoutDots(e.target.value);autoConnectDots()}};
$('shuffleLayout').onclick=()=>{
 const i=Math.floor(Math.random()*80),m='pattern-'+i;
 $('layoutSelect').value=m;layoutDots(m);autoConnectDots();toast('Tried constellation '+String(i+1).padStart(2,'0'));
};
$('fitGraph').onclick=()=>{const dots=current().dots;if(!dots.length)return;const minX=Math.min(...dots.map(d=>d.x)),maxX=Math.max(...dots.map(d=>d.x)),minY=Math.min(...dots.map(d=>d.y)),maxY=Math.max(...dots.map(d=>d.y));const sx=(W-120)/Math.max(1,maxX-minX),sy=(H-120)/Math.max(1,maxY-minY),s=Math.min(sx,sy,1.5);dots.forEach(d=>{d.x=(d.x-(minX+maxX)/2)*s+W/2;d.y=(d.y-(minY+maxY)/2)*s+H/2});draw();persist()};
function persist(){
 try{localStorage.setItem('ctd_universes_v1',JSON.stringify({universes,activeUniverse}));}
 catch(e){toast('Could not save locally. Check browser storage settings.');}
}
function restore(){
 try{
  const v=JSON.parse(localStorage.getItem('ctd_universes_v1'));
  if(v?.universes){
   universes=v.universes;
   Object.values(universes).forEach(u=>{u.links=u.links||[];u.layoutLinks=u.layoutLinks||[];u.dots=u.dots||[]});
   if(!universes.root)universes.root={id:'root',name:'My universe',dots:[],links:[],layoutLinks:[]};
   Object.values(universes).forEach(u=>{u.links=u.links||[];u.layoutLinks=u.layoutLinks||[];u.dots=u.dots||[]});
   activeUniverse=universes[v.activeUniverse]?v.activeUniverse:'root';
   Object.values(universes).forEach(u=>{
    if(u.id!=='root' && !u.parentUniverse){
     const exists=[...$('chatList').querySelectorAll('.chat-entry')].some(el=>el.dataset.universeId===u.id);
     if(!exists){
      const btn=document.createElement('button');btn.className='chat-entry';btn.type='button';btn.dataset.universeId=u.id;
      const icon=document.createElement('i');icon.className='fa-regular fa-message';
      const span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');
      strong.textContent=u.name||'New exploration';small.textContent='Saved exploration';span.append(strong,small);btn.append(icon,span);
      btn.addEventListener('click',()=>{activeUniverse=u.id;selectedId=null;closeInspector();document.querySelectorAll('.chat-entry').forEach(x=>x.classList.remove('active'));btn.classList.add('active');updateHeader();draw();persist()});
      $('chatList').appendChild(btn);
     }
    }
   });
  }
 }catch(e){toast('Saved workspace data could not be loaded.');}
}
$('rootHistory').onclick=()=>{activeUniverse='root';selectedId=null;closeInspector();document.querySelectorAll('.chat-entry').forEach(x=>x.classList.remove('active'));$('rootHistory').classList.add('active');updateHeader();draw();persist()};

$('rightNewChat').onclick=createExploration;
document.querySelectorAll('[data-suggestion]').forEach(btn=>{
 btn.addEventListener('click',()=>{
  const topic=btn.dataset.suggestion;
  addTopic(topic);
  toast(topic+' added to your universe');
 });
});

const logoutBtn=$('logoutBtn');
if(logoutBtn)logoutBtn.addEventListener('click',()=>{
 localStorage.removeItem(AUTH_TOKEN_KEY);
 window.location.href='signin.html';
});
restore();updateHeader();resize();checkBackend();

// Small keyboard and pointer conveniences.
$('logTitle').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('addLog').click()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeInspector();if($('dotComposer'))hideDotComposer()}});
canvas.addEventListener('dblclick',e=>{
 const p=point(e);
 if(!hit(p))showDotComposer();
});
