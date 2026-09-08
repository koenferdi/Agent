```
Project:     Matchdesk v2 — ontwerpsysteem
Fase:        0 (vast te leggen vóór er gecodeerd wordt)
Verdict:     Richting vastgesteld. Eén blokkerend probleem gevonden en opgelost:
             de huidige merkkleur #0D9488 haalt WCAG AA niet als tekst- of knopkleur.
Confidence:  Hoog. Alle contrastverhoudingen hieronder zijn berekend, niet geschat.
             Nog te controleren in de browser met een contrastprikker vóór Fase 2 af is.
Sources:     WCAG 2.1 SC 1.4.3 (tekst 4,5:1) en SC 1.4.11 (interface-onderdelen 3:1).
             Berekend 8 september 2026.
```

# DESIGN.md

## Het idee in één zin

Een technisch werkblad, geen SaaS-pagina: papierwit vlak, haarlijnen in plaats van schaduwen, cijfers in mono, en precies één plek waar iets beweegt.

De brief vraagt om de visuele taal uit het onderwerp te halen — leidingwerk, meterkast, schema's. Dat vertaal ik niet naar plaatjes van ketels. Ik vertaal het naar hoe technische documentatie er uitziet: een licht vlak, dunne lijnen die vlakken begrenzen, meetwaarden in een monospace, en toestanden die je kunt aflezen. Precisie in plaats van sfeer.

---

## 1. Kleur

### Het probleem met de huidige merkkleur

De brief zegt: behoud teal `#0D9488` als anker. Dat kan, maar niet zoals je zou verwachten. Ik heb de contrastverhoudingen uitgerekend:

| Combinatie | Verhouding | WCAG AA |
|---|---|---|
| `#0D9488` op papier `#FBFBF9` | **3,61 : 1** | Zakt voor lopende tekst (4,5:1). Haalt het net voor grote koppen en interface-elementen (3:1) |
| Wit op `#0D9488` als knopvulling | **3,74 : 1** | **Zakt.** Een knop met witte tekst op de merkkleur voldoet niet |

Dat tweede is de vervelende. Een primaire knop in de merkkleur met witte tekst erop is precies wat je normaal zou bouwen, en het is een WCAG-fout. Je zou hem pas ontdekken bij de audit aan het eind van Fase 2, als alles al staat.

### De oplossing

Teal blijft het anker, maar krijgt een andere rol: **grafiek, lijn, accent en grote kop — nooit lopende tekst, nooit knopvulling.** Voor alles wat gedrukt of aangeklikt wordt komt er een donkerder teal bij.

| Token | Hex | Rol | Contrast |
|---|---|---|---|
| `--paper` | `#FBFBF9` | Paginavlak. Warm gebroken wit, geen `#fff` — dat is te hard voor een leesvlak. | — |
| `--ink` | `#10201E` | Alle lopende tekst en koppen. Bijna zwart met een tealzweem, dus het hoort bij het palet zonder dat je het ziet. | **16,25 : 1** op papier |
| `--teal` | `#0D9488` | Anker. Diagramlijnen, accenten, iconen, grote displaykoppen, actieve randen. | 3,61 : 1 — genoeg voor deze rollen |
| `--teal-deep` | `#0B5F58` | Knopvulling, links in tekst, hover- en focustoestand. | **7,52 : 1** met witte tekst |
| `--signal` | `#C2410C` | De enige signaalkleur. Statuslabels, foutmeldingen, "wachtlijst", aandacht. Verbrand oranje, geen rood — het moet opvallen zonder te alarmeren. | **5,00 : 1** op papier |
| `--line` | `#D8DDDB` | Haarlijnen: scheidingen, tabelregels, de rasterstructuur. Decoratief. | — |
| `--line-strong` | `#7E8A87` | **Verplicht apart token.** Randen van formuliervelden, keuzevakjes, alles wat je kunt bedienen. | **3,45 : 1** — haalt SC 1.4.11 met marge |

### Waarom dat er zeven zijn en niet zes

De brief vraagt om vier tot zes benoemde waarden. Het worden er zeven, en dat is geen slordigheid.

`--line` op `#D8DDDB` haalt maar **1,33 : 1** tegen het papier. Als decoratieve scheidingslijn is dat prima en zelfs precies goed — je wilt dat een tabelregel wegvalt. Maar WCAG 1.4.11 eist 3:1 voor de rand van een invoerveld, want anders zie je niet waar je moet klikken. Eén lijnkleur voor beide rollen betekent dus of lelijke tabellen of onbruikbare formulieren.

Twee lijngewichten. Dat is de goedkoopste manier om die twee eisen tegelijk te halen.

### Donkere modus

**Niet doen bij de lancering.** De brief laat de keuze en zegt: alleen als je hem echt goed doet.

