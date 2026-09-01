/* voorstellen.mjs — wat is er nu te doen?
 *
 * De hub kijkt naar de echte stand van je workspace en stelt concrete stappen
 * voor. Geen algemene adviezen: elk voorstel wijst naar een bestand, een
 * opdracht of een agent die er echt is, en heeft een knop die iets doet.
 *
 * Elk voorstel heeft:
 *   id        stabiel, zodat "wegleggen" blijft werken
 *   soort     bepaalt de kleur en de knoppen in de hub
 *   titel     wat je zou doen, in één regel
 *   waarom    waarom dit nu aan de beurt is — altijd met de telling erbij
 *   agent     wie het doet (kan leeg zijn)
 *   opdracht  de tekst waarmee je hem kunt starten (kan leeg zijn)
 *   acties    ["draaien","opdracht","keuren","openen","opzetten"]
 *   gewicht   hoger = eerder in de lijst
 */

/* Een startopdracht per archetype. Zo hoeft je eerste opdracht geen leeg vel
 * te zijn. {wat} wordt vervangen door wat je bedrijf doet. */
const START = {
  "market-researcher":   "Verken de markt rond {wat}. Omvang, concurrenten, structuur. Sluit af met een oordeel en de zekerheid erbij.",
  "customer-researcher": "Zoek uit wie het probleem heeft rond {wat}: waar praten ze erover, wat gebruiken ze nu, wat betalen ze al.",
  "strategy-analyst":    "Weeg wat er in drafts/ ligt en kom met twee richtingen voor {wat}, met afwegingen en een aanbeveling.",
  "competitor-watch":    "Breng vijf concurrenten rond {wat} in kaart: wat beloven ze, wat vragen ze, wat is er de laatste maanden veranderd.",
  "offer-builder":       "Zet een eerste aanbod op papier voor {wat}: wat je levert, aan wie, en waarom zij het kopen.",
  "pricing-analyst":     "Reken door wat een redelijk prijspunt is voor {wat}, met de marge en de aannames zichtbaar.",
  "content-creator":     "Schrijf drie korte stukken over {wat} voor het kanaal waar je klanten al zitten.",
  "sales-agent":         "Maak een opvolgschema voor {wat}: wanneer je contact opneemt, met welke boodschap.",
  "support-agent":       "Verzamel de tien vragen die klanten rond {wat} het vaakst stellen, met een antwoord per vraag.",
  "bookkeeper":          "Zet op een rij welke kosten en inkomsten er nu zijn rond {wat}, en wat je nog niet weet.",
  "data-analyst":        "Zoek uit welke cijfers je nu al kunt meten rond {wat}, en welke je mist om te sturen.",
  "ops-planner":         "Maak een weekplanning voor {wat}: wat er moet gebeuren, in welke volgorde, en wat er op jou wacht."
};

const kort = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n-1) + "…" : s; };

function startOpdracht(agentId, wat){
  const sjabloon = START[agentId];
  if (!sjabloon) return "";
  return sjabloon.replace("{wat}", wat && wat.trim() ? wat.trim() : "wat je bedrijf doet");
}

