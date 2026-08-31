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

## De indeling

Links de onderdelen, in het midden het werkblad, rechts de inspecteur die
meekijkt. Vijf werkbladen: de **vloer**, de **sterrenkaart**, de **structuur**,
de **gereedschapsbibliotheek** en **werk** (runs, beslissingen, rapporten). Op
een telefoon wordt de navigatie een balk onderin en de inspecteur een lade.

## Gereedschap

Een agent kan tijdens een run zoeken op het web, een pagina ophalen, en in deze
workspace lezen en kijken. Alles alleen-lezen: schrijven doet hij niet zelf, het
rapport wordt aan het eind door de hub weggeschreven. In de bibliotheek zie je
per stuk gereedschap of het bruikbaar is, wat het nodig heeft en welke agents
het krijgen aangeboden.

Zoeken heeft een zoekmachine nodig. Twee wegen: zet `SEARX_URL` naar een eigen
SearXNG (gratis, zelf te draaien) of vul een Brave-sleutel in bij de sleutels.
Zonder een van beide zoekt niemand, en dat staat er ook zo bij.

Een agent mag maximaal zes rondes gereedschap pakken per run. Elke keer dat hij
iets pakt zie je het in de live-uitvoer staan.

## Een agent aan het werk zetten

Kies een agent, typ een concrete vraag, kies een model en druk op **Aan het werk
zetten**. De hub bouwt de prompt uit `.claude/agents/<id>.md`, de bijbehorende
capaciteit en `CLAUDE.md`, roept het model aan en duwt elke stap live je scherm
in. Het rapport landt in `drafts/`, van elke run blijft een logboek achter in
`runs/` met tokens en kosten.

**Een agent hier draait zonder gereedschap.** Geen webtoegang, geen bestanden
openen — hij werkt met wat er in zijn prompt staat, en het rapport zegt dat ook
in het bronnenveld. Voor onderzoek met echte bronnen zet je dezelfde agent aan
in Claude Code; daar heeft hij WebSearch en WebFetch.

## Modellen en sleutels

De modellenlijst wordt live opgehaald en tien minuten vastgehouden. Lukt dat
niet, dan valt hij terug op een ingebakken lijst die ook zo gelabeld wordt.

| Aanbieder | Sleutel nodig | Gratis |
| --- | --- | --- |
| Lokaal (Ollama, LM Studio) | nee | ja, en zonder limiet |
| OpenRouter | ja | een handvol modellen |
| Groq | ja | gratis niveau met limieten |
| Google AI Studio | ja | gratis niveau met limieten |
| Anthropic, OpenAI | ja | nee |

Sleutels zet je in de hub bij **instellingen**. Ze belanden in `sleutels.json`
naast je workspace, met rechten 600, buiten git, en gaan nooit terug naar de
browser — je ziet alleen de laatste vier tekens. Je kunt ze ook via de omgeving
meegeven (`OPENROUTER_API_KEY` en zo); dan staan ze nergens op schijf.

Draait er iets lokaals op poort 11434, dan staat dat vanzelf bovenaan de lijst.
Met `HUB_OPENROUTER_URL` en dergelijke wijs je een aanbieder naar je eigen
gateway.

## Opzetten

Nog geen bedrijf? Open `/start.html`. In vier stappen vul je je naam en
bedrijfsnaam in (met een naamgenerator), kies je welke agents je nodig hebt, en
schrijft de hub die weg als bestanden. Bestaande agents blijven ongemoeid.

Dit is het werkblad en de leesomgeving — en sinds kort ook de werkplaats.
