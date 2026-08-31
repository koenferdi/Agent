/* sleutels.mjs — API-sleutels bewaren zonder ze te lekken.
 *
 * Sleutels staan in sleutels.json naast bedrijf.json. Dat bestand staat in
 * .gitignore, wordt met rechten 600 weggeschreven, en gaat nooit als geheel
 * naar de browser: die krijgt alleen te zien welke aanbieders een sleutel
 * hebben en de laatste vier tekens, zodat je kunt controleren dat je de
 * juiste hebt geplakt.
 */
import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const AANBIEDERS = [
  { id:"openrouter", naam:"OpenRouter", env:"OPENROUTER_API_KEY",
    aanmelden:"https://openrouter.ai/keys",
    uitleg:"Eén sleutel voor honderden modellen, met een handvol gratis erbij." },
  { id:"groq", naam:"Groq", env:"GROQ_API_KEY",
    aanmelden:"https://console.groq.com/keys",
    uitleg:"Snel en met een royaal gratis niveau. Open modellen." },
  { id:"google", naam:"Google AI Studio", env:"GEMINI_API_KEY",
    aanmelden:"https://aistudio.google.com/apikey",
    uitleg:"Gemini met een gratis niveau." },
  { id:"anthropic", naam:"Anthropic", env:"ANTHROPIC_API_KEY",
    aanmelden:"https://console.anthropic.com/settings/keys",
    uitleg:"Claude. Geen gratis niveau, wel de beste kwaliteit voor dit werk." },
  { id:"brave", naam:"Brave Search", env:"BRAVE_API_KEY",
    aanmelden:"https://brave.com/search/api/",
    uitleg:"Zoeken op het web voor je agents. Gratis niveau van 2000 zoekopdrachten per maand." },
  { id:"openai", naam:"OpenAI", env:"OPENAI_API_KEY",
    aanmelden:"https://platform.openai.com/api-keys",
    uitleg:"GPT. Geen gratis niveau." }
];

const pad = (root) => join(root, "sleutels.json");

async function alles(root){
  const p = pad(root);
  if (!existsSync(p)) return {};
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return {}; }
}

/* De sleutel die we echt gaan gebruiken: eerst het bestand, dan de omgeving.
 * Zo kun je hem ook via systemd meegeven zonder hem hier op te slaan. */
export async function sleutelVan(root, aanbieder){
  const a = AANBIEDERS.find(x => x.id === aanbieder);
  if (!a) return null;
  const uit = await alles(root);
  return (uit[aanbieder] && String(uit[aanbieder]).trim()) || process.env[a.env] || null;
}

export async function zet(root, aanbieder, sleutel){
  if (!AANBIEDERS.some(x => x.id === aanbieder)) throw new Error("onbekende aanbieder");
  const uit = await alles(root);
  const schoon = String(sleutel || "").trim();
  if (schoon) uit[aanbieder] = schoon; else delete uit[aanbieder];
  await writeFile(pad(root), JSON.stringify(uit, null, 2) + "\n");
  try { await chmod(pad(root), 0o600); } catch { /* windows kent dit niet */ }
  return true;
}

/* Wat de browser mag weten. Nooit de sleutel zelf. */
export async function overzicht(root){
  const uit = await alles(root);
  return AANBIEDERS.map(a => {
    const eigen = uit[a.id] && String(uit[a.id]).trim();
    const uitOmgeving = !eigen && !!process.env[a.env];
    const s = eigen || process.env[a.env] || "";
    return {
      id: a.id, naam: a.naam, uitleg: a.uitleg, aanmelden: a.aanmelden, env: a.env,
      heeft: !!s,
      bron: eigen ? "bestand" : (uitOmgeving ? "omgeving" : null),
      staart: s ? "…" + s.slice(-4) : null
    };
  });
}
