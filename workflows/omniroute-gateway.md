# OmniRoute als gateway voor de agents

Runbook voor het draaien van [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
(v3.8.51) voor deze workspace, plus de afwegingen die erbij horen.

## Wat OmniRoute is

Een self-hosted AI-gateway. Het draait op je eigen machine en biedt een
OpenAI-compatibel endpoint op `http://localhost:20128/v1`. Achter dat ene
endpoint zitten honderden providers. Het regelt fallback als een provider
uitvalt, en het catalogiseert gratis tiers.

Het is een **router voor modelaanroepen**, geen agent-orkestrator. Het verandert
welk model je agents bedient, niet hoe ze werken.

## Installeren en starten

```bash
# npm
npm install -g omniroute
omniroute

# of Docker
docker run -d --name omniroute -p 20128:20128 diegosouzapw/omniroute:latest
```

Dashboard opent op `http://localhost:20128`.

## Een provider koppelen

In het dashboard: **Providers → Add Provider**. Deze werken zonder creditcard of
API-key:

| Provider | Wat je krijgt |
| --- | --- |
| Kiro AI | Gratis Claude-modellen |
| OpenCode Free | Meerdere modellen, geen auth |
| Pollinations | GPT, Claude, Gemini, geen key |

## Claude Code erop aansluiten

Claude Code staat in de ondersteunde CLI-lijst met volledige dekking via
omgevingsvariabelen:

```bash
omniroute setup-claude     # schrijft de Claude Code-config
omniroute launch           # start Claude Code via de gateway
```

Model kiezen doe je met `auto`, of gerichter:

| Alias | Kiest op |
| --- | --- |
| `auto` | balans tussen snelheid, kosten en kwaliteit |
| `auto/coding` | modellen die goed zijn in code |
| `auto/smart` | kwaliteit eerst |
| `auto/cheap` | goedkoopste optie |
| `auto/fast` | laagste latency |

## Wat dit hier wel en niet kan

**Draait op jouw machine, niet in deze sessie.** Deze Claude Code-sessie draait
in een tijdelijke container in de cloud. Een gateway op `localhost:20128` van
jouw laptop is daar niet bereikbaar, en de container wordt opgeruimd. Je zet
OmniRoute dus lokaal op en gebruikt hem daar.

**De Validatiedesk kan er niet bij.** Die pagina draait in je browser op
claude.ai en mag alleen naar een korte lijst toegestane hosts. `localhost` staat
daar niet bij, en zal er ook niet bij komen.

**Het vervangt de agents niet.** De agents in `.claude/agents/` blijven wat ze
zijn. OmniRoute bepaalt alleen welk model erachter zit.

## Twee afwegingen voordat je dit aanzet

**1. Waar je gegevens heen gaan.** Alles wat door de gateway loopt — je code, je
onderzoek, je gesprekken — gaat naar de provider die op dat moment gekozen
wordt. Bij gratis tiers is het gebruikelijk dat de aanbieder de data mag
gebruiken voor training. Lees de voorwaarden van de providers die je aanzet.
Voor marktonderzoek is dat meestal geen probleem; voor klantgegevens of
bedrijfscijfers wel.

**2. Modelkwaliteit versus deze agents.** De drie validatie-agents zijn gebouwd
op een discipline: cijfers labelen als gemeten, afgeleid of geschat, niets
verzinnen, stoppen als het bewijs te dun is. Precies die discipline is het
eerste wat wegvalt bij een klein of goedkoop model. Een marktonderzoek dat
getallen verzint is erger dan geen marktonderzoek.

**Aanbeveling:** zet OmniRoute in voor bulk- en routinewerk, en houd het
onderzoek op een sterk model. In de praktijk: `auto/smart` of een expliciete
provider voor de research-agents, `auto/cheap` voor de rest.

## Bronnen

- Quick start: `docs/getting-started/QUICK-START.md`
- CLI-koppelingen: `docs/reference/CLI-TOOLS.md` en `docs/guides/CLI-INTEGRATIONS.md`
- Gratis tiers en methodiek: `docs/reference/FREE_TIERS.md`
