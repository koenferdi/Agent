/* Validatiedesk — lokale werkomgeving voor de agents in deze workspace.
 *
 * De vloer zit in /iso. Dit bestand doet de rest: panelen, hierarchie,
 * de lezer en het praten met de server.
 */
import { IsoBridge, metaVan, statusVanAgent, STATUS_LABEL } from "./iso/iso-bridge.js";
import { AGENT_COLOR, THEME } from "./iso/iso-theme.js";
import { ZONES as KAMERS } from "./iso/iso-map.js";
import { Sterrenkaart } from "./iso/sterrenkaart.js";

(function(){
"use strict";

var STATUSES=["nieuw","opgepakt","geleverd","geparkeerd"];
var SCOL = {
  idle:"var(--idle)", nieuw:"var(--wait)", opgepakt:"var(--busy)",
  geleverd:"var(--ok)", geparkeerd:"var(--idle)", offphase:"var(--idle)"
};
function statusLabel(s){ return STATUS_LABEL[s] || s; }

var S = { agents:[], drafts:[], desk:{briefs:[],decisions:[]}, capabilities:[] };
var sel = "market-researcher";
var view = "map";            // "map" | "hier"
var capSel = null;           // geselecteerde capaciteit in de hierarchie
var saveTimer=null;
var vloer = null;            // de IsoBridge
var sterren = null;          // de sterrenkaart, pas gebouwd als je het tabblad opent
var demoAan = false;
var modellen = { modellen:[], standaard:null, bron:null, sleutels:[] };
var run = null;              // { agentId, tekst, stappen[], bezig, stop }

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
function meta(id){ return metaVan(id, S.agents.findIndex(function(a){return a.id===id;})); }
function kleurVan(id){ return AGENT_COLOR[id] || THEME.busy; }
function briefsOf(id){return S.desk.briefs.filter(function(b){return b.agent===id;});}
function statusOf(id){ return statusVanAgent(S, id); }
function pill(t,tone){var e=el("conn");e.textContent=t;if(tone)e.dataset.t=tone;else delete e.dataset.t;}

/* ---------- api ---------- */
function load(){
  return fetch("/api/state").then(function(r){return r.json();}).then(function(d){
    S=d; if(!S.desk) S.desk={briefs:[],decisions:[]}; if(!S.capabilities) S.capabilities=[];
    if(!S.agents.some(function(a){return a.id===sel;}) && S.agents.length) sel=S.agents[0].id;
    pill(S.agents.length+" agents · "+S.drafts.length+" rapporten","ok");
    if(vloer) vloer.sync(S);
    if(sterren) sterren.setState(S);
    renderAll();
  }).catch(function(e){ pill("server niet bereikbaar","err"); console.error(e); });
}
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(function(){
    fetch("/api/desk",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(S.desk)})
      .then(function(r){ if(!r.ok) throw 0; pill("opgeslagen","ok");
        setTimeout(function(){pill(S.agents.length+" agents · "+S.drafts.length+" rapporten","ok");},1400);
        load(); })
      .catch(function(){ pill("opslaan mislukt","err"); });
  },220);
}

/* ---------- de vloer ---------- */
function setupVloer(){
  vloer = new IsoBridge(el("vloer"), {
    onSelect: function(id){ sel = id; markeerSelectie(); renderPanel(); },
    onFeed: function(regel){ feedRegel(regel); }
  });
  window.__vloer = vloer.office;   /* haak voor de browsertest */
}

/* ---------- modellen ---------- */
function laadModellen(ververs){
  return fetch("/api/modellen" + (ververs ? "?ververs=1" : ""))
    .then(function(r){return r.json();})
    .then(function(d){ modellen = d; if(view==="map") renderPanel(); return d; })
    .catch(function(){ /* de hub werkt ook zonder modellenlijst */ });
}

