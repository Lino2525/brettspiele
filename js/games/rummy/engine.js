// Spielzustand und Ablauf für Mini Rummy (2 Spieler). Läuft nur beim Host und ist die einzige Instanz,
// die den Spielstand verändert. Die Gegenseite bekommt über view() nur das, was sie sehen darf.
import { TILE_COUNT, HAND_SIZE, MELD_MIN, evaluateMove, rackPoints } from './rules.js';

const isId = n => Number.isInteger(n) && n >= 0 && n < TILE_COUNT;
const cleanIds = a => (Array.isArray(a) && a.every(isId) ? [...a] : null);

function cleanSets(a) {
    if (!Array.isArray(a)) return null;
    const out = [];
    for (const s of a) {
        const ids = cleanIds(s);
        if (!ids) return null;
        if (ids.length) out.push(ids);
    }
    return out;
}

function defaultRng() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

const err = error => ({ error });
const OK = { ok: true };

export class RummyGame {
    constructor({ rng = defaultRng } = {}) {
        this.rng = rng;
        this.s = {
            phase: 'waiting', // waiting | playing | over
            players: [], // { name, token, connected, melded, rack }
            pool: [],
            table: [],
            turn: 0,
            starter: 0,
            passes: 0,
            moveNo: 0,
            round: 0,
            scores: [0, 0],
            winner: null,
            overReason: '',
            draft: null, // { seat, table } Live-Vorschau des Spielers am Zug
            lastEvent: null,
        };
    }

    static restore(data, opts) {
        const game = new RummyGame(opts);
        game.s = data;
        game.s.draft = null;
        for (const p of game.s.players) p.connected = false;
        return game;
    }

    serialize() {
        return JSON.parse(JSON.stringify(this.s));
    }

    join(token, name) {
        const s = this.s;
        let seat = s.players.findIndex(p => p.token === token);
        if (seat >= 0) {
            s.players[seat].connected = true;
            return seat;
        }
        if (s.players.length >= 2) return -1;
        let clean = String(name ?? '').trim().slice(0, 20) || 'Spieler';
        if (s.players.length === 1 && s.players[0].name === clean) clean += ' 2';
        s.players.push({ name: clean, token, connected: true, melded: false, rack: [] });
        seat = s.players.length - 1;
        if (s.players.length === 2 && s.phase === 'waiting') {
            s.starter = Math.floor(this.rng() * 2);
            this.#deal();
        }
        return seat;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
    }

    apply(seat, action) {
        switch (action?.t) {
            case 'move': return this.#move(seat, action);
            case 'draw': return this.#draw(seat);
            case 'draft': return this.#draft(seat, action);
            case 'newRound': return this.#newRound();
            default: return err('Unbekannte Aktion.');
        }
    }

    view(seat) {
        const s = this.s;
        const me = s.players[seat];
        const other = s.players[1 - seat];
        const showLive = s.draft && s.draft.seat !== seat;
        return {
            phase: s.phase,
            seat,
            turn: s.turn,
            moveNo: s.moveNo,
            round: s.round,
            scores: s.scores,
            winner: s.winner,
            overReason: s.overReason,
            poolCount: s.pool.length,
            meldMin: MELD_MIN,
            players: s.players.map(p => ({
                name: p.name,
                connected: p.connected,
                melded: p.melded,
                rackCount: p.rack.length,
            })),
            rack: me ? me.rack : [],
            table: s.table,
            liveTable: showLive ? s.draft.table : null,
            otherRack: s.phase === 'over' && other ? other.rack : null,
            lastEvent: s.lastEvent,
        };
    }

    #deal() {
        const s = this.s;
        const ids = Array.from({ length: TILE_COUNT }, (_, i) => i);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        for (const p of s.players) {
            p.rack = ids.splice(0, HAND_SIZE);
            p.melded = false;
        }
        s.pool = ids;
        s.table = [];
        s.turn = s.starter;
        s.passes = 0;
        s.phase = 'playing';
        s.winner = null;
        s.overReason = '';
        s.draft = null;
        s.lastEvent = null;
        s.round++;
        s.moveNo++;
    }

    #newRound() {
        const s = this.s;
        if (s.phase !== 'over') return err('Die Runde läuft noch.');
        s.starter = 1 - s.starter;
        this.#deal();
        return OK;
    }

    #nextTurn() {
        const s = this.s;
        s.turn = 1 - s.turn;
        s.moveNo++;
        s.draft = null;
    }

    #draft(seat, action) {
        const s = this.s;
        if (s.phase !== 'playing' || seat !== s.turn) return OK;
        const table = cleanSets(action.table);
        if (!table) {
            s.draft = null;
            return OK;
        }
        const allowed = new Set([...s.table.flat(), ...s.players[seat].rack]);
        const ids = table.flat();
        if (new Set(ids).size !== ids.length || !ids.every(id => allowed.has(id))) return OK;
        s.draft = { seat, table };
        return OK;
    }

    #move(seat, action) {
        const s = this.s;
        if (s.phase !== 'playing') return err('Gerade läuft keine Runde.');
        if (seat !== s.turn) return err('Du bist nicht am Zug.');
        const table = cleanSets(action.table);
        const rack = cleanIds(action.rack);
        if (!table || !rack) return err('Ungültige Daten.');
        const me = s.players[seat];
        const result = evaluateMove({ oldTable: s.table, oldRack: me.rack, table, rack, melded: me.melded });
        if (!result.ok) return err(result.error);

        me.rack = rack;
        me.melded = true;
        s.table = table;
        s.passes = 0;
        s.lastEvent = { seat, kind: 'move', count: result.added.length };
        if (rack.length === 0) {
            this.#finish(seat, 'Alle Steine gelegt.');
        } else {
            this.#nextTurn();
        }
        return OK;
    }

    #draw(seat) {
        const s = this.s;
        if (s.phase !== 'playing') return err('Gerade läuft keine Runde.');
        if (seat !== s.turn) return err('Du bist nicht am Zug.');
        if (s.pool.length) {
            s.players[seat].rack.push(s.pool.pop());
            s.passes = 0;
            s.lastEvent = { seat, kind: 'draw' };
        } else {
            s.passes++;
            s.lastEvent = { seat, kind: 'pass' };
            if (s.passes >= 2) {
                this.#finish(null, 'Der Vorrat ist leer und keiner kann mehr legen.');
                return OK;
            }
        }
        this.#nextTurn();
        return OK;
    }

    #finish(emptySeat, reason) {
        const s = this.s;
        const sums = s.players.map(p => rackPoints(p.rack));
        let winner = emptySeat;
        if (winner === null && sums[0] !== sums[1]) winner = sums[0] < sums[1] ? 0 : 1;
        if (winner !== null) {
            const diff = sums[1 - winner] - sums[winner];
            s.scores[winner] += diff;
            s.scores[1 - winner] -= diff;
        }
        s.phase = 'over';
        s.winner = winner;
        s.overReason = reason;
        s.draft = null;
        s.moveNo++;
    }
}
