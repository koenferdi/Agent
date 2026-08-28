---
name: contentproductie
title: Content schrijven vanuit een brief
department: markt
status: offphase
ladder: human-assisted
replaces: Zelf elk stuk vanaf nul schrijven, inclusief het onderzoek eronder.
human: Jij levert de brief en keurt het concept goed. Niets gaat naar buiten zonder jou.
done_by: content-creator
runtime: Claude Code · WebSearch · WebFetch
builds_on: [webtoegang]
breaks_into: [brief-toetsen, onderzoek-doen, outline-maken, concept-schrijven, zelfcontrole, opleveren]
---

## Wat het doet

Schrijft een concept vanuit een volledige brief: onderwerp, contenttype, doelgroep, toon en
woordaantal. Levert in `/drafts` met een metadatablok en de bronnen erbij.

## De ladder

- **Human-led** — jij schrijft alles zelf.
- **Human-assisted** *(nu)* — de agent schrijft het concept, jij keurt goed en publiceert.
- **Fully autonomous** — zou betekenen dat de agent zelf publiceert. Dat kan pas als er een
  kanaal is, een merk om te beschermen en een reeks concepten die je vertrouwt. Geen van drieën
  bestaat nu.

## Status

Buiten de huidige fase. Deze capaciteit hoort bij het runnen van een bedrijf, en er is nog geen
bedrijf. Hij staat klaar en wordt niet gebruikt.

Volledige uitwerking: `workflows/ai-content-creation-agent.md`
