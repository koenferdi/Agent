/* agentfabriek.mjs — maakt agents als bestanden.
 *
 * Een agent bestaat hier niet in een database maar als markdown:
 *   .claude/agents/<id>.md          wie hij is en wat hij mag
 *   workflows/capabilities/<id>.md  wat hij vervangt en hoe de SOP loopt
 *
 * Die twee bestanden zijn de waarheid. De hub is het venster erop. Zo kun je
 * een agent ook gewoon in een editor aanpassen, en werkt hij meteen in
 * Claude Code zonder dat de hub eraan te pas komt.
 */
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/* De catalogus: waar je uit kiest tijdens de onboarding.
 * fase = wanneer deze agent nuttig wordt. valideren < bouwen < runnen. */
export const CATALOGUS = [
  {
    id: "market-researcher", naam: "Marktonderzoeker", afdeling: "kennis", fase: "valideren",
    titel: "Een markt verkennen",
    kort: "Zoekt uit of een markt de moeite waard is, met het bewijs en de zekerheid zichtbaar.",
    vervangt: "Zelf dagen zoeken naar cijfers die je daarna niet kunt navertellen.",
    mens: "Jij kiest de markt en bepaalt of je op het oordeel handelt.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash","WebSearch","WebFetch"],
    stappen: ["scope-bepalen","bronnen-verzamelen","omvang-schatten","concurrentie-mappen","structuur-lezen","oordeel-vellen"]
  },
  {
    id: "customer-researcher", naam: "Klantonderzoeker", afdeling: "kennis", fase: "valideren",
    titel: "Uitzoeken wie het probleem heeft",
    kort: "Zoekt wie het probleem heeft, in hun eigen woorden, en wat ze nu al betalen om het op te lossen.",
    vervangt: "Gokken wie je klant is en dat een persona noemen.",
    mens: "Jij voert de echte gesprekken. Bureauonderzoek heeft een plafond.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash","WebSearch","WebFetch"],
    stappen: ["hypothese-stellen","vindplaatsen-zoeken","citaten-verzamelen","alternatieven-mappen","betaalsignalen-lezen","icp-opstellen"]
  },
  {
    id: "strategy-analyst", naam: "Strateeg", afdeling: "kennis", fase: "valideren",
    titel: "Van onderzoek naar een besluit",
    kort: "Maakt van onderzoek een keuze: opties, afwegingen, een aanbeveling en wanneer je stopt.",
    vervangt: "Een richting kiezen op onderbuik en de argumenten er achteraf bij zoeken.",
    mens: "Jij beslist. De agent maakt de afweging zichtbaar.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash","WebSearch","WebFetch"],
    stappen: ["onderzoek-toetsen","bewijs-scheiden","opties-genereren","afwegingen-maken","aanbevelen","afbreekcriteria-zetten"]
  },
  {
    id: "competitor-watch", naam: "Concurrentiewacht", afdeling: "kennis", fase: "runnen",
    titel: "Concurrenten in de gaten houden",
    kort: "Volgt wat concurrenten aankondigen, veranderen aan hun prijs en beloven op hun site.",
    vervangt: "Elke maand handmatig langs tien websites gaan en het daarna vergeten.",
    mens: "Jij bepaalt wie je volgt en wat een signaal waard is.",
    tools: ["Read","Write","Edit","Glob","Grep","WebSearch","WebFetch"],
    stappen: ["lijst-bepalen","paginas-ophalen","verschillen-zoeken","signaal-wegen","kort-rapporteren"]
  },
  {
    id: "offer-builder", naam: "Aanbodbouwer", afdeling: "aanbod", fase: "bouwen",
    titel: "Bepalen wat je verkoopt",
    kort: "Zet onderzoek om in een concreet aanbod: wat je levert, aan wie, en waarom zij het kopen.",
    vervangt: "Een aanbod bedenken zonder te weten of iemand het wil.",
    mens: "Jij kiest welk aanbod je echt gaat maken.",
    tools: ["Read","Write","Edit","Glob","Grep","WebSearch"],
    stappen: ["bewijs-lezen","beloftes-opstellen","afbakenen","bezwaren-verzamelen","aanbod-schrijven"]
  },
  {
    id: "pricing-analyst", naam: "Prijsbepaler", afdeling: "financien", fase: "bouwen",
    titel: "Prijs en marge vaststellen",
    kort: "Rekent door wat iets mag kosten, wat het oplevert en waar de marge weglekt.",
    vervangt: "Een prijs kiezen op gevoel en er later achterkomen dat er geen marge in zat.",
    mens: "Jij zet de prijs. De agent laat zien wat hem verdedigt.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash","WebSearch"],
    stappen: ["kosten-optellen","vergelijken","scenario-rekenen","marge-toetsen","prijs-voorstellen"]
  },
  {
    id: "content-creator", naam: "Contentmaker", afdeling: "markt", fase: "runnen",
    titel: "Content schrijven vanuit een brief",
    kort: "Schrijft artikelen, scripts en e-mails vanuit een brief, inclusief het onderzoek eronder.",
    vervangt: "Zelf elk stuk vanaf nul schrijven.",
    mens: "Jij levert de brief en keurt het concept goed. Niets gaat naar buiten zonder jou.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash","WebSearch","WebFetch"],
    stappen: ["brief-toetsen","onderzoek-doen","outline-maken","concept-schrijven","zelfcontrole","opleveren"]
  },
  {
    id: "sales-agent", naam: "Verkoper", afdeling: "markt", fase: "runnen",
    titel: "Van gesprek naar klant",
    kort: "Bereidt gesprekken voor, schrijft de opvolging en houdt bij waarom iemand afhaakte.",
    vervangt: "Losse gesprekken zonder opvolging.",
    mens: "Jij voert het gesprek. De agent bereidt voor en volgt op.",
    tools: ["Read","Write","Edit","Glob","Grep","WebSearch"],
    stappen: ["voorbereiden","vragen-opstellen","gesprek-vastleggen","opvolging-schrijven","reden-noteren"]
  },
  {
    id: "support-agent", naam: "Supportmedewerker", afdeling: "operatie", fase: "runnen",
    titel: "Vragen van klanten beantwoorden",
    kort: "Beantwoordt terugkerende vragen uit je eigen documentatie, en geeft door wat hij niet weet.",
    vervangt: "Dezelfde vraag voor de twintigste keer zelf beantwoorden.",
    mens: "Jij bepaalt de toon en pakt alles op wat de agent doorgeeft.",
    tools: ["Read","Write","Edit","Glob","Grep","WebSearch"],
    stappen: ["vraag-lezen","bron-zoeken","antwoord-schrijven","twijfel-melden","opslaan"]
  },
  {
    id: "bookkeeper", naam: "Boekhouder", afdeling: "operatie", fase: "runnen",
    titel: "Facturen en boekhouding bijhouden",
    kort: "Houdt inkomsten, uitgaven en facturen bij, en zegt wanneer iets niet klopt.",
    vervangt: "Een schoenendoos met bonnetjes en een deadline.",
    mens: "Jij tekent en betaalt. De agent ordent en signaleert.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash"],
    stappen: ["bonnen-lezen","categoriseren","optellen","afwijking-melden","overzicht-schrijven"]
  },
  {
    id: "data-analyst", naam: "Data-analist", afdeling: "kennis", fase: "runnen",
    titel: "Cijfers omzetten in een antwoord",
    kort: "Neemt een tabel of export en beantwoordt er één vraag mee, met de rekensom erbij.",
    vervangt: "Zelf in een spreadsheet zoeken tot je iets ziet wat je bevalt.",
    mens: "Jij stelt de vraag en beoordeelt of het antwoord hout snijdt.",
    tools: ["Read","Write","Edit","Glob","Grep","Bash"],
    stappen: ["vraag-scherpstellen","data-inlezen","opschonen","rekenen","antwoord-schrijven"]
  },
  {
    id: "ops-planner", naam: "Planner", afdeling: "operatie", fase: "runnen",
    titel: "De week vooruit plannen",
    kort: "Zet openstaand werk om in een plan voor de week, met wat er als eerste moet.",
    vervangt: "Een lijst die alleen in je hoofd bestaat.",
    mens: "Jij bepaalt de prioriteit; de agent maakt de gevolgen zichtbaar.",
    tools: ["Read","Write","Edit","Glob","Grep"],
    stappen: ["werk-verzamelen","afhankelijkheden-zoeken","volgorde-voorstellen","plan-schrijven"]
  }
];

