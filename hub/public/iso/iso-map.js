/* iso-map.js — de stad als data.
 *
 * Hier verander je de kaart. De motor (iso-office.js) weet niets van deze
 * indeling: hij krijgt tegels, gebouwen en een bezet-raster aangeleverd.
 *
 * Assenstelsel: x loopt naar rechtsonder, y naar linksonder. Tegel 64 x 32.
 * Een gebouw staat op (x, y) en is w breed, d diep en h hoog in schermpixels.
 *
 * De stad is een raster van vier bij vier kavels met straten ertussen. De
 * vier middelste kavels zijn samen het plein: daar staat de toren (de hub
 * zelf) met de overlegzaal, de koffiekiosk en twee bankjes. De twaalf kavels
 * eromheen zijn voor agents — één gebouw per agent. Een kavel zonder agent
 * blijft een lege fundering: zo zie je meteen hoeveel je stad nog kan groeien.
 */
import { THEME } from "./iso-theme.js";

export const TILE = { w: 64, h: 32 };
export const GRID = { w: 21, h: 21 };

const KAVEL = 4;                 /* een kavel is 4 x 4 tegels */
const STRAAT = 1;                /* met een straat van 1 tegel ertussen */
const stap = KAVEL + STRAAT;     /* dus elke 5 tegels begint een nieuw kavel */

/* De vier middelste cellen vormen samen het plein. */
const PLEIN_CEL = new Set(["1,1","2,1","1,2","2,2"]);
export const PLEIN = { x0: 1 + stap, y0: 1 + stap, x1: 1 + 3*stap - 2, y1: 1 + 3*stap - 2 };

/* De twaalf kavels, met de klok mee gelezen: eerst de bovenrij. */
export const KAVELS = [];
for (let cy = 0; cy < 4; cy++){
  for (let cx = 0; cx < 4; cx++){
    if (PLEIN_CEL.has(cx + "," + cy)) continue;
    const x0 = 1 + cx*stap, y0 = 1 + cy*stap;
    const i = KAVELS.length;
    KAVELS.push({
      i, cx, cy, x0, y0, x1: x0 + KAVEL - 1, y1: y0 + KAVEL - 1,
      /* de skyline mag niet vlak zijn: hoogte en vorm variëren per kavel */
      hoog:   [58, 74, 46, 88, 52, 66, 80, 44, 70, 56, 84, 62][i % 12],
      stijl:  [0, 1, 2, 0, 2, 1, 0, 1, 2, 0, 1, 2][i % 12],
      nr: String(101 + i).slice(1)
    });
  }
}

/* Zones. Elk kavel is er één (zodat je een agent erheen kunt sturen), plus
 * het plein en de overlegzaal. */
export const ZONES = KAVELS.map(k => ({
  nr: k.nr, name: "kavel" + k.i, label: "Kavel " + k.nr, kavel: k.i,
  kleur: "#4E6796", floor: (k.i % 2) ? "#16223C" : "#182642",
  x0: k.x0, y0: k.y0, x1: k.x1, y1: k.y1
})).concat([
  /* de zaal staat vóór het plein: zoneOp pakt de eerste die past */
  { nr:"H",  name:"meeting", label:"Overlegzaal", kleur:"#F5C542", floor:"#1B2340",
    x0:6, y0:12, x1:8, y1:14, zaal:true },
  { nr:"00", name:"plein",   label:"Plein",       kleur:"#6BA8F5", floor:"#141F38",
    x0:PLEIN.x0, y0:PLEIN.y0, x1:PLEIN.x1, y1:PLEIN.y1, plein:true }
]);

/* De motor kent alleen "bureaus": de vaste plek van een agent. In de stad is
 * dat de stoep voor zijn eigen deur. Kavel i hoort bij bureau i. */
export const DESKS = KAVELS.map(k => ({ x: k.x0 + 1, y: k.y1, kavel: k.i }));
export const AFDELINGEN = [];

export const stoelVan   = (d) => ({ x: d.x, y: d.y, zit: false });
export const parkeerVan = (d) => ({ x: d.x + 1, y: d.y });
export const bureausVan = () => DESKS.map((d, i) => i);
export const kavelVan   = (i) => KAVELS[i % KAVELS.length];

/* In welke volgorde worden de kavels uitgegeven? Niet 1, 2, 3 — dan staat een
 * klein bedrijf op één rij en botsen de naamborden. Deze volgorde spreidt de
 * eerste agents over de vier hoeken van de stad. */
export const KAVEL_VOLGORDE = [0, 11, 3, 8, 2, 9, 5, 6, 1, 10, 4, 7];

/* Waar agents gaan staan op het plein. zit:true = op een bankje. */
export const SPOTS = {
  meeting: [{x:7,y:15},{x:8,y:15},{x:6,y:15},{x:9,y:14},{x:7,y:11},{x:8,y:11}],
  lounge:  [{x:7,y:7,zit:true},{x:13,y:13,zit:true},{x:8,y:8},{x:12,y:12}],
  coffee:  [{x:13,y:8},{x:12,y:7},{x:14,y:8},{x:13,y:6}],
  archive: [{x:8,y:10},{x:12,y:10},{x:10,y:8},{x:10,y:12}],
  plein:   [{x:10,y:7},{x:7,y:10},{x:13,y:10},{x:10,y:13}]
};

