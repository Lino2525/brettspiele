// Lobby: Namen merken, Raum erstellen / beitreten / fortsetzen und das gewählte Spiel einhängen.
import { HostSession, ClientSession, makeRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from './core/session.js';
import { fileToAvatar } from './core/avatar.js';
import { music } from './core/music.js';
import { RummyGame } from './games/rummy/engine.js';
import { mountRummy } from './games/rummy/ui.js';
import { MonopolyGame } from './games/monopoly/engine.js';
import { mountMonopoly } from './games/monopoly/ui.js';

// Neue Spiele werden hier eingetragen: Engine (Host), Oberfläche (alle).
const GAMES = {
    rummy: { title: 'Mini Rummy', Engine: RummyGame, mount: mountRummy, resumable: state => state.phase !== 'waiting' },
    monopoly: { title: 'Monopoly', Engine: MonopolyGame, mount: mountMonopoly, resumable: state => state.phase === 'playing' },
};

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
    music.start();
    $('roomInfo').textContent = `${game.title} · Raum ${session.roomCode}`;
    session.onStatus = text => ($('status').textContent = text);
    const ui = game.mount($('gameRoot'), session);
    current = { session, ui };
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
            : e.message === 'denied' ? 'Falsches oder fehlendes Passwort.'
            : e.message === 'timeout' || e.message === 'ice-failed'
                ? 'Keine Verbindung zum Host möglich. Ist das Spiel dort noch offen? Mit Mobilfunk bitte einmal WLAN probieren (oder umgekehrt).'
            : `Verbindung fehlgeschlagen (${e.message}).`,
        );
        setBusy(false);
    }
}

// ---------- Start ----------

document.querySelectorAll('.music-slot').forEach(slot => music.mount(slot));

$('name').value = store.get('bsp.name') || '';
$('password').value = store.get('bsp.password') || '';

for (const [id, game] of Object.entries(GAMES)) {
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.type = 'button';
    btn.textContent = `${game.title} starten`;
    btn.addEventListener('click', () => hostGame(id));
    $('gameList').appendChild(btn);

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

$('joinBtn').addEventListener('click', () => joinGame($('code').value));
$('code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame($('code').value);
});

const invited = new URLSearchParams(location.search).get('raum');
if (invited) {
    $('code').value = normalizeRoomCode(invited);
    $('inviteNote').hidden = false;
    $('inviteNote').textContent = `Einladung für Raum ${$('code').value}. Name eingeben und beitreten.`;
}
