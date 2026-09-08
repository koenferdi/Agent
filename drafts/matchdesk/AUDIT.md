```
Project:     Matchdesk v2 (getmatchdesk.nl) — 1:1 leadmatching voor HVAC-installateurs NL
Fase:        0 — Audit en plan
Verdict:     Fase 0 is niet volledig af te ronden. Drie van de vijf onderdelen vereisen
             toegang tot de Matchdesk-repo en de live site; die heeft deze sessie niet.
             Wat zonder die toegang kon, is af. Twee bevindingen blokkeren Fase 1
             ongeacht die toegang: de commissiestaffel en de vergelijkingstabel.
Confidence:  Hoog op de technische analyse en het voorstel (§5-§7)
             Hoog op de juridische bevindingen (ACM-zaak, telemarketing per 1-7-2026)
             Laag op alle concurrentiecijfers — zie RESEARCH.md
             Geen op de repo-, Lighthouse- en security-baseline — niet uitgevoerd
Sources:     8 zoekslagen. Geen enkele primaire bron kon geopend worden (egress-blokkade).
             Volledige bronverantwoording in RESEARCH.md. Geraadpleegd 8 september 2026.
```

# Fase 0 — Audit en plan

## Waar dit op stukloopt

Ik zit in de repo `koenferdi/Agent`. De Matchdesk-repo is hier niet aangekoppeld, en `getmatchdesk.nl` en `getmatchdesk.pages.dev` zijn allebei geblokkeerd door de netwerkpolicy van deze omgeving. Ik heb het geprobeerd, beide gaven een 403 op de proxy.

Dat betekent concreet: ik kan onderdeel 1 (repo-inventaris), 2 (Lighthouse) en 3 (security-headers) van Fase 0 niet doen. Niet "half", niet "bij benadering" — helemaal niet. Ik ga geen audit schrijven van een repo die ik niet heb gezien; dan lever ik fictie in een bestand dat er officieel uitziet, en daar heb je later niets aan.

Wat ik wél heb gedaan:

| Fase 0-onderdeel | Status |
|---|---|
| 1. Repo-inventaris | Geblokkeerd — zie §1 voor wat ik nodig heb |
| 2. Lighthouse-baseline | Geblokkeerd — zie §2 voor hoe je hem zelf in tien minuten hebt |
| 3. Security-baseline | Geblokkeerd — zie §3 voor de checklist |
| 4. Copy-risico's | **Af** — en het is ernstiger dan de brief aanneemt (§4) |
| 5. Voorstel: stack, datamodel, secties | **Af** (§5, §6, §7) |
| `RESEARCH.md` | **Af**, met een harde waarschuwing over bronkwaliteit |
| `DESIGN.md` | **Af**, inclusief een WCAG-probleem in de huidige merkkleur |

Twee dingen die je moet weten voordat je verder leest, want ze veranderen de opdracht:

**Eén.** De vergelijkingstabel met concurrenten bij naam is in deze vorm niet publiceerbaar. Elke bron die ik voor die tabel kon vinden is marketingmateriaal van een concurrent. Details in §4 en in `RESEARCH.md`.

**Twee.** 20–30% commissie op dealwaarde is in deze branche waarschijnlijk niet verkoopbaar. De gemiddelde nettowinstmarge in installatie van verwarmings- en luchtbehandelingsapparatuur ligt rond de 11%. Je vraagt dan twee tot drie keer de volledige nettowinst van de klus. Zie §8.

---

## 1. Repo-inventaris — wat ik nodig heb

Ik heb dit nodig om dit onderdeel af te maken. In volgorde van bruikbaarheid:

1. **De Matchdesk-repo aankoppelen aan deze sessie.** Dat is de schone oplossing. Dan doe ik de volledige inventaris: bestandslijst, regels inline CSS/JS geteld, waar beide formulieren naartoe posten, wat `claim.html` precies doet, en een `git log -p` grep op achtergebleven keys en endpoints.
2. Kan dat niet: **zip de repo en zet hem in `/resources`.** Werkt net zo goed.
3. Ook dat niet: **`getmatchdesk.nl` op de allowlist van de netwerkpolicy.** Dan haal ik in elk geval de gepubliceerde HTML op en kan ik §1 grotendeels en §3 volledig doen.

