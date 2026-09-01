/* Validatiedesk — lokale werkomgeving voor de agents in deze workspace.
 *
 * De vloer zit in /iso. Dit bestand doet de rest: panelen, hierarchie,
 * de lezer en het praten met de server.
 */
import { IsoBridge, metaVan, statusVanAgent, STATUS_LABEL } from "./iso/iso-bridge.js";
import { AGENT_COLOR, THEME } from "./iso/iso-theme.js";
import { Sterrenkaart } from "./iso/sterrenkaart.js";
import { berekenWelvaart, NIVEAU_LABEL } from "./iso/welvaart.js";
import { THEMAS } from "./iso/iso-theme.js";

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
var view = "dash";           // dash | map | ster | hier | tools | werk
var capSel = null;           // geselecteerde capaciteit in de hierarchie
var saveTimer=null;
var vloer = null;            // de IsoBridge
var soorten = [];            // soorten bedrijf uit de catalogus
var voorstellenLijst = [];   // wat de hub nu voorstelt te doen
var verborgenAantal = 0;
var ververstijd = 20000, ververser = null;
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
    stuurWelvaart();
    pasVoorkeurenToe();
    renderAll();
    laadVoorstellen();
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

/* ---------- hoe goed staat het bedrijf ervoor ---------- */
/* Eén cijfer, 0 t/m 5, dat de stad aanstuurt: licht, groen, vlaggen, en hoe
 * de agents erbij lopen. Alle punten staan op het overzicht, zodat je kunt
 * zien waarom je op dit niveau staat. */
var welvaart = { niveau:0, punten:0, max:0, nogNodig:0, regels:[] };
function stuurWelvaart(){
  welvaart = berekenWelvaart({ state:S, runs:runlijst });
  if(vloer) vloer.office.setWelvaart(welvaart.niveau);
}

/* ---------- de vloer ---------- */
function setupVloer(){
  vloer = new IsoBridge(el("vloer"), {
    onSelect: function(id){ sel = id; markeerSelectie(); renderPanel(); toonInspecteur("agent"); },
    onFeed: function(regel){ feedRegel(regel); }
  });
  window.__vloer = vloer.office;   /* haak voor de browsertest */
}

/* ---------- modellen ---------- */
/* Wat is er nu te doen? De server rekent het uit uit de echte stand. */
function laadVoorstellen(){
  return fetch("/api/voorstellen").then(function(r){return r.json();})
    .then(function(d){
      voorstellenLijst = d.voorstellen || [];
      verborgenAantal = ((S.desk || {}).verborgen || []).length;
      if(view === "werk") renderWerkblad();
      if(view === "dash") renderDash();
    })
    .catch(function(){});
}

function laadSoorten(){
  return fetch("/api/catalogus").then(function(r){return r.json();})
    .then(function(d){ soorten = d.soorten || []; })
    .catch(function(){});
}

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
      load(); laadRuns();
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

/* ---------- tekenwerk ----------
 * Alles met de hand in SVG. Geen bibliotheek, en geen enkel cijfer dat niet
 * uit je bestanden komt. Is er niets te tonen, dan staat dat er.
 */
var TICK = { as:"rgba(120,150,200,.22)", raster:"rgba(120,150,200,.13)" };

function compact(n){
  if(n == null) return "—";
  if(n >= 1000000) return (n/1000000).toFixed(1).replace(".0","") + "M";
  if(n >= 1000) return (n/1000).toFixed(1).replace(".0","") + "K";
  return String(n);
}
function svgEl(inhoud, w, h, extra){
  return '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none" '
    + (extra||"") + ' role="img">' + inhoud + '</svg>';
}

/* Sparkline: twaalf punten, laatste punt geaccentueerd. Eén reeks, dus
 * geen legenda — de tegel eromheen zegt al wat het is. */
