// Spielablauf fürs Lieder-Raten (2 bis 10 Spieler). Läuft nur beim Host und ist die einzige Instanz, die den
// Spielstand verändert. Die richtige Antwort verlässt den Host erst beim Auflösen der Runde.
//
// Ablauf einer Runde: prepare (alle laden den Ausschnitt) -> live (raten, Hinweise nach 10 s und 20 s)
//                     -> reveal (Auflösung) -> nächste Runde. Nach 20 Runden folgt der Siegerbildschirm.
// Songs holt der Host über songProvider (iTunes-Suche) schon vorab; tick() wird vom Host regelmäßig aufgerufen.
import { CATALOG } from './catalog.js';
import { checkGuess, maskText } from './answer.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const ROUNDS = 20;
const HOST_SEAT = 0;
const CLIP_SECONDS = [5, 8, 12]; // Länge des Ausschnitts: Start, nach Hinweis 1, nach Hinweis 2
const REVEAL_CLIP_SECONDS = 9;
const PREPARE_MS = 6000;
const LIVE_MS = 30000;
const HINT_AT_MS = [10000, 20000];
const REVEAL_MS = 9000;
const PREFETCH = 3;
const RETRY_MS = 8000;
const RECENT_ARTISTS = 8;
const MAX_ANSWER_LENGTH = 80;
const CORE_SHARE = 0.75; // so oft kommt ein Song aus dem Schwerpunkt (Party-Pop um 2010), sonst aus allen Jahrzehnten

const err = error => ({ error });
const OK = { ok: true };

