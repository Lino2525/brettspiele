// Verbindungsschicht (PeerJS / WebRTC). Spielunabhängig: ein Host hält die Spiel-Engine,
// alle Beteiligten (auch der Host selbst) sprechen über dieselbe Schnittstelle:
//   session.send(action)          Aktion an den Host schicken
//   session.onView = fn(view)     neuer Spielstand aus Sicht dieses Spielers
//   session.onNotice = fn(text)   Meldung (z. B. "Du bist nicht am Zug.")
//   session.onStatus = fn(text)   Verbindungsstatus
//   session.close()

const PEER_PREFIX = 'brettspiele-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const makeRoomCode = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(5)), b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');

export const normalizeRoomCode = text => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');

const peerIdFor = code => PEER_PREFIX + code;

class Session {
    lastView = null;
    onNotice = () => {};
    onStatus = () => {};
    #onView = null;

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

    constructor({ game, gameId, roomCode, token, name, onSave }) {
        super();
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
        this.#broadcast();
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
                this.#broadcast();
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

    constructor({ roomCode, token, name }) {
        super();
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
        const lost = reason => {
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
            conn.on('open', () => conn.send({ t: 'hello', token: this.token, name: this.name }));
            conn.on('data', msg => {
                switch (msg?.t) {
                    case 'welcome':
                        welcomed = true;
                        this.gameId = msg.gameId;
                        this.onStatus('Verbunden');
                        if (resolve) resolve(this);
                        resolve = reject = null;
                        break;
                    case 'view': this.emitView(msg.view); break;
                    case 'notice': this.onNotice(msg.text); break;
                    case 'full':
                        this.#closed = true;
                        if (reject) reject(new Error('full'));
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
