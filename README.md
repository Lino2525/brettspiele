# Brettspiele

Zwei bis vier (Lieder-Raten: bis zehn) Personen spielen zusammen im Browser, egal wo. Kein Server, keine Kosten:
Die Browser verbinden sich direkt (WebRTC über PeerJS), ein Spieler ist der Host.

## Lokal starten

Im Terminal von IntelliJ (Alt+F12) im Projektordner:

```
node serve.js
```

Dann <http://localhost:8080> öffnen. Zum Ausprobieren allein: ein zweites Fenster mit
<http://127.0.0.1:8080> öffnen (andere Adresse = getrennter Speicher = zweiter Spieler).

Tests der Spielregeln: `node --test tests/*.test.mjs`

## Mit der Mitspielerin spielen

Die Seite muss im Internet erreichbar sein (z. B. GitHub Pages, Netlify oder Cloudflare Pages,
alle kostenlos). Es ist eine rein statische Seite, hochgeladen wird der ganze Ordner.
Danach: Host klickt "Mini Rummy starten", kopiert den Einladungslink und schickt ihn. Sobald 2 bis 4 Personen in der Lobby sind, startet der Host mit "Spiel starten" (danach kann niemand Neues mehr beitreten, wer rausfliegt kommt aber zurück).

## Zugangsschutz

- Raumcode: 6 Zeichen, nur mit dem Code (oder Link) kommt man in einen Raum. Ist der Raum voll oder das Spiel gestartet, kommt niemand Neues mehr rein.
- Raumpasswort (optional): Der Host trägt es vor dem Start ein, der Gast beim Beitreten. Der Browser merkt es sich.
  Wer schon einen Platz hat (z. B. nach Neuladen), braucht es nicht erneut. Falsche Eingaben werden 1,5 s verzögert.
- Die Seite selbst bleibt öffentlich (GitHub Pages), jeder kann dort aber nur eigene Räume anlegen.

## Avatar

Neben dem Namen kann man ein Bild auswählen. Es wird im Browser auf höchstens 300 px verkleinert, nur im
`sessionStorage` des Tabs gehalten (weg beim Schließen) und über die Direktverbindung an die Person im selben
Raum geschickt. Es liegt nie auf einem Server und nie im Projekt. Angezeigt wird immer das Bild der Person am Zug.
Persönliche Bilder gehören **nicht** in diesen Ordner, denn das Repository ist öffentlich.

## Spiele

- **Mini Rummy** (2-4 Personen): Rummikub-Regeln, Wertung wie im Original.
- **Immobilienspiel** (2-4 Personen, Handelsspiel nach klassischem Vorbild; intern "monopoly"): deutsche Straßennamen, alle Regeln: Würfeln (Pasch, dreimal Pasch), Kaufen und
  Versteigern, Miete mit Farbgruppen, Häusern und Hotels (gleichmäßig bauen, begrenzter Vorrat), Bahnhöfe und Werke,
  Steuern, Gefängnis (Geld, Freikarte, Pasch, dritter Versuch), Ereignis- und Gemeinschaftskarten, Hypotheken,
  Handel (Geld, Grundstücke, Freikarten), Schulden und Bankrott. Alle sehen Würfel, Figuren und Karten live.
  Bauen, Hypotheken und Verkäufe sind nur im eigenen Zug möglich (oder bei eigenen Schulden).

- **Lieder-Raten** (2-10 Personen): kurze Ausschnitte (5 s) bekannter Hits erraten, Titel oder Künstler tippen.
  Wertung: Titel 1 Punkt, Künstler 1 Punkt, beides in einer Runde +1 Bonus, wer Titel bzw. Künstler als Erste/r errät +1.
  20 Runden pro Durchgang, danach "Weitere 20 Runden" (Songs wiederholen sich nicht, auch nicht bei einem neuen Spiel,
  der Host merkt sich die gespielten Songs im Browser). Nach 10 s und 20 s gibt es Hinweise (Wortlängen, Anfangsbuchstaben)
  und einen längeren Ausschnitt. Die Songliste (`js/games/songquiz/catalog.js`) enthält nur Titel und Künstler. Die Töne
  holt der Host zur Laufzeit über die kostenlose iTunes-Suche von Apple (30-Sekunden-Vorschau direkt von Apples Servern);
  es wird nichts gespeichert oder gehostet. Ohne Verbindung zu Apple funktioniert das Spiel nicht.

- **Sternenjagd** (2-6 Personen, Partyspiel mit Spielfeld und Minispielen): Rundkurs mit 28 Feldern (blau +3, rot −3,
  grün = Glücksfeld mit Zufallsereignis), Stern auf dem Brett (kauft man im Vorbeigehen für 5 Münzen, er wandert danach).
  Nach jeder Runde (alle haben gewürfelt) spielen alle ein Minispiel: Volltreffer (richtiger Moment), Korbwurf, Blitzreaktion,
  Tipp-Marathon, Merkreihe, Kopfrechnen, Wissen (Allgemeinwissen), Flaggen (Flaggenbilder von flagcdn.com) und
  Zeichnen & Raten. Belohnung: 1. Platz 10 Münzen, 2. 6, 3. 4, sonst 2; in Sternrunden (jede dritte und die letzte)
  gewinnt der Erste einen Stern. Am Ende zählt ein Stern 10 Münzen. Rundenzahl (5-15) wählt der Host in der Lobby.
  Inhalte (Fragen, Flaggen, Begriffe) stehen in `js/games/party/data.js`. Eigenständiges Design, keine geschützten Figuren.

## Musik

Beim Spielstart läuft ruhige Klaviermusik in Endlosschleife (d-Moll, getragen, leicht dramatisch, mit leisem Wind).
Sie wird **live im Browser erzeugt** (`js/core/piano.js`, Web Audio): keine Audiodatei, nichts zu hosten, komplett
eigenkomponiert. Jeder hört sie lokal (nicht synchron). Oben gibt es Stummschalter und Lautstärkeregler, die
Einstellung wird gemerkt. Tempo, Akkorde, Klangfarbe und Pegel lassen sich oben in `piano.js` anpassen.

## Aufbau

- `js/core/session.js`: Verbindung (Host hält den Spielstand, Gast schickt Aktionen)
- `js/games/<spiel>/rules.js`, `engine.js`, `ui.js`: Regeln, Spielablauf, Oberfläche
- `js/games/monopoly/`: `board.js` (Plan, Karten, Regelfunktionen), `engine.js` (Ablauf), `board-view.js`, `trade-ui.js`, `ui.js`
- `js/main.js`: Lobby, hier werden neue Spiele in `GAMES` eingetragen
