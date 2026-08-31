/* iso-map.js — de plattegrond als data.
 *
 * Hier verander je de vloer. De motor (iso-office.js) weet niets van deze
 * indeling: hij krijgt tegels, meubels en een bezet-raster aangeleverd.
 *
 * Assenstelsel: x loopt naar rechtsonder, y naar linksonder. Tegel 64 x 32.
 * Een meubel staat op (x, y) en is w breed, d diep en h hoog in schermpixels.
 *
 * De indeling volgt de afdelingen uit workflows/capabilities: elke afdeling
 * heeft een eigen kamer met vier bureaus. Onderin de gedeelde ruimtes.
 * Twintig werkplekken, dus er is plek voor een bedrijf van die omvang.
 */
import { THEME } from "./iso-theme.js";

export const TILE = { w: 64, h: 32 };
export const GRID = { w: 23, h: 16 };

/* Kamers. dept:true = afdeling met bureaus. */
export const ZONES = [
  { nr:"01", name:"kennis",    label:"Kennis",     emo:"\u{1F50D}", kleur:"#4FD1C5", floor:"#1B2A4B", x0:0,  y0:0,  x1:6,  y1:3,  dept:true },
  { nr:"02", name:"aanbod",    label:"Aanbod",     emo:"\u{1F4E6}", kleur:"#5FCE9B", floor:"#182C46", x0:8,  y0:0,  x1:14, y1:3,  dept:true },
  { nr:"03", name:"markt",     label:"Markt",      emo:"\u{1F4E3}", kleur:"#E0A458", floor:"#262641", x0:16, y0:0,  x1:22, y1:3,  dept:true },
  { nr:"04", name:"financien", label:"Financien",  emo:"\u{1F4B6}", kleur:"#6BA8F5", floor:"#1A2647", x0:0,  y0:6,  x1:6,  y1:9,  dept:true },
  { nr:"05", name:"operatie",  label:"Operatie",   emo:"⚙",    kleur:"#A78BFA", floor:"#232748", x0:8,  y0:6,  x1:14, y1:9,  dept:true },
  { nr:"06", name:"archive",   label:"Archief",    emo:"\u{1F4DA}", kleur:"#7488AC", floor:"#16283F", x0:16, y0:6,  x1:22, y1:9  },
  { nr:"07", name:"meeting",   label:"Overleg",    emo:"\u{1F5D3}", kleur:"#7488AC", floor:"#262A55", x0:0,  y0:12, x1:6,  y1:15 },
  { nr:"08", name:"lounge",    label:"Lounge",     emo:"\u{1F6CB}", kleur:"#9A6BE0", floor:"#2B2750", x0:8,  y0:12, x1:14, y1:15 },
  { nr:"09", name:"coffee",    label:"Koffie",     emo:"☕",    kleur:"#C9A227", floor:"#302C46", x0:16, y0:12, x1:22, y1:15 }
];

export const AFDELINGEN = ZONES.filter(z => z.dept).map(z => z.name);

/* Vier bureaus per afdelingskamer. Een agent zit op (x+1, y+1). */
export const DESKS = [];
ZONES.filter(z => z.dept).forEach(z => {
  [[1,0],[4,0],[1,2],[4,2]].forEach(([dx,dy]) => {
    DESKS.push({ x: z.x0 + dx, y: z.y0 + dy, dept: z.name });
  });
});
export const stoelVan = (d) => ({ x: d.x + 1, y: d.y + 1, zit: true });
export const parkeerVan = (d) => ({ x: d.x + 2, y: d.y + 1 });
export const bureausVan = (dept) => DESKS.map((d,i) => ({ d, i })).filter(o => o.d.dept === dept).map(o => o.i);

/* Waar agents gaan staan of zitten in de gedeelde ruimtes. zit:true = onderuit. */
export const SPOTS = {
  coffee:  [{x:17,y:14},{x:18,y:14},{x:19,y:13},{x:21,y:13}],
  meeting: [{x:1,y:12},{x:2,y:12},{x:3,y:12},{x:5,y:13},{x:1,y:15},{x:3,y:15}],
  lounge:  [{x:9,y:13,zit:true},{x:11,y:13,zit:true},{x:8,y:15},{x:12,y:14}],
  archive: [{x:16,y:9},{x:19,y:9},{x:20,y:8},{x:17,y:7}]
};

/* Kabelgoten door de gangen. Ze lopen van elke afdelingskamer naar het
 * archief: daar komt het werk uiteindelijk terecht. Er loopt alleen licht
 * doorheen als die afdeling bemand is. */
export const KABELS = [
  { dept:"kennis",    punten:[{x:3,y:4},{x:3,y:5},{x:15,y:5},{x:15,y:8},{x:16.2,y:8}] },
  { dept:"aanbod",    punten:[{x:11,y:4},{x:11,y:5},{x:15,y:5},{x:15,y:8},{x:16.2,y:8}] },
  { dept:"markt",     punten:[{x:19,y:4},{x:19,y:5},{x:15,y:5},{x:15,y:8},{x:16.2,y:8}] },
  { dept:"financien", punten:[{x:6.6,y:8},{x:7,y:8},{x:7,y:5},{x:15,y:5},{x:15,y:8},{x:16.2,y:8}] },
  { dept:"operatie",  punten:[{x:14.6,y:8},{x:15,y:8},{x:16.2,y:8}] }
];

