/* modellen.mjs — welke modellen kun je gebruiken, en praten met het gekozen model.
 *
 * Bewust zonder SDK's: de hub draait op een kale VPS met alleen Node, geen
 * npm install. Alles gaat via fetch. De aanroepvormen volgen de officiële
 * documentatie van elke aanbieder.
 *
 * De lijst wordt live opgehaald en tien minuten vastgehouden. Lukt dat niet —
 * geen netwerk, geen sleutel — dan valt hij terug op een ingebakken lijst die
 * ook zo gelabeld is, zodat je nooit denkt dat je naar verse gegevens kijkt.
 */
import { sleutelVan } from "./sleutels.mjs";

const TIEN_MINUTEN = 10*60*1000;
let cache = { tijd: 0, modellen: [], bron: null };

/* Ingebakken terugval. Klein gehouden en eerlijk gelabeld. */
const INGEBAKKEN = [
  { id:"anthropic/claude-opus-5", naam:"Claude Opus 5", aanbieder:"openrouter", gratis:false, context:1000000 },
  { id:"anthropic/claude-sonnet-5", naam:"Claude Sonnet 5", aanbieder:"openrouter", gratis:false, context:1000000 },
  { id:"meta-llama/llama-3.3-70b-instruct:free", naam:"Llama 3.3 70B (gratis)", aanbieder:"openrouter", gratis:true, context:65536 },
  { id:"google/gemini-2.0-flash-exp:free", naam:"Gemini 2.0 Flash (gratis)", aanbieder:"openrouter", gratis:true, context:1048576 },
  { id:"llama-3.3-70b-versatile", naam:"Llama 3.3 70B", aanbieder:"groq", gratis:true, context:32768 },
  { id:"gemini-2.0-flash", naam:"Gemini 2.0 Flash", aanbieder:"google", gratis:true, context:1048576 },
  { id:"claude-opus-5", naam:"Claude Opus 5", aanbieder:"anthropic", gratis:false, context:1000000 },
  { id:"claude-sonnet-5", naam:"Claude Sonnet 5", aanbieder:"anthropic", gratis:false, context:1000000 }
];

async function haal(url, opties = {}, ms = 9000){
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), ms);
  try { return await fetch(url, { ...opties, signal: stop.signal }); }
  finally { clearTimeout(t); }
}

/* ---------- de lijst ---------- */

async function vanOpenRouter(){
  /* deze lijst is openbaar: geen sleutel nodig om te zien wat er is */
  const r = await haal("https://openrouter.ai/api/v1/models");
  if (!r.ok) throw new Error("openrouter " + r.status);
  const d = await r.json();
  return (d.data || []).map(m => {
    const p = m.pricing || {};
    const gratis = String(m.id).endsWith(":free") ||
      (Number(p.prompt) === 0 && Number(p.completion) === 0);
    return {
      id: m.id, naam: m.name || m.id, aanbieder: "openrouter", gratis,
      context: m.context_length || null,
      prijs: gratis ? null : { in: Number(p.prompt) || 0, uit: Number(p.completion) || 0 }
    };
  });
}

async function vanGroq(sleutel){
  if (!sleutel) return [];
  const r = await haal("https://api.groq.com/openai/v1/models", {
    headers: { authorization: "Bearer " + sleutel } });
  if (!r.ok) throw new Error("groq " + r.status);
  const d = await r.json();
  return (d.data || []).map(m => ({
    id: m.id, naam: m.id, aanbieder: "groq", gratis: true,
    context: m.context_window || null, prijs: null
  }));
}

async function vanAnthropic(sleutel){
  if (!sleutel) return [];
  const r = await haal("https://api.anthropic.com/v1/models?limit=50", {
    headers: { "x-api-key": sleutel, "anthropic-version": "2023-06-01" } });
  if (!r.ok) throw new Error("anthropic " + r.status);
  const d = await r.json();
  return (d.data || []).map(m => ({
    id: m.id, naam: m.display_name || m.id, aanbieder: "anthropic", gratis: false,
    context: m.max_input_tokens || null, prijs: null
  }));
}

