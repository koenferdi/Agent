# AI-dossier

Context voor Claude Code. Lees dit voordat je iets wijzigt.

## Wat dit is

Een Nederlandstalige zelfscan plus documentgenerator voor artikel 4 van de EU AI-verordening
(Verordening (EU) 2024/1689). Bezoekers doen een gratis scan van negen vragen, zien welke stukken
ontbreken in hun compliancedossier, en kopen voor € 149 een pakket van vijf documenten dat op basis
van hun antwoorden wordt gegenereerd.

**Doelgroep:** eigenaren en kantoormanagers van Nederlandse en Vlaamse mkb-bedrijven, 5 tot 50
medewerkers, niet technisch, weinig geduld, wel bezorgd over een boete.

**Waarom dit werkt:** artikel 4 is bindend sinds 2 februari 2025 en de handhaving is op
2 augustus 2026 begonnen. De verplichting raakt vrijwel elke organisatie die AI gebruikt, en de
meeste mkb'ers hebben het nog niet op de radar. De vraag komt dus uit de wet, niet uit marketing.
Het verkoopkanaal is organisch zoekverkeer op termen als "AI Act mkb verplicht" en
"AI-geletterdheid verplicht".

## Techniek

Statische site. Geen framework, geen bouwstap nodig, geen backend, geen database.

```
index.html          structuur, plus de FAQPage-structured-data
assets/styles.css   ontwerpsysteem, animaties en de printregels voor de documenten
assets/app.js       scanlogica, documentgeneratie, animatiesturing
robots.txt          verwijst naar de sitemap — domein is nog een plaatshouder
sitemap.xml         idem
build.sh            bakt alles in dist/index.html (alleen voor preview/delen)
package.sh          maakt een uploadklaar pakket met je domein er al in
deploy/             nginx-serverblok, installeerscript en de hostinghandleiding
```

Deploy: upload `index.html` + `assets/` naar Cloudflare Pages of Netlify. Klaar.
Eigen server: `./package.sh <domein>`, dan `deploy/HOSTEN.md` volgen.

**Alle verwerking gebeurt in de browser van de bezoeker.** Er gaat geen bedrijfsinformatie naar een
server. Dat is een verkoopargument én een privacybelofte — breek het niet zonder het op de site aan
te passen.

### Configuratie

Bovenaan `assets/app.js` staat een `CONFIG`-object met vier waarden: `PAY_URL`, `UNLOCK_TOKEN`,
`BACKUP_CODES`, `LEAD_ENDPOINT`. Verder nergens hardgecodeerde sleutels.

Ontgrendeling werkt via de succes-URL van Stripe: `https://site.nl/?ok=<UNLOCK_TOKEN>`.
Dat is bewust geen echte beveiliging — wie de link doorstuurt geeft toegang weg. Voor een
zakelijk product van € 149 is dat een acceptabele afweging. Bouw je ooit echte verificatie,
dan is daar een backend voor nodig (zie routekaart).

## Ontwerpsysteem

Tokens staan in `:root` in `styles.css`. Gebruik ze, voeg geen losse hexwaarden toe.

- **Merkkleur** `--brand: #0F5C46`, diep groen. Leest in Europa als betrouwbaar-institutioneel.
- **Rood** `--alert` uitsluitend voor bevindingen en hiaten, nooit decoratief.
- **Oranje** `--warn` voor de urgentiebadge en middelhoog risico. **Blauw** `--blue` voor neutrale labels.
- **Letters:** systeemstack voor alles, Source Serif 4 voor koppen met Georgia als terugval.
  Het ontwerp moet volledig overeind blijven als Google Fonts niet laadt. Test dat.
- **Vorm:** afgeronde hoeken (9–20px), zachte schaduwen. Geen harde offset-schaduwen, geen rechte
  hoeken — dat is eerder geprobeerd en het las als onafgemaakt.

### Animatie

Eén georkestreerd moment plus functionele micro-interacties. Niet meer.

1. **Kop bij het laden:** elementen komen na elkaar omhoog (`[data-anim]`, 60–530ms).
2. **De stapel documenten wordt gedeeld** als speelkaarten (`.pg`, `@keyframes deal`), daarna
   landt op 1450ms de stempel ONTBREEKT (`@keyframes thud`). Dit is het beeldmerk van de pagina.
3. **Dagenteller** loopt op zodra hij in beeld komt. Het getal is echt: dagen sinds 02-02-2025.
4. **Scrollonthulling** via IntersectionObserver, `.reveal` → `.reveal.in`.
5. **Scan:** vragen schuiven zijwaarts, antwoorden komen gestaffeld binnen.
6. **Uitkomst:** score springt op, hiaten komen gestaffeld binnen.

`prefers-reduced-motion` schakelt alles uit en toont de eindtoestand. Breek dat niet.

## Regels waar je je aan houdt