function defaultRng() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export class SongQuizGame {
    constructor({ rng = defaultRng, catalog = CATALOG, songProvider = null, history = new Set(), onHistory = null, onHistoryReset = null } = {}) {
        this.rng = rng;
        this.catalog = catalog;
        this.songProvider = songProvider;
        this.history = history;
        this.onHistory = onHistory;
        this.onHistoryReset = onHistoryReset;
        this.filling = false;
        this.retryAt = 0;
        this.dirty = false;
        this.failed = new Set(); // in dieser Sitzung nicht auffindbare Songs
        this.s = {
            phase: 'waiting', // waiting | loading | round | over
            players: [], // { name, token, connected, score }
            block: 1, // Durchgang (20 Runden); mit "Weitere 20 Runden" zählt er hoch
            roundNo: 0, // Runde im Durchgang (1 bis 20)
            roundCounter: 0, // fortlaufende Nummer über alle Runden (für den Ton-Abruf)
            used: [], // in diesem Raum schon gespielte Songs
            recent: [], // Künstler der letzten Songs (Vielfalt)
            queue: [], // vorab geladene Songs
            round: null,
            loadError: '',
            moveNo: 0,
        };
    }

    // Verbindung zu Apple, Verlauf bereits gespielter Songs: wird vom Host nach dem Anlegen gesetzt
    attachRuntime({ songProvider, history, onHistory, onHistoryReset }) {
        this.songProvider = songProvider;
        if (history) this.history = history;
        this.onHistory = onHistory ?? null;
        this.onHistoryReset = onHistoryReset ?? null;
    }

    static restore(data, opts) {
        const game = new SongQuizGame(opts);
        game.s = data;
        for (const p of game.s.players) p.connected = false;
        // Eine unterbrochene Runde wird aufgelöst, danach geht es normal weiter.
        const r = game.s.round;
        if (r && r.phase !== 'reveal') {
            r.phase = 'reveal';
            r.revealEnd = Date.now() + 4000;
            r.clipSeq++;
        }
        return game;
    }

    serialize() {
        return JSON.parse(JSON.stringify(this.s));
    }

    hasPlayer(token) {
        return this.s.players.some(p => p.token === token);
    }

    join(token, name) {
        const s = this.s;
        let seat = s.players.findIndex(p => p.token === token);
        if (seat >= 0) {
            s.players[seat].connected = true;
            return seat;
        }
        if (s.phase !== 'waiting' || s.players.length >= MAX_PLAYERS) return -1;
        const base = String(name ?? '').trim().slice(0, 20) || 'Spieler';
        let clean = base;
        for (let n = 2; s.players.some(p => p.name === clean); n++) clean = `${base} ${n}`;
        s.players.push({ name: clean, token, connected: true, score: 0 });
        s.moveNo++;
        return s.players.length - 1;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
    }

    // ---------- Aktionen ----------

    apply(seat, a, now = Date.now()) {
        const s = this.s;
        if (!s.players[seat]) return err('Unbekannter Spieler.');
        let result;
        switch (a?.t) {
            case 'start': result = this.#start(seat); break;
            case 'answer': result = this.#answer(seat, a.text, now); break;
            case 'ready': result = this.#ready(seat, a.round, now); break;
            case 'skip': result = this.#skip(seat, now); break;
            case 'next': result = this.#next(seat, now); break;
            case 'continue': result = this.#continue(); break;
            case 'newGame': result = this.#newGame(); break;
            default: return err('Unbekannte Aktion.');
        }
        if (!result.error) s.moveNo++;
        return result;
    }

    #start(seat) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das Spiel starten.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (s.players.length < MIN_PLAYERS) return err('Es fehlen noch Mitspieler.');
        this.#beginBlock();
        return OK;
    }

    #beginBlock() {
        const s = this.s;
        s.phase = 'loading';
        s.roundNo = 0;
        s.round = null;
        s.loadError = '';
        this.dirty = true;
    }

    #continue() {
        const s = this.s;
        if (s.phase !== 'over') return err('Der Durchgang läuft noch.');
        s.block++;
        this.#beginBlock();
        return OK;
    }

    #newGame() {
        const s = this.s;
        if (s.phase !== 'over') return err('Der Durchgang läuft noch.');
        s.block = 1;
        for (const p of s.players) p.score = 0;
        this.#beginBlock();
        return OK;
    }

    #ready(seat, roundId, now) {
        const r = this.s.round;
        if (r && r.phase === 'prepare' && r.id === roundId && !r.ready.includes(seat)) {
            r.ready.push(seat);
            this.#maybeGoLive(now);
        }
        return OK;
    }

    #skip(seat, now) {
        const r = this.s.round;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann überspringen.');
        if (!r || r.phase !== 'live') return err('Gerade läuft keine Runde.');
        this.#reveal(now);
        return OK;
    }

    #next(seat, now) {
        const r = this.s.round;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann weiter.');
        if (!r || r.phase !== 'reveal') return err('Es gibt gerade nichts zu überspringen.');
        this.#advance(now);
        return OK;
    }

    #answer(seat, text, now) {
        const s = this.s;
        const r = s.round;
        if (!r || r.phase !== 'live') return err('Gerade kann nicht geraten werden.');
        const guess = String(text ?? '').slice(0, MAX_ANSWER_LENGTH);
        if (!guess.trim()) return err('Gib einen Titel oder Künstler ein.');
        const got = r.got[seat];
        const res = checkGuess(guess, r.song);
        let gain = 0;
        const parts = [];
        if (res.title && !got.title) {
            got.title = true;
            gain += 1;
            if (r.firstTitle === null) {
                r.firstTitle = seat;
                gain += 1;
                parts.push('Titel (zuerst!)');
            } else parts.push('Titel');
        }
        if (res.artist && !got.artist) {
            got.artist = true;
            gain += 1;
            if (r.firstArtist === null) {
                r.firstArtist = seat;
                gain += 1;
                parts.push('Künstler (zuerst!)');
            } else parts.push('Künstler');
        }
        if (got.title && got.artist && !got.bonus) {
            got.bonus = true;
            gain += 1;
            parts.push('Bonus');
        }
        if (gain === 0) return { ok: true, notice: res.title || res.artist ? 'Das hast du schon.' : 'Leider nicht. Versuch es weiter!' };
        s.players[seat].score += gain;
        r.gain[seat] = (r.gain[seat] || 0) + gain;
        this.#checkAllDone(now);
        return { ok: true, notice: `Richtig: ${parts.join(' + ')} (+${gain})` };
    }

    #checkAllDone(now) {
        const s = this.s;
        const r = s.round;
        const active = s.players.map((p, i) => i).filter(i => s.players[i].connected);
        if (active.length && active.every(i => r.got[i].title && r.got[i].artist)) this.#reveal(now);
    }

    // ---------- Zeitsteuerung ----------

    // Wird vom Host regelmäßig aufgerufen. Gibt true zurück, wenn sich der Stand geändert hat.
    tick(now = Date.now()) {
        const s = this.s;
        let changed = this.dirty;
        this.dirty = false;
        this.clockNow = now;
        const before = s.moveNo;

        if (['loading', 'round'].includes(s.phase)) this.#maybeFill(now);

        if (s.phase === 'loading' && s.queue.length) {
            this.#startRound(now);
        } else if (s.phase === 'round' && s.round) {
            const r = s.round;
            if (r.phase === 'prepare') {
                if (now >= r.prepareEnd) this.#goLive(now);
            } else if (r.phase === 'live') {
                const elapsed = now - r.startedAt;
                for (let h = r.hint; h < HINT_AT_MS.length; h++) {
                    if (elapsed >= HINT_AT_MS[h]) {
                        r.hint = h + 1;
                        r.len = CLIP_SECONDS[r.hint];
                        r.clipSeq++;
                        changed = true; // Hinweis und längerer Ausschnitt müssen alle erfahren
                    }
                }
                if (now >= r.endsAt) this.#reveal(now);
            } else if (r.phase === 'reveal' && now >= r.revealEnd) {
                this.#advance(now);
            }
        }
        if (s.moveNo !== before) changed = true;
        return changed || this.dirty;
    }

    #startRound(now) {
        const s = this.s;
        const song = s.queue.shift();
        s.roundNo++;
        s.roundCounter++;
        s.phase = 'round';
        s.loadError = '';
        const got = {};
        s.players.forEach((p, i) => (got[i] = { title: false, artist: false, bonus: false }));
        s.round = {
            id: s.roundCounter,
            song,
            offset: Math.floor(this.rng() * 13), // 0 bis 12 s in die 30-Sekunden-Vorschau
            phase: 'prepare',
            prepareEnd: now + PREPARE_MS,
            startedAt: null,
            endsAt: null,
            revealEnd: null,
            hint: 0,
            clipSeq: 0,
            len: CLIP_SECONDS[0],
            ready: [],
            got,
            gain: {},
            firstTitle: null,
            firstArtist: null,
        };
        s.moveNo++;
    }

    #maybeGoLive(now) {
        const s = this.s;
        const active = s.players.map((p, i) => i).filter(i => s.players[i].connected);
        if (active.every(i => s.round.ready.includes(i))) this.#goLive(now);
    }

    #goLive(now) {
        const r = this.s.round;
        r.phase = 'live';
        r.startedAt = now;
        r.endsAt = now + LIVE_MS;
        r.clipSeq = 1;
        r.len = CLIP_SECONDS[0];
        this.s.moveNo++;
    }

    #reveal(now) {
        const r = this.s.round;
        r.phase = 'reveal';
        r.revealEnd = now + REVEAL_MS;
        r.len = REVEAL_CLIP_SECONDS;
        r.clipSeq++;
        this.s.moveNo++;
    }

    #advance(now) {
        const s = this.s;
        if (s.roundNo >= ROUNDS) {
            s.phase = 'over';
            s.round = null;
        } else {
            s.round = null;
            s.phase = 'loading';
            if (s.queue.length) this.#startRound(now);
        }
        s.moveNo++;
    }

    // ---------- Songauswahl ----------

    #pickCandidate() {
        const s = this.s;
        const queued = new Set(s.queue.map(q => q.id));
        const taken = new Set([...s.used, ...this.history, ...this.failed, ...queued]);
        let pool = this.catalog.filter(c => !taken.has(c.id));
        if (!pool.length) {
            // Alles einmal gespielt: der gemerkte Verlauf wird zurückgesetzt, damit es von vorn losgehen kann.
            this.history.clear();
            this.onHistoryReset?.();
            s.used = [];
            pool = this.catalog.filter(c => !this.failed.has(c.id) && !queued.has(c.id));
        }
        if (!pool.length) return null;
        const recent = new Set([...s.recent, ...s.queue.map(q => q.artist)]);
        const varied = pool.filter(c => !recent.has(c.artist));
        const from = varied.length ? varied : pool;
        // Schwerpunkt bevorzugen: meist ein Song aus dem Kern (Party-Pop um 2010), ab und zu aus allen anderen Jahrzehnten
        const core = from.filter(c => c.core);
        const rest = from.filter(c => !c.core);
        const useCore = core.length > 0 && (rest.length === 0 || this.rng() < CORE_SHARE);
        const list = useCore ? core : rest;
        return list[Math.floor(this.rng() * list.length)];
    }

    #maybeFill(now) {
        const s = this.s;
        const remaining = ROUNDS - s.roundNo; // Runden, die noch nicht gestartet sind
        const want = Math.min(PREFETCH, remaining) - s.queue.length;
        if (want <= 0 || this.filling || !this.songProvider || now < this.retryAt) return;
        this.#fill();
    }

    async #fill() {
        const s = this.s;
        this.filling = true;
        try {
            while (['loading', 'round'].includes(s.phase) && s.queue.length < Math.min(PREFETCH, ROUNDS - s.roundNo)) {
                const candidate = this.#pickCandidate();
                if (!candidate) {
                    s.loadError = 'Es gibt keine weiteren Songs.';
                    break;
                }
                const song = await this.songProvider(candidate);
                if (song) {
                    s.queue.push(song);
                    s.used.push(song.id);
                    s.recent.push(song.artist);
                    if (s.recent.length > RECENT_ARTISTS) s.recent.shift();
                    this.history.add(song.id);
                    this.onHistory?.(song.id);
                    s.loadError = '';
                } else {
                    this.failed.add(candidate.id);
                }
                this.dirty = true;
            }
        } catch (e) {
            s.loadError = e?.message || 'Die Songs konnten nicht geladen werden.';
            this.retryAt = (this.clockNow ?? Date.now()) + RETRY_MS;
            this.dirty = true;
        } finally {
            this.filling = false;
        }
    }

    // ---------- Ansicht ----------

    view(seat, now = Date.now()) {
        const s = this.s;
        const r = s.round;
        let round = null;
        if (r) {
            const revealed = r.phase === 'reveal';
            round = {
                id: r.id,
                phase: r.phase,
                url: r.song.previewUrl,
                offset: r.offset,
                len: r.len,
                clipSeq: r.clipSeq,
                hint: r.hint,
                // Hinweise: Wortlängen, später mit Anfangsbuchstaben (nie die Lösung selbst)
                mask: !revealed && r.hint > 0 ? { title: maskText(r.song.title, r.hint), artist: maskText(r.song.artist, r.hint) } : null,
                prepareMsLeft: r.phase === 'prepare' ? Math.max(0, r.prepareEnd - now) : 0,
                liveMsLeft: r.phase === 'live' ? Math.max(0, r.endsAt - now) : 0,
                liveMsTotal: LIVE_MS,
                revealMsLeft: revealed ? Math.max(0, r.revealEnd - now) : 0,
                my: r.got[seat] ?? null,
                song: revealed ? { title: r.song.title, artist: r.song.artist, art: r.song.art } : null,
                gain: revealed ? r.gain : null,
            };
        }
        return {
            phase: s.phase,
            seat,
            hostSeat: HOST_SEAT,
            minPlayers: MIN_PLAYERS,
            maxPlayers: MAX_PLAYERS,
            moveNo: s.moveNo,
            block: s.block,
            roundNo: s.roundNo,
            rounds: ROUNDS,
            loadError: s.loadError,
            ready: s.queue.length,
            players: s.players.map((p, i) => ({
                name: p.name,
                connected: p.connected,
                score: p.score,
                // wer schon was gefunden hat, ist öffentlich (nicht aber was getippt wurde)
                title: r ? r.got[i].title : false,
                artist: r ? r.got[i].artist : false,
            })),
            round,
        };
    }
}
