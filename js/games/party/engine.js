// Spielablauf von Sternenjagd (2 bis 6 Spieler), ein Partyspiel mit Spielfeld und Minispielen.
// Läuft nur beim Host. Jede Runde: alle würfeln nacheinander und ziehen über das Wegenetz (an Abzweigungen
// entscheidet die Person selbst), danach spielen alle ein Minispiel. Besondere Felder: Schild (3 Runden kein
// Sternenklau), Duell (Minispiel gegen eine Person nach Wahl, der Sieg bringt 1 Stern oder bis zu 10 Münzen)
// und Teleport (direkt zum Stern). Vor dem Wurf: normaler (1–6) oder sicherer Würfel (2–4), Fallen legen (5 Münzen).
// Den Stern kauft man nur, wenn man will. Am Ende gibt es Bonus-Sterne (Minispiele, Duelle, Münzen).
// Ein Stern zählt am Ende 10 Münzen; wer nach der letzten Runde am meisten hat, gewinnt.
// tick() wird vom Host regelmäßig aufgerufen und steuert alle Zeiten (Würfel-Wartezeit, Minispiele, Ergebnisse).
import { SPACE_TYPES, START, STAR_SPOTS, nextOptions, distances, COIN_GAIN, COIN_LOSS } from './board.js';
import { availableMinis, createMini, tickMini, miniAction, miniView, computeRewards, DUEL_TYPES } from './minigames.js';

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
export const CHOICE_MS = 15000; // Bedenkzeit an Abzweigungen, beim Duell und beim Teleport
export const SHIELD_ROUNDS = 3; // so viele Runden schützt das Schild vor Sternenklau
export const DUEL_COINS = 10; // so viele Münzen gibt es im Duell, wenn kein Stern zu holen ist
export const TRAP_COST = 5; // eine Falle kostet so viel, wer hineintappt, zahlt bis zu so viel an die Person, die sie gelegt hat
export const SAFE_DIE = [2, 4]; // der sichere Würfel
// Bonus-Sterne am Ende (bei Gleichstand bekommen alle Besten einen)
export const BONUSES = [
    { key: 'miniWins', title: 'Minispiel-Profi', what: 'die meisten Minispiel-Siege' },
    { key: 'duelWins', title: 'Duell-Champion', what: 'die meisten gewonnenen Duelle' },
    { key: 'maxCoins', title: 'Münzmagnet', what: 'die meisten Münzen auf einmal' },
];
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
            players: [], // { name, token, connected, coins, stars, pos, prev, shield, miniWins, duelWins, maxCoins }
            traps: [], // { pos, owner }
            bonus: null, // Bonus-Sterne der Endwertung
            rounds: 10,
            round: 0,
            order: [], // Zugreihenfolge dieser Runde
            turnIdx: 0,
            turnPhase: 'roll', // roll | choose (Abzweigung) | buy (Stern kaufen?) | duel (Gegner wählen) | teleport (ja/nein) | moving
            move: null, // { seat, left, anim, starAsked } während eines Zugs
            choice: null, // { seat, options } solange eine Entscheidung offen ist
            inDuel: false,
            turnDeadline: 0,
            movingUntil: 0,
            star: 0, // Feld, auf dem der Stern liegt (Index in NODES)
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
        // Spielstände von früher (Rundkurs): fehlende Werte ergänzen, Stern notfalls neu legen
        for (const p of game.s.players) {
            p.prev ??= null;
            p.shield ??= 0;
            p.miniWins ??= 0;
            p.duelWins ??= 0;
            p.maxCoins ??= p.coins;
        }
        game.s.traps ??= [];
        if (!STAR_SPOTS.includes(game.s.star)) game.s.star = game.#newStarPos(-1);
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
        s.players.push({ name: clean, token, connected: true, ...{ coins: START_COINS, stars: 0, pos: START, prev: null, shield: 0, miniWins: 0, duelWins: 0, maxCoins: START_COINS } });
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
            case 'roll': result = this.#roll(seat, a.die === 'safe', now); break;
            case 'trap': result = this.#trap(seat); break;
            case 'buy': result = this.#buy(seat, !!a.go, now); break;
            case 'choose': result = this.#choose(seat, a.to, now); break;
            case 'duel': result = this.#duelPick(seat, a.target, a.stake === 'coins' ? 'coins' : 'star', now); break;
            case 'teleport': result = this.#teleport(seat, !!a.go, now); break;
            case 'mini': result = this.#mini(seat, a, now); break;
            case 'rematch': result = this.#rematch(now); break;
            default: return err('Unbekannte Aktion.');
        }
        if (!result.error) {
            s.moveNo++;
            this.#track();
        }
        return result;
    }

    // Statistik für den Bonus-Stern „Münzmagnet“
    #track() {
        for (const p of this.s.players) if (p.coins > (p.maxCoins ?? 0)) p.maxCoins = p.coins;
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
        for (const p of s.players) Object.assign(p, { coins: START_COINS, stars: 0, pos: START, prev: null, shield: 0, miniWins: 0, duelWins: 0, maxCoins: START_COINS });
        s.traps = [];
        s.bonus = null;
        s.round = 0;
        s.mini = null;
        s.miniBag = [];
        s.lastMini = '';
        s.events = [];
        s.log = [];
        s.dice = null;
        s.move = null;
        s.choice = null;
        s.inDuel = false;
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

    // Neuer Platz für den Stern: ein normales Feld, mindestens 5 Felder vom alten entfernt
    #newStarPos(old) {
        const dist = old >= 0 ? distances(old) : null;
        const choices = STAR_SPOTS.filter(i => !dist || dist[i] >= 5);
        return choices[Math.floor(this.rng() * choices.length)];
    }

    #startRound(now) {
        const s = this.s;
        s.round++;
        const n = s.players.length;
        s.order = Array.from({ length: n }, (_, k) => k); // immer dieselbe Reihenfolge: nach dem Minispiel fängt die Person nach der Letzten an
        s.turnIdx = 0;
        s.phase = 'board';
        if (s.round > 1) for (const p of s.players) if (p.shield > 0) p.shield--;
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

    #roll(seat, safe, now) {
        const s = this.s;
        if (s.phase !== 'board') return err('Gerade wird nicht gewürfelt.');
        if (seat !== this.#turnSeat) return err('Du bist nicht dran.');
        if (s.turnPhase !== 'roll') return err('Warte, bis die Figur angekommen ist.');
        this.#doRoll(seat, now, safe);
        return OK;
    }

    // Normaler Würfel 1–6 oder sicherer Würfel 2–4
    #doRoll(seat, now, safe = false) {
        const s = this.s;
        const [lo, hi] = safe ? SAFE_DIE : [1, 6];
        const value = lo + Math.floor(this.rng() * (hi - lo + 1));
        s.dice = { seat, value, safe };
        this.#event({ type: 'dice', seat, value, safe });
        this.#log(`${s.players[seat].name} würfelt ${safe ? 'mit dem sicheren Würfel ' : ''}eine ${value}.`);
        s.move = { seat, left: value, anim: 0, starAsked: false };
        this.#walk(now, []);
    }

    // Falle auf das eigene Feld legen (vor dem Wurf). Jede Person hat höchstens eine Falle, eine neue ersetzt die alte.
    #trap(seat) {
        const s = this.s;
        const p = s.players[seat];
        if (s.phase !== 'board' || s.turnPhase !== 'roll' || seat !== this.#turnSeat) return err('Fallen legt man vor dem eigenen Wurf.');
        if (!STAR_SPOTS.includes(p.pos)) return err('Auf diesem Feld kann man keine Falle legen.');
        if (s.traps.some(t => t.pos === p.pos)) return err('Hier liegt schon eine Falle.');
        if (p.coins < TRAP_COST) return err(`Eine Falle kostet ${TRAP_COST} Münzen.`);
        s.traps = s.traps.filter(t => t.owner !== seat);
        s.traps.push({ pos: p.pos, owner: seat });
        this.#addCoins(seat, -TRAP_COST, 'trap');
        this.#event({ type: 'trap', seat, pos: p.pos });
        this.#log(`${p.name} legt eine Falle.`);
        return OK;
    }

    #addCoins(seat, delta, why) {
        const p = this.s.players[seat];
        const actual = Math.max(-p.coins, delta);
        if (actual === 0) return 0;
        p.coins += actual;
        this.#event({ type: 'coins', seat, delta: actual, why });
        return actual;
    }

    // Schritte für die Animation als ein Ereignis melden
    #emitMove(seat, path) {
        if (path.length) this.#event({ type: 'move', seat, path: path.splice(0) });
    }

    // Läuft die restlichen Schritte. An einer Abzweigung wird angehalten und gefragt.
    #walk(now, path) {
        const s = this.s;
        const m = s.move;
        const p = s.players[m.seat];
        while (m.left > 0) {
            const options = nextOptions(p.pos, p.prev);
            if (options.length > 1) {
                this.#emitMove(m.seat, path);
                s.turnPhase = 'choose';
                s.choice = { seat: m.seat, options };
                s.turnDeadline = now + m.anim * STEP_MS + CHOICE_MS;
                return;
            }
            if (this.#step(options[0], path, now)) return;
        }
        this.#emitMove(m.seat, path);
        const anim = m.anim;
        s.move = null;
        this.#land(m.seat, now, anim);
    }

    // Ein Schritt. Gibt true zurück, wenn am Stern angehalten wird (Frage: kaufen?).
    #step(to, path, now) {
        const s = this.s;
        const m = s.move;
        const p = s.players[m.seat];
        p.prev = p.pos;
        p.pos = to;
        path.push(to);
        m.left--;
        m.anim++;
        // Wer am Stern vorbeikommt (oder darauf landet) und genug Münzen hat, wird gefragt
        if (!m.starAsked && to === s.star && p.coins >= STAR_PRICE) {
            m.starAsked = true;
            this.#emitMove(m.seat, path);
            s.turnPhase = 'buy';
            s.choice = { seat: m.seat, options: [] };
            s.turnDeadline = now + m.anim * STEP_MS + CHOICE_MS;
            return true;
        }
        return false;
    }

    #buy(seat, go, now) {
        const s = this.s;
        if (s.phase !== 'board' || s.turnPhase !== 'buy') return err('Gerade gibt es keinen Stern zu kaufen.');
        if (seat !== s.choice.seat) return err('Du bist nicht dran.');
        this.#doBuy(go, now);
        return OK;
    }

    #doBuy(go, now) {
        const s = this.s;
        const seat = s.choice.seat;
        s.choice = null;
        s.turnPhase = 'moving';
        if (go) this.#buyStar(seat);
        else this.#log(`${s.players[seat].name} lässt den Stern liegen.`);
        s.move.anim = 0;
        this.#walk(now, []);
    }

    #buyStar(seat) {
        const s = this.s;
        const p = s.players[seat];
        p.coins -= STAR_PRICE;
        p.stars++;
        this.#event({ type: 'star', seat, pos: s.star });
        this.#log(`${p.name} kauft den Stern für ${STAR_PRICE} Münzen!`);
        s.star = this.#newStarPos(s.star);
    }

    #choose(seat, to, now) {
        const s = this.s;
        if (s.phase !== 'board' || s.turnPhase !== 'choose') return err('Gerade gibt es keine Abzweigung.');
        if (seat !== s.choice.seat) return err('Du bist nicht dran.');
        const target = Number(to);
        if (!s.choice.options.includes(target)) return err('Dort geht es nicht weiter.');
        this.#continueWith(target, now);
        return OK;
    }

    #continueWith(target, now) {
        const s = this.s;
        s.choice = null;
        s.turnPhase = 'moving';
        s.move.anim = 0;
        const path = [];
        if (this.#step(target, path, now)) return;
        this.#walk(now, path);
    }

    // Feldereignis nach dem Zug. Duell und Teleport warten auf eine Entscheidung.
    #land(seat, now, anim) {
        const s = this.s;
        const p = s.players[seat];
        const type = SPACE_TYPES[p.pos];
        const wait = anim * STEP_MS;
        // Falle einer anderen Person: bis zu 5 Münzen an sie, die Falle ist danach weg
        const trap = s.traps.find(t => t.pos === p.pos && t.owner !== seat);
        if (trap) {
            s.traps = s.traps.filter(t => t !== trap);
            const amount = -this.#addCoins(seat, -TRAP_COST, 'trap');
            if (amount) this.#addCoins(trap.owner, amount, 'trap');
            this.#event({ type: 'trapHit', seat, owner: trap.owner, pos: p.pos, amount });
            this.#log(`${p.name} tappt in die Falle von ${s.players[trap.owner].name} und zahlt ${amount} Münzen.`);
        }
        if (type === 'blue') {
            this.#addCoins(seat, COIN_GAIN, 'blue');
            this.#log(`${p.name} landet auf einem blauen Feld: +${COIN_GAIN} Münzen.`);
        } else if (type === 'red') {
            const lost = -this.#addCoins(seat, -COIN_LOSS, 'red');
            this.#log(`${p.name} landet auf einem roten Feld: −${lost} Münzen.`);
        } else if (type === 'luck') {
            this.#luckEvent(seat);
        } else if (type === 'shield') {
            p.shield = SHIELD_ROUNDS;
            this.#event({ type: 'shield', seat, pos: p.pos });
            this.#log(`${p.name} bekommt ein Schild: ${SHIELD_ROUNDS} Runden kann niemand einen Stern klauen.`);
        } else if (type === 'duel') {
            this.#event({ type: 'info', seat, text: `Duell! ${p.name} wählt einen Gegner.` });
            this.#log(`${p.name} landet auf einem Duellfeld.`);
            s.turnPhase = 'duel';
            s.choice = { seat, options: s.players.map((x, i) => i).filter(i => i !== seat) };
            s.turnDeadline = now + wait + CHOICE_MS;
            return;
        } else if (type === 'teleport') {
            this.#event({ type: 'info', seat, text: `Teleport! ${p.name} kann direkt zum Stern springen.` });
            s.turnPhase = 'teleport';
            s.choice = { seat, options: [] };
            s.turnDeadline = now + wait + CHOICE_MS;
            return;
        }
        s.turnPhase = 'moving';
        s.movingUntil = now + wait + EFFECT_MS;
    }

    #duelPick(seat, target, stake, now) {
        const s = this.s;
        if (s.phase !== 'board' || s.turnPhase !== 'duel') return err('Gerade gibt es kein Duell.');
        if (seat !== s.choice.seat) return err('Du bist nicht dran.');
        const t = Number(target);
        if (!s.choice.options.includes(t)) return err('Ungültiger Gegner.');
        this.#startDuel(seat, t, now, stake);
        return OK;
    }

    #teleport(seat, go, now) {
        const s = this.s;
        if (s.phase !== 'board' || s.turnPhase !== 'teleport') return err('Gerade gibt es keinen Teleport.');
        if (seat !== s.choice.seat) return err('Du bist nicht dran.');
        this.#doTeleport(seat, go, now);
        return OK;
    }

    #doTeleport(seat, go, now) {
        const s = this.s;
        const p = s.players[seat];
        s.choice = null;
        if (go) {
            const from = p.pos;
            p.pos = s.star;
            p.prev = null; // danach darf die Person in jede Richtung loslaufen
            this.#event({ type: 'teleport', seat, from, to: p.pos });
            this.#log(`${p.name} teleportiert sich zum Stern.`);
            if (p.coins >= STAR_PRICE) this.#buyStar(seat);
            else this.#event({ type: 'info', seat, text: `${p.name} hat zu wenig Münzen für den Stern.` });
        } else {
            this.#log(`${p.name} bleibt, wo sie oder er ist.`);
        }
        s.turnPhase = 'moving';
        s.movingUntil = now + EFFECT_MS;
    }

    // Wer nicht rechtzeitig entscheidet (oder offline ist), dem nimmt das Spiel die Entscheidung ab
    #autoChoice(now) {
        const s = this.s;
        const { seat, options } = s.choice;
        if (s.turnPhase === 'choose') {
            this.#continueWith(options[Math.floor(this.rng() * options.length)], now);
        } else if (s.turnPhase === 'buy') {
            this.#doBuy(true, now);
        } else if (s.turnPhase === 'duel') {
            const online = options.filter(i => s.players[i].connected);
            const pool = online.length ? online : options;
            this.#startDuel(seat, pool[Math.floor(this.rng() * pool.length)], now);
        } else {
            this.#doTeleport(seat, s.players[seat].coins >= STAR_PRICE, now);
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
                [p.prev, q.prev] = [null, null];
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

    // stake: 'star' (Stern, sonst Münzen) oder 'coins' (nur Münzen)
    #startDuel(a, b, now, stake = 'star') {
        const s = this.s;
        const type = DUEL_TYPES[Math.floor(this.rng() * DUEL_TYPES.length)];
        s.choice = null;
        s.miniCounter++;
        s.mini = createMini({ type, id: s.miniCounter, rng: this.rng, players: s.players, now, star: false, duel: [a, b] });
        s.mini.stake = stake;
        s.phase = 'mini';
        s.inDuel = true;
        this.#event({ type: 'duel', a, b, stake });
        this.#log(`Duell um ${stake === 'coins' ? 'Münzen' : 'einen Stern'}: ${s.players[a].name} gegen ${s.players[b].name} (${s.mini.title}).`);
    }

    // Duell: Wer gewinnt, bekommt vom Gegner 1 Stern (außer er hat ein Schild oder es geht nur um Münzen) oder bis zu 10 Münzen.
    #duelRewards() {
        const s = this.s;
        const m = s.mini;
        const [a, b] = m.duel;
        const sa = m.scores[a] ?? 0;
        const sb = m.scores[b] ?? 0;
        if (sa === sb) {
            m.result = [{ seat: a, score: sa, rank: 1, coins: 0, stars: 0 }, { seat: b, score: sb, rank: 1, coins: 0, stars: 0 }];
            m.outcome = { winner: null, stake: m.stake };
            this.#log(`Duell unentschieden: ${s.players[a].name} und ${s.players[b].name} gehen leer aus.`);
            return;
        }
        const [w, l] = sa > sb ? [a, b] : [b, a];
        const W = s.players[w];
        const L = s.players[l];
        const forStar = m.stake !== 'coins';
        const shielded = forStar && L.stars > 0 && L.shield > 0;
        let stars = 0;
        let coins = 0;
        W.duelWins = (W.duelWins ?? 0) + 1;
        if (forStar && L.stars > 0 && !shielded) {
            stars = 1;
            L.stars--;
            W.stars++;
        } else {
            coins = Math.min(DUEL_COINS, L.coins);
            L.coins -= coins;
            W.coins += coins;
        }
        m.result = [
            { seat: w, score: m.scores[w] ?? 0, rank: 1, coins, stars },
            { seat: l, score: m.scores[l] ?? 0, rank: 2, coins: -coins, stars: -stars },
        ];
        m.outcome = { winner: w, loser: l, stars, coins, shielded, stake: m.stake };
        this.#log(`${W.name} gewinnt das Duell und bekommt ${stars ? 'einen Stern' : `${coins} Münzen`} von ${L.name}${shielded ? ' (das Schild schützt den Stern)' : ''}.`);
    }

    #mini(seat, a, now) {
        const s = this.s;
        if (s.phase !== 'mini' || !s.mini) return err('Gerade läuft kein Minispiel.');
        return miniAction(s.mini, seat, a, now, s.players);
    }

    #applyRewards() {
        const s = this.s;
        const m = s.mini;
        if (m.duel) return this.#duelRewards();
        const seats = s.players.map((p, i) => i);
        const rewards = computeRewards(m.scores, seats, m.star, !!m.teams);
        for (const r of rewards) {
            s.players[r.seat].coins += r.coins;
            s.players[r.seat].stars += r.stars;
        }
        m.result = rewards;
        for (const r of rewards) if (r.rank === 1 && r.score > 0) s.players[r.seat].miniWins = (s.players[r.seat].miniWins ?? 0) + 1;
        const winner = rewards.find(r => r.rank === 1 && r.score > 0);
        this.#log(winner ? `${m.title}: ${s.players[winner.seat].name} gewinnt${winner.stars ? ' einen Stern' : ''}!` : `${m.title}: niemand hat gepunktet.`);
    }

    #afterMini(now) {
        const s = this.s;
        s.mini = null;
        if (s.inDuel) {
            // Nach dem Duell geht der Zug weiter wie nach jedem anderen Feld
            s.inDuel = false;
            s.phase = 'board';
            this.#nextTurn(now);
            return;
        }
        if (s.round >= s.rounds) {
            s.phase = 'over';
            this.#awardBonus();
            const best = this.ranking()[0];
            this.#log(`Das Spiel ist aus! ${s.players[best.seat].name} gewinnt.`);
        } else {
            this.#startRound(now);
        }
        this.#bump();
    }

    // Bonus-Sterne: je Wertung bekommen die Besten (mit mehr als 0) einen Stern
    #awardBonus() {
        const s = this.s;
        s.bonus = BONUSES.map(b => {
            const best = Math.max(0, ...s.players.map(p => p[b.key] ?? 0));
            const seats = best > 0 ? s.players.map((p, i) => i).filter(i => (s.players[i][b.key] ?? 0) === best) : [];
            for (const i of seats) s.players[i].stars++;
            if (seats.length) this.#log(`Bonus-Stern ${b.title}: ${seats.map(i => s.players[i].name).join(', ')}`);
            return { key: b.key, title: b.title, what: b.what, value: best, seats };
        });
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
            } else if (s.choice) {
                if (!s.players[s.choice.seat].connected || now >= s.turnDeadline) {
                    this.#autoChoice(now);
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
        this.#track();
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
            turnMsLeft: s.phase === 'board' && (s.turnPhase === 'roll' || s.choice) ? Math.max(0, s.turnDeadline - now) : 0,
            choice: s.phase === 'board' ? s.choice : null,
            moveLeft: s.move?.left ?? 0,
            inDuel: s.inDuel,
            starPos: s.star,
            dice: s.dice,
            players: s.players.map(p => ({
                name: p.name, connected: p.connected, coins: p.coins, stars: p.stars, pos: p.pos, shield: p.shield,
                miniWins: p.miniWins ?? 0, duelWins: p.duelWins ?? 0, maxCoins: p.maxCoins ?? p.coins,
            })),
            traps: s.traps,
            trapCost: TRAP_COST,
            safeDie: SAFE_DIE,
            bonuses: BONUSES,
            bonus: s.phase === 'over' ? s.bonus : null,
            miniCycle: { done: s.miniCounter === 0 ? 0 : availableMinis(s.players.length).length - (s.miniBag?.length ?? 0), total: availableMinis(s.players.length).length },
            mini: s.mini ? miniView(s.mini, seat, now, s.players) : null,
            events: s.events,
            eventSeq: s.eventSeq,
            log: s.log,
            ranking: s.phase === 'over' ? this.ranking() : null,
        };
    }
}
