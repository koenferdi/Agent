/* iso-bridge.js — koppelt de hub aan de stad.
 *
 * De motor weet niet wat een agent is. Dit bestand wel:
 *   - het geeft elke agent uit .claude/agents een kavel, een kleur en een naam
 *   - het leidt de status af uit hub/desk.json, precies zoals de panelen dat doen
 *   - het vergelijkt twee opeenvolgende /api/state-antwoorden en maakt van elk
 *     verschil een regel voor de feed
 *
 * Alles wat hier de feed in gaat is een echte verandering in een bestand.
 * Wat de motor zelf verzint (rondloopmodus) krijgt soort "demo".
 */
import { IsoOffice } from "./iso-office.js";
import { AGENT_COLOR, AGENT_COLOR_VLOER, THEME } from "./iso-theme.js";
import { ZONES, KAVELS, KAVEL_VOLGORDE, TOREN, zoneVan } from "./iso-map.js";

/* Wie zit waar. De nummers komen van de oude kaart, zodat 01 t/m 04 blijven kloppen. */
export const AGENT_META = {
  "market-researcher":   { no:"01", naam:"Marktonderzoeker",  kort:"MO" },
  "customer-researcher": { no:"02", naam:"Klantonderzoeker",  kort:"KO" },
  "strategy-analyst":    { no:"03", naam:"Strateeg",          kort:"ST" },
  "content-creator":     { no:"04", naam:"Contentmaker",      kort:"CM", offphase:true }
};
/* Agents buiten de vaste vier krijgen ook een eigen kleur, uit dezelfde
 * gecontroleerde reeks. */
const EXTRA = ["#26A697","#C9832F","#8465DC","#CC5A86","#4E9BE0","#59B26A",
               "#D96B4A","#9F8FE8","#3FA0B5","#C75C9E","#B79A2E","#5F82D9"];
export function kleurVoor(i){ return EXTRA[i % EXTRA.length]; }

export function metaVan(id, i){
  return AGENT_META[id] || {
    no: String(101 + (i||0)).slice(1),
    naam: String(id).replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase()),
    kort: String(id).replace(/[^a-z]/gi,"").slice(0,2).toUpperCase()
  };
}

/* Elk kavel is van één agent. De volgorde van .claude/agents bepaalt wie
 * waar komt te staan; zolang je niets weghaalt blijft iedereen op zijn plek. */
export function kavelsToewijzen(state){
  const uit = {};
  (state.agents || []).forEach((a, i) => {
    uit[a.id] = KAVEL_VOLGORDE[i % KAVEL_VOLGORDE.length];
  });
  return uit;
}

/* De regel onder de naam op het bord. Komt uit de description van de agent
 * zelf, dus uit .claude/agents/<id>.md — niet verzonnen. */
export function rolregel(a){
  const d = String(a.description || "").replace(/\s+/g, " ").trim();
  if (!d) return a.id;
  const eerste = d.split(". ")[0] || d;
  return eerste.length > 46 ? eerste.slice(0, 45).replace(/[ ,;:]$/, "") + "\u2026" : eerste;
}

export const STATUS_LABEL = {
  idle:"idle", nieuw:"wacht op Claude", opgepakt:"Claude is bezig",
  geleverd:"rapport klaar", geparkeerd:"geparkeerd", offphase:"buiten fase"
};

/* Zelfde afleiding als de panelen gebruiken: de status komt van het werk,
 * niet van de agent. */
export function statusVanAgent(state, id){
  if (metaVan(id).offphase) return "offphase";
  const bs = (state.desk && state.desk.briefs || []).filter(b => b.agent === id);
  if (!bs.length) return "idle";
  if (bs.some(b => b.status === "opgepakt")) return "opgepakt";
  if (bs.some(b => b.status === "nieuw"))    return "nieuw";
  if (bs.some(b => b.status === "geleverd")) return "geleverd";
  return "geparkeerd";
}

