# Parkingsoft – Flughafen-Parkanbieter

Kleine Webapp ohne Login und ohne Abhängigkeiten, um Anbieter von Mietparkplätzen an deutschen Flughäfen
(Park & Fly mit Shuttle, Valet-Parken, Parkhäuser, Flughafengesellschaften) als mögliche Kunden zu sammeln.

## Starten

```
node server.js
```

Dann im Browser http://localhost:3100 öffnen.

## Funktionen

- Liste mit Name, Flughafen, Ort, Typ, E-Mail, Telefon, Webseite, Status, Notizen und Quelle
- Suche, Filter (Flughafen, Typ, Status), Sortierung per Klick auf den Spaltenkopf
- Haken „Frankfurt ausblenden“: blendet alle Anbieter am Flughafen Frankfurt oder mit Ort Frankfurt aus (Frankfurt-Hahn bleibt sichtbar)
- Anbieter anlegen, bearbeiten, löschen; Vertriebsstatus Neu → Kontaktiert → Interessiert → Kunde / Kein Interesse
- CSV-Export (für Excel, Semikolon-getrennt)

## E-Mail-Versand

1. Passwort in `.env` bei `NUXT_SMTP_PASS=` eintragen (Sonderzeichen wie `#`: Wert in Anführungszeichen setzen). Ein Neustart ist nicht nötig.
2. In der Liste die Haken bei den gewünschten Empfängern setzen, dann „E-Mail senden“. Der Haken im Tabellenkopf wählt alle
   sichtbaren Anbieter mit E-Mail aus, er berücksichtigt also die gesetzten Filter.
3. Text schreiben, „Testmail an mich“ prüfen, „An Auswahl senden“ bestätigen.

Vorlagen: Im Menüpunkt „E-Mail-Vorlagen“ anlegen, bearbeiten und löschen, oder im Sendefenster „Als Vorlage speichern“
wählen. Beim Versand werden sie über die Auswahlliste geladen. Jede Vorlage hat einen Plaintext und optional eine
HTML-Version, gesendet werden beide als gemeinsame Mail. Sie liegen in `data/vorlagen.json`, die Platzhalter {{name}} und {{flughafen}} funktionieren auch dort.

Es geht nur an ausgewählte Einträge, jeder Empfänger bekommt eine eigene Mail, mit 2 Sekunden Abstand.
Anbieter mit Status „Neu“ wechseln nach dem Versand auf „Kontaktiert“. Protokoll: `data/versand.json`.

Kopie: Ist `NUXT_KOPIE_AN` gesetzt, geht von jeder Mail eine Kopie an diese Adresse. Im An-Feld steht der Empfänger, die Kopie zählt nicht als Öffnung.

Testmodus: Ist `NUXT_TEST_EMPFAENGER` in `.env` gesetzt, gehen alle Mails nur an diese Adresse. Der Betreff nennt den
eigentlichen Empfänger, der Status bleibt unverändert und der Anbieter gilt nicht als angeschrieben.

Sperrliste: Firmen in `data/sperrliste.json` (Firma, Name, Domain, Telefon) werden nie angezeigt, importiert, angelegt oder angeschrieben.

## Öffnungserkennung

Jede Mail enthält ein unsichtbares Bild von `NUXT_TRACKING_URL` (`/o/<id>.gif`). Die App holt die Öffnungen jede Minute
über `/stats` mit `NUXT_TRACKING_TOKEN` ab und trägt sie in `data/versand.json` ein. Der Server braucht ein gültiges
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