function sparkline(waarden, kleur){
  var w = 132, h = 34, p = 3;
  if(!waarden.length || Math.max.apply(null, waarden) === 0)
    return '<div class="spark-leeg">nog geen verloop</div>';
  var max = Math.max.apply(null, waarden), n = waarden.length;
  var x = function(i){ return p + i*(w-2*p)/Math.max(1,n-1); };
  var y = function(v){ return h - p - (v/max)*(h-2*p); };
  var pad = waarden.map(function(v,i){ return (i?"L":"M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
  var vlak = pad + " L" + x(n-1).toFixed(1) + " " + (h-p) + " L" + x(0).toFixed(1) + " " + (h-p) + " Z";
  return svgEl(
      '<path d="'+vlak+'" fill="'+kleur+'" opacity=".1"/>'
    + '<path d="'+pad+'" fill="none" stroke="'+kleur+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<circle cx="'+x(n-1).toFixed(1)+'" cy="'+y(waarden[n-1]).toFixed(1)+'" r="4" fill="'+kleur+'" stroke="var(--paneel)" stroke-width="2"/>',
    w, h, 'class="spark" preserveAspectRatio="none"');
}

/* Kolommen: één reeks, hoogte = aantal. Staafjes maximaal 24 breed met een
 * afgeronde kop, 2px lucht ertussen, en een raster dat op de achtergrond blijft. */
function kolommen(rijen, kleur){
  if(!rijen.length) return '<div class="empty"><b>Nog niets gedraaid.</b> Zodra een agent werk doet verschijnt het hier.</div>';
  var max = Math.max.apply(null, rijen.map(function(r){return r.n;}));
  if(max === 0) max = 1;
  var w = 720, h = 168, links = 34, onder = 26, boven = 10;
  var vlakB = w - links - 8, vlakH = h - onder - boven;
  var band = vlakB / rijen.length;
  var breed = Math.min(24, band - 6);
  var stappen = max <= 4 ? max : 4;
  var lijnen = "", merken = "";
  for(var i=0;i<=stappen;i++){
    var v = Math.round(max*i/stappen), yy = boven + vlakH - (v/max)*vlakH;
    lijnen += '<line x1="'+links+'" y1="'+yy.toFixed(1)+'" x2="'+(w-8)+'" y2="'+yy.toFixed(1)
      + '" stroke="'+TICK.raster+'" stroke-width="1"/>'
      + '<text x="'+(links-8)+'" y="'+(yy+3.5).toFixed(1)+'" text-anchor="end" class="asTekst">'+v+'</text>';
  }
  rijen.forEach(function(r, i){
    var hoog = (r.n/max)*vlakH;
    var x = links + i*band + (band-breed)/2;
    var y = boven + vlakH - hoog;
    if(r.n > 0){
      merken += '<path d="M'+x.toFixed(1)+' '+(boven+vlakH)+' L'+x.toFixed(1)+' '+(y+4).toFixed(1)
        + ' Q'+x.toFixed(1)+' '+y.toFixed(1)+' '+(x+4).toFixed(1)+' '+y.toFixed(1)
        + ' L'+(x+breed-4).toFixed(1)+' '+y.toFixed(1)
        + ' Q'+(x+breed).toFixed(1)+' '+y.toFixed(1)+' '+(x+breed).toFixed(1)+' '+(y+4).toFixed(1)
        + ' L'+(x+breed).toFixed(1)+' '+(boven+vlakH)+' Z" fill="'+kleur+'"/>';
    }
    merken += '<rect x="'+(links+i*band).toFixed(1)+'" y="'+boven+'" width="'+band.toFixed(1)+'" height="'+vlakH
      + '" fill="transparent" class="kolomvak" data-tip="'+esc(r.label+": "+r.n+(r.n===1?" run":" runs"))+'"/>';
    if(i % Math.ceil(rijen.length/7) === 0 || i === rijen.length-1)
      merken += '<text x="'+(links+i*band+band/2).toFixed(1)+'" y="'+(h-8)+'" text-anchor="middle" class="asTekst">'
        + esc(r.kort) + '</text>';
  });
  return '<div class="grafiek">' + svgEl(
      lijnen
    + '<line x1="'+links+'" y1="'+(boven+vlakH)+'" x2="'+(w-8)+'" y2="'+(boven+vlakH)+'" stroke="'+TICK.as+'" stroke-width="1"/>'
    + merken, w, h, 'preserveAspectRatio="xMidYMid meet" class="kolomgrafiek"') + '</div>';
}

/* Meter: gevuld deel is de stand, de baan eronder is dezelfde kleur, lichter. */
function meter(deel, totaal, kleur){
  var pct = totaal ? Math.round(deel/totaal*100) : 0;
  return '<div class="meter-baan" style="--kleur:'+kleur+'"><i style="width:'+pct+'%"></i></div>';
}

/* ---------- overzicht ---------- */
function dagenTerug(n){
  var uit = [], nu = new Date();
  for(var i=n-1;i>=0;i--){
    var d = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate()-i);
    uit.push({ d:d, sleutel:d.toISOString().slice(0,10),
      label:d.toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"}),
      kort:d.getDate()+"/"+(d.getMonth()+1), n:0, tokens:0 });
  }
  return uit;
}

/* De stand van het bedrijf: één niveau, en precies waarom. Alles hieronder is
 * geteld uit je eigen bestanden — er valt niets aan te vinken. Doe je werk,
 * dan loopt het cijfer op. */
var GROEP = {
  ploeg:    { kop:"Je ploeg",   uit:"Agents en capaciteiten" },
  werk:     { kop:"Het werk",   uit:"Opdrachten en runs" },
  uitkomst: { kop:"Wat het oplevert", uit:"Rapporten, besluiten, goedgekeurd werk" }
};

function standKaart(){
  var w = welvaart, pips = "";
  for (var i = 0; i <= 5; i++)
    pips += '<i class="' + (i <= w.niveau ? "aan" : "") + '"></i>';

  var h = '<section class="stand">'
    + '<div class="stand-kop">'
    + '<div class="stand-titel"><b>Niveau ' + w.niveau + '</b>'
    + '<span>van 5 · ' + esc(NIVEAU_LABEL[w.niveau] || "") + '</span></div>'
    + '<div class="pips">' + pips + '</div>'
    + '</div>'
    + '<p class="stand-uit">' + w.punten + ' van ' + w.max + ' signalen gehaald'
    + (w.nogNodig ? ' · nog ' + w.nogNodig + ' tot niveau ' + (w.niveau + 1) : ' · dit is de top')
    + '. Alles hier is geteld uit je bestanden: er valt niets zelf aan te vinken. '
    + 'Hoe hoger het niveau, hoe voller de stad.</p>'
    + '<div class="standgroepen">';

  Object.keys(GROEP).forEach(function(g){
    var rij = w.regels.filter(function(r){ return r.groep === g; });
    var gehaald = rij.filter(function(r){ return r.gehaald; }).length;
    h += '<div class="standgroep"><div class="sg-kop"><b>' + esc(GROEP[g].kop) + '</b>'
      + '<span>' + gehaald + '/' + rij.length + '</span></div>'
      + '<div class="sg-balk">' + meter(gehaald, rij.length, "var(--busy)") + '</div>'
      + '<ul>' + rij.map(function(r){
          return '<li class="' + (r.gehaald ? "ja" : "nee") + '">'
            + '<i>' + (r.gehaald ? "✓" : "") + '</i>'
            + '<span>' + esc(r.tekst) + '</span>'
            + '<em>' + esc(r.nu) + '</em></li>';
        }).join("") + '</ul></div>';
  });

  return h + '</div></section>';
}

function renderDash(){
  var doel = el("dashblad"); if(!doel) return;
  var caps = S.capabilities || [];
  var bemand = caps.filter(function(c){return c.done_by;}).length;
  var open = S.desk.briefs.filter(function(b){return b.status==="nieuw"||b.status==="opgepakt";});
  var beslis = S.desk.decisions.filter(function(d){return !d.resolved;});
  var tokens = runlijst.reduce(function(n,r){return n + (r.tokensIn||0) + (r.tokensUit||0);},0);
  var kosten = runlijst.reduce(function(n,r){return n + (r.kosten||0);},0);
  var metKosten = runlijst.filter(function(r){return r.kosten!=null;}).length;
  var mislukt = runlijst.filter(function(r){return r.fout;}).length;

  var dagen = dagenTerug(14);
  runlijst.forEach(function(r){
    var k = String(r.begonnen||"").slice(0,10);
    var d = dagen.filter(function(x){return x.sleutel===k;})[0];
    if(d){ d.n++; d.tokens += (r.tokensIn||0)+(r.tokensUit||0); }
  });

  var h = '';

  /* Nog geen bedrijf? Dan is dat het eerste wat je moet doen, en dat zegt de
   * hub ook — in plaats van je een leeg overzicht te laten zien. */
  if(!(S.bedrijf && (S.bedrijf.bedrijf||{}).naam)){
    h += '<section class="aanzet">'
      + '<div><b>Je bent nog niet opgezet.</b>'
      + '<p>Vul in wie je bent en wat voor bedrijf je begint. De hub stelt daarna een ploeg '
      + 'agents voor die bij dat werk hoort, en zet ze als bestanden in deze workspace. '
      + 'Duurt twee minuten.</p></div>'
      + '<a class="knop-groot" href="/start.html">Onboarding starten →</a></section>';
  }

  /* de kop: één groot getal, de stand van je bedrijf */
  h += '<section class="held">'
    + '<div class="held-cijfer"><b>' + bemand + '<span>/' + caps.length + '</span></b>'
    + '<span class="held-label">capaciteiten bemand</span></div>'
    + '<div class="held-meter">' + meter(bemand, caps.length, "var(--busy)")
    + '<p>' + (caps.length - bemand) + ' staan er nog op papier. Dat werk doe jij nu zelf.</p></div>'
    + '</section>';

  h += standKaart();

  /* wat nu: de drie belangrijkste voorstellen, met de knop erbij */
  if(voorstellenLijst.length){
    h += '<div class="blad-sectie">Wat nu <span class="tel">' + voorstellenLijst.length + '</span>'
       + '<button class="terughaal" data-view="werk">alles bekijken →</button></div>'
       + '<div class="nustrook">'
       + voorstellenLijst.slice(0,3).map(function(v){ return voorstelKaart(v, true); }).join("")
       + '</div>';
  }

  /* tegels */
  h += '<div class="tegels">'
    + tegel("Agents", S.agents.length, S.agents.filter(function(a){return statusOf(a.id)==="opgepakt"||statusOf(a.id)==="nieuw";}).length + " met werk", null, null)
    + tegel("Runs", runlijst.length, mislukt ? mislukt + " mislukt" : "alle geslaagd",
        sparkline(dagen.map(function(d){return d.n;}), "#6BA8F5"), mislukt ? "wait" : null)
    + tegel("Tokens", compact(tokens), runlijst.length ? "over " + runlijst.length + " runs" : "nog geen verbruik",
        sparkline(dagen.map(function(d){return d.tokens;}), "#8465DC"), null)
    + tegel("Kosten", metKosten ? "$" + kosten.toFixed(2) : "—",
        metKosten ? metKosten + " van " + runlijst.length + " runs met prijs"
                  : "geen prijs bekend voor deze modellen", null, null)
    + '</div>';

  /* activiteit */
  h += '<section class="kaart-blok"><header><h3>Activiteit</h3>'
    + '<span class="mono">runs per dag · laatste 14 dagen</span></header>'
    + kolommen(dagen, "#6BA8F5") + '</section>';

  /* twee kolommen: agents en afdelingen */
  h += '<div class="duo">';

  h += '<section class="kaart-blok"><header><h3>Agents</h3>'
    + '<span class="mono">' + S.agents.length + ' in .claude/agents</span></header>'
    + '<table class="tabel"><thead><tr><th>Agent</th><th>Status</th><th class="r">Runs</th>'
    + '<th class="r">Tokens</th><th class="r">Laatst</th></tr></thead><tbody>';
  S.agents.slice().sort(function(a,b){return meta(a.id).no.localeCompare(meta(b.id).no);}).forEach(function(a){
    var mijn = runlijst.filter(function(r){return r.agentId===a.id;});
    var tk = mijn.reduce(function(n,r){return n+(r.tokensIn||0)+(r.tokensUit||0);},0);
    var st = statusOf(a.id);
    var laatst = mijn.length ? new Date(mijn[0].begonnen).toLocaleDateString("nl-NL",{day:"numeric",month:"short"}) : "—";
    h += '<tr data-pick="'+esc(a.id)+'">'
      + '<td><span class="stip" style="background:'+kleurVan(a.id)+'"></span>' + esc(meta(a.id).naam) + '</td>'
      + '<td><span class="chip '+(st==="offphase"?"idle":st)+'">'+esc(statusLabel(st))+'</span></td>'
      + '<td class="r mono">' + (mijn.length || "—") + '</td>'
      + '<td class="r mono">' + (tk ? compact(tk) : "—") + '</td>'
      + '<td class="r mono">' + laatst + '</td></tr>';
  });
  h += '</tbody></table></section>';

  h += '<section class="kaart-blok"><header><h3>Afdelingen</h3>'
    + '<span class="mono">bemand van gedeclareerd</span></header><div class="afdlijst">';
  ["kennis","aanbod","markt","financien","operatie"].forEach(function(dep){
    var mijn = caps.filter(function(c){return c.department===dep;});
    var live = mijn.filter(function(c){return c.done_by;}).length;
    h += '<div class="afd"><div class="r1"><b>'+esc(dep)+'</b>'
      + '<span class="mono">'+live+'/'+mijn.length+'</span></div>'
      + meter(live, mijn.length, live ? "var(--ok)" : "var(--idle)") + '</div>';
  });
  h += '</div></section>';
  h += '</div>';

  /* wat op jou wacht */
  h += '<section class="kaart-blok"><header><h3>Wacht op jou</h3>'
    + '<span class="mono">' + (beslis.length + open.length) + ' punten</span></header>';
  if(!beslis.length && !open.length){
    h += '<div class="empty"><b>Niets openstaand.</b> Geen beslissing en geen opdracht die wacht.</div>';
  } else {
    h += '<div class="stack">';
    beslis.forEach(function(d){
      h += '<div class="card dec"><h3>'+esc(d.question)+'</h3>'
        + '<p style="margin:7px 0 0;font-size:13px;color:var(--ink-soft)">'+esc(d.context)+'</p>'
        + '<div class="tools"><input data-ans="'+d.id+'" placeholder="Jouw besluit" style="flex:1;min-width:160px">'
        + '<button class="primary" data-resolve="'+d.id+'">Vastleggen</button></div></div>';
    });
    open.forEach(function(b){
      h += '<div class="card"><div style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap">'
        + '<span class="chip '+esc(b.status)+'">'+esc(b.status)+'</span>'
        + '<b>'+esc(b.topic)+'</b><span class="mono" style="font-size:11px;color:var(--ink-faint);margin-left:auto">'
        + esc(meta(b.agent).naam)+'</span></div></div>';
    });
    h += '</div>';
  }
  h += '</section>';

  doel.innerHTML = h;
}

function tegel(label, waarde, onder, spark, toon){
  return '<article class="tegel'+(toon?" "+toon:"")+'">'
    + '<span class="t-label">'+esc(label)+'</span>'
    + '<b class="t-waarde">'+esc(String(waarde))+'</b>'
    + '<span class="t-onder">'+esc(onder)+'</span>'
    + (spark ? '<div class="t-spark">'+spark+'</div>' : '')
    + '</article>';
}

/* ---------- gereedschapsbibliotheek ---------- */
var gereedschap = [];
function laadGereedschap(){
  return fetch("/api/gereedschap").then(function(r){return r.json();})
    .then(function(d){ gereedschap = d.gereedschap || []; if(view==="tools") renderTools(); })
    .catch(function(){});
}

/* Welk gereedschap past bij deze agent? Uit zijn eigen tools-regel. */
function suggestieVoor(agentId){
  var a = S.agents.filter(function(x){return x.id===agentId;})[0];
  if(!a) return [];
  var heeft = (a.tools||[]).join(" ").toLowerCase();
  var uit = ["lees_bestand","lijst_bestanden"];
  if(heeft.indexOf("websearch")>=0) uit.push("web_zoek");
  if(heeft.indexOf("webfetch")>=0) uit.push("web_haal");
  return uit;
}

function renderTools(){
  var doel = el("toolblad"); if(!doel) return;
  var klaar = gereedschap.filter(function(g){return g.klaar;}).length;

  /* hoe vaak is elk stuk gereedschap echt gebruikt? uit de runlogboeken */
  var gebruik = {};
  runlijst.forEach(function(r){
    (r.gereedschap||[]).forEach(function(g){ gebruik[g.naam] = (gebruik[g.naam]||0) + 1; });
  });
  var meest = Math.max(1, Math.max.apply(null, gereedschap.map(function(g){return gebruik[g.id]||0;})));
  var totaalGebruik = Object.keys(gebruik).reduce(function(n,k){return n+gebruik[k];},0);

  var h = '<section class="held klein">'
    + '<div class="held-cijfer"><b>' + klaar + '<span>/' + gereedschap.length + '</span></b>'
    + '<span class="held-label">gereedschap bruikbaar</span></div>'
    + '<div class="held-meter">' + meter(klaar, gereedschap.length, "var(--busy)")
    + '<p>Alles hier is alleen-lezen. Een agent kan zoeken, lezen en kijken; schrijven doet '
    + 'de hub aan het eind, zodat er nooit iets ongemerkt verandert.'
    + (totaalGebruik ? ' Tot nu toe ' + totaalGebruik + ' keer gebruikt.' : '') + '</p></div></section>';

  h += '<div class="biblio">';
  gereedschap.forEach(function(g){
    var n = gebruik[g.id] || 0;
    var wie = S.agents.filter(function(a){ return suggestieVoor(a.id).indexOf(g.id)>=0; });
    h += '<article class="gkaart' + (g.klaar?"":" uit") + '">'
      + '<div class="kop"><div class="ic">' + toolIcoon(g.id) + '</div>'
      + '<h3>' + esc(g.naam) + '</h3>'
      + '<span class="status ' + (g.klaar?"aan":"uit") + '">' + (g.klaar?"klaar":"uit") + '</span></div>'
      + '<p>' + esc(g.kort) + '</p>'
      + '<p class="waarom">' + esc(g.waarom) + '</p>'
      + '<div class="gbalk"><div class="l"><span>' + (n ? n + (n===1?" keer gebruikt":" keer gebruikt") : "nog niet gebruikt") + '</span>'
      + '<span class="mono">' + esc(g.klaar ? g.via : "—") + '</span></div>'
      + '<div class="meter-baan" style="--kleur:' + (g.klaar ? "var(--busy)" : "var(--idle)") + '">'
      + '<i style="width:' + Math.round((n/meest)*100) + '%"></i></div></div>'
      + (g.klaar ? '' : '<div class="voet nodig">' + esc(g.reden || g.nodig) + '</div>')
      + '<div class="gwie">' + wie.map(function(a){
          return '<span class="stip" style="background:'+kleurVan(a.id)+'" title="'+esc(meta(a.id).naam)+'"></span>';
        }).join("") + '<em>' + wie.length + ' van de ' + S.agents.length + ' agents</em></div>'
      + '</article>';
  });
  h += '</div>';

  /* matrix: wie mag wat, in één blik */
  h += '<section class="kaart-blok"><header><h3>Wie mag wat</h3>'
    + '<span class="mono">uit de tools-regel van elke agent</span></header>'
    + '<div class="matrix-omhulsel"><table class="matrix"><thead><tr><th>Agent</th>'
    + gereedschap.map(function(g){ return '<th><span>'+esc(g.naam)+'</span></th>'; }).join("")
    + '</tr></thead><tbody>';
  S.agents.slice().sort(function(a,b){return meta(a.id).no.localeCompare(meta(b.id).no);}).forEach(function(a){
    var mag = suggestieVoor(a.id);
    h += '<tr data-pick="'+esc(a.id)+'"><td><span class="stip" style="background:'+kleurVan(a.id)+'"></span>'
      + esc(meta(a.id).naam) + '</td>'
      + gereedschap.map(function(g){
          var ja = mag.indexOf(g.id) >= 0;
          return '<td class="c">' + (ja
            ? '<span class="vink'+(g.klaar?"":" uit")+'" title="'+(g.klaar?"beschikbaar":"nog niet bruikbaar")+'">'
              + (g.klaar ? "&#10003;" : "&#8226;") + '</span>'
            : '<span class="nee">·</span>') + '</td>';
        }).join("") + '</tr>';
  });
  h += '</tbody></table></div>'
    + '<p class="matrix-noot">Een vinkje betekent dat de agent het gereedschap krijgt aangeboden. '
    + 'Een stip betekent: wel toegestaan, maar het gereedschap zelf werkt nog niet.</p></section>';

  doel.innerHTML = h;
}

/* Getekende iconen; een teken uit een lettertype is geen icoon. */
function toolIcoon(id){
  var d = {
    web_zoek: '<circle cx="8.5" cy="8.5" r="5.2"/><path d="M12.4 12.4 17 17"/>',
    web_haal: '<path d="M10 3v10"/><path d="m6 9.5 4 4 4-4"/><path d="M3.5 16.5h13"/>',
    lees_bestand: '<path d="M5 2.6h6l4 4v11H5z"/><path d="M11 2.6v4h4"/><path d="M7.5 11h5M7.5 14h5"/>',
    lijst_bestanden: '<path d="M3.5 5h13M3.5 10h13M3.5 15h9"/>'
  }[id] || '<circle cx="10" cy="10" r="6"/>';
  return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
}

/* ---------- werkblad: runs, beslissingen, rapporten ---------- */
var runlijst = [];
function laadRuns(){
  return fetch("/api/runs").then(function(r){return r.json();})
    .then(function(d){ runlijst = d.runs || []; stuurWelvaart();
                       if(view==="werk") renderWerkblad(); if(view==="dash") renderDash(); })
    .catch(function(){});
}

/* ---------- wat nu te doen is ----------
 * Elk voorstel wijst naar een bestand, een opdracht of een agent die er echt
 * is. De knoppen doen ook echt iets: draaien start een run, keuren verplaatst
 * het rapport naar outputs/.
 */
var SOORT_LABEL = {
  keuren:"nakijken", beslissen:"aan jou", starten:"klaar om te draaien",
  leeg:"stilstand", onbemand:"nog geen agent", opvolgen:"vervolg", stil:"rust"
};

function voorstelKaart(v, compact){
  var h = '<article class="vst v-' + v.soort + '">'
    + '<div class="vst-kop">'
    + '<span class="vst-merk">' + esc(SOORT_LABEL[v.soort] || v.soort) + '</span>'
    + (v.agent ? '<span class="vst-wie"><i style="background:' + kleurVan(v.agent) + '"></i>'
        + esc(meta(v.agent).naam) + '</span>' : '')
    + '<button class="vst-weg" data-weg="' + esc(v.id) + '" title="Wegleggen">&times;</button>'
    + '</div>'
    + '<h3>' + esc(v.titel) + '</h3>'
    + '<p>' + esc(v.waarom) + '</p>';

  if(v.opdracht && !compact)
    h += '<div class="vst-opdracht">' + esc(v.opdracht) + '</div>';

  /* een beslissing beantwoord je hier meteen */
  if(v.soort === "beslissen" && !compact){
    var id = v.id.slice(8);
    h += '<div class="vst-knoppen"><input data-ans="' + esc(id) + '" placeholder="Jouw besluit">'
      + '<button class="primary" data-resolve="' + esc(id) + '">Vastleggen</button></div></article>';
    return h;
  }

  var knoppen = [];
  if(v.acties.indexOf("draaien") >= 0)
    knoppen.push('<button class="primary" data-doe="draaien" data-v="' + esc(v.id) + '">Nu draaien</button>');
  if(v.acties.indexOf("keuren") >= 0)
    knoppen.push('<button class="primary" data-doe="keuren" data-v="' + esc(v.id) + '">Goedkeuren</button>');
  if(v.acties.indexOf("lezen") >= 0 && v.bestand)
    knoppen.push('<button data-read="' + esc(v.bestand) + '">Lezen</button>');
  if(v.acties.indexOf("afkeuren") >= 0)
    knoppen.push('<button data-doe="afkeuren" data-v="' + esc(v.id) + '">Terug naar de agent</button>');
  if(v.acties.indexOf("opdracht") >= 0)
    knoppen.push('<button data-doe="opdracht" data-v="' + esc(v.id) + '">Op de desk zetten</button>');
  if(v.acties.indexOf("opzetten") >= 0)
    knoppen.push('<a class="knopje" href="/start.html">Agent erbij zetten →</a>');

  if(knoppen.length) h += '<div class="vst-knoppen">' + knoppen.join("") + '</div>';
  return h + '</article>';
}

function voorstelVan(id){
  return voorstellenLijst.filter(function(v){ return v.id === id; })[0] || null;
}

function doeVoorstel(id, actie){
  var v = voorstelVan(id); if(!v) return;

  if(actie === "draaien"){
    if(run && run.bezig){ pill("er draait er al een","err"); return; }
    var m = (modellen.modellen || []).filter(function(x){ return x.bruikbaar; })[0];
    if(!m){ pill("geen bruikbaar model","err"); view = "instel"; renderAll(); return; }
    sel = v.agent; markeerSelectie(); renderPanel();
    startRun(v.agent, v.opdracht, (voorkeuren().model || (modellen.standaard || m.id)));
    toonInspecteur("agent");
    return;
  }

  if(actie === "opdracht"){
    S.desk.briefs.push({ id:"b-"+uid(), agent:v.agent, topic:v.opdracht,
      geo:"", decision:"", status:"nieuw", gezet:new Date().toISOString(), findings:[] });
    save(); pill("op de desk gezet","ok");
    setTimeout(laadVoorstellen, 600);
    return;
  }

  if(actie === "keuren" || actie === "afkeuren"){
    var reden = "";
    if(actie === "afkeuren"){
      reden = prompt("Waarom gaat dit terug? Eén zin, die gaat mee als aantekening.");
      if(reden === null) return;
    }
    fetch("/api/keur", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ file: v.bestand, afkeuren: actie === "afkeuren", reden: reden }) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d.error) throw new Error(d.error);
        pill(actie === "keuren" ? "goedgekeurd naar outputs/" : "terug naar de agent", "ok");
        return load();
      })
      .then(laadVoorstellen)
      .catch(function(e){ pill("mislukt: " + e.message, "err"); });
    return;
  }
}

