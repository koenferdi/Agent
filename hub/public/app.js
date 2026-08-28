/* Validatiedesk — lokale werkomgeving voor de agents in deze workspace. */
(function(){
"use strict";
var W=400,H=232,SC=3;
var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

var PLACES = {
  "market-researcher":  {no:"01",place:"MARKTPOST",   x:78, y:74, col:"#4FD1C5", kind:"tower"},
  "customer-researcher":{no:"02",place:"KLANTHUIS",   x:78, y:176,col:"#F0A860", kind:"house"},
  "strategy-analyst":   {no:"03",place:"STRATEGIEHAL",x:322,y:74, col:"#A78BFA", kind:"hall"},
  "content-creator":    {no:"04",place:"CONTENTWERK", x:322,y:176,col:"#6B7A99", kind:"shop", offphase:true}
};
var HQ={no:"00",place:"HOOFDKWARTIER",x:200,y:118,col:"#F5C542"};
var STATUSES=["nieuw","opgepakt","geleverd","geparkeerd"];

var SAY = {
  idle:     ["Niks te doen.","Wacht op een opdracht.","Stil hier.","Klaar om te beginnen."],
  nieuw:    ["Er ligt een opdracht klaar!","Nog niet opgepakt.","Wachtend op Claude."],
  opgepakt: ["Bronnen aan het checken","Cijfers aan het narekenen","Concurrentie in kaart brengen","Bewijs aan het wegen"],
  geleverd: ["Rapport ligt in /drafts.","Klaar. Lees het na.","Oordeel geveld."],
  geparkeerd:["Stilgelegd.","Even geen werk hier."],
  offphase: ["Buiten deze fase.","Later pas aan de beurt."]
};

var S = { agents:[], drafts:[], desk:{briefs:[],decisions:[]} };
var sel = "market-researcher";
var view = "map";            // "map" | "hier"
var capSel = null;           // geselecteerde capaciteit in de hierarchie
var saveTimer=null, tick=0;

var DEPTS = [
  {id:"kennis",   label:"KENNIS"},
  {id:"aanbod",   label:"AANBOD"},
  {id:"markt",    label:"MARKT"},
  {id:"financien",label:"FINANCIEN"},
  {id:"operatie", label:"OPERATIE"}
];
var LADDER = [
  {id:"human-led",       lbl:"Human-led"},
  {id:"human-assisted",  lbl:"Human-assisted"},
  {id:"fully-autonomous",lbl:"Fully autonomous"}
];

/* ---------- helpers ---------- */
function el(id){return document.getElementById(id);}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function uid(){return Math.random().toString(36).slice(2,9);}
function place(id){return PLACES[id]||{no:"--",place:id.toUpperCase().slice(0,12),x:200,y:200,col:"#6B7A99",kind:"shop"};}
function briefsOf(id){return S.desk.briefs.filter(function(b){return b.agent===id;});}
function statusOf(id){
  if(place(id).offphase) return "offphase";
  var bs=briefsOf(id);
  if(!bs.length) return "idle";
  if(bs.some(function(b){return b.status==="opgepakt";})) return "opgepakt";
  if(bs.some(function(b){return b.status==="nieuw";})) return "nieuw";
  if(bs.some(function(b){return b.status==="geleverd";})) return "geleverd";
  return "geparkeerd";
}
function pill(t,tone){var e=el("conn");e.textContent=t;if(tone)e.dataset.t=tone;else delete e.dataset.t;}

/* ---------- api ---------- */
function load(){
  return fetch("/api/state").then(function(r){return r.json();}).then(function(d){
    S=d; if(!S.desk) S.desk={briefs:[],decisions:[]}; if(!S.capabilities) S.capabilities=[];
    if(!S.agents.some(function(a){return a.id===sel;}) && S.agents.length) sel=S.agents[0].id;
    pill(S.agents.length+" agents · "+S.drafts.length+" rapporten","ok");
    renderAll();
  }).catch(function(e){ pill("server niet bereikbaar","err"); console.error(e); });
}
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(function(){
    fetch("/api/desk",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(S.desk)})
      .then(function(r){ if(!r.ok) throw 0; pill("opgeslagen","ok");
        setTimeout(function(){pill(S.agents.length+" agents · "+S.drafts.length+" rapporten","ok");},1400); })
      .catch(function(){ pill("opslaan mislukt","err"); });
  },220);
}

/* ---------- pixelkaart ---------- */
var base=null, ctx=null, cv=null;
function rnd(seed){var s=seed;return function(){s=(s*1664525+1013904223)%4294967296;return s/4294967296;};}

