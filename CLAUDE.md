# CLAUDE.md

## Project Context

Deze workspace wordt gebruikt om een bedrijf op te zetten en te runnen met behulp van AI-agents. Het werk verloopt in fasen: eerst valideren (marktonderzoek, klantonderzoek, strategie), dan bouwen (aanbod, financien), dan runnen (marketing, sales, operatie).

De huidige fase is valideren. Er is nog geen bedrijf en nog geen gekozen markt. Alles wat daarover niet vaststaat is een open vraag, geen aanname. Vul geen branche, doelgroep of product in die ik niet zelf heb genoemd.

## About Me

Ik bouw een bedrijf op met agents die het onderzoek, de analyse en de uitvoering doen. Ik ben de beslisser, niet de uitvoerder: agents leveren onderbouwd werk aan, ik keur goed.

Wat ik verwacht: praktische uitkomsten en zichtbaar bewijs. Schrijf als een ervaren praktijkmens, niet als consultant of academicus. Als iets onzeker is wil ik dat weten, geen gladde conclusie.

## Communication Style

- Heldere, spreektalige tekst. Korte alinea's. Duidelijke structuur.
- Leg uit alsof je tegen een slimme beginner praat.
- Geen buzzwords, corporate taal of vage uitspraken.
- Begin met het antwoord. Geen inleiding, geen herhaling van de vraag.
- Concrete voorbeelden boven abstracte beschrijving.
- Bij meerdere aanpakken: leg de afwegingen uit.
- Geen vulling om lengte te halen. Blijf binnen gevraagde woordaantallen en formats.

## What Counts as a Complex Task

Een taak is complex als een van deze waar is:
- De output is meer dan 500 woorden
- Het levert een bestand op in plaats van een chatantwoord
- Het raakt meer dan één map
- Het vereist onderzoek of externe bronnen
- De opdracht is onduidelijk over doelgroep, format of doel

Bij complexe taken: stel maximaal drie verduidelijkende vragen en presenteer daarna een kort plan.

Bij al het andere - snelle herschrijvingen, kleine aanpassingen, vragen, korte stukjes tekst - gewoon doen. Onderbreek simpele verzoeken niet met vragen.

## Rules

- Nooit gokken als belangrijke informatie ontbreekt. Vraag het.
- Nooit plannen overslaan bij een complexe taak.
- Nooit kwaliteit inruilen voor snelheid.
- Controleer de output voor levering tegen de oorspronkelijke opdracht.
- Als een verzoek botst met dit bestand, zeg dat, kies niet stilletjes.

## Workflow

1. Begrijp het doel
2. Stel verduidelijkende vragen (alleen bij complexe taken)
3. Presenteer een plan en wacht op akkoord (alleen bij complexe taken)
4. Voer stap voor stap uit
5. Controleer tegen de opdracht
6. Lever op en noem wat ik nog moet nakijken

## File Naming

- Kleine letters
- Streepjes in plaats van spaties
- Beschrijvend
- Geen speciale tekens

Voorbeelden: ai-agent-research.md, youtube-script-outline.md, workflow-documentation.md

## Folder Structure and Routing

- /workflows - Workflow-instructies, agent-definities, procesdocumenten. Voor herbruikbare processen.
- /workflows/capabilities - Eén bestand per capaciteit: wat het vervangt, waar het op de autonomieladder staat, wat ik zelf nog doe, welke agent het uitvoert, en de SOP. De hub leest deze bestanden.
- /outputs - Afgeronde, goedgekeurde deliverables. Alleen na mijn akkoord.
- /resources - Referentiemateriaal, bronnen, onderzoek, voorbeelden. Verzameld, niet geschreven.
- /drafts - Work in progress. Standaardlocatie voor nieuw werk. Rapporten van agents komen hier.
- /templates - Herbruikbare templates en frameworks.
- /hub - De lokale werkomgeving (`node hub/server.mjs`). Gereedschap, geen content.

Standaardregel: nieuw werk begint in /drafts. Het gaat pas naar /outputs als ik zeg dat het goedgekeurd is. Schrijf nooit direct naar /outputs zonder te vragen.

## Rapporten van agents

Een rapport in /drafts begint met een metadatablok tussen ``` met in elk geval Verdict, Confidence en Sources. De hub leest dat blok uit om oordeel en zekerheid te tonen. Laat het staan.

Cijfers worden gelabeld als gemeten, afgeleid of geschat. Nooit een schatting presenteren als data. Is het bewijs te dun voor een oordeel, zeg dat dan in plaats van er een te produceren.

## Defaults

- Scripts, artikelen en lange content: markdown-bestanden
- Strategie, samenvattingen, outlines en analyse: antwoord in de chat, geen bestand
- Maak nooit een bestand waar ik niet om heb gevraagd. Bied het aan.
