// Lobby: Namen merken, Raum erstellen / beitreten / fortsetzen und das gewählte Spiel einhängen.
import { HostSession, ClientSession, makeRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from './core/session.js';
import { fileToAvatar } from './core/avatar.js';
import { music } from './core/music.js';
import { nachtfeld } from './core/nachtfeld.js';
import { probeIce } from './core/ice.js';
import { automat } from './core/automat.js';
import { intro } from './core/intro.js';
import { RummyGame, MIN_PLAYERS as RUMMY_MIN, MAX_PLAYERS as RUMMY_MAX } from './games/rummy/engine.js';
import { mountRummy } from './games/rummy/ui.js';
import { MonopolyGame, MIN_PLAYERS as MONO_MIN, MAX_PLAYERS as MONO_MAX } from './games/monopoly/engine.js';
import { mountMonopoly } from './games/monopoly/ui.js';
import { SongQuizGame, MIN_PLAYERS as QUIZ_MIN, MAX_PLAYERS as QUIZ_MAX } from './games/songquiz/engine.js';
import { mountSongQuiz } from './games/songquiz/ui.js';
import { resolveSong } from './games/songquiz/itunes.js';
import { PartyGame, MIN_PLAYERS as PARTY_MIN, MAX_PLAYERS as PARTY_MAX } from './games/party/engine.js';
import { mountParty } from './games/party/ui.js';
import { SketchGame, MIN_PLAYERS as SKETCH_MIN, MAX_PLAYERS as SKETCH_MAX } from './games/sketch/engine.js';
import { mountSketch } from './games/sketch/ui.js';

// Neue Spiele werden hier eingetragen: Engine (Host), Oberfläche (alle).
// Lieder-Raten: schon gespielte Songs merkt sich der Host im Browser, damit bei einem neuen Spiel nicht dieselben kommen.
const PLAYED_KEY = 'bsp.quiz.played';
function attachSongQuiz(engine) {
    let played;
    try { played = new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]')); } catch { played = new Set(); }
    engine.attachRuntime({
        songProvider: resolveSong,
        history: played,
        onHistory: () => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...played])); } catch { /* ohne Speicher: nur für diese Sitzung */ } },
        onHistoryReset: () => { try { localStorage.removeItem(PLAYED_KEY); } catch { /* s. o. */ } },
    });
}

// Dosen im Automaten-Menü: Wahltaste, Bild und Rahmenfarbe je Spiel (Reihenfolge = Fach von links nach rechts)
const DOSEN = {
    rummy: { code: 'A1', img: 'assets/automat/dose-rummy.webp', color: '#d8402f' },
    songquiz: { code: 'A2', img: 'assets/automat/dose-songquiz.webp', color: '#3f6fe0' },
    party: { code: 'A3', img: 'assets/automat/dose-party.webp', color: '#8a7cf0' },
    monopoly: { code: 'A4', img: 'assets/automat/dose-monopoly.webp', color: '#32b07a' },
    sketch: { code: 'A5', img: 'assets/automat/dose-sketch.webp', color: '#f0c22c' },
};

// text: ein Satz, der das Spiel im Menü beschreibt
const GAMES = {
    rummy: {
        title: 'Mini Rummy',
        text: 'Zahlensteine zu Reihen und Gruppen legen. Wer zuerst alle Steine los ist, gewinnt.',
        players: [RUMMY_MIN, RUMMY_MAX],
        Engine: RummyGame,
        mount: mountRummy,
        backdrop: false, // eigener Hintergrund (Laden bei Nacht)
        resumable: state => state.phase !== 'waiting',
    },
    songquiz: {
        title: 'Lieder-Raten',
        text: '20 Sekunden aus bekannten Hits: Wer zuerst Titel oder Künstler tippt, holt die Punkte. Geht auch allein.',
        players: [QUIZ_MIN, QUIZ_MAX],
        Engine: SongQuizGame,
        mount: mountSongQuiz,
        resumable: state => state.phase !== 'waiting',
        music: false, // hier hört man die Song-Ausschnitte, keine Hintergrundmusik
        attach: attachSongQuiz,
    },
    party: {
        title: 'Sternenjagd',
        text: 'Würfeln, Sterne kaufen, Fallen legen und nach jeder Runde ein Minispiel gegeneinander.',
        players: [PARTY_MIN, PARTY_MAX],
        Engine: PartyGame,
        mount: mountParty,
        resumable: state => state.phase !== 'waiting' && state.phase !== 'over',
    },
    monopoly: {
        title: 'Immobilienspiel',
        text: 'Straßen kaufen, Häuser bauen, Miete kassieren, bis nur noch eine Person übrig ist.',
        players: [MONO_MIN, MONO_MAX],
        Engine: MonopolyGame,
        mount: mountMonopoly,
        resumable: state => state.phase === 'playing',
    },
    sketch: {
        title: 'Kritzelrennen',
        text: 'Begriffe zeichnen, die anderen raten. Jeder Treffer bringt die Figuren auf dem Spielbrett weiter, einzeln oder in Teams.',
        players: [SKETCH_MIN, SKETCH_MAX],
        Engine: SketchGame,
        mount: mountSketch,
        resumable: state => state.phase !== 'waiting' && state.phase !== 'over',
    },
};