function drawBase(){
  base=document.createElement("canvas"); base.width=W; base.height=H;
  var g=base.getContext("2d");
  function px(x,y,w,h,c){g.fillStyle=c;g.fillRect(x|0,y|0,w|0,h|0);}
  px(0,0,W,H,"#16311F");
  var r=rnd(97);
  for(var y=0;y<H;y+=2)for(var x=0;x<W;x+=2){var v=r();
    if(v>0.86)px(x,y,2,2,"#1B3A26");else if(v>0.72)px(x,y,2,2,"#193523");else if(v<0.06)px(x,y,2,2,"#12291A");}
  function path(x,y,w,h){
    px(x,y,w,h,"#6E6450");px(x,y,w,1,"#7E7460");px(x,y+h-1,w,1,"#5B5341");
    var rr=rnd(x*31+y*17);
    for(var i=0;i<w*h/9;i++)px(x+((rr()*w)|0),y+((rr()*h)|0),1,1,rr()>0.5?"#7A7059":"#645B48");
  }
  path(0,112,W,12);path(194,0,12,H);
  path(72,74,12,42);path(72,120,12,60);path(316,74,12,42);path(316,120,12,60);
  path(78,68,244,8);path(78,178,244,8);
  px(150,150,34,20,"#17384F");px(152,152,30,16,"#1E4A66");px(154,154,26,12,"#25597A");
  var tr=rnd(2024);
  function tree(x,y,big){var h2=big?9:7,w2=big?9:7;
    px(x+((w2/2)|0),y+h2,1,3,"#3A2A1C");
    px(x,y+2,w2,h2-2,"#14472C");px(x+1,y,w2-2,h2,"#1A5636");px(x+2,y+1,w2-4,3,"#227046");}
  var spots=Object.keys(PLACES).map(function(k){return PLACES[k];}).concat([HQ]);
  for(var i=0;i<150;i++){
    var tx=(tr()*(W-12))|0,ty=(tr()*(H-16))|0;
    var onPath=(ty>106&&ty<128)||(tx>188&&tx<212)||(tx>66&&tx<90&&ty>68&&ty<186)
      ||(tx>310&&tx<334&&ty>68&&ty<186)||(ty>62&&ty<80&&tx>72&&tx<328)||(ty>172&&ty<192&&tx>72&&tx<328);
    var onPond=(tx>142&&tx<192&&ty>142&&ty<176), onB=false;
    for(var k=0;k<spots.length;k++){var a=spots[k];
      if(tx>a.x-34&&tx<a.x+34&&ty>a.y-32&&ty<a.y+28)onB=true;}
    if(!onPath&&!onB&&!onPond)tree(tx,ty,tr()>0.6);
  }
  return g;
}

