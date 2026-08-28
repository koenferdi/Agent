/* ═══════════════════════════════════════════════════════════
   AI-dossier — applicatielogica
   Geen framework, geen bouwstap, geen server. Alles draait
   in de browser van de bezoeker; er verlaat geen enkel
   bedrijfsgegeven het apparaat.
   ═══════════════════════════════════════════════════════════ */

/* ─────────── CONFIGURATIE — pas deze vier regels aan ─────────── */
const CONFIG = {
  PAY_URL:       "https://buy.stripe.com/VERVANG-DIT",
  UNLOCK_TOKEN:  "Xbylu7gzK6uZqJWbIKm46yQKrURD4BUFbmQ0w2de2qA",
  BACKUP_CODES:  ["DOSSIER26"],
  LEAD_ENDPOINT: ""   // bv. https://formspree.io/f/xxxxxxxx — leeg = knop meldt dat het uitstaat
};
/* ────────────────────────────────────────────────────────────── */

const $  = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const REF = "AID-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" +
            Math.random().toString(36).slice(2, 5).toUpperCase();

$("ref").textContent   = "Dossier " + REF;
$("paylink").href      = CONFIG.PAY_URL;
$("f_datum").value     = new Date().toISOString().slice(0, 10);

/* ═══════════════ ANIMATIESTURING ═══════════════ */

/* schaduw onder de navigatiebalk zodra je scrolt */
addEventListener("scroll", () => {
  $("nav").classList.toggle("stuck", scrollY > 12);
}, { passive: true });

/* secties die binnenkomen bij het scrollen */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  });
}, { threshold: .12, rootMargin: "0px 0px -8% 0px" });
$$(".reveal").forEach(el => io.observe(el));

/* de dagenteller loopt op zodra hij in beeld komt */
const DAYS = Math.max(0, Math.floor((Date.now() - new Date("2025-02-02")) / 864e5));
function countUp(el, target, ms) {
  if (REDUCED) { el.textContent = target.toLocaleString("nl-NL"); return; }
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString("nl-NL");
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const dayIO = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { countUp($("dayCount"), DAYS, 1500); dayIO.disconnect(); } });
}, { threshold: .5 });
dayIO.observe($("dayCount"));

/* ═══════════════ DE SCAN ═══════════════ */

const Q = [
  { k: "gebruik", t: "Wordt er in je organisatie AI gebruikt?",
    h: "Ook als niemand het zo noemt. ChatGPT, Copilot, Claude, Gemini, een AI-functie in je boekhoud- of CRM-pakket, een chat op de website.",
    o: [["ja", "Ja, dat weet ik zeker"], ["waarschijnlijk", "Waarschijnlijk wel, ik heb geen overzicht"], ["nee", "Nee, echt niet"]] },

  { k: "aantal", t: "Hoeveel mensen raken AI aan in hun werk?",
    h: "Een ruwe schatting volstaat. Dit bepaalt hoe zwaar je maatregelen moeten zijn.",
    o: [["1", "Alleen ikzelf"], ["2-9", "2 tot 9"], ["10-49", "10 tot 49"], ["50+", "50 of meer"]] },

  { k: "doel", t: "Waarvoor wordt het zwaarst ingezet?",
    h: "Beslissingen óver mensen vallen in een heel andere categorie dan tekst schrijven. Kies wat het meest weegt.",
    o: [["tekst", "Teksten, samenvattingen, vertalingen"], ["klant", "Klantcontact — chatbot of e-mailantwoorden"],
        ["analyse", "Analyse van cijfers of documenten"], ["mensen", "Beslissingen over personen — werving, beoordeling, krediet"]] },

  { k: "register", t: "Ligt er een lijst van welke AI-systemen in gebruik zijn?",
    h: "Dit is doorgaans het eerste wat een toezichthouder of auditor opvraagt.",
    o: [["ja", "Ja, actueel en op schrift"], ["deels", "Deels, of verouderd"], ["nee", "Nee"]] },

  { k: "beleid", t: "Is er een schriftelijk AI-beleid?",
    h: "Afspraken over welke tools mogen, welke gegevens er niet in mogen, en wie de uitkomst controleert.",
    o: [["ja", "Ja, vastgelegd en gedeeld"], ["mondeling", "Er zijn afspraken, maar niet op papier"], ["nee", "Nee"]] },

  { k: "instructie", t: "Hebben medewerkers uitleg gehad over de risico's?",
    h: "Hallucinaties, vertrouwelijke gegevens, en wanneer je een uitkomst niet zomaar mag overnemen.",
    o: [["formeel", "Ja, via een training of sessie"], ["informeel", "Losse tips, niets georganiseerds"], ["nee", "Nee"]] },

  { k: "bewijs", t: "Kun je aantonen wie wanneer wat heeft gehad?",
    h: "Dit is de kern van artikel 4. Maatregelen nemen telt pas als je ze kunt laten zien.",
    o: [["ja", "Ja, er is een registratie"], ["nee", "Nee, niets vastgelegd"]] },

  { k: "transparantie", t: "Praat er een chatbot met je klanten, of publiceer je AI-content?",
    h: "Artikel 50 verplicht je om mensen te laten weten dat ze met AI te maken hebben.",
    o: [["chatbot", "Ja, een chatbot of AI-antwoordfunctie"], ["content", "Ja, we publiceren AI-gegenereerde tekst of beeld"],
        ["beide", "Allebei"], ["nee", "Geen van beide"]] },

  { k: "eigenaar", t: "Is er iemand aangewezen die hierover gaat?",
    h: "Bij een klein bedrijf is dat vaak gewoon de eigenaar. Het gaat erom dát het benoemd is.",
    o: [["ja", "Ja, met naam"], ["nee", "Nee, niemand specifiek"]] }
];