function legWeg(id, terug){
  fetch("/api/voorstel", { method:"POST", headers:{"content-type":"application/json"},
    body: JSON.stringify({ id: id, terug: !!terug }) })
    .then(function(){ return load(); })
    .then(laadVoorstellen);
}

function renderWerkblad(){
  var doel = el("werkblad"); if(!doel) return;
  var h = '<h2 class="blad-kop">Werk</h2>'
    + '<p class="blad-uit">Wat er nu te doen is, wat er loopt, en wat er gedraaid heeft. '
    + 'Elk voorstel hieronder komt uit je eigen bestanden.</p>';

  /* wat nu */
  h += '<div class="blad-sectie">Wat nu'
    + (voorstellenLijst.length ? ' <span class="tel">' + voorstellenLijst.length + '</span>' : '')
    + (verborgenAantal ? '<button class="terughaal" data-terug="alles">' + verborgenAantal
        + ' weggelegd terughalen</button>' : '')
    + '</div>';
  if(!voorstellenLijst.length)
    h += '<div class="empty"><b>Niets open.</b> Elke opdracht is gedraaid, elk rapport is nagekeken '
       + 'en elke capaciteit heeft een agent. Zet er iets nieuws bij, of laat het even rusten.</div>';
  else h += '<div class="vstlijst">' + voorstellenLijst.map(function(v){
      return voorstelKaart(v, false); }).join("") + '</div>';

  /* lopende opdrachten */
  var lopend = S.desk.briefs.filter(function(b){ return b.status !== "goedgekeurd"; });
  h += '<div class="blad-sectie">Opdrachten op de desk'
    + (lopend.length ? ' <span class="tel">' + lopend.length + '</span>' : '') + '</div>';
  if(!lopend.length) h += '<div class="empty"><b>De desk is leeg.</b></div>';
  else {
    h += '<div class="card">';
    lopend.forEach(function(b){
      h += '<div class="runrij">'
        + '<span class="wie"><span class="stip" style="background:' + kleurVan(b.agent) + '"></span>'
        + esc(meta(b.agent).naam) + '</span>'
        + '<span class="wat">' + esc(b.topic) + '</span>'
        + '<span class="cijfers"><span class="chip ' + esc(b.status) + '">'
        + esc(statusLabel(b.status)) + '</span></span>'
        + (b.draft ? '<button class="quiet" data-read="' + esc(b.draft) + '">lezen</button>' : '')
        + '</div>';
    });
    h += '</div>';
  }

  h += '<div class="blad-sectie">Runs'
    + (runlijst.length ? ' <span class="tel">' + runlijst.length + '</span>' : '') + '</div>';
  if(!runlijst.length) h += '<div class="empty"><b>Nog niets gedraaid.</b> Kies een agent en zet hem aan het werk.</div>';
  else {
    h += '<div class="card">';
    runlijst.forEach(function(r){
      h += '<div class="runrij' + (r.fout?" fout":"") + '">'
        + '<span class="wie">' + esc(meta(r.agentId).naam) + '</span>'
        + '<span class="wat">' + esc(r.fout ? r.fout : r.opdracht) + '</span>'
        + '<span class="cijfers">' + esc(r.model) + '<br>'
        + (r.fout ? "mislukt" : ((r.tokensIn+r.tokensUit) + " tokens"
            + (r.kosten!=null ? " · $"+r.kosten.toFixed(4) : "")
            + " · " + (r.duur/1000).toFixed(1) + "s")) + '</span>'
        + (r.bestand ? '<button class="quiet" data-read="'+esc(r.bestand)+'">lezen</button>' : '')
        + '</div>';
    });
    h += '</div>';
  }
  doel.innerHTML = h + zijkant();
}

