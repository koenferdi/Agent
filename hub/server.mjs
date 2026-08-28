#!/usr/bin/env node
// Validatiedesk — lokale webinterface voor de agents in deze workspace.
// Geen dependencies: alleen Node built-ins. Start met: node hub/server.mjs
import { createServer } from "node:http";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC = join(HERE, "public");
const DESK = join(HERE, "desk.json");
const PORT = Number(process.env.PORT || 4317);

const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
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
    if(url.pathname === "/api/state"){
      const [agents, drafts, desk, capabilities] = await Promise.all(
        [readAgents(), readDrafts(), readDesk(), readCapabilities()]);
      return send(res,200,JSON.stringify({ agents, drafts, desk, capabilities, root: ROOT }));
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

server.listen(PORT, "127.0.0.1", ()=>{
  console.log(`\n  Validatiedesk draait op http://localhost:${PORT}`);
  console.log(`  Workspace: ${ROOT}`);
  console.log(`  Stoppen: Ctrl+C\n`);
});
