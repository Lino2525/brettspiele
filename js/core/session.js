// Verbindungsschicht (PeerJS / WebRTC). Spielunabhängig: ein Host hält die Spiel-Engine,
// alle Beteiligten (auch der Host selbst) sprechen über dieselbe Schnittstelle:
//   session.send(action)          Aktion an den Host schicken
//   session.onView = fn(view)     neuer Spielstand aus Sicht dieses Spielers
//   session.onNotice = fn(text)   Meldung (z. B. "Du bist nicht am Zug.")
//   session.onStatus = fn(text)   Verbindungsstatus
//   session.onAvatars = fn(list)  Avatar-Bilder (Data-URL oder null) je Platz, nur im Arbeitsspeicher
//   session.close()

const PEER_PREFIX = 'brettspiele-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const WRONG_PASSWORD_DELAY_MS = 1500; // bremst Raten
const CONNECT_TIMEOUT_MS = 20000;

export const makeRoomCode = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH)), b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');

export const normalizeRoomCode = text => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');

const peerIdFor = code => PEER_PREFIX + code;

export const MAX_AVATAR_CHARS = 150_000;
const AVATAR_SLOTS = 4; // so viele Plätze gibt es höchstens in einem Raum

// Avatare kommen von fremden Browsern: nur kleine Bild-Data-URLs durchlassen, alles andere verwerfen.
export const cleanAvatar = data =>
    typeof data === 'string' && data.length <= MAX_AVATAR_CHARS && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)
        ? data
        : null;

class Session {
    lastView = null;
    lastAvatars = Array(AVATAR_SLOTS).fill(null);
    onNotice = () => {};
    onStatus = () => {};
    #onView = null;
    #onAvatars = null;

    set onAvatars(fn) {
        this.#onAvatars = fn;
        if (fn) fn(this.lastAvatars);
    }

    emitAvatars(list) {
        this.lastAvatars = Array.from({ length: AVATAR_SLOTS }, (_, i) => cleanAvatar(list?.[i]));
        this.#onAvatars?.(this.lastAvatars);
    }

    // Beim Setzen wird der letzte Stand sofort nachgereicht, damit die Reihenfolge beim Start egal ist.
    set onView(fn) {
        this.#onView = fn;
        if (fn && this.lastView) fn(this.lastView);
    }

    emitView(view) {
        this.lastView = view;
        this.#onView?.(view);
    }
}

export class HostSession extends Session {
    #peer = null;
    #conns = new Map(); // seat -> DataConnection
    #seat = -1;
    #avatars = Array(AVATAR_SLOTS).fill(null); // nur im Arbeitsspeicher, nie im gespeicherten Spielstand

    constructor({ game, gameId, roomCode, token, name, password, avatar, onSave }) {
        super();
        this.password = password || '';
        this.avatar = cleanAvatar(avatar);
        this.game = game;
        this.gameId = gameId;
        this.roomCode = roomCode;
        this.token = token;
        this.name = name;
        this.onSave = onSave;
    }

    // Meldet den Raum beim Vermittlungsserver an. Schlägt mit code 'unavailable-id' fehl, wenn der Code vergeben ist.
    open() {
        return new Promise((resolve, reject) => {
            const peer = new Peer(peerIdFor(this.roomCode));
            this.#peer = peer;
            let opened = false;
            peer.on('open', () => {
                opened = true;
                resolve();
            });
            peer.on('error', e => {
                if (!opened) {
                    peer.destroy();
                    reject(Object.assign(new Error(e.message), { code: e.type }));
                } else {
                    this.onStatus(`Verbindungsproblem (${e.type})`);
                }
            });
            peer.on('disconnected', () => {
                // Vermittlungsserver kurz weg: bestehende Verbindungen laufen weiter, neue Gäste brauchen ihn aber.
                if (!peer.destroyed) peer.reconnect();
            });
            peer.on('connection', conn => this.#onConnection(conn));
        });
    }

    start() {
        this.#seat = this.game.join(this.token, this.name);
        this.#avatars[this.#seat] = this.avatar;
        this.#broadcast();
        this.#sendAvatars();
    }

    #sendAvatars() {
        this.emitAvatars(this.#avatars);
        for (const conn of this.#conns.values()) conn.send({ t: 'avatars', list: this.#avatars });
    }

    send(action) {
        this.#handle(this.#seat, action, msg => this.onNotice(msg));
    }

    close() {
        this.#peer?.destroy();
    }

    #onConnection(conn) {
        let seat = -1;
        conn.on('data', msg => {
            if (msg?.t === 'hello') {
                // Wer schon einen Platz hat (Token), kommt ohne Passwort zurück, z. B. nach einem Neuladen.
                if (this.password && !this.game.hasPlayer(String(msg.token)) && msg.password !== this.password) {
                    setTimeout(() => {
                        conn.send({ t: 'denied' });
                        setTimeout(() => conn.close(), 500);
                    }, WRONG_PASSWORD_DELAY_MS);
                    return;
                }
                const joined = this.game.join(String(msg.token), msg.name);
                if (joined < 0) {
                    conn.send({ t: 'full' });
                    setTimeout(() => conn.close(), 500);
                    return;
                }
                seat = joined;
                this.#conns.get(seat)?.close();
                this.#conns.set(seat, conn);
                conn.send({ t: 'welcome', gameId: this.gameId, seat });
                this.#avatars[seat] = cleanAvatar(msg.avatar);
                this.#broadcast();
                this.#sendAvatars();
            } else if (msg?.t === 'act' && seat >= 0) {
                this.#handle(seat, msg.action, text => conn.send({ t: 'notice', text }));
            }
        });
        conn.on('close', () => {
            if (seat >= 0 && this.#conns.get(seat) === conn) {
                this.#conns.delete(seat);
                this.game.setConnected(seat, false);
                this.#broadcast();
            }
        });
    }

    #handle(seat, action, notify) {
        const result = this.game.apply(seat, action);
        if (result.error) notify(result.error);
        else this.#broadcast();
    }

