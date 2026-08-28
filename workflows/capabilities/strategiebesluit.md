---
name: strategiebesluit
title: Van onderzoek naar een besluit
department: kennis
status: live
ladder: human-led
replaces: Een richting kiezen op onderbuikgevoel en de argumenten er achteraf bij zoeken.
human: Jij beslist. De agent maakt de afweging zichtbaar en legt de afbreekcriteria vast.
done_by: strategy-analyst
runtime: Claude Code
builds_on: [marktverkenning, klantonderzoek]
breaks_into: [onderzoek-toetsen, bewijs-scheiden, opties-genereren, afwegingen-maken, aanbevelen, afbreekcriteria-zetten]
---

## Wat het doet

Vertaalt onderzoek naar een besluit dat je kunt nemen: positionering, de echte opties met hun
afwegingen, en een aanbeveling met zekerheid, afbreekcriteria en een eerste test.

## De ladder

- **Human-led** *(nu)* — de agent legt het bewijs, de opties en de afwegingen voor. Jij kiest.
  Dit blijft hier staan; een strategiebesluit delegeren is het bedrijf delegeren.
- **Human-assisted** — de agent zou een voorkeursoptie mogen doorzetten binnen kaders die jij
  vooraf vastlegt. Alleen zinnig als er meetbare kaders zijn, en die zijn er nog niet.
- **Fully autonomous** — niet van toepassing.

## De SOP

1. **Onderzoek toetsen.** Kan het bewijs een besluit dragen? Zijn de cijfers gemeten of geschat,
   hoe oud is de data, wat zei het onderzoek zelf niet te kunnen vaststellen? Zo nee: stoppen en
   benoemen wat ontbreekt.
2. **Bewijs scheiden.** Drie kolommen: wat het bewijs aantoont, wat de agent daaruit afleidt, en
   wat onbekend blijft. Nooit door elkaar.
3. **Opties genereren.** Minstens twee echt verschillende richtingen, plus niet instappen. Geen
   stroman naast één echte optie.
4. **Afwegingen maken.** Per optie: sterkste argument voor, sterkste ertegen, wat het uitsluit,
   hoe snel je weet of het werkt, en wat het kost als het misgaat.
5. **Aanbevelen.** Eén optie, met zekerheidsniveau en de redenering.
6. **Afbreekcriteria zetten.** Welke waarneembare uitkomst betekent stoppen, en per wanneer.
   Plus de goedkoopste eerste test met een slaag-zakgrens.

Volledige uitwerking: `workflows/strategy-analysis-agent.md`
