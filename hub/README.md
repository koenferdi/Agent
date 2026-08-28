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

De kaart animeert: wolkjes boven elk gebouw met wat die agent doet, rook uit de
schoorsteen als er werk openstaat, lampen die pulseren, vuurvliegjes. Klik een
gebouw om zijn paneel te openen, klik een rapport om het te lezen.

De pagina start de agents niet. Die draaien in Claude Code. Dit is het werkblad
en de leesomgeving.
