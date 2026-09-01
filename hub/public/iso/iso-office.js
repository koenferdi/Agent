/* iso-office.js — de isometrische stad.
 *
 * De motor kent de hub niet. Hij tekent een stad, laat poppetjes lopen en
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
import { THEME, STATUS_COLOR, themaVan } from "./iso-theme.js";
import { TILE, GRID, DESKS, ZONES, KAVELS, SPOTS, LAMPEN, VERBINDINGEN, TOREN,
         stoelVan, parkeerVan, bureausVan, buildMap, vrij, zoneOp, zoneVan } from "./iso-map.js";

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
    /* Hoe goed het bedrijf ervoor staat, 0 t/m 5. Stuurt hoe de stad erbij
     * ligt: licht, groen, versiering, en hoe de agents erbij lopen. De hub
     * rekent dit uit uit echte tellingen; de motor gelooft hem gewoon. */
    this.welvaart = 0;
    this.themaId = "nacht";
    this.gloedKleur = [185, 58, 224];
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
    this.glSchaal = .4;
    /* Beeldkwaliteit: "auto" zakt vanzelf terug als het beeld hapert,
     * "hoog" en "zuinig" zet je zelf vast bij Instellingen. */
    this.kwaliteit = "auto";
    this.zuinig = false;
    this._traag = 0; this._vlot = 0; this._dtGem = 16;

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

  /* Hoe goed het bedrijf ervoor staat: 0 (net begonnen) t/m 5 (het loopt).
   * Alles wat hierop reageert staat in _prop en _grondgloed. */
  /* Een ander thema: dezelfde stad, andere kleuren. */
  setThema(id){
    const t = themaVan(id);
    this.themaId = t.id;
    this.theme = Object.assign({}, THEME, t.over || {});
    this.gloedKleur = t.gloed || [185, 58, 224];
    return this;
  }

  setWelvaart(n){
    this.welvaart = clamp(Math.round(n || 0), 0, 5);
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
    /* boven de vloer staat de toren (150px) met zijn bord erboven */
    const boven  = -(TILE.h/2 + TOREN.h + 40);
    const onder  = (GRID.w - 1 + GRID.h - 1)*TILE.h/2 + TILE.h + 34;
    /* de naamborden steken links en rechts buiten de kaart uit */
    const links  = -(GRID.h - 1)*TILE.w/2 - TILE.w/2 - 100;
    const rechts =  (GRID.w - 1)*TILE.w/2 + TILE.w/2 + 100;
    const marge = 28;
    /* Op een staand scherm past de hele vloer alleen als je hem onleesbaar
     * klein maakt. Dan liever een leesbare zoom en de gebruiker laten schuiven. */
    const pasBreed = W/(rechts - links + marge*2), pasHoog = H/(onder - boven + marge*2);
    /* Een staand scherm is smal en hoog, de stad breed en plat. Precies
     * passend maakt hem onleesbaar klein, dus zoomen we verder in en laten
     * we de randen buiten beeld; schuiven en knijpen doet de rest. */
    this.cam.zoom = H > W*1.15
      ? clamp(Math.min(pasBreed, pasHoog)*1.6, .34, 1.8)
      : clamp(Math.min(pasBreed, pasHoog), .3, 1.8);
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
      case "geleverd": this._stuur(a, "archive"); a.gedachte = "✅";
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
        self.hoverKamer = a ? null : (self.hover ? (zoneOp(self.hover.x, self.hover.y) || {}).name || null : null);
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
          /* op een gebouw tikken kiest de agent die er woont: de poppetjes
           * zijn te klein om als enige aanknopingspunt te dienen */
          const kav = zn && zn.kavel != null ? zn.kavel : null;
          const bewoner = (kav != null && self.perKavel) ? self.perKavel[kav] : null;
          if (bewoner && bewoner.id !== self.selectedId){
            self.selectedId = bewoner.id; self.onSelect(bewoner.id, bewoner);
          }
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

    /* het doek kan van maat veranderen zonder dat het venster dat doet
     * (paneel open, adresbalk weg op de telefoon). Meet dus het doek zelf. */
    if (typeof ResizeObserver !== "undefined"){
      this._ro = new ResizeObserver(() => {
        self._resize(); if (!self.zelfGezoomd) self.fit();
      });
      this._ro.observe(cv);
    }

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
    if (this._ro){ this._ro.disconnect(); this._ro = null; }
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
    /* zuinig tekent op minder pixels; dat scheelt meer dan wat dan ook */
    const dpr = Math.min(window.devicePixelRatio || 1, this.zuinig ? 1.25 : 2);
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
    this._meetSnelheid(dt*1000);
    if (this.zichtbaar){ this._stap(dt); this._teken(); }
    this._raf = requestAnimationFrame(this._loop);
  }

  /* Hapert het beeld, dan gaat de gloed omlaag in plaats van dat het beeld
   * blijft steken. Twee seconden traag is genoeg bewijs; vier seconden vlot
   * zet hem weer terug. Op "hoog" of "zuinig" gebeurt dit niet. */
  _meetSnelheid(ms){
    this._dtGem = this._dtGem*.9 + ms*.1;
    if (this.kwaliteit !== "auto"){ this.zuinig = this.kwaliteit === "zuinig"; return; }
    if (this._dtGem > 33){ this._traag++; this._vlot = 0; }
    else if (this._dtGem < 20){ this._vlot++; this._traag = 0; }
    if (this._traag > 20 && !this.zuinig){ this.zuinig = true; this._traag = 0; this._resize(); }
    if (this._vlot > 300 && this.zuinig){ this.zuinig = false; this._vlot = 0; this._resize(); }
  }

  setKwaliteit(k){
    this.kwaliteit = (k === "hoog" || k === "zuinig") ? k : "auto";
    if (this.kwaliteit !== "auto") this.zuinig = this.kwaliteit === "zuinig";
    this._resize();
    return this;
  }

  /* ===================== tekenen ===================== */

  _teken(){
    const c = this.ctx, T = this.theme, z = this.cam.zoom;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;

    c.clearRect(0,0,W,H);
    c.fillStyle = T.bg; c.fillRect(0,0,W,H);
    c.textAlign = "center"; c.textBaseline = "middle";
    this.glCtx.clearRect(0, 0, this.glCv.width, this.glCv.height);

    this._grondgloed();

    /* welk kavel hoort bij welke agent — één keer per beeld */
    this.perKavel = {};
    for (const a of this.agents) this.perKavel[a.deskIx] = a;

    this._grondlaag();
    for (const k of KAVELS) this._kavelrand(k);
    this._pleinrand();

    if (this.mikpunt) this._tegelRand(this.mikpunt.x, this.mikpunt.y, T.gold);
    else if (this.hover && vrij(this.solid, this.hover.x, this.hover.y))
      this._tegelRand(this.hover.x, this.hover.y, "rgba(120,170,255,.4)");

    /* straatlantaarns: een plas licht op het asfalt */
    c.save(); c.globalCompositeOperation = "lighter";
    LAMPEN.forEach(l => {
      const s = this._naarScherm(l.x, l.y), r = l.r*z;
      const a = l.kavel == null ? null : this.perKavel[l.kavel];
      const aan = !!a;
      const warmte = (this.welvaart || 0)/5;
      const kk = aan ? (.13 + warmte*.12) : .06;
      const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, "rgba(" + Math.round(140 + warmte*90) + ","
                                + Math.round(180 + warmte*10) + ",255," + kk.toFixed(3) + ")");
      g.addColorStop(1, "rgba(140,180,255,0)");
      c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, r, 0, 7); c.fill();
    });
    c.restore();

    /* alles op diepte sorteren: gebouwen, bomen en mensen door elkaar */
    const lijst = [];
    for (const p of this.props) lijst.push({ d: p.x + p.y + p.h/500, f: () => this._prop(p) });
    for (const a of this.agents) lijst.push({ d: a.x + a.y + .4,     f: () => this._agent(a) });
    for (const v of this._busjes())  lijst.push({ d: v.x + v.y + .3,  f: () => this._busje(v) });
    lijst.sort((a,b) => a.d - b.d);
    for (const it of lijst) it.f();

    this._lijnen();
    this._stof();
    this._gloedOver();

    /* naamborden en plaatjes staan bóven de gloed: die moeten scherp blijven */
    this._bordenPlaatsen();
    for (const k of KAVELS) this._naambord(k);
    for (const a of this.agents) this._agentLabel(a);
    this._pleinlabels();
    for (const f of this.floaters) this._floater(f);

    this._vignet(W, H);
  }

  /* De gloed onder de stad. In het voorbeeld ligt de stad op een magenta
   * vlak; dat is wat het beeld van een grijze maquette onderscheidt. */
  _grondgloed(){
    const c = this.ctx, T = this.theme;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const mid = this._naarScherm(GRID.w/2, GRID.h/2);
    const r = Math.max(W, H)*.75;
    /* koud paars als je net begint, warm en vol als het loopt */
    const n = (this.welvaart || 0)/5;
    const [gr, gg, gb] = this.gloedKleur || [185, 58, 224];
    /* koud en flauw als je net begint, vol in de themakleur als het loopt */
    const rood  = Math.round(gr*(.55 + n*.45));
    const groen = Math.round(gg*(.55 + n*.45));
    const blauw = Math.round(gb*(.85 + n*.15));
    const kracht = .22 + n*.2;
    const g = c.createRadialGradient(mid.x, mid.y + H*.18, 0, mid.x, mid.y + H*.18, r);
    g.addColorStop(0,  "rgba(" + rood + "," + groen + "," + blauw + "," + kracht.toFixed(2) + ")");
    g.addColorStop(.45,"rgba(" + Math.round(rood*.6) + "," + Math.round(groen*.6) + ","
                                + Math.round(blauw*.85) + "," + (kracht*.5).toFixed(2) + ")");
    g.addColorStop(1,  "rgba(11,18,32,0)");
    c.save(); c.globalCompositeOperation = "lighter";
    c.fillStyle = g; c.fillRect(0,0,W,H); c.restore();
  }

  /* De gloedbuffer vervaagd en optellend over het beeld. Twee keer: één brede
   * waas en één strakke, dat leest als echt licht in plaats van als mist. */
  _gloedOver(){
    const c = this.ctx, W = this.cv.clientWidth, H = this.cv.clientHeight;
    c.save();
    c.globalCompositeOperation = "lighter";
    const kanFilter = typeof c.filter === "string" && !this.zuinig;
    /* Zuinig: alleen het kleine doek uitvergroot. Dat vervaagt vanzelf en
     * kost bijna niets; vervagen met een filter over het hele scherm is
     * verreweg het duurste wat deze tekening doet. */
    if (kanFilter){
      c.filter = "blur(8px)";
      c.globalAlpha = .6; c.drawImage(this.glCv, 0, 0, W, H);
      c.filter = "none";
      c.globalAlpha = .8; c.drawImage(this.glCv, 0, 0, W, H);
    } else {
      c.globalAlpha = .9; c.drawImage(this.glCv, 0, 0, W, H);
    }
    c.restore();
  }

  /* De rand om een kavel: neon in de kleur van de agent die er woont, dof
   * grijs als het kavel nog leeg is. */
  _kavelrand(k){
    const c = this.ctx, z = this.cam.zoom;
    const a = this.perKavel ? this.perKavel[k.i] : null;
    const kleur = a ? a.color : "#33456B";
    const p = [[k.x0,k.y0],[k.x1+1,k.y0],[k.x1+1,k.y1+1],[k.x0,k.y1+1]].map(([x,y]) => {
      const s = this._naarScherm(x, y);
      return { x: s.x, y: s.y + TILE.h/2*z };
    });
    const heet = this.hoverKamer === "kavel" + k.i;

    /* de zijkant van het platform: dat tilt het kavel van de straat af */
    const dik = 4*z;
    c.save();
    c.beginPath();
    c.moveTo(p[1].x, p[1].y); c.lineTo(p[2].x, p[2].y); c.lineTo(p[3].x, p[3].y);
    c.lineTo(p[3].x, p[3].y + dik); c.lineTo(p[2].x, p[2].y + dik); c.lineTo(p[1].x, p[1].y + dik);
    c.closePath();
    c.fillStyle = "#0E1729"; c.fill();
    c.strokeStyle = a ? kleur : "#2A3A5C"; c.globalAlpha = a ? .45 : .22;
    c.lineWidth = 1*z; c.stroke();
    c.restore();

    c.save();
    c.beginPath(); c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(p[i].x, p[i].y);
    c.closePath();
    if (!a){ c.setLineDash([5*z, 5*z]); c.globalAlpha = heet ? .5 : .28; }
    else c.globalAlpha = heet ? .95 : .55;
    c.strokeStyle = kleur; c.lineWidth = (heet ? 2.4 : 1.6)*z; c.stroke();
    c.restore();
    if (a) this._lichtPad(p, kleur, (heet ? 4 : 2.4)*z, heet ? .8 : .4);
  }

  /* Het plein heeft een eigen rand, in het blauw van de hub. */
  _pleinrand(){
    const c = this.ctx, z = this.cam.zoom, zn = zoneVan("plein");
    if (!zn) return;
    const p = [[zn.x0,zn.y0],[zn.x1+1,zn.y0],[zn.x1+1,zn.y1+1],[zn.x0,zn.y1+1]].map(([x,y]) => {
      const s = this._naarScherm(x, y);
      return { x: s.x, y: s.y + TILE.h/2*z };
    });
    c.save();
    c.beginPath(); c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(p[i].x, p[i].y);
    c.closePath();
    c.strokeStyle = zn.kleur; c.globalAlpha = .45; c.lineWidth = 1.6*z; c.stroke();
    c.restore();
    this._lichtPad(p, zn.kleur, 2.4*z, .34);
  }

  /* Gestippelde lijnen van elk bemand gebouw naar de top van de toren: daar
   * komt het werk samen. Er loopt een lichtje overheen zolang die agent draait. */
  _lijnen(){
    const c = this.ctx, z = this.cam.zoom;
    for (const v of VERBINDINGEN){
      const a = this.perKavel ? this.perKavel[v.kavel] : null;
      if (!a) continue;
      const s1 = this._naarScherm(v.van.x, v.van.y);
      const s2 = this._naarScherm(v.naar.x, v.naar.y);
      const p1 = { x: s1.x, y: s1.y - v.van.h*z };
      const p2 = { x: s2.x, y: s2.y - v.naar.h*z };
      /* een boog, geen rechte streep: dat leest als een kabel door de lucht */
      const cp = { x: (p1.x + p2.x)/2, y: Math.min(p1.y, p2.y) - 26*z };
      c.save();
      c.setLineDash([4*z, 6*z]);
      c.strokeStyle = "rgba(170,205,255,.55)"; c.lineWidth = 1.3*z;
      c.beginPath(); c.moveTo(p1.x, p1.y);
      c.quadraticCurveTo(cp.x, cp.y, p2.x, p2.y); c.stroke();
      c.restore();

      if (a.status !== "opgepakt" || this.reduced) continue;
      /* een pakketje onderweg naar de toren */
      const t = (this.t*.35 + v.kavel*.17) % 1;
      const q = 1 - t;
      const x = q*q*p1.x + 2*q*t*cp.x + t*t*p2.x;
      const y = q*q*p1.y + 2*q*t*cp.y + t*t*p2.y;
      c.fillStyle = a.color;
      c.beginPath(); c.arc(x, y, 2.4*z, 0, 7); c.fill();
      this._lichtBol(x, y, 5.5*z, a.color, .8);
    }
  }

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

  /* De donkere rand om het beeld. Hangt alleen van de schermmaat af, dus
   * één keer tekenen en daarna kopiëren. */
  _vignet(W, H){
    if (!this._vig || this._vigMaat !== W + "x" + H){
      this._vig = document.createElement("canvas");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._vig.width = Math.max(1, Math.round(W*dpr));
      this._vig.height = Math.max(1, Math.round(H*dpr));
      const vc = this._vig.getContext("2d");
      vc.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = vc.createRadialGradient(W/2, H/2, Math.min(W,H)*.42, W/2, H/2, Math.max(W,H)*.82);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.5)");
      vc.fillStyle = g; vc.fillRect(0, 0, W, H);
      this._vigMaat = W + "x" + H;
    }
    this.ctx.drawImage(this._vig, 0, 0, W, H);
  }

  /* De grond — tegels, wegmarkering, bestrating — verandert alleen als de
   * camera of het niveau verandert. Elk beeld opnieuw 441 tegels en 200
   * streepjes tekenen kost meer dan alle poppetjes bij elkaar, dus die laag
   * gaat één keer op een eigen doek en wordt daarna gekopieerd. */
  _grondlaag(){
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const sleutel = [Math.round(this.cam.x), Math.round(this.cam.y),
                     this.cam.zoom.toFixed(3), this.welvaart, this.themaId,
                     W, H].join("|");
    if (!this._grond){
      this._grond = document.createElement("canvas");
      this._grondCtx = this._grond.getContext("2d");
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this._grondSleutel !== sleutel){
      this._grond.width = Math.max(1, Math.round(W*dpr));
      this._grond.height = Math.max(1, Math.round(H*dpr));
      const echt = this.ctx;
      this._grondCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._grondCtx.clearRect(0, 0, W, H);
      this.ctx = this._grondCtx;                 /* even op het andere doek tekenen */
      for (const t of this.tiles) this._tegel(t);
      this._wegmarkering();
      this._pleinbestrating();
      this.ctx = echt;
      this._grondSleutel = sleutel;
    }
    this.ctx.drawImage(this._grond, 0, 0, W, H);
  }

  /* Een bestelbusje dat de ringweg rondrijdt zodra het bedrijf loopt. Eén
   * bewegend ding op straat doet meer voor het beeld dan tien stilstaande.
   * Rijdt niet als je net begint, en niet als animatie uit staat. */
  _busjes(){
    if (this.reduced || (this.welvaart || 0) < 2) return [];
    const ring = [
      { x0:5.5, y0:5.5,  x1:15.5, y1:5.5  },
      { x0:15.5, y0:5.5, x1:15.5, y1:15.5 },
      { x0:15.5, y0:15.5, x1:5.5, y1:15.5 },
      { x0:5.5, y0:15.5, x1:5.5,  y1:5.5  }
    ];
    const aantal = (this.welvaart || 0) >= 4 ? 2 : 1;
    const uit = [];
    for (let n = 0; n < aantal; n++){
      const t = ((this.t*0.035) + n/aantal) % 1;
      const deel = Math.min(3, Math.floor(t*4));
      const f = t*4 - deel;
      const r = ring[deel];
      uit.push({
        x: r.x0 + (r.x1 - r.x0)*f,
        y: r.y0 + (r.y1 - r.y0)*f,
        richting: deel
      });
    }
    return uit;
  }

  _busje(v){
    const c = this.ctx, z = this.cam.zoom;
    const s = this._naarScherm(v.x, v.y);
    c.save(); c.globalAlpha = .35; c.fillStyle = "#04070F";
    c.beginPath(); c.ellipse(s.x, s.y + 2*z, 9*z, 4*z, 0, 0, 7); c.fill(); c.restore();
    this._doos(v.x - .28, v.y - .18, .56, .36, 9, "#43567F");
    this._doos(v.x - .16, v.y - .14, .3, .28, 14, "#4E648E");
    /* koplampjes in de rijrichting */
    const vooruit = [[1,0],[0,1],[-1,0],[0,-1]][v.richting];
    const k = this._naarScherm(v.x + vooruit[0]*.32, v.y + vooruit[1]*.32);
    c.fillStyle = "#FFE6B0";
    c.beginPath(); c.arc(k.x, k.y - 5*z, 1.5*z, 0, 7); c.fill();
    this._lichtBol(k.x, k.y - 5*z, 7*z, "#FFE6B0", .55);
  }

  /* Een zachte slagschaduw op de grond, in de richting van het licht. Zonder
   * schaduw zweeft elk gebouw en oogt de stad plat. */
  _grondschaduw(gx, gy, w, d, h){
    const c = this.ctx, z = this.cam.zoom;
    const scheef = Math.min(.6, h/120) * .8;   /* hogere gebouwen, langere schaduw */
    const p1 = this._naarScherm(gx, gy + d);
    const p2 = this._naarScherm(gx + w, gy + d);
    const p3 = this._naarScherm(gx + w + scheef, gy + d + scheef);
    const p4 = this._naarScherm(gx + scheef, gy + d + scheef);
    c.save();
    c.globalAlpha = .22;
    c.fillStyle = "#04070F";
    c.beginPath();
    c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
    c.lineTo(p3.x, p3.y); c.lineTo(p4.x, p4.y);
    c.closePath(); c.fill();
    c.restore();
  }

  /* Een plat vlak op de grond, bijvoorbeeld een pad of een zebrapad. */
  _vlak(gx, gy, w, d, kleur, alpha){
    const c = this.ctx;
    const p1 = this._naarScherm(gx, gy),         p2 = this._naarScherm(gx + w, gy);
    const p3 = this._naarScherm(gx + w, gy + d), p4 = this._naarScherm(gx, gy + d);
    c.save(); if (alpha != null) c.globalAlpha = alpha;
    c.beginPath();
    c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y); c.lineTo(p4.x, p4.y);
    c.closePath(); c.fillStyle = kleur; c.fill(); c.restore();
  }

  /* Het plein krijgt bestrating die naar de toren wijst. Vier banen die
   * samenkomen bij de ingang: dat trekt het oog naar het midden. */
  _pleinbestrating(){
    if (this.cam.zoom < .45) return;
    const licht = "rgba(150,180,235,.07)";
    for (let i = 0; i < 4; i++){
      this._vlak(6.4 + i*2, 6.4, .12, 8.2, licht);
      this._vlak(6.4, 6.4 + i*2, 8.2, .12, licht);
    }
    /* een ring rond de voet van de toren */
    this._vlak(8.6, 8.6, 3.8, .12, "rgba(126,216,255,.12)");
    this._vlak(8.6, 12.3, 3.8, .12, "rgba(126,216,255,.12)");
    this._vlak(8.6, 8.6, .12, 3.8, "rgba(126,216,255,.12)");
    this._vlak(12.3, 8.6, .12, 3.8, "rgba(126,216,255,.12)");
  }

  /* Wegmarkering: streepjes midden op de straat en zebrapaden bij het plein.
   * Kost weinig en maakt van een raster een stad. */
  _wegmarkering(){
    const c = this.ctx, z = this.cam.zoom;
    if (z < .45) return;
    const kleur = "rgba(190,205,235,.16)";
    /* de straten liggen op x = 0,5,10,15,20 en y = 0,5,10,15,20 */
    for (let k = 0; k <= 20; k += 5){
      for (let n = 0; n < 20; n += 2){
        this._vlak(k + .46, n + .3, .08, .9, kleur);      /* verticale straat */
        this._vlak(n + .3, k + .46, .9, .08, kleur);      /* horizontale straat */
      }
    }
    /* zebrapaden bij de vier ingangen van het plein */
    const zebra = (gx, gy, langs) => {
      for (let i = 0; i < 5; i++){
        if (langs) this._vlak(gx, gy + i*.19, .9, .1, "rgba(210,225,255,.3)");
        else       this._vlak(gx + i*.19, gy, .1, .9, "rgba(210,225,255,.3)");
      }
    };
    zebra(10.05, 5.05, false); zebra(10.05, 15.05, false);
    zebra(5.05, 10.05, true);  zebra(15.05, 10.05, true);
  }

  /* Een vlak IN de gevel. a en b zijn de onderhoeken van dat gevelvlak, H de
   * hoogte in schermpixels; u loopt langs de gevel, v omhoog. Zonder dit
   * plak je een rechthoekje op een scheef vlak en dat zie je meteen. */
  _gevelVlak(a, b, H, u0, u1, v0, v1, kleur, alpha){
    const c = this.ctx;
    const punt = (u, v) => ({ x: a.x + (b.x - a.x)*u, y: a.y + (b.y - a.y)*u - H*v });
    const q = [punt(u0,v0), punt(u1,v0), punt(u1,v1), punt(u0,v1)];
    c.save(); if (alpha != null) c.globalAlpha = alpha;
    c.beginPath(); c.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y);
    c.closePath(); c.fillStyle = kleur; c.fill(); c.restore();
    return punt((u0+u1)/2, (v0+v1)/2);
  }

  /* Ramen op één gevel. a en b zijn de twee onderhoeken van dat vlak op het
   * scherm, H de hoogte in schermpixels. Welke ramen branden hangt af van
   * druk (0..1) en blijft per gebouw hetzelfde: geen geflikker bij stilstand. */
  _gevel(a, b, H, kol, rij, zaad, druk, kleurAan){
    const c = this.ctx, T = this.theme;
    const punt = (u, v) => ({ x: a.x + (b.x - a.x)*u, y: a.y + (b.y - a.y)*u - H*v });
    const mx = .13, my = .10;
    const cw = (1 - mx*2)/kol, ch = (1 - my*2)/rij;
    for (let j = 0; j < rij; j++){
      for (let i = 0; i < kol; i++){
        const n = (zaad*7919 + j*131 + i*37) % 100;
        let aan = n < druk*100;
        /* in een gebouw waar gewerkt wordt gaat af en toe een raam aan of uit */
        if (druk > .5 && !this.reduced && (n % 17) === 0)
          aan = Math.sin(this.t*.9 + n) > 0;
        const u0 = mx + i*cw + cw*.18, u1 = mx + i*cw + cw*.82;
        const v0 = my + j*ch + ch*.18, v1 = my + j*ch + ch*.78;
        const p = [punt(u0,v0), punt(u1,v0), punt(u1,v1), punt(u0,v1)];
        c.beginPath(); c.moveTo(p[0].x,p[0].y);
        for (let q = 1; q < 4; q++) c.lineTo(p[q].x,p[q].y);
        c.closePath();
        c.fillStyle = aan ? kleurAan : T.raamUit;
        c.globalAlpha = aan ? .95 : .5; c.fill(); c.globalAlpha = 1;
        /* gloed per raam is duur; alleen doen waar echt gewerkt wordt */
        if (aan && druk > .6){
          const mid = punt((u0+u1)/2, (v0+v1)/2);
          this._lichtBol(mid.x, mid.y, Math.abs(p[1].x - p[0].x)*.32 + 1, kleurAan, .16);
        }
      }
    }
  }

  _prop(p){
    const c = this.ctx, z = this.cam.zoom, T = this.theme;
    /* sommige dingen komen er pas als het bedrijf beter loopt */
    if (p.vanaf != null && p.vanaf > (this.welvaart || 0)) return;
    switch (p.kind){

      /* ---- het gebouw van één agent ---------------------------------- */
      case "gebouw": {
        const a = this.perKavel ? this.perKavel[p.kavel] : null;
        const basis = this._naarScherm(p.x, p.y);
        if (!a){
          /* leeg kavel: een fundering die op een agent wacht */
          this._doos(p.x + .2, p.y + .2, p.w - .4, p.d - .4, 7, T.gebouwLeeg);
          c.save(); c.setLineDash([4*z, 4*z]); c.globalAlpha = .35;
          c.strokeStyle = "#4A6091"; c.lineWidth = 1*z;
          const h = this._naarScherm(p.x + .2, p.y + .2), r = this._naarScherm(p.x + p.w - .2, p.y + .2);
          const o = this._naarScherm(p.x + p.w - .2, p.y + p.d - .2), l = this._naarScherm(p.x + .2, p.y + p.d - .2);
          c.beginPath(); c.moveTo(h.x, h.y - 7*z); c.lineTo(r.x, r.y - 7*z);
          c.lineTo(o.x, o.y - 7*z); c.lineTo(l.x, l.y - 7*z); c.closePath(); c.stroke();
          c.restore();
          break;
        }

        const werkt = a.status === "opgepakt";
        const wacht = a.status === "nieuw";
        const flauw = a.status === "offphase" || a.status === "geparkeerd";
        const druk  = flauw ? .12 : werkt ? .8 : wacht ? .5 : .3;
        const raam  = werkt ? T.raamAan : flauw ? T.raamUit : T.raamKoel;
        const H     = p.h*z;

        /* een pad van de stoep naar de deur, en wat er verder op het erf ligt */
        this._vlak(p.x + .75, p.y + p.d, .5, 1.15, "rgba(150,175,215,.09)");
        this._grondschaduw(p.x, p.y, p.w, p.d, p.h);

        /* sokkel: het gebouw staat op een stoepje, dat geeft het gewicht */
        this._doos(p.x - .18, p.y - .18, p.w + .36, p.d + .36, 5, T.stoep);
        this._doos(p.x, p.y, p.w, p.d, p.h, T.gebouw);


        /* de vier hoekpunten van de bovenkant, voor gevels en dak */
        const p1 = this._naarScherm(p.x, p.y),           p2 = this._naarScherm(p.x + p.w, p.y);
        const p3 = this._naarScherm(p.x + p.w, p.y+p.d), p4 = this._naarScherm(p.x, p.y + p.d);

        /* de begane grond donkerder: een band over de gevel, niet een doos
         * eromheen — die zou de ramen afdekken */
        const band = (a1, b1) => {
          const hoog = Math.min(15, p.h*.2)*z;
          c.save(); c.globalAlpha = .5; c.fillStyle = shade(T.gebouw, -30);
          c.beginPath();
          c.moveTo(a1.x, a1.y); c.lineTo(b1.x, b1.y);
          c.lineTo(b1.x, b1.y - hoog); c.lineTo(a1.x, a1.y - hoog);
          c.closePath(); c.fill(); c.restore();
        };

        /* ramen op de twee zichtbare gevels */
        const kol = p.stijl === 2 ? 2 : 3, rij = Math.max(2, Math.round(p.h/22));
        this._gevel(p2, p3, H, kol, rij, p.kavel + 1, druk, raam);
        this._gevel(p3, p4, H, kol, rij, p.kavel + 9, druk*.85, raam);

        band(p2, p3); band(p3, p4);

        /* daklijn in de kleur van de agent: zo herken je zijn gebouw */
        c.save();
        c.strokeStyle = a.color; c.lineWidth = 1.8*z; c.globalAlpha = .95;
        c.beginPath();
        c.moveTo(p1.x, p1.y - H); c.lineTo(p2.x, p2.y - H);
        c.lineTo(p3.x, p3.y - H); c.lineTo(p4.x, p4.y - H); c.closePath(); c.stroke();
        c.restore();
        this._lichtPad([{x:p1.x,y:p1.y-H},{x:p2.x,y:p2.y-H},{x:p3.x,y:p3.y-H},{x:p4.x,y:p4.y-H},{x:p1.x,y:p1.y-H}],
                       a.color, 3*z, werkt ? .8 : .45);

        /* opbouw op het dak, per stijl iets anders */
        if (p.stijl === 0){
          this._doos(p.x + .55, p.y + .55, .9, .9, p.h + 12, "#2A4877");
        } else if (p.stijl === 1){
          this._doos(p.x + .25, p.y + .25, 1.5, 1.5, p.h + 20, "#284470");
          this._gevel(this._naarScherm(p.x + 1.75, p.y + .25), this._naarScherm(p.x + 1.75, p.y + 1.75),
                      20*z, 2, 1, p.kavel + 3, druk, raam);
        } else {
          /* een mast met een knipperlicht bovenop */
          const top = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
          c.strokeStyle = "#4C6698"; c.lineWidth = 1.6*z;
          c.beginPath(); c.moveTo(top.x, top.y - H); c.lineTo(top.x, top.y - H - 26*z); c.stroke();
          const puls = this.reduced ? .8 : .4 + Math.abs(Math.sin(this.t*1.8))*.6;
          c.fillStyle = "#FF6B7D";
          c.beginPath(); c.arc(top.x, top.y - H - 27*z, 2.4*z, 0, 7); c.fill();
          this._lichtBol(top.x, top.y - H - 27*z, 6*z, "#FF6B7D", puls);
        }

        /* dakrand met een reling en wat techniek erop: elk dak is anders */
        c.save();
        c.strokeStyle = shade(T.gebouwDak, 30); c.globalAlpha = .5; c.lineWidth = 1*z;
        for (let i = 1; i <= 3; i++){
          const u = i/4;
          c.beginPath();
          c.moveTo(p2.x + (p3.x - p2.x)*u, p2.y + (p3.y - p2.y)*u - H);
          c.lineTo(p2.x + (p3.x - p2.x)*u, p2.y + (p3.y - p2.y)*u - H - 4*z);
          c.stroke();
        }
        c.restore();
        this._doos(p.x + .18, p.y + 1.35, .45, .35, p.h + 7, "#33507F");   /* kastje */
        this._doos(p.x + 1.4, p.y + .2, .35, .3, p.h + 5, "#2C4674");      /* pijpje */

        /* Deur, luifel en naambordje liggen IN de gevel, niet op het scherm.
         * De voorgevel is de kant waar de agent staat: p3 → p4. */
        const deurK = werkt ? "rgba(255,196,107,.92)" : "rgba(127,216,255,.55)";
        const mid = this._gevelVlak(p3, p4, H, .40, .58, .01, .13, deurK);
        this._lichtBol(mid.x, mid.y, 9*z, werkt ? T.raamAan : T.raamKoel, werkt ? .7 : .3);
        /* luifel: een streep boven de deur in de kleur van de agent */
        const lm = this._gevelVlak(p3, p4, H, .34, .64, .132, .152, shade(a.color, -18));
        this._lichtBol(lm.x, lm.y, 7*z, a.color, werkt ? .5 : .28);
        /* bordje met zijn initialen naast de deur */
        if (z > .5){
          const bm = this._gevelVlak(p3, p4, H, .64, .80, .05, .115, "rgba(9,15,28,.9)");
          this._gevelVlak(p3, p4, H, .64, .655, .05, .115, a.color);
          c.fillStyle = a.color;
          c.font = "700 " + (5.4*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
          c.fillText(initialen(a.short || a.name), bm.x + 1*z, bm.y);
        }

        /* een fietsenrek en een container op het erf: dat maakt het bewoond */
        this._doos(p.x + 2.35, p.y + 1.55, .5, .16, 7, "#3A4A6B");
        this._doos(p.x - .35, p.y + 1.5, .45, .45, 9, "#2F3E5E");
        break;
      }

      /* ---- de toren op het plein: de hub zelf ------------------------ */
      case "toren": {
        const H = p.h*z;
        this._doos(p.x - .3, p.y - .3, p.w + .6, p.d + .6, 8, T.stoep);
        this._doos(p.x, p.y, p.w, p.d, p.h, "#27497F");
        const p1 = this._naarScherm(p.x, p.y),           p2 = this._naarScherm(p.x + p.w, p.y);
        const p3 = this._naarScherm(p.x + p.w, p.y+p.d), p4 = this._naarScherm(p.x, p.y + p.d);
        /* glasstroken in plaats van losse ramen: hij moet anders ogen */
        [[p2,p3],[p3,p4]].forEach(([a1,b1], f) => {
          for (let i = 0; i < 7; i++){
            const u = .1 + i*.125;
            const x0 = a1.x + (b1.x - a1.x)*u, y0 = a1.y + (b1.y - a1.y)*u;
            const golf = this.reduced ? .5 : .3 + Math.abs(Math.sin(this.t*.7 + i + f))*.4;
            const g = c.createLinearGradient(x0, y0, x0, y0 - H);
            g.addColorStop(0, "rgba(126,216,255,0)");
            g.addColorStop(.5, "rgba(126,216,255," + (golf*.75).toFixed(2) + ")");
            g.addColorStop(1, "rgba(126,216,255,.12)");
            c.strokeStyle = g; c.lineWidth = 2.4*z;
            c.beginPath(); c.moveTo(x0, y0 - 4*z); c.lineTo(x0, y0 - H + 6*z); c.stroke();
          }
        });
        c.save(); c.strokeStyle = "#7FD8FF"; c.globalAlpha = .8; c.lineWidth = 1.8*z;
        c.beginPath(); c.moveTo(p1.x,p1.y-H); c.lineTo(p2.x,p2.y-H);
        c.lineTo(p3.x,p3.y-H); c.lineTo(p4.x,p4.y-H); c.closePath(); c.stroke(); c.restore();
        this._lichtPad([{x:p1.x,y:p1.y-H},{x:p2.x,y:p2.y-H},{x:p3.x,y:p3.y-H},{x:p4.x,y:p4.y-H},{x:p1.x,y:p1.y-H}],
                       "#7FD8FF", 4*z, .7);
        /* schotel bovenop, precies zoals in het voorbeeld */
        const top = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
        this._doos(p.x + .9, p.y + .9, 1.2, 1.2, p.h + 16, "#25436F");
        const sy = top.y - H - 18*z;
        c.save();
        c.strokeStyle = "#8FD6FF"; c.lineWidth = 1.4*z; c.globalAlpha = .9;
        c.beginPath(); c.ellipse(top.x, sy, 15*z, 8*z, -.35, 0, 7); c.stroke();
        for (let i = 1; i <= 2; i++){
          c.globalAlpha = .45;
          c.beginPath(); c.ellipse(top.x, sy, 15*z*(i/3), 8*z*(i/3), -.35, 0, 7); c.stroke();
        }
        c.restore();
        this._lichtBol(top.x, sy, 18*z, "#8FD6FF", .5);
        /* de bakens: een rondje dat pulseert zolang er iemand werkt */
        const bezig = this.agents.some(a => a.status === "opgepakt");
        const puls = this.reduced ? .6 : .3 + Math.abs(Math.sin(this.t*1.5))*.7;
        c.fillStyle = bezig ? "#F5C542" : "#43608F";
        c.beginPath(); c.arc(top.x, sy - 12*z, 2.6*z, 0, 7); c.fill();
        this._lichtBol(top.x, sy - 12*z, 7*z, bezig ? "#F5C542" : "#43608F", bezig ? puls : .25);
        break;
      }

      /* ---- overlegzaal ---------------------------------------------- */
      case "hal": {
        this._doos(p.x - .2, p.y - .2, p.w + .4, p.d + .4, 5, T.stoep);
        this._doos(p.x, p.y, p.w, p.d, p.h, "#2A3560");
        const H = p.h*z;
        const p2 = this._naarScherm(p.x + p.w, p.y), p3 = this._naarScherm(p.x + p.w, p.y + p.d);
        const p4 = this._naarScherm(p.x, p.y + p.d), p1 = this._naarScherm(p.x, p.y);
        this._gevel(p2, p3, H, 4, 2, 5, .7, "#F5C542");
        this._gevel(p3, p4, H, 3, 2, 8, .6, "#F5C542");
        c.save(); c.strokeStyle = "#F5C542"; c.globalAlpha = .85; c.lineWidth = 1.6*z;
        c.beginPath(); c.moveTo(p1.x,p1.y-H); c.lineTo(p2.x,p2.y-H);
        c.lineTo(p3.x,p3.y-H); c.lineTo(p4.x,p4.y-H); c.closePath(); c.stroke(); c.restore();
        this._lichtPad([{x:p1.x,y:p1.y-H},{x:p2.x,y:p2.y-H},{x:p3.x,y:p3.y-H},{x:p4.x,y:p4.y-H},{x:p1.x,y:p1.y-H}],
                       "#F5C542", 3*z, .5);
        break;
      }

      case "kiosk": {
        this._doos(p.x, p.y, p.w, p.d, p.h, "#4A3F63");
        const s = this._naarScherm(p.x + p.w, p.y + p.d/2);
        const aan = this.reduced ? true : Math.sin(this.t*2.2) > -.5;
        c.fillStyle = aan ? "#F0B454" : "rgba(240,180,84,.3)";
        c.fillRect(s.x - 12*z, s.y - (p.h - 6)*z, 10*z, 6*z);
        if (aan) this._lichtRect(s.x - 12*z, s.y - (p.h - 6)*z, 10*z, 6*z, "#F0B454", .7);
        break;
      }

      case "bank": this._doos(p.x, p.y, p.w, p.d, p.h, "#3B4468"); break;

      /* de vlag aan de gevel: de kleur van de agent die er woont */
      case "vlag": {
        const a = this.perKavel ? this.perKavel[p.kavel] : null;
        if (!a) break;
        const hoek = this._naarScherm(p.x + p.w, p.y + p.d/2);
        const top = hoek.y - (p.h - 8)*z;
        const golf = this.reduced ? 0 : Math.sin(this.t*1.6 + p.kavel)*1.6*z;
        c.save();
        c.strokeStyle = "#8497BE"; c.lineWidth = 1.2*z;
        c.beginPath(); c.moveTo(hoek.x, top); c.lineTo(hoek.x, top + 26*z); c.stroke();
        c.beginPath();
        c.moveTo(hoek.x + 1*z, top + 2*z);
        c.lineTo(hoek.x + 13*z + golf, top + 4*z);
        c.lineTo(hoek.x + 13*z + golf, top + 13*z);
        c.lineTo(hoek.x + 1*z, top + 12*z);
        c.closePath();
        c.fillStyle = a.color; c.globalAlpha = .9; c.fill();
        c.restore();
        this._lichtRect(hoek.x + 1*z, top + 2*z, 12*z, 10*z, a.color, .45);
        break;
      }

      /* fontein op het plein: komt er pas als het bedrijf goed loopt */
      case "fontein": {
        this._doos(p.x, p.y, p.w, p.d, 7, "#2A3A5E");
        const m = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
        c.save();
        c.fillStyle = "rgba(126,216,255,.5)";
        c.beginPath(); c.ellipse(m.x, m.y - 5*z, 15*z, 7*z, 0, 0, 7); c.fill();
        c.restore();
        this._lichtBol(m.x, m.y - 6*z, 14*z, "#7FD8FF", .35);
        /* de straal */
        const h = (10 + (this.reduced ? 2 : Math.abs(Math.sin(this.t*1.4))*5))*z;
        c.fillStyle = "rgba(180,235,255,.75)";
        c.fillRect(m.x - 1.2*z, m.y - 6*z - h, 2.4*z, h);
        this._lichtRect(m.x - 1.2*z, m.y - 6*z - h, 2.4*z, h, "#B4EBFF", .7);
        break;
      }

      /* marktkraam met gestreepte luifel: dat maakt het plein gezellig */
      case "kraam": {
        this._doos(p.x, p.y, p.w, p.d, p.h*.55, "#4A3F63");
        const l = this._naarScherm(p.x, p.y + p.d);
        const r = this._naarScherm(p.x + p.w, p.y + p.d);
        const dak = p.h*z;
        c.save();
        for (let i = 0; i < 6; i++){
          const u0 = i/6, u1 = (i + 1)/6;
          c.beginPath();
          c.moveTo(l.x + (r.x - l.x)*u0, l.y + (r.y - l.y)*u0 - dak);
          c.lineTo(l.x + (r.x - l.x)*u1, l.y + (r.y - l.y)*u1 - dak);
          c.lineTo(l.x + (r.x - l.x)*u1, l.y + (r.y - l.y)*u1 - dak + 7*z);
          c.lineTo(l.x + (r.x - l.x)*u0, l.y + (r.y - l.y)*u0 - dak + 7*z);
          c.closePath();
          c.fillStyle = i % 2 ? "#F3EDE2" : (p.kleur || "#C9542F");
          c.fill();
        }
        c.restore();
        const m2 = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
        this._lichtRect(m2.x - 10*z, m2.y - dak + 2*z, 20*z, 4*z, "#FFD9A0", .4);
        break;
      }

      case "lantaarn": {
        const s = this._naarScherm(p.x, p.y);
        c.strokeStyle = T.paal; c.lineWidth = 1.6*z;
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y - p.h*z); c.stroke();
        c.fillStyle = T.lamplicht;
        c.beginPath(); c.arc(s.x, s.y - p.h*z - 2*z, 1.9*z, 0, 7); c.fill();
        this._lichtBol(s.x, s.y - p.h*z - 2*z, 5.5*z, T.lamplicht, .3);
        break;
      }

      case "boom": {
        const s = this._naarScherm(p.x + p.w/2, p.y + p.d/2);
        c.save(); c.globalAlpha = .3; c.fillStyle = "#04070F";
        c.beginPath(); c.ellipse(s.x + p.h*.14*z, s.y + 1*z, p.h*.17*z, p.h*.07*z, 0, 0, 7);
        c.fill(); c.restore();
        c.strokeStyle = T.stam; c.lineWidth = 2.2*z;
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y - p.h*.45*z); c.stroke();
        for (let i = 0; i < 3; i++){
          const wieg = this.reduced ? 0 : Math.sin(this.t*.7 + i + p.x)*.06;
          c.save(); c.translate(s.x, s.y - p.h*.55*z); c.rotate((i-1)*.5 + wieg);
          c.fillStyle = i === 1 ? shade(T.groen, -14) : shade(T.groen, -34);
          c.beginPath(); c.ellipse(0, -p.h*.16*z, p.h*.15*z, p.h*.24*z, 0, 0, 7); c.fill();
          c.restore();
        }
        break;
      }

      case "kast": {
        this._doos(p.x, p.y, p.w, p.d, p.h, T.boekenkast);
        /* elk boekje is één rapport in drafts/ */
        const s = this._naarScherm(p.x + p.w, p.y);
        for (let i = 0; i < (p.vol || 0); i++){
          const bx = s.x - 8*z, by = s.y - (p.h - 8 - i*8)*z;
          c.fillStyle = T.ok; c.fillRect(bx, by, 4*z, 5*z);
          this._lichtRect(bx, by, 4*z, 5*z, T.ok, .85);
        }
        break;
      }
    }
  }

  /* Waar hangt elk bord? Twee borden die elkaar overlappen zijn onleesbaar,
   * dus wie botst schuift omhoog. Één keer per beeld uitgerekend. */
  _bordenPlaatsen(){
    const c = this.ctx, zoom = this.cam.zoom, z = Math.min(zoom, 1.15);
    this._bordY = {};
    const spreid = [64, 92, 48, 104, 74, 58, 96, 44, 86, 66, 100, 54];
    const items = [];
    for (const k of KAVELS){
      const a = this.perKavel ? this.perKavel[k.i] : null;
      if (!a) continue;
      const s = this._naarScherm(k.x0 + 2, k.y0 + 2);
      c.font = "700 " + (13*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      const w1 = c.measureText(a.short2 || a.name).width;
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      const w2 = a.rolTekst ? c.measureText(a.rolTekst).width : 0;
      items.push({ i:k.i, x:s.x, y: s.y - k.hoog*zoom - spreid[k.i % 12]*zoom,
                   w: Math.max(w1, w2) + 26*z });
    }
    items.sort((p, q) => p.y - q.y);
    const gedaan = [];
    for (const it of items){
      let ronde = 0, botst = true;
      while (botst && ronde++ < 40){
        botst = false;
        for (const g of gedaan){
          if (Math.abs(g.x - it.x) < (g.w + it.w)/2 && Math.abs(g.y - it.y) < 42*z){
            it.y = g.y - 44*z; botst = true; break;
          }
        }
      }
      gedaan.push(it);
      this._bordY[it.i] = it.y;
    }
  }

  /* Het naambord boven een gebouw: een lichtstraal met de naam en de rol van
   * de agent erboven. Dit is wat de stad leesbaar maakt — je ziet in één
   * oogopslag wie waar zit, zonder ergens overheen te hoeven. */
  _naambord(k){
    const c = this.ctx, T = this.theme, zoom = this.cam.zoom;
    if (zoom < .26) return;
    const z = Math.min(zoom, 1.15);
    const a = this.perKavel ? this.perKavel[k.i] : null;
    const s = this._naarScherm(k.x0 + 2, k.y0 + 2);
    const dak = s.y - (a ? k.hoog : 7)*zoom;

    if (!a){
      if (zoom < .62) return;
      const tekst = "vrij kavel " + k.nr;
      c.font = (8.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillStyle = "rgba(130,155,195,.3)";
      c.fillText(tekst, s.x, dak - 12*z);
      return;
    }

    const bordY = (this._bordY && this._bordY[k.i] != null)
      ? this._bordY[k.i] : dak - 70*zoom;
    const gekozen = a.id === this.selectedId || this.hoverAgent === a.id;

    c.save();
    c.globalCompositeOperation = "lighter";
    const g = c.createLinearGradient(s.x, dak, s.x, bordY);
    g.addColorStop(0, a.color + (gekozen ? "AA" : "77"));
    g.addColorStop(1, a.color + "00");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(s.x - 3.2*zoom, dak); c.lineTo(s.x + 3.2*zoom, dak);
    c.lineTo(s.x + 1*zoom, bordY); c.lineTo(s.x - 1*zoom, bordY);
    c.closePath(); c.fill();
    c.restore();
    this._lichtRect(s.x - 1.6*zoom, bordY, 3.2*zoom, dak - bordY, a.color, gekozen ? .8 : .5);

    /* het bord zelf */
    const naam = a.short2 || a.name;
    const rol  = a.rolTekst || a.statusTekst || "";
    c.font = "700 " + (13*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    const wNaam = c.measureText(naam).width;
    c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    const wRol = rol ? c.measureText(rol).width : 0;
    const w = Math.max(wNaam, wRol);
    const x0 = s.x - w/2, y0 = bordY - 30*z;

    /* een donkere waas eronder, anders verdwijnt de tekst in een gevel */
    c.save();
    c.fillStyle = "rgba(9,15,28,.55)";
    c.beginPath(); c.roundRect(x0 - 12*z, y0 - 6*z, w + 24*z, 40*z, 5*z); c.fill();
    if (gekozen){ c.strokeStyle = a.color + "AA"; c.lineWidth = 1; c.stroke(); }
    c.restore();

    /* stip links van de naam */
    c.fillStyle = a.color;
    c.beginPath(); c.arc(x0 - 6*z, y0 + 5*z, 3*z, 0, 7); c.fill();
    this._lichtBol(x0 - 6*z, y0 + 5*z, 6*z, a.color, .9);

    c.textAlign = "left";
    c.font = "700 " + (13*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
    c.fillStyle = "#FFFFFF"; c.fillText(naam, x0, y0 + 5*z);
    /* het streepje onder de naam, in de kleur van de agent */
    c.fillStyle = a.color;
    c.fillRect(x0, y0 + 13*z, w, 1.6*z);
    this._lichtRect(x0, y0 + 13*z, w, 1.6*z, a.color, .7);
    if (rol){
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillStyle = "rgba(213,224,243,.9)";
      c.fillText(rol, x0, y0 + 22*z);
    }
    c.textAlign = "center";
  }

  /* Borden voor de toren en de overlegzaal, in dezelfde stijl. */
  _pleinlabels(){
    const c = this.ctx, zoom = this.cam.zoom;
    if (zoom < .4) return;
    const z = Math.min(zoom, 1.15);
    const bord = (wx, wy, hoogte, kleur, naam, onder) => {
      const s = this._naarScherm(wx, wy);
      const dak = s.y - hoogte*zoom, bordY = dak - 34*zoom;
      c.save(); c.globalCompositeOperation = "lighter";
      const g = c.createLinearGradient(s.x, dak, s.x, bordY);
      g.addColorStop(0, kleur + "88"); g.addColorStop(1, kleur + "00");
      c.fillStyle = g; c.fillRect(s.x - 2*zoom, bordY, 4*zoom, dak - bordY);
      c.restore();
      c.font = "700 " + (13*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      const w = Math.max(c.measureText(naam).width,
        (c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif', c.measureText(onder).width));
      const x0 = s.x - w/2, y0 = bordY - 30*z;
      c.fillStyle = "rgba(9,15,28,.55)";
      c.beginPath(); c.roundRect(x0 - 12*z, y0 - 6*z, w + 24*z, 40*z, 5*z); c.fill();
      c.fillStyle = kleur;
      c.beginPath(); c.arc(x0 - 6*z, y0 + 5*z, 3*z, 0, 7); c.fill();
      this._lichtBol(x0 - 6*z, y0 + 5*z, 6*z, kleur, .9);
      c.textAlign = "left";
      c.font = "700 " + (13*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillStyle = "#FFFFFF"; c.fillText(naam, x0, y0 + 5*z);
      c.fillStyle = kleur; c.fillRect(x0, y0 + 13*z, w, 1.6*z);
      this._lichtRect(x0, y0 + 13*z, w, 1.6*z, kleur, .7);
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Sans",system-ui,sans-serif';
      c.fillStyle = "rgba(213,224,243,.9)"; c.fillText(onder, x0, y0 + 22*z);
      c.textAlign = "center";
    };
    const n = (this.zoneInfo && this.zoneInfo.plein) || "alles komt hier samen";
    bord(TOREN.x, TOREN.y, TOREN.h + 30, "#7FD8FF", this.stadNaam || "De hub", n);
    bord(7.5, 13, 44, "#F5C542", "Overlegzaal",
         (this.zoneInfo && this.zoneInfo.meeting) || "hier komt de ploeg samen");
  }

  /* ============ het poppetje ============
   *
   * Met de hand getekende pixelfiguur op een raster van 12 bij 18 blokjes.
   * Geen plaatjesbestand: dat schaalt slecht en je kunt er geen kleding aan
   * hangen die per agent verschilt. Alles is fillRect op hele blokjes, dus
   * het blijft scherp op elke zoom.
   *
   * Wat er per agent verschilt: huid, haar, kleur van het shirt (zijn eigen
   * kleur) en hoe rijk hij erbij loopt — dat laatste komt uit de welvaart van
   * het bedrijf, niet uit smaak.
   */
  _huid(a){
    const t = ["#F0C9A4","#E0AA80","#C68A5E","#9C6242","#7A4B33","#F7DCC0"];
    return t[this._zaad(a.id) % t.length];
  }
  _haar(a){
    const t = ["#2B2118","#4A2F1C","#6E4423","#8C6239","#1A1A1F","#B0793B","#5E4A6B"];
    return t[(this._zaad(a.id) >> 3) % t.length];
  }
  _zaad(id){
    let n = 0;
    for (let i = 0; i < String(id).length; i++) n = (n*31 + String(id).charCodeAt(i)) & 0xffff;
    return n;
  }

  _agent(a){
    const c = this.ctx, z = this.cam.zoom, T = this.theme;
    const s = this._naarScherm(a.x, a.y);
    const gekozen = a.id === this.selectedId;
    const zit   = a.pose === "zitten" && !a.loopt;
    const flauw = a.status === "offphase" || a.status === "geparkeerd";
    const baseY = s.y + TILE.h/2*z;
    const niveau = this.welvaart || 0;

    /* één blokje. Nooit kleiner dan een echte pixel, anders valt hij uit elkaar */
    const P = Math.max(1, 1.55*z);
    const stap = a.loopt && !this.reduced ? (Math.floor(a.bob/1.4) % 4) : -1;
    const adem = !a.loopt && !this.reduced ? (Math.floor(this.t*1.6 + a.bob) % 6 === 0 ? 1 : 0) : 0;
    const wip  = stap === 1 || stap === 3 ? 1 : 0;

    /* het raster: x naar rechts vanaf het midden, y omhoog vanaf de voeten */
    const ox = s.x, oy = baseY - (zit ? 3*P : 0) + (adem + wip)*P;
    const blok = (kleur, x, y, w, h) => {
      c.fillStyle = kleur;
      c.fillRect(Math.round(ox + (x - 6)*P), Math.round(oy - (y + h)*P),
                 Math.ceil(w*P), Math.ceil(h*P));
    };

    c.save();
    if (flauw) c.globalAlpha = .5;

    /* schaduw en zijn eigen kleur op de grond */
    c.fillStyle = "rgba(0,0,0,.5)";
    c.beginPath(); c.ellipse(s.x, baseY, 8*P, 3.4*P, 0, 0, 7); c.fill();
    if (!flauw){
      const gl = c.createRadialGradient(s.x, baseY, 0, s.x, baseY, 14*P);
      gl.addColorStop(0, a.color + "3A"); gl.addColorStop(1, a.color + "00");
      c.save(); c.globalCompositeOperation = "lighter";
      c.fillStyle = gl; c.beginPath(); c.ellipse(s.x, baseY, 14*P, 6*P, 0, 0, 7); c.fill();
      c.restore();
    }

    if (gekozen || a.gesleept){
      c.save();
      c.strokeStyle = a.gesleept ? T.wait : T.gold; c.lineWidth = 2*z;
      c.setLineDash([5*z, 4*z]); c.lineDashOffset = -this.t*20*z;
      c.beginPath(); c.ellipse(s.x, baseY, 10*P, 4.6*P, 0, 0, 7); c.stroke();
      c.restore();
      this._lichtBol(s.x, baseY, 11*P, a.gesleept ? T.wait : T.gold, .3);
    }
    if (a.gesleept && this.mikpunt){
      const m = this._naarScherm(this.mikpunt.x + .5, this.mikpunt.y + .5);
      c.save(); c.setLineDash([5*z, 5*z]);
      c.strokeStyle = "rgba(245,197,66,.6)"; c.lineWidth = 1.5*z;
      c.beginPath(); c.moveTo(s.x, baseY); c.lineTo(m.x, m.y); c.stroke();
      c.restore();
    }

    const huid = this._huid(a), haar = this._haar(a);
    const shirt = a.color;
    const shirtD = shade(shirt, -34), shirtL = shade(shirt, 26);
    const broek = niveau >= 3 ? "#232B44" : "#2E3450";
    const schoen = "#171C2C";
    const links = a.face < 0;

    if (zit){
      /* zittend: benen naar voren, handen op het werkblad */
      blok(schoen, 3.4, 0, 2.2, 1.4); blok(schoen, 6.4, 0, 2.2, 1.4);
      blok(broek, 3.4, 1.4, 5.2, 2.6);          /* onderbenen */
      blok(broek, 4, 4, 4, 2.6);                /* zitvlak */
      blok(shirtD, 3.6, 6.6, 4.8, 4.2);         /* romp */
      blok(shirt, 4, 6.6, 4, 4.2);
      blok(shirtL, 4, 10, 4, .8);
      blok(huid, 2.6, 8.4, 1.4, 1.2);           /* armen naar het scherm */
      blok(huid, 8, 8.4, 1.4, 1.2);
    } else {
      /* staand of lopend */
      const l1 = stap === 1 ? .8 : stap === 3 ? -.8 : 0;
      blok(schoen, 3.6 + l1, 0, 2.2, 1.2);
      blok(schoen, 6.2 - l1, 0, 2.2, 1.2);
      blok(broek, 3.8 + l1*.6, 1.2, 2, 4.4);
      blok(broek, 6.2 - l1*.6, 1.2, 2, 4.4);
      blok(shade(broek, -12), 3.8, 5, 4.4, 1);   /* riem */
      blok(shirtD, 3.4, 6, 5.2, 5);              /* romp */
      blok(shirt, 3.9, 6, 4.2, 5);
      blok(shirtL, 3.9, 10.4, 4.2, .6);          /* licht op de schouders */
      /* armen zwaaien mee */
      const a1 = stap === 1 ? .9 : stap === 3 ? -.9 : 0;
      blok(shirtD, 2.6, 6.6 + a1*.5, 1.3, 3.6);
      blok(huid,   2.6, 6.2 + a1*.5, 1.3, 1);
      blok(shirtD, 8.1, 6.6 - a1*.5, 1.3, 3.6);
      blok(huid,   8.1, 6.2 - a1*.5, 1.3, 1);
    }

    /* hoofd — bij zitten iets lager */
    const hy = zit ? 10.8 : 11;
    blok(huid, 3.9, hy, 4.2, 4);                 /* gezicht */
    blok(shade(huid, -26), 3.9, hy, 4.2, .5);    /* kin in de schaduw */
    blok(haar, 3.6, hy + 3.2, 4.8, 1.6);         /* haar bovenop */
    blok(haar, links ? 7.6 : 3.6, hy + 1.4, .8, 2);  /* pony aan de kijkkant */

    /* ogen: knipperen af en toe, dat maakt het levend */
    const knipper = !this.reduced && (Math.floor(this.t*1.1 + this._zaad(a.id)) % 7 === 0)
                    && (this.t*3 % 1) < .34;
    if (!knipper){
      blok("#1B2233", links ? 4.4 : 5.2, hy + 1.9, .8, .9);
      blok("#1B2233", links ? 6.2 : 7,   hy + 1.9, .8, .9);
    } else {
      blok(shade(huid, -40), links ? 4.4 : 5.2, hy + 2.1, .8, .4);
      blok(shade(huid, -40), links ? 6.2 : 7,   hy + 2.1, .8, .4);
    }
    /* mond: een blij bedrijf geeft blije gezichten. Dit volgt de welvaart. */
    if (niveau >= 3) {
      blok(shade(huid, -46), 5, hy + .7, 2, .5);
      blok(shade(huid, -46), 4.6, hy + 1, .5, .5);
      blok(shade(huid, -46), 6.9, hy + 1, .5, .5);
    } else if (niveau <= 1){
      blok(shade(huid, -46), 5.1, hy + .8, 1.8, .5);
    } else {
      blok(shade(huid, -46), 5.2, hy + .7, 1.6, .5);
    }

    /* hoe rijker het bedrijf, hoe beter ze erbij lopen */
    if (niveau >= 2 && !zit){
      blok(shade(shirt, -60), 3.4, 6, .8, 5);    /* jasje, linkerpand */
      blok(shade(shirt, -60), 7.8, 6, .8, 5);    /* rechterpand */
    }
    if (niveau >= 3){
      blok(T.gold, 5.7, 7.4, .7, 2.6);           /* das */
      blok(T.gold, 5.5, 10, 1.1, .6);
    }
    if (niveau >= 5){
      blok("#1B2233", 3.4, hy + 4.6, 5.2, .8);   /* hoedje */
      blok("#1B2233", 4.2, hy + 5.2, 3.6, 1);
      blok(T.gold,    3.4, hy + 4.6, 5.2, .3);
    }

    /* statusstip boven het hoofd */
    const kop = oy - (hy + 5.4)*P;
    const stipK = STATUS_COLOR[a.status] || T.idle;
    c.fillStyle = stipK;
    c.fillRect(Math.round(ox + 4.4*P), Math.round(kop - 2.4*P), Math.ceil(2.4*P), Math.ceil(2.4*P));
    if (!flauw) this._lichtBol(ox + 5.6*P, kop - 1.2*P, 3.4*P, stipK, .55);
    if (a.status === "opgepakt" && !this.reduced){
      const puls = .3 + Math.abs(Math.sin(this.t*2.2))*.4;
      this._lichtBol(ox + 5.6*P, kop - 1.2*P, 6*P, stipK, puls);
    }

    c.restore();
    a._kop = kop;      /* onthouden voor de labellaag hierboven */
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

    if (this.hoverAgent === a.id && !gekozen && zoom > .45){
      /* een kaartje bij de muis: naam, wat hij doet, en waar hij hoort */
      const r1 = a.name, r2 = (a.statusTekst || a.status || "") + (a.dept ? " · " + a.dept : "");
      c.font = "600 " + (10.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      const w1 = c.measureText(r1).width;
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      const w2 = c.measureText(r2).width;
      const w = Math.max(w1, w2) + 18*z, hh = 34*z, ly = a._voet + 12*z;
      c.fillStyle = "rgba(9,15,28,.94)";
      c.beginPath(); c.roundRect(s.x - w/2, ly, w, hh, 4*z); c.fill();
      c.strokeStyle = a.color + "88"; c.lineWidth = 1; c.stroke();
      c.fillStyle = a.color; c.fillRect(s.x - w/2, ly, 2*z, hh);
      c.fillStyle = T.text;
      c.font = "600 " + (10.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillText(r1, s.x, ly + 12*z);
      c.fillStyle = T.dim;
      c.font = (9.5*z).toFixed(1) + 'px "IBM Plex Mono",ui-monospace,monospace';
      c.fillText(r2, s.x, ly + 24*z);
    }
  }
}

IsoOffice.NEEDS = NEEDS;
export default IsoOffice;
