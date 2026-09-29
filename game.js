(() => {
'use strict';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha:false });
const W = 1280, H = 720, FLOOR = 620, WORLD_W = 7200;
const $ = s => document.querySelector(s);
const title = $('#title'), hud = $('#hud'), pausePanel = $('#pause'), resultPanel = $('#result'), touch = $('#touch');
const hpbar = $('#hpbar'), odbar = $('#odbar'), comboEl = $('#combo'), scoreEl = $('#score'), techEl = $('#tech'), zoneEl = $('#zone');
const bossHud = $('#bossHud'), bossbar = $('#bossbar');

let state = 'title', last = performance.now(), acc = 0, simTime = 0, frame = 0;
let camX = 0, shake = 0, flash = 0, slow = 1, slowTimer = 0, hitStop = 0;
let score = 0, combo = 0, comboTimer = 0, best = +(localStorage.neonRiftBest || 0);
let audio = null, nextBeat = 0, beatStep = 0;
let particles = [], texts = [], shots = [], enemies = [], platforms = [], stars = [];
let attackSerial = 1, currentZone = -1, runStart = 0, defeated = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const input = {
  left:false,right:false,jump:false,attack:false,dash:false,parry:false,od:false,
  jp:false,ap:false,dp:false,pp:false,op:false
};

const player = {
  x:120,y:FLOOR-58,px:120,py:FLOOR-58,w:34,h:58,vx:0,vy:0,dir:1,
  ground:true,coyote:0,jumpBuffer:0,airJump:1,wall:0,dashT:0,dashCd:0,
  hp:100,od:0,inv:0,attackT:0,attackStep:0,attackId:0,comboWindow:0,
  parryT:0,parryCd:0,overdrive:0,trail:[]
};

const zones = [
  [0,'SECTOR 01 — FLOW LAB','MOVE // COYOTE TIME + JUMP BUFFER'],
  [2100,'SECTOR 02 — COMBAT GRID','COMBAT // 3-HIT CANCEL CHAIN'],
  [4300,'SECTOR 03 — REFLEX TUNNEL','DEFENSE // PARRY + SLOW-MO'],
  [5900,'SECTOR 04 — CORE CHAMBER','BOSS // MULTI-PHASE ENCOUNTER']
];