/* ---------- instellingen ----------
 * Alles wat je aan de hub kunt veranderen staat hier bij elkaar: waar de
 * agents op draaien, wie je bent, wat je al hebt bereikt, en hoe het eruitziet.
 * Alles gaat naar bedrijf.json of sleutels.json op deze machine.
 */
var devInfo = null, ruwToon = null, ruwTekst = "";

function voorkeuren(){
  return ((S.bedrijf || {}).voorkeuren) || {};
}

/* De voorkeuren toepassen op wat er draait. */
function pasVoorkeurenToe(){
  var v = voorkeuren();
  if(vloer){
    vloer.office.setThema(v.thema || "nacht");
    vloer.office.setKwaliteit(v.kwaliteit || "auto");
    if(v.animatie === false) vloer.office.reduced = true;
    else if(v.animatie === true) vloer.office.reduced = false;
  }
  var ms = Number(v.ververs || 20) * 1000;
  if(ms !== ververstijd){
    ververstijd = ms;
    clearInterval(ververser);
    ververser = setInterval(load, ververstijd);
  }
}

function bewaarVoorkeur(sleutel, waarde){
  var v = {}; v[sleutel] = waarde;
  if(!S.bedrijf) S.bedrijf = {};
  S.bedrijf.voorkeuren = Object.assign({}, voorkeuren(), v);
  pasVoorkeurenToe();
  renderInstellingen();
  fetch("/api/bedrijf", { method:"POST", headers:{"content-type":"application/json"},
    body: JSON.stringify({ voorkeuren: v }) })
    .then(function(r){ if(!r.ok) throw 0; pill("opgeslagen","ok");
      setTimeout(function(){ pill(S.agents.length+" agents · "+S.drafts.length+" rapporten","ok"); }, 1200); })
    .catch(function(){ pill("voorkeur niet opgeslagen","err"); });
}