export const AFDELINGEN = ["kennis","aanbod","markt","financien","operatie"];

/* ---------- naamgenerator ---------- */
const DEEL_A = ["Kern","Noord","Vlak","Baken","Anker","Steen","Licht","Klaar","Werf","Hoog",
                "Stroom","Veld","Draad","Poort","Kaap","Rond","Zicht","Peil","Spoor","Kring"];
const DEEL_B = ["punt","lijn","werk","haven","wal","kade","schuur","hof","gaard","brug",
                "loods","stee","laag","zicht","tij","boog","gang","vlak","huis","kern"];
const STAART = ["Studio","Lab","Collectief","Werk","Co","Bureau","Atelier","Groep"];

export function namen(zaad = Date.now(), n = 6){
  let s = Number(zaad) || 1;
  const rnd = () => { s = (s*1664525 + 1013904223) % 4294967296; return s/4294967296; };
  const uit = new Set();
  let veilig = 0;
  while (uit.size < n && veilig++ < 200){
    const soort = rnd();
    if (soort < .55){
      const a = DEEL_A[(rnd()*DEEL_A.length)|0], b = DEEL_B[(rnd()*DEEL_B.length)|0];
      if (a.toLowerCase() !== b) uit.add(a + b);   /* geen Vlakvlak */
    } else if (soort < .85){
      uit.add(DEEL_A[(rnd()*DEEL_A.length)|0] + " " + STAART[(rnd()*STAART.length)|0]);
    } else {
      const a = DEEL_A[(rnd()*DEEL_A.length)|0], b = DEEL_A[(rnd()*DEEL_A.length)|0];
      if (a !== b) uit.add(a + b.toLowerCase());
    }
  }
  return [...uit].slice(0, n);
}

