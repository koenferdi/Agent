/* welvaart.js — hoe goed staat het bedrijf ervoor?
 *
 * De stad verandert mee met dit cijfer: licht, groen, versiering, en hoe de
 * agents erbij lopen. Daarom moet het navolgbaar zijn en niet uit de lucht
 * komen.
 *
 * Alles hieronder is gemeten. Er valt niets zelf aan te vinken: elk signaal
 * telt bestanden of gebeurtenissen die er echt zijn. Doe je werk, dan gaat
 * het cijfer omhoog; doe je niets, dan blijft het staan. Zo hoort het.
 *
 * Wat de hub NIET kan zien is of je omzet maakt — dat staat nergens in de
 * workspace. Het cijfer meet dus je operatie, niet je bankrekening, en dat
 * staat er ook zo bij.
 */

/* Punten die je minstens nodig hebt per niveau. */
const TRAP = [0, 2, 4, 6, 9, 12];

export const NIVEAU_LABEL = [
  "net begonnen",
  "de eerste palen staan",
  "het loopt aan",
  "er zit gang in",
  "het draait",
  "het bloeit"
];

/* Op hoeveel verschillende dagen is er gedraaid? Ritme telt: één dag vijf
 * runs is iets anders dan vijf dagen achter elkaar werken. */
function dagenMetWerk(runs){
  const dagen = new Set();
  for (const r of runs) if (r.begonnen) dagen.add(String(r.begonnen).slice(0,10));
  return dagen.size;
}

export function berekenWelvaart(opt){
  const state   = opt.state || {};
  const runs    = opt.runs || [];
  const agents  = state.agents || [];
  const caps    = state.capabilities || [];
  const drafts  = state.drafts || [];
  const outputs = state.outputs || [];
  const desk    = state.desk || { briefs:[], decisions:[] };

  const bemand   = caps.filter(c => c.done_by).length;
  const deel     = caps.length ? bemand/caps.length : 0;
  const gelukt   = runs.filter(r => !r.fout).length;
  const dagen    = dagenMetWerk(runs);
  const besloten = (desk.decisions || []).filter(d => d.resolved).length;
  const briefs   = (desk.briefs || []).length;
  const hoger    = caps.filter(c => c.ladder && c.ladder !== "human-led").length;

  /* Elk signaal: wat het meet, wat het nu is, en of het gehaald is. */
  const regels = [
    { groep:"ploeg",  tekst:"Je eerste agent staat er",
      nu: agents.length + " in .claude/agents", gehaald: agents.length >= 1 },
    { groep:"ploeg",  tekst:"Drie agents of meer",
      nu: agents.length + " agents", gehaald: agents.length >= 3 },
    { groep:"ploeg",  tekst:"Een kwart van je capaciteiten heeft een agent",
      nu: bemand + " van " + caps.length, gehaald: deel >= .25 },
    { groep:"ploeg",  tekst:"Meer dan de helft heeft een agent",
      nu: Math.round(deel*100) + "%", gehaald: deel >= .55 },

    { groep:"werk",   tekst:"De eerste opdracht staat op de desk",
      nu: briefs + " opdracht" + (briefs === 1 ? "" : "en"), gehaald: briefs >= 1 },
    { groep:"werk",   tekst:"Een agent heeft echt gedraaid",
      nu: gelukt + " geslaagde run" + (gelukt === 1 ? "" : "s"), gehaald: gelukt >= 1 },
    { groep:"werk",   tekst:"Tien geslaagde runs",
      nu: gelukt + " geslaagd", gehaald: gelukt >= 10 },
    { groep:"werk",   tekst:"Op drie verschillende dagen gewerkt",
      nu: dagen + " dag" + (dagen === 1 ? "" : "en"), gehaald: dagen >= 3 },

    { groep:"uitkomst", tekst:"Het eerste rapport ligt er",
      nu: drafts.length + " in drafts/", gehaald: drafts.length >= 1 },
    { groep:"uitkomst", tekst:"Vijf rapporten of meer",
      nu: drafts.length + " in drafts/", gehaald: drafts.length >= 5 },
    { groep:"uitkomst", tekst:"Je hebt een beslissing vastgelegd",
      nu: besloten + " afgehandeld", gehaald: besloten >= 1 },
    { groep:"uitkomst", tekst:"Het eerste stuk is goedgekeurd",
      nu: outputs.length + " in outputs/", gehaald: outputs.length >= 1 },
    { groep:"uitkomst", tekst:"Drie goedgekeurde stukken",
      nu: outputs.length + " in outputs/", gehaald: outputs.length >= 3 },
    { groep:"uitkomst", tekst:"Een capaciteit is van jouw bord af",
      nu: hoger + " boven human-led", gehaald: hoger >= 1 }
  ];

  const punten = regels.filter(r => r.gehaald).length;
  let niveau = 0;
  for (let i = 0; i < TRAP.length; i++) if (punten >= TRAP[i]) niveau = i;
  const volgende = TRAP[niveau + 1];

  return {
    niveau, punten, max: regels.length,
    nogNodig: volgende == null ? 0 : Math.max(0, volgende - punten),
    regels
  };
}

export default berekenWelvaart;