/* Lichtplekken boven elk bureau. */
export const LAMPEN = DESKS.map(d => ({ x: d.x + 0.9, y: d.y + 0.5, r: 92 }));

/* ---------------------------------------------------------------- */

export function buildMap(){
  const tiles = [];
  const solid = Array.from({ length: GRID.h }, () => new Array(GRID.w).fill(false));
  const props = [];

  for (let y = 0; y < GRID.h; y++){
    for (let x = 0; x < GRID.w; x++){
      const z = zoneOp(x, y);
      tiles.push({
        x, y,
        zone: z ? z.name : null,
        color: z ? z.floor : ((x + y) % 2 ? THEME.floorA : THEME.floorB)
      });
    }
  }

  const blok = (o) => {
    for (let y = Math.floor(o.y); y < Math.ceil(o.y + o.d); y++)
      for (let x = Math.floor(o.x); x < Math.ceil(o.x + o.w); x++)
        if (solid[y] && x >= 0 && x < GRID.w) solid[y][x] = true;
  };
  const zet = (o) => { props.push(o); if (o.solid !== false) blok(o); };

  /* achterwanden: liggen buiten het raster en blokkeren dus niets */
  for (let x = 0; x < GRID.w; x++) zet({ kind:"wall", x, y:-1, w:1, d:.22, h:66, solid:false });
  for (let y = 0; y < GRID.h; y++) zet({ kind:"wall", x:-1, y, w:.22, d:1, h:66, solid:false });

  /* afdelingskamers: bureaus, kastjes, opdrachtenbord, plant */
  ZONES.filter(z => z.dept).forEach(z => {
    DESKS.forEach((d, i) => {
      if (d.dept !== z.name) return;
      zet({ kind:"desk",   x:d.x, y:d.y, w:1.8, d:.9, h:22, ix:i });
      zet({ kind:"kastje", x:d.x + 1.95, y:d.y + .1, w:.5, d:.6, h:30, solid:false });
    });
    zet({ kind:"bord", x:z.x0, y:z.y0 + .5, w:.14, d:1.2, h:44, dept:z.name, kleur:z.kleur, live:0, totaal:0 });
    zet({ kind:"plantje", x:z.x1, y:z.y0 + 3.1, w:.6, d:.6, h:36 });
  });

  /* overleg */
  zet({ kind:"table", x:1.6, y:13.2, w:2.8, d:1.5, h:20 });
  zet({ kind:"board", x:0,   y:12.6, w:.14, d:2,   h:46 });

  /* lounge */
  zet({ kind:"sofa",       x:8.4,  y:13.2, w:1.4, d:.8, h:18 });
  zet({ kind:"sofa",       x:10.6, y:13.2, w:1.4, d:.8, h:18 });
  zet({ kind:"salontafel", x:9.9,  y:14.4, w:.9,  d:.6, h:12 });
  zet({ kind:"plantje",    x:13.4, y:15.1, w:.7,  d:.7, h:38 });

  /* koffie */
  zet({ kind:"counter", x:16.2, y:12.2, w:2.6, d:.6, h:26 });
  zet({ kind:"machine", x:16.4, y:12.1, w:.6,  d:.5, h:40, solid:false });
  zet({ kind:"salontafel", x:20.4, y:14.4, w:1,  d:.6, h:14 });

  /* archief: elk boekje op de kasten is een rapport in drafts/ */
  zet({ kind:"kast", x:16.2, y:6.2, w:1.6, d:.5,  h:44, slot:0, vol:0 });
  zet({ kind:"kast", x:18.4, y:6.2, w:1.6, d:.5,  h:44, slot:1, vol:0 });
  zet({ kind:"kast", x:21.5, y:6.3, w:.6,  d:1.5, h:52, slot:2, vol:0 });
  zet({ kind:"salontafel", x:17, y:8.4, w:1.2, d:.5, h:14 });

  /* glazen scheidingswanden tussen de banden, met deuropeningen.
   * De gangen op x = 7 en x = 15 blijven open, zo kun je overal komen. */
  const deuren = new Set([3, 7, 11, 15, 19]);
  [4, 10].forEach(y => {
    for (let x = 0; x < GRID.w; x++)
      if (!deuren.has(x)) zet({ kind:"glass", x, y: y + .5, w:1, d:.12, h:42 });
  });

  return { tiles, solid, props };
}

/* Is deze tegel begaanbaar? */
export function vrij(solid, x, y){
  return x >= 0 && y >= 0 && x < GRID.w && y < GRID.h && !solid[y][x];
}

/* In welke kamer ligt deze tegel? */
export function zoneOp(x, y){
  return ZONES.find(z => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) || null;
}
export function zoneVan(naam){ return ZONES.find(z => z.name === naam) || null; }