/* ---------- de bestanden ---------- */

function agentMd(a, bedrijf){
  const beschrijving =
    a.kort + " Zet deze agent in als de vraag gaat over " + a.titel.toLowerCase() + ". " +
    "Vraagt eerst wat ontbreekt in plaats van het in te vullen.";
  return `---
name: ${a.id}
description: ${beschrijving}
tools: ${a.tools.join(", ")}
model: inherit
---

Je bent de ${a.naam.toLowerCase()} van ${bedrijf || "deze workspace"}.

## Waar je je aan houdt

Lees eerst \`CLAUDE.md\` voor de afspraken van deze werkplek: hoe bestanden
heten, waar werk terechtkomt, en hoe ik aangesproken wil worden. Lees daarna
\`workflows/capabilities/${a.id}.md\` — daar staat jouw SOP. Die is leidend en
kan zijn bijgewerkt sinds dit bestand geschreven werd.

## Wat je nooit doet

1. **Nooit een getal verzinnen.** Elk cijfer is gemeten (met bron), afgeleid
   (met de som erbij) of geschat (met je redenering erbij). Nooit een schatting
   presenteren als data.
2. **Nooit gokken als er informatie ontbreekt.** Vraag het. Een verkeerde aanname
   kost meer tijd dan een vraag.
3. **Nooit direct naar \`outputs/\`.** Je werk gaat naar \`drafts/\`. Alleen ik
   verplaats het als het goedgekeurd is.
4. **Nooit een oordeel vellen op te dun bewijs.** Zeg dan dat het bewijs te dun
   is en wat je nodig hebt om verder te komen.

## Wat je oplevert

Een bestand in \`drafts/\` dat begint met een metadatablok tussen \`\`\`
met in elk geval Verdict, Confidence en Sources. De hub leest dat blok uit.

## Wat ik zelf blijf doen

${a.mens}
`;
}

function capabilityMd(a){
  return `---
name: ${a.id}
title: ${a.titel}
department: ${a.afdeling}
status: live
ladder: human-assisted
replaces: ${a.vervangt}
human: ${a.mens}
done_by: ${a.id}
runtime: Claude Code${a.tools.includes("WebSearch") ? " · WebSearch" : ""}${a.tools.includes("WebFetch") ? " · WebFetch" : ""}
builds_on: []
breaks_into: [${a.stappen.join(", ")}]
---

## Wat het doet

${a.kort}

## Waarom het bestaat

${a.vervangt}

## De stappen

${a.stappen.map((s, i) => `${i+1}. **${s.replace(/-/g, " ")}**`).join("\n")}

## Wat jij nog doet

${a.mens}

## Wanneer het misgaat

Als het bewijs te dun is voor een oordeel, zegt de agent dat in plaats van er
een te produceren. Ontbreekt er iets om te kunnen beginnen, dan vraagt hij het
in plaats van het in te vullen.
`;
}

/* Maakt de bestanden aan. Bestaat er al een, dan blijft die staan:
 * jouw eigen aanpassingen zijn belangrijker dan mijn sjabloon. */
export async function maakAgents(root, ids, bedrijf){
  const agentDir = join(root, ".claude", "agents");
  const capDir = join(root, "workflows", "capabilities");
  await mkdir(agentDir, { recursive: true });
  await mkdir(capDir, { recursive: true });

  const gemaakt = [], overgeslagen = [];
  for (const id of ids){
    const a = CATALOGUS.find(x => x.id === id);
    if (!a) continue;
    const ap = join(agentDir, a.id + ".md");
    const cp = join(capDir, a.id + ".md");
    if (existsSync(ap)){ overgeslagen.push(a.id); continue; }
    await writeFile(ap, agentMd(a, bedrijf), "utf8");
    if (!existsSync(cp)) await writeFile(cp, capabilityMd(a), "utf8");
    gemaakt.push(a.id);
  }
  return { gemaakt, overgeslagen };
}

/* Welke agents staan er al? */
export async function bestaande(root){
  const dir = join(root, ".claude", "agents");
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, ""));
}
