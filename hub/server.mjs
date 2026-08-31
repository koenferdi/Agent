#!/usr/bin/env node
// Validatiedesk — lokale webinterface voor de agents in deze workspace.
// Geen dependencies: alleen Node built-ins. Start met: node hub/server.mjs
import { createServer } from "node:http";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { platform, networkInterfaces } from "node:os";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { CATALOGUS, namen, maakAgents, bestaande } from "./agentfabriek.mjs";
import { AANBIEDERS, overzicht as sleutelOverzicht, zet as zetSleutel } from "./sleutels.mjs";
import { lijst as modellenLijst, standaard as standaardModel, bruikbareAanbieders } from "./modellen.mjs";
import { draai, runs as leesRuns } from "./runner.mjs";
import { status as gereedschapStatus } from "./gereedschap.mjs";

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 18) {
  console.error(`\n  Deze hub heeft Node 18 of hoger nodig. Jij hebt ${process.versions.node}.`);
  console.error(`  Download een nieuwere versie op https://nodejs.org en probeer het opnieuw.\n`);
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC = join(HERE, "public");
const DESK = join(HERE, "desk.json");
const BEDRIJF = join(ROOT, "bedrijf.json");
const PORT = Number(process.env.PORT || 4317);
// Standaard alleen bereikbaar op deze computer. HOST=0.0.0.0 stelt hem open
// voor andere apparaten op hetzelfde wifi-netwerk (zie "npm run mobiel").
const HOST = process.env.HOST || "127.0.0.1";
const LOOPBACK = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
const OPEN_TO_NETWORK = !LOOPBACK;

// Zodra de hub buiten deze computer bereikbaar is, moet er een wachtwoord op.
// Staat er geen in HUB_PASSWORD, dan verzint de server er zelf een en drukt hem af.
let PASSWORD = process.env.HUB_PASSWORD || "";
let GENERATED = false;
function friendlyPassword(){
  // Geen tekens die op elkaar lijken (0/O, 1/l/I), in groepjes van vier:
  // makkelijk overtypen op een telefoon.
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n) => Array.from(randomBytes(n))
    .map(b => abc[b % abc.length]).join("");
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}
if (OPEN_TO_NETWORK && !PASSWORD) {
  PASSWORD = friendlyPassword();
  GENERATED = true;
}
// Beveiliging aan zodra de hub buiten deze computer bereikbaar is, EN altijd
// wanneer er een wachtwoord is gezet — anders staat hij open achter een
// reverse proxy die zelf wel vanaf het internet bereikbaar is.
const AUTH_ON = OPEN_TO_NETWORK || !!process.env.HUB_PASSWORD;
const sessions = new Set();
const failures = new Map();        // ip -> { n, until }

