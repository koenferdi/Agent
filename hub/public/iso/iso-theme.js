/* iso-theme.js — het palet van de vloer.
 * Zelfde blauw als de rest van de hub: de waarden komen één op één uit
 * hub/public/style.css (:root). Wijzig je daar iets, wijzig het hier ook.
 */
export const THEME = {
  /* achtergrond en vloer */
  bg:        "#0B1220",   /* --night   */
  floorA:    "#1B2745",   /* schaakbord licht */
  floorB:    "#17203A",   /* schaakbord donker */
  floorMeet: "#262A55",   /* overleg: paarsblauw */
  floorLoun: "#2B2750",   /* lounge:  paars      */
  floorCafe: "#302C46",   /* koffie:  warm       */
  floorArch: "#162C46",   /* archief: diep blauw */

  /* constructie */
  grid:   "rgba(120,160,230,.08)",
  wall:   "#202C4A",      /* iets lichter dan --panel */
  glass:  "#5E7FC0",
  paneel: "#151F35",      /* --panel   */
  lijn:   "#38496B",      /* --line-2  */

  /* de stad: straat, kavel, gebouw */
  straatA:  "#101B31",    /* asfalt, schaakbord licht */
  straatB:  "#0D1729",    /* asfalt, schaakbord donker */
  stoep:    "#1D2C4C",    /* de rand van een kavel */
  gebouw:   "#23406E",    /* de romp van een gebouw */
  gebouwDak:"#2C4E86",
  gebouwLeeg:"#182642",   /* een kavel zonder agent */
  raamAan:  "#FFC46B",    /* verlicht raam: er wordt gewerkt */
  raamKoel: "#7FD8FF",    /* verlicht raam, koud: staat aan maar wacht */
  raamUit:  "#2B4674",
  groen:    "#2F8367",
  stam:     "#3A2E24",
  paal:     "#39496B",
  lamplicht:"#9EC2FF",
  grondgloed:"#B93AE0",   /* de magenta gloed onder de stad, uit het voorbeeld */

  /* meubels */
  bureau:      "#3C4E78",
  kastje:      "#2E3A58",
  tafel:       "#474C77",
  salontafel:  "#3F4568",
  bank:        "#514A7C",
  bord:        "#AFBBD0",
  toonbank:    "#4A4265",
  machine:     "#7C89B4",
  boekenkast:  "#32405F",
  plantpot:    "#4A3B2E",
  blad:        "#3E8B6E",

  /* status — exact de statuskleuren van de hub */
  gold:  "#F5C542",       /* --gold : selectie          */
  ok:    "#5FCE9B",       /* --ok   : rapport klaar     */
  wait:  "#F0B454",       /* --wait : wacht op Claude   */
  busy:  "#6BA8F5",       /* --busy : Claude is bezig   */
  idle:  "#5A6982",       /* --idle                     */

  /* tekst */
  text: "#E8EDF7",        /* --ink      */
  soft: "#9BA9C4",        /* --ink-soft */
  dim:  "#6B7A99"         /* --ink-faint*/
};

/* Kleur per agent — één identiteit, overal dezelfde: op de vloer, in de
 * sterrenkaart en in de grafieken.
 *
 * Deze vier zijn geen smaakkeuze. Ze zijn gecontroleerd tegen de donkere
 * ondergrond (#0D1526) op lichtheid, verzadiging, onderling verschil bij
 * kleurenblindheid en contrast. De vorige set zakte: te licht, en het grijs
 * las als grijs. Wijzig je ze, draai dan de controle opnieuw. */
export const AGENT_COLOR = {
  "market-researcher":   "#26A697",   /* teal   */
  "customer-researcher": "#C9832F",   /* amber  */
  "strategy-analyst":    "#8465DC",   /* paars  */
  "content-creator":     "#CC5A86"    /* roze   */
};

/* Op de vloer staan de figuren in een donkere ruimte; daar mogen ze een
 * stap lichter, anders verdwijnen ze in het meubilair. */
export const AGENT_COLOR_VLOER = {
  "market-researcher":   "#3FC5B4",
  "customer-researcher": "#E5A04A",
  "strategy-analyst":    "#9D82EE",
  "content-creator":     "#E2749E"
};

/* Kleur van de statusstip boven een agent. */
export const STATUS_COLOR = {
  idle:       THEME.idle,
  nieuw:      THEME.wait,
  opgepakt:   THEME.busy,
  geleverd:   THEME.ok,
  geparkeerd: THEME.idle,
  offphase:   THEME.idle
};

/* ---------- thema's voor de stad ----------
 *
 * Eén set kleuren omzetten verandert het hele beeld. De basis blijft THEME;
 * een thema legt daar een paar waarden overheen. Zo blijft er maar één
 * plek waar een kleur echt vandaan komt.
 *
 * gloed = de kleur onder de stad (r,g,b). raam = het licht in de ramen als
 * er gewerkt wordt. lucht = de achtergrond.
 */
export const THEMAS = [
  {
    id: "nacht", naam: "Nacht", kort: "Diepblauw met magenta grond. De standaard.",
    over: {}, gloed: [185, 58, 224]
  },
  {
    id: "avond", naam: "Avond", kort: "Warmer, zachter, meer lamplicht dan neon.",
    over: {
      bg:"#120E1C", straatA:"#1B1626", straatB:"#161221", stoep:"#2A2033",
      gebouw:"#33294A", gebouwDak:"#413357", gebouwLeeg:"#241C33",
      raamAan:"#FFCE86", raamKoel:"#FFB27A", raamUit:"#3A2E4C",
      groen:"#3B7A5E", lamplicht:"#FFD9A0", grid:"rgba(255,200,150,.06)"
    },
    gloed: [235, 120, 70]
  },
  {
    id: "dag", naam: "Dag", kort: "Licht en rustig. Voor overdag werken.",
    over: {
      bg:"#101A2B", straatA:"#26344F", straatB:"#223049", stoep:"#33456A",
      gebouw:"#3E5885", gebouwDak:"#4C6B9E", gebouwLeeg:"#2B3A58",
      raamAan:"#FFE3A8", raamKoel:"#CFE6FF", raamUit:"#51698F",
      groen:"#4A9E77", lamplicht:"#DCE9FF", grid:"rgba(180,210,255,.10)",
      text:"#F2F6FF"
    },
    gloed: [90, 150, 235]
  },
  {
    id: "neon", naam: "Neon", kort: "Hard cyaan en roze. Het felst van de vier.",
    over: {
      bg:"#070A1A", straatA:"#0C1330", straatB:"#0A1029", stoep:"#152047",
      gebouw:"#182A63", gebouwDak:"#20387E", gebouwLeeg:"#111B3E",
      raamAan:"#FF61C8", raamKoel:"#4DF0FF", raamUit:"#1E2E68",
      groen:"#22A88C", lamplicht:"#8CF6FF", grid:"rgba(120,255,255,.09)"
    },
    gloed: [255, 40, 190]
  }
];

export function themaVan(id){
  return THEMAS.find(t => t.id === id) || THEMAS[0];
}
