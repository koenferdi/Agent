# Agent

Werkplaats om een bedrijf op te zetten met AI-agents. De agents doen het onderzoek
en de analyse, ik beslis.

De huidige fase is **valideren**. Er is nog geen bedrijf en nog geen gekozen markt.

## De hub openen

**Eenmalig:** installeer Node (versie 18 of hoger) via [nodejs.org](https://nodejs.org) —
kies de LTS-versie. Verder is er niets te installeren.

**Daarna, elke keer:**

| Jouw systeem | Wat je doet |
| --- | --- |
| macOS | Dubbelklik **`Start hub.command`** |
| Windows | Dubbelklik **`Start hub.bat`** |
| Linux | Dubbelklik **`start-hub.sh`**, of `./start-hub.sh` |
| Terminal | `npm start` |

De browser opent vanzelf op `http://localhost:4317`. Is die poort bezet, dan wijkt
de hub uit naar de volgende vrije poort en zegt hij welke.

Stoppen: Ctrl+C in het venster, of het venster sluiten.

> Krijg je op macOS de melding dat het bestand niet geopend kan worden omdat de
> ontwikkelaar niet te verifiëren is: rechtermuisknop op het bestand → Openen →
> Openen. Dat hoeft maar één keer.

**De laatste versie ophalen** voordat je start:

```bash
git pull origin main
```

## Wat waar staat

| Map | Wat erin hoort |
| --- | --- |
| `.claude/agents/` | De agents zelf. Aanroepbaar in Claude Code. |
| `workflows/` | De processen die de agents volgen. Bron van waarheid. |
| `workflows/capabilities/` | Per capaciteit: wat het vervangt, de autonomieladder, de SOP. |
| `drafts/` | Werk in uitvoering. Rapporten van agents landen hier. |
| `outputs/` | Alleen goedgekeurd werk. |
| `resources/` | Verzameld referentiemateriaal. |
| `templates/` | Herbruikbare sjablonen. |
| `hub/` | De lokale werkomgeving. Gereedschap. |

## De agents

| Agent | Doet | Ladder |
| --- | --- | --- |
| `market-researcher` | Marktomvang, concurrentie, structuur → oordeel met bronnen | human-assisted |
| `customer-researcher` | Wie heeft het probleem, in eigen woorden → ICP | human-assisted |
| `strategy-analyst` | Onderzoek → opties, aanbeveling, afbreekcriteria | human-led |
| `content-creator` | Content vanuit een brief | buiten deze fase |

Alle vier delen dezelfde discipline: niets verzinnen, elk cijfer labelen als
gemeten, afgeleid of geschat, en stoppen als het bewijs te dun is in plaats van
een oordeel produceren dat niet gedragen wordt.

## De lus

1. Zet een opdracht in de hub, of zeg het hier
2. Zeg tegen Claude: *lees de validatiedesk*
3. Claude draait de agent en schrijft het rapport naar `drafts/`
4. Ververs de hub — het rapport staat er, met oordeel en zekerheid

De hub start de agents niet zelf. Die draaien in Claude Code.