Deze zijn niet onderhandelbaar. Ze beschermen de klant én de eigenaar tegen aansprakelijkheid.

1. **Nooit beweren dat dit een certificaat of officiële certificering is.** Die bestaat niet voor
   artikel 4. De site zegt dat expliciet in de FAQ en dat moet zo blijven.
2. **Nooit vrijwaring van boetes beloven.** De eerlijke "nee" in de FAQ is een verkoopargument, geen zwakte.
3. **Geen juridisch advies.** De documenten zijn concepten die de klant zelf vaststelt en ondertekent.
4. **Risico-indicaties zijn indicaties.** Nooit presenteren als classificatie in de zin van de verordening.
5. **Elke juridische bewering krijgt een datum.** Onderaan de pagina staat "Inhoud gecontroleerd op ...".
   Werk je aan de wetteksten, werk die datum dan bij. De regelgeving beweegt.
6. **Copy is Nederlands**, geen Engelse leenwoorden waar een Nederlands woord bestaat.
   Aanspreekvorm: je/jij. Nuchter, geen uitroeptekens, geen overdrijving.
7. **Geen browseropslag** (localStorage, cookies) zonder dat de privacytekst wordt aangepast.
8. **De structured data volgt de zichtbare FAQ.** In `index.html` staan de veelgestelde vragen ook
   als `application/ld+json`. Wijzig je een vraag of antwoord, wijzig dan beide — uit elkaar
   lopende antwoorden zijn tegenover Google misleidend en tegenover de klant slordig.

## Stand van de regelgeving (per 28-08-2026)

- Artikel 4 (AI-geletterdheid): bindend sinds 02-02-2025. Geen voorgeschreven cursus, urenaantal of
  certificaat. Vereist zijn *passende maatregelen* naar rol en risico, plus aantoonbaarheid.
- Handhaving door nationale toezichthouders: gestart 02-08-2026. NL: Autoriteit Persoonsgegevens
  samen met de Rijksinspectie Digitale Infrastructuur. BE: FOD Economie.
- Artikel 50 (transparantie bij chatbots en AI-content): geldt sinds 02-08-2026.
- Digital Omnibus, Verordening (EU) 2026/1744: hoogrisico-verplichtingen verschoven naar
  02-12-2027 (bijlage III) en 02-08-2028 (bijlage I). Artikel 4 en 50 zijn *niet* uitgesteld.
- Boetes artikel 99: middencategorie tot € 15 mln of 3% van de wereldwijde jaaromzet; voor mkb
  geldt het laagste van de twee.

Controleer dit opnieuw voordat je de teksten aanpast. Deze stand is een momentopname.

## Routekaart

**Eerst, voor de eerste euro binnenkomt**
- [ ] `CONFIG.PAY_URL` vullen met een echte Stripe-betaallink van € 149
- [ ] Stripe succes-URL instellen op `https://<domein>/?ok=<UNLOCK_TOKEN>`
- [x] `UNLOCK_TOKEN` vervangen door iets lang en willekeurigs
- [ ] `LEAD_ENDPOINT` koppelen aan Formspree of Web3Forms
- [ ] Domein registreren en op Cloudflare Pages zetten, of zelf hosten via `deploy/HOSTEN.md`
- [x] Layout getest op 320–768px en met Google Fonts geblokkeerd (headless Chromium);
      kijken op een echt toestel staat nog open

**Daarna, om gevonden te worden**
- [ ] Vier tot zes artikelen die op zoekvragen mikken: "AI Act mkb verplicht",
      "AI-geletterdheid verplicht", "AI-beleid voorbeeld", "valt mijn bedrijf onder de AI Act"
- [x] Structured data (FAQPage) op de veelgestelde vragen
- [x] sitemap.xml en robots.txt — domein nog invullen
- [ ] Vlaamse variant van de teksten; België loopt voor op Nederland met handhaving

**Later, als er omzet is**
- [ ] Echte betaalverificatie via een Cloudflare Worker die de Stripe-sessie controleert
- [ ] Wederverkoopmodel voor boekhouders en accountantskantoren — die hebben honderden
      mkb-klanten met precies dit gat, en dat is waarschijnlijk een groter kanaal dan zoekverkeer
- [ ] Herzieningsmail na twaalf maanden, met een tweede verkoopmoment
- [ ] Engelstalige versie van de documenten voor bedrijven met internationaal personeel

## Wat je niet moet doen

- Geen React, Vue of bouwstap toevoegen. De eenvoud is de reden dat dit onderhoudbaar blijft.
- De pagina niet volplempen met extra animaties. Er is één beeldmerk-moment; meer maakt het goedkoper.
- Geen tracking of advertentiepixels toevoegen zonder de privacybelofte aan te passen.
- Geen prijsverhoging zonder dat het pakket aantoonbaar meer doet.
