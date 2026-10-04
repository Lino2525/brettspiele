// Spielablauf von Sternenjagd (2 bis 6 Spieler), ein Partyspiel mit Spielfeld und Minispielen.
// Läuft nur beim Host. Jede Runde: alle würfeln nacheinander und ziehen über den Rundkurs, danach spielen
// alle ein Minispiel. Ein Stern zählt am Ende 10 Münzen; wer nach der letzten Runde am meisten hat, gewinnt.
// tick() wird vom Host regelmäßig aufgerufen und steuert alle Zeiten (Würfel-Wartezeit, Minispiele, Ergebnisse).
import { RING, SPACE_TYPES, COIN_GAIN, COIN_LOSS } from './board.js';
import { availableMinis, createMini, tickMini, miniAction, miniView, computeRewards } from './minigames.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const ROUND_OPTIONS = [5, 8, 10, 12, 15];
export const STAR_PRICE = 5; // so viele Münzen kostet ein Stern auf dem Spielfeld
export const STAR_VALUE = 10; // Wert eines Sterns in Münzen bei der Endwertung
const HOST_SEAT = 0;
const START_COINS = 5;
const TURN_MS = 25000; // so lange wird auf den Wurf gewartet, danach würfelt das Spiel selbst
const STEP_MS = 380; // Animation pro Feld
const EFFECT_MS = 2300; // Zeit nach dem Zug für Feldereignis und Anzeige
const LOG_LIMIT = 40;
const EVENT_LIMIT = 30;

const err = error => ({ error });
const OK = { ok: true };

