# Fly Circuit Lab — virtuele geuromgeving

Een zelfstandig Python-script met Flask, NumPy en een ingebouwd mobiel dashboard.
Het bevat 144 synthetische LIF-neuronen en een gesloten sensorimotorische lus:

**positie → geur links/rechts → sensorische activiteit → centrale neuronen → motoractiviteit → nieuwe positie**

Dit is een werkend computationeel prototype, geen empirisch gevalideerde digitale
kopie van een fruitvlieg en geen reproductie van Melius FlyBreak. Er zijn geen
anatomische datasets of API-sleutels nodig. Er wordt geen werkelijk connectoom
geclaimd. De voedselbeloning wordt gemeten, maar verandert de gewichten niet:
er is nog geen reinforcement learning en geen garantie dat de vlieg voedsel vindt.

## Snel starten (Linux, Python 3.10 of hoger)

Pak de ZIP uit en open de map `fly-circuit`.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Kies bij de prompt een sterk wachtwoord van minimaal 20 tekens. Open lokaal
http://127.0.0.1:8000 en meld aan met gebruikersnaam **fly** en dat wachtwoord.
Het wachtwoord wordt bij invoer niet getoond en niet door de applicatie opgeslagen.
Gebruik voor lokaal uitproberen dezelfde computer als waarop Python draait.

`python app.py` start Waitress; de Flask-ontwikkelserver en debugger staan niet aan.
Er draait precies één simulatie voor alle browsers. Open de app nooit met meerdere
WSGI-processen: iedere process zou een eigen onafhankelijke wereld krijgen.

## Veilig vanaf je telefoon via een VPS

De applicatie luistert bewust uitsluitend op `127.0.0.1`. De poort 8000 is dus
niet direct bereikbaar vanaf internet. HTTP Basic-authenticatie moet buiten
loopback altijd via TLS of een versleutelde SSH-tunnel lopen.

**Optie A — SSH-tunnel, zonder domein**

Start Python op je VPS. Maak in je telefoon-SSH-client een lokale port forward:

- SSH-host: jouw VPS; aanmelden met je bestaande SSH-account.
- Lokale luisterpoort: 8000, alleen loopback.
- Remote bestemming: `127.0.0.1`, poort `8000`.

Houd de SSH-verbinding open en open op dezelfde telefoon http://127.0.0.1:8000.
De SSH-tunnel versleutelt het netwerkverkeer; het lokale HTTP-deel verlaat je
telefoon niet. Stel bij deze optie geen `FLY_PUBLIC_ORIGIN` in.

Een equivalente tunnel vanaf een computer is:

```bash
ssh -N -L 8000:127.0.0.1:8000 jouw-gebruiker@jouw-vps
```

**Optie B — HTTPS met eigen domein en Caddy**

Laat een eigen subdomein naar je VPS wijzen en gebruik een bestaande Caddy-installatie.
Laat alleen SSH en de vereiste HTTP/HTTPS-poorten door je VPS-firewall toe. Houd
8000 afgeschermd. Gebruik voor bijvoorbeeld `fly.jouwdomein.nl` deze Caddy-siteconfiguratie:

```caddyfile
fly.jouwdomein.nl {
    reverse_proxy 127.0.0.1:8000 {
        flush_interval -1
    }
}
```

Vervang het voorbeeldsubdomein door je eigen domein. Start de app met dezelfde origin:

```bash
export FLY_PUBLIC_ORIGIN=https://fly.jouwdomein.nl
python app.py
```

Open daarna `https://fly.jouwdomein.nl` op je telefoon. Configureer Caddy volgens
zijn officiële installatiehandleiding en controleer dat het certificaat geldig is.
Er is geen TLS-configuratie nodig in Python. Gebruik geen onbeveiligde publieke
HTTP-verbinding en omzeil geen certificaatwaarschuwingen. Deze oplevering heeft
niets op je VPS geïnstalleerd of gepubliceerd.

Voor een permanente dienst kun je `FLY_PASSWORD` via een afgeschermd environment-
bestand aan systemd aanbieden. Laat de service als gewone gebruiker draaien en
stel `WorkingDirectory` in op de projectmap, met `ExecStart` naar de venv-Python en
`app.py`. Beveilig het environment-bestand met alleen leesrechten voor de benodigde
gebruiker. Plaats geheimen niet in een URL, sourcecode of een gedeeld shellcommando.