function buildings(g){
  function px(x,y,w,h,c){g.fillStyle=c;g.fillRect(x|0,y|0,w|0,h|0);}
  function shadow(x,y,w,h){px(x+3,y+h,w-4,3,"rgba(0,0,0,.4)");}
  function wall(x,y,w,h){px(x,y,w,h,"#2A2740");px(x+1,y,w-2,h-1,"#3A3556");
    px(x+1,y,w-2,2,"#474169");px(x+1,y+h-3,w-2,2,"#2E2A46");}
  function pitch(x,y,w,h,col){for(var i=0;i<h;i++){var ins=Math.round(i*(w/2-2)/h);
    px(x+ins,y+h-1-i,w-ins*2,1,i===h-1?"#EFF4FF":col);}}
  function wins(x,y,w,h,lit,seed,sx,sy){var wr=rnd(seed);
    for(var wy=y;wy<y+h;wy+=sy)for(var wx=x;wx<x+w-2;wx+=sx){
      var on=lit&&wr()>0.3;px(wx,wy,3,4,on?"#F4CE76":"#221F36");if(on)px(wx,wy,3,1,"#FFF0C0");}}
  function door(cx,b,lit){px(cx-3,b-9,6,9,"#241F36");if(lit)px(cx-2,b-8,4,8,"#8A6A2E");}
  function beacon(cx,t,col,on){px(cx-1,t-9,2,9,"#5A5478");px(cx-2,t-12,5,3,on?col:"#3E4A63");}
  function crate(x,y){px(x,y,6,5,"#4A3B2A");px(x+1,y+1,4,3,"#5D4A34");px(x,y+2,6,1,"#3A2E20");}

  Object.keys(PLACES).forEach(function(id){
    var a=PLACES[id],lit=!a.offphase,cx=a.x,b=a.y+22,seed=a.x*7+a.y;
    if(a.kind==="tower"){
      var x=cx-12,h=40,y=b-h;shadow(x,y,24,h);wall(x,y,24,h);wins(x+5,y+7,16,h-16,lit,seed,8,10);
      var px0=cx-18,py=y-9;shadow(px0,py,36,9);wall(px0,py,36,9);px(px0,py,36,2,a.col);
      wins(px0+5,py+3,27,4,lit,seed+3,9,6);pitch(px0-2,py-10,40,10,a.col);
      door(cx,b,lit);beacon(cx,py-10,a.col,lit);
      a._chimney=null; a._top=py-20;
    } else if(a.kind==="house"){
      var x2=cx-23,h2=26,y2=b-h2;shadow(x2,y2,46,h2);wall(x2,y2,46,h2);
      wins(x2+6,y2+6,35,h2-15,lit,seed,11,10);pitch(x2-3,y2-15,52,15,a.col);
      px(x2+33,y2-24,5,10,"#4A4460");px(x2+32,y2-26,7,3,"#5A5478");
      door(cx,b,lit);crate(x2-9,b-5);crate(x2-9,b-10);crate(x2+49,b-5);
      a._chimney={x:x2+35,y:y2-26}; a._top=y2-15;
    } else if(a.kind==="hall"){
      var x3=cx-28,h3=30,y3=b-h3;shadow(x3,y3,56,h3);wall(x3,y3,56,h3);
      for(var c=x3+5;c<x3+52;c+=9){px(c,y3+4,3,h3-10,"#4B4569");px(c,y3+4,1,h3-10,"#5A5480");}
      wins(x3+6,y3+8,44,6,lit,seed,9,9);
      px(x3-3,y3-7,62,7,a.col);px(x3-3,y3-7,62,1,"#EFF4FF");pitch(x3-3,y3-17,62,10,a.col);
      door(cx,b,lit);beacon(cx,y3-17,a.col,lit);
      a._chimney=null; a._top=y3-27;
    } else {
      var x4=cx-23,h4=27,y4=b-h4;shadow(x4,y4,46,h4);wall(x4,y4,46,h4);
      wins(x4+6,y4+8,35,h4-16,lit,seed,11,9);
      for(var t=0;t<3;t++)pitch(x4+t*16,y4-9,16,9,a.col);
      px(x4+3,y4-19,5,11,"#403B54");px(x4+2,y4-21,7,3,"#4E4866");
      door(cx,b,lit);
      a._chimney=lit?{x:x4+5,y:y4-21}:null; a._top=y4-19;
    }
  });
  /* HQ */
  var cx=HQ.x,b=HQ.y+24,x=cx-31,h=32,y=b-h;
  shadow(x,y,62,h);wall(x,y,62,h);wins(x+6,y+7,50,h-15,true,11,9,10);
  px(x-3,y-6,68,6,HQ.col);px(x-3,y-6,68,1,"#FFF6D8");
  var tx=cx-12,ty=y-26;shadow(tx,ty,24,20);wall(tx,ty,24,20);wins(tx+5,ty+5,15,8,true,29,8,9);
  pitch(tx-3,ty-11,30,11,HQ.col);px(cx-1,ty-21,2,10,"#6A6488");px(cx-4,ty-24,9,3,HQ.col);
  door(cx,b,true);
  HQ._top=ty-24;
  px(194,150,12,8,"#3C3856");px(196,151,8,6,"#2A5C7C");px(199,147,2,5,"#5FA0C4");
}

var LAMPS=[];
function initLamps(){
  LAMPS=[];
  Object.keys(PLACES).forEach(function(id){var a=PLACES[id];
    LAMPS.push({x:a.x-33,y:a.y+18,on:!a.offphase});
    LAMPS.push({x:a.x+33,y:a.y+18,on:!a.offphase});});
  LAMPS.push({x:HQ.x-42,y:HQ.y+20,on:true},{x:HQ.x+42,y:HQ.y+20,on:true},
    {x:200,y:58,on:true},{x:200,y:188,on:true},{x:120,y:118,on:true},{x:280,y:118,on:true});
}

var smoke=[], flies=[];
function initParticles(){
  flies=[];
  for(var i=0;i<14;i++)flies.push({x:Math.random()*W,y:60+Math.random()*120,
    a:Math.random()*6.3,sp:.15+Math.random()*.25,ph:Math.random()*6.3});
}