let idx = 0;
const A = {};

function paint() {
  const q = Q[idx];
  $("qmeta").textContent = "Vraag " + (idx + 1) + " van " + Q.length;
  $("qt").textContent = q.t;
  $("qh").textContent = q.h;
  $("bar").style.width = Math.round((idx + 1) / Q.length * 100) + "%";
  $("back").style.visibility = idx === 0 ? "hidden" : "visible";
  $("note").textContent = idx === 0 ? "Je antwoorden verlaten je browser niet." : "";

  const box = $("opts");
  box.innerHTML = "";
  q.o.forEach(([val, label], n) => {
    const l = document.createElement("label");
    l.className = "opt opt-in" + (A[q.k] === val ? " sel" : "");
    l.style.setProperty("--o", n);
    l.innerHTML = '<input type="radio" name="q' + idx + '"' + (A[q.k] === val ? " checked" : "") +
                  '><span>' + label + "</span>";
    l.querySelector("input").addEventListener("change", () => {
      A[q.k] = val;
      l.classList.add("sel");
      setTimeout(() => step(+1), 200);
    });
    box.appendChild(l);
  });
}

/* zijwaartse overgang tussen vragen */
function step(dir) {
  if (dir > 0 && Q[idx].k === "gebruik" && A.gebruik === "nee") return finish();
  const last = dir > 0 && idx === Q.length - 1;
  if (last) return finish();
  if (dir < 0 && idx === 0) return;

  const stage = $("qstage");
  if (REDUCED) { idx += dir; paint(); return; }
  stage.classList.add(dir > 0 ? "out-l" : "out-r");
  setTimeout(() => {
    idx += dir;
    paint();
    stage.classList.remove("out-l", "out-r");
  }, 185);
}
$("back").addEventListener("click", () => step(-1));

/* ═══════════════ UITKOMST ═══════════════ */

