/* gereedschap.mjs — wat een agent tijdens een run mag doen.
 *
 * Vier stuks, allemaal alleen-lezen. Een agent kan zoeken, een pagina ophalen,
 * en in deze workspace lezen. Schrijven doet hij niet zelf: het rapport wordt
 * aan het eind door de runner weggeschreven, zodat er nooit iets ongemerkt
 * verandert.
 *
 * Elk stuk gereedschap zegt zelf of het klaar is voor gebruik. Is het dat niet,
 * dan krijgt de agent het niet aangeboden en zie jij in de bibliotheek waarom.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { sleutelVan } from "./sleutels.mjs";

const MAX_TEKST = 9000;          // wat er per keer terugkomt naar het model
const LEESBAAR = new Set([".md",".txt",".json",".csv",".mjs",".js",".css",".html",".yml",".yaml"]);

export const GEREEDSCHAP = [
  {
    id: "web_zoek", naam: "Zoeken op het web", icoon: "⌕",
    kort: "Zoekt op een vraag en geeft de eerste treffers met titel, link en samenvatting terug.",
    waarom: "Zonder dit weet een agent alleen wat er in zijn prompt staat.",
    nodig: "Een zoekmachine: een eigen SearXNG (gratis, zelf te draaien) of een Brave-sleutel.",
    schema: { type:"object", required:["vraag"], properties:{
      vraag: { type:"string", description:"Waar je op zoekt. Wees specifiek." },
      aantal: { type:"integer", description:"Hoeveel treffers, standaard 6." } } }
  },
  {
    id: "web_haal", naam: "Een pagina ophalen", icoon: "↓",
    kort: "Haalt één webpagina op en geeft de tekst terug, zonder opmaak en zonder menu's.",
    waarom: "Een treffer uit de zoekmachine is een samenvatting. Dit leest het stuk zelf.",
    nodig: "Niets. Werkt zolang de machine het internet op mag.",
    schema: { type:"object", required:["url"], properties:{
      url: { type:"string", description:"Volledige URL, inclusief https://" } } }
  },
  {
    id: "lees_bestand", naam: "Een bestand lezen", icoon: "▤",
    kort: "Leest een bestand uit deze workspace, bijvoorbeeld een eerder rapport.",
    waarom: "Zo bouwt een agent voort op wat er al ligt in plaats van opnieuw te beginnen.",
    nodig: "Niets. Alleen binnen je workspace en alleen tekstbestanden.",
    schema: { type:"object", required:["pad"], properties:{
      pad: { type:"string", description:"Pad vanaf de workspace, bijvoorbeeld drafts/rapport.md" } } }
  },
  {
    id: "lijst_bestanden", naam: "Kijken wat er ligt", icoon: "☰",
    kort: "Geeft de bestanden in een map van de workspace.",
    waarom: "Een agent moet kunnen zien wat er al is voordat hij iets leest.",
    nodig: "Niets.",
    schema: { type:"object", properties:{
      map: { type:"string", description:"Map vanaf de workspace, bijvoorbeeld drafts. Leeg = de hoofdmap." } } }
  }
];

/* ---------- is het bruikbaar? ---------- */

export async function status(root){
  const brave = await sleutelVan(root, "brave");
  const searx = process.env.SEARX_URL || "";
  return GEREEDSCHAP.map(g => {
    if (g.id === "web_zoek"){
      if (searx) return { ...g, klaar: true, via: "SearXNG op " + searx };
      if (brave) return { ...g, klaar: true, via: "Brave Search" };
      return { ...g, klaar: false, via: null,
        reden: "Geen zoekmachine ingesteld. Zet SEARX_URL, of een Brave-sleutel bij instellingen." };
    }
    return { ...g, klaar: true, via: g.id === "web_haal" ? "rechtstreeks" : "je workspace" };
  });
}

/* ---------- uitvoeren ---------- */

function ontdoeVanHtml(html){
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

async function haal(url, opties = {}, ms = 12000){
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), ms);
  try {
    return await fetch(url, {
      ...opties,
      redirect: "follow",
      signal: stop.signal,
      headers: { "user-agent": "Validatiedesk/1.0 (agent-hub)", ...(opties.headers || {}) }
    });
  } finally { clearTimeout(t); }
}

