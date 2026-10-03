// Spielzustand und Ablauf für Mini Rummy (2 bis 4 Spieler). Läuft nur beim Host und ist die einzige Instanz,
// die den Spielstand verändert. Die anderen bekommen über view() nur das, was sie sehen dürfen.
import { TILE_COUNT, HAND_SIZE, MELD_MIN, evaluateMove, rackPoints } from './rules.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
const HOST_SEAT = 0; // wer den Raum erstellt, sitzt auf Platz 0 und startet das Spiel

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
            phase: 'waiting', // waiting (Lobby) | playing | over
            players: [], // { name, token, connected, melded, rack }
            pool: [],
            table: [],
            turn: 0,
            starter: 0,
            passes: 0, // wie viele nacheinander ausgesetzt haben (nur bei leerem Vorrat)
            moveNo: 0,
            round: 0,
            scores: [],
            winner: null,
            overReason: '',
            draft: null, // { seat, table } Live-Vorschau der Person am Zug
            lastEvent: null,
        };
    }

    static restore(data, opts) {
        const game = new RummyGame(opts);
        game.s = data;
        game.s.draft = null;
        game.s.scores = game.s.players.map((_, i) => game.s.scores?.[i] ?? 0);
        for (const p of game.s.players) p.connected = false;
        return game;
    }

    serialize() {
        return JSON.parse(JSON.stringify(this.s));
    }

    hasPlayer(token) {
        return this.s.players.some(p => p.token === token);
    }

    // Gibt den Platz zurück oder -1, wenn der Raum voll ist bzw. das Spiel schon läuft (nur bekannte Spieler dürfen zurück).
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
        s.players.push({ name: clean, token, connected: true, melded: false, rack: [] });
        s.scores.push(0);
        s.moveNo++;
        return s.players.length - 1;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
    }

    apply(seat, action) {
        switch (action?.t) {
            case 'start': return this.#start(seat);
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
            hostSeat: HOST_SEAT,
            minPlayers: MIN_PLAYERS,
            maxPlayers: MAX_PLAYERS,
            players: s.players.map(p => ({
                name: p.name,
                connected: p.connected,
                melded: p.melded,
                rackCount: p.rack.length,
            })),
            rack: me ? me.rack : [],
            table: s.table,
            liveTable: s.draft && s.draft.seat !== seat ? s.draft.table : null,
            racks: s.phase === 'over' ? s.players.map(p => p.rack) : null, // am Rundenende wird aufgedeckt
            lastEvent: s.lastEvent,
        };
    }

    #start(seat) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das Spiel starten.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (s.players.length < MIN_PLAYERS) return err('Es fehlen noch Mitspieler.');
        s.starter = Math.floor(this.rng() * s.players.length);
        this.#deal();
        return OK;
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
        s.starter = (s.starter + 1) % s.players.length;
        this.#deal();
        return OK;
    }

    #nextTurn() {
        const s = this.s;
        s.turn = (s.turn + 1) % s.players.length;
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
            if (s.passes >= s.players.length) {
                this.#finish(null, 'Der Vorrat ist leer und keiner kann mehr legen.');
                return OK;
            }
        }
        this.#nextTurn();
        return OK;
    }

    // Wertung wie im Original: Wer gewinnt, bekommt von jedem anderen dessen Restpunkte
    // (bei blockiertem Spiel nur den Unterschied zum Besten). Gleichstand an der Spitze = unentschieden.
    #finish(emptySeat, reason) {
        const s = this.s;
        const sums = s.players.map(p => rackPoints(p.rack));
        let winner = emptySeat;
        if (winner === null) {
            const best = Math.min(...sums);
            const leaders = sums.filter(x => x === best).length;
            if (leaders === 1) winner = sums.indexOf(best);
        }
        if (winner !== null) {
            sums.forEach((sum, i) => {
                if (i === winner) return;
                const penalty = sum - sums[winner];
                s.scores[i] -= penalty;
                s.scores[winner] += penalty;
            });
        }
        s.phase = 'over';
        s.winner = winner;
        s.overReason = reason;
        s.draft = null;
        s.moveNo++;
    }
}
