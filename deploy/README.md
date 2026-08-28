# De hub op een VPS

Voor als je hem vanaf je telefoon wilt bekijken zonder dat je laptop aanstaat.

## Vooraf: wat je hier eigenlijk doet

De hub is gebouwd als lokaal gereedschap. Zet je hem op een server aan het
internet, dan staat je marktonderzoek in principe voor iedereen open die je
IP-adres vindt — en er zit een schrijf-API in.

Daarom heeft de hub nu een wachtwoord. Dat gaat automatisch aan zodra hij buiten
de eigen computer bereikbaar is, of zodra `HUB_PASSWORD` is gezet. Vijf foute
pogingen en het adres zit een minuut op slot.

Dat is genoeg voor een privédashboard. Het is geen bankbeveiliging: zet er geen
klantgegevens of wachtwoorden in.

## Route 1 — Tailscale, zonder open poorten (het veiligst)

Als je geen domeinnaam hebt, is dit beter dan een poort openzetten. Je server en
je telefoon komen in hetzelfde privénetwerk. Er hoeft niets open te staan.

Op de server:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Installeer de Tailscale-app op je telefoon en log in met hetzelfde account.
Start daarna de hub op de server:

```bash
cd ~/Agent
HOST=0.0.0.0 HUB_PASSWORD='kies-iets-langs' npm start
```

Je bereikt hem op `http://<tailscale-naam>:4317`. Alleen jouw apparaten kunnen
erbij; de poort staat niet open naar het internet.

Wil je dat hij blijft draaien na afsluiten van je sessie, gebruik dan het
installatiescript hieronder en sla de firewall-stap over.

## Route 2 — Met een domeinnaam (aanbevolen bij open internet)

Je hebt een domein of subdomein nodig dat naar het IP van je VPS wijst
(een A-record, bijvoorbeeld `hub.jouwdomein.nl`).

```bash
git clone https://github.com/koenferdi/Agent.git
cd Agent
sudo bash deploy/setup-vps.sh
```

Kies **optie 1** en vul je domein in. Het script:

1. installeert Node 20
2. maakt een systemd-service die de hub start bij het opstarten van de server
3. installeert Caddy, dat automatisch een HTTPS-certificaat regelt
4. zet de firewall aan met alleen 22, 80 en 443 open — poort 4317 blijft dicht
5. verzint een wachtwoord en toont het aan het eind

De hub zelf luistert alleen op `127.0.0.1`. Caddy is het enige dat van buiten
bereikbaar is. Verkeer is versleuteld.

## Route 3 — Alleen een IP-adres, zonder HTTPS

Zelfde script, **optie 2**. Poort 4317 gaat open en je bereikt hem op
`http://<ip>:4317`.

Werkt, maar je wachtwoord reist onversleuteld over het internet en iedereen die
meeleest op het netwerkpad kan het onderscheppen. Doe dit alleen tijdelijk. Een
subdomein kost een paar euro per jaar en lost het definitief op.

## Beheer

```bash
sudo systemctl status validatiedesk      # draait hij?
sudo systemctl restart validatiedesk     # herstarten
sudo journalctl -u validatiedesk -f      # meekijken
```

Wachtwoord kwijt:

```bash
sudo grep HUB_PASSWORD /etc/systemd/system/validatiedesk.service
```

Wachtwoord wijzigen: pas die regel aan, dan
`sudo systemctl daemon-reload && sudo systemctl restart validatiedesk`.

## Bijwerken

```bash
cd ~/Agent && git pull origin main && sudo systemctl restart validatiedesk
```

## Wat de service mag

De systemd-unit is dichtgezet: geen nieuwe rechten, alleen-lezen op je home-map,
en schrijfrechten op precies twee mappen — `hub/` voor `desk.json` en `drafts/`
voor de rapporten. Verder kan hij nergens bij.

## Wat hierdoor verandert in het werk

De hub op de server leest de bestanden *op die server*. Draait Claude Code op je
laptop, dan komen nieuwe rapporten daar terecht en niet op de VPS. Je haalt ze
op met `git push` vanaf je laptop en `git pull` op de server. Vergeet dat niet,
anders kijk je op je telefoon naar een oude stand.
