/* iso-office.js — isometrische kantoorvloer.
 *
 * De motor kent de hub niet. Hij tekent een vloer, laat poppetjes lopen en
 * meldt wat de gebruiker doet. Wat een agent *is* en wat zijn status betekent,
 * bepaalt iso-bridge.js.
 *
 *   const vloer = new IsoOffice(canvas, {
 *     onSelect: (id, agent) => toonPaneel(id),
 *     onEvent:  (tekst, id, soort) => feedRegel(tekst, id, soort)
 *   });
 *   vloer.setAgents([{ id:"market-researcher", name:"Marktpost", desk:0, status:"opgepakt" }]);
 *
 * Twee standen:
 *   echt        — beweging volgt uit een statuswissel die de hub doorgeeft.
 *   rondloop    — verzonnen behoeften die vanzelf zakken. Standaard uit.
 *                 Alles wat hieruit komt krijgt soort "demo".
 */
import { THEME, STATUS_COLOR } from "./iso-theme.js";
import { TILE, GRID, DESKS, ZONES, SPOTS, LAMPEN, KABELS, stoelVan, parkeerVan, bureausVan, buildMap, vrij, zoneOp, zoneVan } from "./iso-map.js";

/* Behoeften. Alleen actief in rondloopmodus. */
export const NEEDS = {
  energie: { verval:1.5,  herstel:"coffee", bij:9, icoon:"☕",       laag:"is toe aan koffie" },
  focus:   { verval:1.1,  herstel:"desk",   bij:5, icoon:"\u{1F3AF}", laag:"zoekt de rust op" },
  sociaal: { verval:0.75, herstel:"lounge", bij:7, icoon:"\u{1F4AC}", laag:"wil even bijpraten" }
};

const clamp = (n,a,b) => Math.max(a, Math.min(b, n));
const lerp  = (a,b,t) => a + (b-a)*t;
const rnd   = a => a[Math.floor(Math.random()*a.length)];

function shade(hex, amt){
  const n = parseInt(String(hex).slice(1), 16);
  const f = v => clamp(v + amt, 0, 255) | 0;
  return "rgb(" + f((n>>16)&255) + "," + f((n>>8)&255) + "," + f(n&255) + ")";
}
function initialen(n){
  return String(n || "?").split(/[\s-]+/).map(w => w[0]).join("").slice(0,2).toUpperCase();
}

if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    r = Math.min(r, w/2, h/2);
    this.beginPath(); this.moveTo(x+r,y);
    this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r);     this.arcTo(x,y,x+w,y,r);
    this.closePath(); return this;
  };
}

