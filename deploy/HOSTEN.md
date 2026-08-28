# AI-dossier zelf hosten op Ubuntu

De site is volledig statisch: html, css en javascript, verder niets. Geen PHP, geen Node,
geen database. Elke webserver kan het serveren; deze handleiding gaat uit van Ubuntu met
nginx, omdat dat het kortste pad is.

Alle verwerking gebeurt in de browser van de bezoeker. Er komt dus ook geen bedrijfsinformatie
op jouw server terecht — dat scheelt je een hoop zorgen over back-ups en de AVG.

## Wat je nodig hebt

- Een Ubuntu-server (22.04 of 24.04) waar je met ssh op kunt
- Een domein waarvan de A-record naar het IP-adres van die server wijst
- Ongeveer een kwartier

## Stap 1 — pakket maken met jouw domein erin

Op je eigen computer, in de projectmap:

```bash
./package.sh ai-dossier.nl
```

Dat schrijft `dist/ai-dossier-ai-dossier.nl-<datum>.tar.gz`. In dat pakket is jouw domein al
ingevuld in `sitemap.xml`, `robots.txt`, de canonieke link in `index.html` en de
nginx-configuratie. Draai je `./package.sh` zonder domein, dan blijft overal `jouwdomein.nl`
staan en wijst je sitemap naar niets.

## Stap 2 — naar de server kopiëren

```bash
scp dist/ai-dossier-ai-dossier.nl-*.tar.gz gebruiker@jouw-server:~
ssh gebruiker@jouw-server
tar -xzf ai-dossier-*.tar.gz
cd ai-dossier
```

## Stap 3 — nginx installeren en de site neerzetten

```bash
sudo apt update && sudo apt install nginx
sudo ./installeer.sh
```

`installeer.sh` kopieert de map `site/` naar `/var/www/jouwdomein.nl`, zet de rechten goed,
installeert het serverblok, controleert de configuratie met `nginx -t` en herlaadt nginx.
Het script stopt met een duidelijke melding als er iets niet klopt, en het overschrijft niets
buiten je eigen domeinmap.

Liever met de hand? Dat is precies dit:

```bash
sudo mkdir -p /var/www/ai-dossier.nl
sudo cp -r site/. /var/www/ai-dossier.nl/
sudo chown -R www-data:www-data /var/www/ai-dossier.nl
sudo cp nginx/ai-dossier.nl.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/ai-dossier.nl.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Staat de standaardpagina van nginx nog in de weg, haal die dan weg:
`sudo rm /etc/nginx/sites-enabled/default`.

## Stap 4 — https

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ai-dossier.nl -d www.ai-dossier.nl
```

Certbot past het serverblok zelf aan, zet de omleiding van http naar https klaar en vernieuwt
het certificaat automatisch. Controleer dat laatste een keer met `sudo certbot renew --dry-run`.

## Stap 5 — firewall

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## Stap 6 — controleren

- Open `https://ai-dossier.nl` en doe de scan helemaal af
- Test op je telefoon, niet alleen in een smal browservenster
- Controleer `https://ai-dossier.nl/robots.txt` en `/sitemap.xml`: staat je echte domein erin?
- Ontgrendel met de backupcode uit `CONFIG.BACKUP_CODES` en genereer alle vijf documenten
- Print er één naar pdf en kijk of de paginaovergangen kloppen

## Betalingen aanzetten

In `assets/app.js` staat bovenaan het `CONFIG`-blok. `UNLOCK_TOKEN` is al gevuld met een
willekeurige waarde; die neem je over in Stripe. Wat je zelf invult:

- `PAY_URL` — je Stripe Payment Link van € 149
- `LEAD_ENDPOINT` — je Formspree- of Web3Forms-adres
- Bij Stripe: zet de redirect-URL op `https://ai-dossier.nl/?ok=<UNLOCK_TOKEN>`

Wijzig je `CONFIG`, dan moet je opnieuw paketteren en uploaden. De browser van je bezoekers
houdt css en js een uur vast, dus wacht na een update even, of ververs hard met ctrl+F5.

## Een update uitrollen

```bash
./package.sh ai-dossier.nl                       # op je eigen computer
scp dist/ai-dossier-*.tar.gz gebruiker@server:~  # uploaden
ssh gebruiker@server 'tar -xzf ai-dossier-*.tar.gz && cd ai-dossier && sudo ./installeer.sh'
```

`installeer.sh` overschrijft alleen de sitebestanden en herlaadt nginx. Je certificaat en je
https-instellingen blijven staan, want die zitten in het serverblok dat certbot beheert.

## Strenger afsluiten

Het serverblok zet al `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` en
`Permissions-Policy`. Een Content-Security-Policy staat er bewust niet in, omdat die afhangt
van wat jij invult. Zodra `LEAD_ENDPOINT` bekend is kun je deze regel toevoegen aan het
serverblok, met jouw endpoint-host in `connect-src`:

```nginx
add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' https://formspree.io; form-action 'none'; frame-ancestors 'self'; base-uri 'self'" always;
```

Twee dingen om te weten voordat je dit aanzet. `'unsafe-inline'` bij `script-src` is nodig
omdat de FAQ-structured-data als `application/ld+json` in de pagina staat; zonder die
toestemming negeert de browser dat blok en verlies je je zoekresultaatweergave. En klopt
`connect-src` niet, dan faalt de verzendknop onder de scanuitkomst zonder zichtbare reden.
Test het dus na, met de ontwikkelaarsconsole open.

## Zonder domein alvast kijken

Wil je het eerst op het IP-adres van de server zien: zet in het serverblok `server_name _;`
en laat de https-stap over. Je sitemap en canonieke link wijzen dan nog naar de plaatshouder,
dus doe dit alleen om te kijken, niet om vindbaar te zijn.
