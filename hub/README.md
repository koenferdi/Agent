# hub

De Validatiedesk: het gedeelde werkblad tussen mij en Claude.

`server.mjs` plus `public/` vormen de werkende omgeving. `validatiedesk.html` is
de oudere gepubliceerde versie: een losse pagina zonder toegang tot de bestanden.
Die is achterhaald door de lokale app en wordt niet meer bijgewerkt.

## Wat hoort hier

- De bronbestanden van de hub en latere dashboards
- Niets anders: dit is gereedschap, geen content

## Lokale werkomgeving

Dubbelklik `Start hub.command` (macOS), `Start hub.bat` (Windows) of
`start-hub.sh` (Linux). Vanuit de terminal: `npm start`.

Geen dependencies, alleen Node built-ins. De browser opent vanzelf; is de poort
bezet, dan wijkt de server uit naar de volgende vrije poort. De server leest live uit de workspace:

- **Agents** uit `.claude/agents/*.md` — naam, beschrijving, model en tools uit de frontmatter
- **Rapporten** uit `drafts/*.md` — titel en het metadatablok bovenaan (oordeel, zekerheid, bronnen)
- **Opdrachten en beslissingen** uit `hub/desk.json`, dat de interface zelf bijwerkt

## De vloer

De kaart is een isometrische kantoorvloer (`public/iso/`). Elke afdeling uit
`workflows/capabilities` heeft een eigen kamer met vier bureaus; daaronder
liggen overleg, lounge, koffie en het archief. Een agent zit aan zijn bureau,
loopt om de meubels heen en gaat naar de lounge als er een rapport klaar is.

**De vloer is een weergave, geen meting.** Er beweegt pas iets als er echt iets
verandert in `desk.json` of `drafts/`. Elke regel in de Live-feed hoort bij zo'n
verandering; de tijd erbij is het moment dat de hub het zag, niet per se het
moment dat het gebeurde. Het aantal boekjes in het archief is het aantal
rapporten in `drafts/`; de strepen op het bord in een afdelingskamer zijn de
capaciteiten van die afdeling, fel als er een agent op zit.

Daarnaast is er een **rondloopmodus**. Die staat standaard uit. Zet je hem aan,
dan krijgen de agents behoeften (energie, focus, sociaal) die per seconde zakken
en gaan ze uit zichzelf koffie halen. Dat gedrag is verzonnen; de vloer en de
feed labelen het ook zo.

| Wat | Hoe |
| --- | --- |
| Rondkijken | slepen op lege vloer |
| Zoomen | scrollen of knijpen |
| Agent kiezen | tikken — de details komen in het paneel eronder |
| Agent verplaatsen | slepen naar een tegel |
| Terug naar bureau | dubbeltik op de agent |
| Naar een ruimte | selecteer een agent, dubbeltik op de ruimte |
| Naar een kamer kijken | knop met de kamernaam |

Wil je de indeling veranderen, dan hoef je maar in één bestand te zijn:
`public/iso/iso-map.js`. Kleuren staan in `iso-theme.js`, het gedrag in
`iso-office.js`, en de koppeling met je bestanden in `iso-bridge.js`.

## Als app op je telefoon

`/vloer.html` is de vloer op volledig scherm. De hub heeft een manifest en een
service worker, dus je kunt hem op je beginscherm zetten en hij start zonder
browserbalk. De iconen maak je opnieuw met `npm run iconen`.

De pagina start de agents niet. Die draaien in Claude Code. Dit is het werkblad
en de leesomgeving.
