/* runner.mjs — laat één agent echt werk doen.
 *
 * De agent is een bestand. Deze module leest dat bestand, bouwt er een prompt
 * van, laat het model werken, en schrijft het resultaat als rapport terug naar
 * drafts/. Elke stap gaat live naar de browser, en van elke run blijft een
 * logboek achter in runs/ met tokens en kosten.
 *
 * Wat hier niet gebeurt: gereedschap. Deze agent kan lezen en schrijven wat er
 * in zijn prompt zit, maar hij zoekt niet zelf op internet. Dat is de volgende
 * stap, en tot die er is zegt het rapport dat er geen bronnen zijn geraadpleegd.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { praat, lijst, standaard } from "./modellen.mjs";

const MAX_TOKENS = 4000;

export function slug(tekst){
  return String(tekst || "run").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "run";
}

function zonderFrontmatter(raw){
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return m ? m[1].trim() : raw.trim();
}

/* De prompt is opgebouwd uit bestanden die jij kunt lezen en aanpassen.
 * Geen verborgen instructies. */
async function bouwPrompt(root, agentId, opdracht){
  const agentPad = join(root, ".claude", "agents", agentId + ".md");
  if (!existsSync(agentPad)) throw new Error("agent bestaat niet: " + agentId);
  const agentRaw = await readFile(agentPad, "utf8");

  const capPad = join(root, "workflows", "capabilities", agentId + ".md");
  const cap = existsSync(capPad) ? zonderFrontmatter(await readFile(capPad, "utf8")) : "";

  const claudeMd = existsSync(join(root, "CLAUDE.md"))
    ? await readFile(join(root, "CLAUDE.md"), "utf8") : "";

  const systeem = [
    zonderFrontmatter(agentRaw),
    cap ? "## Jouw SOP\n\n" + cap : "",
    claudeMd ? "## De afspraken van deze werkplek\n\n" + claudeMd : "",
    `## Belangrijk voor deze run

Je draait nu zonder gereedschap: je kunt niet zoeken op internet en geen
bestanden openen. Werk met wat je weet en met wat er in deze prompt staat.
Weet je iets niet zeker, zeg dat dan. Verzin geen bronnen en geen cijfers.

Lever je antwoord als markdown, en begin met exact dit blok:

\`\`\`
Verdict: <je oordeel in één zin>
Confidence: hoog | midden | laag
Sources: <welke bronnen je gebruikt hebt, of: geen — gedraaid zonder webtoegang>
\`\`\`

Daarna een kop met # en je stuk. Schrijf in het Nederlands.`
  ].filter(Boolean).join("\n\n---\n\n");

  return { systeem, bericht: opdracht };
}

/* Kosten van een run, als we de prijs van het model kennen. */
function kosten(model, tokensIn, tokensUit){
  if (!model || !model.prijs) return null;
  return +(tokensIn*(model.prijs.in||0) + tokensUit*(model.prijs.uit||0)).toFixed(6);
}

/* Voert de run uit. `stap` wordt aangeroepen bij elke gebeurtenis. */
export async function draai({ root, agentId, opdracht, modelId, stap, signal }){
  const begin = Date.now();
  const meld = (soort, data) => { try { stap({ soort, ...data }); } catch {} };

  meld("stap", { tekst: "Opdracht ontvangen." });

  const { modellen, bron } = await lijst(root);
  const model = modellen.find(m => m.id === modelId) || standaard(modellen);
  meld("stap", { tekst: "Model gekozen: " + model.naam + " via " + model.aanbieder
    + (model.gratis ? " (gratis niveau)" : "")
    + (bron === "ingebakken" ? " — uit de ingebakken lijst, niet geverifieerd" : "") });

  const { systeem, bericht } = await bouwPrompt(root, agentId, opdracht);
  meld("stap", { tekst: "Agent geladen uit .claude/agents/" + agentId + ".md" });
  meld("model", { model: model.id, aanbieder: model.aanbieder, gratis: model.gratis });

  let uit;
  try {
    uit = await praat({
      root, aanbieder: model.aanbieder, model: model.id, systeem, bericht,
      maxTokens: MAX_TOKENS, signal,
      onDelta: t => meld("tekst", { tekst: t })
    });
  } catch (e){
    meld("fout", { tekst: String(e.message || e) });
    await logboek(root, { agentId, opdracht, model: model.id, fout: String(e.message || e),
      begonnen: new Date(begin).toISOString(), duur: Date.now()-begin });
    throw e;
  }

  /* het rapport wegschrijven */
  const naam = slug(agentId + "-" + opdracht) + ".md";
  const pad = join(root, "drafts", naam);
  await mkdir(join(root, "drafts"), { recursive: true });
  const kop = `<!-- gedraaid door de hub op ${new Date().toISOString()} · agent ${agentId} · model ${model.id} -->\n\n`;
  await writeFile(pad, kop + uit.tekst.trim() + "\n", "utf8");
  meld("stap", { tekst: "Rapport geschreven: drafts/" + naam });

  const k = kosten(model, uit.tokensIn, uit.tokensUit);
  const samen = {
    agentId, opdracht, model: model.id, aanbieder: model.aanbieder,
    bestand: naam, tokensIn: uit.tokensIn, tokensUit: uit.tokensUit, kosten: k,
    begonnen: new Date(begin).toISOString(), duur: Date.now()-begin
  };
  await logboek(root, samen);
  meld("klaar", samen);
  return samen;
}

async function logboek(root, gegevens){
  const dir = join(root, "runs");
  await mkdir(dir, { recursive: true });
  const naam = new Date().toISOString().replace(/[:.]/g,"-") + "-" + slug(gegevens.agentId) + ".json";
  await writeFile(join(dir, naam), JSON.stringify(gegevens, null, 2) + "\n", "utf8");
}

/* De laatste runs, voor het overzicht in de hub. */
export async function runs(root, hoeveel = 20){
  const dir = join(root, "runs");
  if (!existsSync(dir)) return [];
  const bestanden = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse().slice(0, hoeveel);
  const uit = [];
  for (const f of bestanden){
    try { uit.push(JSON.parse(await readFile(join(dir, f), "utf8"))); } catch {}
  }
  return uit;
}