Twee redenen om hem over te slaan. Het hele palet leunt op de papiermetafoor, en die keert niet netjes om — je krijgt geen donkere versie maar een ander ontwerp. En het tealprobleem hierboven wordt in het donker erger, niet beter: op een donkere ondergrond moet teal juist lichter, en dan botst hij met de signaalkleur.

Bouw hem na de lancering, met een eigen contrastronde. Half doen is slechter dan niet doen.

---

## 2. Typografie

**IBM Plex Sans** voor alle tekst. **IBM Plex Mono** voor alle getallen en toestanden.

Waarom deze twee. Plex is getekend voor technische documentatie, en dat zie je: het is een grotesque met rechte, meetbare vormen zonder de vriendelijke rondingen die elke SaaS-pagina van de laatste vijf jaar gebruikt. Het is niet Inter. Het staat onder de SIL Open Font License, dus zelf hosten mag.

Het rolverschil dat de brief vraagt zit niet tussen kop en tekst, maar tussen **taal en data**:

- Plex Sans: koppen, alinea's, knoppen, navigatie, labels
- Plex Mono: bedragen, percentages, postcodes, de commissiestaffel, statuslabels, tabelcijfers, de reactietijd, alles in de rekenmodule

Dat is meteen de reden dat het bij het onderwerp past. Een meetwaarde hoort in een monospace, want dan staan de cijfers onder elkaar en kun je kolommen vergelijken. In de rekenmodule, waar naast elkaar twee bedragen staan, is dat geen versiering maar functie.

**Zelf hosten**, WOFF2, gesubset op Latin, `font-display: swap`, preload voor het gewicht dat in de hero staat. Niet via de Google Fonts CDN: dat is een verzoek naar een derde partij met het IP-adres van je bezoeker, en dat wil je niet uitleggen in je privacyverklaring als je verder cookieloos bent.

Twee families, vier bestanden totaal: Sans 400, Sans 600, Mono 400, Mono 500. Meer niet.

### Schaal

Vaste stappen, verhouding 1,25 op mobiel en 1,333 vanaf tablet, met `clamp()` ertussen.

| Rol | Mobiel | Desktop | Regelhoogte |
|---|---|---|---|
| Displaykop (alleen hero) | 34 px | 60 px | 1,05 |
| Sectiekop | 26 px | 38 px | 1,15 |
| Subkop | 20 px | 24 px | 1,25 |
| Lopende tekst | 17 px | 18 px | 1,6 |
| Klein / bijschrift | 14 px | 15 px | 1,5 |
| Mono-data | 15 px | 16 px | 1,4 |

Regellengte maximaal **66 tekens** (`max-width: 66ch`). De brief vraagt onder de 80; 66 leest beter en is de klassieke waarde.

Lopende tekst op 17 px, niet 16. Op een telefoon van 360 px breed scheelt dat merkbaar, en je doelgroep leest dit niet in een rustige kantoorstoel.

---

## 3. Vorm

Wat er niet is, is hier belangrijker dan wat er wel is.

**Geen schaduwen.** Vlakken worden begrensd door een haarlijn van 1 px in `--line`, niet door een zachte schaduw. Dat is het verschil tussen een technische tekening en een dashboardsjabloon.

**Nauwelijks ronding.** 2 px op knoppen en invoervelden, 0 op vlakken en tabellen. Geen `border-radius: 16px`.

**Eén rasterbreedte.** Alles ligt op een raster van 8 px. Afstanden komen uit één reeks: 4, 8, 16, 24, 40, 64, 96. Geen tussenwaarden.

**Toestanden zijn zichtbaar en benoemd.** Een lead is `nieuw`, `gematcht`, `geaccepteerd`, `offerte`, `gewonnen`, `verloren` of `vervallen`. Elke toestand krijgt hetzelfde label: mono, kleine letters, 1 px rand, geen vulling behalve bij de signaalkleur. Zowel in het beheerscherm als op de publieke bevestigingspagina. Dezelfde vorm, overal. Dat is wat "duidelijke states" uit de brief in de praktijk betekent.

**Focus is nooit onzichtbaar.** `outline: 2px solid var(--teal-deep)` met 2 px `outline-offset`, op alles. Nooit `outline: none`, ook niet "omdat het lelijk staat".

---

## 4. Het hero-beeld

Eén sterk visueel idee, één keer, en daarna nooit meer.

**Wat het is.** Een schema in de trant van een eendraadschema uit de elektrotechniek. Links één knooppunt: de aanvraag. Rechts installateurs. Twee toestanden naast elkaar:

- **Links, gedempt:** één lijn waaiert uit naar zes knooppunten. Alle zes grijs. Bij elk een klein mono-label met een kostenstreepje. Dit is hoe het normaal gaat.
- **Rechts, in teal:** één lijn naar één knooppunt. Massief. Eén label: `factuur pas bij gewonnen klus`.

Geen tekst ín het beeld behalve die mono-labels. Geen namen, geen logo's, geen pijlen met een `→`.

**Waarom dit werkt en waarom het snel is.** Het is inline SVG, ongeveer 6 KB, geen enkel netwerkverzoek. Daarmee is je LCP-element er zodra de HTML er is. De doelstelling van LCP onder 1,8 seconde op 4G haal je hiermee zonder trucs — een hero-afbeelding, hoe goed geoptimaliseerd ook, kost je altijd een extra verzoek.

**De juridische randvoorwaarde.** Die zes grijze knooppunten zijn een impliciete uitspraak over hoe anderen werken. Zolang er geen naam, geen logo en geen bedrag bij staat, gaat het over een marktpatroon en niet over een aanwijsbare onderneming, en dat mag. Zet er nooit een logo bij, ook niet klein, ook niet als grap. Zie `RESEARCH.md` §1.

---

## 5. Beweging

Eén georkestreerd moment. Verder niets dat uit zichzelf beweegt.

**Het hero-schema tekent zichzelf**, één keer, ongeveer 1,6 seconde. Eerst tekent de linkerkant zes lijnen tegelijk uit, snel en rommelig. Dan, na een korte stilte, tekent rechts één lijn rustig door. Het verschil zit in het ritme, niet in de snelheid. `stroke-dashoffset`, pure CSS, geen JavaScript.

Speelt één keer af. Niet in een lus. Geen marquee.

**Alles daarbuiten reageert alleen op een handeling.** Hover, focus, het openklappen van een `<details>`, het wisselen van een formulierstap, een cijfer dat in de rekenmodule verspringt. Maximaal 150 ms, `ease-out`.

**`prefers-reduced-motion: reduce`** zet alles uit. Het hero-schema toont dan direct de eindtoestand — geen leeg vlak, geen sprong. De statische versie moet op zichzelf goed zijn; de animatie is een bonus, geen drager.

---

## 6. Wat ik heb weggegooid

De brief vraagt om elk onderdeel te vervangen dat ik ook voor een willekeurige andere SaaS-pagina had gemaakt. Dat is een goede vraag. Wat er is afgevallen:

- **Inter of een geometrische sans met veel gewichten.** Correct, en volstrekt inwisselbaar. Vervangen door Plex, dat uit dezelfde wereld komt als het onderwerp.
- **Kaarten met `border-radius: 16px` en een zachte schaduw, drie naast elkaar.** Dat is de standaardvorm van elke featuresectie sinds 2019. Vervangen door vlakken met een haarlijn. Strenger, en het past bij een werkblad.
- **Een verloopje van teal naar cyaan in de hero.** Dat is decoratie die niets zegt. Vervangen door het schema, dat wél iets zegt.
- **Een teal knop met witte tekst.** Weg omdat hij WCAG niet haalt — en dat is precies de reden dat je dit vooraf uitrekent in plaats van achteraf.
- **Een tellertje bij "gemiddelde reactietijd" dat omhoog telt bij het inscrollen.** Weg. §8 van de brief verbiedt verzonnen cijfers, en er is nog geen data. Als er wel data is, staat het er gewoon, in mono, zonder animatie.
- **Iconenset bij "hoe het werkt".** Weg. Genummerde stappen met een lijn ertussen doen hetzelfde en zijn eerlijker: het is een volgorde, geen verzameling eigenschappen.

---

## 7. Vast te leggen in code

Voordat Fase 2 begint staat dit in `src/styles/tokens.css`, en niets buiten dat bestand definieert een kleur, een afstand of een lettergrootte:

```css
:root {
  --paper:       #FBFBF9;
  --ink:         #10201E;
  --teal:        #0D9488;
  --teal-deep:   #0B5F58;
  --signal:      #C2410C;
  --line:        #D8DDDB;
  --line-strong: #7E8A87;

  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --space-1: 4px;  --space-2: 8px;  --space-3: 16px;
  --space-4: 24px; --space-5: 40px; --space-6: 64px; --space-7: 96px;

  --measure: 66ch;
  --radius: 2px;
}
```

Twee controles die in de definition of done van Fase 2 horen:

1. **Contrast opnieuw meten in de browser**, met een prikker, op de daadwerkelijk gerenderde pagina. De getallen hierboven zijn berekend en kloppen, maar antialiasing en subpixelrendering kunnen een randgeval anders laten uitpakken.
2. **Tabbladen doorlopen met alleen het toetsenbord**, van de skip-link tot de laatste knop in het formulier. Als je ergens de focus kwijtraakt, is het niet af.