function gaps() {
  const g = [];
  if (A.beleid !== "ja") g.push({ a: "Artikel 4", t: "Geen schriftelijk AI-beleid",
    d: "Mondelinge afspraken zijn niet aantoonbaar. Een toezichthouder vraagt naar een document, niet naar een gewoonte." });
  if (A.register !== "ja") g.push({ a: "Artikel 4", t: "Geen actueel register van AI-systemen",
    d: "Zonder overzicht van wat er draait kun je niet onderbouwen dat je maatregelen passend zijn." });
  if (A.instructie !== "formeel" || A.bewijs !== "ja") g.push({ a: "Artikel 4", t: "Geletterdheid niet aantoonbaar vastgelegd",
    d: "De verplichting is inspanning én bewijs. Zonder registratie van wie wat kreeg ontbreekt de helft." });
  if (A.transparantie && A.transparantie !== "nee") g.push({ a: "Artikel 50", t: "Transparantieplicht niet afgedekt",
    d: "Mensen moeten weten dat ze met AI communiceren, en AI-gegenereerde content moet als zodanig herkenbaar zijn." });
  if (A.eigenaar !== "ja") g.push({ a: "Artikel 4", t: "Niemand aangewezen als verantwoordelijke",
    d: "Zonder eigenaar verjaart elk beleid vanzelf. Eén naam volstaat." });
  if (A.doel === "mensen") g.push({ a: "Bijlage III", t: "Mogelijk een hoogrisico-toepassing",
    d: "AI bij werving, beoordeling of kredietwaardigheid valt zwaarder onder de verordening, met eigen verplichtingen. Deze scan dekt dat niet af — laat dit juridisch toetsen." });
  return g;
}

function finish() {
  const g = gaps();
  $("scan").hidden = true;
  $("result").hidden = false;

  const s = $("score");
  s.className = "score" + (g.length === 0 ? " good" : "");
  $("scoreLbl").textContent = g.length === 1 ? "hiaat" : "hiaten";
  countUp($("scoreNum"), g.length, 600);

  if (A.gebruik === "nee") {
    $("vtitle").textContent = "Voorlopig buiten schot — maar controleer dat.";
    $("vtext").textContent = "AI zit tegenwoordig ingebouwd in gewone software: in je e-mailprogramma, je boekhouding, je telefooncentrale. Loop je pakketten na voordat je concludeert dat je niets gebruikt.";
  } else if (g.length === 0) {
    $("vtitle").textContent = "Je dossier is compleet.";
    $("vtext").textContent = "Ongebruikelijk, en goed nieuws. Zet wel een herzieningsdatum in je agenda: zodra je een nieuw AI-systeem in gebruik neemt loopt dit weer achter.";
  } else {
    $("vtitle").textContent = g.length === 1 ? "Eén stuk ontbreekt." : "Er ontbreken " + g.length + " stukken.";
    $("vtext").textContent = "Je hoeft geen cursus in te kopen. De verplichting is dat je kunt laten zien welke maatregelen je hebt genomen — en dat is administratie die je vandaag op orde kunt brengen.";
  }

  $("gaps").innerHTML = g.length
    ? g.map((x, n) => '<div class="gap" style="--g:' + n + '"><span class="pill">' + x.a +
        '</span><div><h3>' + x.t + "</h3><p>" + x.d + "</p></div></div>").join("")
    : '<div class="gap"><span class="pill ok">In orde</span><div><h3>Geen hiaten gevonden</h3>' +
      "<p>Op basis van je antwoorden. Bewaar je stukken op één plek en herzie ze jaarlijks.</p></div></div>";

  $("result").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
}

/* ═══════════════ E-MAILOPVANG ═══════════════ */

$("leadBtn").addEventListener("click", () => {
  const m = $("mail").value.trim(), box = $("leadmsg");
  const fail = t => { box.className = "msg on bad"; box.textContent = t; };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(m)) return fail("Vul een geldig e-mailadres in.");
  if (!CONFIG.LEAD_ENDPOINT) return fail("Verzenden staat nog niet ingesteld. Zet LEAD_ENDPOINT in assets/app.js.");

  box.className = "msg on"; box.style.color = "var(--t3)"; box.textContent = "Bezig…";
  fetch(CONFIG.LEAD_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: m, dossier: REF, hiaten: gaps().map(x => x.t), antwoorden: A })
  })
    .then(r => { if (!r.ok) throw 0;
      box.className = "msg on good"; box.textContent = "Verstuurd. Kijk ook even in je spam.";
      $("mail").value = ""; })
    .catch(() => fail("Versturen lukte niet. Probeer het zo nog eens."));
});

/* ═══════════════ ONTGRENDELEN ═══════════════ */