async function vanGoogle(sleutel){
  if (!sleutel) return [];
  const r = await haal("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(sleutel));
  if (!r.ok) throw new Error("google " + r.status);
  const d = await r.json();
  return (d.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => ({
      id: String(m.name).replace(/^models\//, ""), naam: m.displayName || m.name,
      aanbieder: "google", gratis: true, context: m.inputTokenLimit || null, prijs: null
    }));
}

/* Draait er iets lokaals? Dan zijn dat de goedkoopste modellen die je hebt. */
async function vanLokaal(){
  const r = await haal(BASIS.lokaal + "/models", {}, 2500);
  if (!r.ok) throw new Error("lokaal " + r.status);
  const d = await r.json();
  return (d.data || []).map(m => ({
    id: m.id, naam: m.id + " (lokaal)", aanbieder: "lokaal", gratis: true,
    context: null, prijs: null
  }));
}

async function vanOpenAI(sleutel){
  if (!sleutel) return [];
  const r = await haal("https://api.openai.com/v1/models", {
    headers: { authorization: "Bearer " + sleutel } });
  if (!r.ok) throw new Error("openai " + r.status);
  const d = await r.json();
  return (d.data || []).filter(m => /^(gpt|o\d)/.test(m.id))
    .map(m => ({ id: m.id, naam: m.id, aanbieder: "openai", gratis: false, context: null, prijs: null }));
}

export async function lijst(root, forceer = false){
  if (!forceer && Date.now() - cache.tijd < TIEN_MINUTEN && cache.modellen.length) return cache;

  const [or, gr, an, go, oa, lo] = await Promise.allSettled([
    vanOpenRouter(),
    vanGroq(await sleutelVan(root, "groq")),
    vanAnthropic(await sleutelVan(root, "anthropic")),
    vanGoogle(await sleutelVan(root, "google")),
    vanOpenAI(await sleutelVan(root, "openai")),
    vanLokaal()
  ]);
  const uit = [];
  const problemen = [];
  for (const [naam, r] of [["lokaal",lo],["openrouter",or],["groq",gr],["anthropic",an],["google",go],["openai",oa]]){
    if (r.status === "fulfilled") uit.push(...r.value);
    else problemen.push(naam + ": " + (r.reason && r.reason.message || "mislukt"));
  }

  if (!uit.length){
    cache = { tijd: Date.now(), modellen: INGEBAKKEN, bron: "ingebakken", problemen };
    return cache;
  }
  uit.sort((a,b) => ((b.aanbieder==="lokaal") - (a.aanbieder==="lokaal")) || (b.gratis - a.gratis) || a.naam.localeCompare(b.naam));
  cache = { tijd: Date.now(), modellen: uit, bron: "live", problemen };
  return cache;
}

/* Welk model gebruiken we als je niets kiest? Het beste gratis model dat we
 * kunnen bereiken; anders het eerste uit de ingebakken lijst. */
export function standaard(modellen){
  return (modellen.find(m => m.aanbieder === "lokaal")
      || modellen.find(m => m.gratis && m.aanbieder === "groq")
      || modellen.find(m => m.gratis)
      || modellen[0] || INGEBAKKEN[0]);
}

/* ---------- praten ----------
 * Levert stukjes tekst aan via onDelta en geeft aan het eind het geheel terug. */

/* Basisadressen. Met een omgevingsvariabele wijs je ze naar je eigen gateway
 * (LiteLLM, een proxy) of naar iets lokaals. "lokaal" is bedoeld voor Ollama of
 * LM Studio op dezelfde machine: geen sleutel, geen kosten, geen limiet. */
const BASIS = {
  openrouter: process.env.HUB_OPENROUTER_URL || "https://openrouter.ai/api/v1",
  groq:       process.env.HUB_GROQ_URL       || "https://api.groq.com/openai/v1",
  openai:     process.env.HUB_OPENAI_URL     || "https://api.openai.com/v1",
  lokaal:     process.env.HUB_LOKAAL_URL     || "http://127.0.0.1:11434/v1"
};

async function* regels(res){
  const lezer = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  while (true){
    const { done, value } = await lezer.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const stukken = rest.split("\n");
    rest = stukken.pop();
    for (const r of stukken){
      const s = r.trim();
      if (s.startsWith("data:")) yield s.slice(5).trim();
    }
  }
}

/* Praten met een model.
 *
 * `verloop` is een neutrale geschiedenis die hier per aanbieder wordt vertaald:
 *   { rol:"gebruiker",  tekst }
 *   { rol:"assistent",  tekst, vragen:[{id,naam,args}] }
 *   { rol:"gereedschap", id, naam, tekst }
 *
 * Terug komt de tekst, de gereedschapsvragen die het model stelde, en de
 * tokens. Zolang er vragen terugkomen is het model nog niet klaar. */
export async function praat({ root, aanbieder, model, systeem, verloop,
                              gereedschap = [], maxTokens = 4000, onDelta, signal }){
  const sleutel = aanbieder === "lokaal" ? "lokaal" : await sleutelVan(root, aanbieder);
  if (!sleutel) throw new Error("Er staat nog geen sleutel voor " + aanbieder
    + ". Zet er een bij Instellingen, of kies een model dat er geen nodig heeft.");

  let tekst = "", tokensIn = 0, tokensUit = 0;
  const vragen = [];

  if (aanbieder === "anthropic"){
    const berichten = [];
    for (const b of verloop){
      if (b.rol === "gebruiker") berichten.push({ role:"user", content: b.tekst });
      else if (b.rol === "assistent"){
        const inhoud = [];
        if (b.tekst) inhoud.push({ type:"text", text: b.tekst });
        for (const v of (b.vragen || [])) inhoud.push({ type:"tool_use", id: v.id, name: v.naam, input: v.args });
        berichten.push({ role:"assistant", content: inhoud });
      } else {
        const vorige = berichten[berichten.length-1];
        const blok = { type:"tool_result", tool_use_id: b.id, content: b.tekst };
        if (vorige && vorige.role === "user" && Array.isArray(vorige.content)) vorige.content.push(blok);
        else berichten.push({ role:"user", content:[blok] });
      }
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "x-api-key": sleutel, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system: systeem,
        messages: berichten, ...(gereedschap.length ? { tools: gereedschap } : {}) })
    });
    if (!res.ok) throw new Error("anthropic " + res.status + ": " + (await res.text()).slice(0,300));
    let bezig = null, ruweArgs = "";
    for await (const d of regels(res)){
      if (d === "[DONE]") break;
      let j; try { j = JSON.parse(d); } catch { continue; }
      if (j.type === "message_start" && j.message?.usage) tokensIn = j.message.usage.input_tokens || 0;
      if (j.type === "content_block_start" && j.content_block?.type === "tool_use"){
        bezig = { id: j.content_block.id, naam: j.content_block.name, args: {} }; ruweArgs = "";
      }
      if (j.type === "content_block_delta"){
        if (j.delta?.type === "text_delta"){ tekst += j.delta.text; onDelta && onDelta(j.delta.text); }
        if (j.delta?.type === "input_json_delta") ruweArgs += j.delta.partial_json || "";
      }
      if (j.type === "content_block_stop" && bezig){
        try { bezig.args = ruweArgs ? JSON.parse(ruweArgs) : {}; } catch { bezig.args = {}; }
        vragen.push(bezig); bezig = null;
      }
      if (j.type === "message_delta" && j.usage) tokensUit = j.usage.output_tokens || 0;
    }
  }

  else if (aanbieder === "google"){
    /* Google spreekt hier geen gereedschap: de agent werkt met wat hij weet. */
    const stukken = verloop.map(b => b.rol === "gereedschap"
      ? "Uitkomst van " + b.naam + ":\n" + b.tekst
      : b.tekst).filter(Boolean).join("\n\n");
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(sleutel);
    const res = await fetch(url, {
      method: "POST", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systeem ? { parts: [{ text: systeem }] } : undefined,
        contents: [{ role: "user", parts: [{ text: stukken }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    });
    if (!res.ok) throw new Error("google " + res.status + ": " + (await res.text()).slice(0,300));
    for await (const d of regels(res)){
      let j; try { j = JSON.parse(d); } catch { continue; }
      const stuk = j.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      if (stuk){ tekst += stuk; onDelta && onDelta(stuk); }
      if (j.usageMetadata){
        tokensIn = j.usageMetadata.promptTokenCount || tokensIn;
        tokensUit = j.usageMetadata.candidatesTokenCount || tokensUit;
      }
    }
  }

  else {
    const basis = BASIS[aanbieder];
    if (!basis) throw new Error("onbekende aanbieder: " + aanbieder);
    const berichten = systeem ? [{ role:"system", content: systeem }] : [];
    for (const b of verloop){
      if (b.rol === "gebruiker") berichten.push({ role:"user", content: b.tekst });
      else if (b.rol === "assistent") berichten.push({
        role:"assistant", content: b.tekst || null,
        ...( (b.vragen||[]).length ? { tool_calls: b.vragen.map(v => ({
          id: v.id, type:"function", function:{ name: v.naam, arguments: JSON.stringify(v.args||{}) } })) } : {})
      });
      else berichten.push({ role:"tool", tool_call_id: b.id, content: b.tekst });
    }
    const res = await fetch(basis + "/chat/completions", {
      method: "POST", signal,
      headers: { authorization: "Bearer " + sleutel, "content-type": "application/json",
        ...(aanbieder === "openrouter" ? { "X-Title": "Validatiedesk" } : {}) },
      body: JSON.stringify({ model, stream: true, max_tokens: maxTokens,
        stream_options: { include_usage: true }, messages: berichten,
        ...(gereedschap.length ? { tools: gereedschap, tool_choice: "auto" } : {}) })
    });
    if (!res.ok) throw new Error(aanbieder + " " + res.status + ": " + (await res.text()).slice(0,300));
    const bezig = [];
    for await (const d of regels(res)){
      if (d === "[DONE]") break;
      let j; try { j = JSON.parse(d); } catch { continue; }
      const delta = j.choices?.[0]?.delta;
      if (delta?.content){ tekst += delta.content; onDelta && onDelta(delta.content); }
      for (const tc of (delta?.tool_calls || [])){
        const i = tc.index || 0;
        bezig[i] = bezig[i] || { id: "", naam: "", ruw: "" };
        if (tc.id) bezig[i].id = tc.id;
        if (tc.function?.name) bezig[i].naam += tc.function.name;
        if (tc.function?.arguments) bezig[i].ruw += tc.function.arguments;
      }
      if (j.usage){ tokensIn = j.usage.prompt_tokens || tokensIn; tokensUit = j.usage.completion_tokens || tokensUit; }
    }
    for (const b of bezig){
      if (!b || !b.naam) continue;
      let args = {}; try { args = b.ruw ? JSON.parse(b.ruw) : {}; } catch {}
      vragen.push({ id: b.id || ("t" + vragen.length), naam: b.naam, args });
    }
  }

  return { tekst, vragen, tokensIn, tokensUit };
}

export { INGEBAKKEN };