function frame(){
  tick++;
  var g=ctx;
  g.setTransform(SC,0,0,SC,0,0);
  g.imageSmoothingEnabled=false;
  g.drawImage(base,0,0);
  function px(x,y,w,h,c){g.fillStyle=c;g.fillRect(x|0,y|0,w|0,h|0);}

  /* water shimmer */
  var wt=tick*0.05;
  for(var i=0;i<4;i++){
    var sx=156+((Math.sin(wt+i*1.7)*8+8)|0), sy=155+i*4;
    px(sx,sy,6,1,"rgba(140,200,230,.30)");
  }
  /* lampen met pulserende gloed */
  LAMPS.forEach(function(l,i){
    px(l.x,l.y,1,7,"#4A4560");
    px(l.x-1,l.y-3,3,3,l.on?"#FFD98A":"#3A4055");
    if(l.on){
      var p=REDUCED?0.10:0.085+Math.sin(tick*0.035+i)*0.025;
      g.fillStyle="rgba(255,217,138,"+p.toFixed(3)+")";
      g.beginPath();g.arc(l.x,l.y-2,9,0,6.3);g.fill();
    }
  });
  /* schoorsteenrook bij actieve agents */
  if(!REDUCED && tick%7===0){
    Object.keys(PLACES).forEach(function(id){
      var a=PLACES[id],st=statusOf(id);
      if(a._chimney && (st==="opgepakt"||st==="nieuw"||st==="geleverd"))
        smoke.push({x:a._chimney.x,y:a._chimney.y,life:0,dx:(Math.random()-.5)*.25});
    });
  }
  smoke=smoke.filter(function(s){return s.life<46;});
  smoke.forEach(function(s){
    s.life++;s.y-=0.32;s.x+=s.dx;
    var al=(1-s.life/46)*0.36, sz=1+Math.floor(s.life/13);
    g.fillStyle="rgba(200,208,225,"+al.toFixed(3)+")";
    g.fillRect(s.x|0,s.y|0,sz,sz);
  });
  /* vuurvliegjes */
  if(!REDUCED) flies.forEach(function(f){
    f.a+=0.02;f.x+=Math.cos(f.a)*f.sp;f.y+=Math.sin(f.a*0.7)*f.sp*0.6;
    if(f.x<4)f.x=W-4; if(f.x>W-4)f.x=4;
    var al=0.22+Math.sin(tick*0.06+f.ph)*0.20;
    if(al>0.04){g.fillStyle="rgba(245,225,150,"+al.toFixed(3)+")";g.fillRect(f.x|0,f.y|0,1,1);}
  });
  /* vignette */
  var grd=g.createRadialGradient(W/2,H/2,60,W/2,H/2,250);
  grd.addColorStop(0,"rgba(0,0,0,0)");grd.addColorStop(1,"rgba(0,0,0,.45)");
  g.fillStyle=grd;g.fillRect(0,0,W,H);
  requestAnimationFrame(frame);
}

function setupMap(){
  cv=el("map");cv.width=W*SC;cv.height=H*SC;ctx=cv.getContext("2d");
  var g=drawBase();buildings(g);initLamps();initParticles();
  requestAnimationFrame(frame);
}

/* ---------- wolkjes + klikvlakken ---------- */
function bubbleText(id){
  var st=statusOf(id), lines=SAY[st]||SAY.idle;
  var bs=briefsOf(id);
  if(st==="opgepakt"){
    var b=bs.filter(function(x){return x.status==="opgepakt";})[0];
    var base=lines[Math.floor(tick/240)%lines.length];
    return base+'<span class="dots">'+".".repeat(1+Math.floor(Date.now()/500)%3)+'</span>';
  }
  if(st==="geleverd"){
    var d=bs.filter(function(x){return x.status==="geleverd"&&x.draft;})[0];
    if(d) return "Rapport klaar. Klik om te lezen.";
  }
  if(st==="nieuw"){
    var n=bs.filter(function(x){return x.status==="nieuw";})[0];
    if(n) return "Opdracht klaar: "+esc(n.topic.slice(0,42))+(n.topic.length>42?"…":"");
  }
  return lines[Math.floor(tick/300)%lines.length];
}

function updateBubbles(){        // alleen tekst en status, geen DOM vervangen
  S.agents.forEach(function(a){
    var b=document.querySelector('.bub[data-pick="'+a.id+'"]');
    if(!b) return;
    var st=statusOf(a.id);
    if(b.dataset.s!==st) b.dataset.s=st;
    var say=b.querySelector(".say"), txt=bubbleText(a.id);
    if(say && say.innerHTML!==txt) say.innerHTML=txt;
  });
}