function unlock() {
  $("offer").hidden = true;
  $("leadbox").hidden = true;
  $("builder").hidden = false;
  if (!$$(".sysrow").length) addRow();
  $("builder").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
}
$("codeBtn").addEventListener("click", () => {
  const v = $("code").value.trim().toUpperCase();
  if (CONFIG.BACKUP_CODES.map(c => c.toUpperCase()).includes(v)) unlock();
  else { const b = $("codemsg"); b.className = "msg on bad"; b.textContent = "Die code klopt niet. Kijk in je bevestigingsmail."; }
});
/* ═══════════════ SYSTEEMRIJEN ═══════════════ */

const DOELEN = [
  ["",            "— kies een doel —",                     "",   ""],
  ["tekst",       "Teksten en samenvatten",                "r1", "Minimaal risico"],
  ["analyse",     "Analyse van bedrijfsdata",              "r1", "Minimaal risico"],
  ["intern",      "Interne kennis doorzoeken",             "r1", "Minimaal risico"],
  ["chatbot",     "Klantcontact via chatbot",              "r2", "Transparantieplicht — artikel 50"],
  ["content",     "Publicatie van AI-tekst of -beeld",     "r2", "Transparantieplicht — artikel 50"],
  ["werving",     "Werving en selectie",                   "r3", "Mogelijk hoog risico — bijlage III"],
  ["beoordeling", "Beoordeling of promotie van personeel", "r3", "Mogelijk hoog risico — bijlage III"],
  ["krediet",     "Krediet- of verzekeringsbeoordeling",   "r3", "Mogelijk hoog risico — bijlage III"],
  ["toegang",     "Toegang tot onderwijs of voorzieningen","r3", "Mogelijk hoog risico — bijlage III"],
  ["biometrie",   "Biometrie of gezichtsherkenning",       "r3", "Mogelijk hoog risico — bijlage III"],
  ["emotie",      "Emotieherkenning bij medewerkers",      "r4", "Vermoedelijk verboden — artikel 5"]
];

function addRow() {
  const d = document.createElement("div");
  d.className = "sysrow";
  d.innerHTML =
    '<input class="t" placeholder="Systeem, bv. Copilot">' +
    '<input class="t" placeholder="Leverancier">' +
    '<select class="t">' + DOELEN.map(o => '<option value="' + o[0] + '">' + o[1] + "</option>").join("") + "</select>" +
    '<button class="kill" type="button" title="Verwijderen">&times;</button>' +
    '<div class="risk"></div>';
  const sel = d.querySelector("select");
  sel.addEventListener("change", () => {
    const o = DOELEN.find(x => x[0] === sel.value), r = d.querySelector(".risk");
    r.className = "risk " + (o[2] || "");
    r.textContent = o[3] ? "Indicatie: " + o[3] : "";
  });
  d.querySelector(".kill").addEventListener("click", () => d.remove());
  $("sysrows").appendChild(d);
}
$("addRow").addEventListener("click", addRow);

function systems() {
  return $$(".sysrow").map(r => {
    const inp = r.querySelectorAll("input"), sel = r.querySelector("select");
    const o = DOELEN.find(x => x[0] === sel.value) || DOELEN[0];
    return { naam: inp[0].value.trim(), lev: inp[1].value.trim(), doel: o[1], risico: o[3] || "—", code: o[0] };
  }).filter(s => s.naam);
}

/* ═══════════════ DOCUMENTEN ═══════════════ */

