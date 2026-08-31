/* sterrenkaart.js — je bedrijf als sterrenbeeld.
 *
 * Eén afdeling tegelijk in beeld: bovenin het gereedschap, daaronder de
 * agents die het gebruiken, daaronder wat ze doen, en onderin de afdeling
 * zelf met de kern eronder. De buren staan vaag aan de zijkant.
 *
 * Alles komt uit workflows/capabilities: department, done_by, runtime en
 * breaks_into hebben precies deze vorm. Er wordt niets bij verzonnen — een
 * afdeling zonder agent laat een lege plek zien, geen gevulde.
 */
import { THEME, AGENT_COLOR } from "./iso-theme.js";

const clamp = (n,a,b) => Math.max(a, Math.min(b, n));
const lerp  = (a,b,t) => a + (b-a)*t;

/* Afdelingen in vaste volgorde, met hun kleur. Dezelfde als op de vloer. */
export const AFDELING = [
  { naam:"kennis",    label:"Kennis",    kleur:"#4FD1C5" },
  { naam:"aanbod",    label:"Aanbod",    kleur:"#5FCE9B" },
  { naam:"markt",     label:"Markt",     kleur:"#E0A458" },
  { naam:"financien", label:"Financien", kleur:"#6BA8F5" },
  { naam:"operatie",  label:"Operatie",  kleur:"#A78BFA" }
];

const AGENTNAAM = {
  "market-researcher":   "Marktonderzoeker",
  "customer-researcher": "Klantonderzoeker",
  "strategy-analyst":    "Strateeg",
  "content-creator":     "Contentmaker"
};
const mooi = id => AGENTNAAM[id] || String(id||"").replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase());

export class Sterrenkaart {
  constructor(canvas, opts = {}){
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = opts.onSelect || function(){};
    this.onWissel = opts.onWissel || function(){};
    this.ix = 0;
    this.clusters = [];
    this.knopen = [];
    this.gekozen = null;
    this.zoek = "";
    this.t = 0; this._prev = 0;
    this.overgang = 1;
    this.zichtbaar = true;
    this.reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.cam = { x:0, y:0, s:1 };

    this._bol = [];
    const n = 460, gulden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++){
      const y = 1 - (i/(n-1))*2, r = Math.sqrt(1 - y*y), th = gulden*i;
      this._bol.push({ x: Math.cos(th)*r, y, z: Math.sin(th)*r, f: Math.random()*6.3 });
    }

    this._bind(); this._resize();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  /* ---------------- gegevens ---------------- */

  setState(state){
    const caps = state.capabilities || [];
    const agents = state.agents || [];
    const briefs = (state.desk && state.desk.briefs) || [];

    this.clusters = AFDELING.map(a => {
      const mijn = caps.filter(c => c.department === a.naam);
      const tools = [];
      mijn.forEach(c => String(c.runtime || "").split("·").map(s => s.trim()).filter(Boolean)
        .forEach(t => { if (tools.indexOf(t) < 0) tools.push(t); }));
      const bemand = [];
      mijn.forEach(c => {
        if (!c.done_by) return;
        if (bemand.some(b => b.id === c.done_by)) return;
        const ag = agents.find(x => x.id === c.done_by);
        const eigen = [];
        mijn.filter(x => x.done_by === c.done_by).forEach(x =>
          String(x.runtime || "").split("·").map(t => t.trim()).filter(Boolean)
            .forEach(t => { if (eigen.indexOf(t) < 0) eigen.push(t); }));
        bemand.push({
          id: c.done_by, naam: mooi(c.done_by),
          kleur: AGENT_COLOR[c.done_by] || a.kleur,
          model: ag ? ag.model : "?", tools: ag ? ag.tools.length : 0,
          gereedschap: eigen,
          werk: briefs.filter(b => b.agent === c.done_by).length
        });
      });
      return {
        naam: a.naam, label: a.label, kleur: a.kleur,
        caps: mijn.map(c => ({
          naam: c.name, titel: c.title, status: c.status, agent: c.done_by || null,
          stappen: c.breaks_into || [], ladder: c.ladder, mens: c.human, vervangt: c.replaces
        })),
        tools, agents: bemand
      };
    });
    this._legKlaar();
    return this;
  }

