# Brettspiele

Zwei bis sechs (Lieder-Raten: bis zehn) Personen spielen zusammen im Browser, egal wo. Kein Server, keine Kosten:
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
Danach: Host wählt am Automaten eine Dose (z. B. Mini Rummy), tippt auf „Weiter“ und dann „Mini Rummy starten“, kopiert den Einladungslink und schickt ihn. Sobald 2 bis 4 Personen in der Lobby sind, startet der Host mit "Spiel starten" (danach kann niemand Neues mehr beitreten, wer rausfliegt kommt aber zurück).

## Verbindung über verschiedene Netze

Die Browser verbinden sich direkt (WebRTC). Damit das auch zwischen verschiedenen Netzen klappt (z. B. WLAN in
Deutschland und Mobilfunk in Serbien), nutzt `js/core/ice.js` mehrere STUN-Server (Google, Cloudflare) und als Relais
(TURN) den kostenlosen Server von PeerJS, auch über TCP. Das PeerJS-Relais hat keine Garantie; fällt es aus und lässt
eines der Netze keine direkte Verbindung zu (häufig im Mobilfunk), klappt es nur noch im selben Netz.

- **Verbindung prüfen** (Knopf im Startfenster): zeigt auf dem jeweiligen Gerät, ob die direkte Verbindung und das
  Relais erreichbar sind. Am besten auf beiden Geräten prüfen. Im Spiel zeigt die Leiste beim Gast
  „Verbunden (direkt)“ oder „Verbunden (über Relais)“.
- **Eigenes Relais (empfohlen, kostenlos):** bei einem TURN-Anbieter ein kostenloses Konto anlegen und die Zugangsdaten
  oben in `js/core/ice.js` eintragen: entweder die Adresse für die Zugangsdaten (`TURN_CREDENTIALS_URL`, z. B. bei
  Metered Open Relay) oder feste Zugangsdaten (`EXTRA_TURN`, z. B. ExpressTURN). Das PeerJS-Relais bleibt als Reserve.

Der Hintergrund (`nachtfeld.js`) fängt eigene Fehler ab, damit ältere Browser (z. B. Safari bis iOS 15) trotzdem
beitreten können.

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

- **Lieder-Raten** (1-10 Personen, auch allein spielbar): 20 Sekunden aus bekannten Hits erraten, Titel oder Künstler tippen.
  Wertung: Titel 1 Punkt, Künstler 1 Punkt, beides in einer Runde +1 Bonus, wer Titel bzw. Künstler als Erste/r errät +1.
  20 Runden pro Durchgang, danach "Weitere 20 Runden" (Songs wiederholen sich nicht, auch nicht bei einem neuen Spiel,
  der Host merkt sich die gespielten Songs im Browser). Der Ausschnitt läuft ohne Pause durch, auch während der
  Auflösung mit Cover, bis der nächste Song kommt. Nach 7 s und 14 s gibt es Hinweise (Wortlängen, Anfangsbuchstaben). Die Songliste (`js/games/songquiz/catalog.js`) enthält nur Titel und Künstler. Die Töne
  holt der Host zur Laufzeit über die kostenlose iTunes-Suche von Apple (30-Sekunden-Vorschau direkt von Apples Servern);
  es wird nichts gespeichert oder gehostet. Ohne Verbindung zu Apple funktioniert das Spiel nicht.

