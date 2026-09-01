/* welvaart.js — hoe goed staat het bedrijf ervoor?
 *
 * De stad verandert mee met dit cijfer: licht, groen, vlaggen, kraampjes, en
 * hoe de agents erbij lopen. Daarom moet het navolgbaar zijn en niet uit de
 * lucht komen. Elke punt hieronder is een telling uit een bestand dat je zelf
 * kunt openen, of een mijlpaal die je zelf hebt aangevinkt.
 *
 * Wat de hub NIET weet: of je omzet maakt. Dat staat nergens in de workspace.
 * Vandaar de mijlpalen: die vink jij aan, en jij bent er verantwoordelijk voor.
 */

export const MIJLPALEN = [
  { id:"eerste-gesprek",  label:"Eerste klantgesprek gevoerd" },
  { id:"eerste-klant",    label:"Eerste betalende klant" },
  { id:"eerste-omzet",    label:"Eerste omzet binnen" },
  { id:"terugkerend",     label:"Terugkerende omzet" },
  { id:"eerste-hulp",     label:"Eerste iemand ingehuurd of uitbesteed" }
];

/* Punten → niveau. Zes stappen, zodat je het verschil ook echt ziet. */
const TRAP = [0, 2, 3, 5, 7, 9];   /* punten die je minstens nodig hebt per niveau */

export function berekenWelvaart(opt){
  const state = opt.state || {};
  const runs  = opt.runs || [];
  const caps  = state.capabilities || [];
  const drafts = state.drafts || [];
  const desk  = state.desk || { briefs:[], decisions:[] };
  const bedrijf = state.bedrijf || {};
  const gehaald = (bedrijf.mijlpalen || []);

  const bemand = caps.filter(c => c.done_by).length;
  const deel   = caps.length ? bemand/caps.length : 0;
  const gelukt = runs.filter(r => !r.fout).length;
  const besloten = (desk.decisions || []).filter(d => d.resolved).length;

  const regels = [
    { tekst: "Een kwart van je capaciteiten heeft een agent",
      nu: Math.round(deel*100) + "%", punten: 1, gehaald: deel >= .25 },
    { tekst: "Meer dan de helft heeft een agent",
      nu: Math.round(deel*100) + "%", punten: 1, gehaald: deel >= .55 },
    { tekst: "Het eerste rapport ligt er",
      nu: drafts.length + " in drafts/", punten: 1, gehaald: drafts.length >= 1 },
    { tekst: "Vijf rapporten of meer",
      nu: drafts.length + " in drafts/", punten: 1, gehaald: drafts.length >= 5 },
    { tekst: "Een agent heeft echt gedraaid",
      nu: gelukt + " geslaagd", punten: 1, gehaald: gelukt >= 1 },
    { tekst: "Tien geslaagde runs",
      nu: gelukt + " geslaagd", punten: 1, gehaald: gelukt >= 10 },
    { tekst: "Je hebt een beslissing vastgelegd",
      nu: besloten + " afgehandeld", punten: 1, gehaald: besloten >= 1 }
  ].concat(MIJLPALEN.map(m => ({
    tekst: m.label, nu: "vink je zelf aan", punten: 1,
    gehaald: gehaald.indexOf(m.id) >= 0, mijlpaal: m.id
  })));

  const punten = regels.reduce((n, r) => n + (r.gehaald ? r.punten : 0), 0);
  let niveau = 0;
  for (let i = 0; i < TRAP.length; i++) if (punten >= TRAP[i]) niveau = i;

  const volgende = TRAP[niveau + 1];
  return {
    niveau, punten,
    max: regels.reduce((n, r) => n + r.punten, 0),
    nogNodig: volgende == null ? 0 : Math.max(0, volgende - punten),
    regels
  };
}

export const NIVEAU_LABEL = [
  "net begonnen",
  "de eerste palen staan",
  "het loopt aan",
  "er zit gang in",
  "het draait",
  "het bloeit"
];

export default berekenWelvaart;