Basic-authenticatie heeft geen betrouwbare browserbrede uitlogknop. Sluit alle
privétabs om een privésessie te beëindigen; herstart de server met een nieuw
wachtwoord om bestaande credentials ongeldig te maken. Streams vernieuwen elke
30 seconden en authenticeren dan opnieuw.

## Wat de wereld doet

- Ruimte: 100 × 100 arbitraire eenheden; startpositie `(25, 70)`.
- Voedselbron: `(75, 30)` met bezoekradius 6. De bron wordt niet opgegeten.
- Geurveld: `exp(-afstand² / (2 * 38²))`, tussen 0 en 1.
- Twee antennes liggen 5 eenheden voor de vlieg, onder hoeken van ±0,65 radiaal.
- Neuronen 0–15 ontvangen de linkergeur; 16–31 de rechtergeur.
- Centrale neuronen 32–71 en 72–111 verwerken vooral links respectievelijk rechts.
- Motorneuronen 112–127 sturen vooruit, 128–135 linksom, 136–143 rechtsom.
- De bron beïnvloedt geen directe navigatieregel. Alleen motor-spikes sturen
  snelheid en draaien; bij een muur wordt de bewegingsrichting fysiek gereflecteerd.
- De baan toont de laatste 300 samples, ongeveer 30 seconden simulatietijd.
- Beloning: `exp(-afstand² / (2 * 6²))`. Het systeem meet ook de integraal van
  beloning en verblijftijd binnen de bezoekradius, zonder de gewichten te trainen.

Canvascoördinaten: X naar rechts, Y naar beneden. Een negatieve draai is linksom.
Een sterke prikkel garandeert geen doelgerichte navigatie: er zijn ook inhibitie,
ruis, recurrente verbindingen en willekeurige asymmetrieën in dit mock-netwerk.

## Neurodynamica en eenheden

De integratiestap is 1 ms; de membraantijdconstante 20 ms, de synaptische
vervaltijd 10 ms, de rust/resetpotentiaal −65 mV, de drempel −50 mV en de
refractaire periode 3 ms. Gewichten zijn synthetische drive-eenheden, geen
synapsaantallen of gemeten conductanties. Uitgaande verbindingen van elke cel
hebben hetzelfde teken; ongeveer 20% van de neuronen is inhiberend.

Voor een niet-refractaire cel:

```text
V += (V_rest - V + drive) * dt/tau_m + sigma * sqrt(dt/tau_m) * N(0,1)
```

De sensorische drive vóór modulatie is:

```text
10 + 32 * stimulation * (0.35 + 0.65 * antennageur)
```

Het tonische aandeel van 0,35 laat de vlieg ook buiten de sterkste geurzone
activiteit vertonen. `stimulation` is dus sensorische versterking, niet het
verplaatsen van de geurbron. Centrale en motorcellen hebben een basisdrive van 10.

Bij `e = ethanol_concentration`:

- Alle drive wordt vermenigvuldigd met `1 - 0.65 * e`.
- Ruisamplitude wordt `1.8 + 4 * e`.
- Nieuwe spikes worden afgeleverd na `2 + round(10 * e)` ms.
- Reeds ingeplande spikes behouden hun bestaande aankomsttijd.

Deze dimensieloze ethanolparameter is geen bloedalcoholwaarde of gevalideerde
Drosophila-dosisrespons. De voedselgeur en ethanolinstelling zijn onafhankelijk:
naderen van voedsel verhoogt dus niet automatisch de ethanolwaarde.

De motoractiviteit wordt gefilterd met een tijdconstante van 50 ms:

```text
snelheid = 18 * clip(mean_forward_rate / 60, 0, 1)
draaisnelheid = 2.8 * clip((mean_right_rate - mean_left_rate) / 60, -1, 1)
```

Snelheid is in ruimte-eenheden/seconde, draaien in radialen/seconde. De motorfilter
kan kort na een spike doorwerken, maar een ongeprikkeld filter veroorzaakt geen
beweging. De positie wordt op elke integratiestap bijgewerkt, niet alleen bij een
browserupdate. Afhankelijk van de netwerkinstellingen kan de snelheid verzadigen.