Eén observatie die ik wel kan maken, want ik ben hem tegengekomen toen ik naar de Matchdesk-repo zocht: in `koenferdi/Site` staat **ThuisBatterijMatch**. Dat is architectonisch bijna hetzelfde product — 1-op-1 matching, postcode naar regio, één actieve match per lead afgedwongen op databaseniveau, installateursportaal, beheerscherm, commissie pas bij boeking. Alleen de branche verschilt.

Als dat draaiende code is, is de matching-engine en het datamodel daarvan het overwegen waard als vertrekpunt voor Matchdesk. Dat scheelt mogelijk een halve fase. Ik heb het niet kunnen beoordelen: in die repo zijn alleen de configuratiebestanden ingecheckt, de `src/` staat er niet in. Laat het me weten als je wilt dat ik ernaar kijk — dan heb ik de volledige repo nodig.

---

## 2. Lighthouse-baseline — zelf te doen in tien minuten

Ik kan de site niet bereiken, dus je hebt twee opties.

**Snelste:** open `getmatchdesk.nl` in Chrome, F12, tabblad Lighthouse, modus "Navigation", apparaat "Mobile", alle vier de categorieën aan, draaien. Herhaal met "Desktop". Exporteer allebei als JSON en zet ze in `/resources`. Dan verwerk ik ze.

**Beter, want het is meteen je CI-baseline:**

```bash
npx lighthouse https://getmatchdesk.nl \
  --preset=desktop --output=json --output-path=./lh-desktop.json
npx lighthouse https://getmatchdesk.nl \
  --form-factor=mobile --throttling.cpuSlowdownMultiplier=4 \
  --output=json --output-path=./lh-mobile.json
```

Noteer in elk geval: performance / a11y / best-practices / SEO, plus LCP, CLS, INP, en totale JS- en CSS-bytes. Dat laatste vind je in het rapport onder "Network payloads".

Eén ding vast, want het is zeker: de doelstelling uit §7 van de brief — mobiel ≥ 95 op alle vier de assen — geldt voor de publieke pagina's. Niet voor `/admin`. Een beheerscherm met tabellen, filters en een datepicker haalt die score niet, en het hoort dat ook niet te proberen. Ik zet dat zo in de definition of done.

---

## 3. Security-baseline — de checklist die je zelf kunt draaien

Zonder toegang tot de responses kan ik hier niets vaststellen. Wat je zelf kunt doen:

```bash
curl -sSI https://getmatchdesk.nl | sort
```

Loop deze langs. Op een kale Cloudflare Pages-deploy zonder `_headers` ontbreken ze vrijwel zeker allemaal:

- `Content-Security-Policy` — vrijwel zeker afwezig
- `Strict-Transport-Security` — Cloudflare zet deze niet automatisch
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options` of `frame-ancestors` in de CSP

Draai daarnaast `securityheaders.com` op het domein voor een leesbaar cijfer, en bekijk de broncode op:

- e-mailadressen en telefoonnummers letterlijk in de HTML (spamoogst)
- een form-endpoint van een externe dienst (Formspree, Getform, Basin) met de key in het `action`-attribuut — die key is dan publiek en moet geroteerd
- Google Fonts, Google Analytics of een pixel — allemaal AVG-relevant en allemaal in strijd met de cookieloze aanpak uit §2 van de brief
- een Cloudflare-, Resend- of Airtable-key in een inline script

En dit hoe dan ook, ongeacht wat je vindt:

```bash
git log -p --all | grep -iE "api[_-]?key|secret|token|bearer|password" | head -50
```

Alles wat daar bovenkomt is gecompromitteerd, ook als het bestand later is verwijderd. Roteren, niet alleen weghalen.

---

## 4. Copy-risico's — dit is het belangrijkste onderdeel van deze audit

Ik kan de copy op de huidige site niet lezen. Maar ik kan wel de claims beoordelen die de **brief zelf** wil publiceren, en daar zit het probleem.

### 4.1 De vergelijkingstabel kan zo niet live

De brief zegt in §2: geen claim over Homedeal, Werkspot, Solvari of Warmtepomp.nu zonder bronvermelding en datum. Terecht. Art. 6:194a BW vereist dat elke bewering over een concurrent objectief, actueel en controleerbaar is.

Ik heb geprobeerd die bronnen te vinden. Resultaat:

**De cijfers in de tabel zijn niet te staven.** Bijna elke vindbare bron over de tarieven van deze partijen is een blogpagina van een concurrent die zichzelf als alternatief aanbiedt — klussendirect.nl, prijsinzicht.nl, klusio.nl, yobuz.be, gigaleads.nl. Dat is marketingmateriaal. Als bewijs in een reclamegeschil is het waardeloos, en het is precies de bron die de tegenpartij als eerste onderuit haalt.

**Eén claim in de tabel is waarschijnlijk gewoon onjuist.** De tabel zegt: Werkspot = abonnement + kosten per lead. De vakpers meldde in 2018 dat Werkspot juist gestópt is met betaalde abonnementen en overging op betalen bij contact. Tegelijk noemt een concurrentblog uit 2026 bedragen van €29,95 en €49,95 per maand. Die twee kunnen niet allebei kloppen. Ik heb geen van beide kunnen verifiëren bij Werkspot zelf.

Als je een verkeerd verdienmodel van een concurrent op je homepage zet, is dat geen slordigheid maar een misleidende vergelijkende reclame-uiting waar die concurrent je op kan aanspreken.

**Mijn advies: haal de tabel met namen uit de lancering.** Niet afzwakken, weghalen. Vervang hem door twee dingen die sterker werken én geen enkel risico dragen:

1. Een uitleg van hoe leadplatforms in het algemeen werken — vooraf betalen, gedeelde aanvraag, kosten los van resultaat. Geen naam, geen bedrag, alleen het mechanisme. Dat mag, want het gaat over een marktpatroon en niet over een aanwijsbare onderneming.
2. De rekenmodule, waarin de installateur **zijn eigen** huidige kosten invult. Dan komt het cijfer van hem, niet van jou. Juridisch draag je er niets voor, en overtuigend is het meer: mensen geloven hun eigen invoer.

Wil je de tabel later terug, dan is dat een apart traject: per partij het actuele, openbaar gepubliceerde tarief van hun eigen site, met screenshot en datum, en een kwartaalcontrole. Dat is werk, niet iets wat je er even bij doet. Zet het niet in Fase 2.

### 4.2 De conversieclaim is ook niet te onderbouwen

De brief zegt in §1: gedeelde leads converteren op enkele procenten, exclusieve afspraken vele malen hoger, en noemt dat het hardste argument.

Elke bron die ik daarvoor vond, verkoopt exclusieve leads. Ik kwam getallen tegen als "5,1% versus 58%". Dat is geen onderzoek, dat is een verkooppagina.

Gevolg voor de bouw, en dit is een harde ontwerpregel voor de rekenmodule in §4 sectie 5 van de brief:

> De rekenmodule mag nergens aannemen dat Matchdesk beter converteert. Hij vergelijkt kostenstructuur, niet conversie. De installateur vult zijn eigen conversiepercentage in, en dat percentage wordt op beide kanten van de vergelijking gebruikt.

Doe je dat niet, dan bouw je een rekentool waarin een niet te bewijzen conversievoordeel als feit is ingebakken. Dat is misleidende reclame in een schuifknop.

Het goede nieuws: je hebt die claim niet nodig. Het echte argument staat los van conversie en is wél waar, want het volgt uit je eigen model: **bij hen betaal je of je wint of niet, bij ons alleen als je wint.** Dat is een feit over je eigen product. Daar heb je geen bron voor nodig.

### 4.3 Wat wél hard is

Twee dingen die ik wel kon bevestigen en die je moet gebruiken:

**De ACM heeft echt opgetreden tegen leadbedrijven die zich voordeden als de uitvoerende partij.** In de slotenmakerszaak legde de ACM lasten onder dwangsom op aan Allfree BV en Leadle BV van respectievelijk €8.900 en €3.700 per week. Reden: ze wekten met plaatsnamen in domein en teksten de indruk dat de consument met een lokale, gecertificeerde slotenmaker te maken had. Dat is exact het patroon waar §2 van de brief voor waarschuwt, en het is geen theoretisch risico.

Praktisch: "Matchdesk bemiddelt, wij voeren zelf geen installaties uit" moet in de hero staan, boven de vouw, in gewone tekst — niet in de footer, niet in kleine letters, niet alleen in de voorwaarden. En op de dienstpagina's per postcode of plaatsnaam geldt dat dubbel, want daar zit precies de vorm die de ACM heeft aangepakt.

**Telemarketing is sinds 1 juli 2026 strenger, en het raakt ook jouw installateurswerving.** De soft opt-in is uit artikel 11.7 Telecommunicatiewet verdwenen. Rechtspersonen vallen erbuiten, maar natuurlijke personen niet — en daar vallen **zzp'ers met een eenmanszaak, vof's, cv's en maatschappen** onder.

Een groot deel van de HVAC-installateurs die je wilt werven is precies dat. De brief behandelt telemarketing alleen aan de woningeigenaarskant. Dat is te smal. Je hebt een aparte, expliciete opt-in nodig op het **installateursformulier** voordat je iemand belt over aansluiting, en die moet je per aanmelding vastleggen: tijdstip, de exacte tekst, en de versie ervan.

---

## 5. Voorstel — stack

Ik ben het eens met de richting uit §3 van de brief. Cloudflare Pages, Functions, D1, KV, R2, Turnstile. Het domein staat er, het is goedkoop, en je krijgt de beveiligingslaag gratis. Geen reden om ergens anders heen.

Tien afwijkingen die ik wél zou aanraden. Ze zijn geen smaak; het zijn allemaal punten waarop de brief in zichzelf botst of waar de gekozen techniek iets niet kan.

### 5.1 Geen Vite voor de publieke site — wel 11ty

Je krijgt straks twaalf tot vijftien statische pagina's: landing, vijf dienstpagina's, `/voor-installateurs`, privacy, cookies, twee sets voorwaarden, bedankpagina's. Die met de hand onderhouden betekent dezelfde header, nav en footer vijftien keer kopiëren. Dat gaat mis.

Vite is er alleen niet voor gemaakt — dat is een bundler voor applicaties, geen paginagenerator. Neem **Eleventy**. Het levert kale HTML op, kost je geen kilobyte client-side JavaScript, en je houdt één header en één footer. Vite houd je voor `/admin`, waar je hem wel nodig hebt.

### 5.2 Kritieke CSS inline en CSP zonder `unsafe-inline` botsen

§7 wil kritieke CSS inline. §6 wil een CSP zonder `unsafe-inline`. Allebei kan alleen met nonces of hashes, en een nonce moet per request anders zijn — dat kan niet in een statisch bestand op Pages.

Oplossing: **hashes, berekend tijdens de build.** Nul inline `<script>`-elementen, al je JavaScript in externe modules. Precies één inline `<style>` met de kritieke CSS, waarvan het buildscript de sha256 berekent en in `_headers` schrijft. Vergeet je dat, dan breekt de pagina zichtbaar in plaats van stil — precies wat je wilt.

Voeg meteen `report-uri` toe en draai de eerste week in `Content-Security-Policy-Report-Only`, anders sloop je je eigen formulieren op lanceringsdag.

### 5.3 Cloudflare Access in plaats van zelfgebouwde 2FA voor `/admin`

De brief noemt Access "optioneel en aan te raden". Ik zou het omdraaien.

Argon2id-hashing, TOTP-inschrijving, herstelcodes, lockout-logica en sessierotatie zelf bouwen is vier of vijf dagen werk plus een permanent risico — en dat voor twee of drie accounts. Cloudflare Access doet het gratis tot vijftig gebruikers, met echte MFA, en je slaat dan zelf helemaal geen wachtwoordhashes meer op. Wat je niet bewaart, kan niet lekken.

Dus: **Access voor `owner` en `staff`, de rol lees je uit de door Access ondertekende JWT.** De magic link voor installateurs bouw je wel zelf, want die mensen krijg je nooit in Access — eenmalig te gebruiken, vijftien minuten geldig, token gehasht in D1, en de link nooit in een redirect of referrer laten belanden.

### 5.4 De MX-check moet via DNS-over-HTTPS en mag niet blokkeren

Workers kunnen geen DNS-lookups doen. Er is geen socket. De enige route is een DoH-verzoek naar `https://cloudflare-dns.com/dns-query?type=MX`.