/* ---------- een agent laten draaien ---------- */
function startRun(agentId, opdracht, modelId){
  if(run && run.bezig) return;
  run = { agentId:agentId, tekst:"", stappen:[], bezig:true, fout:null, klaar:null };
  renderWerkbank();
  if(vloer) vloer.office.setStatus(agentId, "opgepakt");
  feedRegel({ tekst: meta(agentId).no + " " + meta(agentId).naam + " begint aan: " + opdracht.slice(0,60),
              id: agentId, soort:"echt", tijd:new Date() });

  var ctrl = new AbortController();
  run.stop = function(){ ctrl.abort(); };

  fetch("/api/run", { method:"POST", headers:{"content-type":"application/json"},
    signal: ctrl.signal,
    body: JSON.stringify({ agent:agentId, opdracht:opdracht, model:modelId }) })
  .then(function(r){
    var lezer = r.body.getReader(), dec = new TextDecoder(), rest = "";
    function lees(){
      return lezer.read().then(function(res){
        if(res.done){ eindig(); return; }
        rest += dec.decode(res.value, {stream:true});
        var delen = rest.split("\n\n"); rest = delen.pop();
        delen.forEach(function(blok){
          var regel = blok.split("\n").filter(function(l){return l.indexOf("data:")===0;})[0];
          if(!regel) return;
          var g; try{ g = JSON.parse(regel.slice(5).trim()); }catch(e){ return; }
          verwerk(g);
        });
        return lees();
      });
    }
    return lees();
  })
  .catch(function(e){
    if(e.name !== "AbortError") run.fout = String(e.message||e);
    eindig();
  });

  function verwerk(g){
    if(g.soort === "tekst"){ run.tekst += g.tekst; }
    else if(g.soort === "stap"){ run.stappen.push(g.tekst); }
    else if(g.soort === "fout"){ run.fout = g.tekst; }
    else if(g.soort === "klaar"){ run.klaar = g; }
    renderWerkbank(true);
  }
  function eindig(){
    run.bezig = false;
    if(run.klaar){
      if(vloer){
        vloer.office.setStatus(agentId, "geleverd");
        vloer.office.floater("+1 rapport", agentId, THEME.ok);
      }
      feedRegel({ tekst: meta(agentId).naam + " leverde " + run.klaar.bestand
        + " · " + (run.klaar.tokensIn + run.klaar.tokensUit) + " tokens"
        + (run.klaar.kosten != null ? " · $" + run.klaar.kosten.toFixed(4) : ""),
        id: agentId, soort:"echt", tijd:new Date() });
      load();
    } else if(run.fout){
      if(vloer) vloer.office.setStatus(agentId, "idle");
      feedRegel({ tekst: meta(agentId).naam + " liep vast: " + run.fout, id: agentId, soort:"echt", tijd:new Date() });
    }
    renderWerkbank();
  }
}

function renderWerkbank(alleenLog){
  var w = el("werklog"); if(!w) return;
  var h = run.stappen.map(function(s){ return '<div class="stap">' + esc(s) + '</div>'; }).join("");
  if(run.tekst) h += '<pre class="uitvoer">' + esc(run.tekst) + (run.bezig ? '<i class="cursor"></i>' : '') + '</pre>';
  if(run.fout) h += '<div class="stap fout">' + esc(run.fout) + '</div>';
  if(run.klaar) h += '<div class="stap ok">Klaar in ' + (run.klaar.duur/1000).toFixed(1) + ' s · '
    + (run.klaar.tokensIn + run.klaar.tokensUit) + ' tokens'
    + (run.klaar.kosten != null ? ' · $' + run.klaar.kosten.toFixed(4) : ' · kosten onbekend')
    + ' · <a href="#" data-read="' + esc(run.klaar.bestand) + '">rapport lezen</a></div>';
  w.innerHTML = h;
  w.scrollTop = w.scrollHeight;
  if(!alleenLog){
    var knop = el("runStart");
    if(knop){ knop.disabled = run.bezig; knop.textContent = run.bezig ? "Bezig…" : "Aan het werk zetten"; }
    var stopKnop = el("runStop"); if(stopKnop) stopKnop.hidden = !run.bezig;
  }
}

