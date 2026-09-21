# Fly Circuit Lab op je VPS

Eén commando op de server, de rest gaat vanzelf.

```bash
cd ~/Agent && git pull origin main
sudo bash fly-circuit/deploy/setup-vps.sh
```

Het script vraagt één ding: wil je een domeinnaam of een SSH-tunnel.

## Wat het script doet

1. Controleert of Python 3.10 of hoger aanwezig is
2. Maakt een virtuele omgeving in `fly-circuit/.venv` en installeert Flask, NumPy en Waitress
3. Verzint een wachtwoord van 29 tekens en zet het in `/etc/flylab.env` (rechten 600, alleen root)
4. Maakt een systemd-service `flylab` die bij het opstarten van de server meestart
5. Bij optie 1: installeert Caddy en regelt automatisch een HTTPS-certificaat
6. Zet de firewall goed — poort 8000 gaat nooit open
7. Controleert of de simulatie echt antwoordt en toont je het wachtwoord

## De twee routes

**Optie 1 — domeinnaam.** Je hebt een A-record nodig dat naar het IP van je VPS
wijst, bijvoorbeeld `vlieg.jouwdomein.nl`. Caddy regelt HTTPS. Je opent het
dashboard gewoon in je browser, ook op je telefoon.

**Optie 2 — SSH-tunnel.** Geen domein nodig en er gaat geen poort open. Je zet
zelf een tunnel op:

```bash
ssh -N -L 8000:127.0.0.1:8000 jouw-gebruiker@jouw-vps
```

Daarna open je `http://127.0.0.1:8000`. Zolang de tunnel openstaat werkt het.

## Draait de hub al op dezelfde server?

Dat kan naast elkaar. De hub gebruikt poort 4317, deze app 8000. Staat er al
een Caddyfile, dan plakt het script zijn blok eronder en maakt eerst een
back-up. Gebruik wel een ander subdomein dan de hub.

## Beheer

```bash
sudo systemctl status flylab      # draait hij?
sudo systemctl restart flylab     # herstarten
sudo journalctl -u flylab -f      # meekijken
sudo grep FLY_PASSWORD /etc/flylab.env   # wachtwoord kwijt
```

Wachtwoord veranderen: pas `/etc/flylab.env` aan en doe `sudo systemctl restart flylab`.
Alle bestaande aanmeldingen vervallen dan.

## Wat je moet weten voor je hem openzet

- **Iedereen met het wachtwoord deelt dezelfde simulatie.** Er is één trial voor
  alle kijkers. Wie aan een schuifknop draait of op reset drukt, doet dat voor
  iedereen. Er zijn geen aparte accounts of rollen.
- **Er is geen uitlogknop.** HTTP Basic-authenticatie kent die niet betrouwbaar.
  Sluit al je privétabs, of herstart de service met een nieuw wachtwoord.
- **Maximaal acht kijkers tegelijk** met een live stream. De negende krijgt een
  nette 503.
- **De app luistert alleen op 127.0.0.1.** Dat is bewust en moet zo blijven:
  HTTP Basic zonder TLS geeft je wachtwoord leesbaar weg.
- **Verbruik:** ongeveer 56 MB geheugen en 15–20% van één CPU-kern, continu,
  ook als er niemand kijkt. De simulatie stopt nooit uit zichzelf. Op een kleine
  VPS met één kern is dat merkbaar naast andere diensten.

## Niet meer nodig?

```bash
sudo systemctl disable --now flylab
sudo rm /etc/systemd/system/flylab.service /etc/flylab.env
sudo systemctl daemon-reload
```

Haal daarna zelf het blok voor je subdomein uit `/etc/caddy/Caddyfile` en doe
`sudo systemctl reload caddy`.