- **Sternenjagd** (2-6 Personen, Partyspiel mit Spielfeld und Minispielen): Wegenetz mit 65 Feldern (`js/games/party/board.js`).
  Der Rand des inneren Rechtecks und die lila Linie rechts sind Einbahnstraßen (Pfeile), alle anderen Wege gehen in beide
  Richtungen; umgedreht wird nur in einer Sackgasse. An Abzweigungen fragt das Spiel, wohin es geht (15 s Bedenkzeit,
  danach entscheidet der Zufall). Felder: blau +3, rot −3, ? = Glücksfeld mit Zufallsereignis, 🛡 Schild (3 Runden kann
  niemand einen Stern abnehmen), auf der lila Linie 4× Duell und 1× Teleport. Duell: Gegner wählen, beide spielen ein
  Geschicklichkeits-Minispiel, die anderen schauen mit Live-Zwischenstand zu; wer gewinnt, bekommt 1 Stern vom anderen
  (mit Schild oder ohne Stern bis zu 10 Münzen), bei Gleichstand passiert nichts. Teleport: auf Wunsch direkt zum Stern
  (und kaufen, wenn die Münzen reichen). Stern auf dem Brett: Wer vorbeikommt und genug Münzen hat, wird gefragt, ob er
  ihn für 5 Münzen kauft; er wandert danach mindestens 5 Felder weiter. Auf schmalen Handys im Hochformat wird das Brett
  gedreht angezeigt.
  Strategie: Vor jedem Wurf wählt man den normalen Würfel (1–6) oder den sicheren (2–4) und kann für 5 Münzen eine Falle
  auf das eigene Feld legen (eine pro Person; wer dort landet, zahlt bis zu 5 an die Person, danach ist die Falle weg).
  Beim Duell wählt man den Einsatz: ein Stern oder bis zu 10 Münzen. Am Ende gibt es Bonus-Sterne für die meisten
  Minispiel-Siege (Minispiel-Profi), die meisten gewonnenen Duelle (Duell-Champion) und den höchsten Münzstand
  (Münzmagnet); bei Gleichstand bekommen alle Besten einen. Unter dem Brett steht, wer gerade vorn liegt.
  Die Reihenfolge der Würfe bleibt immer gleich. Nach jeder Runde (alle haben gewürfelt) spielen alle ein Minispiel; erst kommen alle einmal dran (zufällige Reihenfolge, oben steht „Minispiel 3 von 20“), dann beginnt ein neuer Durchlauf: Volltreffer (richtiger Moment), Korbwurf, Blitzreaktion,
  Tipp-Marathon, Merkreihe, Kopfrechnen, Farbe oder Wort (Stroop), Stoppuhr, Maulwurf, Ausreißer (Farbton finden), Zahlenjagd (1 bis 25),
  Sortierblitz (links/rechts nach wechselnder Regel), Wissen (Allgemeinwissen), Flaggen (Flaggenbilder von flagcdn.com),
  Schätzfrage (wer der Zahl am nächsten liegt, gewinnt; Fragen in `data.js`) und Zeichnen & Raten. Belohnung: 1. Platz 10 Münzen, 2. 6, 3. 4, sonst 2; in Sternrunden (jede dritte und die letzte)
  gewinnt der Erste einen Stern. Am Ende zählt ein Stern 10 Münzen. Rundenzahl (5-15) wählt der Host in der Lobby.
  Inhalte (Fragen, Flaggen, Begriffe) stehen in `js/games/party/data.js`. Eigenständiges Design, keine geschützten Figuren.

- **Kritzelrennen** (2-6 Personen, ab 4 auch in zwei Teams; frei nach dem Zeichen-Brettspiel-Klassiker; intern "sketch"):
  Spielbrett als Schlangenlinie mit fünf Feldfarben: Gegenstand, Lebewesen & Orte, Tätigkeit, Schwierig, Allerlei
  (rund 400 Begriffe in `js/games/sketch/words.js`). Die Farbe unter der eigenen Figur bestimmt die Kategorie. Wer zeichnet,
  wählt einen von zwei Begriffen (15 s) und zeichnet ihn auf einem hellen Blatt (7 Stifte inkl. Radierer, 4 Strichstärken,
  Zurück, Blatt leeren, Aufgeben); die anderen tippen ihre Vermutung, Tippfehler werden verziehen. Nach 60 % der Zeit
  erscheinen die Anfangsbuchstaben. Einzeln: Klappt es, würfelt die zeichnende Person und zieht vor; wer zuerst rät, zieht
  2 Felder, jeder weitere Treffer 1 Feld; danach ist die nächste Person dran. Teams: Nur das eigene Team rät, bei Erfolg
  würfelt es und zeichnet gleich weiter (höchstens 3 Begriffe in Folge), sonst ist das andere Team dran. ★-Felder
  („Alle zeichnen“): In Teams zeichnen beide Teams denselben Begriff gleichzeitig, das schnellere Team würfelt und ist dran;
  einzeln zählt dort jeder Treffer 2 Felder. Wer zuerst im Ziel ist, gewinnt. Der Host wählt Brettlänge (25, 37 oder 49 Felder)
  und Zeichenzeit (45, 60 oder 90 s). Würfeln geht per Knopf, nach 10 s würfelt das Spiel selbst.

### Gesellschaftsspiele für 3 bis 6 Personen