Doe dat met een timeout van één seconde, en laat een mislukking of een uitblijvend antwoord de inzending **niet** tegenhouden. Zet in plaats daarvan een vlag op de lead. Een woningeigenaar die zijn aanvraag kwijtraakt omdat een DNS-resolver traag was, is een verloren klant en die krijg je niet terug.

### 5.5 De bottest van onder de twee seconden is te scherp

"Sneller dan 2s ingevuld = bot" gaat echte mensen weigeren. Iemand met een wachtwoordmanager die het contactblok automatisch invult, of een terugkerende bezoeker wiens formulier uit `sessionStorage` wordt hersteld, zit daar zo onder.

Maak er **0,8 seconde** van, en gebruik het als signaal in een score, niet als weigering. Turnstile doet het echte werk. Honeypot en timing zijn er om de ruis eruit te halen, niet om te oordelen.

### 5.6 Het meerstapsformulier botst met de eis "werkt met JavaScript uit"

De definition of done in §10 eist dat elk formulier werkt met JS uit. §4 wil een meerstapsformulier met voortgangsindicator en `sessionStorage`. Dat kan niet allebei in dezelfde constructie.

De enige echte oplossing is progressive enhancement, en zo zou ik het bouwen: **je verstuurt één volledig HTML-formulier** met alle velden in `<fieldset>`-blokken en een gewone `<button type="submit">`, dat native post naar de Function. Zonder JavaScript is het één lange pagina die het gewoon doet. Mét JavaScript verbergt een module de fieldsets, zet er stappen omheen, voegt de voortgangsindicator toe en bewaart de tussenstand.