function initWorld(){
  platforms = [
    {x:0,y:FLOOR,w:1500,h:100},{x:1580,y:FLOOR,w:900,h:100},{x:2520,y:FLOOR,w:1000,h:100},
    {x:3600,y:FLOOR,w:800,h:100},{x:4470,y:FLOOR,w:1000,h:100},{x:5520,y:FLOOR,w:1680,h:100},
    {x:520,y:500,w:220,h:22},{x:820,y:420,w:180,h:22},{x:1110,y:340,w:200,h:22},
    {x:1450,y:430,w:50,h:190},{x:1710,y:520,w:220,h:22},{x:2020,y:455,w:240,h:22},
    {x:2860,y:500,w:260,h:22},{x:3210,y:410,w:230,h:22},{x:3490,y:320,w:60,h:300},
    {x:3850,y:470,w:260,h:22},{x:4450,y:390,w:60,h:230},{x:4740,y:505,w:260,h:22},
    {x:5100,y:420,w:270,h:22},{x:5680,y:500,w:250,h:22},{x:6020,y:430,w:180,h:22}
  ];
  enemies = [
    foe('runner',850,FLOOR-44), foe('drone',1220,300), foe('runner',1820,FLOOR-44),
    foe('guard',2290,FLOOR-54), foe('drone',2920,390), foe('runner',3350,FLOOR-44),
    foe('sniper',3970,FLOOR-48), foe('guard',4680,FLOOR-54), foe('drone',5150,320),
    foe('runner',5600,FLOOR-44), boss(6590,FLOOR-110)
  ];
  shots=[]; particles=[]; texts=[];
  stars = Array.from({length:110},(_,i)=>({x:(i*577)%WORLD_W,y:40+((i*193)%430),s:1+(i%3),p:(i%7)/7}));
}
function foe(type,x,y){
  const cfg = {
    runner:[42,44,45], drone:[34,30,32], guard:[70,48,54], sniper:[48,42,48]
  }[type];
  return {type,x,y,w:cfg[1],h:cfg[2],hp:cfg[0],max:cfg[0],vx:0,vy:0,dir:-1,cd:.4,hit:0,dead:false,stun:0,flash:0,attackMark:0};
}
function boss(x,y){
  return {type:'boss',x,y,w:92,h:110,hp:420,max:420,vx:0,vy:0,dir:-1,cd:1.2,hit:0,dead:false,stun:0,flash:0,attackMark:0,phase:1};
}
function reset(){
  Object.assign(player,{x:120,y:FLOOR-58,px:120,py:FLOOR-58,vx:0,vy:0,dir:1,ground:true,coyote:0,jumpBuffer:0,airJump:1,wall:0,dashT:0,dashCd:0,hp:100,od:0,inv:0,attackT:0,attackStep:0,attackId:0,comboWindow:0,parryT:0,parryCd:0,overdrive:0,trail:[]});
  score=0; combo=0; comboTimer=0; camX=0; shake=0; flash=0; slow=1; slowTimer=0; hitStop=0; defeated=0; currentZone=-1; runStart=performance.now();
  initWorld(); updateHud(); showTech('READY // FIXED 60 HZ SIMULATION');
}
function startGame(){
  ensureAudio(); reset(); state='play'; title.classList.remove('show'); resultPanel.classList.remove('visible'); pausePanel.classList.remove('visible');
  hud.classList.remove('hidden'); if(matchMedia('(pointer: coarse)').matches) touch.classList.remove('hidden');
}
function endGame(win){
  state='result'; hud.classList.add('hidden'); touch.classList.add('hidden');
  const secs=((performance.now()-runStart)/1000).toFixed(1);
  const final = score + (win?2500:0);
  if(final>best){best=final;localStorage.neonRiftBest=best}
  $('#resultEyebrow').textContent=win?'RUN COMPLETE':'SIGNAL LOST';
  $('#resultTitle').textContent=win?'RIFT SEALED':'REBOOT REQUIRED';
  $('#resultStats').textContent=`SCORE ${String(final).padStart(6,'0')} • ${defeated} TARGETS • ${secs}s • BEST ${String(best).padStart(6,'0')}`;
  resultPanel.classList.add('visible'); sfx(win?'win':'hurt');
}
function togglePause(force){
  if(state!=='play'&&state!=='pause')return;
  state = force===false ? 'play' : force===true ? 'pause' : state==='play'?'pause':'play';
  pausePanel.classList.toggle('visible',state==='pause');
  touch.classList.toggle('hidden',state!=='play'||!matchMedia('(pointer: coarse)').matches);
}
function ensureAudio(){
  if(audio)return;
  const AC=window.AudioContext||window.webkitAudioContext; if(!AC)return;
  audio=new AC(); nextBeat=audio.currentTime+.1;
}
function tone(freq=220,dur=.08,type='square',gain=.035,slide=1){
  if(!audio)return;
  const o=audio.createOscillator(), g=audio.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,audio.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*slide),audio.currentTime+dur);
  g.gain.setValueAtTime(gain,audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+dur);
  o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime+dur);
}
function sfx(kind){
  if(kind==='jump') tone(280,.09,'square',.025,1.8);
  if(kind==='dash') tone(120,.12,'sawtooth',.03,3);
  if(kind==='hit'){tone(90,.07,'square',.05,.55);tone(540,.04,'triangle',.02,.6)}
  if(kind==='parry'){tone(780,.14,'triangle',.055,1.8);setTimeout(()=>tone(1180,.08,'sine',.035,1.15),30)}
  if(kind==='hurt') tone(110,.2,'sawtooth',.05,.45);
  if(kind==='od'){tone(160,.35,'sawtooth',.05,5);tone(80,.45,'square',.02,2)}
  if(kind==='win'){tone(330,.18,'triangle',.035,1.5);setTimeout(()=>tone(495,.24,'triangle',.04,1.5),140)}
}
function music(){
  if(!audio||state!=='play'||audio.currentTime<nextBeat)return;
  const bpm=player.overdrive>0?150:118, step=60/bpm/2;
  nextBeat+=step; beatStep=(beatStep+1)%8;
  if(beatStep%2===0) tone(55+(currentZone*9),.1,'sine',.012,.72);
  if(beatStep===4) tone(110,.04,'square',.006,.8);
}
function showTech(s){ techEl.textContent=s; techEl.dataset.t=String(performance.now()); }
function updateHud(){
  hpbar.style.width=Math.max(0,player.hp)+'%'; odbar.style.width=Math.min(100,player.od)+'%';
  scoreEl.textContent=String(score).padStart(6,'0');
  comboEl.textContent=combo>1?`${combo}x COMBO`:'';
  const b=enemies.find(e=>e.type==='boss'&&!e.dead);
  bossHud.classList.toggle('hidden',!(b&&player.x>5850));
  if(b) bossbar.style.width=(b.hp/b.max*100)+'%';
}
function zoneCheck(){
  let z=0; for(let i=0;i<zones.length;i++) if(player.x>=zones[i][0]) z=i;
  if(z!==currentZone){currentZone=z;zoneEl.textContent=zones[z][1];showTech(zones[z][2]);burst(player.x+player.w/2,player.y,18,z===3?'#ff3bd4':'#4ef7ff',140);sfx('dash')}
}
function press(name){
  if(name==='jump') input.jp=true;
  if(name==='attack') input.ap=true;
  if(name==='dash') input.dp=true;
  if(name==='parry') input.pp=true;
  if(name==='od') input.op=true;
}
function mapKey(code,down){
  const m={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',Space:'jump',KeyW:'jump',ArrowUp:'jump',KeyJ:'attack',KeyK:'dash',KeyL:'parry',KeyU:'od'};
  const a=m[code]; if(!a)return;
  if(down&&!input[a]) press(a); input[a]=down;
}
addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault(); if(e.code==='Escape'){togglePause();return} mapKey(e.code,true)});
addEventListener('keyup',e=>mapKey(e.code,false));
document.body.addEventListener('contextmenu',e=>e.preventDefault());