/* Elk kavel heeft een lantaarn op de hoek; op het plein staan er vier. */
export const LAMPEN = KAVELS.map(k => ({ x: k.x1 + .2, y: k.y1 + .2, r: 96, kavel: k.i }))
  .concat([
    { x:7.2,  y:7.2,  r:120 }, { x:13.8, y:7.2,  r:120 },
    { x:7.2,  y:13.8, r:120 }, { x:13.8, y:13.8, r:120 }
  ]);

/* De lijn van elk kavel naar de toren: daar komt het werk samen. De motor
 * tekent hem als gestippelde boog door de lucht. */
export const TOREN = { x: 10.5, y: 10.5, h: 150 };
export const VERBINDINGEN = KAVELS.map(k => ({
  kavel: k.i,
  van: { x: k.x0 + 2, y: k.y0 + 2, h: k.hoog },
  naar: { x: TOREN.x, y: TOREN.y, h: TOREN.h }
}));

/* ---------------------------------------------------------------- */

export function buildMap(){
  const tiles = [];
  const solid = Array.from({ length: GRID.h }, () => new Array(GRID.w).fill(false));
  const props = [];

  for (let y = 0; y < GRID.h; y++){
    for (let x = 0; x < GRID.w; x++){
      const z = zoneOp(x, y);
      let kleur;
      if (z && z.plein)      kleur = (x + y) % 2 ? "#16233F" : "#131E36";
      else if (z)            kleur = z.floor;
      else                   kleur = (x + y) % 2 ? THEME.straatA : THEME.straatB;
      tiles.push({ x, y, zone: z ? z.name : null, kavel: z ? z.kavel : null,
                   straat: !z, color: kleur });
    }
  }

  const blok = (o) => {
    for (let y = Math.floor(o.y); y < Math.ceil(o.y + o.d); y++)
      for (let x = Math.floor(o.x); x < Math.ceil(o.x + o.w); x++)
        if (solid[y] && x >= 0 && x < GRID.w) solid[y][x] = true;
  };
  const zet = (o) => { props.push(o); if (o.solid !== false) blok(o); return o; };

  /* de twaalf kavels: gebouw in het midden, groen en een lantaarn op de hoek */
  for (const k of KAVELS){
    zet({ kind:"gebouw", x:k.x0 + 1, y:k.y0 + 1, w:2, d:2, h:k.hoog,
          kavel:k.i, stijl:k.stijl, bezet:false, kleur:null, druk:0 });
    zet({ kind:"boom",     x:k.x0 + .1,  y:k.y0 + .1,  w:.6, d:.6, h:30, solid:false });
    zet({ kind:"boom",     x:k.x1 + .3,  y:k.y0 + .15, w:.5, d:.5, h:26, solid:false });
    zet({ kind:"boom",     x:k.x0 + .15, y:k.y1 + .3,  w:.5, d:.5, h:24, solid:false });
    zet({ kind:"lantaarn", x:k.x1 + .3,  y:k.y1 + .3,  w:.22, d:.22, h:52, solid:false });
  }

  /* het plein: de toren met de schotel, de overlegzaal, de kiosk, bankjes */
  zet({ kind:"toren", x:9, y:9, w:3, d:3, h:TOREN.h });
  zet({ kind:"hal",   x:6, y:12, w:3, d:2, h:44 });
  zet({ kind:"kiosk", x:13, y:6, w:1.4, d:1, h:34 });
  zet({ kind:"bank",  x:6.6, y:6.6, w:1.2, d:.5, h:14 });
  zet({ kind:"bank",  x:13.2, y:13.4, w:1.2, d:.5, h:14 });
  zet({ kind:"boom",  x:7.2, y:14.2, w:.6, d:.6, h:30, solid:false });
  zet({ kind:"boom",  x:14.1, y:9.2, w:.6, d:.6, h:32, solid:false });
  zet({ kind:"boom",  x:6.1, y:9.2, w:.6, d:.6, h:28, solid:false });
  [[7.2,7.2],[13.8,7.2],[7.2,13.8],[13.8,13.8]].forEach(([x,y]) =>
    zet({ kind:"lantaarn", x, y, w:.22, d:.22, h:60, solid:false }));

  /* het archief staat aan de voet van de toren: elk boekje is een rapport */
  zet({ kind:"kast", x:11.4, y:9.2, w:.5, d:1.4, h:40, slot:0, vol:0, solid:false });
  zet({ kind:"kast", x:8.1,  y:9.2, w:.5, d:1.4, h:40, slot:1, vol:0, solid:false });

  return { tiles, solid, props };
}

/* Is deze tegel begaanbaar? */
export function vrij(solid, x, y){
  return x >= 0 && y >= 0 && x < GRID.w && y < GRID.h && !solid[y][x];
}

/* In welke zone ligt deze tegel? */
export function zoneOp(x, y){
  return ZONES.find(z => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) || null;
}
export function zoneVan(naam){ return ZONES.find(z => z.name === naam) || null; }
export function kavelOp(x, y){
  const z = zoneOp(x, y);
  return z && z.kavel != null ? z.kavel : null;
}