  toon(naam){
    const i = this.clusters.findIndex(c => c.naam === naam);
    if (i >= 0 && i !== this.ix){ this.ix = i; this.overgang = 0; this._legKlaar(); this.onWissel(this.huidige()); }
    return this;
  }
  volgende(d){
    this.ix = (this.ix + d + this.clusters.length) % this.clusters.length;
    this.overgang = 0; this.gekozen = null; this._legKlaar(); this.onWissel(this.huidige());
    return this;
  }
  huidige(){ return this.clusters[this.ix] || null; }
  zoeken(tekst){ this.zoek = String(tekst || "").trim().toLowerCase(); return this; }

  /* ---------------- indeling ----------------
   * In wereldeenheden rond (0,0). De camera schaalt het naar het scherm. */
  _legKlaar(){
    const c = this.huidige();
    this.knopen = [];
    if (!c) return;

    const rij = (lijst, y, soort) => {
      const n = lijst.length || 1;
      const breedte = Math.min(760, Math.max(260, n*150));
      lijst.forEach((it, i) => {
        const x = n === 1 ? 0 : -breedte/2 + (breedte/(n-1))*i;
        this.knopen.push(Object.assign({ x, y, soort }, it));
      });
    };

    rij(c.tools.map(t => ({ id:"tool:"+t, label:t, kleur:"#E0703C" })), -300, "tool");

    /* agents; een capaciteit zonder agent krijgt een lege plek */
    const agentKnopen = c.agents.map(a => ({ id:"agent:"+a.id, label:a.naam, kleur:a.kleur, agent:a }));
    const leeg = c.caps.filter(x => !x.agent).length;
    for (let i = 0; i < leeg; i++) agentKnopen.push({ id:"leeg:"+i, label:"geen agent", kleur:"#5A6982", leeg:true });
    rij(agentKnopen, -150, "agent");

    rij(c.caps.map(x => ({ id:"cap:"+x.naam, label:x.titel, kleur:c.kleur, cap:x })), -10, "cap");

    this.knopen.push({ id:"dept:"+c.naam, x:0, y:150, soort:"dept", label:c.label.toUpperCase(), kleur:c.kleur });
  }

  _knoop(id){ return this.knopen.find(k => k.id === id) || null; }

  /* Welke knopen horen bij deze? Zo kan de rest terugtreden als je ergens
   * overheen gaat: dat is het verschil tussen een plaatje en een kaart. */
  _verwant(id){
    const uit = new Set([id]);
    const k = this._knoop(id); if (!k) return uit;
    const cl = this.huidige(); if (!cl) return uit;
    const capsVan = a => cl.caps.filter(c => c.agent === a);
    if (k.soort === "dept"){ this.knopen.forEach(x => uit.add(x.id)); return uit; }
    if (k.soort === "tool"){
      this.knopen.filter(x => x.soort === "agent" && x.agent
        && (x.agent.gereedschap || []).indexOf(k.label) >= 0)
        .forEach(x => { uit.add(x.id); capsVan(x.agent.id).forEach(c => uit.add("cap:" + c.naam)); });
    }
    if (k.soort === "agent" && k.agent){
      capsVan(k.agent.id).forEach(c => uit.add("cap:" + c.naam));
      this.knopen.filter(x => x.soort === "tool"
        && (k.agent.gereedschap || []).indexOf(x.label) >= 0).forEach(x => uit.add(x.id));
    }
    if (k.soort === "cap" && k.cap && k.cap.agent){
      uit.add("agent:" + k.cap.agent);
      const ag = cl.agents.find(a => a.id === k.cap.agent);
      if (ag) this.knopen.filter(x => x.soort === "tool"
        && (ag.gereedschap || []).indexOf(x.label) >= 0).forEach(x => uit.add(x.id));
    }
    uit.add("dept:" + cl.naam);
    return uit;
  }

  /* ---------------- camera en invoer ---------------- */

  _pas(){
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const staand = H > W;
    this.cam.s = clamp(Math.min(W/(staand ? 800 : 1080), H/760), .34, 1.15);
    this.cam.x = W/2;
    this.cam.y = H/2 + 22*this.cam.s;
  }
  _naarScherm(x, y){ return { x: this.cam.x + x*this.cam.s, y: this.cam.y + y*this.cam.s }; }

