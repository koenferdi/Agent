---
name: marktverkenning
title: Een markt verkennen
department: kennis
status: live
ladder: human-assisted
replaces: Zelf dagen zoeken naar cijfers die je daarna niet kunt navertellen of verdedigen.
human: Jij kiest de markt, jij bepaalt wat het oordeel waard is en of je erop handelt.
done_by: market-researcher
runtime: Claude Code · WebSearch · WebFetch
builds_on: [webtoegang]
breaks_into: [scope-bepalen, bronnen-verzamelen, omvang-schatten, concurrentie-mappen, structuur-lezen, oordeel-vellen]
---

## Wat het doet

Vaststellen of een markt de moeite waard is, met het bewijs zichtbaar: hoe groot, groeiend
of krimpend, wie er al zit, waar de gaten zitten en hoe zeker het oordeel is.

## De ladder

- **Human-led** — jij zoekt zelf, leest zelf, en houdt zelf bij welk cijfer waar vandaan komt.
- **Human-assisted** *(nu)* — de agent zoekt en weegt, labelt elk cijfer als gemeten, afgeleid
  of geschat, en levert een oordeel met de zaak ertegen. Jij beslist.
- **Fully autonomous** — niet van toepassing. Een marktoordeel is een beslissing over jouw geld
  en jouw tijd. Die hoort niet zonder jou genomen te worden.

## De SOP

1. **Scope bepalen.** Marktdefinitie in één zin, plus wat er buiten valt. Benoem welke
   beslissing het onderzoek moet dienen. Wachten op akkoord voordat er tijd in gaat.
2. **Bronnen verzamelen.** Elke bron moet primair of eerstehands zijn, gedateerd en
   toewijsbaar, en geen AI-filler. URL en publicatiedatum meteen noteren, niet achteraf.
3. **Omvang schatten.** Bottom-up boven top-down. Rekenwerk tonen. Elk getal labelen als
   gemeten, afgeleid of geschat.
4. **Concurrentie mappen.** Wie bedient deze markt al, wat vragen ze, waar schieten ze tekort
   volgens klanten in hun eigen woorden. Een lege markt is een waarschuwing.
5. **Structuur lezen.** Toetredingsdrempel, distributie, marges, overstapkosten, en waarom nu.
6. **Oordeel vellen.** Instappen, niet instappen of nader onderzoeken, met zekerheidsniveau,
   wat het oordeel zou omdraaien, en de sterkste zaak ertegen.

Volledige uitwerking: `workflows/market-research-agent.md`