**Diese vier Spiele sind keine eigenen Spiele mehr, sondern Minispiele in Sternenjagd** (js/games/party/subgames.js; Sternenjagd läuft mit 2 bis 6 Personen; es gibt zusammen 20 Minispiele pro Durchlauf, zu zweit 19, weil Undercover mindestens 3 Personen braucht). In Teams (ab 4 Personen, nicht in Sternrunden) wird der Teamdurchschnitt gewertet, das bessere Team bekommt Platz 1. Die gemeinsame Grundlage (Mitspieler, Teams, Warteraum,
Ergebnisfenster) liegt in `js/games/common/` (`room.js` für den Host, `kit.js` für die Oberfläche), jedes Spiel
besteht nur noch aus Regeln (`engine.js`), Inhalten und Spielfläche (`ui.js`). Styles: `css/games.css`.
Teams (zwei Teams, Rot und Blau) gibt es ab 4 Personen bei Stadt-Land-Fluss, Stufenquiz und Wortraten: Der Host
schaltet sie im Warteraum ein und kann neu mischen, jede Person kann das Team selbst wechseln; das Team gewinnt
oder verliert gemeinsam (Teamsumme).

- **Stadt-Land-Fluss**: Ausgelosten Buchstaben, 3 bis 8 wählbare Kategorien (Standard Stadt, Land, Fluss, Name, Tier,
  Beruf). Wer fertig ist, ruft „Stopp“, die anderen haben noch 12 Sekunden. Punkte: 20 für eine Antwort, die nur man selbst
  hat, 10 für eine einzigartige, 5 für gleiche Antworten. In der Auswertung kann die Gruppe Antworten mit 👎 anzweifeln
  (Mehrheit der anderen entscheidet). In Teams zählen gleiche Antworten im selben Team nicht als doppelt.
- **Undercover / Spion**: Variante Undercover: alle bekommen ein Wort, eine Person ein ähnliches anderes (160 Wortpaare),
  niemand weiß, ob das eigene das richtige ist. Variante Spion: eine Person bekommt gar kein Wort und darf es raten,
  wenn sie enttarnt wird. Hinweise werden getippt (ein Wort pro Zug, zwei Runden), dann stimmen alle ab. Bleiben nur noch
  zwei Personen übrig, gewinnt der Undercover. Die Siege werden über Neustarts hinweg gezählt.
- **Stufenquiz**: Pro Runde eine Kategorie (6 Kategorien, rund 300 Fragen: Erde & Länder, Geschichte, Natur & Tiere,
  Wissenschaft & Technik, Film/TV/Musik, Essen/Sport/Alltag). Jede Person wählt geheim eine Stufe von 1 (ganz leicht) bis
  10 (richtig schwer) und bekommt dazu eine eigene Frage mit vier Antworten. Richtig = so viele Punkte wie die Stufe, falsch = 0.
  Die Fragen stehen in `js/games/ladder/questions.js` (`[Frage, richtig, falsch, falsch, falsch]`).
- **Wortraten**: Zu einem gesuchten Begriff (rund 100 Begriffe) werden alle 9 Sekunden Hinweise aufgedeckt, vom ungenauen bis zum
  fast eindeutigen (6 Hinweise). Je früher richtig getippt, desto mehr Punkte (12 bis 2), die ersten beiden Treffer bekommen
  Bonus. Zwei Versuche pro Hinweis, Tippfehler werden verziehen. In Teams reicht ein Treffer für das ganze Team.
  Begriffe: `js/games/wordguess/words.js`.

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

## Design „Nachtfeld“

Schwarz-blauer Nachthimmel mit Glasflächen. Das Aussehen steckt in `css/*.css` (Tokens in `:root` von `css/style.css`),
im Gerüst `index.html`, im Hintergrund `js/core/nachtfeld.js` und in den Render-Teilen der `ui.js`-Dateien.
Spiellogik, Engines und Netzwerk sind davon unberührt.

- Farben: Tiefschwarz `--ink`, Nachtblau `--night`, Signalblau `--signal` (Aktion), Eisblau `--ice` (Info, Münzen),
  Sternweiß `--star` (Text), Gold `--gold` (Sterne, „du bist dran“, Sieg); dazu `--rose` (Gefahr), `--mint` (richtig),
  `--iris`, `--amber`. Die alten Namen (`--yellow`, `--cyan`, `--pink` …) zeigen auf die neue Palette. Spielerfarben `--p0` bis `--p5`
