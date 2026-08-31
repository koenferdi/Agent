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

/* Kleur per agent. Dezelfde kleuren als de oude pixelkaart gebruikte,
 * zodat 01 t/m 04 herkenbaar blijven. */
export const AGENT_COLOR = {
  "market-researcher":   "#4FD1C5",
  "customer-researcher": "#F0A860",
  "strategy-analyst":    "#A78BFA",
  "content-creator":     "#6B7A99"
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
