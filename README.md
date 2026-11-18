# Parkingplan – Flughafen-Parkanbieter

Webapp mit Login, um Anbieter von Mietparkplätzen an deutschen Flughäfen
(Park & Fly mit Shuttle, Valet-Parken, Parkhäuser, Flughafengesellschaften) als mögliche Kunden zu sammeln.

## Starten

```
node server.js
```

Dann im Browser http://localhost:3100 öffnen.

## Login

Alle Seiten und Schnittstellen sind nur nach dem Login erreichbar.

- Beim ersten Start wird ein Benutzer angelegt (Name `admin`) und ein Startpasswort einmal in der Konsole ausgegeben.
  Wer Name und Startpasswort selbst festlegen will, setzt vor dem ersten Start `NUXT_LOGIN_BENUTZER` und `NUXT_LOGIN_PASSWORT`
  als Umgebungsvariable.
- Passwort ändern: „Einstellungen“ → „Passwort ändern“. Danach sind alle anderen Geräte abgemeldet.
- Passwort vergessen: auf dem Server `node passwort-zuruecksetzen.js` ausführen, das gibt ein neues Passwort aus.
- Nach 5 Fehlversuchen ist die IP-Adresse 15 Minuten gesperrt. Eine Sitzung gilt 14 Tage.

## Im Web betreiben

Die App lauscht standardmäßig nur auf 127.0.0.1. Für den Betrieb im Internet gehört ein Reverse-Proxy mit HTTPS davor
(z.B. Caddy oder nginx), sonst gehen Passwörter unverschlüsselt durchs Netz.

| Variable | Bedeutung |
|---|---|
| `PORT` | Port, Standard 3100 |
| `HOST` | Adresse, auf der die App lauscht. Standard `127.0.0.1` (nur der Proxy auf demselben Server erreicht sie) |
| `NUXT_TRUST_PROXY=1` | Hinter einem Proxy setzen: dann zählen `X-Forwarded-For` (Sperre bei Fehlversuchen) und `X-Forwarded-Proto` (Cookie nur über HTTPS) |
| `NUXT_COOKIE_SECURE=1` | Cookie immer nur über HTTPS senden |
| `DATA_DIR` | Ordner für die Daten, Standard `./data` |

Beispiel Caddy: `crm.example.de { reverse_proxy 127.0.0.1:3100 }` und die App mit `NUXT_TRUST_PROXY=1` starten.

## Was nicht ins Git gehört

Der Ordner `data/` und die `.env` sind in `.gitignore`. Dort liegen Kundenliste, Versandprotokoll, Vorlagen, der
Benutzer mit Passwort-Hash (`data/benutzer.json`) und die Zugangsdaten (`data/einstellungen.json`). Auf einem neuen Server
startet die App mit leerer Liste. Bestehende Daten: den Ordner `data/` einmal per SCP/SFTP hinüberkopieren.

## Funktionen

- Liste mit Name, Flughafen, Ort, Typ, E-Mail, Telefon, Webseite, Status, Notizen und Quelle
- Suche, Filter (Flughafen, Typ, Status), Sortierung per Klick auf den Spaltenkopf
- Haken „Frankfurt ausblenden“: blendet alle Anbieter am Flughafen Frankfurt oder mit Ort Frankfurt aus (Frankfurt-Hahn bleibt sichtbar)
- Anbieter anlegen, bearbeiten, löschen; Vertriebsstatus Neu → Kontaktiert → Interessiert → Kunde / Kein Interesse
- CSV-Export (für Excel, Semikolon-getrennt)

## E-Mail-Versand

1. Unter „Einstellungen“ SMTP-Server, Port, Benutzer und Passwort eintragen, speichern und „Verbindung prüfen“. Ein Neustart ist nicht nötig.
   Die Werte liegen in `data/einstellungen.json`. Passwort und Tracking-Token werden in der App nie angezeigt, ein leeres Feld lässt sie unverändert.
   Eine vorhandene `.env` wird beim ersten Start einmal übernommen und danach nicht mehr gebraucht.
2. In der Liste die Haken bei den gewünschten Empfängern setzen, dann „E-Mail senden“. Der Haken im Tabellenkopf wählt alle
   sichtbaren Anbieter mit E-Mail aus, er berücksichtigt also die gesetzten Filter.
3. Text schreiben, „Testmail an mich“ prüfen, „An Auswahl senden“ bestätigen.

Vorlagen: Im Menüpunkt „E-Mail-Vorlagen“ anlegen, bearbeiten und löschen, oder im Sendefenster „Als Vorlage speichern“
wählen. Beim Versand werden sie über die Auswahlliste geladen. Jede Vorlage hat einen Plaintext und optional eine
HTML-Version, gesendet werden beide als gemeinsame Mail. Sie liegen in `data/vorlagen.json`, die Platzhalter {{name}} und {{flughafen}} funktionieren auch dort.

Es geht nur an ausgewählte Einträge, jeder Empfänger bekommt eine eigene Mail, mit 2 Sekunden Abstand.
Anbieter mit Status „Neu“ wechseln nach dem Versand auf „Kontaktiert“. Protokoll: `data/versand.json`.

Kopie: Ist unter „Einstellungen“ „Kopie an“ gesetzt, geht von jeder Mail eine Kopie an diese Adresse. Im An-Feld steht der Empfänger, die Kopie zählt nicht als Öffnung.

Testmodus: Ist unter „Einstellungen“ der Testmodus-Empfänger gesetzt, gehen alle Mails nur an diese Adresse. Der Betreff nennt den
eigentlichen Empfänger, der Status bleibt unverändert und der Anbieter gilt nicht als angeschrieben.

Sperrliste: Firmen in `data/sperrliste.json` (Firma, Name, Domain, Telefon) werden nie angezeigt, importiert, angelegt oder angeschrieben.

## Öffnungserkennung

Jede Mail enthält ein unsichtbares Bild von der Tracking-Adresse aus den Einstellungen (`/o/<id>.gif`). Die App holt die Öffnungen jede Minute
über `/stats` mit dem Tracking-Token ab und trägt sie in `data/versand.json` ein. Der Server braucht ein gültiges
HTTPS-Zertifikat. Die Werte sind Anhaltspunkte: Apple Mail lädt Bilder oft automatisch (falsche Treffer), viele
Mailprogramme blockieren sie (fehlende Treffer).

## Daten

- `data/kunden.json` – die Liste, die die App liest und schreibt
- `data/recherche.json` – recherchierte Anbieter. Beim ersten Start wird daraus `kunden.json` erzeugt.
- `node import.js` übernimmt später neu recherchierte Einträge aus `recherche.json`, ohne bestehende Einträge zu überschreiben.
- `data/archiv/` – die erste Recherche (Stadtparkhäuser DACH), nicht mehr in der App

## Herkunft der Daten (Stand 07.10.2026)

Anbieter aus den Vergleichsportalen parkplatzvergleich.de und parkos.de (je Flughafen), ergänzt um die
Flughafengesellschaften. Kontaktdaten stammen aus Impressum/Kontaktseite der jeweiligen Anbieter-Webseite.
Anbieter ohne eigene Webseite sind vermutlich nur über Portale buchbar – Kontakt dort leer.