/* ---------- sleutels ---------- */
function toonSleutels(){
  var d = el("sleutelvenster");
  if(!d){
    d = document.createElement("div");
    d.id = "sleutelvenster"; d.className = "reader";
    document.body.appendChild(d);
  }
  var s = modellen.sleutels || [];
  d.innerHTML = '<div class="reader-box"><div class="reader-head">'
    + '<span class="mono">API-SLEUTELS</span>'
    + '<button id="sluitSleutels">sluiten</button></div>'
    + '<div class="reader-body"><p style="margin-top:0;font-size:13.5px;color:var(--ink-soft)">'
    + 'Een sleutel blijft op deze machine, in <code>sleutels.json</code> naast je workspace. '
    + 'Dat bestand staat buiten git en de hub stuurt hem nooit terug naar je browser — '
    + 'je ziet alleen de laatste vier tekens terug.</p>'
    + '<div class="stack">' + s.map(function(a){
        return '<div class="card"><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">'
          + '<b style="font-size:14.5px">' + esc(a.naam) + '</b>'
          + (a.heeft ? '<span class="chip geleverd">ingesteld ' + esc(a.staart) + '</span>'
                     : '<span class="chip idle">leeg</span>')
          + (a.bron === "omgeving" ? '<span class="chip nieuw">uit de omgeving</span>' : '')
          + '<a href="' + esc(a.aanmelden) + '" target="_blank" rel="noopener" '
          + 'style="margin-left:auto;font-size:12px;color:var(--gold)">sleutel halen ↗</a></div>'
          + '<p style="margin:6px 0 0;font-size:12.5px;color:var(--ink-soft)">' + esc(a.uitleg) + '</p>'
          + '<div class="tools"><input type="password" data-sleutel="' + esc(a.id) + '" '
          + 'placeholder="' + (a.heeft ? "vervangen of leegmaken" : "plak hier je sleutel") + '" '
          + 'autocomplete="off" style="flex:1;min-width:160px">'
          + '<button data-bewaar="' + esc(a.id) + '">Bewaren</button></div></div>';
      }).join("") + '</div>'
    + '<p class="note">Geen sleutel nodig: draai <code>ollama serve</code> op deze machine, '
    + 'dan verschijnen je lokale modellen vanzelf in de lijst.</p></div></div>';
  d.hidden = false;
}
document.addEventListener("click", function(e){
  if(e.target.id === "sluitSleutels" || e.target.id === "sleutelvenster"){
    var d = el("sleutelvenster"); if(d) d.hidden = true; return;
  }
  var b = e.target.closest("[data-bewaar]");
  if(b){
    var inp = document.querySelector('[data-sleutel="' + b.dataset.bewaar + '"]');
    b.disabled = true; b.textContent = "…";
    fetch("/api/sleutel", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ aanbieder: b.dataset.bewaar, sleutel: inp ? inp.value : "" }) })
      .then(function(r){return r.json();})
      .then(function(d){ modellen.sleutels = d.sleutels; return laadModellen(true); })
      .then(function(){ toonSleutels(); });
  }
});

/* ---------- sterrenkaart ---------- */
function setupSterren(){
  if(sterren) return;
  sterren = new Sterrenkaart(el("sterren"), {
    onSelect: function(k, cl){ sterKaart(k, cl); },
    onWissel: function(cl){ el("sNu").textContent = cl.label; el("sterkaart").classList.remove("aan"); }
  });
  el("sVorige").onclick = function(){ sterren.volgende(-1); };
  el("sVolgende").onclick = function(){ sterren.volgende(1); };
  el("sterkaartX").onclick = function(){ el("sterkaart").classList.remove("aan"); sterren.gekozen=null; };
}