var bubbledOnce=false;
function renderMapOverlay(){
  var bw=el("bubbles"), hw=el("hits");
  bw.innerHTML="";hw.innerHTML="";
  S.agents.forEach(function(a){
    var p=place(a.id), st=statusOf(a.id);
    var top=(p.kind==="tower"?p.y-52:(p.kind==="hall"?p.y-34:p.y-32));
    var b=document.createElement("div");
    b.className="bub"+(bubbledOnce?"":" pop"); b.dataset.s=st; b.dataset.pick=a.id;
    b.style.left=(p.x/W*100).toFixed(2)+"%";
    b.style.top=(top/H*100).toFixed(2)+"%";
    b.innerHTML='<div class="box"><span class="who">'+esc(p.no+" "+p.place)+'</span>'
      +'<span class="say">'+bubbleText(a.id)+'</span></div>';
    bw.appendChild(b);

    var hit=document.createElement("button");
    hit.className="hit";hit.dataset.pick=a.id;
    hit.setAttribute("aria-pressed", sel===a.id?"true":"false");
    hit.setAttribute("aria-label", p.place+" openen");
    hit.style.left=(p.x/W*100).toFixed(2)+"%";
    hit.style.top=((p.y+4)/H*100).toFixed(2)+"%";
    hit.style.width=(58/W*100).toFixed(2)+"%";
    hit.style.height=(52/H*100).toFixed(2)+"%";
    hit.innerHTML='<span class="ring"></span>';
    hw.appendChild(hit);
  });
  var hq=document.createElement("div");
  hq.className="bub";hq.style.left=(HQ.x/W*100).toFixed(2)+"%";
  hq.style.top=((HQ.y-60)/H*100).toFixed(2)+"%";
  hq.innerHTML='<div class="box"><span class="who">00 HOOFDKWARTIER</span>'
    +'<span class="say">Fase 1 · Valideren</span></div>';
  bw.appendChild(hq);
  bubbledOnce=true;
}

/* ---------- panelen ---------- */
function briefCard(b){
  var h='<article class="card"><h3>'+esc(b.topic)+'</h3>'
    +'<div class="meta"><div><b>Geografie</b>'+esc(b.geo||"—")+'</div>'
    +'<div><b>Beslissing die dit dient</b>'+esc(b.decision||"—")+'</div></div>';
  if(b.findings&&b.findings.length){
    h+='<div class="findings">';
    b.findings.forEach(function(f){
      h+='<div class="finding"><span class="chip '+esc(f.confidence)+'">'+esc(f.confidence)+'</span>'
        +'<div><p>'+esc(f.text)+'</p><div class="src">'+esc(f.sources||"geen bron genoteerd")+'</div></div></div>';
    });
    h+='</div>';
  }
  h+='<div class="tools"><span class="chip '+esc(b.status)+'">'+esc(b.status)+'</span>'
    +'<select class="inline" data-status="'+b.id+'">';
  STATUSES.forEach(function(s){h+='<option value="'+s+'"'+(s===b.status?" selected":"")+'>'+s+'</option>';});
  h+='</select>';
  if(b.draft) h+='<button data-read="'+esc(b.draft)+'">rapport lezen</button>';
  h+='<button class="quiet" data-addf="'+b.id+'">+ bevinding</button>'
    +'<button class="quiet" data-del="'+b.id+'">verwijderen</button></div></article>';
  return h;
}

function renderPanel(){
  var a=S.agents.filter(function(x){return x.id===sel;})[0];
  if(!a){el("panel").innerHTML="";return;}
  var p=place(a.id),bs=briefsOf(a.id),st=statusOf(a.id);
  var h='<section class="panel"><h2>'+esc(p.no+" "+p.place)+'</h2><div class="body">'
    +'<div class="ahead"><div class="badge" style="background:'+p.col+'">'+esc(p.no)+'</div>'
    +'<div><div class="nm">'+esc(a.id)+'</div>'
    +'<div class="rl">'+esc(a.description.slice(0,240))+'</div>'
    +'<div class="fl">'+esc(a.file)+' · model '+esc(a.model)+' · '+a.tools.length+' tools</div>'
    +'<div class="tools"><span class="chip '+(st==="offphase"?"idle":st)+'">'+esc(st)+'</span></div>'
    +'</div></div>';
  if(p.offphase){
    h+='<div class="empty"><b>Deze agent staat stil.</b> Hij hoort bij een latere fase.</div>';
  } else if(!bs.length){
    h+='<div class="empty"><b>Nog geen opdracht.</b> Onderzoek start pas als onderwerp, '
      +'geografie en de te nemen beslissing vaststaan.</div>';
  } else {
    h+='<div class="stack">';bs.forEach(function(b){h+=briefCard(b);});h+='</div>';
  }
  if(!p.offphase){
    h+='<details class="adder"><summary>Opdracht voor '+esc(p.place.toLowerCase())+'</summary><div class="body">'
      +'<div class="grid2">'
      +'<div class="full"><label for="f-topic">Onderwerp of probleemgebied</label>'
      +'<input id="f-topic" placeholder="Afgebakend, niet een hele categorie"></div>'
      +'<div><label for="f-geo">Geografie</label><input id="f-geo" placeholder="Nederland"></div>'
      +'<div><label for="f-dec">Welke beslissing dient dit?</label><input id="f-dec" placeholder="Stap ik hier in?"></div>'
      +'<div class="full"><button class="primary" id="f-add">Toevoegen</button></div></div></div></details>';
  }
  el("panel").innerHTML=h+'</div></section>';
}