const playersText = ([min, max]) => (min === max ? `${min} Personen` : min === 1 ? `allein oder bis ${max}` : `${min} bis ${max} Personen`);

const $ = id => document.getElementById(id);
const store = {
    get: key => {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* Speicher gesperrt: dann eben ohne */ }
    },
    remove: key => {
        try { localStorage.removeItem(key); } catch { /* s. o. */ }
    },
};

// Der Avatar liegt bewusst nur im sessionStorage: weg, sobald der Tab geschlossen wird.
let avatar = null;
try { avatar = sessionStorage.getItem('bsp.avatar'); } catch { /* ohne Speicher: kein Avatar nach Neuladen */ }

function setAvatar(data) {
    avatar = data;
    try {
        if (data) sessionStorage.setItem('bsp.avatar', data);
        else sessionStorage.removeItem('bsp.avatar');
    } catch { /* s. o. */ }
    if (!$('avatarPreview')) return;
    $('avatarPreview').hidden = !data;
    $('avatarPlus').hidden = !!data;
    $('avatarClear').hidden = !data;
    if (data) $('avatarPreview').src = data;
}

// Die Avatar-Elemente sind optional, damit eine ältere, zwischengespeicherte index.html nicht die ganze Lobby lahmlegt.
$('avatarBtn')?.addEventListener('click', () => $('avatarFile').click());
$('avatarClear')?.addEventListener('click', () => setAvatar(null));
$('avatarFile')?.addEventListener('change', async () => {
    const file = $('avatarFile').files[0];
    $('avatarFile').value = '';
    if (!file) return;
    try {
        setAvatar(await fileToAvatar(file));
        lobbyMsg('');
    } catch (e) {
        lobbyMsg(e.message);
    }
});
setAvatar(avatar);

const token = store.get('bsp.token') || crypto.randomUUID();
store.set('bsp.token', token);

