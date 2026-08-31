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
import { TILE, GRID, DESKS, ZONES, SPOTS, LAMPEN, stoelVan, parkeerVan, bureausVan, buildMap, vrij, zoneOp, zoneVan } from "./iso-map.js";

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
    let best = null, bestD = 30 * this.cam.zoom;
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

    for (const t of this.tiles) this._tegel(t);

    if (this.mikpunt) this._tegelRand(this.mikpunt.x, this.mikpunt.y, T.gold);
    else if (this.hover && vrij(this.solid, this.hover.x, this.hover.y))
      this._tegelRand(this.hover.x, this.hover.y, "rgba(120,170,255,.4)");

    /* lichtplekken boven de bureaus */
    c.save(); c.globalCompositeOperation = "lighter";
    LAMPEN.forEach((l, i) => {
      const s = this._naarScherm(l.x, l.y), r = l.r*z;
      const fel = this.werkendeBureaus && this.werkendeBureaus[i] ? .19 : .08;
      const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, "rgba(120,160,255," + fel + ")");
      g.addColorStop(1, "rgba(120,160,255,0)");
      c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, r, 0, 7); c.fill();
    });
    c.restore();

    /* alles op diepte sorteren: meubels en mensen door elkaar */
    const lijst = [];
    for (const p of this.props) lijst.push({ d: p.x + p.y + p.h/500, f: () => this._prop(p) });
    for (const a of this.agents) lijst.push({ d: a.x + a.y + .4,     f: () => this._agent(a) });
    lijst.sort((a,b) => a.d - b.d);
    for (const it of lijst) it.f();
    for (const a of this.agents) this._agentLabel(a);

    for (const zn of ZONES) this._ruimtelabel(zn);
    for (const f of this.floaters) this._floater(f);

    const v = c.createRadialGradient(W/2, H/2, Math.min(W,H)*.4, W/2, H/2, Math.max(W,H)*.8);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.45)");
    c.fillStyle = v; c.fillRect(0,0,W,H);
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
    const c = this.ctx, z = this.cam.zoom;
    if (z < .45) return;
    const s = this._naarScherm((zn.x0 + zn.x1)/2, (zn.y0 + zn.y1)/2);
    const info = this.zoneInfo[zn.name] || "";
    const naam = zn.emo + "  " + zn.label;
    c.font = "600 " + (11*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    const wN = c.measureText(naam).width;
    c.font = (10*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
    const wI = info ? c.measureText(info).width + 9*z : 0;
    const w = wN + wI + 20*z, h = 21*z, x0 = s.x - w/2;
    c.fillStyle = "rgba(11,18,32,.84)";
    c.beginPath(); c.roundRect(x0, s.y - h/2, w, h, 99); c.fill();
    c.strokeStyle = zn.kleur ? zn.kleur + "55" : "rgba(120,160,230,.22)"; c.lineWidth = 1; c.stroke();
    c.textAlign = "left";
    c.font = "600 " + (11*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillStyle = zn.kleur || this.theme.soft;
    c.fillText(naam, x0 + 10*z, s.y + .5*z);
    if (info){
      c.font = (10*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillStyle = this.theme.dim;
      c.fillText(info, x0 + 10*z + wN + 9*z, s.y + .5*z);
    }
    c.textAlign = "center";
  }

  _floater(f){
    const c = this.ctx, z = this.cam.zoom;
    const s = this._naarScherm(f.x, f.y);
    const op = f.t < .25 ? f.t/.25 : clamp(1 - (f.t - .25)/2.1, 0, 1);
    const y = s.y - 34*z - f.t*22*z;
    c.save();
    c.globalAlpha = op;
    c.font = "700 " + (11*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
    c.lineWidth = 3*z; c.strokeStyle = "rgba(11,18,32,.85)";
    c.strokeText(f.tekst, s.x, y);
    c.fillStyle = f.kleur; c.fillText(f.tekst, s.x, y);
    c.restore();
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
      case "wall":  this._doos(p.x,p.y,p.w,p.d,p.h,T.wall); break;
      case "glass":
        c.save(); c.globalAlpha = .26;
        this._doos(p.x,p.y,p.w,p.d,p.h,T.glass);
        c.restore(); break;

      case "desk": {
        this._doos(p.x, p.y, p.w, p.d, p.h, T.bureau);
        this._doos(p.x + .55, p.y + .2, .6, .1, 32, "#2A3757");
        const s = this._naarScherm(p.x + .6, p.y + .24);
        const werkt = this.werkendeBureaus && this.werkendeBureaus[p.ix];
        c.fillStyle = werkt ? "rgba(90,150,255,.55)" : "rgba(70,105,170,.24)";
        c.fillRect(s.x - 11*z, s.y - 31*z, 24*z, 14*z);
        c.fillStyle = werkt ? "rgba(190,225,255,.9)" : "rgba(150,175,215,.35)";
        for (let i = 0; i < 3; i++){
          const stap = werkt && !this.reduced ? Math.floor(this.t*1.6) : 0;
          const w = (6 + ((stap + i*3 + (p.ix||0)*5) % 8)) * z;
          c.fillRect(s.x - 8*z, s.y - (28 - i*4)*z, w, 1.5*z);
        }
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
          c.fillStyle = i < (p.live || 0) ? (p.kleur || T.ok) : "rgba(120,140,180,.3)";
          c.fillRect(s.x - 2*z, s.y - (p.h - 9 - i*6)*z, 13*z, 2.6*z);
        }
        break;
      }
      case "counter": this._doos(p.x,p.y,p.w,p.d,p.h,T.toonbank); break;
      case "machine": this._doos(p.x,p.y,p.w,p.d,p.h,T.machine); break;

      case "kast": {
        this._doos(p.x, p.y, p.w, p.d, p.h, T.boekenkast);
        /* elk boekje is één rapport in drafts/ */
        const s = this._naarScherm(p.x + p.w, p.y);
        for (let i = 0; i < (p.vol || 0); i++){
          c.fillStyle = T.ok;
          c.fillRect(s.x - 8*z, s.y - (p.h - 8 - i*9)*z, 4*z, 6*z);
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
    const hoogte = (zit ? 20 : 30)*z, breedte = 17*z;

    c.save();
    if (flauw) c.globalAlpha = .45;

    c.fillStyle = "rgba(0,0,0,.45)";
    c.beginPath(); c.ellipse(s.x, baseY, 15*z, 7*z, 0, 0, 7); c.fill();

    if (gekozen || a.gesleept){
      c.save();
      c.strokeStyle = a.gesleept ? T.wait : T.gold; c.lineWidth = 2.5*z;
      c.setLineDash([6*z, 5*z]); c.lineDashOffset = -this.t*22*z;
      c.beginPath(); c.ellipse(s.x, baseY, 19*z, 9.5*z, 0, 0, 7); c.stroke();
      c.restore();
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

    /* hoofd met initialen */
    const hoofdY = bodemY - hoogte - 2*z;
    c.beginPath(); c.arc(s.x, hoofdY, 8.2*z, 0, 7);
    c.fillStyle = shade(a.color, 42); c.fill();
    c.strokeStyle = "rgba(0,0,0,.32)"; c.lineWidth = 1*z; c.stroke();
    c.fillStyle = "rgba(255,255,255,.94)";
    c.font = "700 " + (8.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillText(initialen(a.short || a.name), s.x, hoofdY + .5*z);

    /* statusstip: dezelfde kleuren als de legenda van de hub */
    c.beginPath(); c.arc(s.x + 9*z, hoofdY - 7*z, 4*z, 0, 7);
    c.fillStyle = STATUS_COLOR[a.status] || T.idle; c.fill();
    if (a.status === "opgepakt" && !this.reduced){
      const puls = .25 + Math.abs(Math.sin(this.t*2.2))*.35;
      c.beginPath(); c.arc(s.x + 9*z, hoofdY - 7*z, (5.5 + puls*3)*z, 0, 7);
      c.strokeStyle = "rgba(107,168,245," + puls.toFixed(2) + ")"; c.lineWidth = 1.4*z; c.stroke();
    }

    c.restore();
    a._kop = hoofdY;   /* onthouden voor de labellaag hierboven */
    a._voet = baseY;
  }

  /* Wolkje en naam gaan in een aparte laag, ná alle meubels. Anders schuift
   * het bureau van de buurman eroverheen. */
  _agentLabel(a){
    const c = this.ctx, z = this.cam.zoom, T = this.theme;
    if (a._kop == null) return;
    const s = this._naarScherm(a.x, a.y);
    const gekozen = a.id === this.selectedId;

    if (a.gedachte && z > .55){
      const by = a._kop - 26*z;
      c.fillStyle = "rgba(232,237,247,.94)";
      c.beginPath(); c.roundRect(s.x - 11*z, by - 10*z, 22*z, 19*z, 7*z); c.fill();
      c.beginPath(); c.arc(s.x - 6*z, by + 12*z, 2.6*z, 0, 7); c.fill();
      c.fillStyle = "#0B1220";
      c.font = (11*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillText(a.gedachte, s.x, by);
    }

    if ((gekozen || this.hoverAgent === a.id) && z > .45){
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