Zo is het bovendien meteen toetsenbordvriendelijk en screenreader-proof, want de onderliggende structuur klopt al.

### 5.7 De factuur-PDF is een risico, plan er een spike voor

PDF's genereren in een Worker is krap: je zit vast aan de bundelgrootte en de CPU-tijd per request. `pdf-lib` past er waarschijnlijk in, maar "waarschijnlijk" is niet goed genoeg om een fase op te plannen.

Zet in Fase 5 een spike van een halve dag in. Valt het tegen, dan is het alternatief simpel en prima: **een nette HTML-factuur met een printstylesheet.** Voor een factuurregel per gewonnen klus is dat ruim voldoende, en de boekhouder merkt het verschil niet.

### 5.8 Lighthouse ≥ 95 geldt niet voor `/admin`

Al genoemd in §2. Neem het expliciet op in de definition of done, anders staat er straks iemand een datatabel te optimaliseren die drie mensen ooit zien.

### 5.9 Zonebeschikbaarheid grover tonen

"3 van 4 plekken vrij in 5xxx" doet twee vervelende dingen. Het vertelt concurrenten precies waar je zwak staat, en het is een harde, verifieerbare bewering die verkeerd staat op het moment dat je cache achterloopt.

Toon in plaats daarvan drie eerlijke toestanden, live uit D1: **ruimte** / **bijna vol** / **wachtlijst**. Alle drie waar, geen van drieën een cijfer dat iemand kan narekenen en fout kan vinden.

### 5.10 Rate limiting via KV heeft een randgeval

KV is eventually consistent. Voor "vijf inzendingen per uur per IP" is dat prima — een enkele extra inzending schaadt niemand.

Voor de **login en de magic link** is het niet prima, want daar is de teller je enige verdediging tegen brute force. Gebruik daar een **Durable Object** per IP-hash. Dat is sterk consistent en het is precies waar ze voor bestaan.

---

## 6. Voorstel — datamodel

Zestien tabellen. Bewust plat gehouden; alles wat een geschiedenis heeft krijgt een eigen tabel in plaats van een kolom die je overschrijft, want je hebt straks een auditlog nodig die twaalf maanden terugkijkt.

**Kern**

- `services` — `slug`, `naam`. De vijf uit de brief: warmtepomp, cv-ketel, airco, ventilatie, onderhoud. Als tabel, niet als enum, want de dienstpagina's en de intake lezen er allebei uit.
- `installers` — bedrijfsnaam, kvk, contact, `status` (actief/gepauzeerd/inactief), `capacity_per_week`, `commission_pct` per partner, contractstatus, notities.
- `installer_services` — koppeltabel. Een installateur doet meestal drie van de vijf.
- `zones` — `postcode_from`, `postcode_to` (numeriek, de vier cijfers), `installer_id`, `max_slots`. Bereiken, geen losse postcodes: je wilt niet 4.000 rijen per partner.
- `leads` — dienst, postcode, afgeleide regio, urgentie, budgetindicatie, omschrijving, naam, e-mail, telefoon in E.164, `status`, `source`, `created_at`.
- `matches` — lead, installateur, `reason` (de leesbare regel waaróm deze partij is gekozen), `status`, `responded_at`, `reject_reason`.
- `match_events` — elke statuswijziging apart: van, naar, door wie, wanneer. Dit is je tijdlijn en je bewijs.
- `deals` — gekoppeld aan een gewonnen match: dealwaarde, gehanteerd commissiepercentage, berekend bedrag, betaalstatus.
- `invoices` — factuurnummer, periode, bedrag, R2-sleutel van het bestand, status.

