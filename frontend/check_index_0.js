
const canvas=document.getElementById('neuralCanvas');
const ctx=canvas.getContext('2d');
const stage=document.querySelector('.hero-visual');
let W=0,H=0,particles=[],raf=0,dragged=null,pointer={x:0,y:0,down:false},lastSpawn=0;
const rand=(a,b)=>Math.random()*(b-a)+a;
function resizeCanvas(){
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
 W=rect.width;H=rect.height;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
 const count=Math.max(55,Math.min(105,Math.floor(W*H/3500)));
 particles=Array.from({length:count},(_,i)=>({x:rand(12,W-12),y:rand(12,H-12),vx:rand(-.42,.42),vy:rand(-.42,.42),r:rand(1.2,2.5),phase:rand(0,6.28),fixed:false}));
}
function pointFromEvent(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function nearestParticle(p){let best=null,bd=22;for(const n of particles){const d=Math.hypot(n.x-p.x,n.y-p.y);if(d<bd){bd=d;best=n}}return best}
canvas.addEventListener('pointerdown',e=>{
 const p=pointFromEvent(e);pointer={...p,down:true};
 dragged=nearestParticle(p);
 if(dragged){dragged.fixed=true;canvas.setPointerCapture(e.pointerId)}
 else {particles.push({x:p.x,y:p.y,vx:rand(-.3,.3),vy:rand(-.3,.3),r:3,phase:0,fixed:true});dragged=particles[particles.length-1];canvas.setPointerCapture(e.pointerId)}
});
canvas.addEventListener('pointermove',e=>{
 const p=pointFromEvent(e);pointer.x=p.x;pointer.y=p.y;
 if(dragged){dragged.x=p.x;dragged.y=p.y}
});
function releasePointer(){if(dragged)dragged.fixed=false;dragged=null;pointer.down=false}
canvas.addEventListener('pointerup',releasePointer);canvas.addEventListener('pointercancel',releasePointer);
canvas.addEventListener('pointerleave',e=>{if(e.buttons===0)releasePointer()});
function drawNetwork(t){
 ctx.clearRect(0,0,W,H);
 const cx=W/2,cy=H/2;
 const glow=ctx.createRadialGradient(cx,cy,5,cx,cy,Math.min(W,H)*.48);
 glow.addColorStop(0,'rgba(103,145,111,.19)');glow.addColorStop(1,'rgba(103,145,111,0)');
 ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
 // Gentle motion gives the network a living, neural feel.
 particles.forEach((p,i)=>{
  if(!p.fixed){p.x+=p.vx;p.y+=p.vy;if(p.x<5||p.x>W-5)p.vx*=-1;if(p.y<5||p.y>H-5)p.vy*=-1}
  // A pointer creates a subtle local ripple / attraction.
  const pd=Math.hypot(p.x-pointer.x,p.y-pointer.y);
  if(pointer.down&&pd>12&&pd<130&&!p.fixed){p.vx+=(pointer.x-p.x)*.00013;p.vy+=(pointer.y-p.y)*.00013}
  p.vx=Math.max(-.8,Math.min(.8,p.vx));p.vy=Math.max(-.8,Math.min(.8,p.vy));
  for(let j=i+1;j<particles.length;j++){
   const q=particles[j],d=Math.hypot(p.x-q.x,p.y-q.y);
   if(d<112){ctx.strokeStyle=`rgba(48,91,66,${(1-d/112)*.28})`;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}
  }
  const pulse=(Math.sin(t*.002+p.phase)+1)*.5;
  ctx.beginPath();ctx.arc(p.x,p.y,p.r+pulse*.65,0,Math.PI*2);
  ctx.fillStyle=p.fixed?'rgba(130,75,82,.95)':(i%9===0?'rgba(130,75,82,.78)':'rgba(53,100,72,.72)');ctx.fill();
 });
 // Pointer-to-node lines make dragging feel like drawing with the network.
 if(pointer.down){particles.forEach(p=>{const d=Math.hypot(p.x-pointer.x,p.y-pointer.y);if(d<150){ctx.beginPath();ctx.moveTo(pointer.x,pointer.y);ctx.lineTo(p.x,p.y);ctx.strokeStyle=`rgba(130,75,82,${(1-d/150)*.45})`;ctx.lineWidth=1.3;ctx.stroke()}})}
 for(let k=0;k<8;k++){const a=k*Math.PI*2/8+t*.00014,r=112+Math.sin(t*.001+k)*18,px=cx+Math.cos(a)*r,py=cy+Math.sin(a)*r;ctx.beginPath();ctx.arc(px,py,2.1,0,Math.PI*2);ctx.fillStyle='rgba(130,75,82,.88)';ctx.fill()}
 raf=requestAnimationFrame(drawNetwork);
}
resizeCanvas();drawNetwork(0);window.addEventListener('resize',resizeCanvas);
const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));
const menuBtn=document.getElementById('menuBtn'),navLinks=document.getElementById('navLinks');
menuBtn.addEventListener('click',()=>navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>navLinks.classList.remove('open')));