function renderSide(){
  var open=S.desk.decisions.filter(function(d){return !d.resolved;});
  var done=S.desk.decisions.filter(function(d){return d.resolved;});
  var h='<section class="panel"><h2>NU AAN JOU</h2><div class="body">';
  if(!open.length) h+='<div class="empty"><b>Geen openstaande beslissingen.</b></div>';
  else{
    h+='<div class="stack">';
    open.forEach(function(d){
      h+='<div class="card dec"><h3>'+esc(d.question)+'</h3>'
        +'<p style="margin:7px 0 0;font-size:13px;color:var(--ink-soft)">'+esc(d.context)+'</p>'
        +'<div class="tools"><input data-ans="'+d.id+'" placeholder="Jouw besluit" style="flex:1;min-width:160px">'
        +'<button class="primary" data-resolve="'+d.id+'">Vastleggen</button></div></div>';
    });
    h+='</div>';
  }
  if(done.length){
    h+='<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--ink-soft);font-size:13px">'
      +done.length+' besloten</summary><div class="stack" style="margin-top:9px">';
    done.forEach(function(d){h+='<div class="card"><div class="meta"><div><b>'+esc(d.question)+'</b>'
      +esc(d.answer||"—")+'</div></div></div>';});
    h+='</div></details>';
  }
  h+='</div></section>';

  h+='<section class="panel"><h2>RAPPORTEN IN /DRAFTS</h2><div class="body">';
  if(!S.drafts.length) h+='<div class="empty"><b>Nog geen rapporten.</b> Wat een agent oplevert komt hier vanzelf te staan.</div>';
  else S.drafts.forEach(function(d){
    var v=d.meta.verdict||"", c=d.meta.confidence||"";
    h+='<div class="rep" data-read="'+esc(d.file)+'"><div style="flex:1">'
      +'<div class="rt">'+esc(d.title)+'</div>'
      +'<div class="rm">'+esc(d.file)+' · '+d.words+' woorden</div>'
      +(v?'<div class="tools" style="margin-top:7px"><span class="chip geleverd">'+esc(v.slice(0,46))+'</span>'
        +(c?'<span class="chip '+(/laag/i.test(c)?"laag":/midden/i.test(c)?"midden":"hoog")+'">'+esc(c.slice(0,34))+'</span>':'')
        +'</div>':'')
      +'</div></div>';
  });
  h+='</div></section>';

  h+='<section class="panel"><h2>HOE DIT WERKT</h2><div class="body howto">'
    +'<ol><li>Jij zet een <b>opdracht</b> bij een gebouw neer.</li>'
    +'<li>Je zegt tegen Claude: <b>lees de validatiedesk</b>.</li>'
    +'<li>Claude draait de agent en schrijft het rapport naar <code>drafts/</code>.</li>'
    +'<li>Ververs deze pagina — het rapport staat er dan gewoon in.</li></ol>'
    +'<p class="note">Deze pagina leest je echte bestanden, maar start de agents niet zelf. '
    +'Die draaien in Claude Code. De rook boven een schoorsteen betekent dat er werk openstaat, '
    +'niet dat er nu iets rekent.</p></div></section>';
  el("side").innerHTML=h;
}

function capsOf(dep){ return S.capabilities.filter(function(c){return c.department===dep;}); }
function capByName(n){ return S.capabilities.filter(function(c){return c.name===n;})[0]; }

function renderHierarchy(){
  var h='<div class="lane">'
    +'<div class="node op"><span class="lbl">OPERATOR</span>'
    +'<div class="nam">jij</div><div class="sub">Beslist. Keurt goed. Voert de gesprekken die een agent niet kan voeren.</div></div>'
    +'<div class="drop"></div>'
    +'<div class="node cond"><span class="lbl">CONDUCTOR</span>'
    +'<div class="nam">deze Claude Code-sessie</div>'
    +'<div class="sub">Leest de opdracht, kiest de agent, schrijft het resultaat naar <code>drafts/</code>. '
    +'Geen apart programma — de sessie waarin je nu typt.</div></div>'
    +'<div class="drop"></div><div class="deps">';
  DEPTS.forEach(function(d){
    var caps=capsOf(d.id);
    h+='<div class="dep"><h3>'+esc(d.label)+'</h3>';
    if(!caps.length) h+='<div class="cap planned"><div class="t">—</div></div>';
    caps.forEach(function(c){
      var who = c.done_by || "geen agent";
      h+='<button class="cap '+esc(c.status)+'" data-cap="'+esc(c.name)+'"'
        +' aria-pressed="'+(capSel===c.name?"true":"false")+'">'
        +'<div class="t">'+esc(c.title)+'</div>'
        +'<div class="m">'+esc(who)+'</div></button>';
    });
    h+='</div>';
  });
  h+='</div>'
    +'<p class="hier-note">Groen betekent gebouwd en bruikbaar. Grijs betekent gedeclareerd maar '
    +'niet bemand — die staan er zodat je de vorm ziet, niet omdat ze werken. Klik een capaciteit '
    +'voor de ladder en de SOP.</p></div>';
  return h;
}