**Naleving en beveiliging**

- `consents` — één rij per gegeven toestemming, per lead: `type` (doorgifte / telefonisch / marketing), tijdstempel, **gehasht** IP, de exacte tekst, en de versie van de privacyverklaring. Dit is de tabel die je overlegt als de AP belt. Nooit overschrijven, alleen toevoegen.
- `privacy_versions` — versienummer, tekst, ingangsdatum. Waar `consents` naar wijst.
- `users` — alleen `email`, `role`, `installer_id`. **Geen wachtwoordkolom**, want Access doet de authenticatie (§5.3).
- `magic_links` — gehasht token, installateur, vervaltijd, gebruikt-op. Eenmalig.
- `audit_log` — actor, actie, entiteit, entiteits-id, tijdstempel, gehasht IP. Alleen invoegen, nooit wijzigen of verwijderen.
- `gdpr_requests` — verzoek, type (export of wissing), uitgevoerd door, wanneer.
- `email_templates` — sleutel, onderwerp, body met variabelen, versie.

**Twee regels die op databaseniveau moeten staan, niet in code**

1. Partiële unieke index op `matches`: **maximaal één actieve match per lead** over de statussen `nieuw`, `geaccepteerd`, `offerte`, `gewonnen`. Dit is de hele belofte van het product. Als hij alleen in de applicatielaag staat, is het een kwestie van tijd voor een dubbele toewijzing er doorheen glipt en twee installateurs dezelfde woningeigenaar bellen. Dan ben je precies wat je zegt niet te zijn.
2. `leads.status` en `matches.status` als `CHECK`-constraints, niet als vrije tekst.

**Anonimiseren, niet verwijderen.** Voor de bewaartermijn uit §2: draai een `scheduled` Worker die leads zonder match ouder dan X maanden ontdoet van naam, e-mail, telefoon en omschrijving, maar de rij, de dienst, de regio en de datum laat staan. Dan houd je je statistiek en ben je toch AVG-schoon. Rijen weggooien maakt je dashboard onbetrouwbaar en dat merk je pas een jaar later.

---

## 7. Voorstel — sectie-indeling

De twaalf secties uit §4 kloppen grotendeels. Vier wijzigingen.

**De vergelijkingstabel gaat eruit** (§4.1). Op die plek komt een korte uitleg van het mechanisme van leadplatforms, zonder namen en zonder bedragen.

**Commissie schuift naar voren, vóór de rekenmodule.** Nu staat de staffel op plek 7 en de rekenmodule op plek 5. Dat is de verkeerde volgorde: iemand kan niet nadenken over een berekening als hij het percentage nog niet weet. Eerst het getal, dan de som.

**De rekenmodule is het belangrijkste element van de pagina en verdient plek 3.** De brief zegt dat zelf, en zet hem dan halverwege. Zet hem direct na de hero en het probleem. Het is het enige element op de pagina waarin de bezoeker iets doet, en het argument komt uit zijn eigen invoer.

**Sociale bewijskracht blijft weg.** Conform §8 van de brief. Geen logo's, geen aantallen, geen "vertrouwd door". Ook niet als het verleidelijk is om die ruimte te vullen. Er is nog niets, dus er staat niets.

Voorgestelde volgorde:

1. Hero — je betaalt pas als je de klus wint, en je bent de enige die belt. Twee gescheiden CTA's. **Plus, in gewone leesbare tekst: Matchdesk bemiddelt en installeert niet zelf.**
2. Het probleem — kort, geen bolletjes
3. **Rekenmodule** — eigen invoer, eigen conversie aan beide kanten
4. **Commissie** — staffel, wat het percentage bepaalt, uitgewerkt voorbeeld, "wat dit niet is"
5. Hoe het werkt — genummerd, want dit is echt een volgorde
6. Hoe leadplatforms werken — mechanisme, geen namen
7. Zonebeschikbaarheid — ruimte / bijna vol / wachtlijst
8. Dekking en diensten — door naar de dienstpagina's
9. Voor wie — twee kolommen, elk een eigen CTA
10. FAQ — `<details>` met FAQPage-schema
11. Formulieren
12. Footer — KvK, adres, rechtsvorm, alle juridische pagina's, contact

---

## 8. Wat ik van je nodig heb voordat Fase 1 begint

Vier dingen. De eerste drie staan in de brief zelf als "niet verzinnen, doorvragen". Dat doe ik hierbij.