export function voorstellen({ state, runs = [], catalogus = [] }){
  const agents  = state.agents || [];
  const caps    = state.capabilities || [];
  const drafts  = state.drafts || [];
  const outputs = state.outputs || [];
  const desk    = state.desk || { briefs: [], decisions: [] };
  const briefs  = desk.briefs || [];
  const verborgen = new Set(desk.verborgen || []);
  const wat = ((state.bedrijf || {}).bedrijf || {}).wat || "";
  const uit = [];

  const naamVan = id => {
    const c = catalogus.find(c => c.id === id);
    return c ? c.naam : String(id).replace(/-/g, " ");
  };

  /* 1. Een rapport is af en wacht op jou. Dit is de belangrijkste knop in de
   *    hub: goedkeuren verplaatst het naar outputs/, en dat is wat "klaar"
   *    betekent in deze workspace. */
  for (const b of briefs){
    if (b.status !== "geleverd" || !b.draft) continue;
    if (outputs.some(o => o.file === b.draft)) continue;
    const d = drafts.find(x => x.file === b.draft);
    uit.push({
      id: "keur:" + b.draft,
      soort: "keuren", gewicht: 100,
      titel: "Rapport nakijken: " + kort(d ? d.title : b.topic, 60),
      waarom: naamVan(b.agent) + " heeft dit afgeleverd"
        + (d && d.meta && d.meta.verdict ? " — oordeel: " + kort(d.meta.verdict, 50) : "")
        + (d ? " · " + d.words + " woorden" : "") + ".",
      agent: b.agent, bestand: b.draft, opdracht: "",
      acties: ["lezen","keuren","afkeuren"]
    });
  }

  /* 2. Een beslissing die op jou wacht. Daar komt geen agent doorheen. */
  for (const d of (desk.decisions || [])){
    if (d.resolved) continue;
    uit.push({
      id: "besluit:" + d.id,
      soort: "beslissen", gewicht: 90,
      titel: "Beslissing: " + kort(d.question, 60),
      waarom: d.context ? kort(d.context, 120) : "Zonder dit besluit kan het werk niet verder.",
      agent: null, opdracht: "", acties: ["openen"]
    });
  }

  /* 3. Een opdracht staat klaar maar heeft nog niet gedraaid. */
  for (const b of briefs){
    if (b.status !== "nieuw") continue;
    uit.push({
      id: "start:" + b.id,
      soort: "starten", gewicht: 80,
      titel: "Starten: " + kort(b.topic, 60),
      waarom: "Staat sinds " + (b.gezet ? b.gezet.slice(0,10) : "eerder") + " op de desk voor "
        + naamVan(b.agent) + " en heeft nog niet gedraaid.",
      agent: b.agent, opdracht: b.topic, acties: ["draaien"]
    });
  }

  /* 4. Een agent die er staat maar niets te doen heeft. Met een startopdracht
   *    die bij zijn vak past, zodat je niet naar een leeg veld kijkt. */
  for (const a of agents){
    if (briefs.some(b => b.agent === a.id && b.status !== "geleverd")) continue;
    const opdracht = startOpdracht(a.id, wat);
    if (!opdracht) continue;
    const eerder = runs.filter(r => r.agentId === a.id).length;
    uit.push({
      id: "leeg:" + a.id,
      soort: "leeg", gewicht: eerder ? 40 : 60,
      titel: naamVan(a.id) + " heeft niets te doen",
      waarom: eerder ? "Heeft " + eerder + " keer gedraaid, maar er staat nu niets open."
                     : "Staat er wel, maar heeft nog nooit gedraaid.",
      agent: a.id, opdracht, acties: ["draaien","opdracht"]
    });
  }

  /* 5. Een capaciteit die op papier staat maar geen agent heeft. */
  for (const c of caps){
    if (c.done_by) continue;
    uit.push({
      id: "onbemand:" + c.name,
      soort: "onbemand", gewicht: 50,
      titel: "Nog geen agent voor: " + kort(c.title || c.name, 50),
      waarom: "Staat in workflows/capabilities/" + c.name + ".md, afdeling "
        + (c.department || "onbekend") + ". Dat werk doe jij nu zelf.",
      agent: null, opdracht: "", acties: ["opzetten"]
    });
  }

  /* 6. Een rapport dat om een vervolg vraagt, en er is iemand die dat kan. */
  const strateeg = agents.find(a => a.id === "strategy-analyst");
  for (const d of drafts){
    const oordeel = String((d.meta || {}).verdict || "").toLowerCase();
    if (!oordeel || !/nader|verder|onderzoek|twijfel|onzeker/.test(oordeel)) continue;
    if (outputs.some(o => o.file === d.file)) continue;
    if (!strateeg) continue;
    uit.push({
      id: "opvolgen:" + d.file,
      soort: "opvolgen", gewicht: 70,
      titel: "Laat de strateeg wegen: " + kort(d.title, 50),
      waarom: "Het oordeel is “" + kort((d.meta || {}).verdict, 60) + "”. "
        + "Daar hoort een keuze achteraan, geen tweede rapport.",
      agent: "strategy-analyst",
      opdracht: "Lees drafts/" + d.file + " en kom met twee richtingen, de afwegingen, "
        + "een aanbeveling en de afbreekcriteria.",
      acties: ["draaien","opdracht"]
    });
  }

  /* 7. Het is stil geweest. Alleen melden als er iets te doen ís. */
  const laatste = runs.map(r => r.begonnen).filter(Boolean).sort().pop();
  if (agents.length && laatste){
    const dagen = Math.floor((Date.now() - new Date(laatste).getTime())/86400000);
    if (dagen >= 7) uit.push({
      id: "stil:" + laatste.slice(0,10),
      soort: "stil", gewicht: 30,
      titel: "Het is " + dagen + " dagen stil",
      waarom: "De laatste run was op " + laatste.slice(0,10)
        + ". Een stad zonder werk blijft op hetzelfde niveau staan.",
      agent: null, opdracht: "", acties: []
    });
  }

  return uit
    .filter(v => !verborgen.has(v.id))
    .sort((a,b) => b.gewicht - a.gewicht);
}

export default voorstellen;