function sterKaart(k, cl){
  var kaart=el("sterkaart");
  if(!k){ kaart.classList.remove("aan"); return; }
  var soort="", lijf="";
  if(k.soort==="tool"){
    soort="Gereedschap";
    lijf="<p>Gebruikt door de agents van "+esc(cl.label.toLowerCase())+". Staat in het veld "
      +"<code>runtime</code> van de capaciteit.</p>";
  } else if(k.leeg){
    soort="Lege plek";
    lijf="<p>Hier hoort een agent te staan. De capaciteit is beschreven maar niemand voert hem uit — "
      +"dat werk doe jij nu zelf.</p>";
  } else if(k.soort==="agent"){
    soort="Agent";
    var mijn=cl.caps.filter(function(c){return c.agent===k.agent.id;});
    lijf="<p>Model "+esc(k.agent.model)+" · "+k.agent.tools+" tools · "
      +(k.agent.werk? k.agent.werk+" opdracht"+(k.agent.werk>1?"en":"") : "geen opdracht")+".</p>"
      +"<p>Doet:</p><ul>"+mijn.map(function(c){return "<li>"+esc(c.titel)+"</li>";}).join("")+"</ul>";
    sel=k.agent.id; renderPanel();
  } else if(k.soort==="cap"){
    soort="Capaciteit";
    var c=k.cap;
    lijf=(c.vervangt?"<p><b>Vervangt:</b> "+esc(c.vervangt)+"</p>":"")
      +(c.mens?"<p><b>Jij doet:</b> "+esc(c.mens)+"</p>":"")
      +(c.stappen.length?"<p><b>Stappen</b></p><ul>"+c.stappen.map(function(x){return "<li>"+esc(x)+"</li>";}).join("")+"</ul>":"");
  } else {
    soort="Afdeling";
    lijf="<p>"+cl.agents.length+" agents, "+cl.caps.length+" capaciteiten, "+cl.tools.length+" stuks gereedschap.</p>";
  }
  el("sTitel").textContent=k.label;
  el("sSoort").textContent=soort;
  el("sLijf").innerHTML=lijf;
  kaart.classList.add("aan");
}

/* ---------- live-feed ---------- */
function feedRegel(r){
  var lijst = el("feedlijst"); if(!lijst) return;
  var tijd = r.tijd.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"});
  var kleur = r.id ? kleurVan(r.id) : "var(--ink-faint)";
  var d = document.createElement("div");
  d.className = "regel s-"+r.soort;
  d.innerHTML = '<span class="p" style="background:'+esc(kleur)+'"></span>'
    + '<time>'+esc(tijd)+'</time><span class="tx">'+esc(r.tekst)+'</span>'
    + (r.soort==="demo" ? '<span class="mrk">demo</span>' : "");
  lijst.prepend(d);
  while(lijst.children.length > 80) lijst.lastChild.remove();
}

function renderHud(){
  var h=el("hud"); if(!h) return;
  var werk=S.agents.filter(function(a){var st=statusOf(a.id);return st==="opgepakt"||st==="nieuw";}).length;
  var open=S.desk.briefs.filter(function(b){return b.status==="nieuw"||b.status==="opgepakt";}).length;
  var aanJou=S.desk.decisions.filter(function(d){return !d.resolved;}).length;
  h.innerHTML =
      'Agents <b class="busy">'+werk+'/'+S.agents.length+'</b> aan het werk'
    + '<span>Opdrachten <b>'+open+'</b> open</span>'
    + '<span>Rapporten <b class="ok">'+S.drafts.length+'</b></span>'
    + '<span>Aan jou <b class="'+(aanJou?"wait":"")+'">'+aanJou+'</b></span>';
}

