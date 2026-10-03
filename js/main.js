// Lobby: Namen merken, Raum erstellen / beitreten / fortsetzen und das gewählte Spiel einhängen.
import { HostSession, ClientSession, makeRoomCode, normalizeRoomCode } from './core/session.js';
import { RummyGame } from './games/rummy/engine.js';
import { mountRummy } from './games/rummy/ui.js';

// Neue Spiele werden hier eingetragen: Engine (Host), Oberfläche (alle).
const GAMES = {
    rummy: { title: 'Mini Rummy', Engine: RummyGame, mount: mountRummy },
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

const token = store.get('bsp.token') || crypto.randomUUID();
store.set('bsp.token', token);

const lobbyMsg = text => ($('lobbyMsg').textContent = text);
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

function setBusy(busy) {
    document.querySelectorAll('#lobby button').forEach(b => (b.disabled = busy));
}

// ---------- Spiel starten (gemeinsam für Host und Gast) ----------

let current = null;

function showGame(session, gameId) {
    const game = GAMES[gameId];
    $('lobby').hidden = true;
    $('gameScreen').hidden = false;
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
    if (roomCode.length !== 5) return lobbyMsg('Der Raumcode hat 5 Zeichen.');
    if (typeof Peer === 'undefined') return lobbyMsg('Die Verbindungsbibliothek konnte nicht geladen werden. Bist du online?');
    setBusy(true);
    lobbyMsg('Verbinde…');
    const session = new ClientSession({ roomCode, token, name });
    try {
        await session.connect();
        showGame(session, session.gameId);
    } catch (e) {
        session.close();
        lobbyMsg(
            e.message === 'not-found' ? 'Diesen Raum gibt es nicht (oder er ist gerade nicht online).'
            : e.message === 'full' ? 'In diesem Raum sind schon zwei Spieler.'
            : `Verbindung fehlgeschlagen (${e.message}).`,
        );
        setBusy(false);
    }
}

// ---------- Start ----------

$('name').value = store.get('bsp.name') || '';

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
            if (saved.state.phase !== 'waiting') {
                $('resumeCard').hidden = false;
                $('resumeBtn').textContent = `${game.title} fortsetzen (Raum ${saved.room})`;
                $('resumeBtn').addEventListener('click', () => hostGame(id, saved));
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