function renderInstellingen(){
  var doel = el("instelblad"); if(!doel) return;
  var b = S.bedrijf || {}, bd = b.bedrijf || {}, v = voorkeuren();
  var cc = (modellen && modellen.claudecode) || {};
  var sl = (modellen && modellen.sleutels) || [];
  var mod = (modellen && modellen.modellen) || [];

  var h = '<h2 class="blad-kop">Instellingen</h2>';

  /* --- opzetten: de onboarding, en wat eruit kwam --- */
  var gedaan = !!(b.bedrijf && bd.naam);
  h += '<section class="ins' + (gedaan ? '' : ' ins-let') + '"><h3>Opzetten</h3>';
  if(!gedaan){
    h += '<p class="ins-uit">Je hebt de onboarding nog niet gedaan. Daarin vul je je naam in, '
      + 'kies je een bedrijfsnaam (met generator), zeg je wat voor bedrijf het is, en stelt de hub '
      + 'een ploeg agents voor die daarbij hoort. Elke agent wordt daarna een bestand in '
      + '<code>.claude/agents/</code>.</p>'
      + '<div class="tools"><a class="knop-groot" href="/start.html">Onboarding starten →</a></div>';
  } else {
    var soortLabel = (soorten.filter(function(so){ return so.id === bd.soort; })[0] || {}).label;
    h += '<div class="profielrij">'
      + '<div><span>Jij</span><b>' + esc(b.operator || "—") + '</b></div>'
      + '<div><span>Bedrijf</span><b>' + esc(bd.naam || "—") + '</b></div>'
      + '<div><span>Soort</span><b>' + esc(soortLabel || bd.soort || "—") + '</b></div>'
      + '<div><span>Fase</span><b>' + esc(bd.fase || "—") + '</b></div>'
      + '<div><span>Agents</span><b>' + S.agents.length + ' aangemaakt</b></div>'
      + '<div><span>Aansluiting</span><b>' + esc(v.aansluiting || "nog niet gekozen") + '</b></div>'
      + '</div>'
      + '<div class="tools" style="margin-top:12px">'
      + '<a class="knopje" href="/start.html">Onboarding opnieuw doorlopen</a>'
      + '<a class="knopje" href="/start.html">Agents erbij zetten</a></div>'
      + '<p class="note">Opnieuw doorlopen is veilig: agents die er al staan worden niet '
      + 'overschreven, en je bedrijfsgegevens worden alleen bijgewerkt.</p>';
  }
  h += '</section>';

  /* --- waar draaien ze op --- */
  h += '<section class="ins"><h3>Waar de agents op draaien</h3>'
    + '<div class="ins-rij"><div class="ins-kaart' + (cc.beschikbaar ? " ja" : "") + '">'
    + '<b>Claude Code op deze machine</b>'
    + '<p>Loopt op je eigen abonnement. Geen sleutel, geen aparte rekening.</p>'
    + '<span class="staat ' + (cc.beschikbaar ? "ok" : "uit") + '">'
    + (cc.beschikbaar ? "gevonden · " + esc(cc.versie || "") : "niet gevonden" + (cc.reden ? " · " + esc(cc.reden) : ""))
    + '</span></div>';

  var gratis = mod.filter(function(m){ return m.bruikbaar && (m.gratis || m.abonnement); });
  h += '<div class="ins-kaart' + (gratis.length ? " ja" : "") + '"><b>Kost het iets?</b>'
    + '<p>' + (gratis.length
        ? gratis.length + ' model' + (gratis.length === 1 ? "" : "len") + ' die je nu kunt gebruiken '
          + 'zonder aparte rekening: ' + esc(gratis.slice(0,3).map(function(m){ return m.naam; }).join(", "))
          + (gratis.length > 3 ? " en meer" : "") + '.'
        : 'Nog niets gratis bruikbaar. Drie routes die niets kosten: een gratis sleutel bij '
          + 'OpenRouter (modellen met :free), een gratis sleutel bij Groq, of '
          + '<code>ollama serve</code> op deze machine.') + '</p>'
    + '<span class="staat ' + (gratis.length ? "ok" : "uit") + '">'
    + (gratis.length ? "je kunt draaien zonder kosten" : "kies hieronder een sleutel") + '</span></div>';

  h += '<div class="ins-kaart"><b>Standaardmodel</b>'
    + '<p>Wat de hub kiest als je zelf niets kiest bij een run.</p>'
    + '<select data-voorkeur="model"><option value="">automatisch ('
    + esc((modellen && modellen.standaard) || "-") + ')</option>'
    + mod.map(function(m){
        return '<option value="' + esc(m.id) + '"' + (v.model === m.id ? " selected" : "")
          + (m.bruikbaar ? "" : " disabled") + '>' + esc(m.naam)
          + (m.bruikbaar ? "" : " · sleutel nodig") + '</option>';
      }).join("") + '</select></div></div>';

  /* --- sleutels --- */
  h += '<div class="ins-sleutels">' + sl.map(function(a){
      return '<div class="sleutelrij"><div class="kop"><b>' + esc(a.naam) + '</b>'
        + (a.heeft ? '<span class="chip geleverd">ingesteld ' + esc(a.staart) + '</span>'
                   : '<span class="chip idle">leeg</span>')
        + (a.bron === "omgeving" ? '<span class="chip nieuw">uit de omgeving</span>' : '')
        + '<a href="' + esc(a.aanmelden) + '" target="_blank" rel="noopener">sleutel halen ↗</a></div>'
        + '<p>' + esc(a.uitleg) + '</p>'
        + '<div class="tools"><input type="password" data-sleutel="' + esc(a.id) + '" '
        + 'placeholder="' + (a.heeft ? "vervangen of leegmaken" : "plak hier je sleutel") + '" autocomplete="off">'
        + '<button data-bewaar="' + esc(a.id) + '">Bewaren</button></div></div>';
    }).join("") + '</div>'
    + '<p class="note">Sleutels staan in <code>sleutels.json</code> naast je workspace, met rechten 600. '
    + 'Ze gaan nooit terug naar de browser: je ziet alleen de laatste vier tekens.</p></section>';

  /* --- bedrijf --- */
  h += '<section class="ins"><h3>Jij en je bedrijf</h3>'
    + '<div class="grid2">'
    + '<div><label for="iOperator">Jouw naam</label><input id="iOperator" value="' + esc(b.operator || "") + '"></div>'
    + '<div><label for="iNaam">Bedrijfsnaam</label><input id="iNaam" value="' + esc(bd.naam || "") + '"></div>'
    + '<div class="full"><label for="iWat">Wat doen jullie?</label>'
    + '<textarea id="iWat" rows="2">' + esc(bd.wat || "") + '</textarea></div>'
    + '<div><label for="iSoort">Soort bedrijf</label><select id="iSoort">'
    + '<option value="">—</option>'
    + (soorten || []).map(function(so){
        return '<option value="' + esc(so.id) + '"' + (bd.soort === so.id ? " selected" : "") + '>'
             + esc(so.label) + '</option>'; }).join("")
    + '</select></div>'
    + '<div><label for="iFase">Fase</label><select id="iFase">'
    + ["valideren","bouwen","runnen"].map(function(f){
        return '<option' + (bd.fase === f ? " selected" : "") + '>' + f + '</option>'; }).join("")
    + '</select></div>'
    + '</div><div class="tools" style="margin-top:12px">'
    + '<button id="bBedrijf" class="primary">Bewaren</button>'
    + '</div></section>';

  /* --- uiterlijk --- */
  h += '<section class="ins"><h3>Uiterlijk van de stad</h3>'
    + '<div class="themarij">' + THEMAS.map(function(t){
        var aan = (v.thema || "nacht") === t.id;
        return '<button data-thema="' + t.id + '" class="thema' + (aan ? " aan" : "") + '">'
          + '<span class="staal" style="background:linear-gradient(135deg,'
          + (t.over && t.over.gebouw || "#23406E") + ',rgb(' + t.gloed.join(",") + '))"></span>'
          + '<b>' + esc(t.naam) + '</b><span>' + esc(t.kort) + '</span></button>';
      }).join("") + '</div>'
    + '<div class="schakelrij">'
    + schakel("animatie", "Animatie", v.animatie !== false,
        "Lopende agents, knipperende ramen, stofjes. Uit is rustiger en scheelt accu.")
    + schakel("rondloop", "Rondloop standaard aan", v.rondloop === true,
        "Agents verzinnen zelf iets te doen. Verzonnen gedrag, duidelijk gelabeld.")
    + '</div>'
    + '<div class="ins-rij"><div class="ins-kaart"><b>Beeldkwaliteit</b>'
    + '<p>De gloed over de stad is verreweg het duurste om te tekenen. '
    + 'Op automatisch zakt hij vanzelf terug zodra het beeld hapert.</p>'
    + '<select data-voorkeur="kwaliteit">'
    + [["auto","Automatisch"],["hoog","Hoog · volle gloed"],["zuinig","Zuinig · vlot op elk apparaat"]]
        .map(function(o){
          return '<option value="' + o[0] + '"' + ((v.kwaliteit || "auto") === o[0] ? " selected" : "")
            + '>' + o[1] + '</option>'; }).join("")
    + '</select></div>'
    + '<div class="ins-kaart"><b>Hoe vaak verversen</b>'
    + '<p>Hoe vaak de hub je bestanden opnieuw leest.</p>'
    + '<select data-voorkeur="ververs">'
    + [10,20,60,300].map(function(n){
        return '<option value="' + n + '"' + (Number(v.ververs || 20) === n ? " selected" : "") + '>'
          + (n < 60 ? n + " seconden" : (n/60) + " minuten") + '</option>'; }).join("")
    + '</select></div></div></section>';

  doel.innerHTML = h;
}

