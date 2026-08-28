# hub

De Validatiedesk: het gedeelde werkblad tussen mij en Claude.

`validatiedesk.html` wordt gepubliceerd als Artifact. De pagina onthoudt zijn
eigen inhoud, dus wat ik erin zet blijft staan en Claude kan het uitlezen.

## Wat hoort hier

- De bronbestanden van de hub en latere dashboards
- Niets anders: dit is gereedschap, geen content

## Hoe de lus werkt

1. Ik zet een opdracht of een besluit in de pagina
2. Ik zeg tegen Claude: lees de validatiedesk
3. Claude leest de pagina, draait de agent en zet de bevindingen erin terug
4. Het volledige rapport landt in `/drafts`, de samenvatting staat in de hub

De pagina praat niet zelf met de agents. Die draaien in Claude Code.

## Publiceren

Bewerk het bestand en publiceer het opnieuw via hetzelfde pad, dan blijft de
URL gelijk. Publiceren met een ander pad maakt een losse tweede pagina aan.

## Lokale werkomgeving

```bash
node hub/server.mjs        # start op http://localhost:4317
```

Geen dependencies, alleen Node built-ins. De server leest live uit de workspace:

- **Agents** uit `.claude/agents/*.md` — naam, beschrijving, model en tools uit de frontmatter
- **Rapporten** uit `drafts/*.md` — titel en het metadatablok bovenaan (oordeel, zekerheid, bronnen)
- **Opdrachten en beslissingen** uit `hub/desk.json`, dat de interface zelf bijwerkt

De kaart animeert: wolkjes boven elk gebouw met wat die agent doet, rook uit de
schoorsteen als er werk openstaat, lampen die pulseren, vuurvliegjes. Klik een
gebouw om zijn paneel te openen, klik een rapport om het te lezen.

De pagina start de agents niet. Die draaien in Claude Code. Dit is het werkblad
en de leesomgeving.