const g_ = id => ($(id).value || "").trim();
const esc = s => (s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const nlDate = s => { if (!s) return "……………"; const [y, m, d] = s.split("-"); return d + "-" + m + "-" + y; };

const head = t => '<div class="dh"><div class="t">' + t + '</div><div class="m">' +
  (esc(g_("f_org")) || "………………") + "<br>" + (g_("f_kvk") ? "KvK " + esc(g_("f_kvk")) + "<br>" : "") +
  "Dossier " + REF + "<br>" + nlDate(g_("f_datum")) + "</div></div>";

const note = x => '<div class="note"><b>Status van dit document.</b> Dit is een intern stuk dat ' +
  (esc(g_("f_org")) || "de organisatie") + ' zelf vaststelt en ondertekent. Het is geen certificaat en geen ' +
  'juridisch advies. Artikel 4 van Verordening (EU) 2024/1689 schrijft geen vaste vorm, cursus of certificering ' +
  'voor; wat telt is dat de maatregelen passend zijn bij rol en risico, en aantoonbaar.' + (x ? " " + x : "") + "</div>";

const sign = () => '<div class="sig"><div>' + (esc(g_("f_pers")) || "Naam") + ", " +
  (esc(g_("f_rol")) || "functie") + "<br>Handtekening</div><div>" +
  (esc(g_("f_plaats")) || "Plaats") + ", " + nlDate(g_("f_datum")) + "</div></div>";

function make(type) {
  const org  = esc(g_("f_org"))  || "………………………………";
  const pers = esc(g_("f_pers")) || "………………";
  const rol  = esc(g_("f_rol"))  || "………………";
  const sys  = systems();
  const heeftChat = sys.some(s => ["chatbot", "content"].includes(s.code)) ||
                    (A.transparantie && A.transparantie !== "nee");
  const heeftMens = sys.some(s => ["werving", "beoordeling", "krediet", "toegang", "biometrie", "emotie"].includes(s.code)) ||
                    A.doel === "mensen";
  let h = "";

  if (type === "beleid") {
    h = head("AI-gebruiksbeleid") +
      "<h5>1. Waarom dit beleid er is</h5><p>" + org + " gebruikt AI-systemen in de bedrijfsvoering. Artikel 4 van de AI-verordening verplicht ons ervoor te zorgen dat iedereen die daarmee werkt er voldoende van begrijpt. Dit document legt de afspraken vast. Het geldt voor medewerkers, ingehuurd personeel en stagiairs.</p>" +
      "<h5>2. Wie erover gaat</h5><p>" + pers + " (" + rol + ") is aangewezen als verantwoordelijke voor AI-gebruik binnen " + org + ". Vragen, incidenten en verzoeken om een nieuw systeem in gebruik te nemen gaan naar deze persoon.</p>" +
      "<h5>3. Toegestane systemen</h5>" +
      (sys.length
        ? "<table><thead><tr><th>Systeem</th><th>Leverancier</th><th>Waarvoor</th></tr></thead><tbody>" +
          sys.map(s => "<tr><td>" + esc(s.naam) + "</td><td>" + esc(s.lev || "—") + "</td><td>" + esc(s.doel) + "</td></tr>").join("") +
          "</tbody></table><p>Een systeem dat hier niet in staat wordt niet voor werk gebruikt zonder voorafgaande toestemming.</p>"
        : "<p>De toegestane systemen staan in het Register van AI-systemen. Wat daar niet in staat wordt niet voor werk gebruikt zonder voorafgaande toestemming.</p>") +
      "<h5>4. Wat er niet in mag</h5><ul><li>Persoonsgegevens van klanten, medewerkers of patiënten, tenzij het systeem daarvoor is goedgekeurd en er een verwerkersovereenkomst ligt.</li><li>Bedrijfsvertrouwelijke informatie: offertes, contracten, broncode, cijfers die nog niet openbaar zijn.</li><li>Inloggegevens, wachtwoorden en sleutels.</li><li>Materiaal van derden waarop wij geen rechten hebben.</li></ul>" +
      "<h5>5. Je blijft zelf verantwoordelijk voor de uitkomst</h5><p>AI-systemen produceren regelmatig antwoorden die overtuigend klinken en niet kloppen. Wie AI gebruikt controleert het resultaat voordat het naar buiten gaat of in een beslissing wordt verwerkt. Feiten, cijfers, namen, bedragen, citaten en verwijzingen worden nagelopen aan een betrouwbare bron.</p>" +
      (heeftMens
        ? "<h5>6. Beslissingen over personen</h5><p>Wij zetten AI in bij processen die personen raken. Daarvoor gelden extra afspraken:</p><ul><li>AI levert hooguit input. De beslissing wordt altijd door een mens genomen, op basis van eigen afweging, en die afweging wordt vastgelegd.</li><li>Betrokkenen worden geïnformeerd dat AI is gebruikt bij de voorbereiding, en kunnen daar bezwaar tegen maken.</li><li>Wij controleren periodiek op systematische benadeling van groepen.</li><li>Dit type toepassing valt mogelijk onder bijlage III van de verordening. " + org + " laat toetsen of aanvullende verplichtingen gelden.</li></ul>"
        : "<h5>6. Beslissingen over personen</h5><p>AI neemt geen beslissingen over mensen. Bij werving, beoordeling, ontslag, krediet of toegang tot voorzieningen beslist altijd een mens, op basis van eigen afweging.</p>") +
      (heeftChat
        ? "<h5>7. Zichtbaarheid naar buiten</h5><p>Wij communiceren met klanten via een geautomatiseerd systeem en publiceren AI-ondersteunde content. Conform artikel 50 wordt vóór het eerste contact gemeld dat het om een automatische assistent gaat, is er een route naar een medewerker, en wordt AI-gegenereerd beeld of geluid als zodanig gemarkeerd.</p>"
        : "<h5>7. Zichtbaarheid naar buiten</h5><p>Als wij AI gaan inzetten in klantcontact of publicatie, melden wij dat vooraf conform artikel 50.</p>") +
      "<h5>8. Als er iets misgaat</h5><p>Fouten met AI worden gemeld bij " + pers + ", ook als er geen schade is ontstaan. Melden heeft geen gevolgen voor de melder; niet melden wel. Meldingen worden gebruikt om dit beleid bij te stellen.</p>" +
      "<h5>9. Geldigheid</h5><p>Vastgesteld op " + nlDate(g_("f_datum")) + ". Wordt jaarlijks herzien, en eerder zodra een nieuw AI-systeem in gebruik wordt genomen of de regelgeving wijzigt.</p>" +
      sign() + note();
  }

  if (type === "register") {
    const rows = sys.map(s => "<tr><td>" + esc(s.naam) + "</td><td>" + esc(s.lev) + "</td><td>" +
      esc(s.doel) + "</td><td>" + esc(s.risico) + "</td><td></td><td></td></tr>").join("");
    const blanks = Array(Math.max(3, 8 - sys.length))
      .fill("<tr><td class='blank'></td><td></td><td></td><td></td><td></td><td></td></tr>").join("");
    const flag = sys.filter(s => s.code === "emotie");
    h = head("Register van AI-systemen") +
      "<p>Overzicht van de AI-systemen die binnen " + org + " worden gebruikt, bijgehouden ten behoeve van artikel 4 van de AI-verordening. Bijgewerkt op " + nlDate(g_("f_datum")) + " door " + pers + ".</p>" +
      "<table><thead><tr><th>Systeem</th><th>Leverancier</th><th>Waarvoor</th><th>Risico-indicatie</th><th>Persoonsgegevens</th><th>In gebruik sinds</th></tr></thead><tbody>" + rows + blanks + "</tbody></table>" +
      (flag.length ? "<h5>Let op</h5><p>Voor " + flag.map(s => esc(s.naam)).join(", ") + " is emotieherkenning bij medewerkers opgegeven. Artikel 5 van de verordening verbiedt emotieherkenning op de werkvloer, op enkele uitzonderingen na. Staak dit gebruik en leg de situatie voor aan een jurist.</p>" : "") +
      "<h5>Toelichting bij het invullen</h5><ul><li>Neem ook AI-functies op die in bestaande software zitten: samenvatten in e-mail, suggesties in je boekhoudpakket, spraak-naar-tekst, de chat op je website.</li><li>Vul bij <i>Persoonsgegevens</i> in welke categorie erin gaat, of \"geen\".</li><li>Verwijder systemen die je niet meer gebruikt niet, maar zet er een einddatum bij.</li></ul>" +
      sign() + note("De risico-indicatie in dit register is een eerste inschatting op basis van het opgegeven doel, geen classificatie in de zin van de verordening.");
  }

  if (type === "training") {
    const mw = g_("f_mw").split("\n").map(s => s.trim()).filter(Boolean);
    const rows = (mw.length ? mw : Array(8).fill("")).map(n =>
      "<tr><td class='blank'>" + esc(n) + "</td><td></td><td></td><td></td></tr>").join("");
    const niveau = A.aantal === "1"
      ? "Als eenmanszaak betreft dit de ondernemer zelf."
      : "De maatregelen zijn afgestemd op de rol: wie AI incidenteel voor tekst gebruikt heeft een ander niveau nodig dan wie er beslissingen mee voorbereidt.";
    h = head("AI-geletterdheid: maatregelen en registratie") +
      "<p>Dit document legt vast welke maatregelen " + org + " heeft genomen om te voldoen aan artikel 4 van de AI-verordening, en wie daaraan heeft deelgenomen.</p>" +
      "<h5>1. Wat de verplichting inhoudt</h5><p>Artikel 4 verplicht aanbieders en gebruiksverantwoordelijken van AI-systemen om maatregelen te nemen voor een toereikend niveau van AI-geletterdheid bij hun personeel. De verordening schrijft geen specifieke cursus, urenaantal of certificering voor. De maatregelen moeten passen bij de technische kennis, ervaring en rol van de betrokkene en bij het risico van het systeem. " + niveau + "</p>" +
      "<h5>2. Genomen maatregelen</h5><ol><li><b>Instructie.</b> Medewerkers krijgen uitleg over wat de gebruikte systemen doen, waar de grenzen van hun betrouwbaarheid liggen, en wanneer een uitkomst niet zonder controle mag worden overgenomen.</li><li><b>Beleid.</b> Het AI-gebruiksbeleid is gedeeld en toegankelijk voor iedereen die met AI werkt.</li><li><b>Huisregels.</b> De AI-huisregels hangen zichtbaar op de werkplek.</li><li><b>Aanspreekpunt.</b> " + pers + " is aangewezen als vast aanspreekpunt voor vragen en meldingen.</li><li><b>Herhaling.</b> Bij indiensttreding en bij ingebruikname van een nieuw systeem wordt de instructie herhaald.</li><li><b>Vastlegging.</b> Deelname wordt geregistreerd in de lijst hieronder.</li></ol>" +
      "<h5>3. Behandelde onderwerpen</h5><ul><li>Wat een AI-systeem is, en waar het in onze eigen software zit</li><li>Hallucinaties: waarom een fout antwoord er net zo overtuigend uitziet als een goed antwoord</li><li>Welke gegevens er niet in mogen, en waarom</li><li>De controleplicht op de uitkomst, en wie daarvoor verantwoordelijk is</li><li>Wanneer een mens moet beslissen</li><li>Hoe je een fout meldt</li></ul>" +
      "<h5>4. Deelnameregistratie</h5><table><thead><tr><th>Naam</th><th>Functie</th><th>Datum</th><th>Handtekening</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      sign() + note("Bewaar dit document samen met het AI-gebruiksbeleid en het systeemregister.");
  }

  if (type === "transparantie") {
    h = head("Transparantie-checklist — artikel 50") +
      "<p>Artikel 50 van de AI-verordening verplicht tot openheid wanneer mensen met AI te maken krijgen. Deze lijst wordt door " + org + " periodiek doorlopen en afgetekend.</p>" +
      "<table><thead><tr><th style='width:56%'>Punt</th><th>In orde</th><th>Actie / datum</th></tr></thead><tbody>" +
      ["Bezoekers zien vóór het eerste bericht dat de chat door AI wordt beantwoord.",
       "De melding is leesbaar zonder erop te klikken of te hoveren.",
       "Er is een zichtbare route naar een mens, voor wie die wil.",
       "AI-gegenereerde teksten die wij publiceren zijn als zodanig herkenbaar.",
       "AI-gegenereerd beeld, audio of video is gemarkeerd.",
       "Bewerkte beelden van bestaande personen, plaatsen of gebeurtenissen zijn duidelijk als bewerking aangeduid.",
       "Bij AI-ondersteunde antwoorden per e-mail is duidelijk wie eindverantwoordelijk is.",
       "Medewerkers weten dat zij AI-uitkomsten controleren voordat die naar een klant gaan.",
       "Deze lijst is in de afgelopen twaalf maanden doorlopen."
      ].map(t => "<tr><td>" + t + "</td><td style='text-align:center'>&#9744;</td><td></td></tr>").join("") + "</tbody></table>" +
      "<h5>Voorbeeldformulering voor een chatbot</h5><p style='border-left:2pt solid #000;padding-left:11px'>Je chat met een automatische assistent. Antwoorden kunnen fouten bevatten. Wil je een medewerker spreken, typ dan <i>medewerker</i>.</p>" +
      "<h5>Voorbeeldformulering onder AI-ondersteunde content</h5><p style='border-left:2pt solid #000;padding-left:11px'>Dit artikel is met behulp van AI opgesteld en door een medewerker van " + org + " gecontroleerd.</p>" +
      sign() + note("Artikel 50 geldt sinds 2 augustus 2026.");
  }

  if (type === "huisregels") {
    h = head("AI-huisregels") +
      "<p style='font-size:10pt;margin-bottom:16px'>" + org + " &middot; geldig vanaf " + nlDate(g_("f_datum")) + " &middot; vragen bij " + pers + "</p>" +
      [["Controleer altijd wat eruit komt", "Een fout antwoord ziet er precies zo overtuigend uit als een goed antwoord. Loop feiten, cijfers, namen en bedragen na voordat je iets doorstuurt."],
       ["Geen klantgegevens erin", "Geen namen, adressen, dossiers of medische gegevens. Ook niet 'even snel'."],
       ["Geen bedrijfsgeheimen erin", "Offertes, contracten, cijfers, broncode, wachtwoorden: houd die buiten AI-systemen."],
       ["Gebruik alleen goedgekeurde tools", "Staat het niet in het register, vraag het dan eerst aan " + pers + "."],
       ["Een mens beslist over een mens", "AI mag voorwerk doen. Over aannemen, beoordelen of afwijzen beslist altijd iemand van vlees en bloed."],
       ["Zeg het als het misgaat", "Meld fouten, ook zonder schade. Melden heeft geen gevolgen. Niet melden wel."]
      ].map((r, n) => "<div class='big'>" + (n + 1) + ". " + r[0] + "</div><p class='smtxt'>" + r[1] + "</p>").join("") +
      note("Hang dit op waar mensen werken. Dit vervangt het AI-gebruiksbeleid niet, maar het wordt wél gelezen.");
  }

  $("doc").innerHTML = h;
  window.print();
}
$$("[data-doc]").forEach(b => b.addEventListener("click", () => make(b.dataset.doc)));

/* ═══════════════ AGENDA-AFSPRAAK ═══════════════ */

$("icsBtn").addEventListener("click", () => {
  const d = new Date(g_("f_datum") || Date.now());
  d.setFullYear(d.getFullYear() + 1);
  const stamp = x => x.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const end = new Date(d.getTime() + 36e5);
  const org = g_("f_org") || "onze organisatie";
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI-dossier//NL", "BEGIN:VEVENT",
    "UID:" + REF + "@ai-dossier", "DTSTAMP:" + stamp(new Date()), "DTSTART:" + stamp(d), "DTEND:" + stamp(end),
    "SUMMARY:AI-dossier herzien — " + org,
    "DESCRIPTION:Loop het AI-gebruiksbeleid\\, het systeemregister\\, de geletterdheidsregistratie en de transparantie-checklist na. Voeg nieuwe AI-systemen toe en controleer of de regelgeving is gewijzigd. Dossier " + REF + ".",
    "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", "DESCRIPTION:AI-dossier herzien", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = "ai-dossier-herziening.ics"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

paint();

/* Terugkomst vanaf de betaalpagina. Staat bewust onderaan: unlock() roept addRow()
   aan, en die leest DOELEN — hierboven gedeclareerd met const, dus eerder aanroepen
   breekt het script af en dan werkt geen enkele documentknop meer. */
if (new URLSearchParams(location.search).get("ok") === CONFIG.UNLOCK_TOKEN) {
  $("scan").hidden = true;
  unlock();
}