- Schrift: Geist für alles (Überschriften kräftig und eng gesetzt, Zahlen mit tabellarischen Ziffern), über Google Fonts
- Formen: Glas mit 1px-Kontur. Jedes Element setzt nur `--bc` (Kontur) und `--fill` (Fläche). Rundungen nach Rang:
  Knöpfe und Chips als Pille, Felder 14px, Flächen 22px, Steine 9px
- Hintergrund (`nachtfeld.js`, Canvas): Im Menü formen ein paar tausend Partikel über Wellenringen das Symbol des
  gewählten Spiels (Zahlensteine, Schallwelle, Stern, Häuser, Bleistift) und wechseln beim Durchgehen der Spiele die Form; bis zur
  ersten Berührung stellt das Menü alle Spiele nacheinander vor. Beim Spielstart fliegen die Partikel auseinander (Warp)
  und treiben danach ruhig als Sternenstaub. Die Partikelzahl richtet sich nach Bildschirmgröße und Gerät
- Menü: Spiele als Glas-Pillen auf dem Wasser, darunter das Dock mit Beschreibung, Name, Start und Beitreten.
  Wer per Einladungslink kommt, sieht das Beitreten zuerst
- Sternenjagd: Felder sind runde Glasscheiben in der Farbe ihrer Wirkung, auf Einbahnstraßen fließen Lichtpunkte in
  Fahrtrichtung. Figuren liegen auf einer eigenen Ebene, springen von Feld zu Feld und ziehen eine Lichtspur; die
  Felder leuchten beim Überlaufen auf. Der Würfel ist ein 3D-Würfel, der sich auf die gewürfelte Zahl dreht. Oben zeigt
  eine Leiste die Runden (Sternrunden golden). Vor jedem Minispiel läuft das Warp-Intro (`runReel` in
  `js/games/party/ui.js`): Titel rasen heran, werden langsamer und rasten auf dem vom Host gewählten Minispiel ein,
  der Sternenhimmel fliegt mit (`nachtfeld.warp`)
- Mini Rummy (`css/rummy.css`): Steine gleiten an ihren neuen Platz (auch live bei den anderen, beim Sortieren und
  Zurücksetzen). Neu gelegte Steine tragen einen Punkt, veränderte Reihen einen Rahmen in der Farbe der Person, die
  gelegt hat; das bleibt bis zum nächsten Legen. Im eigenen Zug zeigt jede geänderte Reihe sofort grün (gültig),
  gestrichelt (unter drei Steinen) oder rot. Der Joker zeigt auf dem Tisch, für welche Zahl er steht, und hat beim
  Einsetzen einen Regenbogenring. Dazu: Austeilen zu Rundenbeginn, gezogener Stein fliegt in den Ständer, Ständer
  leuchtet auf, wenn man dran ist, Hinweis „nur noch ein Stein“, Steine-Feuerwerk beim Sieg. Ab 36 Steinen auf dem
  Tisch werden sie dort kleiner
- Würfel: `js/core/dice.js` baut einen 3D-Würfel (Sternenjagd einer, Immobilienspiel zwei, die gegeneinander rollen)
- Immobilienspiel: Spielplan aus dunklem Glas mit Kacheln, Figuren springen von Feld zu Feld, das Zielfeld leuchtet auf,
  Häuser „wachsen“ beim Bauen, Besitzkarten als helle Blätter, Ereigniskarten drehen sich ins Bild
- Lieder-Raten: dieselbe Schallwelle wie im Menü (schwingt nur bei laufendem Ton), bei der Auflösung dreht sich eine
  Schallplatte hinter dem Cover
- Gesellschaftsspiele (Stadt-Land-Fluss, Undercover, Stufenquiz, Wortraten): gleiche Glasflächen, Stufen von Mint über
  Gold nach Rose, Teams Rose gegen Eisblau
- `prefers-reduced-motion: reduce` zeigt den Hintergrund als Standbild und schaltet alle Animationen ab
- Kritzelrennen (`css/sketch.css`): Zeichenblatt in warmem Papierweiß, das beim Zeichnen golden umrandet ist; Felder
  als Glaskacheln in den Kategoriefarben, verbunden durch eine Linie, Figuren hüpfen Feld für Feld, Würfel wie in Sternenjagd
- Minispiel „Maulwurf“: goldene Ziele, rote Bomben; „Farbe oder Wort“ nutzt Rot, Blau, Gelb und Grün
