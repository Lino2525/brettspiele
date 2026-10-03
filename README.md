# Brettspiele

Zwei Personen spielen zusammen im Browser, egal wo. Kein Server, keine Kosten:
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
Danach: Host klickt "Mini Rummy starten", kopiert den Einladungslink und schickt ihn.

## Aufbau

- `js/core/session.js`: Verbindung (Host hält den Spielstand, Gast schickt Aktionen)
- `js/games/<spiel>/rules.js`, `engine.js`, `ui.js`: Regeln, Spielablauf, Oberfläche
- `js/main.js`: Lobby, hier werden neue Spiele in `GAMES` eingetragen