document.querySelectorAll('[data-hold]').forEach(b=>{
  const a=b.dataset.hold;
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);input[a]=true});
  const up=()=>input[a]=false; b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
});
document.querySelectorAll('[data-action]').forEach(b=>{
  const a=b.dataset.action;
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);if(!input[a])press(a);input[a]=true});
  const up=()=>input[a]=false;b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
});
$('#start').addEventListener('click',startGame); $('#again').addEventListener('click',startGame); $('#restart').addEventListener('click',startGame);
$('#pauseBtn').addEventListener('click',()=>togglePause(true)); $('#resume').addEventListener('click',()=>togglePause(false));

function gamepad(){
  const g=navigator.getGamepads?.()[0]; if(!g)return;
  const left=g.axes[0]<-.25||g.buttons[14]?.pressed, right=g.axes[0]>.25||g.buttons[15]?.pressed;
  input.left=!!left;input.right=!!right;
  const binds=[['jump',0],['attack',2],['dash',1],['parry',3],['od',5]];
  for(const [a,i] of binds){const d=!!g.buttons[i]?.pressed;if(d&&!input[a])press(a);input[a]=d}
}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
function closestGroundY(x,y,w){
  let best=9999;
  for(const p of platforms) if(x+w>p.x&&x<p.x+p.w&&p.y>=y&&p.y<best) best=p.y;
  return best;
}
function collidePlayer(){
  player.wall=0;player.ground=false;
  const prevBottom=player.py+player.h, prevTop=player.py, prevRight=player.px+player.w, prevLeft=player.px;
  for(const p of platforms){
    if(!overlap(player,p))continue;
    if(prevBottom<=p.y+4 && player.vy>=0){player.y=p.y-player.h;player.vy=0;player.ground=true;player.airJump=1}
    else if(prevTop>=p.y+p.h-4 && player.vy<0){player.y=p.y+p.h;player.vy=20}
    else if(prevRight<=p.x+4){player.x=p.x-player.w;player.vx=Math.min(0,player.vx);player.wall=1}
    else if(prevLeft>=p.x+p.w-4){player.x=p.x+p.w;player.vx=Math.max(0,player.vx);player.wall=-1}
  }
  if(player.x<0){player.x=0;player.vx=0} if(player.x>WORLD_W-player.w){player.x=WORLD_W-player.w;player.vx=0}
}
function beginAttack(){
  if(player.parryT>0||player.dashT>0)return;
  const chain = player.comboWindow>0 ? (player.attackStep+1)%3 : 0;
  player.attackStep=chain; player.attackT=[.23,.25,.36][chain]*(player.overdrive>0?.72:1); player.comboWindow=.42;
  player.attackId=attackSerial++; sfx('hit');
}
function attackBox(){
  const s=player.attackStep, reach=[62,72,102][s], h=[48,54,70][s];
  return {x:player.dir>0?player.x+player.w-4:player.x-reach+4,y:player.y+5-(s===2?12:0),w:reach,h};
}
function doParry(target){
  if(player.parryT<=0)return false;
  player.parryT=0;player.parryCd=.25;player.od=Math.min(100,player.od+28);score+=180;combo++;comboTimer=1.8;slow=.23;slowTimer=.22;shake=Math.max(shake,14);flash=.3;
  if(target){target.stun=1.15;target.vx=-target.dir*170}
  burst(player.x+player.w/2,player.y+20,30,'#ffd35a',260);texts.push({x:player.x,y:player.y-20,t:0,life:.8,text:'PERFECT PARRY',c:'#ffd35a'});
  showTech('FRAME FEEL // PARRY → HIT STOP → TIME DILATION');sfx('parry');return true;
}
function hurtPlayer(dmg,kx=0){
  if(player.inv>0||player.dashT>0||player.overdrive>0)return;
  if(doParry(null))return;
  player.hp=Math.max(0,player.hp-dmg);player.inv=.75;player.vx=kx;player.vy=-250;shake=18;flash=.5;combo=0;comboTimer=0;
  burst(player.x+player.w/2,player.y+25,20,'#ff4d79',210);sfx('hurt');updateHud();if(player.hp<=0)setTimeout(()=>endGame(false),220);
}
function damageEnemy(e,dmg,kx=0){
  if(e.dead||e.attackMark===player.attackId)return;
  e.attackMark=player.attackId;e.hp-=dmg;e.flash=.12;e.hit=.16;e.stun=Math.max(e.stun,.12);e.vx+=kx;
  const crit=player.attackStep===2||player.overdrive>0; score+=crit?90:55;combo++;comboTimer=1.7;player.od=Math.min(100,player.od+(crit?9:6));
  const cx=e.x+e.w/2,cy=e.y+e.h/2; burst(cx,cy,crit?18:10,crit?'#ffd35a':'#4ef7ff',crit?240:160);
  texts.push({x:cx,y:cy-16,t:0,life:.65,text:String(dmg)+(crit?'!':''),c:crit?'#ffd35a':'#dffcff'});
  hitStop=reducedMotion?0:(crit?.065:.035);shake=Math.max(shake,crit?11:6);sfx('hit');
  if(e.hp<=0){e.dead=true;defeated++;score+=e.type==='boss'?2000:250;burst(cx,cy,e.type==='boss'?70:30,e.type==='boss'?'#ff3bd4':'#4ef7ff',e.type==='boss'?360:250);slow=.3;slowTimer=e.type==='boss'?1:.18;flash=.55;if(e.type==='boss')setTimeout(()=>endGame(true),700)}
  updateHud();
}
function burst(x,y,n,c,speed=150){
  if(reducedMotion)n=Math.ceil(n*.35);
  for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,sp=speed*(.25+Math.random()*.75);particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,g:80+Math.random()*180,life:.25+Math.random()*.55,max:.8,s:1+Math.random()*4,c})}
}
function updatePlayer(dt){
  player.px=player.x;player.py=player.y;
  if(player.inv>0)player.inv-=dt;if(player.dashCd>0)player.dashCd-=dt;if(player.parryCd>0)player.parryCd-=dt;
  if(player.overdrive>0){player.overdrive-=dt;if(player.overdrive<=0)showTech('OVERDRIVE COMPLETE // NORMAL TIME')}
  if(player.ground)player.coyote=.11;else player.coyote-=dt;
  if(input.jp)player.jumpBuffer=.12;else player.jumpBuffer-=dt;
  if(input.pp&&player.parryCd<=0&&player.attackT<=0){player.parryT=.18;player.parryCd=.55;showTech('DEFENSE // 180ms ACTIVE PARRY WINDOW')}
  if(player.parryT>0)player.parryT-=dt;
  if(input.op&&player.od>=100&&player.overdrive<=0){player.od=0;player.overdrive=5.5;player.inv=.45;flash=.7;shake=14;slow=.35;slowTimer=.28;burst(player.x+player.w/2,player.y+25,48,'#ffd35a',320);showTech('OVERDRIVE // SPEED + DAMAGE + INVULN BURST');sfx('od')}
  if(input.dp&&player.dashCd<=0){player.dashT=.16;player.dashCd=.48;player.vy=0;player.vx=player.dir*(player.overdrive>0?780:680);player.inv=.18;burst(player.x+player.w/2,player.y+30,15,'#4ef7ff',190);showTech('MOTION // AIR DASH + INVULNERABILITY FRAMES');sfx('dash')}
  if(input.ap&&player.attackT<=0)beginAttack();

  if(player.attackT>0){player.attackT-=dt;if(player.attackT<=0)player.comboWindow=.44}else player.comboWindow=Math.max(0,player.comboWindow-dt);
  if(player.dashT>0){
    player.dashT-=dt;player.vx=player.dir*(player.overdrive>0?780:680);player.vy=0;
    player.trail.push({x:player.x,y:player.y,a:.45});
  }else{
    const ax=player.overdrive>0?2100:1750, max=player.overdrive>0?460:360, drag=player.ground?11:4.5;
    const dir=(input.right?1:0)-(input.left?1:0);
    if(dir){player.dir=dir;player.vx+=dir*ax*dt;player.vx=Math.max(-max,Math.min(max,player.vx))}
    else player.vx*=Math.max(0,1-drag*dt);
    if(player.jumpBuffer>0){
      if(player.coyote>0){player.vy=-565;player.ground=false;player.coyote=0;player.jumpBuffer=0;burst(player.x+player.w/2,player.y+player.h,9,'#4ef7ff',100);sfx('jump')}
      else if(player.wall){player.vy=-525;player.vx=-player.wall*420;player.dir=-player.wall;player.jumpBuffer=0;showTech('PLATFORMING // WALL JUMP VECTOR REDIRECT');sfx('jump')}
      else if(player.airJump>0){player.airJump--;player.vy=-500;player.jumpBuffer=0;burst(player.x+player.w/2,player.y+player.h/2,14,'#ff3bd4',140);showTech('PLATFORMING // DOUBLE JUMP PARTICLE BURST');sfx('jump')}
    }
    const gravity=(input.jump&&player.vy<0)?1350:2050;player.vy+=gravity*dt;player.vy=Math.min(player.vy,900);
    if(player.wall&&!player.ground&&player.vy>170)player.vy=170;
  }
  player.x+=player.vx*dt;player.y+=player.vy*dt;collidePlayer();
  if(player.y>H+260){player.x=Math.max(80,player.x-280);player.y=120;player.vx=0;player.vy=0;hurtPlayer(18,0)}
  for(const t of player.trail)t.a-=dt*2.8;player.trail=player.trail.filter(t=>t.a>0);
  if(player.attackT>0){
    const ab=attackBox(); for(const e of enemies) if(!e.dead&&overlap(ab,e))damageEnemy(e,[12,16,28][player.attackStep]*(player.overdrive>0?1.55:1),player.dir*[150,220,420][player.attackStep]);
  }
}
function enemyShot(e,speed=340,spread=0){
  const dx=player.x-e.x,dy=(player.y+25)-(e.y+e.h/2),a=Math.atan2(dy,dx)+spread;
  shots.push({x:e.x+e.w/2,y:e.y+e.h/2,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:e.type==='boss'?9:6,life:4,owner:e,c:e.type==='boss'?'#ff3bd4':'#ff6b7a'});
}
function updateEnemies(dt){
  for(const e of enemies){
    if(e.dead)continue;if(e.flash>0)e.flash-=dt;if(e.hit>0)e.hit-=dt;if(e.stun>0){e.stun-=dt;e.x+=e.vx*dt;e.vx*=.9;continue}
    const dx=player.x-e.x, ad=Math.abs(dx);e.dir=dx>0?1:-1;e.cd-=dt;
    if(e.type==='drone'){
      e.y+=Math.sin(simTime*3+e.x*.01)*24*dt;
      if(ad<540&&e.cd<=0){enemyShot(e,320);e.cd=1.55}
    }else if(e.type==='sniper'){
      if(ad<720&&e.cd<=0){enemyShot(e,520);e.cd=2.0;showTech('AI // TELEGRAPHED RANGED ATTACK')}
    }else if(e.type==='runner'){
      if(ad<520&&ad>58)e.vx+=e.dir*650*dt;e.vx=Math.max(-170,Math.min(170,e.vx));e.x+=e.vx*dt;e.vx*=.96;
      if(ad<64&&e.cd<=0){if(player.parryT>0)doParry(e);else hurtPlayer(12,e.dir*260);e.cd=1}
    }else if(e.type==='guard'){
      if(ad<450&&ad>72)e.vx+=e.dir*420*dt;e.vx=Math.max(-105,Math.min(105,e.vx));e.x+=e.vx*dt;e.vx*=.95;
      if(ad<82&&e.cd<=0){if(player.parryT>0)doParry(e);else hurtPlayer(18,e.dir*330);e.cd=1.5}
    }else if(e.type==='boss'){
      e.phase=e.hp/e.max<.35?3:e.hp/e.max<.68?2:1;
      if(ad>150)e.x+=e.dir*(e.phase===3?95:60)*dt;
      if(e.cd<=0){
        if(ad<160){if(player.parryT>0)doParry(e);else hurtPlayer(24,e.dir*430);e.cd=e.phase===3?.72:1.1;shake=10}
        else {const n=e.phase;for(let i=0;i<n;i++)enemyShot(e,300+e.phase*45,(i-(n-1)/2)*.15);e.cd=e.phase===3?.85:1.25;showTech(`BOSS AI // PHASE ${e.phase} PATTERN`)}
      }
    }
  }
  for(const s of shots){
    s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;
    const pb={x:player.x,y:player.y,w:player.w,h:player.h},sb={x:s.x-s.r,y:s.y-s.r,w:s.r*2,h:s.r*2};
    if(s.life>0&&overlap(pb,sb)){
      if(player.parryT>0){doParry(s.owner);s.life=0;score+=70}
      else if(player.inv<=0&&player.dashT<=0){hurtPlayer(s.owner?.type==='boss'?16:10,s.vx*.45);s.life=0}
    }
  }
  shots=shots.filter(s=>s.life>0&&s.x>-100&&s.x<WORLD_W+100&&s.y>-100&&s.y<900);
}
function updateEffects(dt){
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.g*dt;p.life-=dt;p.vx*=.985}
  particles=particles.filter(p=>p.life>0);
  for(const t of texts){t.t+=dt;t.y-=35*dt}texts=texts.filter(t=>t.t<t.life);
  if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0}
  if(shake>0)shake=Math.max(0,shake-45*dt);if(flash>0)flash=Math.max(0,flash-2.7*dt);
}
function update(dt){
  gamepad();music();zoneCheck();
  if(hitStop>0){hitStop-=dt;return}
  if(slowTimer>0){slowTimer-=dt;if(slowTimer<=0)slow=1}
  const sd=dt*slow;simTime+=sd;updatePlayer(sd);updateEnemies(sd);updateEffects(sd);
  camX += ((player.x-W*.38)-camX)*Math.min(1,dt*5.5);camX=Math.max(0,Math.min(WORLD_W-W,camX));
  updateHud();
  input.jp=input.ap=input.dp=input.pp=input.op=false;
}
function line(x1,y1,x2,y2,c,w=1,a=1){ctx.globalAlpha=a;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.globalAlpha=1}
function drawBackground(){
  const z=currentZone<0?0:currentZone;
  const top=['#071121','#13091d','#06151a','#170818'][z],bot=['#02050b','#07030e','#020b0d','#08030b'][z];
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,top);g.addColorStop(1,bot);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  for(const s of stars){const sx=s.x-camX*(.08+s.p*.08);if(sx>-10&&sx<W+10){ctx.fillStyle=z===3?'#ff7bdf':'#89dfff';ctx.globalAlpha=.18+s.p*.35;ctx.fillRect(sx,s.y,s.s,s.s)}}
  ctx.globalAlpha=1;
  const gridOff=-(camX*.22)%80;ctx.strokeStyle=z===1?'rgba(255,59,212,.08)':'rgba(78,247,255,.07)';ctx.lineWidth=1;
  for(let x=gridOff;x<W;x+=80)line(x,160,x,H,ctx.strokeStyle);
  for(let y=180;y<H;y+=80)line(0,y,W,y,ctx.strokeStyle);
  for(let i=0;i<22;i++){const x=(i*137-camX*.35)%1500-100,h=70+((i*83)%230);ctx.fillStyle='rgba(20,35,64,.26)';ctx.fillRect(x,FLOOR-h,86,h);ctx.fillStyle='rgba(78,247,255,.09)';for(let yy=FLOOR-h+15;yy<FLOOR;yy+=24)ctx.fillRect(x+12,yy,3,7)}
  ctx.fillStyle='rgba(78,247,255,.04)';ctx.beginPath();ctx.arc(980,150,110,0,Math.PI*2);ctx.fill();
}
function drawPlatform(p){
  const x=p.x-camX;if(x>W+20||x+p.w<-20)return;
  ctx.fillStyle='#0b1220';ctx.fillRect(x,p.y,p.w,p.h);ctx.fillStyle='#17243d';ctx.fillRect(x,p.y,p.w,5);
  ctx.fillStyle=currentZone===3?'#ff3bd4':'#4ef7ff';ctx.globalAlpha=.35;ctx.fillRect(x,p.y,p.w,2);ctx.globalAlpha=1;
  if(p.h>30){ctx.fillStyle='rgba(255,255,255,.035)';for(let q=12;q<p.w;q+=42)ctx.fillRect(x+q,p.y+16,18,2)}
}
function drawPlayer(){
  const x=player.x-camX,y=player.y;
  for(const t of player.trail){ctx.globalAlpha=t.a;ctx.fillStyle='#4ef7ff';ctx.fillRect(t.x-camX,y+5,player.w,player.h-8)}ctx.globalAlpha=1;
  if(player.inv>0&&Math.floor(player.inv*24)%2===0)return;
  ctx.save();ctx.translate(x+player.w/2,y+player.h/2);ctx.scale(player.dir,1);
  if(player.overdrive>0){ctx.shadowBlur=24;ctx.shadowColor='#ffd35a'}
  if(player.parryT>0){ctx.strokeStyle='#ffd35a';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,42,-1.2,1.2);ctx.stroke()}
  ctx.fillStyle=player.overdrive>0?'#fff3b0':'#d9faff';ctx.fillRect(-9,-21,18,18);
  ctx.fillStyle='#121a35';ctx.fillRect(-12,-3,24,29);
  ctx.fillStyle='#ff3bd4';ctx.fillRect(-13,0,5,23);ctx.fillStyle='#4ef7ff';ctx.fillRect(8,0,5,23);
  ctx.fillStyle='#c9d7ff';ctx.fillRect(-10,26,7,22);ctx.fillRect(3,26,7,22);
  ctx.fillStyle='#08121d';ctx.fillRect(-3,-16,8,4);ctx.fillStyle='#4ef7ff';ctx.fillRect(2,-16,3,4);
  if(player.attackT>0){
    const s=player.attackStep, ang=[-.15,.25,-.7][s];ctx.rotate(ang);
    ctx.strokeStyle=s===2?'#ffd35a':'#4ef7ff';ctx.lineWidth=s===2?7:5;ctx.beginPath();ctx.moveTo(8,-2);ctx.lineTo(55+(s*14),-18-(s*8));ctx.stroke();
    ctx.globalAlpha=.25;ctx.lineWidth=18;ctx.stroke();ctx.globalAlpha=1;
  }else{ctx.strokeStyle='#7f90b8';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(10,-2);ctx.lineTo(32,-29);ctx.stroke()}
  ctx.restore();
}
function drawEnemy(e){
  if(e.dead)return;const x=e.x-camX,y=e.y;if(x<-150||x>W+150)return;
  ctx.save();ctx.translate(x+e.w/2,y+e.h/2);ctx.scale(e.dir,1);if(e.flash>0){ctx.shadowBlur=18;ctx.shadowColor='#fff'}
  if(e.type==='drone'){
    ctx.fillStyle=e.flash>0?'#fff':'#612c68';ctx.beginPath();ctx.moveTo(-22,0);ctx.lineTo(0,-15);ctx.lineTo(22,0);ctx.lineTo(0,15);ctx.closePath();ctx.fill();ctx.fillStyle='#ff3bd4';ctx.fillRect(4,-3,12,6)
  }else if(e.type==='boss'){
    ctx.fillStyle=e.flash>0?'#fff':'#24102e';ctx.fillRect(-38,-48,76,86);ctx.fillStyle='#ff3bd4';ctx.fillRect(-42,-35,8,62);ctx.fillRect(34,-35,8,62);ctx.fillStyle='#ffd35a';ctx.fillRect(10,-29,18,7);
    ctx.strokeStyle='rgba(255,59,212,.5)';ctx.lineWidth=4;ctx.strokeRect(-46,-56,92,102)
  }else{
    ctx.fillStyle=e.flash>0?'#fff':e.type==='guard'?'#26314c':'#2d1735';ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);
    ctx.fillStyle=e.type==='sniper'?'#ffd35a':'#ff5acb';ctx.fillRect(e.w/2-17,-e.h/2+10,12,5);
    if(e.type==='guard'){ctx.strokeStyle='#ff3bd4';ctx.lineWidth=4;ctx.strokeRect(-e.w/2-4,-e.h/2+4,e.w+8,e.h-8)}
  }
  ctx.restore();
  if(e.hp<e.max&&e.type!=='boss'){ctx.fillStyle='#250c20';ctx.fillRect(x,y-9,e.w,4);ctx.fillStyle='#ff3bd4';ctx.fillRect(x,y-9,e.w*(e.hp/e.max),4)}
}
function drawWorld(){
  const ox=reducedMotion?0:(Math.random()-.5)*shake,oy=reducedMotion?0:(Math.random()-.5)*shake;
  ctx.save();ctx.translate(ox,oy);drawBackground();platforms.forEach(drawPlatform);
  for(const s of shots){const x=s.x-camX;ctx.fillStyle=s.c;ctx.shadowBlur=14;ctx.shadowColor=s.c;ctx.beginPath();ctx.arc(x,s.y,s.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
  enemies.forEach(drawEnemy);drawPlayer();
  for(const p of particles){const a=Math.max(0,p.life/p.max);ctx.globalAlpha=Math.min(1,a*1.7);ctx.fillStyle=p.c;ctx.fillRect(p.x-camX,p.y,p.s,p.s)}
  ctx.globalAlpha=1;
  for(const t of texts){ctx.globalAlpha=1-t.t/t.life;ctx.fillStyle=t.c;ctx.font='900 17px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(t.text,t.x-camX,t.y)}ctx.globalAlpha=1;
  ctx.restore();
  const vig=ctx.createRadialGradient(W/2,H/2,180,W/2,H/2,720);vig.addColorStop(0,'rgba(0,0,0,0)');vig.addColorStop(1,'rgba(0,0,0,.48)');ctx.fillStyle=vig;ctx.fillRect(0,0,W,H);
  if(player.overdrive>0){ctx.fillStyle=`rgba(255,211,90,${.025+.018*Math.sin(simTime*12)})`;ctx.fillRect(0,0,W,H)}
  if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash*.22})`;ctx.fillRect(0,0,W,H)}
}
function drawTitleBg(){
  camX=(performance.now()*.035)%1200;currentZone=0;drawBackground();
  ctx.save();ctx.translate(W*.69,H*.54);ctx.rotate(-.12);ctx.strokeStyle='#4ef7ff';ctx.lineWidth=2;ctx.globalAlpha=.35;
  for(let i=0;i<8;i++){ctx.strokeRect(-120-i*13,-180-i*13,240+i*26,360+i*26)}ctx.restore();ctx.globalAlpha=1;
}
function render(){ctx.clearRect(0,0,W,H);if(state==='title')drawTitleBg();else drawWorld()}
function loop(now){
  const raw=Math.min(.05,(now-last)/1000);last=now;
  if(state==='play'){acc+=raw;let guard=0;while(acc>=1/60&&guard++<5){update(1/60);acc-=1/60}}
  render();frame++;requestAnimationFrame(loop);
}
addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')togglePause(true)});
addEventListener('resize',()=>{});
if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
initWorld();requestAnimationFrame(loop);
})();