    #broadcast() {
        for (let seat = 0; seat < this.game.s.players.length; seat++) {
            const view = this.game.view(seat);
            if (seat === this.#seat) this.emitView(view);
            else this.#conns.get(seat)?.send({ t: 'view', view });
        }
        this.onSave?.(this.game.serialize());
    }
}

export class ClientSession extends Session {
    #peer = null;
    #conn = null;
    #closed = false;
    #retryTimer = null;

    constructor({ roomCode, token, name, password, avatar }) {
        super();
        this.password = password || '';
        this.avatar = cleanAvatar(avatar);
        this.roomCode = roomCode;
        this.token = token;
        this.name = name;
        this.gameId = null;
    }

    // Löst nach der Begrüßung durch den Host auf. Danach verbindet sich die Sitzung bei Abbrüchen selbst neu.
    connect() {
        return new Promise((resolve, reject) => this.#dial(resolve, reject));
    }

    send(action) {
        if (this.#conn?.open) this.#conn.send({ t: 'act', action });
        else this.onNotice('Keine Verbindung. Es wird neu verbunden.');
    }

    close() {
        this.#closed = true;
        clearTimeout(this.#retryTimer);
        this.#peer?.destroy();
    }

    #dial(resolve, reject) {
        this.#peer?.destroy();
        const peer = new Peer();
        this.#peer = peer;
        let welcomed = false;
        // Ohne Antwort des Hosts nicht ewig "Verbinde…" anzeigen (z. B. wenn WebRTC im Netz blockiert wird).
        const timer = setTimeout(() => {
            if (!welcomed) lost('timeout');
        }, CONNECT_TIMEOUT_MS);
        const lost = reason => {
            clearTimeout(timer);
            if (this.#closed) return;
            if (!welcomed && reject) {
                // Erster Verbindungsversuch gescheitert: dem Aufrufer melden statt endlos zu wiederholen.
                const r = reject;
                resolve = reject = null;
                peer.destroy();
                r(new Error(reason));
                return;
            }
            this.onStatus('Verbindung verloren, verbinde neu…');
            clearTimeout(this.#retryTimer);
            this.#retryTimer = setTimeout(() => this.#dial(resolve, reject), 2500);
        };

        peer.on('open', () => {
            const conn = peer.connect(peerIdFor(this.roomCode), { reliable: true });
            this.#conn = conn;
            conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
                if (conn.peerConnection.iceConnectionState === 'failed' && !welcomed) lost('ice-failed');
            });
            conn.on('open', () => conn.send({ t: 'hello', token: this.token, name: this.name, password: this.password, avatar: this.avatar }));
            conn.on('data', msg => {
                switch (msg?.t) {
                    case 'welcome':
                        welcomed = true;
                        clearTimeout(timer);
                        this.gameId = msg.gameId;
                        this.onStatus('Verbunden');
                        if (resolve) resolve(this);
                        resolve = reject = null;
                        break;
                    case 'view': this.emitView(msg.view); break;
                    case 'avatars': this.emitAvatars(msg.list); break;
                    case 'notice': this.onNotice(msg.text); break;
                    case 'full':
                    case 'denied':
                        this.#closed = true;
                        if (reject) reject(new Error(msg.t));
                        break;
                }
            });
            conn.on('close', () => lost('closed'));
            conn.on('error', () => lost('error'));
        });
        peer.on('error', e => {
            if (e.type === 'peer-unavailable') {
                if (reject) {
                    const r = reject;
                    resolve = reject = null;
                    r(new Error('not-found'));
                } else lost('peer-unavailable');
            } else lost(e.type);
        });
        peer.on('disconnected', () => {
            // Nur der Vermittlungsserver ist weg; die Datenverbindung zum Host kann weiterlaufen.
        });
    }
}
