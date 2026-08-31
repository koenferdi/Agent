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
import { praat, lijst, standaard, bruikbareAanbieders } from "./modellen.mjs";
import { GEREEDSCHAP, status as gereedschapStatus, voerUit, alsOpenAI, alsAnthropic } from "./gereedschap.mjs";

const MAX_TOKENS = 4000;
const MAX_RONDES = 6;      // hoe vaak een agent gereedschap mag pakken

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
function gereedschapUitleg(beschikbaar){
  if (!beschikbaar.length) return `## Belangrijk voor deze run

Je draait zonder gereedschap: je kunt niet zoeken en geen bestanden openen.
Werk met wat je weet. Weet je iets niet zeker, zeg dat. Verzin geen bronnen
en geen cijfers.`;
  return `## Je gereedschap

Je hebt deze stukken gereedschap. Gebruik ze echt — leun niet op je geheugen
als je het kunt opzoeken.

${beschikbaar.map(g => "- **" + g.id + "** — " + g.kort).join("\n")}

Werk zo: zoek eerst, open dan de bronnen die er toe doen, en schrijf pas
daarna. Noem in je bronnenlijst de URL's die je echt geopend hebt. Een bron
die je niet hebt gelezen noem je niet.`;
}

async function bouwPrompt(root, agentId, opdracht, beschikbaar){
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
    gereedschapUitleg(beschikbaar),
    `## Hoe je oplevert

Lever je antwoord als markdown, en begin met exact dit blok:

\`\`\`
Verdict: <je oordeel in één zin>
Confidence: hoog | midden | laag
Sources: <welke bronnen je gebruikt hebt, of: geen — gedraaid zonder webtoegang>
\`\`\`

Daarna een kop met # en je stuk. Schrijf in het Nederlands.`
  ].filter(Boolean).join("\n\n---\n\n");

  return { systeem };
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
  const bruikbaar = await bruikbareAanbieders(root);
  const model = modellen.find(m => m.id === modelId) || standaard(modellen, bruikbaar);
  meld("stap", { tekst: "Model gekozen: " + model.naam + " via " + model.aanbieder
    + (model.gratis ? " (gratis niveau)" : "")
    + (bron === "ingebakken" ? " — uit de ingebakken lijst, niet geverifieerd" : "") });

  /* welk gereedschap mag deze agent, en werkt het? */
  const status = await gereedschapStatus(root);
  const magNiet = new Set();
  try {
    const agentRaw = await readFile(join(root, ".claude", "agents", agentId + ".md"), "utf8");
    const m = agentRaw.match(/^tools:\s*(.*)$/m);
    if (m && /geen/i.test(m[1])) status.forEach(g => magNiet.add(g.id));
  } catch {}
  const kanNietMetGereedschap = model.aanbieder === "google";
  const beschikbaar = kanNietMetGereedschap ? [] : status.filter(g => g.klaar && !magNiet.has(g.id));

  const { systeem } = await bouwPrompt(root, agentId, opdracht, beschikbaar);
  meld("stap", { tekst: "Agent geladen uit .claude/agents/" + agentId + ".md" });
  meld("stap", { tekst: beschikbaar.length
    ? "Gereedschap aan: " + beschikbaar.map(g => g.id).join(", ")
    : (kanNietMetGereedschap ? "Dit model werkt hier zonder gereedschap."
                             : "Geen gereedschap beschikbaar — hij werkt uit zijn geheugen.") });
  meld("model", { model: model.id, aanbieder: model.aanbieder, gratis: model.gratis,
                  gereedschap: beschikbaar.map(g => g.id) });

  const vorm = model.aanbieder === "anthropic" ? alsAnthropic(beschikbaar) : alsOpenAI(beschikbaar);
  const verloop = [{ rol: "gebruiker", tekst: opdracht }];
  let uit = { tekst: "", tokensIn: 0, tokensUit: 0 }, gebruikt = [];

  for (let ronde = 0; ronde < MAX_RONDES; ronde++){
    let r;
    try {
      r = await praat({ root, aanbieder: model.aanbieder, model: model.id, systeem, verloop,
        gereedschap: vorm, maxTokens: MAX_TOKENS, signal,
        onDelta: t => meld("tekst", { tekst: t }) });
    } catch (e){
      meld("fout", { tekst: String(e.message || e) });
      await logboek(root, { agentId, opdracht, model: model.id, fout: String(e.message || e),
        begonnen: new Date(begin).toISOString(), duur: Date.now()-begin });
      throw e;
    }
    uit.tokensIn += r.tokensIn; uit.tokensUit += r.tokensUit;
    uit.tekst = r.tekst;

    if (!r.vragen.length) break;

    verloop.push({ rol: "assistent", tekst: r.tekst, vragen: r.vragen });
    for (const v of r.vragen){
      meld("gereedschap", { naam: v.naam, args: v.args });
      const res = await voerUit(root, v.naam, v.args || {});
      gebruikt.push({ naam: v.naam, args: v.args, kort: res.kort });
      meld("stap", { tekst: res.kort });
      verloop.push({ rol: "gereedschap", id: v.id, naam: v.naam, tekst: res.tekst });
    }
    if (ronde === MAX_RONDES - 1)
      meld("stap", { tekst: "Grens van " + MAX_RONDES + " rondes bereikt; hij rondt af met wat hij heeft." });
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
    gereedschap: gebruikt,
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