## Module-indeling in app.py

| Onderdeel | Verantwoordelijkheid |
|---|---|
| `Connectome` | 144 neuronen, drie groepen, celtype, kanaal, layout en gewichten |
| `VirtualEnvironment` | Geurveld, antennes, motor-decoder, positie en beloning |
| `LIFNetwork` | Membraanpotentiaal, ruis, refractaire periode en vertraagde synapsen |
| `Simulation` | Eén producerthread, snapshots, locks en begrensde streams |
| `create_app` | Auth, validatie, API, headers en dashboard |
| `PAGE` | Ingebouwde HTML, CSS en JavaScript; geen externe CDN's |
| `main` | Wachtwoord/configuratie, starten en afsluiten van Waitress |

Een echt connectoom vraagt een aparte data-adapter en expliciete biologische
kalibratie. Alleen een `fafbseg`-export laden maakt dit model niet tot een digitale
twin. De huidige motor- en sensormapping gaat expliciet uit van de 144 cellen;
voor een andere populatiegrootte moeten ook deze mappings worden aangepast.

## API en streaming

Alle routes vereisen HTTP Basic-authenticatie. Controle-POSTs vereisen bovendien
`Content-Type: application/json`, de exacte `Origin` en `X-FlyLab-Control: 1`.
Geen permissieve CORS; invoer wordt server-side begrensd op eindige getallen 0–1.

| Route | Methode | Functie |
|---|---|---|
| `/` | GET | Dashboard |
| `/api/connectome` | GET | Volledige synthetische graaf en celkanalen |
| `/api/metrics` | GET | Laatste snapshot; 503 bij opstart of simulatiefout |
| `/api/events` | GET | SSE met `metrics`-events, ID en automatische herverbinding |
| `/api/controls` | POST | Eén of beide controles bijstellen |
| `/api/reset` | POST | `{}`: trial en wereld resetten, huidige controles behouden |

De snapshot bevat onder andere:

- `trial_timestamp_s`: verstreken simulatietijd; `timestamp_utc`: uitzendtijd.
- `spikes`: aantal spikes in het laatste 100 ms-venster.
- `total_spikes`: totaal sinds reset, ook als een browser niet verbonden was.
- `active_neuron_count` / `active_ids`: unieke actieve cellen in datzelfde venster.
- `firing_rates_hz`: gemiddelde Hz per neuron per groep, over maximaal de laatste seconde.
- `environment`: X/Y, heading, bron, afstand, antennegeuren, motor-kanalen, spoor en beloning.
- `compute_ms`: rekentijd van de frame-update.

Er zijn maximaal acht SSE-verbindingen tegelijk; de server gebruikt zestien
requestthreads. De stream gebruikt steeds de laatste snapshot. Een trage of
herverbindende client krijgt geen replay van alle gemiste frames; totalen blijven
server-side wel doorlopen. Gebruik dit prototype voor een kleine persoonlijke
installatie, niet als schaalbare publieke simulatieservice. Bij een trage machine
loopt simulatietijd langzamer dan wandkloktijd, zonder grotere numerieke tijdstappen.

Alle gebruikers delen de controls en reset. Er zijn geen afzonderlijke rollen,
accounts of opgeslagen trials. Er is een begrensde globale throttle voor mislukte
authenticatie; een publieke productieomgeving kan extra proxy-rate-limiting gebruiken.

## Verificatie

```bash
python -m unittest -v
```

Zeven geautomatiseerde tests controleren de mock-graaf, reproduceerbaarheid,
spike- en rate-accounting, stabiliteit bij ethanol 0 en 1, geurcausaliteit,
vooruit/links/rechts-aansturing, beloning, reset, authenticatie, invoercontrole,
HTTPS-origin-controle en het vrijgeven van SSE-capaciteit.

Getest met Python 3.12, Flask 3.1.3, NumPy 2.3.5 en Waitress 3.0.2.
De dependency-ranges zijn geen lockfile; leg de exacte geïnstalleerde versies vast
als je reproduceerbare deployments nodig hebt.

## Referenties

- Flask + Waitress: https://flask.palletsprojects.com/en/stable/deploying/waitress/
- Flask streaming responses: https://flask.palletsprojects.com/en/stable/patterns/streaming/