async function zoek(root, vraag, aantal = 6){
  const searx = process.env.SEARX_URL;
  if (searx){
    const r = await haal(searx.replace(/\/$/,"") + "/search?format=json&q=" + encodeURIComponent(vraag));
    if (!r.ok) throw new Error("searx gaf " + r.status);
    const d = await r.json();
    return (d.results || []).slice(0, aantal).map(x => ({
      titel: x.title, url: x.url, samenvatting: (x.content || "").slice(0, 300) }));
  }
  const brave = await sleutelVan(root, "brave");
  if (brave){
    const r = await haal("https://api.search.brave.com/res/v1/web/search?count=" + aantal
      + "&q=" + encodeURIComponent(vraag), { headers: { "x-subscription-token": brave, accept: "application/json" } });
    if (!r.ok) throw new Error("brave gaf " + r.status);
    const d = await r.json();
    return ((d.web && d.web.results) || []).slice(0, aantal).map(x => ({
      titel: x.title, url: x.url, samenvatting: (x.description || "").slice(0, 300) }));
  }
  throw new Error("Er is geen zoekmachine ingesteld. Zet SEARX_URL of een Brave-sleutel.");
}

/* Voert één stuk gereedschap uit. Geeft tekst terug voor het model, plus een
 * korte regel voor het scherm. Fouten worden teruggegeven, niet gegooid: een
 * agent moet kunnen zien dat iets niet lukte en het anders proberen. */
export async function voerUit(root, naam, args){
  try {
    if (naam === "web_zoek"){
      const treffers = await zoek(root, String(args.vraag || ""), Math.min(10, args.aantal || 6));
      if (!treffers.length) return { kort: "zocht op \"" + args.vraag + "\" — niets gevonden", tekst: "Geen treffers." };
      return {
        kort: "zocht op \"" + String(args.vraag).slice(0,60) + "\" — " + treffers.length + " treffers",
        tekst: treffers.map((t,i) => (i+1) + ". " + t.titel + "\n   " + t.url + "\n   " + t.samenvatting).join("\n\n")
      };
    }

    if (naam === "web_haal"){
      const url = String(args.url || "");
      if (!/^https?:\/\//i.test(url)) return { kort: "ongeldige url", tekst: "Dat is geen geldige URL." };
      const r = await haal(url);
      if (!r.ok) return { kort: "kon " + url + " niet ophalen (" + r.status + ")",
                          tekst: "De pagina gaf status " + r.status + "." };
      const soort = r.headers.get("content-type") || "";
      const rauw = await r.text();
      const tekst = /html/i.test(soort) ? ontdoeVanHtml(rauw) : rauw;
      const geknipt = tekst.slice(0, MAX_TEKST);
      return {
        kort: "las " + url + " (" + geknipt.length + " tekens)",
        tekst: "Bron: " + url + "\n\n" + geknipt + (tekst.length > MAX_TEKST ? "\n\n[…afgekapt]" : "")
      };
    }

    if (naam === "lees_bestand"){
      const pad = resolve(root, String(args.pad || "").replace(/^[\/\\]+/, ""));
      if (!pad.startsWith(resolve(root))) return { kort: "pad geweigerd", tekst: "Dat pad ligt buiten de workspace." };
      if (!existsSync(pad)) return { kort: "niet gevonden: " + args.pad, tekst: "Dat bestand bestaat niet." };
      if (!LEESBAAR.has(extname(pad))) return { kort: "geen tekstbestand", tekst: "Dat bestandstype lees ik niet." };
      const info = await stat(pad);
      if (info.size > 400000) return { kort: "te groot", tekst: "Dat bestand is te groot om in te lezen." };
      const inhoud = (await readFile(pad, "utf8")).slice(0, MAX_TEKST);
      return { kort: "las " + args.pad, tekst: "Bestand: " + args.pad + "\n\n" + inhoud };
    }

    if (naam === "lijst_bestanden"){
      const map = resolve(root, String(args.map || "").replace(/^[\/\\]+/, ""));
      if (!map.startsWith(resolve(root))) return { kort: "pad geweigerd", tekst: "Dat pad ligt buiten de workspace." };
      if (!existsSync(map)) return { kort: "map bestaat niet", tekst: "Die map bestaat niet." };
      const namen = (await readdir(map, { withFileTypes: true }))
        .filter(d => !d.name.startsWith(".") && d.name !== "node_modules")
        .map(d => d.isDirectory() ? d.name + "/" : d.name).sort();
      return { kort: "keek in " + (args.map || "de hoofdmap") + " — " + namen.length + " stuks",
               tekst: namen.join("\n") || "(leeg)" };
    }

    return { kort: "onbekend gereedschap: " + naam, tekst: "Dat gereedschap bestaat niet." };
  } catch (e){
    return { kort: naam + " liep vast: " + (e.message || e), tekst: "Fout: " + (e.message || e) };
  }
}

/* De vorm die de modellen willen zien. */
export function alsOpenAI(lijst){
  return lijst.map(g => ({ type:"function", function:{ name:g.id, description:g.kort + " " + g.waarom, parameters:g.schema } }));
}
export function alsAnthropic(lijst){
  return lijst.map(g => ({ name:g.id, description:g.kort + " " + g.waarom, input_schema:g.schema }));
}