function renderCapability(){
  var c = capSel ? capByName(capSel) : null;
  if(!c){
    return '<section class="panel"><h2>CAPACITEIT</h2><div class="body">'
      +'<div class="empty"><b>Kies een capaciteit.</b> Klik een blokje in de hiërarchie om te zien '
      +'wat het vervangt, hoeveel autonomie het heeft, wat jij nog doet en hoe de SOP loopt.</div>'
      +'</div></section>';
  }
  var h='<section class="panel"><h2>'+esc(c.title.toUpperCase())+'</h2><div class="body">'
    +'<div class="tools" style="margin:0 0 14px"><span class="chip '
    +(c.status==="live"?"geleverd":(c.status==="planned"?"idle":"geparkeerd"))+'">'+esc(c.status)+'</span>'
    +'<span class="chip nieuw">'+esc(c.department)+'</span></div>';

  h+='<div class="kv"><div class="row"><b>Wat het vervangt</b><p>'+esc(c.replaces||"—")+'</p></div>';

  h+='<div class="row"><b>De ladder</b></div></div><div class="ladder">';
  LADDER.forEach(function(r){
    var on = c.ladder===r.id;
    h+='<div class="rung'+(on?" on":"")+'"><span class="rl">'+esc(r.lbl)+'</span>'
      +'<span class="rt">'+(on?"Hier staat hij nu.":"")+'</span></div>';
  });
  h+='</div>';

  h+='<div class="kv">'
    +'<div class="row"><b>Wat jij nog doet</b><p>'+esc(c.human||"—")+'</p></div>'
    +'<div class="row"><b>Uitgevoerd door</b><p>'
      +(c.done_by?'<span class="tag">'+esc(c.done_by)+'</span>':"nog geen agent")
      +(c.runtime?' <span class="tag">'+esc(c.runtime)+'</span>':"")+'</p></div>';
  if(c.builds_on.length){
    h+='<div class="row"><b>Bouwt op</b><div class="tagrow">';
    c.builds_on.forEach(function(dep){
      var d=capByName(dep);
      var cls = d ? (d.status==="live"?"dep-ok":"dep-missing") : "";
      h+='<span class="tag '+cls+'">'+esc(dep)+(d&&d.status!=="live"?" · nog niet klaar":"")+'</span>';
    });
    h+='</div></div>';
  }
  if(c.breaks_into.length){
    h+='<div class="row"><b>Splitst op in</b><div class="tagrow">';
    c.breaks_into.forEach(function(t){h+='<span class="tag">'+esc(t)+'</span>';});
    h+='</div></div>';
  }
  h+='</div>';
  h+='<div class="sop"><h4>'+esc(c.file)+'</h4>'+md(c.body)+'</div>';
  return h+'</div></section>';
}

function renderAll(){
  var stage=document.querySelector(".stage"), mb=document.querySelector(".mapbox");
  var tabs=document.getElementById("tabs");
  if(tabs){
    tabs.querySelectorAll("button").forEach(function(b){
      b.setAttribute("aria-selected", b.dataset.view===view ? "true":"false");
    });
  }
  var hier=document.getElementById("hier");
  if(stage) stage.style.display = view==="map" ? "" : "none";
  if(hier){ hier.hidden = view!=="hier"; if(view==="hier") hier.innerHTML=renderHierarchy(); }
  var legend=document.querySelector(".legend");
  if(legend) legend.style.display = view==="map" ? "" : "none";

  if(view==="map"){ renderMapOverlay(); renderPanel(); }
  else { el("panel").innerHTML = renderCapability(); }
  renderSide();
}