const kort = (s, n) => { s = String(s||""); return s.length > n ? s.slice(0,n-1) + "…" : s; };
const middenVan = (naam) => {
  const z = ZONES.find(z => z.name === naam);
  return z ? { x:(z.x0+z.x1)/2, y:(z.y0+z.y1)/2 } : null;
};
const KLEUR_STATUS = {
  nieuw: THEME.wait, opgepakt: THEME.busy, geleverd: THEME.ok, geparkeerd: THEME.idle
};

export class IsoBridge {
  constructor(canvas, opts = {}){
    this.onFeed   = opts.onFeed   || function(){};
    this.onSelect = opts.onSelect || function(){};
    this.vorige   = null;
    this.log      = [];

    this.office = new IsoOffice(canvas, {
      demo: false,
      onSelect: (id, a) => this.onSelect(id, a),
      onEvent:  (tekst, id, soort) => this.melding(tekst, id, soort || "demo")
    });
  }

  /* Een regel voor de feed. soort: echt | interactie | demo | stand */
  melding(tekst, id, soort){
    const regel = { tekst, id, soort: soort || "echt", tijd: new Date() };
    this.log.unshift(regel);
    if (this.log.length > 200) this.log.length = 200;
    this.onFeed(regel, this.log);
  }

  /* Roep dit aan na elke /api/state. */
  sync(state){
    const eerste = !this.vorige;

    const kavels = kavelsToewijzen(state);
    const agents = (state.agents || []).map((a, i) => {
      const m = metaVan(a.id, i);
      const st = statusVanAgent(state, a.id);
      return {
        id: a.id,
        name: m.no + " " + m.naam,     /* in de feed en het paneel */
        short2: m.naam,                /* op het bord boven het gebouw */
        rolTekst: rolregel(a),         /* de regel eronder */
        short: m.kort,
        role: a.id,
        desk: kavels[a.id] != null ? kavels[a.id] : i,
        color: AGENT_COLOR_VLOER[a.id] || AGENT_COLOR[a.id] || kleurVoor(i),
        status: st,
        statusTekst: STATUS_LABEL[st] || ""
      };
    });

    this.office.setAgents(agents);
    /* setAgents behoudt de positie van bestaande agents; de status moet er
     * daarna doorheen zodat een wissel ook echt beweging geeft. */
    if (!eerste) for (const a of agents) this.office.setStatus(a.id, a.status);
    this.office.setArchive((state.drafts || []).length);
    this.office.setZoneInfo(this._kamerinfo(state, agents));

    if (eerste){
      const open = (state.desk && state.desk.briefs || [])
        .filter(b => b.status === "nieuw" || b.status === "opgepakt").length;
      const beslis = (state.desk && state.desk.decisions || []).filter(d => !d.resolved).length;
      this.melding(
        "Stand bij openen: " + agents.length + " agents, " + (state.drafts||[]).length +
        " rapporten, " + open + " opdrachten open, " + beslis + " beslissingen aan jou.",
        null, "stand");
    } else {
      this._verschillen(this.vorige, state);
    }

    this.vorige = JSON.parse(JSON.stringify({
      agents: (state.agents||[]).map(a => ({ id:a.id })),
      drafts: (state.drafts||[]).map(d => ({ file:d.file, title:d.title, modified:d.modified, meta:d.meta })),
      desk: state.desk || { briefs:[], decisions:[] }
    }));
  }

  /* Tekst onder de naam op de borden bij de toren. Alles hier is geteld. */
  _kamerinfo(state, agents){
    const info = {};
    const n = (state.drafts || []).length;
    const bezig = agents.filter(a => a.status === "opgepakt").length;
    info.plein = agents.length + (agents.length === 1 ? " agent" : " agents") +
                 " \u00b7 " + n + (n === 1 ? " rapport" : " rapporten") +
                 (bezig ? " \u00b7 " + bezig + " aan het werk" : "");
    const open = (state.desk && state.desk.decisions || []).filter(d => !d.resolved).length;
    info.meeting = open ? open + (open === 1 ? " beslissing aan jou" : " beslissingen aan jou")
                        : "geen open beslissingen";
    return info;
  }