function defaultRng() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export class PartyGame {
    constructor({ rng = defaultRng } = {}) {
        this.rng = rng;
        this.s = {
            phase: 'waiting', // waiting | board | mini | over
            players: [], // { name, token, connected, coins, stars, pos }
            rounds: 10,
            round: 0,
            order: [], // Zugreihenfolge dieser Runde
            turnIdx: 0,
            turnPhase: 'roll', // roll | moving
            turnDeadline: 0,
            movingUntil: 0,
            star: 0, // Feld, auf dem der Stern liegt
            dice: null,
            mini: null,
            miniCounter: 0,
            miniBag: [], // Minispiele, die in diesem Durchlauf noch nicht dran waren
            lastMini: '',
            events: [],
            eventSeq: 0,
            log: [],
            moveNo: 0,
        };
    }

    static restore(data, opts) {
        const game = new PartyGame(opts);
        game.s = data;
        for (const p of game.s.players) p.connected = false;
        if (game.s.phase === 'mini') game.s.mini = null; // ein unterbrochenes Minispiel entfällt
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
        s.players.push({ name: clean, token, connected: true, coins: START_COINS, stars: 0, pos: 0 });
        s.moveNo++;
        return s.players.length - 1;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
        this.s.mini?.engine?.setConnected(seat, connected); // auch die Gesellschaftsspiele unter den Minispielen
    }

    // ---------- Aktionen ----------

    apply(seat, a, now = Date.now()) {
        const s = this.s;
        if (!s.players[seat]) return err('Unbekannter Spieler.');
        let result;
        switch (a?.t) {
            case 'start': result = this.#start(seat, now); break;
            case 'setRounds': result = this.#setRounds(seat, a.n); break;
            case 'roll': result = this.#roll(seat, now); break;
            case 'mini': result = this.#mini(seat, a, now); break;
            case 'rematch': result = this.#rematch(now); break;
            default: return err('Unbekannte Aktion.');
        }
        if (!result.error) s.moveNo++;
        return result;
    }

    #setRounds(seat, n) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das ändern.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (!ROUND_OPTIONS.includes(n)) return err('Ungültige Rundenzahl.');
        s.rounds = n;
        return OK;
    }

    #start(seat, now) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das Spiel starten.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (s.players.length < MIN_PLAYERS) return err('Es fehlen noch Mitspieler.');
        this.#newGame(now);
        return OK;
    }

    #rematch(now) {
        if (this.s.phase !== 'over') return err('Das Spiel läuft noch.');
        this.#newGame(now);
        return OK;
    }

    #newGame(now) {
        const s = this.s;
        for (const p of s.players) Object.assign(p, { coins: START_COINS, stars: 0, pos: 0 });
        s.round = 0;
        s.mini = null;
        s.miniBag = [];
        s.lastMini = '';
        s.events = [];
        s.log = [];
        s.dice = null;
        s.star = this.#newStarPos(-1);
        this.#log(`Sternenjagd beginnt: ${s.rounds} Runden.`);
        this.#startRound(now);
    }

    // ---------- Protokoll und Ereignisse (für die Animation) ----------

    #log(text) {
        this.s.log.push(text);
        if (this.s.log.length > LOG_LIMIT) this.s.log.shift();
    }

    #event(e) {
        const s = this.s;
        s.events.push({ id: ++s.eventSeq, ...e });
        if (s.events.length > EVENT_LIMIT) s.events.shift();
    }

    #bump() {
        this.s.moveNo++;
    }

    // ---------- Spielbrett ----------

    #newStarPos(old) {
        const choices = [];
        for (let i = 1; i < RING; i++) {
            const dist = old < 0 ? 99 : Math.min((i - old + RING) % RING, (old - i + RING) % RING);
            if (i !== old && dist >= 5) choices.push(i);
        }
        return choices[Math.floor(this.rng() * choices.length)];
    }

    #startRound(now) {
        const s = this.s;
        s.round++;
        const n = s.players.length;
        s.order = Array.from({ length: n }, (_, k) => k); // immer dieselbe Reihenfolge: nach dem Minispiel fängt die Person nach der Letzten an
        s.turnIdx = 0;
        s.phase = 'board';
        this.#log(`Runde ${s.round} von ${s.rounds}${this.#isStarRound() ? ' (Sternrunde: im Minispiel gibt es einen Stern!)' : ''}`);
        this.#beginTurn(now);
    }

    #isStarRound() {
        const s = this.s;
        return s.round % 3 === 0 || s.round === s.rounds;
    }

    get #turnSeat() {
        return this.s.order[this.s.turnIdx];
    }

    #beginTurn(now) {
        const s = this.s;
        s.turnPhase = 'roll';
        s.turnDeadline = now + TURN_MS;
    }

    #roll(seat, now) {
        const s = this.s;
        if (s.phase !== 'board') return err('Gerade wird nicht gewürfelt.');
        if (seat !== this.#turnSeat) return err('Du bist nicht dran.');
        if (s.turnPhase !== 'roll') return err('Warte, bis die Figur angekommen ist.');
        this.#doRoll(seat, now);
        return OK;
    }

    #doRoll(seat, now) {
        const s = this.s;
        const value = 1 + Math.floor(this.rng() * 6);
        s.dice = { seat, value };
        this.#event({ type: 'dice', seat, value });
        this.#log(`${s.players[seat].name} würfelt eine ${value}.`);
        this.#move(seat, value);
        s.turnPhase = 'moving';
        s.movingUntil = now + value * STEP_MS + EFFECT_MS;
    }

    #addCoins(seat, delta, why) {
        const p = this.s.players[seat];
        const actual = Math.max(-p.coins, delta);
        if (actual === 0) return 0;
        p.coins += actual;
        this.#event({ type: 'coins', seat, delta: actual, why });
        return actual;
    }

    #move(seat, steps) {
        const s = this.s;
        const p = s.players[seat];
        const from = p.pos;
        this.#event({ type: 'move', seat, from, steps });
        let bought = false;
        for (let step = 1; step <= steps; step++) {
            // Wer am Stern vorbeikommt (oder darauf landet), kauft ihn, wenn er genug Münzen hat
            if (!bought && (from + step) % RING === s.star && p.coins >= STAR_PRICE) {
                bought = true;
                p.coins -= STAR_PRICE;
                p.stars++;
                this.#event({ type: 'star', seat, pos: s.star });
                this.#log(`${p.name} kauft den Stern für ${STAR_PRICE} Münzen!`);
                s.star = this.#newStarPos(s.star);
            }
        }
        p.pos = (from + steps) % RING;
        const type = SPACE_TYPES[p.pos];
        if (type === 'blue') {
            this.#addCoins(seat, COIN_GAIN, 'blue');
            this.#log(`${p.name} landet auf einem blauen Feld: +${COIN_GAIN} Münzen.`);
        } else if (type === 'red') {
            const lost = -this.#addCoins(seat, -COIN_LOSS, 'red');
            this.#log(`${p.name} landet auf einem roten Feld: −${lost} Münzen.`);
        } else if (type === 'green') {
            this.#luckEvent(seat);
        }
    }

    // Glücksfeld: ein zufälliges Ereignis
    #luckEvent(seat) {
        const s = this.s;
        const p = s.players[seat];
        const others = s.players.map((x, i) => i).filter(i => i !== seat);
        const kind = Math.floor(this.rng() * 6);
        const say = text => {
            this.#log(`Glücksfeld! ${text}`);
            this.#event({ type: 'info', seat, text });
        };
        switch (kind) {
            case 0:
                this.#addCoins(seat, 8, 'luck');
                say(`${p.name} findet 8 Münzen.`);
                break;
            case 1: {
                const lost = -this.#addCoins(seat, -5, 'luck');
                say(`${p.name} verliert ${lost} Münzen.`);
                break;
            }
            case 2: {
                const rich = others.filter(i => s.players[i].coins > 0);
                if (!rich.length) {
                    this.#addCoins(seat, 3, 'luck');
                    say(`${p.name} findet 3 Münzen.`);
                    break;
                }
                const victim = rich[Math.floor(this.rng() * rich.length)];
                const amount = Math.min(5, s.players[victim].coins);
                this.#addCoins(victim, -amount, 'steal');
                this.#addCoins(seat, amount, 'steal');
                say(`${p.name} klaut ${s.players[victim].name} ${amount} Münzen!`);
                break;
            }
            case 3:
                for (let i = 0; i < s.players.length; i++) this.#addCoins(i, 3, 'rain');
                say('Münzregen! Alle bekommen 3 Münzen.');
                break;
            case 4: {
                const other = others[Math.floor(this.rng() * others.length)];
                const q = s.players[other];
                [p.pos, q.pos] = [q.pos, p.pos];
                this.#event({ type: 'swap', a: seat, b: other });
                say(`${p.name} tauscht den Platz mit ${q.name}!`);
                break;
            }
            default: {
                let got = 0;
                for (const i of others) if (s.players[i].coins > 0) {
                    this.#addCoins(i, -1, 'tax');
                    got++;
                }
                this.#addCoins(seat, got, 'tax');
                say(`${p.name} bekommt von jedem anderen 1 Münze.`);
            }
        }
    }

    #nextTurn(now) {
        const s = this.s;
        s.turnIdx++;
        s.dice = null;
        if (s.turnIdx >= s.order.length) this.#startMini(now);
        else this.#beginTurn(now);
        this.#bump();
    }

    // ---------- Minispiele ----------

    #startMini(now) {
        const s = this.s;
        // Zähler: erst kommen alle Minispiele einmal dran (in zufälliger Reihenfolge), dann beginnt ein neuer Durchlauf
        if (!s.miniBag?.length) {
            let bag = availableMinis(s.players.length);
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(this.rng() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
            // Das letzte Spiel des alten Durchlaufs soll nicht gleich wieder das erste des neuen sein
            if (bag[bag.length - 1] === s.lastMini) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
            s.miniBag = bag;
        }
        const type = s.miniBag.pop();
        s.lastMini = type;
        s.miniCounter++;
        s.mini = createMini({ type, id: s.miniCounter, rng: this.rng, players: s.players, now, star: this.#isStarRound() });
        s.phase = 'mini';
        this.#log(`Minispiel: ${s.mini.title}`);
    }

    #mini(seat, a, now) {
        const s = this.s;
        if (s.phase !== 'mini' || !s.mini) return err('Gerade läuft kein Minispiel.');
        return miniAction(s.mini, seat, a, now, s.players);
    }

    #applyRewards() {
        const s = this.s;
        const m = s.mini;
        const seats = s.players.map((p, i) => i);
        const rewards = computeRewards(m.scores, seats, m.star, !!m.teams);
        for (const r of rewards) {
            s.players[r.seat].coins += r.coins;
            s.players[r.seat].stars += r.stars;
        }
        m.result = rewards;
        const winner = rewards.find(r => r.rank === 1 && r.score > 0);
        this.#log(winner ? `${m.title}: ${s.players[winner.seat].name} gewinnt${winner.stars ? ' einen Stern' : ''}!` : `${m.title}: niemand hat gepunktet.`);
    }

    #afterMini(now) {
        const s = this.s;
        s.mini = null;
        if (s.round >= s.rounds) {
            s.phase = 'over';
            const best = this.ranking()[0];
            this.#log(`Das Spiel ist aus! ${s.players[best.seat].name} gewinnt.`);
        } else {
            this.#startRound(now);
        }
        this.#bump();
    }

    // Endwertung: Sterne zählen je 10 Münzen
    ranking() {
        return this.s.players
            .map((p, seat) => ({ seat, stars: p.stars, coins: p.coins, total: p.stars * STAR_VALUE + p.coins }))
            .sort((a, b) => b.total - a.total || b.stars - a.stars || a.seat - b.seat);
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        if (s.phase === 'board') {
            if (s.turnPhase === 'roll') {
                const seat = this.#turnSeat;
                if (!s.players[seat].connected || now >= s.turnDeadline) {
                    this.#doRoll(seat, now);
                    this.#bump();
                }
            } else if (now >= s.movingUntil) {
                this.#nextTurn(now);
            }
        } else if (s.phase === 'mini') {
            const m = s.mini;
            if (!m) {
                this.#afterMini(now);
            } else if (m.phase === 'result') {
                if (now >= m.resultEnd) this.#afterMini(now);
            } else if (tickMini(m, now, s.players)) {
                if (m.phase === 'result') this.#applyRewards();
                this.#bump();
            }
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    view(seat, now = Date.now()) {
        const s = this.s;
        return {
            phase: s.phase,
            seat,
            hostSeat: HOST_SEAT,
            minPlayers: MIN_PLAYERS,
            maxPlayers: MAX_PLAYERS,
            roundOptions: ROUND_OPTIONS,
            starPrice: STAR_PRICE,
            moveNo: s.moveNo,
            round: s.round,
            rounds: s.rounds,
            order: s.order,
            turnSeat: s.phase === 'board' ? this.#turnSeat : null,
            turnPhase: s.turnPhase,
            turnMsLeft: s.phase === 'board' && s.turnPhase === 'roll' ? Math.max(0, s.turnDeadline - now) : 0,
            starPos: s.star,
            dice: s.dice,
            players: s.players.map(p => ({ name: p.name, connected: p.connected, coins: p.coins, stars: p.stars, pos: p.pos })),
            miniCycle: { done: s.miniCounter === 0 ? 0 : availableMinis(s.players.length).length - (s.miniBag?.length ?? 0), total: availableMinis(s.players.length).length },
            mini: s.mini ? miniView(s.mini, seat, now, s.players) : null,
            events: s.events,
            eventSeq: s.eventSeq,
            log: s.log,
            ranking: s.phase === 'over' ? this.ranking() : null,
        };
    }
}