/* De lopende band: alleen dingen die echt in de bestanden staan. */
function renderTicker(){
  var t=el("ticker"); if(!t) return;
  var items=[];
  S.drafts.forEach(function(d){
    var v=d.meta && d.meta.verdict ? " · " + d.meta.verdict : "";
    var c=d.meta && d.meta.confidence ? " · zekerheid " + d.meta.confidence : "";
    items.push({kleur:"var(--ok)", tekst:"RAPPORT <b>"+esc(d.title)+"</b>"+esc(v+c)});
  });
  S.desk.decisions.filter(function(d){return !d.resolved;}).forEach(function(d){
    items.push({kleur:"var(--wait)", tekst:"AAN JOU <b>"+esc(d.question)+"</b>"});
  });
  S.desk.briefs.forEach(function(b){
    var m=meta(b.agent);
    items.push({kleur:SCOL[b.status]||"var(--idle)",
      tekst:esc(m.no+" "+m.naam)+" <b>"+esc(b.topic)+"</b> · "+esc(b.status)});
  });
  S.capabilities.filter(function(c){return !c.done_by;}).forEach(function(c){
    items.push({kleur:"var(--idle)", tekst:"NOG GEEN AGENT <b>"+esc(c.title)+"</b> · "+esc(c.department)});
  });
  if(!items.length) items.push({kleur:"var(--idle)", tekst:"Nog niets te melden."});
  var rij=items.map(function(i){
    return '<i><s style="background:'+i.kleur+'"></s>'+i.tekst+'</i>';
  }).join("");
  var nieuw='<div class="baan">'+rij+rij+'</div>';
  if(t.dataset.inhoud !== rij){ t.innerHTML=nieuw; t.dataset.inhoud=rij; }
}

function renderKamers(){
  var k=el("kamers"); if(!k || k.dataset.klaar) return;
  k.innerHTML = KAMERS.map(function(z){
    return '<button data-kamer="'+z.name+'">'+esc(z.label)+'</button>';
  }).join("");
  k.dataset.klaar = "1";
}

function markeerSelectie(){
  if(vloer) vloer.select(sel);
  document.querySelectorAll(".mobstat button").forEach(function(h){
    h.setAttribute("aria-pressed", h.dataset.pick===sel ? "true":"false");
  });
}

function renderMobStat(){
  var m=el("mobstat"); if(!m) return;
  var h="";
  var sorted=S.agents.slice().sort(function(x,y){
    return meta(x.id).no.localeCompare(meta(y.id).no);
  });
  sorted.forEach(function(a){
    var p=meta(a.id), st=statusOf(a.id);
    var col=SCOL[st] || "var(--idle)";
    h+='<button data-pick="'+esc(a.id)+'" aria-pressed="'+(sel===a.id?"true":"false")+'">'
      +'<i style="background:'+col+'"></i>'
      +'<span class="no">'+esc(p.no)+'</span><span class="nm">'+esc(p.naam)+'</span>'
      +'<span class="st">'+esc(statusLabel(st))+'</span></button>';
  });
  m.innerHTML=h;
}

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

/* Het paneel waarin je een agent een opdracht geeft en meekijkt. */
function werkbank(agentId){
  var lijst = modellen.modellen || [];
  var keuze = (run && run.agentId===agentId ? run.model : null) || modellen.standaard;
  var opties = lijst.map(function(m){
    return '<option value="'+esc(m.id)+'"'+(m.id===keuze?" selected":"")+'>'
      + esc(m.naam) + ' · ' + esc(m.aanbieder) + (m.gratis?" · gratis":"") + '</option>';
  }).join("");
  var bezigHier = run && run.agentId === agentId;
  var h = '<div class="werkbank"><div class="wkop">Aan het werk zetten</div>';
  if(!lijst.length){
    h += '<div class="empty"><b>Nog geen model beschikbaar.</b> Zet een sleutel bij '
      + '<button class="quiet" id="openSleutels" style="padding:0;text-decoration:underline">instellingen</button>, '
      + 'of draai iets lokaals (Ollama) op deze machine.</div>';
  } else {
    h += '<textarea id="runOpdracht" placeholder="Wat moet hij uitzoeken? Eén concrete vraag."'
      + (bezigHier && run.bezig ? " disabled" : "") + '></textarea>'
      + '<div class="wrij"><select id="runModel">' + opties + '</select>'
      + '<button class="primary" id="runStart">Aan het werk zetten</button>'
      + '<button class="quiet" id="runStop" hidden>Stoppen</button></div>'
      + '<div class="wnoot">' + (modellen.bron === "ingebakken"
          ? "De modellenlijst kon niet worden opgehaald; dit is de ingebakken lijst."
          : "Lijst opgehaald bij de aanbieders. Gratis modellen hebben limieten.")
        + ' Hij draait zonder webtoegang: geen bronnen, dus geen cijfers uit het niets.</div>';
  }
  h += '<div class="werklog" id="werklog"></div></div>';
  return h;
}