function safeEqual(a, b){
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
function cookieOf(req, name){
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")){
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function clientIP(req){
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.socket.remoteAddress || "?";
}
function lockedOut(ip){
  const f = failures.get(ip);
  return f && f.until > Date.now();
}
function noteFailure(ip){
  const f = failures.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; }   // 5 pogingen, dan een minuut wachten
  failures.set(ip, f);
}
function authed(req){
  if (!AUTH_ON) return true;
  const t = cookieOf(req, "hub_session");
  return !!t && sessions.has(t);
}

const LOGIN_PAGE = (msg) => `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Validatiedesk</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B1220;color:#E8EDF7;
 font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
form{background:#151F35;border:1px solid #38496B;border-radius:5px;padding:26px 24px;width:min(340px,92vw)}
h1{margin:0 0 4px;font-size:15px;letter-spacing:.08em}
p{margin:0 0 18px;font-size:13px;color:#9BA9C4}
label{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6B7A99;margin-bottom:5px}
input{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 11px;border-radius:3px;
 border:1px solid #38496B;background:#111A2C;color:#E8EDF7}
button{margin-top:14px;width:100%;font:inherit;font-size:14px;font-weight:600;padding:10px;border-radius:3px;
 border:0;background:#F5C542;color:#141C2E;cursor:pointer}
.err{margin:12px 0 0;font-size:12.5px;color:#F0B454}
</style></head><body>
<form method="POST" action="/login">
<h1>VALIDATIEDESK</h1>
<p>Deze hub is met een wachtwoord afgeschermd.</p>
<label for="w">Wachtwoord</label>
<input id="w" name="password" type="password" autofocus autocomplete="current-password"
 autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="text">
<button type="submit">Openen</button>
${msg ? `<p class="err">${msg}</p>` : ""}
</form></body></html>`;

function lanAddress(){
  for (const iface of Object.values(networkInterfaces())){
    for (const net of iface || []){
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8", ".webmanifest":"application/manifest+json; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon" };

/* ---------- lezen van de echte workspace ---------- */

// Frontmatter van .claude/agents/*.md
async function readAgents(){
  const dir = join(ROOT, ".claude", "agents");
  if(!existsSync(dir)) return [];
  const out = [];
  for(const f of (await readdir(dir)).filter(f=>f.endsWith(".md"))){
    const raw = await readFile(join(dir,f),"utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = {};
    if(m){
      // simpele YAML: alleen key: value op topniveau, waarde mag doorlopen
      let key=null;
      for(const line of m[1].split(/\r?\n/)){
        const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
        if(kv){ key = kv[1]; fm[key] = kv[2]; }
        else if(key && line.trim()) fm[key] += " " + line.trim();
      }
    }
    out.push({
      id: fm.name || f.replace(/\.md$/,""),
      description: (fm.description||"").trim(),
      model: fm.model || "inherit",
      tools: (fm.tools||"").split(",").map(s=>s.trim()).filter(Boolean),
      file: `.claude/agents/${f}`
    });
  }
  return out;
}

// Capaciteiten uit workflows/capabilities/*.md
function parseFrontmatter(raw){
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if(!m) return { fm:{}, body: raw };
  const fm = {}; let key = null;
  for(const line of m[1].split(/\r?\n/)){
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if(kv){ key = kv[1]; fm[key] = kv[2]; }
    else if(key && line.trim()) fm[key] += " " + line.trim();
  }
  for(const k of Object.keys(fm)){
    const v = (fm[k]||"").trim();
    if(/^\[.*\]$/.test(v))
      fm[k] = v.slice(1,-1).split(",").map(x=>x.trim()).filter(Boolean);
    else fm[k] = v;
  }
  return { fm, body: m[2] };
}

async function readCapabilities(){
  const dir = join(ROOT, "workflows", "capabilities");
  if(!existsSync(dir)) return [];
  const out = [];
  for(const f of (await readdir(dir)).filter(f=>f.endsWith(".md"))){
    const { fm, body } = parseFrontmatter(await readFile(join(dir,f),"utf8"));
    out.push({
      name: fm.name || f.replace(/\.md$/,""),
      title: fm.title || fm.name || f,
      department: fm.department || "overig",
      status: fm.status || "planned",
      ladder: fm.ladder || "human-led",
      replaces: fm.replaces || "",
      human: fm.human || "",
      done_by: fm.done_by || "",
      runtime: fm.runtime || "",
      builds_on: Array.isArray(fm.builds_on) ? fm.builds_on : (fm.builds_on ? [fm.builds_on] : []),
      breaks_into: Array.isArray(fm.breaks_into) ? fm.breaks_into : (fm.breaks_into ? [fm.breaks_into] : []),
      body, file: `workflows/capabilities/${f}`
    });
  }
  return out;
}

// Rapporten in /drafts, inclusief het metadatablok bovenaan
async function readDrafts(){
  const dir = join(ROOT, "drafts");
  if(!existsSync(dir)) return [];
  const out = [];
  for(const f of (await readdir(dir)).filter(f=>f.endsWith(".md") && f!=="README.md")){
    const p = join(dir,f);
    const raw = await readFile(p,"utf8");
    const st = await stat(p);
    const block = raw.match(/^```\r?\n([\s\S]*?)\r?\n```/);
    const meta = {};
    if(block){
      for(const line of block[1].split(/\r?\n/)){
        const kv = line.match(/^([A-Za-z ]+):\s+(.*)$/);
        if(kv) meta[kv[1].trim().toLowerCase()] = kv[2].trim();
        else if(line.startsWith(" ") && Object.keys(meta).length){
          const last = Object.keys(meta).pop();
          meta[last] += " " + line.trim();
        }
      }
    }
    const h1 = raw.match(/^#\s+(.+)$/m);
    out.push({
      file: f, title: h1 ? h1[1] : f.replace(/\.md$/,"").replace(/-/g," "),
      meta, words: raw.split(/\s+/).length, modified: st.mtime.toISOString()
    });
  }
  out.sort((a,b)=> b.modified.localeCompare(a.modified));
  return out;
}

// bedrijf.json: wie jij bent en hoe je bedrijf heet. Staat buiten git.
async function readBedrijf(){
  if(!existsSync(BEDRIJF)) return null;
  try { return JSON.parse(await readFile(BEDRIJF,"utf8")); }
  catch { return null; }
}

async function readDesk(){
  if(!existsSync(DESK)) return { briefs: [], decisions: [] };
  try { return JSON.parse(await readFile(DESK,"utf8")); }
  catch { return { briefs: [], decisions: [] }; }
}

/* ---------- http ---------- */

function send(res, code, body, type="application/json; charset=utf-8"){
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = createServer(async (req,res)=>{
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try{
    if (AUTH_ON){
      const ip = clientIP(req);
      if (url.pathname === "/login" && req.method === "POST"){
        if (lockedOut(ip))
          return send(res, 429, LOGIN_PAGE("Te veel pogingen. Wacht een minuut."), "text/html; charset=utf-8");
        let body = ""; for await (const c of req){ body += c; if (body.length > 4096) break; }
        const given = (new URLSearchParams(body).get("password") || "").trim();
        if (safeEqual(given, String(PASSWORD).trim())){
          const token = randomBytes(32).toString("hex");
          sessions.add(token);
          const secure = (req.headers["x-forwarded-proto"] === "https") ? "; Secure" : "";
          res.writeHead(302, { location: "/",
            "set-cookie": `hub_session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${secure}` });
          return res.end();
        }
        noteFailure(ip);
        return send(res, 401, LOGIN_PAGE("Wachtwoord klopt niet."), "text/html; charset=utf-8");
      }
      if (!authed(req)){
        if (url.pathname.startsWith("/api/"))
          return send(res, 401, '{"error":"niet ingelogd"}');
        return send(res, 200, LOGIN_PAGE(""), "text/html; charset=utf-8");
      }
    }
    if(url.pathname === "/api/state"){
      const [agents, drafts, desk, capabilities, bedrijf] = await Promise.all(
        [readAgents(), readDrafts(), readDesk(), readCapabilities(), readBedrijf()]);
      return send(res,200,JSON.stringify({ agents, drafts, desk, capabilities, bedrijf, root: ROOT }));
    }

    // ---------- modellen en sleutels ----------
    if(url.pathname === "/api/modellen"){
      const l = await modellenLijst(ROOT, url.searchParams.get("ververs") === "1");
      const bruikbaar = await bruikbareAanbieders(ROOT);
      return send(res,200,JSON.stringify({
        modellen: l.modellen.map(m => ({ ...m, bruikbaar: bruikbaar.has(m.aanbieder) })),
        bron: l.bron, problemen: l.problemen || [],
        opgehaald: new Date(l.tijd).toISOString(),
        standaard: standaardModel(l.modellen, bruikbaar).id,
        sleutels: await sleutelOverzicht(ROOT)
      }));
    }
    if(url.pathname === "/api/sleutel" && req.method === "POST"){
      let body=""; for await (const c of req){ body += c; if(body.length > 20_000) break; }
      const g = JSON.parse(body || "{}");
      if(!AANBIEDERS.some(a => a.id === g.aanbieder)) return send(res,400,'{"error":"onbekende aanbieder"}');
      await zetSleutel(ROOT, g.aanbieder, g.sleutel || "");
      await modellenLijst(ROOT, true);   // meteen opnieuw ophalen met de nieuwe sleutel
      return send(res,200,JSON.stringify({ ok:true, sleutels: await sleutelOverzicht(ROOT) }));
    }
    if(url.pathname === "/api/gereedschap"){
      return send(res,200,JSON.stringify({ gereedschap: await gereedschapStatus(ROOT) }));
    }
    if(url.pathname === "/api/runs"){
      return send(res,200,JSON.stringify({ runs: await leesRuns(ROOT) }));
    }

    // ---------- een agent laten draaien ----------
    if(url.pathname === "/api/run" && req.method === "POST"){
      let body=""; for await (const c of req){ body += c; if(body.length > 100_000) break; }
      const g = JSON.parse(body || "{}");
      const agentId = String(g.agent || "").replace(/[^a-z0-9-]/gi,"");
      const opdracht = String(g.opdracht || "").trim();
      if(!agentId || !opdracht) return send(res,400,'{"error":"agent en opdracht zijn nodig"}');

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-accel-buffering": "no"       // caddy en nginx moeten niet bufferen
      });
      const stuur = (o) => { try { res.write("data: " + JSON.stringify(o) + "\n\n"); } catch {} };
      const stop = new AbortController();
      req.on("close", () => stop.abort());
      try {
        await draai({ root: ROOT, agentId, opdracht, modelId: g.model,
                      stap: stuur, signal: stop.signal });
      } catch (e){
        stuur({ soort:"fout", tekst: String(e && e.message || e) });
      }
      return res.end();
    }

    // ---------- onboarding ----------
    if(url.pathname === "/api/catalogus"){
      return send(res,200,JSON.stringify({
        catalogus: CATALOGUS,
        bestaande: await bestaande(ROOT),
        bedrijf: await readBedrijf()
      }));
    }
    if(url.pathname === "/api/namen"){
      const zaad = Number(url.searchParams.get("zaad")) || Date.now();
      return send(res,200,JSON.stringify({ namen: namen(zaad, 6) }));
    }
    if(url.pathname === "/api/onboarding" && req.method === "POST"){
      let body=""; for await (const c of req){ body += c; if(body.length > 200_000) break; }
      const g = JSON.parse(body || "{}");
      const operator = String(g.operator || "").trim().slice(0,80);
      const naam = String(g.bedrijf || "").trim().slice(0,80);
      if(!operator || !naam) return send(res,400,'{"error":"naam en bedrijfsnaam zijn nodig"}');
      const gekozen = Array.isArray(g.agents) ? g.agents.filter(x => CATALOGUS.some(c => c.id === x)) : [];
      const uit = await maakAgents(ROOT, gekozen, naam);
      const bedrijf = {
        operator,
        bedrijf: { naam, wat: String(g.wat || "").trim().slice(0,400), fase: g.fase || "valideren" },
        agents: gekozen,
        aangemaakt: (await readBedrijf())?.aangemaakt || new Date().toISOString(),
        bijgewerkt: new Date().toISOString()
      };
      await writeFile(BEDRIJF, JSON.stringify(bedrijf,null,2)+"\n");
      return send(res,200,JSON.stringify({ ok:true, bedrijf, ...uit }));
    }
    if(url.pathname === "/api/desk" && req.method === "POST"){
      let body=""; for await (const c of req) body += c;
      if(body.length > 2_000_000) return send(res,413,'{"error":"te groot"}');
      const parsed = JSON.parse(body);
      await writeFile(DESK, JSON.stringify(parsed,null,2)+"\n");
      return send(res,200,'{"ok":true}');
    }
    if(url.pathname === "/api/draft"){
      const f = url.searchParams.get("f")||"";
      if(!/^[a-z0-9-]+\.md$/.test(f)) return send(res,400,'{"error":"ongeldige bestandsnaam"}');
      const p = join(ROOT,"drafts",f);
      if(!p.startsWith(join(ROOT,"drafts"))) return send(res,400,'{"error":"pad geweigerd"}');
      if(!existsSync(p)) return send(res,404,'{"error":"niet gevonden"}');
      return send(res,200,JSON.stringify({ file:f, content: await readFile(p,"utf8") }));
    }
    // statische bestanden
    let name = url.pathname === "/" ? "/index.html" : url.pathname;
    const p = join(PUBLIC, name);
    if(!p.startsWith(PUBLIC) || !existsSync(p)) return send(res,404,"niet gevonden","text/plain");
    return send(res,200,await readFile(p), MIME[extname(p)] || "application/octet-stream");
  }catch(err){
    return send(res,500,JSON.stringify({ error:String(err && err.message || err) }));
  }
});

function openBrowser(url){
  if (process.env.NO_OPEN) return;
  const cmd = platform() === "darwin" ? "open"
            : platform() === "win32"  ? "cmd"
            : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); }
  catch { /* geen browser? de URL staat hieronder */ }
}

function banner(port){
  const W = 46;
  const box = (t="") => `  │${t.padEnd(W)}│`;
  const bar = (l,r) => `  ${l}${"─".repeat(W)}${r}`;
  const lan = OPEN_TO_NETWORK ? lanAddress() : null;
  console.log("");
  console.log(bar("┌","┐"));
  console.log(box("  VALIDATIEDESK"));
  console.log(bar("├","┤"));
  console.log(box("  Op deze computer:"));
  console.log(box(`    http://localhost:${port}`));
  if (OPEN_TO_NETWORK){
    console.log(box());
    console.log(box("  Op je telefoon:"));
    console.log(box(lan ? `    http://${lan}:${port}` : "    via het adres van deze server"));
  }
  console.log(box());
  console.log(box("  Stoppen: Ctrl+C"));
  console.log(bar("└","┘"));
  if (AUTH_ON){
    console.log("");
    if (GENERATED){
      console.log(`  Wachtwoord (deze keer): ${PASSWORD}`);
      console.log(`  Wil je een vast wachtwoord? Zet HUB_PASSWORD.`);
    } else {
      console.log(`  Wachtwoord: uit HUB_PASSWORD.`);
    }
    console.log("");
    console.log("  De hub is buiten deze computer bereikbaar. Draai je dit op een");
    console.log("  server aan het internet, zet er dan HTTPS voor (zie deploy/).");
  }
  console.log(`\n  Workspace: ${ROOT}\n`);
}

function listen(port, attempt = 0){
  // Elke listen()-poging registreert eigen handlers en ruimt ze zelf op,
  // anders vuurt de callback van een mislukte poging alsnog bij de volgende.
  const onError = (err)=>{
    server.off("listening", onListening);
    if (err.code === "EADDRINUSE" && attempt < 10) return listen(port + 1, attempt + 1);
    if (err.code === "EADDRINUSE") {
      console.error(`\n  De poorten ${PORT} tot ${port} zijn allemaal bezet.`);
      console.error(`  Draait de hub al in een ander venster? Kijk daar eerst.\n`);
    } else {
      console.error(`\n  Starten mislukt: ${err.message}\n`);
    }
    process.exit(1);
  };
  const onListening = ()=>{
    server.off("error", onError);
    if (port !== PORT) console.log(`\n  (Poort ${PORT} was bezet, uitgeweken naar ${port}.)`);
    banner(port);
    openBrowser(`http://localhost:${port}`);
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, HOST);
}

for (const sig of ["SIGINT","SIGTERM"]) {
  process.on(sig, ()=>{ console.log("\n  Hub gestopt.\n"); process.exit(0); });
}

listen(PORT);
