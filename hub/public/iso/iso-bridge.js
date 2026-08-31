/* iso-bridge.js — koppelt de hub aan de vloer.
 *
 * De motor weet niet wat een agent is. Dit bestand wel:
 *   - het geeft elke agent uit .claude/agents een bureau, een kleur en een naam
 *   - het leidt de status af uit hub/desk.json, precies zoals de panelen dat doen
 *   - het vergelijkt twee opeenvolgende /api/state-antwoorden en maakt van elk
 *     verschil een regel voor de feed
 *
 * Alles wat hier de feed in gaat is een echte verandering in een bestand.
 * Wat de motor zelf verzint (rondloopmodus) krijgt soort "demo".
 */
import { IsoOffice } from "./iso-office.js";
import { AGENT_COLOR, AGENT_COLOR_VLOER, THEME } from "./iso-theme.js";
import { DESKS, ZONES, AFDELINGEN, bureausVan } from "./iso-map.js";

/* Wie zit waar. De nummers komen van de oude kaart, zodat 01 t/m 04 blijven kloppen. */
export const AGENT_META = {
  "market-researcher":   { no:"01", naam:"Marktonderzoeker",  kort:"MO" },
  "customer-researcher": { no:"02", naam:"Klantonderzoeker",  kort:"KO" },
  "strategy-analyst":    { no:"03", naam:"Strateeg",          kort:"ST" },
  "content-creator":     { no:"04", naam:"Contentmaker",      kort:"CM", offphase:true }
};
export function metaVan(id, i){
  return AGENT_META[id] || {
    no: String(101 + (i||0)).slice(1),
    naam: String(id).replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase()),
    kort: String(id).replace(/[^a-z]/gi,"").slice(0,2).toUpperCase()
  };
}

/* Bij welke afdeling hoort een agent? Dat staat niet in de agent zelf maar in
 * de capaciteit die hij uitvoert: workflows/capabilities/*.md, veld done_by. */
export function afdelingVan(state, id){
  const c = (state.capabilities || []).find(c => c.done_by === id);
  return c && AFDELINGEN.indexOf(c.department) >= 0 ? c.department : null;
}

/* Wie zit waar. Agents van dezelfde afdeling delen een kamer; wie geen
 * capaciteit heeft, krijgt een vrij bureau waar plek is. */
export function bureausToewijzen(state){
  const vrij = new Map(AFDELINGEN.map(d => [d, bureausVan(d).slice()]));
  const rest = [];
  const uit = {};
  for (const a of (state.agents || [])){
    const dep = afdelingVan(state, a.id);
    const lijst = dep ? vrij.get(dep) : null;
    if (lijst && lijst.length) uit[a.id] = lijst.shift();
    else rest.push(a.id);
  }
  const over = AFDELINGEN.flatMap(d => vrij.get(d));
  rest.forEach((id, i) => { uit[id] = over[i % over.length] || 0; });
  return uit;
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

    const bureaus = bureausToewijzen(state);
    const agents = (state.agents || []).map((a, i) => {
      const m = metaVan(a.id, i);
      return {
        id: a.id,
        name: m.no + " " + m.naam,
        short: m.kort,
        role: a.id,
        dept: afdelingVan(state, a.id),
        desk: bureaus[a.id] || 0,
        color: AGENT_COLOR_VLOER[a.id] || AGENT_COLOR[a.id] || THEME.busy,
        status: statusVanAgent(state, a.id)
      };
    });

    this.office.setAgents(agents);
    /* setAgents behoudt de positie van bestaande agents; de status moet er
     * daarna doorheen zodat een wissel ook echt beweging geeft. */
    if (!eerste) for (const a of agents) this.office.setStatus(a.id, a.status);
    this.office.setArchive((state.drafts || []).length);
    this.office.setZoneInfo(this._kamerinfo(state, agents));
    this.office.setBorden(this._borden(state));

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

  /* Tekst achter de kamernaam. Alles hier is geteld, niet geschat. */
  _kamerinfo(state, agents){
    const info = {};
    for (const dep of AFDELINGEN){
      const caps = (state.capabilities || []).filter(c => c.department === dep);
      const mensen = agents.filter(a => a.dept === dep).length;
      info[dep] = mensen
        ? mensen + (mensen === 1 ? " agent" : " agents")
        : (caps.length ? "geen agent · " + caps.length + " op papier" : "leeg");
    }
    const n = (state.drafts || []).length;
    info.archive = n ? n + (n === 1 ? " rapport" : " rapporten") : "leeg";
    return info;
  }

  /* Het opdrachtenbord per afdeling: capaciteiten en hoeveel er bemand zijn. */
  _borden(state){
    const uit = {};
    for (const dep of AFDELINGEN){
      const caps = (state.capabilities || []).filter(c => c.department === dep);
      uit[dep] = { totaal: caps.length, live: caps.filter(c => c.done_by).length };
    }
    return uit;
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
        this.office.floater("+1 rapport", middenVan("archive"), THEME.ok);
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
