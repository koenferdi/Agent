# AI-dossier — opzetten

Statische site. Geen Node, geen bouwstap, niets om te installeren.

## Lokaal bekijken

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Of open `index.html` gewoon in je browser.

## Online zetten

1. Registreer een domein. Iets als `ai-dossier.nl` of `aidossier.nl`.
2. Maak een gratis account op [Cloudflare Pages](https://pages.cloudflare.com) of
   [Netlify](https://netlify.com).
3. Sleep de map erin, of koppel je Git-repository. Er is geen build command nodig —
   laat dat veld leeg en zet de output directory op `/`.
4. Koppel je domein. Https gaat vanzelf.

Kosten: alleen het domein, ongeveer € 12 per jaar.

## Betalingen aansluiten

1. Maak een [Stripe](https://stripe.com)-account. Je hebt een bankrekening en een
   identiteitsbewijs nodig; dit kost ongeveer een kwartier.
2. Maak een **Payment Link** van € 149.
3. Zet in de instellingen van die link **"Don't show confirmation page"** aan en vul als
   redirect-URL in:

   ```
   https://jouwdomein.nl/?ok=JOUW-GEHEIME-TOKEN
   ```

4. Open `assets/app.js` en vul het `CONFIG`-blok bovenaan in:

   ```js
   const CONFIG = {
     PAY_URL:       "https://buy.stripe.com/jouw-echte-link",
     UNLOCK_TOKEN:  "JOUW-GEHEIME-TOKEN",
     BACKUP_CODES:  ["EEN-CODE-VOOR-NOODGEVALLEN"],
     LEAD_ENDPOINT: "https://formspree.io/f/xxxxxxxx"
   };
   ```

Na betaling komt de koper automatisch terug op de pagina met alles vrijgegeven. Er komt geen
mens aan te pas.

**Let op:** die token staat in de URL en in de broncode. Wie de link doorstuurt, geeft toegang
weg. Voor een zakelijk product van € 149 is dat een bewuste afweging, geen fout. Wil je echte
verificatie, dan heb je een backend nodig die de Stripe-sessie controleert.

## E-mailadressen opvangen

Maak een gratis formulier op [Formspree](https://formspree.io) of
[Web3Forms](https://web3forms.com) en zet de endpoint-URL in `LEAD_ENDPOINT`. Zonder die
instelling meldt de knop netjes dat verzenden nog uitstaat.

Dit is belangrijker dan het lijkt: wie de scan doet en niet meteen koopt, is anders voorgoed weg.

## Eén bestand maken

```bash
./build.sh
```

Schrijft `dist/index.html` met de css en js erin gebakken. Handig om te mailen of te previewen.
Voor productie hoeft dit niet — `index.html` plus `assets/` werkt prima.

## Voor je live gaat

- [ ] Test op een echte telefoon, niet alleen in een smal browservenster
- [ ] Test met Google Fonts geblokkeerd; het ontwerp moet overeind blijven
- [ ] Doe zelf een testbetaling in Stripe-testmodus en controleer of de ontgrendeling werkt
- [ ] Genereer alle vijf documenten en print ze naar pdf; controleer de paginaovergangen
- [ ] Laat de juridische teksten nakijken. Je verkoopt aan bedrijven die op je woord afgaan.