/* ---------- markdown reader ---------- */
function md(src){
  var out=[],lines=src.split(/\r?\n/),inCode=false,listTag=null,para=[],liBuf=null;
  function inline(t){
    return esc(t)
      .replace(/`([^`]+)`/g,"<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function flushLi(){ if(liBuf!==null){ out.push("<li>"+inline(liBuf)+"</li>"); liBuf=null; } }
  function flushPara(){ if(para.length){ out.push("<p>"+inline(para.join(" "))+"</p>"); para=[]; } }
  function flushList(){ flushLi(); if(listTag){ out.push("</"+listTag+">"); listTag=null; } }
  function openList(tag){ if(listTag!==tag){ flushList(); out.push("<"+tag+">"); listTag=tag; } }
  lines.forEach(function(l){
    if(/^```/.test(l)){
      flushPara();flushList();
      if(inCode){out.push("</pre>");inCode=false;} else {out.push("<pre>");inCode=true;}
      return;
    }
    if(inCode){ out.push(esc(l)); return; }
    var ul=l.match(/^[-*]\s+(.*)$/);
    if(ul){ flushPara(); flushLi(); openList("ul"); liBuf=ul[1]; return; }
    var ol=l.match(/^\d+[.)]\s+(.*)$/);
    if(ol){ flushPara(); flushLi(); openList("ol"); liBuf=ol[1]; return; }
    var hm=l.match(/^(#{1,4})\s+(.*)$/);
    if(hm){ flushPara();flushList(); out.push("<h"+hm[1].length+">"+inline(hm[2])+"</h"+hm[1].length+">"); return; }
    if(!l.trim()){ flushPara();flushList(); return; }
    if(liBuf!==null){ liBuf += " " + l.trim(); return; }   // doorlopende regel hoort bij het vorige punt
    para.push(l.trim());
  });
  flushPara();flushList(); if(inCode)out.push("</pre>");
  return out.join("\n");
}
function openReader(file){
  fetch("/api/draft?f="+encodeURIComponent(file)).then(function(r){return r.json();}).then(function(d){
    if(d.error){alert(d.error);return;}
    el("reader-title").textContent="drafts/"+d.file;
    el("reader-body").innerHTML=md(d.content);
    el("reader").hidden=false;
  });
}

/* ---------- events ---------- */
document.addEventListener("click",function(e){
  var vt=e.target.closest("[data-view]");
  if(vt){ view=vt.dataset.view; renderAll(); return; }
  var cp=e.target.closest("[data-cap]");
  if(cp){ capSel=cp.dataset.cap; renderAll(); return; }
  var t=e.target.closest("[data-pick]");
  if(t){
    sel=t.dataset.pick;
    document.querySelectorAll(".hit").forEach(function(h){
      h.setAttribute("aria-pressed", h.dataset.pick===sel ? "true":"false");
    });
    renderPanel();
    return;
  }
  var rd=e.target.closest("[data-read]");
  if(rd){ openReader(rd.dataset.read); return; }
  if(e.target.id==="f-add"){
    var topic=el("f-topic").value.trim();
    if(!topic){el("f-topic").focus();return;}
    S.desk.briefs.unshift({id:uid(),agent:sel,topic:topic,
      geo:el("f-geo").value.trim(),decision:el("f-dec").value.trim(),
      status:"nieuw",findings:[]});
    save();renderAll();return;
  }
  var del=e.target.closest("[data-del]");
  if(del){ S.desk.briefs=S.desk.briefs.filter(function(b){return b.id!==del.dataset.del;});save();renderAll();return; }
  var af=e.target.closest("[data-addf]");
  if(af){
    var b=S.desk.briefs.filter(function(x){return x.id===af.dataset.addf;})[0];
    if(!b)return;
    var txt=prompt("Bevinding (een zin, feitelijk):");if(!txt)return;
    var conf=(prompt("Zekerheid: hoog, midden of laag?","midden")||"midden").toLowerCase();
    if(["hoog","midden","laag"].indexOf(conf)<0)conf="midden";
    b.findings.push({id:uid(),text:txt,confidence:conf,sources:prompt("Bron:")||""});
    save();renderAll();return;
  }
  var rs=e.target.closest("[data-resolve]");
  if(rs){
    var inp=document.querySelector('[data-ans="'+rs.dataset.resolve+'"]');
    var v=inp?inp.value.trim():"";if(!v){if(inp)inp.focus();return;}
    var d=S.desk.decisions.filter(function(x){return x.id===rs.dataset.resolve;})[0];
    if(d){d.resolved=true;d.answer=v;save();renderAll();}
    return;
  }
  if(e.target.id==="reader-close"||e.target.id==="reader"){ el("reader").hidden=true; return; }
  if(e.target.id==="refresh"){ load(); return; }
});
document.addEventListener("change",function(e){
  var sl=e.target.closest("[data-status]");
  if(sl){ var b=S.desk.briefs.filter(function(x){return x.id===sl.dataset.status;})[0];
    if(b){b.status=sl.value;save();renderAll();} }
});
document.addEventListener("keydown",function(e){ if(e.key==="Escape") el("reader").hidden=true; });

/* klok + wolkjes verversen */
setInterval(function(){
  var d=new Date();
  el("clock").textContent=d.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
},1000);
setInterval(function(){ if(view==="map") updateBubbles(); }, 2600);

setupMap();
load();
setInterval(load, 20000);
})();