function schakel(sleutel, titel, aan, uitleg){
  return '<button class="schakel' + (aan ? " aan" : "") + '" data-schakel="' + sleutel + '">'
    + '<i></i><span><b>' + esc(titel) + '</b><em>' + esc(uitleg) + '</em></span></button>';
}

/* ---------- dev ----------
 * Voor als er iets niet werkt: waar draait dit, wat is er gevonden, wat ging
 * er mis, en wat gaf de server letterlijk terug.
 */
function laadDev(){
  return fetch("/api/dev").then(function(r){return r.json();})
    .then(function(d){ devInfo = d; if(view === "dev") renderDev(); })
    .catch(function(){});
}

function renderDev(){
  var doel = el("devblad"); if(!doel) return;
  var d = devInfo;
  var h = '<h2 class="blad-kop">Dev</h2>';

  if(!d){ doel.innerHTML = h + '<p class="note">Ophalen…</p>'; return; }

  var rij = function(k, w, tone){
    return '<div class="devrij"><span>' + esc(k) + '</span><b class="' + (tone||"") + '">' + w + '</b></div>';
  };

  h += '<section class="ins"><h3>Deze machine</h3><div class="devlijst">'
    + rij("workspace", '<code>' + esc(d.workspace) + '</code>')
    + rij("node", esc(d.node) + " · " + esc(d.platform))
    + rij("adres", esc(d.host) + ":" + d.poort)
    + rij("slot", d.slot ? "aan" : "uit", d.slot ? "ok" : "wait")
    + rij("geheugen", esc(d.geheugen))
    + rij("draait sinds", esc(String(d.draaitSinds).replace("T"," ").slice(0,19)))
    + rij("claude code", d.claudecode.beschikbaar ? esc(d.claudecode.versie) : "niet gevonden",
          d.claudecode.beschikbaar ? "ok" : "wait")
    + '</div></section>';

  h += '<section class="ins"><h3>Modellen</h3><div class="devlijst">'
    + rij("bron", esc(d.modellen.bron), d.modellen.bron === "live" ? "ok" : "wait")
    + rij("aantal", d.modellen.aantal)
    + rij("opgehaald", esc(String(d.modellen.opgehaald).replace("T"," ").slice(0,19)))
    + rij("bruikbaar", (d.bruikbaar||[]).map(esc).join(", ") || "geen")
    + '</div>'
    + (d.modellen.problemen && d.modellen.problemen.length
        ? '<div class="devfouten">' + d.modellen.problemen.map(function(p){
            return '<div>' + esc(p) + '</div>'; }).join("") + '</div>'
        : '<p class="note">Geen problemen bij het ophalen.</p>')
    + '</section>';

  h += '<section class="ins"><h3>Omgeving</h3>'
    + (d.omgeving && d.omgeving.length
        ? '<div class="devlijst">' + d.omgeving.map(function(o){
            var i = o.indexOf("=");
            return rij(o.slice(0,i), '<code>' + esc(o.slice(i+1)) + '</code>'); }).join("") + '</div>'
        : '<p class="note">Geen HUB_-variabelen gezet. Alles staat op de standaard.</p>')
    + '</section>';

  /* runs met alles erbij */
  h += '<section class="ins"><h3>Laatste runs</h3>';
  if(!runlijst.length) h += '<p class="note">Nog geen run gedraaid.</p>';
  else h += '<div class="devruns">' + runlijst.slice(0,10).map(function(r, i){
      return '<details><summary><span class="stip" style="background:'
        + (r.fout ? "var(--wait)" : "var(--ok)") + '"></span>'
        + esc(meta(r.agentId).naam) + ' · ' + esc(String(r.begonnen).replace("T"," ").slice(0,19))
        + ' · ' + esc(r.model || "?") + ' · ' + ((r.tokensIn||0)+(r.tokensUit||0)) + ' tk'
        + (r.kosten != null ? ' · $' + r.kosten.toFixed(4) : "")
        + '</summary><pre>' + esc(JSON.stringify(r, null, 2)) + '</pre></details>';
    }).join("") + '</div>';
  h += '</section>';

  /* ruwe antwoorden */
  h += '<section class="ins"><h3>Wat de server teruggeeft</h3>'
    + '<div class="tools">'
    + ["state","modellen","gereedschap","runs","dev","catalogus"].map(function(n){
        return '<button data-ruw="' + n + '"' + (ruwToon === n ? ' class="primary"' : '') + '>/api/' + n + '</button>';
      }).join("")
    + (ruwTekst ? '<button id="ruwKopie" class="quiet">kopiëren</button>' : '')
    + '</div>'
    + (ruwTekst ? '<pre class="ruw">' + esc(ruwTekst) + '</pre>'
                : '<p class="note">Kies een endpoint om het antwoord te zien zoals het is.</p>')
    + '</section>';

  doel.innerHTML = h;
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
  var tab = document.querySelector('.insp-kop .tab[data-insp="live"]');
  if(tab && !tab.classList.contains("aan")) tab.style.color = "var(--busy)";
}

