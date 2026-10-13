// Lobby: Namen merken, Raum erstellen / beitreten / fortsetzen und das gewählte Spiel einhängen.
import { HostSession, ClientSession, makeRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from './core/session.js';
import { fileToAvatar } from './core/avatar.js';
import { music } from './core/music.js';
import { nachtfeld } from './core/nachtfeld.js';
import { probeIce } from './core/ice.js';
import { RummyGame, MIN_PLAYERS as RUMMY_MIN, MAX_PLAYERS as RUMMY_MAX } from './games/rummy/engine.js';
import { mountRummy } from './games/rummy/ui.js';
import { MonopolyGame, MIN_PLAYERS as MONO_MIN, MAX_PLAYERS as MONO_MAX } from './games/monopoly/engine.js';
import { mountMonopoly } from './games/monopoly/ui.js';
import { SongQuizGame, MIN_PLAYERS as QUIZ_MIN, MAX_PLAYERS as QUIZ_MAX } from './games/songquiz/engine.js';
import { mountSongQuiz } from './games/songquiz/ui.js';
import { resolveSong } from './games/songquiz/itunes.js';
import { PartyGame, MIN_PLAYERS as PARTY_MIN, MAX_PLAYERS as PARTY_MAX } from './games/party/engine.js';
import { mountParty } from './games/party/ui.js';

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

// Symbole auf den Pillen im Menü (gleiches Motiv wie die Partikelform in nachtfeld.js)
const ICONS = {
    rummy: '<rect x="3" y="6" width="7" height="11" rx="1.6" transform="rotate(-10 6.5 11.5)"/><rect x="8.5" y="4.5" width="7" height="11" rx="1.6"/><rect x="14" y="6" width="7" height="11" rx="1.6" transform="rotate(10 17.5 11.5)"/>',
    songquiz: '<path d="M3 12v0M6.5 9v6M10 5v14M13.5 8v8M17 10v4M20.5 12v0"/>',
    party: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    monopoly: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
};

// text: ein Satz, der das Spiel im Menü beschreibt
const GAMES = {
    rummy: {
        title: 'Mini Rummy',
        text: 'Zahlensteine zu Reihen und Gruppen legen. Wer zuerst alle Steine los ist, gewinnt.',
        players: [RUMMY_MIN, RUMMY_MAX],
        Engine: RummyGame,
        mount: mountRummy,
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

function showGame(session, gameId) {
    const game = GAMES[gameId];
    $('lobby').hidden = true;
    $('gameScreen').hidden = false;
    if (game.music !== false) music.start();
    nachtfeld.mode('game');
    const info = $('roomInfo');
    info.innerHTML = '<span class="rtitle"></span><span class="rcode">Raum <b></b></span>';
    info.querySelector('.rtitle').textContent = game.title;
    info.querySelector('b').textContent = session.roomCode;
    session.onStatus = text => ($('status').textContent = text);
    watchLinked(session);
    const ui = game.mount($('gameRoot'), session);
    current = { session, ui };
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
    lobbyMsg('Raum wird eingerichtet…');
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
            showGame(session, gameId);
            session.start();
            return;
        }
    } catch (e) {
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
    const session = new ClientSession({ roomCode, token, name, password, avatar });
    try {
        await session.connect();
        showGame(session, session.gameId);
    } catch (e) {
        session.close();
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

// ---------- Spielauswahl: Pillen auf dem Wasser, Partikelform und Dock ----------

const ids = Object.keys(GAMES);
let selected = GAMES[store.get('bsp.lastGame')] ? store.get('bsp.lastGame') : 'party';
let showcase = null; // wechselt die Spiele automatisch, bis jemand etwas anfasst

function select(id, { user = false } = {}) {
    if (user) stopShowcase();
    if (id === selected && $('dockTitle').textContent) return;
    selected = id;
    if (user) store.set('bsp.lastGame', id);
    const game = GAMES[id];
    document.querySelectorAll('.pill').forEach(p => {
        const on = p.dataset.game === id;
        p.setAttribute('aria-checked', String(on));
        p.tabIndex = on ? 0 : -1;
    });
    const dock = $('dockTitle').parentElement;
    dock.classList.remove('swap');
    void dock.offsetWidth; // Animation neu starten
    dock.classList.add('swap');
    $('dockTitle').textContent = game.title;
    $('dockText').textContent = game.text;
    $('dockMeta').textContent = playersText(game.players);
    $('hostBtn').textContent = `${game.title} starten`;
    nachtfeld.show(id);
}

function stopShowcase() {
    clearInterval(showcase);
    showcase = null;
}

// Pillen liegen auf dem vorderen Bogen der Wellenringe (Position in Prozent der Bühne)
ids.forEach((id, i) => {
    const game = GAMES[id];
    const a = Math.PI * (0.92 - (i * 0.84) / Math.max(1, ids.length - 1));
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.type = 'button';
    btn.dataset.game = id;
    btn.setAttribute('role', 'radio');
    btn.style.setProperty('--i', i);
    btn.style.setProperty('--px', `${50 + Math.cos(a) * 40}%`);
    btn.style.setProperty('--py', `${60 + Math.sin(a) * 24}%`);
    btn.style.setProperty('--tilt', `${Math.cos(a) * -5}deg`);
    btn.innerHTML = `<span class="pill-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ICONS.party}</svg></span><span><span class="pill-name"></span><span class="pill-meta"></span></span>`;
    btn.querySelector('.pill-name').textContent = game.title;
    btn.querySelector('.pill-meta').textContent = playersText(game.players);
    btn.addEventListener('click', () => {
        const r = btn.getBoundingClientRect();
        nachtfeld.ripple(r.left + r.width / 2, r.bottom - 6);
        select(id, { user: true });
    });
    // Mit der Maus reicht Drüberfahren, um die Form zu sehen; die Auswahl bleibt, bis geklickt wird
    btn.addEventListener('pointerenter', e => {
        if (e.pointerType !== 'mouse') return;
        stopShowcase();
        nachtfeld.show(id);
    });
    btn.addEventListener('pointerleave', e => {
        if (e.pointerType === 'mouse') nachtfeld.show(selected);
    });
    $('gameList').appendChild(btn);
});

// Pfeiltasten wandern durch die Spiele (Radiogruppe)
$('gameList').addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = ids[(ids.indexOf(selected) + step + ids.length) % ids.length];
    select(next, { user: true });
    document.querySelector(`.pill[data-game="${next}"]`).focus();
});

nachtfeld.start($('nachtfeld'));
nachtfeld.anchor($('stageSpace'));
select(selected);

// Bis zur ersten Berührung zeigt das Menü nacheinander alle Spiele
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showcase = setInterval(() => select(ids[(ids.indexOf(selected) + 1) % ids.length]), 5200);
    for (const ev of ['pointerdown', 'keydown', 'focusin']) addEventListener(ev, stopShowcase, { once: true });
}

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
    $('inviteNote').hidden = false;
    $('inviteNote').textContent = `Du bist in Raum ${$('code').value} eingeladen. Name eingeben und beitreten.`;
    $('lobby').classList.add('invited');
}