  _bind(){
    const cv = this.cv, self = this;
    const h = this._h = {};
    const pos = e => {
      const r = cv.getBoundingClientRect();
      const t = (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    h.tik = e => {
      const p = pos(e);
      let raak = null, best = 34*self.cam.s;
      for (const k of self.knopen){
        const s = self._naarScherm(k.x, k.y);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < best){ best = d; raak = k; }
      }
      self.gekozen = raak ? raak.id : null;
      self.onSelect(raak, self.huidige());
    };
    h.beweeg = e => {
      const p = pos(e);
      let over = null, best = 34*self.cam.s;
      for (const k of self.knopen){
        const s = self._naarScherm(k.x, k.y);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < best){ best = d; over = k; }
      }
      self.hover = over ? over.id : null;
      cv.style.cursor = over ? "pointer" : "default";
    };
    h.resize = () => self._resize();
    h.zicht = () => { self.zichtbaar = document.visibilityState !== "hidden"; };
    cv.addEventListener("click", h.tik);
    cv.addEventListener("mousemove", h.beweeg);
    window.addEventListener("resize", h.resize);
    document.addEventListener("visibilitychange", h.zicht);
  }
  destroy(){
    cancelAnimationFrame(this._raf);
    const cv = this.cv, h = this._h;
    cv.removeEventListener("click", h.tik);
    cv.removeEventListener("mousemove", h.beweeg);
    window.removeEventListener("resize", h.resize);
    document.removeEventListener("visibilitychange", h.zicht);
  }
  _resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 500;
    this.cv.width = Math.round(w*dpr); this.cv.height = Math.round(h*dpr);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this._pas();
  }

  /* ---------------- tekenen ---------------- */

  _loop(ts){
    const dt = Math.min(.05, (ts - (this._prev || ts))/1000);
    this._prev = ts; this.t += dt;
    this.overgang = Math.min(1, this.overgang + dt*2.2);
    if (this.zichtbaar) this._teken();
    this._raf = requestAnimationFrame(this._loop);
  }

  _teken(){
    const c = this.ctx, W = this.cv.clientWidth, H = this.cv.clientHeight;
    this._pas();
    c.clearRect(0,0,W,H);
    c.fillStyle = "#080D18"; c.fillRect(0,0,W,H);
    c.textAlign = "center"; c.textBaseline = "middle";

    this._raster();
    const cl = this.huidige();
    if (!cl) return;

    this._buren();

    const op = this.reduced ? 1 : this.overgang;
    c.save();
    c.globalAlpha = op;

    this.nadruk = (this.hover || this.gekozen) ? this._verwant(this.hover || this.gekozen) : null;

    this._kern(cl);
    this._draden(cl);
    for (const k of this.knopen) this._punt(k, cl);
    this._kop(cl);

    c.restore();
  }

  /* Een kop in beeld: welke afdeling, met wat er in zit. */
  _kop(cl){
    const c = this.ctx, s = this.cam.s;
    const x = 18, y = 20;
    c.save();
    c.textAlign = "left"; c.textBaseline = "top";
    c.font = "600 " + (17*Math.min(1.1, Math.max(.85, s))).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillStyle = cl.kleur;
    c.fillText(cl.label.toUpperCase(), x, y);
    const w = c.measureText(cl.label.toUpperCase()).width;
    c.fillStyle = "rgba(120,150,200,.28)";
    c.fillRect(x, y + 24, w, 1);
    c.font = (11.5).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
    c.fillStyle = "#68789C";
    c.fillText(cl.agents.length + " agents · " + cl.caps.length + " capaciteiten · "
      + cl.tools.length + " gereedschap", x, y + 32);
    c.restore();
    c.textAlign = "center"; c.textBaseline = "middle";
  }

  _raster(){
    const c = this.ctx, W = this.cv.clientWidth, H = this.cv.clientHeight;
    const stap = 44 * clamp(this.cam.s, .5, 1.2);
    c.save();
    c.strokeStyle = "rgba(90,125,190,.055)"; c.lineWidth = 1;
    c.beginPath();
    for (let x = (this.cam.x % stap); x < W; x += stap){ c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = (this.cam.y % stap); y < H; y += stap){ c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.restore();
  }

  /* de bol onder de afdeling: de kern waar alles omheen hangt */
  _kern(cl){
    const c = this.ctx, s = this._naarScherm(0, 252), R = 78*this.cam.s;
    const draai = this.reduced ? 0 : this.t*.18;
    c.save();
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, R*1.9);
    g.addColorStop(0, cl.kleur + "33"); g.addColorStop(1, cl.kleur + "00");
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, R*1.9, 0, 7); c.fill();

    c.globalCompositeOperation = "lighter";
    for (const p of this._bol){
      const cs = Math.cos(draai), sn = Math.sin(draai);
      const x = p.x*cs - p.z*sn, z = p.x*sn + p.z*cs;
      const d = 2.6/(2.6 + z);
      const px = s.x + x*R*d, py = s.y + p.y*R*d;
      const a = (.18 + (z + 1)/2*.5) * (.65 + Math.sin(this.t*1.4 + p.f)*.35);
      c.fillStyle = cl.kleur;
      c.globalAlpha = clamp(a, 0, .9);
      c.fillRect(px, py, Math.max(1, 1.7*d*this.cam.s), Math.max(1, 1.7*d*this.cam.s));
    }
    c.restore();
  }

  /* de verbindingen: tool -> agent -> capaciteit -> afdeling */
  _draden(cl){
    const c = this.ctx;
    const tools  = this.knopen.filter(k => k.soort === "tool");
    const agents = this.knopen.filter(k => k.soort === "agent");
    const caps   = this.knopen.filter(k => k.soort === "cap");
    const dept   = this.knopen.find(k => k.soort === "dept");

    const lijn = (a, b, kleur, alpha, streep) => {
      if (this.nadruk && !(this.nadruk.has(a.id) && this.nadruk.has(b.id))) alpha *= .18;
      const p = this._naarScherm(a.x, a.y), q = this._naarScherm(b.x, b.y);
      c.save();
      if (streep){ c.setLineDash([2.5*this.cam.s, 5*this.cam.s]); c.lineDashOffset = -this.t*14; }
      c.strokeStyle = kleur; c.globalAlpha = alpha; c.lineWidth = 1.1*this.cam.s;
      c.beginPath(); c.moveTo(p.x, p.y + 15*this.cam.s); c.lineTo(q.x, q.y - 15*this.cam.s); c.stroke();
      c.restore();
    };

    /* elk gereedschap hangt aan de agents die het gebruiken */
    tools.forEach(t => agents.filter(a => !a.leeg).forEach(a => {
      const naam = t.label;
      if (!a.agent || (a.agent.gereedschap || []).indexOf(naam) < 0) return;
      lijn(t, a, "#8FA6D8", .3, false);
    }));
    /* elke agent aan zijn capaciteit */
    caps.forEach(cp => {
      const bij = cp.cap.agent ? agents.find(a => a.id === "agent:" + cp.cap.agent) : agents.find(a => a.leeg);
      if (bij) lijn(bij, cp, cp.cap.agent ? cl.kleur : "#5A6982", cp.cap.agent ? .5 : .25, false);
      lijn(cp, dept, cl.kleur, .45, true);
      /* stipje dat naar de afdeling zakt */
      if (!this.reduced && cp.cap.agent){
        const p = this._naarScherm(cp.x, cp.y), q = this._naarScherm(dept.x, dept.y);
        const f = (this.t*.35 + cp.x*.01) % 1;
        const x = lerp(p.x, q.x, f), y = lerp(p.y + 15*this.cam.s, q.y - 15*this.cam.s, f);
        c.save(); c.globalCompositeOperation = "lighter";
        c.fillStyle = cl.kleur; c.beginPath(); c.arc(x, y, 2.2*this.cam.s, 0, 7); c.fill();
        c.restore();
      }
    });
  }

  _punt(k, cl){
    const c = this.ctx, s = this._naarScherm(k.x, k.y), S = this.cam.s;
    const aan = this.gekozen === k.id || this.hover === k.id;
    const past = !this.zoek || k.label.toLowerCase().indexOf(this.zoek) >= 0;
    const dof = (this.zoek && !past) || (this.nadruk && !this.nadruk.has(k.id));

    const straal = (k.soort === "dept" ? 21 : k.soort === "cap" ? 11 : 15) * S;
    c.save();
    if (dof) c.globalAlpha *= .25;

    if (!k.leeg){
      c.save(); c.globalCompositeOperation = "lighter";
      const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, straal*3);
      g.addColorStop(0, k.kleur + (aan ? "66" : "33")); g.addColorStop(1, k.kleur + "00");
      c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, straal*3, 0, 7); c.fill();
      c.restore();
    }

    if (aan && !k.leeg){
      c.beginPath(); c.arc(s.x, s.y, straal + 6*S, 0, 7);
      c.strokeStyle = k.kleur + "44"; c.lineWidth = 1.4*S; c.stroke();
    }
    c.beginPath(); c.arc(s.x, s.y, straal, 0, 7);
    c.fillStyle = "#0B1322"; c.fill();
    if (k.leeg){ c.setLineDash([3*S, 3*S]); }
    c.strokeStyle = k.kleur; c.lineWidth = (aan ? 2.4 : 1.6)*S; c.stroke();
    c.setLineDash([]);

    /* teken in de knoop: gereedschap een stekker, agent een figuur,
     * capaciteit een blokje, afdeling een groepje */
    c.fillStyle = k.kleur;
    if (k.soort === "tool"){
      c.beginPath(); c.arc(s.x, s.y - 2*S, 4*S, 0, 7); c.fill();
      c.fillRect(s.x - 1*S, s.y + 1*S, 2*S, 5*S);
    } else if (k.soort === "agent"){
      c.beginPath(); c.arc(s.x, s.y - 3.5*S, 3.6*S, 0, 7); c.fill();
      c.beginPath(); c.arc(s.x, s.y + 7*S, 7*S, Math.PI, 0); c.fill();
    } else if (k.soort === "cap"){
      c.fillRect(s.x - 4*S, s.y - 4*S, 8*S, 8*S);
    } else {
      c.beginPath(); c.arc(s.x - 4.5*S, s.y - 4*S, 3.4*S, 0, 7); c.fill();
      c.beginPath(); c.arc(s.x + 4.5*S, s.y - 4*S, 3.4*S, 0, 7); c.fill();
      c.beginPath(); c.arc(s.x, s.y + 8*S, 9*S, Math.PI, 0); c.fill();
    }

    /* naam eronder */
    const groot = k.soort === "dept";
    c.font = (groot ? "600 " : "") + ((groot ? 12 : 10.5)*S).toFixed(1) +
      'px "IBM Plex Mono",ui-monospace,monospace';
    c.fillStyle = aan ? "#E8EDF7" : (k.leeg ? "#5A6982" : "#9BA9C4");
    const woorden = this._breek(k.label, groot ? 22 : 16);
    woorden.forEach((r, i) => c.fillText(r, s.x, s.y + straal + (11 + i*12)*S));

    /* een agent draagt zijn werkvoorraad mee */
    if (k.soort === "agent" && k.agent && k.agent.werk){
      const bx = s.x + straal*.72, by = s.y - straal*.72;
      c.beginPath(); c.arc(bx, by, 6.5*S, 0, 7);
      c.fillStyle = "#F0B454"; c.fill();
      c.fillStyle = "#0B1322";
      c.font = "700 " + (8.5*S).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillText(String(k.agent.werk), bx, by + .5*S);
    }
    c.restore();
  }

  _breek(tekst, max){
    const w = String(tekst).split(" "), uit = []; let r = "";
    for (const x of w){
      if ((r + " " + x).trim().length > max){ if (r) uit.push(r); r = x; }
      else r = (r ? r + " " : "") + x;
    }
    if (r) uit.push(r);
    return uit.slice(0, 2);
  }

  /* de buren vaag aan weerszijden, zodat je ziet dat er meer is */
  _buren(){
    const c = this.ctx, W = this.cv.clientWidth;
    const n = this.clusters.length;
    [-1, 1].forEach(d => {
      const cl = this.clusters[(this.ix + d + n) % n];
      if (!cl) return;
      const cx = this.cam.x + d*Math.min(W*0.42, 520*this.cam.s), cy = this.cam.y + 40*this.cam.s;
      const R = 70*this.cam.s;
      c.save(); c.globalAlpha = .3;
      c.strokeStyle = cl.kleur; c.lineWidth = 1;
      const punten = cl.agents.length + cl.caps.length;
      for (let i = 0; i < punten; i++){
        const a = (i/Math.max(1,punten))*Math.PI*2 + this.t*.05;
        const x = cx + Math.cos(a)*R, y = cy + Math.sin(a)*R*.7;
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();
        c.fillStyle = cl.kleur;
        c.beginPath(); c.arc(x, y, 2.6*this.cam.s, 0, 7); c.fill();
      }
      c.fillStyle = cl.kleur;
      c.beginPath(); c.arc(cx, cy, 7*this.cam.s, 0, 7); c.fill();
      c.font = "600 " + (11*this.cam.s).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillText(cl.label.toUpperCase(), cx, cy + R + 18*this.cam.s);
      c.restore();
    });
  }
}

export default Sterrenkaart;
