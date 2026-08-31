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
var view = "dash";           // dash | map | ster | hier | tools | werk
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
    onSelect: function(id){ sel = id; markeerSelectie(); renderPanel(); toonInspecteur("agent"); },
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

  /* de kop: één groot getal, de stand van je bedrijf */
  h += '<section class="held">'
    + '<div class="held-cijfer"><b>' + bemand + '<span>/' + caps.length + '</span></b>'
    + '<span class="held-label">capaciteiten bemand</span></div>'
    + '<div class="held-meter">' + meter(bemand, caps.length, "var(--busy)")
    + '<p>' + (caps.length - bemand) + ' staan er nog op papier. Dat werk doe jij nu zelf.</p></div>'
    + '</section>';

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
  var h = '<h2 class="blad-kop">Gereedschap</h2>'
    + '<p class="blad-uit">Wat een agent tijdens een run mag doen. Alles hier is alleen-lezen: '
    + 'hij kan zoeken, lezen en kijken, maar niet zelf schrijven. Het rapport wordt aan het eind '
    + 'door de hub weggeschreven, zodat er nooit iets ongemerkt verandert. '
    + '<b>' + klaar + ' van de ' + gereedschap.length + '</b> zijn nu bruikbaar.</p>'
    + '<div class="biblio">';
  gereedschap.forEach(function(g){
    var gebruikers = S.agents.filter(function(a){ return suggestieVoor(a.id).indexOf(g.id)>=0; });
    h += '<article class="gkaart' + (g.klaar?"":" uit") + '">'
      + '<div class="kop"><div class="ic">' + esc(g.icoon||"·") + '</div>'
      + '<h3>' + esc(g.naam) + '</h3>'
      + '<span class="status ' + (g.klaar?"aan":"uit") + '">' + (g.klaar?"klaar":"uit") + '</span></div>'
      + '<p>' + esc(g.kort) + '</p>'
      + '<p class="waarom">' + esc(g.waarom) + '</p>'
      + '<div class="voet">' + (g.klaar
          ? '<b>Via</b> ' + esc(g.via)
          : '<b>Nodig</b> ' + esc(g.reden || g.nodig)) + '</div>';
    if(gebruikers.length){
      h += '<div class="gebruikers">' + gebruikers.map(function(a){
        return '<span>' + esc(meta(a.id).naam) + '</span>'; }).join("") + '</div>';
    }
    h += '</article>';
  });
  h += '</div>';

  h += '<div class="blad-sectie">Wie mag wat</div><div class="stack">';
  S.agents.forEach(function(a){
    var s2 = suggestieVoor(a.id);
    h += '<div class="card"><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">'
      + '<b>' + esc(meta(a.id).no + " " + meta(a.id).naam) + '</b>'
      + '<span class="mono" style="font-size:11px;color:var(--ink-faint)">' + esc(a.id) + '</span></div>'
      + '<div class="gebruikers">' + s2.map(function(id){
          var g = gereedschap.filter(function(x){return x.id===id;})[0];
          return '<span style="' + (g && g.klaar ? "" : "opacity:.5") + '">'
            + esc(g ? g.naam : id) + '</span>';
        }).join("") + '</div></div>';
  });
  h += '</div>';
  doel.innerHTML = h;
}

/* ---------- werkblad: runs, beslissingen, rapporten ---------- */
var runlijst = [];
function laadRuns(){
  return fetch("/api/runs").then(function(r){return r.json();})
    .then(function(d){ runlijst = d.runs || []; if(view==="werk") renderWerkblad(); })
    .catch(function(){});
}

function renderWerkblad(){
  var doel = el("werkblad"); if(!doel) return;
  var h = '<h2 class="blad-kop">Werk</h2>'
    + '<p class="blad-uit">Wat er gedraaid heeft, wat er ligt, en wat er op jou wacht.</p>';

  h += '<div class="blad-sectie">Runs</div>';
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
    el("bedrijfNaam").textContent = (b.bedrijf||{}).naam || "Validatiedesk";
    el("bedrijfWat").textContent  = (b.bedrijf||{}).wat || ("operator " + (b.operator||""));
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
    return '<option value="'+esc(m.id)+'"'+(m.id===keuze?" selected":"")+(m.bruikbaar===false?" disabled":"")+'>'
      + esc(m.naam) + ' · ' + esc(m.aanbieder)
      + (m.bruikbaar===false ? " · sleutel nodig" : (m.gratis?" · gratis":"")) + '</option>';
  }).join("");
  var onbruikbaar = lijst.filter(function(m){return m.bruikbaar===false;}).length;
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
    +'<li>Op de vloer gaat hij zitten, werkt, en levert af.</li></ol>'
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
    renderHud(); renderKamers(); renderTicker(); markeerSelectie(); renderPanel();
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
  if(e.target.id === "railSleutels"){ toonSleutels(); return; }
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
laadGereedschap();
laadRuns();
setInterval(load, 20000);
})();