export class IsoOffice {
  constructor(canvas, opts = {}){
    this.cv    = canvas;
    this.ctx   = canvas.getContext("2d");
    this.theme = Object.assign({}, THEME, opts.theme || {});
    this.onSelect = opts.onSelect || function(){};
    this.onEvent  = opts.onEvent  || function(){};
    this.demo = !!opts.demo;

    const map = buildMap();
    this.tiles = map.tiles; this.solid = map.solid; this.props = map.props;

    this.agents = [];
    this.zoneInfo = {};
    this.floaters = [];
    this.selectedId = null; this.hoverAgent = null; this.hover = null;
    this.sleepAgent = null; this.mikpunt = null;
    this.zichtbaar = true; this.zelfGezoomd = false;
    this.t = 0; this._prev = 0;
    this.reduced = typeof matchMedia !== "undefined"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Halve-resolutie buffer voor de gloed. Alles wat licht geeft wordt hier
     * ook op getekend; aan het eind gaat hij vervaagd en optellend over het
     * beeld heen. Dat is wat een vloer van matte dozen in neon verandert. */
    this.glCv = document.createElement("canvas");
    this.glCtx = this.glCv.getContext("2d");
    this.glSchaal = .5;

    this.cam = { x:0, y:0, zoom:1, tx:0, ty:0 };
    this._bind();
    this._resize();
    this.fit();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  /* ===================== publieke API ===================== */

  /* list: [{ id, name, role, desk, color, status }] */
  setAgents(list){
    const oud = new Map(this.agents.map(a => [a.id, a]));
    this.agents = list.map((a, i) => {
      const p  = oud.get(a.id);
      const ix = (a.desk == null ? i : a.desk) % DESKS.length;
      const d  = DESKS[ix];
      const basis = {
        path: [], face: 1, bob: Math.random()*6, pose: "zitten",
        doelZone: "desk", gedachte: null, wacht: 0, status: "idle",
        needs: { energie: 62+Math.random()*30, focus: 58+Math.random()*35, sociaal: 55+Math.random()*40 }
      };
      const s = Object.assign(basis, p || {}, a);
      s.deskIx = ix;
      s.color  = a.color || this.theme.busy;
      if (!p){
        const stoel = stoelVan(d);
        s.x = stoel.x; s.y = stoel.y; s.path = [];
        s.pose = "zitten"; s.doelZone = "desk";
      }
      return s;
    });
    return this;
  }

  update(id, patch){
    const a = this._a(id);
    if (!a) return this;
    const oudeStatus = a.status;
    Object.assign(a, patch);
    if (patch && patch.status && patch.status !== oudeStatus) this._opStatus(a, patch.status);
    return this;
  }

  /* Alleen de status zetten; beweging volgt daaruit. */
  setStatus(id, status){ return this.update(id, { status }); }

  send(id, waarheen){
    const a = this._a(id);
    if (!a) return this;
    a.wacht = 12 + Math.random()*6;
    this._stuur(a, waarheen);
    return this;
  }

  select(id){
    this.selectedId = id;
    return this;
  }

  focus(id){
    const a = this._a(id);
    if (a){ const p = this._iso(a.x, a.y); this.cam.tx = -p.x; this.cam.ty = -p.y; }
    return this;
  }

  setDemo(aan){
    this.demo = !!aan;
    if (!this.demo) for (const a of this.agents){ a.gedachte = null; this._opStatus(a, a.status); }
    return this;
  }

  /* Aantal rapporten in het archief. Vult de kasten. */
  setArchive(n){
    let over = Math.max(0, n | 0);
    for (const p of this.props){
      if (p.kind !== "kast") continue;
      p.vol = Math.min(5, over); over -= p.vol;
    }
    return this;
  }

  /* Een tekstje dat kort boven de vloer opstijgt. Alleen voor echte
   * gebeurtenissen: iets in een bestand is veranderd. */
  floater(tekst, waar, kleur){
    let x, y;
    if (typeof waar === "string"){
      const a = this._a(waar); if (!a) return this;
      x = a.x; y = a.y;
    } else if (waar && waar.x != null){ x = waar.x; y = waar.y; }
    else return this;
    this.floaters.push({ tekst, x, y, t: 0, kleur: kleur || this.theme.ok });
    if (this.floaters.length > 12) this.floaters.shift();
    return this;
  }

  /* Tekst achter de kamernaam, bijvoorbeeld "3 agents". */
  setZoneInfo(info){ this.zoneInfo = info || {}; return this; }

  /* Het opdrachtenbord in een afdelingskamer: hoeveel capaciteiten er staan
   * en hoeveel daarvan bemand zijn. */
  setBorden(perAfdeling){
    for (const p of this.props){
      if (p.kind !== "bord") continue;
      const b = (perAfdeling || {})[p.dept] || { live:0, totaal:0 };
      p.live = b.live; p.totaal = b.totaal;
    }
    return this;
  }

  /* Camera naar een kamer toe. */
  focusZone(naam){
    const z = zoneVan(naam); if (!z) return this;
    const mid = this._iso((z.x0 + z.x1)/2, (z.y0 + z.y1)/2);
    this.cam.tx = -mid.x; this.cam.ty = -mid.y + 40;
    this.cam.zoom = clamp(Math.max(this.cam.zoom, .8), .3, 1.8);
    this.zelfGezoomd = true;
    return this;
  }

  /* Camera zo zetten dat de hele vloer past. */
  fit(){
    const W = this.cv.clientWidth || 800, H = this.cv.clientHeight || 480;
    /* de vloer in wereldmaat, inclusief de wanden erboven en het naamplaatje eronder */
    const boven  = -(TILE.h/2 + 70);
    const onder  = (GRID.w - 1 + GRID.h - 1)*TILE.h/2 + TILE.h + 34;
    const links  = -(GRID.h - 1)*TILE.w/2 - TILE.w/2;
    const rechts =  (GRID.w - 1)*TILE.w/2 + TILE.w/2;
    const marge = 28;
    /* Op een staand scherm past de hele vloer alleen als je hem onleesbaar
     * klein maakt. Dan liever een leesbare zoom en de gebruiker laten schuiven. */
    const pasBreed = W/(rechts - links + marge*2), pasHoog = H/(onder - boven + marge*2);
    this.cam.zoom = H > W*1.15
      ? clamp(Math.min(pasHoog, .72), .5, 1.8)
      : clamp(Math.min(pasBreed, pasHoog), .5, 1.8);
    this.cam.x = this.cam.tx = -(links + rechts)/2;
    this.cam.y = this.cam.ty = 55 - (boven + onder)/2;   /* 55 = de vaste opschuiving in _naarScherm */
    return this;
  }

  destroy(){ cancelAnimationFrame(this._raf); this._unbind(); }

  _a(id){ return this.agents.find(x => x.id === id) || null; }

  /* ===================== gedrag ===================== */

  /* Een statuswissel uit de hub is een echte gebeurtenis: daar mag de vloer
   * op bewegen. Zonder wissel blijft iedereen staan waar hij staat. */
  _opStatus(a, status){
    switch (status){
      case "opgepakt": this._stuur(a, "desk");    a.gedachte = null;        break;
      case "nieuw":    this._stuur(a, "desk");    a.gedachte = "\u{1F4CB}"; break;
      case "geleverd": this._stuur(a, "lounge");  a.gedachte = "✅";
                       a.terugNaarBureau = 22 + Math.random()*8;            break;
      case "idle":     this._stuur(a, "park");    a.gedachte = null;        break;
      case "geparkeerd":
      case "offphase": a.gedachte = null;                                   break;
    }
  }

  _stuur(a, waarheen){
    const bureau = DESKS[a.deskIx];
    let doel;
    if (typeof waarheen === "object" && waarheen) doel = waarheen;
    else if (waarheen === "desk") doel = stoelVan(bureau);
    else if (waarheen === "park") doel = parkeerVan(bureau);
    else doel = this._vrijeSpot(waarheen, a);
    if (!doel) return;

    a.doelZone  = typeof waarheen === "string" ? waarheen : "vrij";
    a.zitStraks = !!doel.zit;
    a.pose      = "staan";
    a.path      = this._pad({ x: Math.round(a.x), y: Math.round(a.y) }, { x: doel.x, y: doel.y }) || [];
    if (!a.path.length) a.pose = a.zitStraks ? "zitten" : "staan";
  }

  _vrijeSpot(naam, zelf){
    let lijst = SPOTS[naam];
    if (!lijst){
      /* een afdelingskamer heeft geen vaste plekken: pak een vrije tegel */
      const z = zoneVan(naam);
      if (!z) return null;
      lijst = [];
      for (let y = z.y0; y <= z.y1; y++)
        for (let x = z.x0; x <= z.x1; x++)
          if (vrij(this.solid, x, y)) lijst.push({ x, y });
      if (!lijst.length) return null;
    }
    const bezet = this.agents.filter(a => a !== zelf).map(a => {
      const e = a.path.length ? a.path[a.path.length-1] : { x: Math.round(a.x), y: Math.round(a.y) };
      return e.x + "," + e.y;
    });
    return lijst.find(s => bezet.indexOf(s.x + "," + s.y) === -1) || rnd(lijst);
  }

  /* Breedte-eerst zoeken. Loopt om alles heen wat solid is; het doel zelf mag
   * bezet zijn, anders kun je niet op een bank of achter een bureau gaan zitten. */
  _pad(van, naar){
    if (van.x === naar.x && van.y === naar.y) return [];
    const sleutel = p => p.y*GRID.w + p.x;
    const rij = [van], vorige = new Map([[sleutel(van), null]]);
    const buren = [[1,0],[-1,0],[0,1],[0,-1]];
    let veilig = 0;
    while (rij.length && veilig++ < 5000){
      const c = rij.shift();
      if (c.x === naar.x && c.y === naar.y){
        const route = []; let p = c;
        while (p){ route.unshift(p); p = vorige.get(sleutel(p)); }
        route.shift(); return route;
      }
      for (let i = 0; i < 4; i++){
        const n = { x: c.x + buren[i][0], y: c.y + buren[i][1] };
        if (n.x < 0 || n.y < 0 || n.x >= GRID.w || n.y >= GRID.h) continue;
        const isDoel = n.x === naar.x && n.y === naar.y;
        if (!vrij(this.solid, n.x, n.y) && !isDoel) continue;
        if (vorige.has(sleutel(n))) continue;
        vorige.set(sleutel(n), c); rij.push(n);
      }
    }
    return null;
  }

  _stap(dt){
    this.cam.x = lerp(this.cam.x, this.cam.tx, 1 - Math.pow(.001, dt));
    this.cam.y = lerp(this.cam.y, this.cam.ty, 1 - Math.pow(.001, dt));

    this.werkendeBureaus = {};
    this._floatersStap(dt);
    for (const a of this.agents){
      if (a.path && a.path.length){
        const n = a.path[0];
        const dx = n.x - a.x, dy = n.y - a.y, d = Math.hypot(dx, dy), v = 2.0*dt;
        if (d <= v){
          a.x = n.x; a.y = n.y; a.path.shift();
          if (!a.path.length) a.pose = a.zitStraks ? "zitten" : "staan";
        } else {
          a.x += dx/d*v; a.y += dy/d*v;
          a.face = (dx - dy) > 0 ? 1 : -1;
        }
        a.bob += dt*11; a.loopt = true;
      } else {
        a.loopt = false; a.bob += dt*1.4;
      }

      if (!a.loopt && a.doelZone === "desk" && a.status === "opgepakt")
        this.werkendeBureaus[a.deskIx] = true;

      if (this.demo) this._behoeften(a, dt);
      else if (a.terugNaarBureau != null){
        a.terugNaarBureau -= dt;
        if (a.terugNaarBureau <= 0 && !a.loopt){
          a.terugNaarBureau = null; a.gedachte = null;
          this._stuur(a, a.status === "opgepakt" || a.status === "nieuw" ? "desk" : "park");
        }
      }
    }
  }

  _floatersStap(dt){
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter(f => f.t < 2.6);
  }

  /* Rondloopmodus. Verzonnen, en zo gelabeld. */
  _behoeften(a, dt){
    const n = a.needs, zone = a.doelZone;
    for (const k in NEEDS){
      const cfg = NEEDS[k];
      const laadtOp = !a.loopt && cfg.herstel === zone;
      n[k] = clamp(n[k] + (laadtOp ? cfg.bij : -cfg.verval)*dt, 0, 100);
    }
    if (!a.loopt && zone === "desk") n.energie = clamp(n.energie - 1.9*dt, 0, 100);

    a.wacht -= dt;
    if (a.loopt || a.wacht > 0) return;

    let laagste = null;
    for (const k in NEEDS)
      if (n[k] < 32 && (laagste === null || n[k] < n[laagste])) laagste = k;

    if (laagste && zone !== NEEDS[laagste].herstel){
      a.gedachte = NEEDS[laagste].icoon;
      a.wacht = 9 + Math.random()*9;
      this._stuur(a, NEEDS[laagste].herstel);
      this.onEvent(a.name + " " + NEEDS[laagste].laag + ".", a.id, "demo");
      return;
    }
    if (!laagste && zone !== "desk" && n.energie > 55){
      a.gedachte = null; a.wacht = 6 + Math.random()*6;
      this._stuur(a, "desk");
      this.onEvent(a.name + " gaat weer aan het werk.", a.id, "demo");
      return;
    }
    a.gedachte = laagste ? NEEDS[laagste].icoon : null;
    a.wacht = 3 + Math.random()*3;
  }

  /* ===================== projectie ===================== */

  _iso(x, y){ return { x: (x - y)*TILE.w/2, y: (x + y)*TILE.h/2 }; }

  _naarScherm(x, y){
    const p = this._iso(x, y), z = this.cam.zoom;
    return {
      x: (p.x + this.cam.x)*z + this.cv.clientWidth/2,
      y: (p.y + this.cam.y)*z + this.cv.clientHeight/2 - 55*z
    };
  }

  _naarTegel(sx, sy){
    const z = this.cam.zoom;
    const x = (sx - this.cv.clientWidth/2)/z - this.cam.x;
    const y = (sy - this.cv.clientHeight/2 + 55*z)/z - this.cam.y;
    return {
      x: Math.floor((y/(TILE.h/2) + x/(TILE.w/2))/2),
      y: Math.floor((y/(TILE.h/2) - x/(TILE.w/2))/2)
    };
  }

  /* ===================== invoer ===================== */

  _bind(){
    const cv = this.cv, self = this;
    let sleep = null, pinch = null, bewogen = 0, laatsteTik = 0, laatsteId = null;

    const pos = e => {
      const r = cv.getBoundingClientRect();
      const t = (e.touches && e.touches.length) ? e.touches[0]
              : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const h = this._h = {};

    h.down = e => {
      if (e.touches && e.touches.length === 2){
        pinch = { d: self._pinchD(e.touches), z: self.cam.zoom }; sleep = null; return;
      }
      const p = pos(e); bewogen = 0;
      const a = self._raakAgent(p);
      if (a){ self.sleepAgent = a; a.gesleept = true; sleep = { mode:"agent", p, laatst:p }; }
      else   { sleep = { mode:"cam", cx:self.cam.x, cy:self.cam.y, p, laatst:p }; }
    };

    h.move = e => {
      const p = pos(e);
      if (pinch && e.touches && e.touches.length === 2){
        self.cam.zoom = clamp(pinch.z * (self._pinchD(e.touches)/pinch.d), .34, 2.2);
        self.zelfGezoomd = true; e.preventDefault(); return;
      }
      if (sleep){
        sleep.laatst = p;
        bewogen = Math.max(bewogen, Math.abs(p.x - sleep.p.x) + Math.abs(p.y - sleep.p.y));
        if (sleep.mode === "cam"){
          self.cam.x = sleep.cx + (p.x - sleep.p.x)/self.cam.zoom;
          self.cam.y = sleep.cy + (p.y - sleep.p.y)/self.cam.zoom;
          self.cam.tx = self.cam.x; self.cam.ty = self.cam.y;
          self.zelfGezoomd = true;
        } else {
          const t = self._naarTegel(p.x, p.y);
          self.mikpunt = vrij(self.solid, t.x, t.y) ? t : null;
        }
        if (e.touches) e.preventDefault();
      } else {
        const a = self._raakAgent(p);
        self.hoverAgent = a ? a.id : null;
        self.hover = a ? null : self._naarTegel(p.x, p.y);
        cv.style.cursor = a ? "grab" : "default";
      }
    };

    h.up = e => {
      if (sleep){
        const p = sleep.laatst, nu = Date.now();
        if (sleep.mode === "agent"){
          const a = self.sleepAgent;
          if (a){
            if (bewogen < 8){
              if (nu - laatsteTik < 340 && laatsteId === a.id){
                self.send(a.id, "desk");
                self.onEvent(a.name + " is teruggestuurd naar het bureau.", a.id, "interactie");
              }
              laatsteTik = nu; laatsteId = a.id;
              self.selectedId = a.id; self.onSelect(a.id, a);
            } else if (self.mikpunt){
              self.send(a.id, { x: self.mikpunt.x, y: self.mikpunt.y });
              const zn = zoneOp(self.mikpunt.x, self.mikpunt.y);
              self.onEvent(a.name + " is verplaatst" + (zn ? " naar de " + zn.label.toLowerCase() : "") + ".",
                           a.id, "interactie");
            }
            a.gesleept = false;
          }
        } else if (bewogen < 8){
          const t  = self._naarTegel(p.x, p.y);
          const zn = zoneOp(t.x, t.y);
          if (zn && nu - laatsteTik < 340 && laatsteId === "zone:" + zn.name && self.selectedId){
            const a = self._a(self.selectedId);
            self.send(self.selectedId, zn.name);
            if (a) self.onEvent(a.name + " is naar de " + zn.label.toLowerCase() + " gestuurd.", a.id, "interactie");
          }
          laatsteTik = nu; laatsteId = zn ? "zone:" + zn.name : null;
        }
      }
      self.sleepAgent = null; self.mikpunt = null; sleep = null; pinch = null;
    };

    h.wheel = e => {
      e.preventDefault();
      self.cam.zoom = clamp(self.cam.zoom * (e.deltaY > 0 ? .9 : 1.11), .34, 2.2);
      self.zelfGezoomd = true;
    };
    h.resize = () => { self._resize(); if (!self.zelfGezoomd) self.fit(); };
    h.leave  = () => { self.hoverAgent = null; self.hover = null; };
    h.zicht  = () => { self.zichtbaar = document.visibilityState !== "hidden"; };

    cv.addEventListener("mousedown", h.down);
    cv.addEventListener("touchstart", h.down, { passive:true });
    window.addEventListener("mousemove", h.move);
    cv.addEventListener("touchmove", h.move, { passive:false });
    window.addEventListener("mouseup", h.up);
    cv.addEventListener("touchend", h.up);
    cv.addEventListener("wheel", h.wheel, { passive:false });
    cv.addEventListener("mouseleave", h.leave);
    window.addEventListener("resize", h.resize);
    document.addEventListener("visibilitychange", h.zicht);
  }

  _unbind(){
    const cv = this.cv, h = this._h;
    cv.removeEventListener("mousedown", h.down);
    cv.removeEventListener("touchstart", h.down);
    window.removeEventListener("mousemove", h.move);
    cv.removeEventListener("touchmove", h.move);
    window.removeEventListener("mouseup", h.up);
    cv.removeEventListener("touchend", h.up);
    cv.removeEventListener("wheel", h.wheel);
    cv.removeEventListener("mouseleave", h.leave);
    window.removeEventListener("resize", h.resize);
    document.removeEventListener("visibilitychange", h.zicht);
  }

  _pinchD(t){ return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

  _raakAgent(p){
    let best = null, bestD = 34 * this.cam.zoom;
    for (const a of this.agents){
      const s = this._naarScherm(a.x, a.y);
      const d = Math.hypot(p.x - s.x, p.y - (s.y - 20*this.cam.zoom));
      if (d < bestD){ bestD = d; best = a; }
    }
    return best;
  }

  _resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 480;
    this.cv.width  = Math.round(w*dpr);
    this.cv.height = Math.round(h*dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.glCv){
      this.glCv.width  = Math.max(1, Math.round(w*this.glSchaal));
      this.glCv.height = Math.max(1, Math.round(h*this.glSchaal));
    }
  }

  /* ===================== lus ===================== */

  _loop(ts){
    const dt = Math.min(.05, (ts - (this._prev || ts))/1000);
    this._prev = ts; this.t += dt;
    if (this.zichtbaar){ this._stap(dt); this._teken(); }
    this._raf = requestAnimationFrame(this._loop);
  }

  /* ===================== tekenen ===================== */

  _teken(){
    const c = this.ctx, T = this.theme, z = this.cam.zoom;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;

    c.clearRect(0,0,W,H);
    c.fillStyle = T.bg; c.fillRect(0,0,W,H);
    c.textAlign = "center"; c.textBaseline = "middle";
    this.glCtx.clearRect(0, 0, this.glCv.width, this.glCv.height);

    for (const t of this.tiles) this._tegel(t);
    for (const zn of ZONES) this._vloernaam(zn);
    for (const zn of ZONES) this._kamerrand(zn);
    this._kabels();

    if (this.mikpunt) this._tegelRand(this.mikpunt.x, this.mikpunt.y, T.gold);
    else if (this.hover && vrij(this.solid, this.hover.x, this.hover.y))
      this._tegelRand(this.hover.x, this.hover.y, "rgba(120,170,255,.4)");

    /* lichtplekken boven de bureaus */
    c.save(); c.globalCompositeOperation = "lighter";
    LAMPEN.forEach((l, i) => {
      const s = this._naarScherm(l.x, l.y), r = l.r*z;
      const werkt = this.werkendeBureaus && this.werkendeBureaus[i];
      const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, "rgba(120,160,255," + (werkt ? .2 : .075) + ")");
      g.addColorStop(1, "rgba(120,160,255,0)");
      c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, r, 0, 7); c.fill();
      this._lichtBol(s.x, s.y - 30*z, (werkt ? 15 : 8)*z, werkt ? "#8FB6FF" : "#4E6DA8", werkt ? .5 : .22);
    });
    c.restore();

    /* alles op diepte sorteren: meubels en mensen door elkaar */
    const lijst = [];
    for (const p of this.props) lijst.push({ d: p.x + p.y + p.h/500, f: () => this._prop(p) });
    for (const a of this.agents) lijst.push({ d: a.x + a.y + .4,     f: () => this._agent(a) });
    lijst.sort((a,b) => a.d - b.d);
    for (const it of lijst) it.f();

    this._stof();
    this._gloedOver();

    /* labels en plaatjes staan bóven de gloed: die moeten scherp blijven */
    for (const a of this.agents) this._agentLabel(a);
    for (const zn of ZONES) this._ruimtelabel(zn);
    for (const f of this.floaters) this._floater(f);

    const v = c.createRadialGradient(W/2, H/2, Math.min(W,H)*.42, W/2, H/2, Math.max(W,H)*.82);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.5)");
    c.fillStyle = v; c.fillRect(0,0,W,H);
  }

  /* De gloedbuffer vervaagd en optellend over het beeld. Twee keer: één brede
   * waas en één strakke, dat leest als echt licht in plaats van als mist. */
  _gloedOver(){
    const c = this.ctx, W = this.cv.clientWidth, H = this.cv.clientHeight;
    c.save();
    c.globalCompositeOperation = "lighter";
    const kanFilter = typeof c.filter === "string";
    if (kanFilter) c.filter = "blur(9px)";
    c.globalAlpha = .55; c.drawImage(this.glCv, 0, 0, W, H);
    if (kanFilter) c.filter = "blur(2px)";
    c.globalAlpha = .85; c.drawImage(this.glCv, 0, 0, W, H);
    if (kanFilter) c.filter = "none";
    c.restore();
  }

  /* De afdelingsnaam op de vloer geschilderd, in het vlak van de vloer zelf.
   * Vult de lege gangen en zegt meteen waar je bent. */
  _vloernaam(zn){
    const c = this.ctx, z = this.cam.zoom;
    if (z < .4) return;
    const o = this._naarScherm(zn.x0 + .3, zn.y0 + .3);
    const tekst = zn.label.toUpperCase();
    const breed = zn.x1 - zn.x0 + 1 - .6;      /* ruimte in tegels */
    c.save();
    c.translate(o.x, o.y + TILE.h/2*z);
    /* basisvectoren van het vloervlak: +x gaat rechtsonder, +y linksonder */
    c.transform(TILE.w/2*z, TILE.h/2*z, -TILE.w/2*z, TILE.h/2*z, 0, 0);
    c.textAlign = "left"; c.textBaseline = "top";
    c.font = '700 100px "IBM Plex Sans",system-ui,sans-serif';
    const w100 = c.measureText(tekst).width;    /* breedte bij 100px */
    const k = breed / w100;                     /* zo veel tegels per pixel */
    c.scale(k, k);
    c.fillStyle = zn.kleur + "1F";
    c.fillText(tekst, 0, 0);
    c.restore();
    c.textAlign = "center"; c.textBaseline = "middle";
  }

  /* Neonrand om elke kamer: de vloerrand in de kleur van de afdeling. */
  _kamerrand(zn){
    const c = this.ctx, z = this.cam.zoom;
    const h = { x: zn.x0, y: zn.y0 }, r = { x: zn.x1 + 1, y: zn.y0 };
    const o = { x: zn.x1 + 1, y: zn.y1 + 1 }, l = { x: zn.x0, y: zn.y1 + 1 };
    const p = [h, r, o, l].map(t => {
      const s = this._naarScherm(t.x, t.y);
      return { x: s.x, y: s.y + TILE.h/2*z };
    });
    c.save();
    c.beginPath();
    c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(p[i].x, p[i].y);
    c.closePath();
    c.strokeStyle = zn.kleur; c.globalAlpha = .5; c.lineWidth = 1.6*z; c.stroke();
    c.restore();
    this._lichtPad(p, zn.kleur, 2.4*z, .42);
  }

  /* Kabelgoten met lopende stipjes: het werk stroomt naar het archief. */
  _kabels(){
    const c = this.ctx, z = this.cam.zoom;
    for (const k of KABELS){
      const bemand = this.agents.some(a => a.dept === k.dept);
      const pts = k.punten.map(t => {
        const s = this._naarScherm(t.x, t.y);
        return { x: s.x, y: s.y + TILE.h/2*z };
      });
      c.save();
      c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.strokeStyle = bemand ? "rgba(110,150,220,.4)" : "rgba(90,110,150,.16)";
      c.lineWidth = 1.4*z; c.lineJoin = c.lineCap = "round"; c.stroke();
      c.restore();
      if (!bemand) continue;

      /* lengte per stuk, zodat de stipjes gelijkmatig lopen */
      const lengtes = [], totaal = pts.reduce((som, p, i) => {
        if (!i) return 0;
        const d = Math.hypot(p.x - pts[i-1].x, p.y - pts[i-1].y);
        lengtes.push(d); return som + d;
      }, 0);
      const kleur = (ZONES.find(z2 => z2.name === k.dept) || {}).kleur || this.theme.busy;
      const aantal = 3;
      for (let n = 0; n < aantal; n++){
        let s = ((this.t*0.16 + n/aantal) % 1) * totaal, i = 0;
        while (i < lengtes.length && s > lengtes[i]){ s -= lengtes[i]; i++; }
        if (i >= lengtes.length) continue;
        const a = pts[i], b = pts[i+1], f = lengtes[i] ? s/lengtes[i] : 0;
        const x = a.x + (b.x - a.x)*f, y = a.y + (b.y - a.y)*f;
        c.fillStyle = kleur;
        c.beginPath(); c.arc(x, y, 2.1*z, 0, 7); c.fill();
        this._lichtBol(x, y, 4.5*z, kleur, .75);
      }
    }
  }

  /* Stofjes in het licht. Houdt het beeld levend als niemand loopt. */
  _stof(){
    if (this.reduced) return;
    const c = this.ctx, z = this.cam.zoom;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!this._stofjes){
      this._stofjes = [];
      for (let i = 0; i < 26; i++)
        this._stofjes.push({ x: Math.random(), y: Math.random(), s: .2 + Math.random()*.5, f: Math.random()*6.3 });
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const d of this._stofjes){
      const x = ((d.x + this.t*0.006*d.s) % 1) * W;
      const y = ((d.y - this.t*0.004*d.s + 1) % 1) * H;
      const a = .05 + Math.abs(Math.sin(this.t*.5 + d.f))*.1;
      c.fillStyle = "rgba(150,185,255," + a.toFixed(3) + ")";
      c.beginPath(); c.arc(x, y, (.8 + d.s)*Math.max(.7, z), 0, 7); c.fill();
    }
    c.restore();
  }

  _tegel(t){
    const c = this.ctx, z = this.cam.zoom, s = this._naarScherm(t.x, t.y);
    const hw = TILE.w/2*z, hh = TILE.h/2*z;
    if (s.x < -hw*2 || s.x > this.cv.clientWidth + hw*2 ||
        s.y < -hh*10 || s.y > this.cv.clientHeight + hh*10) return;
    c.beginPath();
    c.moveTo(s.x, s.y); c.lineTo(s.x+hw, s.y+hh);
    c.lineTo(s.x, s.y+hh*2); c.lineTo(s.x-hw, s.y+hh);
    c.closePath();
    c.fillStyle = t.color; c.fill();
    c.strokeStyle = this.theme.grid; c.lineWidth = 1; c.stroke();
  }

  _tegelRand(x, y, kleur){
    const c = this.ctx, z = this.cam.zoom, s = this._naarScherm(x,y);
    const hw = TILE.w/2*z, hh = TILE.h/2*z;
    c.beginPath();
    c.moveTo(s.x, s.y); c.lineTo(s.x+hw, s.y+hh);
    c.lineTo(s.x, s.y+hh*2); c.lineTo(s.x-hw, s.y+hh);
    c.closePath();
    c.strokeStyle = kleur; c.lineWidth = 2; c.stroke();
  }

  _ruimtelabel(zn){
    const c = this.ctx, zoom = this.cam.zoom;
    if (zoom < .42) return;
    const z = Math.min(zoom, 1);   /* een plaatje blijft leesbaar, het groeit niet mee */
    const s = this._naarScherm((zn.x0 + zn.x1)/2, (zn.y0 + zn.y1)/2);
    const info = this.zoneInfo[zn.name] || "";
    const naam = zn.label.toUpperCase();
    const nr = zn.nr || "";

    c.font = '600 ' + (10.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    const wNaam = c.measureText(naam).width;
    c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
    const wInfo = info ? c.measureText(info).width : 0;
    const wNr = nr ? 16*z : 0;
    const pad = 9*z, gat = 8*z;
    const w = pad + wNr + (nr ? gat : 0) + wNaam + (info ? gat + wInfo : 0) + pad;
    const h = 22*z, x0 = s.x - w/2, y0 = s.y - h/2;

    c.save();
    c.fillStyle = "rgba(9,15,28,.9)";
    c.beginPath(); c.roundRect(x0, y0, w, h, 3*z); c.fill();
    c.strokeStyle = zn.kleur + "66"; c.lineWidth = 1; c.stroke();
    /* accentbalkje links, zoals een kaartje aan een deur */
    c.fillStyle = zn.kleur;
    c.fillRect(x0, y0, 2.5*z, h);
    c.restore();
    this._lichtRect(x0, y0, 2.5*z, h, zn.kleur, .7);

    let x = x0 + pad;
    c.textAlign = "left";
    if (nr){
      c.font = '600 ' + (9*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillStyle = zn.kleur; c.fillText(nr, x, s.y);
      x += wNr + gat;
    }
    c.font = '600 ' + (10.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillStyle = this.theme.text; c.fillText(naam, x, s.y);
    if (info){
      x += wNaam + gat;
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillStyle = this.theme.dim; c.fillText(info, x, s.y);
    }
    c.textAlign = "center";
  }

  /* Een opstijgend tekstje bij een echte gebeurtenis. */
  _floater(f){
    const c = this.ctx, z = Math.min(this.cam.zoom, 1.2);
    const s = this._naarScherm(f.x, f.y);
    const op = f.t < .25 ? f.t/.25 : clamp(1 - (f.t - .25)/2.1, 0, 1);
    const y = s.y - 34*z - f.t*22*z;
    c.save();
    c.globalAlpha = op;
    c.font = "700 " + (11.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
    c.lineWidth = 3.5*z; c.strokeStyle = "rgba(9,15,28,.9)";
    c.strokeText(f.tekst, s.x, y);
    c.fillStyle = f.kleur; c.fillText(f.tekst, s.x, y);
    c.restore();
    this._lichtBol(s.x, y, 16*z, f.kleur, op*.5);
  }

  /* ---- licht ----
   * Deze drie tekenen alleen op de gloedbuffer. Scherm- en bufferpixels
   * verschillen een factor glSchaal, vandaar het schalen hier. */
  _lichtRect(x, y, w, h, kleur, sterkte){
    const g = this.glCtx, k = this.glSchaal;
    g.globalAlpha = sterkte == null ? 1 : sterkte;
    g.fillStyle = kleur;
    g.fillRect(x*k, y*k, Math.max(1, w*k), Math.max(1, h*k));
    g.globalAlpha = 1;
  }
  _lichtBol(x, y, r, kleur, sterkte){
    const g = this.glCtx, k = this.glSchaal;
    g.globalAlpha = sterkte == null ? 1 : sterkte;
    g.fillStyle = kleur;
    g.beginPath(); g.arc(x*k, y*k, Math.max(.6, r*k), 0, 7); g.fill();
    g.globalAlpha = 1;
  }
  _lichtPad(punten, kleur, dikte, sterkte){
    const g = this.glCtx, k = this.glSchaal;
    if (punten.length < 2) return;
    g.globalAlpha = sterkte == null ? 1 : sterkte;
    g.strokeStyle = kleur; g.lineWidth = Math.max(.7, (dikte || 2)*k);
    g.lineJoin = g.lineCap = "round";
    g.beginPath(); g.moveTo(punten[0].x*k, punten[0].y*k);
    for (let i = 1; i < punten.length; i++) g.lineTo(punten[i].x*k, punten[i].y*k);
    g.closePath(); g.stroke();
    g.globalAlpha = 1;
  }

  /* een iso-doos: linkerwand, rechterwand, bovenvlak */
  _doos(gx, gy, w, d, h, kleur){
    const c = this.ctx, H = h*this.cam.zoom;
    const p1 = this._naarScherm(gx, gy),       p2 = this._naarScherm(gx+w, gy);
    const p3 = this._naarScherm(gx+w, gy+d),   p4 = this._naarScherm(gx, gy+d);
    c.beginPath(); c.moveTo(p2.x,p2.y-H); c.lineTo(p3.x,p3.y-H); c.lineTo(p3.x,p3.y); c.lineTo(p2.x,p2.y);
    c.closePath(); c.fillStyle = shade(kleur,-38); c.fill();
    c.beginPath(); c.moveTo(p4.x,p4.y-H); c.lineTo(p3.x,p3.y-H); c.lineTo(p3.x,p3.y); c.lineTo(p4.x,p4.y);
    c.closePath(); c.fillStyle = shade(kleur,-18); c.fill();
    c.beginPath(); c.moveTo(p1.x,p1.y-H); c.lineTo(p2.x,p2.y-H); c.lineTo(p3.x,p3.y-H); c.lineTo(p4.x,p4.y-H);
    c.closePath(); c.fillStyle = kleur; c.fill();
    c.strokeStyle = "rgba(0,0,0,.3)"; c.lineWidth = 1; c.stroke();
  }

  _prop(p){
    const c = this.ctx, z = this.cam.zoom, T = this.theme;
    switch (p.kind){
      case "wall": {
        this._doos(p.x, p.y, p.w, p.d, p.h, T.wall);
        /* een lichtstrook halverwege de wand geeft de ruimte diepte */
        const s = this._naarScherm(p.x + p.w, p.y + p.d);
        const hoog = (p.h - 20)*z;
        c.fillStyle = "rgba(110,150,225,.16)";
        c.fillRect(s.x - (p.d < .5 ? 30 : 4)*z, s.y - hoog, (p.d < .5 ? 30 : 4)*z, 2.2*z);
        this._lichtRect(s.x - (p.d < .5 ? 30 : 4)*z, s.y - hoog, (p.d < .5 ? 30 : 4)*z, 2.2*z, "#4C7EF3", .3);
        break;
      }
      case "glass":
        c.save(); c.globalAlpha = .26;
        this._doos(p.x,p.y,p.w,p.d,p.h,T.glass);
        c.restore(); break;

      case "desk": {
        const werkt = this.werkendeBureaus && this.werkendeBureaus[p.ix];
        this._doos(p.x, p.y, p.w, p.d, p.h, T.bureau);
        /* een bureaublad heeft een rand licht waar de lamp erop valt */
        const rand = this._naarScherm(p.x, p.y);
        this._lichtRect(rand.x - 2*z, rand.y - p.h*z, TILE.w*.9*z, 1.4*z, "#5E82C8", .28);
        /* stoel */
        this._doos(p.x + .75, p.y + .95, .55, .5, 12, "#2B3651");
        this._doos(p.x + .75, p.y + 1.38, .55, .12, 26, "#31405F");
        /* scherm */
        this._doos(p.x + .55, p.y + .2, .6, .1, 32, "#2A3757");
        const s = this._naarScherm(p.x + .6, p.y + .24);
        const sx = s.x - 11*z, sy = s.y - 31*z, sw = 24*z, sh = 14*z;
        c.fillStyle = werkt ? "rgba(96,158,255,.75)" : "rgba(70,105,170,.26)";
        c.fillRect(sx, sy, sw, sh);
        c.fillStyle = werkt ? "rgba(205,232,255,.95)" : "rgba(150,175,215,.35)";
        for (let i = 0; i < 3; i++){
          const stap = werkt && !this.reduced ? Math.floor(this.t*1.6) : 0;
          const w = (6 + ((stap + i*3 + (p.ix||0)*5) % 8)) * z;
          c.fillRect(sx + 3*z, sy + (3 + i*4)*z, w, 1.5*z);
        }
        this._lichtRect(sx, sy, sw, sh, werkt ? "#6EA6FF" : "#3E5C93", werkt ? .8 : .2);
        break;
      }

      case "kastje":     this._doos(p.x,p.y,p.w,p.d,p.h,T.kastje); break;
      case "table":      this._doos(p.x,p.y,p.w,p.d,p.h,T.tafel); break;
      case "salontafel": this._doos(p.x,p.y,p.w,p.d,p.h,T.salontafel); break;
      case "sofa":
        this._doos(p.x, p.y, p.w, p.d, p.h, T.bank);
        this._doos(p.x, p.y - .16, p.w, .18, 32, shade(T.bank,-16));
        break;
      case "board":   this._doos(p.x,p.y,p.w,p.d,p.h,T.bord); break;

      case "bord": {
        /* het opdrachtenbord van een afdeling: één streep per capaciteit,
         * fel als er een agent op zit, dof als hij alleen op papier bestaat */
        this._doos(p.x, p.y, p.w, p.d, p.h, "#26324E");
        const s = this._naarScherm(p.x + p.w, p.y + p.d);
        for (let i = 0; i < (p.totaal || 0) && i < 6; i++){
          const aan = i < (p.live || 0);
          const bx = s.x - 2*z, by = s.y - (p.h - 9 - i*6)*z;
          c.fillStyle = aan ? (p.kleur || T.ok) : "rgba(120,140,180,.3)";
          c.fillRect(bx, by, 13*z, 2.6*z);
          if (aan) this._lichtRect(bx, by, 13*z, 2.6*z, p.kleur || T.ok, .8);
        }
        break;
      }
      case "counter": {
        this._doos(p.x,p.y,p.w,p.d,p.h,T.toonbank);
        const s = this._naarScherm(p.x, p.y + p.d);
        this._lichtRect(s.x, s.y - p.h*z - 1*z, TILE.w*1.1*z, 1.6*z, "#C9A227", .3);
        break;
      }
      case "machine": {
        this._doos(p.x,p.y,p.w,p.d,p.h,T.machine);
        const s = this._naarScherm(p.x + p.w, p.y + p.d/2);
        const aan = Math.sin(this.t*2.4) > -.4;
        c.fillStyle = aan ? "#F0B454" : "rgba(240,180,84,.25)";
        c.beginPath(); c.arc(s.x - 5*z, s.y - (p.h - 8)*z, 2*z, 0, 7); c.fill();
        if (aan) this._lichtBol(s.x - 5*z, s.y - (p.h - 8)*z, 5*z, "#F0B454", .8);
        break;
      }

      case "kast": {
        this._doos(p.x, p.y, p.w, p.d, p.h, T.boekenkast);
        /* elk boekje is één rapport in drafts/ */
        const s = this._naarScherm(p.x + p.w, p.y);
        for (let i = 0; i < (p.vol || 0); i++){
          const bx = s.x - 8*z, by = s.y - (p.h - 8 - i*9)*z;
          c.fillStyle = T.ok; c.fillRect(bx, by, 4*z, 6*z);
          this._lichtRect(bx, by, 4*z, 6*z, T.ok, .85);
        }
        break;
      }

      case "plantje": {
        const s = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
        this._doos(p.x, p.y, p.w, p.d, 14, T.plantpot);
        c.fillStyle = T.blad;
        for (let i = 0; i < 3; i++){
          const wieg = this.reduced ? 0 : Math.sin(this.t*.8 + i)*.12;
          c.save(); c.translate(s.x, s.y - 24*z); c.rotate((i-1)*.45 + wieg);
          c.beginPath(); c.ellipse(0, -8*z, 9*z, 13*z, 0, 0, 7); c.fill();
          c.restore();
        }
        break;
      }
    }
  }

  _agent(a){
    const c = this.ctx, z = this.cam.zoom, T = this.theme;
    const s = this._naarScherm(a.x, a.y);
    const gekozen = a.id === this.selectedId;
    const zit  = a.pose === "zitten" && !a.loopt;
    const flauw = a.status === "offphase" || a.status === "geparkeerd";
    const wip  = a.loopt && !this.reduced ? Math.abs(Math.sin(a.bob))*3*z : 0;
    const adem = !a.loopt && !this.reduced ? Math.sin(a.bob)*1.1*z : 0;
    const baseY = s.y + TILE.h/2*z;
    const bodemY = baseY - wip + adem + (zit ? 5*z : 0);
    const hoogte = (zit ? 23 : 34)*z, breedte = 19*z;

    c.save();
    if (flauw) c.globalAlpha = .45;

    c.fillStyle = "rgba(0,0,0,.5)";
    c.beginPath(); c.ellipse(s.x, baseY, 15*z, 7*z, 0, 0, 7); c.fill();
    if (!flauw){
      /* een agent draagt zijn eigen kleur mee op de vloer */
      const gl = c.createRadialGradient(s.x, baseY, 0, s.x, baseY, 26*z);
      gl.addColorStop(0, a.color + "44"); gl.addColorStop(1, a.color + "00");
      c.save(); c.globalCompositeOperation = "lighter";
      c.fillStyle = gl; c.beginPath(); c.ellipse(s.x, baseY, 26*z, 12*z, 0, 0, 7); c.fill();
      c.restore();
      this._lichtBol(s.x, baseY - hoogte*.35, 9*z, a.color, .22);
    }

    if (gekozen || a.gesleept){
      c.save();
      c.strokeStyle = a.gesleept ? T.wait : T.gold; c.lineWidth = 2.5*z;
      c.setLineDash([6*z, 5*z]); c.lineDashOffset = -this.t*22*z;
      c.beginPath(); c.ellipse(s.x, baseY, 19*z, 9.5*z, 0, 0, 7); c.stroke();
      c.restore();
      this._lichtBol(s.x, baseY, 20*z, a.gesleept ? T.wait : T.gold, .3);
    }
    if (a.gesleept && this.mikpunt){
      const m = this._naarScherm(this.mikpunt.x + .5, this.mikpunt.y + .5);
      c.save(); c.setLineDash([5*z, 5*z]);
      c.strokeStyle = "rgba(245,197,66,.6)"; c.lineWidth = 1.5*z;
      c.beginPath(); c.moveTo(s.x, baseY); c.lineTo(m.x, m.y); c.stroke();
      c.restore();
    }

    /* romp */
    c.beginPath();
    c.moveTo(s.x - breedte/2, bodemY);
    c.quadraticCurveTo(s.x - breedte/2 - 1.5*z, bodemY - hoogte*.65, s.x - breedte*.34, bodemY - hoogte*.82);
    c.lineTo(s.x + breedte*.34, bodemY - hoogte*.82);
    c.quadraticCurveTo(s.x + breedte/2 + 1.5*z, bodemY - hoogte*.65, s.x + breedte/2, bodemY);
    c.closePath();
    const g = c.createLinearGradient(s.x - breedte/2, 0, s.x + breedte/2, 0);
    g.addColorStop(0, shade(a.color,-32)); g.addColorStop(.55, a.color); g.addColorStop(1, shade(a.color,-52));
    c.fillStyle = g; c.fill();
    /* randlicht langs de linkerkant, zodat de figuur van de vloer loskomt */
    c.save(); c.clip();
    c.strokeStyle = shade(a.color, 70); c.globalAlpha = .55; c.lineWidth = 2*z;
    c.beginPath(); c.moveTo(s.x - breedte/2 + 1*z, bodemY);
    c.quadraticCurveTo(s.x - breedte/2 - .5*z, bodemY - hoogte*.65, s.x - breedte*.34, bodemY - hoogte*.82);
    c.stroke(); c.restore();

    /* hoofd met initialen */
    const hoofdY = bodemY - hoogte - 2*z;
    c.beginPath(); c.arc(s.x, hoofdY, 9.2*z, 0, 7);
    c.fillStyle = shade(a.color, 24); c.fill();
    c.strokeStyle = "rgba(0,0,0,.32)"; c.lineWidth = 1*z; c.stroke();
    c.fillStyle = "rgba(255,255,255,.94)";
    c.font = "700 " + (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillText(initialen(a.short || a.name), s.x, hoofdY + .5*z);

    /* statusstip: dezelfde kleuren als de legenda van de hub */
    const stipK = STATUS_COLOR[a.status] || T.idle;
    c.beginPath(); c.arc(s.x + 10*z, hoofdY - 7*z, 4.4*z, 0, 7);
    c.fillStyle = stipK; c.fill();
    if (!flauw) this._lichtBol(s.x + 10*z, hoofdY - 7*z, 5*z, stipK, .5);
    if (a.status === "opgepakt" && !this.reduced){
      const puls = .25 + Math.abs(Math.sin(this.t*2.2))*.35;
      c.beginPath(); c.arc(s.x + 10*z, hoofdY - 7*z, (6 + puls*3)*z, 0, 7);
      c.strokeStyle = "rgba(107,168,245," + puls.toFixed(2) + ")"; c.lineWidth = 1.4*z; c.stroke();
    }

    c.restore();
    a._kop = hoofdY;   /* onthouden voor de labellaag hierboven */
    a._voet = baseY;
  }

  /* Wolkje en naam gaan in een aparte laag, ná alle meubels. Anders schuift
   * het bureau van de buurman eroverheen. */
  _agentLabel(a){
    const c = this.ctx, T = this.theme;
    const zoom = this.cam.zoom, z = Math.min(zoom, 1);
    if (a._kop == null) return;
    const s = this._naarScherm(a.x, a.y);
    const gekozen = a.id === this.selectedId;

    if (a.gedachte && zoom > .55){
      const by = a._kop - 26*zoom;
      c.fillStyle = "rgba(232,237,247,.94)";
      c.beginPath(); c.roundRect(s.x - 11*z, by - 10*z, 22*z, 19*z, 7*z); c.fill();
      c.beginPath(); c.arc(s.x - 6*z, by + 12*z, 2.6*z, 0, 7); c.fill();
      c.fillStyle = "#0B1220";
      c.font = (11*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillText(a.gedachte, s.x, by);
    }

    if ((gekozen || this.hoverAgent === a.id) && zoom > .45){
      const label = a.name;
      c.font = "600 " + (10.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      const w = c.measureText(label).width + 13*z, ly = a._voet + 13*z;
      c.fillStyle = "rgba(9,15,28,.92)";
      c.beginPath(); c.roundRect(s.x - w/2, ly, w, 16*z, 5*z); c.fill();
      c.strokeStyle = gekozen ? T.gold : "rgba(120,160,230,.28)"; c.lineWidth = 1; c.stroke();
      c.fillStyle = T.text; c.fillText(label, s.x, ly + 8.5*z);
    }
  }
}

IsoOffice.NEEDS = NEEDS;
export default IsoOffice;