function renderBalk(){
  var b = S.bedrijf;
  if(b){
    var bd = b.bedrijf || {};
    el("bedrijfNaam").textContent = bd.naam || "Validatiedesk";
    /* zonder bedrijfsnaam of omschrijving blijft de ondertitel gewoon staan;
       "operator " zonder naam erachter is geen ondertitel maar een gat */
    el("bedrijfWat").textContent = bd.wat
      || (b.operator ? "van " + b.operator : "lokale werkomgeving");
  }
  var werk=S.agents.filter(function(a){var st=statusOf(a.id);return st==="opgepakt"||st==="nieuw";}).length;
  var open=S.desk.briefs.filter(function(x){return x.status==="nieuw"||x.status==="opgepakt";}).length;
  var jou=S.desk.decisions.filter(function(d){return !d.resolved;}).length;
  el("meters").innerHTML =
      '<span class="meter busy"><b>'+werk+'/'+S.agents.length+'</b><span>aan het werk</span></span>'
    + '<span class="meter"><b>'+open+'</b><span>opdrachten</span></span>'
    + '<span class="meter ok"><b>'+S.drafts.length+'</b><span>rapporten</span></span>'
    + '<span class="meter '+(jou?"wait":"")+'"><b>'+jou+'</b><span>aan jou</span></span>';
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

/* De strook boven de stad: één chip per agent met waar hij mee bezig is.
 * Klik erop en de camera gaat naar zijn gebouw. */
function renderChips(){
  var k=el("kamers"); if(!k) return;
  var h="";
  S.agents.forEach(function(a){
    var p=meta(a.id), st=statusOf(a.id);
    var bs=briefsOf(a.id).filter(function(b){return b.status==="nieuw"||b.status==="opgepakt";});
    var taak = bs.length ? bs[0].topic : (st==="geleverd" ? "rapport klaar" : statusLabel(st));
    if(taak.length>26) taak = taak.slice(0,25)+"\u2026";
    h += '<button data-ga="'+esc(a.id)+'" aria-pressed="'+(sel===a.id?"true":"false")+'">'
      +  '<i style="background:'+(SCOL[st]||"var(--idle)")+'"></i>'
      +  '<b style="color:'+kleurVan(a.id)+'">'+esc(p.naam)+'</b>'
      +  '<span>'+esc(taak)+'</span></button>';
  });
  if(!S.agents.length) h='<span class="leegchip">Nog geen agents. Zet ze neer via de wizard.</span>';
  k.innerHTML=h;
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
  var kanWel = lijst.filter(function(m){ return m.bruikbaar !== false; });
  /* nooit een model voorselecteren dat je niet kunt aanroepen */
  var keuze = (run && run.agentId===agentId ? run.model : null) || modellen.standaard;
  if(!kanWel.some(function(m){return m.id===keuze;})) keuze = kanWel.length ? kanWel[0].id : null;
  var opties = lijst.map(function(m){
    return '<option value="'+esc(m.id)+'"'+(m.id===keuze?" selected":"")+(m.bruikbaar===false?" disabled":"")+'>'
      + esc(m.naam) + ' · ' + esc(m.aanbieder)
      + (m.bruikbaar===false ? " · sleutel nodig" : (m.gratis?" · gratis":"")) + '</option>';
  }).join("");
  var onbruikbaar = lijst.filter(function(m){return m.bruikbaar===false;}).length;
  var bezigHier = run && run.agentId === agentId;
  var h = '<div class="werkbank"><div class="wkop">Aan het werk zetten</div>';
  if(!kanWel.length){
    h += '<div class="empty"><b>Geen bruikbaar model.</b> Alles in de lijst heeft een sleutel nodig die er '
      + 'nog niet is. Zet er een bij <button class="quiet" id="openSleutels" style="padding:0;'
      + 'text-decoration:underline">sleutels</button>, of draai <code>ollama serve</code> op deze machine — '
      + 'dan verschijnen je lokale modellen vanzelf.</div>';
  } else {
    h += '<textarea id="runOpdracht" placeholder="Wat moet hij uitzoeken? Eén concrete vraag."'
      + (bezigHier && run.bezig ? " disabled" : "") + '></textarea>'
      + '<div class="wrij"><select id="runModel">' + opties + '</select>'
      + '<button class="primary" id="runStart">Aan het werk zetten</button>'
      + '<button class="quiet" id="runStop" hidden>Stoppen</button></div>'
      + (onbruikbaar ? '<div class="wnoot waarschuw">' + onbruikbaar
          + ' modellen staan uit omdat er geen sleutel voor is. '
          + '<button class="quiet" id="openSleutels" style="padding:0;text-decoration:underline">Sleutel toevoegen</button></div>' : '')
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
  if(!a){el("panel").innerHTML='<div class="leeg-insp">Kies een agent in de stad, in de sterrenkaart of in de tabel.</div>';return;}
  var p=meta(a.id), bs=briefsOf(a.id), st=statusOf(a.id), kl=kleurVan(a.id);
  var mijn = runlijst.filter(function(r){return r.agentId===a.id;});
  var tokens = mijn.reduce(function(n,r){return n+(r.tokensIn||0)+(r.tokensUit||0);},0);
  var kosten = mijn.reduce(function(n,r){return n+(r.kosten||0);},0);
  var afd = (S.capabilities||[]).filter(function(c){return c.done_by===a.id;});
  var mijnGereedschap = suggestieVoor(a.id);

  var h = '<div class="insp-agent">';

  /* kop */
  h += '<header class="ag-kop" style="--kleur:'+kl+'">'
    + '<div class="ag-zegel"><span>'+esc(p.no)+'</span></div>'
    + '<div class="ag-naam"><h2>'+esc(p.naam)+'</h2>'
    + '<span class="mono">'+esc(a.id)+'</span></div>'
    + '<span class="chip '+(st==="offphase"?"idle":st)+'">'+esc(statusLabel(st))+'</span>'
    + '</header>';

  /* drie cijfers */
  h += '<div class="ag-cijfers">'
    + '<div><b>'+(mijn.length||0)+'</b><span>runs</span></div>'
    + '<div><b>'+(tokens?compact(tokens):"—")+'</b><span>tokens</span></div>'
    + '<div><b>'+(kosten?"$"+kosten.toFixed(2):"—")+'</b><span>kosten</span></div>'
    + '</div>';

  /* wat hij doet */
  h += '<p class="ag-uit">'+esc(a.description.slice(0,300))+'</p>';

  h += '<div class="ag-rij"><span>Doet</span><div>'
    + (afd.length ? afd.map(function(c){
        return '<span class="tag" data-cap="'+esc(c.name)+'">'+esc(c.title)+'</span>'; }).join("")
      : '<span class="tag leeg">nog geen capaciteit</span>') + '</div></div>';

  h += '<div class="ag-rij"><span>Mag</span><div>'
    + mijnGereedschap.map(function(id){
        var g = gereedschap.filter(function(x){return x.id===id;})[0];
        return '<span class="tag'+(g&&g.klaar?"":" uit")+'">'+esc(g?g.naam:id)+'</span>';
      }).join("") + '</div></div>';

  h += '<div class="ag-rij"><span>Staat in</span><div>'
    + '<button class="tag pad" data-lees=".claude/agents/'+esc(a.id)+'.md">.claude/agents/'+esc(a.id)+'.md</button>'
    + (afd.length ? '<button class="tag pad" data-lees="workflows/capabilities/'+esc(afd[0].name)+'.md">workflows/capabilities/'+esc(afd[0].name)+'.md</button>' : '')
    + '<span class="tag stil">model '+esc(a.model)+'</span>'
    + '</div></div>';

  /* werkbank */
  h += werkbank(a.id);

  /* opdrachten */
  h += '<div class="ag-sectie">Opdrachten'+(bs.length?' <em>'+bs.length+'</em>':'')+'</div>';
  if(p.offphase){
    h+='<div class="empty"><b>Deze agent staat stil.</b> Hij hoort bij een latere fase.</div>';
  } else if(!bs.length){
    h+='<div class="empty"><b>Nog geen opdracht.</b> Onderzoek start pas als onderwerp, '
      +'geografie en de te nemen beslissing vaststaan.</div>';
  } else {
    h+='<div class="stack">';bs.forEach(function(b){h+=briefCard(b);});h+='</div>';
  }

  /* laatste runs */
  if(mijn.length){
    h += '<div class="ag-sectie">Laatste runs</div><div class="ag-runs">';
    mijn.slice(0,5).forEach(function(r){
      h += '<div class="ag-run'+(r.fout?" fout":"")+'">'
        + '<span class="w">'+esc(r.fout ? r.fout.slice(0,70) : r.opdracht)+'</span>'
        + '<span class="c mono">'+(r.fout?"mislukt":compact((r.tokensIn||0)+(r.tokensUit||0))+" tk")+'</span>'
        + (r.bestand ? '<button class="quiet" data-read="'+esc(r.bestand)+'">lezen</button>' : '')
        + '</div>';
    });
    h += '</div>';
  }

  /* op de vloer */
  h += '<div class="stuur"><span class="lbl">In de stad</span>'
    + '<button data-stuur="desk">Eigen gebouw</button>'
    + '<button data-stuur="archive">Toren</button>'
    + '<button data-stuur="meeting">Overlegzaal</button>'
    + '<button data-stuur="coffee">Kiosk</button>'
    + '<button data-stuur="lounge">Bankje</button></div>'
    + '<p class="note">Verplaatsen verandert alleen het beeld. Het werk verandert pas '
    + 'als de status van een opdracht wijzigt.</p>';

  if(!p.offphase){
    h+='<details class="adder"><summary>Opdracht toevoegen</summary><div class="body">'
      +'<div class="grid2">'
      +'<div class="full"><label for="f-topic">Onderwerp of probleemgebied</label>'
      +'<input id="f-topic" placeholder="Afgebakend, niet een hele categorie"></div>'
      +'<div><label for="f-geo">Geografie</label><input id="f-geo" placeholder="Nederland"></div>'
      +'<div><label for="f-dec">Welke beslissing dient dit?</label><input id="f-dec" placeholder="Stap ik hier in?"></div>'
      +'<div class="full"><button class="primary" id="f-add">Toevoegen</button></div></div></div></details>';
  }

  el("panel").innerHTML = h + '</div>';
  if(run && run.agentId === sel) renderWerkbank();
}

function zijkant(){
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
    +'<li>In de stad gaan de ramen van zijn gebouw aan; het rapport gaat naar de toren.</li></ol>'
    +'<p class="note">Een agent hier draait <b>zonder gereedschap</b>: geen webtoegang, geen '
    +'bestanden openen. Hij werkt met wat in zijn prompt staat. Voor onderzoek met bronnen zet '
    +'je hem aan in Claude Code — daar heeft hij wel WebSearch en WebFetch. Wat je hier ziet '
    +'bewegen komt van echte runs en echte bestanden, niet van een simulatie.</p>'
    +'</div></section>';
  return h;
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
  /* navigatie */
  document.querySelectorAll("#rail button[data-view]").forEach(function(b){
    b.setAttribute("aria-current", b.dataset.view === view ? "true" : "false");
  });
  document.querySelectorAll(".zicht").forEach(function(z){
    z.classList.toggle("aan", z.dataset.zicht === view);
  });

  renderBalk();

  if(view === "dash"){
    renderDash(); renderPanel();
  } else if(view === "map"){
    /* het doek was verborgen toen de camera zich instelde; opnieuw meten */
    if(vloer){ vloer.office._resize(); if(!vloer.office.zelfGezoomd) vloer.office.fit(); }
    renderChips(); renderTicker(); markeerSelectie(); renderPanel();
  } else if(view === "instel"){
    renderInstellingen();
  } else if(view === "dev"){
    renderDev(); laadDev();
  } else if(view === "ster"){
    var sb = el("sterbox");
    if(sb){ setupSterren(); sterren.setState(S); sterren._resize();
            el("sNu").textContent = (sterren.huidige()||{}).label || ""; }
    renderPanel();
  } else if(view === "hier"){
    el("hier").innerHTML = renderHierarchy();
    el("panel").innerHTML = renderCapability();
  } else if(view === "tools"){
    renderTools(); renderPanel();
  } else if(view === "werk"){
    renderWerkblad(); renderPanel();
  }
}

/* ---------- markdown lezer ---------- */
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
function openBestand(pad){
  fetch("/api/bestand?f="+encodeURIComponent(pad)).then(function(r){return r.json();}).then(function(d){
    if(d.error){ alert(d.error); return; }
    el("reader-title").textContent = d.file;
    el("reader-body").innerHTML = "<pre>"+esc(d.content)+"</pre>";
    el("reader").hidden = false;
  });
}
function openReader(file){
  fetch("/api/draft?f="+encodeURIComponent(file)).then(function(r){return r.json();}).then(function(d){
    if(d.error){alert(d.error);return;}
    el("reader-title").textContent="drafts/"+d.file;
    el("reader-body").innerHTML=md(d.content);
    el("reader").hidden=false;
  });
}
/* ---------- inspecteur ---------- */
function toonInspecteur(pane){
  if(pane === "live"){
    var t2 = document.querySelector('.insp-kop .tab[data-insp="live"]');
    if(t2) t2.style.color = "";
  }
  if(pane){
    document.querySelectorAll(".insp-kop .tab").forEach(function(t){
      t.classList.toggle("aan", t.dataset.insp === pane); });
    document.querySelectorAll(".insp-pane").forEach(function(p){
      p.classList.toggle("aan", p.dataset.pane === pane); });
  }
  if(window.matchMedia("(max-width:900px)").matches) el("inspecteur").classList.add("open");
}

/* ---------- events ---------- */
document.addEventListener("click",function(e){
  var it = e.target.closest(".insp-kop .tab");
  if(it){ toonInspecteur(it.dataset.insp); return; }
  if(e.target.id === "toonInspecteur"){ toonInspecteur(); return; }
  if(e.target.id === "sluitInspecteur"){ el("inspecteur").classList.remove("open"); return; }
  if(e.target.id === "railSleutels"){ view = "instel"; renderAll(); return; }
  var vt=e.target.closest("[data-view]");
  if(vt){ view=vt.dataset.view; renderAll(); return; }
  var cp=e.target.closest("[data-cap]");
  if(cp){ capSel=cp.dataset.cap; renderAll(); return; }
  var doe=e.target.closest("[data-doe]");
  if(doe){ doeVoorstel(doe.dataset.v, doe.dataset.doe); return; }
  var weg=e.target.closest("[data-weg]");
  if(weg){ legWeg(weg.dataset.weg, false); return; }
  var terug=e.target.closest("[data-terug]");
  if(terug){
    ((S.desk || {}).verborgen || []).slice().forEach(function(id){ legWeg(id, true); });
    return;
  }
  var th=e.target.closest("[data-thema]");
  if(th){ bewaarVoorkeur("thema", th.dataset.thema); return; }
  var sk=e.target.closest("[data-schakel]");
  if(sk){
    var nu = voorkeuren();
    var aan = sk.dataset.schakel === "animatie" ? nu.animatie !== false : nu[sk.dataset.schakel] === true;
    bewaarVoorkeur(sk.dataset.schakel, !aan);
    if(sk.dataset.schakel === "rondloop" && vloer) vloer.setDemo(!aan);
    return;
  }
  var rw=e.target.closest("[data-ruw]");
  if(rw){
    ruwToon = rw.dataset.ruw; ruwTekst = "ophalen…"; renderDev();
    fetch("/api/" + ruwToon).then(function(r){return r.json();})
      .then(function(d){ ruwTekst = JSON.stringify(d, null, 2); renderDev(); })
      .catch(function(err){ ruwTekst = "mislukt: " + err; renderDev(); });
    return;
  }
  if(e.target.id === "ruwKopie"){
    navigator.clipboard && navigator.clipboard.writeText(ruwTekst);
    e.target.textContent = "gekopieerd";
    setTimeout(function(){ e.target.textContent = "kopiëren"; }, 1400);
    return;
  }
  if(e.target.id === "bBedrijf"){
    var knop = e.target; knop.disabled = true;
    fetch("/api/bedrijf", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ operator: el("iOperator").value,
        bedrijf: { naam: el("iNaam").value, wat: el("iWat").value,
                   soort: el("iSoort").value, fase: el("iFase").value } }) })
      .then(function(r){ if(!r.ok) throw 0; return load(); })
      .then(function(){ pill("bedrijf bijgewerkt","ok"); })
      .catch(function(){ pill("opslaan mislukt","err"); })
      .finally(function(){ knop.disabled = false; });
    return;
  }
  var ga=e.target.closest("[data-ga]");
  if(ga){ sel=ga.dataset.ga; if(vloer){ vloer.select(sel); vloer.focus(sel); }
          markeerSelectie(); renderChips(); renderPanel(); return; }
  var st=e.target.closest("[data-stuur]");
  if(st){ if(vloer && sel) vloer.office.send(sel, st.dataset.stuur); return; }
  var t=e.target.closest("[data-pick]");
  if(t){ sel=t.dataset.pick; markeerSelectie(); renderPanel(); return; }
  var rd=e.target.closest("[data-read]");
  if(rd){ openReader(rd.dataset.read); return; }
  var lz=e.target.closest("[data-lees]");
  if(lz){ openBestand(lz.dataset.lees); return; }
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
  if(e.target.id==="openSleutels"){ view = "instel"; renderAll(); return; }
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
document.addEventListener("change", function(e){
  var v = e.target.closest("[data-voorkeur]");
  if(v) bewaarVoorkeur(v.dataset.voorkeur, v.value === "" ? null
    : (isNaN(Number(v.value)) ? v.value : Number(v.value)));
});
document.addEventListener("keydown",function(e){ if(e.key==="Escape") el("reader").hidden=true; });

setInterval(function(){
  var d=new Date();
  var c=el("clock"); if(c) c.textContent=d.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
},1000);

setupVloer();
load();
laadModellen();
laadSoorten();
laadGereedschap();
laadRuns();
ververser = setInterval(load, ververstijd);
})();
