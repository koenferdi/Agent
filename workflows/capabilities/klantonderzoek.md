---
name: klantonderzoek
title: Uitzoeken wie het probleem heeft
department: kennis
status: live
ladder: human-assisted
replaces: Gokken wie je klant is en dat een persona noemen.
human: Jij voert de echte gesprekken. Bureauonderzoek heeft een plafond en de agent zegt waar dat ligt.
done_by: customer-researcher
runtime: Claude Code · WebSearch · WebFetch
builds_on: [webtoegang]
breaks_into: [hypothese-stellen, vindplaatsen-zoeken, citaten-verzamelen, alternatieven-mappen, betaalsignalen-lezen, icp-opstellen]
---

## Wat het doet

Vervangt aanname door bewijs: wie heeft het probleem echt, in hun eigen woorden, wat doen ze
er nu aan, en wat betalen ze al.

## De ladder

- **Human-led** — jij leest zelf forums, reviews en vacatures, en noteert wat je opvalt.
- **Human-assisted** *(nu)* — de agent verzamelt letterlijke citaten, gradeert elk signaal
  sterk, midden of zwak, en levert een ICP plus de vragen die alleen een echt gesprek beantwoordt.
- **Fully autonomous** — niet van toepassing. De agent kan geen klantgesprek voeren, en een
  ICP zonder één echt gesprek is een hypothese, geen bevinding.

## De SOP

1. **Hypothese stellen.** Eén toetsbare zin: deze groep heeft dit probleem en lost het nu zo op.
   Benoem wat hem zou weerleggen.
2. **Vindplaatsen zoeken.** Waar praat deze groep ongevraagd: reviews, vakforums, communities,
   vacatures, supportthreads. Datum van elk signaal noteren.
3. **Citaten verzamelen.** Letterlijk, niet geparafraseerd. Per citaat: wat wilden ze, wat ging
   mis, wat kostte het, wat deden ze daarna. Gradeer sterk, midden of zwak.
4. **Alternatieven mappen.** Inclusief handmatig doen en niets doen — die laatste is de meest
   voorkomende concurrent en de moeilijkste om te verslaan.
5. **Betaalsignalen lezen.** Niet vragen wat ze zouden betalen, maar kijken wat ze al betalen.
   Bestaat er al budget, of moet dat gecreëerd worden?
6. **ICP opstellen.** Plus vijf tot acht niet-sturende interviewvragen voor wat je zelf moet halen.

Volledige uitwerking: `workflows/customer-research-agent.md`