function renderPanel(){
  var a=S.agents.filter(function(x){return x.id===sel;})[0];
  if(!a){el("panel").innerHTML="";return;}
  var p=meta(a.id),bs=briefsOf(a.id),st=statusOf(a.id);
  var h='<section class="panel"><h2>'+esc(p.no+" "+p.naam)+'</h2><div class="body">'
    +'<div class="ahead"><div class="badge" style="background:'+kleurVan(a.id)+'">'+esc(p.no)+'</div>'
    +'<div><div class="nm">'+esc(a.id)+'</div>'
    +'<div class="rl">'+esc(a.description.slice(0,240))+'</div>'
    +'<div class="fl">'+esc(a.file)+' · model '+esc(a.model)+' · '+a.tools.length+' tools</div>'
    +'<div class="tools"><span class="chip '+(st==="offphase"?"idle":st)+'">'+esc(statusLabel(st))+'</span></div>'
    +'</div></div>';
  if(p.offphase){
    h+='<div class="empty"><b>Deze agent staat stil.</b> Hij hoort bij een latere fase.</div>';
  } else if(!bs.length){
    h+='<div class="empty"><b>Nog geen opdracht.</b> Onderzoek start pas als onderwerp, '
      +'geografie en de te nemen beslissing vaststaan.</div>';
  } else {
    h+='<div class="stack">';bs.forEach(function(b){h+=briefCard(b);});h+='</div>';
  }
  h+=werkbank(a.id);
  h+='<div class="stuur"><span class="lbl">Op de vloer</span>'
    +'<button data-stuur="desk">Bureau</button>'
    +'<button data-stuur="coffee">Koffie</button>'
    +'<button data-stuur="meeting">Overleg</button>'
    +'<button data-stuur="lounge">Lounge</button>'
    +'<button data-stuur="archive">Archief</button></div>'
    +'<p class="note">Verplaatsen verandert alleen het beeld. Het werk zelf verandert pas '
    +'als de status van een opdracht hierboven wijzigt.</p>';
  if(!p.offphase){
    h+='<details class="adder"><summary>Opdracht voor '+esc(p.naam.toLowerCase())+'</summary><div class="body">'
      +'<div class="grid2">'
      +'<div class="full"><label for="f-topic">Onderwerp of probleemgebied</label>'
      +'<input id="f-topic" placeholder="Afgebakend, niet een hele categorie"></div>'
      +'<div><label for="f-geo">Geografie</label><input id="f-geo" placeholder="Nederland"></div>'
      +'<div><label for="f-dec">Welke beslissing dient dit?</label><input id="f-dec" placeholder="Stap ik hier in?"></div>'
      +'<div class="full"><button class="primary" id="f-add">Toevoegen</button></div></div></div></details>';
  }
  el("panel").innerHTML=h+'</div></section>';
  if(run && run.agentId === sel) renderWerkbank();
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
    +'<ol><li>Kies een agent en <b>zet hem aan het werk</b> met een concrete vraag.</li>'
    +'<li>Je ziet zijn stappen binnenkomen terwijl hij bezig is.</li>'
    +'<li>Het rapport landt in <code>drafts/</code> en verschijnt hiernaast.</li>'
    +'<li>Op de vloer gaat hij zitten, werkt, en levert af.</li></ol>'
    +'<p class="note">Een agent hier draait <b>zonder gereedschap</b>: geen webtoegang, geen '
    +'bestanden openen. Hij werkt met wat in zijn prompt staat. Voor onderzoek met bronnen zet '
    +'je hem aan in Claude Code — daar heeft hij wel WebSearch en WebFetch. Wat je hier ziet '
    +'bewegen komt van echte runs en echte bestanden, niet van een simulatie.</p>'
    +'</div></section>';
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
  var tabs=el("tabs");
  if(tabs){
    tabs.querySelectorAll("button").forEach(function(b){
      b.setAttribute("aria-selected", b.dataset.view===view ? "true":"false");
    });
  }
  var hier=el("hier");
  var vb=el("vloerbox");
  if(vb) vb.style.display = view==="map" ? "" : "none";
  if(hier){ hier.hidden = view!=="hier"; if(view==="hier") hier.innerHTML=renderHierarchy(); }
  var sb=el("sterbox");
  if(sb){
    sb.hidden = view!=="ster";
    if(view==="ster"){
      setupSterren();
      sterren.setState(S);
      sterren._resize();
      el("sNu").textContent = (sterren.huidige()||{}).label || "";
    }
  }
  var legend=document.querySelector(".legend");
  if(legend) legend.style.display = view==="map" ? "" : "none";
  var ms=el("mobstat");
  if(ms) ms.style.display = view==="map" ? "" : "none";

  if(view==="map"){ renderMobStat(); renderHud(); renderKamers(); renderTicker(); markeerSelectie(); renderPanel(); }
  else if(view==="ster"){ renderPanel(); }
  else { el("panel").innerHTML = renderCapability(); }
  renderSide();
}

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
  var km=e.target.closest("[data-kamer]");
  if(km){ if(vloer) vloer.office.focusZone(km.dataset.kamer); return; }
  var st=e.target.closest("[data-stuur]");
  if(st){ if(vloer && sel) vloer.office.send(sel, st.dataset.stuur); return; }
  var t=e.target.closest("[data-pick]");
  if(t){ sel=t.dataset.pick; markeerSelectie(); renderPanel(); return; }
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
  if(e.target.id==="runStart"){
    var opdracht = (el("runOpdracht")||{}).value || "";
    if(!opdracht.trim()){ if(el("runOpdracht")) el("runOpdracht").focus(); return; }
    startRun(sel, opdracht.trim(), (el("runModel")||{}).value);
    return;
  }
  if(e.target.id==="runStop"){ if(run && run.stop) run.stop(); return; }
  if(e.target.id==="openSleutels"){ toonSleutels(); return; }
  if(e.target.id==="bDemo"){
    demoAan=!demoAan;
    e.target.setAttribute("aria-pressed", demoAan?"true":"false");
    document.body.classList.toggle("demo", demoAan);
    if(vloer) vloer.setDemo(demoAan);
    return;
  }
  if(e.target.id==="bFit"){ if(vloer){ vloer.office.zelfGezoomd=false; vloer.office.fit(); } return; }
  if(e.target.id==="reader-close"||e.target.id==="reader"){ el("reader").hidden=true; return; }
  if(e.target.id==="refresh"){ load(); return; }
});
document.addEventListener("change",function(e){
  var sl=e.target.closest("[data-status]");
  if(sl){ var b=S.desk.briefs.filter(function(x){return x.id===sl.dataset.status;})[0];
    if(b){b.status=sl.value;save();renderAll();} }
});
document.addEventListener("keydown",function(e){ if(e.key==="Escape") el("reader").hidden=true; });

setInterval(function(){
  var d=new Date();
  var c=el("clock"); if(c) c.textContent=d.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
},1000);

setupVloer();
load();
laadModellen();
setInterval(load, 20000);
})();