  /* Twee momentopnames naast elkaar. Elk verschil is een echte gebeurtenis. */
  _verschillen(oud, nieuw){
    const naamVan = id => { const m = metaVan(id); return m.no + " " + m.naam; };

    /* agents erbij of eraf */
    const oudeIds = new Set(oud.agents.map(a => a.id));
    for (const a of (nieuw.agents||[]))
      if (!oudeIds.has(a.id)) this.melding("Nieuwe agent in .claude/agents: " + a.id + ".", a.id, "echt");
    const nieuweIds = new Set((nieuw.agents||[]).map(a => a.id));
    for (const a of oud.agents)
      if (!nieuweIds.has(a.id)) this.melding("Agent weg uit .claude/agents: " + a.id + ".", null, "echt");

    /* opdrachten */
    const oudeBriefs = new Map((oud.desk.briefs||[]).map(b => [b.id, b]));
    for (const b of (nieuw.desk && nieuw.desk.briefs || [])){
      const o = oudeBriefs.get(b.id);
      if (!o){
        this.melding("Nieuwe opdracht voor " + naamVan(b.agent) + ": " + kort(b.topic, 60), b.agent, "echt");
        this.office.floater("+1 opdracht", b.agent, THEME.wait);
      } else {
        if (o.status !== b.status){
          this.melding(naamVan(b.agent) + ": " + o.status + " → " + b.status + ".", b.agent, "echt");
          this.office.floater(b.status, b.agent, KLEUR_STATUS[b.status] || THEME.ok);
        }
        if ((o.findings||[]).length !== (b.findings||[]).length)
          this.melding(naamVan(b.agent) + " noteerde een bevinding.", b.agent, "echt");
      }
      oudeBriefs.delete(b.id);
    }
    for (const [, b] of oudeBriefs)
      this.melding("Opdracht verwijderd bij " + naamVan(b.agent) + ".", b.agent, "echt");

    /* rapporten in drafts/ */
    const oudeDrafts = new Map(oud.drafts.map(d => [d.file, d]));
    for (const d of (nieuw.drafts||[])){
      const o = oudeDrafts.get(d.file);
      if (!o){
        const v = d.meta && d.meta.verdict ? " — " + kort(d.meta.verdict, 40) : "";
        this.melding("Nieuw rapport in drafts/: " + kort(d.title, 50) + v, null, "echt");
        this.office.floater("+1 rapport", { x: TOREN.x, y: TOREN.y }, THEME.ok);
      } else if (o.modified !== d.modified){
        this.melding("Rapport bijgewerkt: " + kort(d.title, 50), null, "echt");
      }
    }
    for (const [file, d] of oudeDrafts)
      if (!(nieuw.drafts||[]).some(x => x.file === file))
        this.melding("Rapport weg uit drafts/: " + kort(d.title, 50), null, "echt");

    /* beslissingen */
    const oudeDec = new Map((oud.desk.decisions||[]).map(d => [d.id, d]));
    for (const d of (nieuw.desk && nieuw.desk.decisions || [])){
      const o = oudeDec.get(d.id);
      if (!o) this.melding("Nieuwe beslissing aan jou: " + kort(d.question, 60), null, "echt");
      else if (!o.resolved && d.resolved){
        this.melding("Beslissing vastgelegd: " + kort(d.question, 45), null, "echt");
        this.office.floater("besluit", middenVan("meeting"), THEME.gold);
      }
    }
  }

  setDemo(aan){
    this.office.setDemo(aan);
    this.melding(aan
      ? "Rondloopmodus aan. Wat de agents nu doen is verzonnen, geen meting."
      : "Rondloopmodus uit. De vloer volgt weer alleen je bestanden.",
      null, aan ? "demo" : "echt");
    return this;
  }

  select(id){ this.office.select(id); return this; }
  focus(id){ this.office.focus(id); return this; }
  destroy(){ this.office.destroy(); }
}

export default IsoBridge;