// Die Meldung steht unten auf der Seite, auf dem Handy also leicht außerhalb des Blickfelds: deshalb hinscrollen.
const lobbyMsg = text => {
    const el = $('lobbyMsg');
    el.textContent = text;
    el.classList.toggle('shown', !!text);
    if (text) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function playerName() {
    const name = $('name').value.trim();
    if (!name) {
        lobbyMsg('Bitte zuerst deinen Namen eingeben.');
        lcd('BITTE NAMEN EINGEBEN', true);
        $('name').focus();
        return null;
    }
    store.set('bsp.name', name);
    return name;
}

function openPassword() {
    $('pwBox').open = true;
    $('password').focus();
}

const roomPassword = () => {
    const pw = $('password').value;
    store.set('bsp.password', pw);
    return pw;
};

function setBusy(busy) {
    document.querySelectorAll('#lobby button').forEach(b => (b.disabled = busy));
}

// ---------- Spiel starten (gemeinsam für Host und Gast) ----------

let current = null;

// Die Dose dieses Spiels für den Übergang (Titel, Bild, Farbe)
const doseOf = gameId => ({
    title: GAMES[gameId].title,
    img: DOSEN[gameId]?.img || 'assets/automat/dose-party.webp',
    color: DOSEN[gameId]?.color || '#2f7bff',
});

// Ins Spiel wechseln: unter der Farbflut der Dose (js/core/intro.js), danach wird der Tisch sichtbar
function showGame(session, gameId) {
    const game = GAMES[gameId];
    return intro.through(doseOf(gameId), () => {
        $('lobby').hidden = true;
        $('gameScreen').hidden = false;
        if (game.music !== false) music.start();
        // Spiele mit eigenem Hintergrund brauchen den Sternenhimmel nicht; die anderen bekommen ihn ohne Sternenflug
        if (game.backdrop !== false) {
            nachtfeld.start($('nachtfeld'));
            nachtfeld.mode('game', { warp: false });
        }
        const info = $('roomInfo');
        info.innerHTML = '<span class="rtitle"></span><span class="rcode">Raum <b></b></span>';
        info.querySelector('.rtitle').textContent = game.title;
        info.querySelector('b').textContent = session.roomCode;
        session.onStatus = text => ($('status').textContent = text);
        watchLinked(session);
        const ui = game.mount($('gameRoot'), session);
        current = { session, ui };
    });
}

// Spielleiste: "3 von 4 verbunden" aus den Spielerlisten der Ansichten (nur Anzeige, die Spiele selbst bleiben unberührt)
function watchLinked(session) {
    const el = $('linked');
    const emit = session.emitView.bind(session);
    const show = v => {
        const players = v?.players;
        if (!Array.isArray(players)) return;
        const on = players.filter(p => p.connected !== false).length;
        el.hidden = false;
        el.textContent = `${on} von ${v.maxPlayers ?? players.length} verbunden`;
        el.classList.toggle('low', on < players.length);
    };
    session.emitView = v => {
        show(v);
        emit(v);
    };
    show(session.lastView);
}

$('leaveBtn').addEventListener('click', () => {
    current?.session.close();
    location.href = location.pathname;
});

$('copyLink').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?raum=${current.session.roomCode}`;
    try {
        await navigator.clipboard.writeText(link);
        $('status').textContent = 'Link kopiert';
    } catch {
        prompt('Diesen Link verschicken:', link);
    }
});

// ---------- Host ----------

async function hostGame(gameId, saved = null) {
    const name = playerName();
    if (!name) return;
    if (typeof Peer === 'undefined') return lobbyMsg('Die Verbindungsbibliothek konnte nicht geladen werden. Bist du online?');
    const password = roomPassword();
    setBusy(true);
    intro.start(doseOf(gameId), saved ? null : document.querySelector('.vm-lying'));
    lobbyMsg('Raum wird eingerichtet…');
    lcd('RAUM WIRD GEÖFFNET …');
    const G = GAMES[gameId];
    const engine = saved ? G.Engine.restore(saved.state) : new G.Engine();
    G.attach?.(engine);
    const saveKey = `bsp.host.${gameId}`;

    try {
        for (let attempt = 0; ; attempt++) {
            const roomCode = saved ? saved.room : makeRoomCode();
            const session = new HostSession({
                game: engine,
                gameId,
                roomCode,
                token,
                name,
                password,
                avatar,
                onSave: state => store.set(saveKey, JSON.stringify({ room: roomCode, state })),
            });
            try {
                await session.open();
            } catch (e) {
                if (e.code === 'unavailable-id' && attempt < 6) {
                    if (saved) await sleep(2000); // alter Eintrag auf dem Vermittlungsserver läuft gleich ab
                    continue;
                }
                throw e;
            }
            await showGame(session, gameId);
            session.start();
            return;
        }
    } catch (e) {
        intro.cancel();
        lcd('FEHLER BEIM ÖFFNEN', true);
        lobbyMsg(`Raum konnte nicht eingerichtet werden (${e.code || e.message}). Bitte noch einmal versuchen.`);
        setBusy(false);
    }
}

// ---------- Gast ----------

async function joinGame(rawCode) {
    const name = playerName();
    if (!name) return;
    const roomCode = normalizeRoomCode(rawCode);
    if (roomCode.length !== ROOM_CODE_LENGTH) return lobbyMsg(`Der Raumcode hat ${ROOM_CODE_LENGTH} Zeichen.`);
    if (typeof Peer === 'undefined') return lobbyMsg('Die Verbindungsbibliothek konnte nicht geladen werden. Bist du online?');
    const password = roomPassword();
    setBusy(true);
    lobbyMsg('Verbinde…');
    lcd(`VERBINDE MIT RAUM ${roomCode} …`);
    const session = new ClientSession({ roomCode, token, name, password, avatar });
    try {
        await session.connect();
        await showGame(session, session.gameId);
    } catch (e) {
        session.close();
        lcd('KEINE VERBINDUNG', true);
        lobbyMsg(
            e.message === 'not-found' ? 'Diesen Raum gibt es nicht (oder er ist gerade nicht online).'
            : e.message === 'full' ? 'Dieser Raum ist voll oder das Spiel hat schon begonnen.'
            : e.message === 'denied' ? (openPassword(), 'Falsches oder fehlendes Passwort.')
            : e.message === 'timeout' || e.message === 'ice-failed'
                ? 'Keine Verbindung zum Host möglich. Ist das Spiel dort noch offen? Tippt auf beiden Geräten auf „Verbindung prüfen“: Fehlt das Relais, klappt es oft nur im selben Netz. Mit Mobilfunk auch einmal WLAN probieren (oder umgekehrt).'
            : `Verbindung fehlgeschlagen (${e.message}).`,
        );
        setBusy(false);
    }
}

// ---------- Verbindung prüfen ----------
// Zeigt, welche Wege dieses Gerät nutzen kann: direkt über das Internet (STUN) und über ein Relais (TURN).

$('netBtn')?.addEventListener('click', async () => {
    const btn = $('netBtn');
    const out = $('netResult');
    btn.disabled = true;
    btn.textContent = 'Prüfe Verbindung …';
    out.hidden = true;
    let r;
    try {
        r = await probeIce();
    } catch {
        r = null;
    }
    btn.disabled = false;
    btn.textContent = 'Erneut prüfen';
    const direct = r && r.srflx + r.prflx > 0;
    const relay = r && r.relay > 0;
    const row = (ok, label, yes, no) => `<li class="${ok ? 'ok' : 'bad'}"><span>${label}</span><b>${ok ? yes : no}</b></li>`;
    const summary = !r
        ? 'Der Test konnte nicht laufen. Unterstützt dieser Browser WebRTC?'
        : relay
            ? 'Alles bereit: Verbindungen sollten auch über verschiedene Netze klappen.'
            : direct
                ? 'Direkt klappt es mit vielen Netzen. Ohne Relais kann es scheitern, wenn das andere Gerät im Mobilfunk oder hinter einer strengen Firewall ist.'
                : 'Dieses Gerät erreicht keinen Verbindungsserver. Ist ein VPN, eine Firewall oder ein Werbeblocker aktiv?';
    out.innerHTML = `<ul>${row(direct, 'Direkt über das Internet', 'möglich', 'nicht möglich')}${row(relay, 'Relais für schwierige Netze', 'erreichbar', 'nicht erreichbar')}</ul><p></p>`;
    out.querySelector('p').textContent = summary;
    out.hidden = false;
});

// ---------- Start ----------

document.querySelectorAll('.music-slot').forEach(slot => music.mount(slot));

$('name').value = store.get('bsp.name') || '';
$('password').value = store.get('bsp.password') || '';

// Beitreten und Starten zuerst anschließen: Sie müssen auch dann funktionieren, wenn danach etwas Dekoratives scheitert
$('joinBtn').addEventListener('click', () => joinGame($('code').value));
$('code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame($('code').value);
});
$('hostBtn').addEventListener('click', () => hostGame(selected));

// ---------- Automat: Spiel ziehen, dann Raum einrichten oder beitreten ----------

const ids = Object.keys(GAMES);
let selected = null;

const lcd = (text, warn = false) => {
    $('vmLcdText').textContent = text;
    $('vmLcd').classList.toggle('warn', warn);
};

const dosen = ids.map((id, i) => ({
    id,
    title: GAMES[id].title,
    code: DOSEN[id]?.code || `A${i + 1}`,
    img: DOSEN[id]?.img || 'assets/automat/dose-party.webp',
}));

const vm = automat($('vmScene'), dosen, { onPick: id => pick(id), onTake: () => openSetup('host') });

const keys = new Map();
ids.forEach((id, i) => {
    const game = GAMES[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vm-key';
    btn.setAttribute('aria-pressed', 'false');
    btn.style.setProperty('--pc', DOSEN[id]?.color || 'var(--ice)');
    btn.innerHTML = '<span class="vm-code"></span><img alt="" width="24" height="46"><span class="vm-name"></span><span class="vm-tag"></span>';
    btn.querySelector('.vm-code').textContent = dosen[i].code;
    btn.querySelector('img').src = dosen[i].img;
    btn.querySelector('.vm-name').textContent = game.title;
    const [min, max] = game.players;
    btn.querySelector('.vm-tag').textContent = min === max ? `${min} Pers.` : `${min}–${max} Pers.`;
    btn.querySelector('.vm-tag').title = playersText(game.players);
    btn.addEventListener('click', () => pick(id));
    $('gameList').appendChild(btn);
    keys.set(id, btn);
});

async function pick(id) {
    if (vm.busy) return;
    selected = id;
    store.set('bsp.lastGame', id);
    keys.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
    $('againBtn').hidden = true;
    $('nextBtn').hidden = true;
    lobbyMsg('');
    const code = dosen[ids.indexOf(id)].code;
    lcd(`${code} · VERBINDE …`);
    setTimeout(() => vm.busy && lcd('AUSGABE LÄUFT …'), 750);
    await vm.dispense(id);
    lcd(`${GAMES[id].title.toUpperCase()} IST DA`);
    $('againBtn').hidden = false;
    $('nextBtn').hidden = false;
}

function showMenu() {
    $('viewSetup').hidden = true;
    $('viewMenu').hidden = false;
    $('netResult').hidden = true;
    lobbyMsg('');
    const out = selected && vm.current === selected;
    $('againBtn').hidden = !out;
    $('nextBtn').hidden = !out;
    lcd(out ? `${GAMES[selected].title.toUpperCase()} IST DA` : 'BITTE SORTE WÄHLEN');
}

// mode 'host': Raum für das gezogene Spiel eröffnen, 'join': mit Raumcode beitreten
function openSetup(mode) {
    const host = mode === 'host';
    if (host && !selected) return;
    $('viewMenu').hidden = true;
    $('viewSetup').hidden = false;
    $('againBtn').hidden = true;
    $('nextBtn').hidden = true;
    $('setupGame').hidden = !host;
    $('hostBtn').hidden = !host;
    $('codeField').hidden = host;
    $('joinBtn').hidden = host;
    $('pwHint').textContent = host ? 'Wer beitreten will, muss es eingeben' : 'Nur nötig, wenn der Raum eins hat';
    $('password').placeholder = host ? 'leer lassen für einen offenen Raum' : 'Raumpasswort';
    lobbyMsg('');
    if (host) {
        const game = GAMES[selected];
        const i = ids.indexOf(selected);
        $('setupGame').style.setProperty('--pc', DOSEN[selected]?.color || 'var(--ice)');
        $('setupCan').src = dosen[i].img;
        $('dockTitle').textContent = game.title;
        $('dockText').textContent = game.text;
        $('dockMeta').textContent = playersText(game.players);
        $('hostBtn').textContent = `${game.title} starten`;
        lcd(`RAUM EINRICHTEN · ${dosen[i].code}`);
    } else {
        joinLcd();
    }
    ($('name').value ? (host ? $('hostBtn') : $('joinBtn')) : $('name')).focus({ preventScroll: true });
}

function joinLcd() {
    const code = normalizeRoomCode($('code').value);
    lcd(code ? `RAUM ${code} · BEREIT` : 'RAUMCODE EINGEBEN');
}

$('nextBtn').addEventListener('click', () => openSetup('host'));
$('againBtn').addEventListener('click', () => {
    vm.reset();
    selected = null;
    keys.forEach(b => b.setAttribute('aria-pressed', 'false'));
    showMenu();
});
$('backBtn').addEventListener('click', showMenu);
$('code').addEventListener('input', joinLcd);

function quickJoin() {
    const code = normalizeRoomCode($('codeQuick').value);
    if (!code) {
        lcd('ERST RAUMCODE EINGEBEN', true);
        $('codeQuick').focus();
        return;
    }
    $('code').value = code;
    openSetup('join');
}
$('quickJoinBtn').addEventListener('click', quickJoin);
$('codeQuick').addEventListener('keydown', e => {
    if (e.key === 'Enter') quickJoin();
});

if (store.get('bsp.password')) $('pwBox').open = true;

for (const [id, game] of Object.entries(GAMES)) {
    const raw = store.get(`bsp.host.${id}`);
    if (raw) {
        try {
            const saved = JSON.parse(raw);
            if (game.resumable(saved.state)) {
                const item = document.createElement('div');
                item.className = 'resume-item';
                const resume = document.createElement('button');
                resume.className = 'btn';
                resume.type = 'button';
                resume.textContent = `${game.title} fortsetzen (Raum ${saved.room})`;
                resume.addEventListener('click', () => hostGame(id, saved));
                const remove = document.createElement('button');
                remove.className = 'btn danger';
                remove.type = 'button';
                remove.textContent = 'Entfernen';
                remove.title = 'Dieses unterbrochene Spiel löschen';
                remove.addEventListener('click', () => {
                    if (!confirm(`${game.title} (Raum ${saved.room}) wirklich löschen? Der Spielstand geht verloren.`)) return;
                    store.remove(`bsp.host.${id}`);
                    item.remove();
                    if (!$('resumeList').children.length) $('resumeCard').hidden = true;
                });
                item.append(resume, remove);
                $('resumeList').appendChild(item);
                $('resumeCard').hidden = false;
            }
        } catch { /* kaputter Speicherstand wird ignoriert */ }
    }
}

const invited = new URLSearchParams(location.search).get('raum');
if (invited) {
    $('code').value = normalizeRoomCode(invited);
    openSetup('join');
    $('inviteNote').hidden = false;
    $('inviteNote').textContent = `Du bist in Raum ${$('code').value} eingeladen. Name eingeben und beitreten.`;
}