### 8.1 De commissiestaffel — en of 20–30% haalbaar is

Dit is de zwaarste. De brief noemt 20–30% van de dealwaarde. Reken dat eens door met de bedragen die in deze markt gangbaar zijn:

| Klus | Indicatie dealwaarde | Commissie bij 20% | Bij 30% |
|---|---|---|---|
| Hybride warmtepomp | €5.000 – €8.000 | €1.000 – €1.600 | €1.500 – €2.400 |
| Volledige warmtepomp | tot €30.000 | tot €6.000 | tot €9.000 |

De gemiddelde nettowinstmarge in de branche loodgieters- en fitterswerk, installatie van sanitair en van verwarmings- en luchtbehandelingsapparatuur lag rond **11,2%** (2021, zie `RESEARCH.md`). Bij 20% commissie op dealwaarde vraag je dus ruwweg twee keer de volledige nettowinst van de klus. Bij 30% bijna drie keer.

Dat werkt niet, tenzij ik iets mis. Drie mogelijkheden, en ik weet niet welke je bedoelt:

1. **De 20–30% gaat over de marge, niet over de dealwaarde.** Dan is het een heel ander en veel verdedigbaarder verhaal, maar dan moet je de marge kunnen zien — en dat gaat een installateur je niet geven.
2. **De 20–30% klopt, maar geldt alleen bij kleine klussen** — onderhoudscontracten, een airco, een servicebeurt van €400 tot €1.500. Daar kan het wel. Dan heb je een dalende staffel nodig en een absoluut maximum per klus.
3. **Het percentage moet gewoon omlaag.** Iets in de orde van 3 tot 8% van de dealwaarde met een bodem en een plafond zit dichter bij wat een installateur kan dragen, en is nog steeds ruim boven wat leadplatforms per klus verdienen.

Ik kan hier niet zelf een keuze in maken. Het bepaalt de hero-tekst, de rekenmodule, de commissiesectie, het datamodel en de facturatie — dat is het halve product. **Wat wordt de staffel, en waar is het percentage een percentage van?**

### 8.2 Bedrijfsgegevens

De footer, de voorwaarden, de privacyverklaring en de verwerkersovereenkomst hebben deze nodig, en ik vul ze niet in met plaatshouders die later blijven staan:

- Volledige statutaire naam en rechtsvorm
- KvK-nummer
- Btw-identificatienummer
- Vestigingsadres
- Contact-e-mailadres, en een apart adres voor AVG-verzoeken
- Naam van de verwerkingsverantwoordelijke, en of er een FG is

### 8.3 Akkoord op het weghalen van de vergelijkingstabel

Zie §4.1. Mijn advies is: eruit bij lancering. Wil je hem toch, dan bouw ik hem — maar dan heb ik per concurrent een screenshot van hun eigen, actuele tariefpagina nodig, met datum, en dan hoort er een kwartaalcontrole bij die iemand moet doen. Zeg wat je wilt.

### 8.4 Toegang tot de repo

Zie §1. Zonder dit blijven onderdeel 1, 2 en 3 van Fase 0 openstaan, en dan begint Fase 1 zonder baseline. Dat kan, maar dan weet je achteraf niet wat je verbeterd hebt.

---

## 9. Wat ik van deze fase zelf vind

De brief is goed. Beter dan de meeste: de fasering is realistisch, de nalevingseisen staan er vooraan in plaats van als bijlage, en §8 verbiedt precies de dingen waar dit soort sites normaal in vervalt.

De zwakke plek zit in §1. Daar staat een concurrentieanalyse met bedragen in een tabel, en §2 eist twee alinea's later dat elk cijfer daarin controleerbaar is. Die twee eisen kunnen niet allebei worden gehaald met de bronnen die openbaar beschikbaar zijn. De brief eist, terecht, het strengere van de twee. Dus valt de tabel af.

Dat is geen verlies. Het sterkste wat je hebt is geen vergelijking maar een eigenschap van je eigen model: je stuurt één aanvraag naar één installateur en je stuurt pas een factuur als die de klus heeft gewonnen. Dat hoef je niet te bewijzen met andermans prijslijst. Dat toon je gewoon.

Blijft over: hoeveel je vraagt als hij wint. Dat getal is nu het enige echt onopgeloste punt in de hele brief, en zonder dat getal kan Fase 1 wel, maar Fase 2 niet.
