// Spielablauf für Monopoly (2 bis 4 Spieler). Läuft nur beim Host und ist die einzige Instanz,
// die den Spielstand verändert. Alle anderen bekommen über view() den öffentlichen Stand.
//
// Ablauf eines Zugs (turnPhase): roll -> (buy | auction) -> end -> nächster Spieler.
// Zahlungen laufen über eine Warteschlange (queue). Kann jemand nicht zahlen, entsteht eine Schuld (debt),
// bis er Geld beschafft hat oder bankrott geht. "cont" merkt sich, was danach weitergeht.
import {
    SPACES, CHANCE_CARDS, CHEST_CARDS, START_CASH, GO_SALARY, JAIL_FINE, JAIL_POS, MIN_PLAYERS, MAX_PLAYERS,
    newProps, isOwnable, rentOf, stock, canBuild, canSellBuilding, canMortgage, canUnmortgage, houseCost,
    mortgageValue, unmortgageCost, liquidationValue, netWorth, groupIndices,
} from './board.js';

export { MIN_PLAYERS, MAX_PLAYERS };
const HOST_SEAT = 0;
const LOG_LIMIT = 60;
const EVENT_LIMIT = 24;

const err = error => ({ error });
const OK = { ok: true };
const isInt = n => Number.isInteger(n) && n >= 0;

function defaultRng() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export class MonopolyGame {
    constructor({ rng = defaultRng } = {}) {
        this.rng = rng;
        this.forcedDice = []; // nur für Tests: vorgegebene Würfe
        this.s = {
            phase: 'waiting', // waiting (Lobby) | playing | over
            players: [], // { name, token, connected, cash, pos, inJail, jailTurns, jailCards, bankrupt }
            props: newProps(),
            decks: { chance: [], chest: [] },
            turn: 0,
            turnPhase: 'roll', // roll | buy | auction | end
            dice: null,
            doublesCount: 0,
            extra: false, // nach dem Zug nochmal würfeln (Pasch)
            sentToJail: false,
            cont: null, // was nach Zahlungen weitergeht: 'landing' | 'nextTurn' | { kind: 'jailMove', total }
            queue: [], // offene Zahlungen { from, to (null = Bank), amount, reason }
            debt: null, // { seat, amount, to }
            auction: null, // { idx, high, highBy, active: [seats], at }
            pendingAuctions: [],
            trade: null, // { id, from, to, give, get }
            tradeId: 0,
            moveNo: 0,
            round: 0,
            winner: null,
            events: [],
            eventSeq: 0,
            log: [],
        };
    }

    static restore(data, opts) {
        const game = new MonopolyGame(opts);
        game.s = data;
        for (const p of game.s.players) p.connected = false;
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
        s.players.push({ name: clean, token, connected: true, cash: START_CASH, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false });
        s.moveNo++;
        return s.players.length - 1;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
    }

    // ---------- Aktionen ----------

    apply(seat, a) {
        const s = this.s;
        const me = s.players[seat];
        if (!me) return err('Unbekannter Spieler.');
        let result;
        switch (a?.t) {
            case 'start': result = this.#start(seat); break;
            case 'rematch': result = this.#rematch(); break;
            default:
                if (s.phase !== 'playing') return err('Gerade läuft kein Spiel.');
                if (me.bankrupt) return err('Du bist schon ausgeschieden.');
                result = this.#playAction(seat, a);
        }
        if (!result.error) this.#touch();
        return result;
    }

    #playAction(seat, a) {
        switch (a.t) {
            case 'roll': return this.#roll(seat);
            case 'buy': return this.#buy(seat);
            case 'decline': return this.#decline(seat);
            case 'bid': return this.#bid(seat, a.amount);
            case 'pass': return this.#passBid(seat);
            case 'endTurn': return this.#endTurn(seat);
            case 'payJail': return this.#payJail(seat);
            case 'useJailCard': return this.#useJailCard(seat);
            case 'build': return this.#manage(seat, a.idx, 'build');
            case 'sellBuilding': return this.#manage(seat, a.idx, 'sell');
            case 'mortgage': return this.#manage(seat, a.idx, 'mortgage');
            case 'unmortgage': return this.#manage(seat, a.idx, 'unmortgage');
            case 'bankrupt': return this.#declareBankrupt(seat);
            case 'resign': return this.#resign(seat);
            case 'tradeOffer': return this.#tradeOffer(seat, a);
            case 'tradeAccept': return this.#tradeAnswer(seat, true);
            case 'tradeDecline': return this.#tradeAnswer(seat, false);
            case 'tradeCancel': return this.#tradeCancel(seat);
            default: return err('Unbekannte Aktion.');
        }
    }

    #touch() {
        this.s.moveNo++;
    }

    #start(seat) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das Spiel starten.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (s.players.length < MIN_PLAYERS) return err('Es fehlen noch Mitspieler.');
        this.#newGame();
        return OK;
    }

    #rematch() {
        if (this.s.phase !== 'over') return err('Das Spiel läuft noch.');
        this.#newGame();
        return OK;
    }

    #newGame() {
        const s = this.s;
        for (const p of s.players) Object.assign(p, { cash: START_CASH, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false });
        s.props = newProps();
        s.decks = { chance: this.#shuffled(CHANCE_CARDS.length), chest: this.#shuffled(CHEST_CARDS.length) };
        s.turn = Math.floor(this.rng() * s.players.length);
        Object.assign(s, {
            phase: 'playing', turnPhase: 'roll', dice: null, doublesCount: 0, extra: false, sentToJail: false,
            cont: null, queue: [], debt: null, auction: null, pendingAuctions: [], trade: null, winner: null,
            events: [], log: [],
        });
        s.round++;
        this.#log(`Das Spiel beginnt. ${s.players[s.turn].name} fängt an.`);
    }

    #shuffled(n) {
        const ids = Array.from({ length: n }, (_, i) => i);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        return ids;
    }

    // ---------- Protokoll und Ereignisse (für die Animation bei allen) ----------

    #log(text) {
        this.s.log.push(text);
        if (this.s.log.length > LOG_LIMIT) this.s.log.shift();
    }

    #event(e) {
        const s = this.s;
        s.events.push({ id: ++s.eventSeq, ...e });
        if (s.events.length > EVENT_LIMIT) s.events.shift();
    }

    #name(seat) {
        return seat === null ? 'die Bank' : this.s.players[seat].name;
    }

    #alive() {
        return this.s.players.map((p, i) => i).filter(i => !this.s.players[i].bankrupt);
    }

    // ---------- Würfeln und Bewegen ----------

    #rollDice() {
        if (this.forcedDice.length) return this.forcedDice.shift();
        const die = () => Math.floor(this.rng() * 6) + 1;
        return [die(), die()];
    }

    #locked() {
        const s = this.s;
        return s.debt || s.auction;
    }

    #roll(seat) {
        const s = this.s;
        if (seat !== s.turn) return err('Du bist nicht am Zug.');
        if (s.turnPhase !== 'roll' || this.#locked()) return err('Du kannst gerade nicht würfeln.');
        const p = s.players[seat];
        const d = this.#rollDice();
        const total = d[0] + d[1];
        const doubles = d[0] === d[1];
        s.dice = d;
        this.#event({ type: 'dice', seat, d });
        this.#log(`${p.name} würfelt ${d[0]} und ${d[1]}${doubles ? ' (Pasch)' : ''}.`);

        if (p.inJail) {
            if (doubles) {
                p.inJail = false;
                p.jailTurns = 0;
                s.extra = false;
                this.#log(`${p.name} kommt mit einem Pasch aus dem Gefängnis.`);
                this.#moveBy(seat, total);
                this.#afterMove(seat);
            } else {
                p.jailTurns++;
                if (p.jailTurns >= 3) {
                    this.#log(`${p.name} hat dreimal keinen Pasch gewürfelt und zahlt M ${JAIL_FINE}.`);
                    s.cont = { kind: 'jailMove', total };
                    this.#pay(seat, null, JAIL_FINE, 'Gefängnis');
                    this.#resume();
                } else {
                    this.#log(`${p.name} bleibt im Gefängnis.`);
                    s.turnPhase = 'end';
                }
            }
            return OK;
        }

        if (doubles) {
            s.doublesCount++;
            if (s.doublesCount >= 3) {
                this.#log(`${p.name} würfelt dreimal hintereinander einen Pasch und muss ins Gefängnis.`);
                this.#sendToJail(seat);
                s.extra = false;
                s.turnPhase = 'end';
                return OK;
            }
        }
        s.extra = doubles;
        this.#moveBy(seat, total);
        this.#afterMove(seat);
        return OK;
    }

    #moveBy(seat, steps) {
        const p = this.s.players[seat];
        const to = (p.pos + steps) % 40;
        this.#moveTo(seat, to, true);
    }

    // forward: vorwärts laufen (und bei Überschreiten von LOS kassieren), sonst direkter Sprung
    #moveTo(seat, to, forward) {
        const p = this.s.players[seat];
        const from = p.pos;
        const passes = forward && to <= from;
        p.pos = to;
        this.#event({ type: 'move', seat, from, to, mode: forward ? 'walk' : 'jump' });
        if (passes) {
            p.cash += GO_SALARY;
            this.#log(`${p.name} kommt über LOS und zieht M ${GO_SALARY} ein.`);
        }
    }

    #sendToJail(seat) {
        const s = this.s;
        const p = s.players[seat];
        const from = p.pos;
        p.pos = JAIL_POS;
        p.inJail = true;
        p.jailTurns = 0;
        if (seat === s.turn) s.sentToJail = true;
        this.#event({ type: 'move', seat, from, to: JAIL_POS, mode: 'jump' });
        this.#log(`${p.name} geht ins Gefängnis.`);
    }

    #afterMove(seat) {
        this.s.cont = 'landing';
        this.#landOn(seat, {});
        this.#resume();
    }

    // Wirkung des Felds. Legt Zahlungen in die Warteschlange oder setzt turnPhase 'buy'; weiter geht es in #resume().
    #landOn(seat, opts) {
        const s = this.s;
        const p = s.players[seat];
        const space = SPACES[p.pos];
        switch (space.type) {
            case 'street':
            case 'rail':
            case 'util': {
                const prop = s.props[p.pos];
                if (prop.owner === null) {
                    s.turnPhase = 'buy';
                } else if (prop.owner !== seat && !prop.mortgaged) {
                    let amount;
                    if (space.type === 'util' && opts.utilTen) {
                        const d = this.#rollDice();
                        s.dice = d;
                        this.#event({ type: 'dice', seat, d });
                        amount = (d[0] + d[1]) * 10;
                        this.#log(`${p.name} würfelt ${d[0]} und ${d[1]} für das Versorgungswerk.`);
                    } else {
                        amount = rentOf(s.props, p.pos, s.dice ? s.dice[0] + s.dice[1] : 0, opts.railMult || 1);
                    }
                    this.#pay(seat, prop.owner, amount, `Miete für ${space.name}`);
                }
                break;
            }
            case 'tax':
                this.#pay(seat, null, space.amount, space.name);
                break;
            case 'gotojail':
                this.#sendToJail(seat);
                break;
            case 'chance':
                this.#drawCard(seat, 'chance');
                break;
            case 'chest':
                this.#drawCard(seat, 'chest');
                break;
            default:
                break; // LOS, Gefängnis (nur Besuch), Frei Parken
        }
    }

    #drawCard(seat, deck) {
        const s = this.s;
        const p = s.players[seat];
        const cards = deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
        const id = s.decks[deck].shift();
        const card = cards[id];
        if (card.kind === 'jailFree') p.jailCards.push(deck);
        else s.decks[deck].push(id);
        this.#event({ type: 'card', seat, deck, text: card.text });
        this.#log(`${p.name} zieht eine ${deck === 'chance' ? 'Ereigniskarte' : 'Gemeinschaftskarte'}: ${card.text}`);
        switch (card.kind) {
            case 'moveTo':
                this.#moveTo(seat, card.to, true);
                this.#landOn(seat, {});
                break;
            case 'moveNearest': {
                let to = p.pos;
                do to = (to + 1) % 40;
                while (SPACES[to].type !== card.what);
                this.#moveTo(seat, to, true);
                this.#landOn(seat, card.what === 'rail' ? { railMult: 2 } : { utilTen: true });
                break;
            }
            case 'gain':
                p.cash += card.amount;
                break;
            case 'pay':
                this.#pay(seat, null, card.amount, 'Karte');
                break;
            case 'gainEach':
                for (const o of this.#alive()) if (o !== seat) this.#pay(o, seat, card.amount, 'Karte');
                break;
            case 'payEach':
                for (const o of this.#alive()) if (o !== seat) this.#pay(seat, o, card.amount, 'Karte');
                break;
            case 'jailFree':
                break;
            case 'gotoJail':
                this.#sendToJail(seat);
                break;
            case 'back':
                this.#moveTo(seat, (p.pos + 40 - card.n) % 40, false);
                this.#landOn(seat, {});
                break;
            case 'repairs': {
                let houses = 0;
                let hotels = 0;
                s.props.forEach(pr => {
                    if (pr && pr.owner === seat) {
                        if (pr.houses === 5) hotels++;
                        else houses += pr.houses;
                    }
                });
                this.#pay(seat, null, houses * card.house + hotels * card.hotel, 'Reparaturen');
                break;
            }
        }
    }

    // ---------- Zahlungen, Schulden, Weiterlaufen ----------

    #pay(from, to, amount, reason) {
        if (amount > 0) this.s.queue.push({ from, to, amount, reason });
    }

    // Arbeitet Zahlungen ab; bleibt bei einer Schuld stehen. Danach Auktionen, dann die Fortsetzung des Zugs.
    #resume() {
        const s = this.s;
        while (s.queue.length) {
            const q = s.queue[0];
            if (s.players[q.from].bankrupt || (q.to !== null && s.players[q.to].bankrupt)) {
                s.queue.shift();
                continue;
            }
            const payer = s.players[q.from];
            if (payer.cash >= q.amount) {
                payer.cash -= q.amount;
                if (q.to !== null) s.players[q.to].cash += q.amount;
                s.queue.shift();
                this.#log(`${payer.name} zahlt M ${q.amount} an ${this.#name(q.to)} (${q.reason}).`);
                this.#event({ type: 'pay', from: q.from, to: q.to, amount: q.amount });
            } else {
                if (!s.debt) this.#log(`${payer.name} kann M ${q.amount} an ${this.#name(q.to)} nicht zahlen und muss Geld beschaffen.`);
                s.debt = { seat: q.from, amount: q.amount, to: q.to };
                return;
            }
        }
        s.debt = null;
        if (this.#alive().length <= 1) return this.#finishGame();
        if (s.turnPhase === 'buy') return;
        if (s.pendingAuctions.length) return this.#startAuction(s.pendingAuctions.shift());
        if (s.auction) return;
        const c = s.cont;
        s.cont = null;
        if (c === 'landing') this.#finishLanding();
        else if (c === 'nextTurn') this.#nextTurn();
        else if (c?.kind === 'jailMove') {
            const p = s.players[s.turn];
            p.inJail = false;
            p.jailTurns = 0;
            s.extra = false;
            this.#moveBy(s.turn, c.total);
            this.#afterMove(s.turn);
        }
    }

    #finishLanding() {
        const s = this.s;
        const p = s.players[s.turn];
        if (p.bankrupt) return this.#nextTurn();
        s.turnPhase = s.extra && !p.inJail && !s.sentToJail ? 'roll' : 'end';
        if (s.turnPhase === 'roll') this.#log(`${p.name} hat einen Pasch und würfelt noch einmal.`);
    }

    #nextTurn() {
        const s = this.s;
        if (this.#alive().length <= 1) return this.#finishGame();
        let next = s.turn;
        do next = (next + 1) % s.players.length;
        while (s.players[next].bankrupt);
        s.turn = next;
        s.turnPhase = 'roll';
        s.doublesCount = 0;
        s.extra = false;
        s.sentToJail = false;
        s.cont = null;
    }

    #endTurn(seat) {
        const s = this.s;
        if (seat !== s.turn) return err('Du bist nicht am Zug.');
        if (s.turnPhase !== 'end' || this.#locked()) return err('Du kannst den Zug gerade nicht beenden.');
        this.#nextTurn();
        return OK;
    }

    #finishGame() {
        const s = this.s;
        const alive = this.#alive();
        s.phase = 'over';
        s.winner = alive.length === 1 ? alive[0] : null;
        s.debt = null;
        s.auction = null;
        s.trade = null;
        if (s.winner !== null) this.#log(`${s.players[s.winner].name} gewinnt das Spiel!`);
    }

    // ---------- Kaufen und Versteigern ----------

    #buy(seat) {
        const s = this.s;
        if (seat !== s.turn || s.turnPhase !== 'buy') return err('Du kannst hier gerade nichts kaufen.');
        const p = s.players[seat];
        const idx = p.pos;
        const price = SPACES[idx].price;
        if (p.cash < price) return err('Nicht genug Geld. Du kannst nur versteigern.');
        p.cash -= price;
        s.props[idx].owner = seat;
        s.cont = null;
        this.#log(`${p.name} kauft ${SPACES[idx].name} für M ${price}.`);
        this.#event({ type: 'buy', seat, idx, price });
        this.#finishLanding();
        return OK;
    }

    #decline(seat) {
        const s = this.s;
        if (seat !== s.turn || s.turnPhase !== 'buy') return err('Hier gibt es nichts zu versteigern.');
        this.#log(`${s.players[seat].name} kauft ${SPACES[s.players[seat].pos].name} nicht. Das Grundstück wird versteigert.`);
        this.#startAuction(s.players[seat].pos);
        return OK;
    }

    #startAuction(idx) {
        const s = this.s;
        const alive = this.#alive();
        // Reihenfolge: ab dem Spieler links vom aktuellen
        const order = [];
        for (let k = 1; k <= s.players.length; k++) {
            const seat = (s.turn + k) % s.players.length;
            if (alive.includes(seat)) order.push(seat);
        }
        s.turnPhase = 'auction';
        s.auction = { idx, high: 0, highBy: null, active: order, at: 0 };
        this.#log(`Versteigerung: ${SPACES[idx].name}.`);
    }

    #bid(seat, amount) {
        const s = this.s;
        const au = s.auction;
        if (!au) return err('Es läuft keine Versteigerung.');
        if (au.active[au.at] !== seat) return err('Du bist beim Bieten nicht dran.');
        if (!isInt(amount) || amount <= au.high) return err(`Du musst mehr als M ${au.high} bieten.`);
        if (amount > s.players[seat].cash) return err('Du hast nicht genug Geld für dieses Gebot.');
        au.high = amount;
        au.highBy = seat;
        this.#log(`${s.players[seat].name} bietet M ${amount}.`);
        this.#advanceAuction();
        return OK;
    }

    #passBid(seat) {
        const s = this.s;
        const au = s.auction;
        if (!au) return err('Es läuft keine Versteigerung.');
        if (au.active[au.at] !== seat) return err('Du bist beim Bieten nicht dran.');
        au.active.splice(au.at, 1);
        if (au.at >= au.active.length) au.at = 0;
        this.#log(`${s.players[seat].name} steigt aus.`);
        this.#advanceAuction(true);
        return OK;
    }

    // after = true: nach einem Ausstieg steht "at" schon auf dem nächsten Bieter, sonst muss weitergerückt werden
    #advanceAuction(afterPass = false) {
        const s = this.s;
        const au = s.auction;
        if (au.active.length === 0) return this.#endAuction();
        if (au.active.length === 1 && au.highBy === au.active[0]) return this.#endAuction();
        if (!afterPass) au.at = (au.at + 1) % au.active.length;
        // Wer schon Höchstbietender ist, muss nicht gegen sich selbst bieten
        if (au.highBy !== null && au.active[au.at] === au.highBy && au.active.length > 1) au.at = (au.at + 1) % au.active.length;
    }

    #endAuction() {
        const s = this.s;
        const au = s.auction;
        s.auction = null;
        if (au.highBy !== null && au.high > 0) {
            s.players[au.highBy].cash -= au.high;
            s.props[au.idx].owner = au.highBy;
            this.#log(`${s.players[au.highBy].name} ersteigt ${SPACES[au.idx].name} für M ${au.high}.`);
            this.#event({ type: 'buy', seat: au.highBy, idx: au.idx, price: au.high });
        } else {
            this.#log(`${SPACES[au.idx].name} bleibt unverkauft.`);
        }
        s.turnPhase = 'end';
        this.#resume();
    }

    // ---------- Gefängnis ----------

    #payJail(seat) {
        const s = this.s;
        const p = s.players[seat];
        if (seat !== s.turn || s.turnPhase !== 'roll' || !p.inJail || this.#locked()) return err('Das geht gerade nicht.');
        if (p.cash < JAIL_FINE) return err('Nicht genug Geld.');
        p.cash -= JAIL_FINE;
        p.inJail = false;
        p.jailTurns = 0;
        this.#log(`${p.name} zahlt M ${JAIL_FINE} und kommt aus dem Gefängnis frei.`);
        return OK;
    }

    #useJailCard(seat) {
        const s = this.s;
        const p = s.players[seat];
        if (seat !== s.turn || s.turnPhase !== 'roll' || !p.inJail || this.#locked()) return err('Das geht gerade nicht.');
        if (!p.jailCards.length) return err('Du hast keine Freikarte.');
        const deck = p.jailCards.shift();
        // Karte zurück unter den Stapel (Index der Karte: erste Freikarte im Kartensatz)
        const cards = deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
        s.decks[deck].push(cards.findIndex(c => c.kind === 'jailFree'));
        p.inJail = false;
        p.jailTurns = 0;
        this.#log(`${p.name} benutzt eine Freikarte und verlässt das Gefängnis.`);
        return OK;
    }

    // ---------- Häuser, Hypotheken ----------

    // Verwalten darf, wer am Zug ist, oder wer gerade eine Schuld hat. Nicht während einer Versteigerung.
    #canManage(seat) {
        const s = this.s;
        if (s.auction) return false;
        if (s.debt) return s.debt.seat === seat;
        return seat === s.turn;
    }

    #manage(seat, idx, kind) {
        const s = this.s;
        if (!this.#canManage(seat)) return err('Das kannst du gerade nicht.');
        if (!Number.isInteger(idx) || !s.props[idx]) return err('Unbekanntes Grundstück.');
        const p = s.players[seat];
        const name = SPACES[idx].name;
        let r;
        switch (kind) {
            case 'build':
                r = canBuild(s.props, seat, p.cash, idx);
                if (!r.ok) return err(r.error);
                p.cash -= r.cost;
                s.props[idx].houses++;
                this.#log(`${p.name} baut ${s.props[idx].houses === 5 ? 'ein Hotel' : 'ein Haus'} auf ${name}.`);
                break;
            case 'sell':
                r = canSellBuilding(s.props, seat, idx);
                if (!r.ok) return err(r.error);
                p.cash += r.refund;
                s.props[idx].houses--;
                this.#log(`${p.name} verkauft ein Gebäude auf ${name}.`);
                break;
            case 'mortgage':
                r = canMortgage(s.props, seat, idx);
                if (!r.ok) return err(r.error);
                p.cash += r.amount;
                s.props[idx].mortgaged = true;
                this.#log(`${p.name} nimmt eine Hypothek auf ${name} auf (M ${r.amount}).`);
                break;
            case 'unmortgage':
                r = canUnmortgage(s.props, seat, p.cash, idx);
                if (!r.ok) return err(r.error);
                p.cash -= r.cost;
                s.props[idx].mortgaged = false;
                this.#log(`${p.name} löst die Hypothek auf ${name} ab (M ${r.cost}).`);
                break;
        }
        if (s.debt) this.#resume(); // reicht das Geld jetzt, wird die Schuld automatisch bezahlt
        return OK;
    }

    // ---------- Bankrott ----------

    #declareBankrupt(seat) {
        const s = this.s;
        if (!s.debt || s.debt.seat !== seat) return err('Du hast keine offene Schuld.');
        if (liquidationValue(s.props, seat, s.players[seat].cash) >= s.debt.amount) {
            return err('Du kannst die Schuld noch bezahlen: Verkaufe Gebäude oder nimm Hypotheken auf.');
        }
        this.#bankrupt(seat, s.debt.to);
        return OK;
    }

    #resign(seat) {
        const s = this.s;
        if (seat !== s.turn || s.auction) return err('Aufgeben ist nur in deinem eigenen Zug möglich.');
        this.#bankrupt(seat, null);
        return OK;
    }

    // creditor: Seat oder null (Bank). An einen Gläubiger geht alles, an die Bank werden die Grundstücke versteigert.
    #bankrupt(seat, creditor) {
        const s = this.s;
        const p = s.players[seat];
        this.#log(`${p.name} ist pleite${creditor === null ? '' : ` und übergibt alles an ${s.players[creditor].name}`}.`);
        // Gebäude gehen zurück an die Bank (halber Preis fürs Bargeld)
        s.props.forEach((pr, idx) => {
            if (pr && pr.owner === seat && pr.houses > 0) {
                p.cash += (pr.houses * houseCost(idx)) / 2;
                pr.houses = 0;
            }
        });
        const owned = s.props.map((pr, idx) => idx).filter(idx => s.props[idx] && s.props[idx].owner === seat);
        if (creditor !== null) {
            s.players[creditor].cash += p.cash;
            for (const idx of owned) {
                s.props[idx].owner = creditor;
                // Beliehene Grundstücke: der Erwerber zahlt sofort 10 % Zinsen an die Bank
                if (s.props[idx].mortgaged) this.#pay(creditor, null, Math.ceil(mortgageValue(idx) * 0.1), `Zinsen auf ${SPACES[idx].name}`);
            }
            s.players[creditor].jailCards.push(...p.jailCards);
        } else {
            for (const idx of owned) {
                s.props[idx].owner = null;
                s.props[idx].mortgaged = false;
                s.pendingAuctions.push(idx);
            }
            for (const deck of p.jailCards) {
                const cards = deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
                s.decks[deck].push(cards.findIndex(c => c.kind === 'jailFree'));
            }
        }
        p.cash = 0;
        p.jailCards = [];
        p.bankrupt = true;
        p.inJail = false;
        s.debt = null;
        this.#event({ type: 'out', seat });
        if (seat === s.turn) {
            s.turnPhase = 'end';
            s.cont = 'nextTurn';
        }
        this.#resume();
    }

    // ---------- Handeln ----------

    // Angebot { to, give: { cash, props: [], cards }, get: { cash, props: [], cards } } aus Sicht des Anbieters
    #cleanSide(x) {
        return {
            cash: isInt(x?.cash) ? x.cash : 0,
            props: Array.isArray(x?.props) ? [...new Set(x.props.filter(i => Number.isInteger(i)))] : [],
            cards: isInt(x?.cards) ? x.cards : 0,
        };
    }

    #checkTrade(t) {
        const s = this.s;
        const a = s.players[t.from];
        const b = s.players[t.to];
        if (!b || t.from === t.to || a.bankrupt || b.bankrupt) return 'Mit diesem Spieler kannst du nicht handeln.';
        const sides = [[t.give, t.from, a], [t.get, t.to, b]];
        for (const [side, seat, pl] of sides) {
            if (side.cash > pl.cash) return `${pl.name} hat nicht genug Geld.`;
            if (side.cards > pl.jailCards.length) return `${pl.name} hat nicht so viele Freikarten.`;
            for (const idx of side.props) {
                const pr = s.props[idx];
                if (!pr || pr.owner !== seat) return `${SPACES[idx]?.name ?? 'Das Grundstück'} gehört ${pl.name} nicht.`;
                if (SPACES[idx].type === 'street' && groupIndices(idx).some(i => s.props[i].houses > 0)) {
                    return `Auf ${SPACES[idx].name} oder in der Farbgruppe stehen Gebäude. Zuerst verkaufen.`;
                }
            }
        }
        const empty = x => !x.cash && !x.props.length && !x.cards;
        if (empty(t.give) && empty(t.get)) return 'Das Angebot ist leer.';
        return null;
    }

    #tradeOffer(seat, a) {
        const s = this.s;
        if (s.auction) return err('Während einer Versteigerung kann nicht gehandelt werden.');
        if (s.trade) return err('Es läuft schon ein Handelsangebot.');
        const t = { id: s.tradeId + 1, from: seat, to: a.to, give: this.#cleanSide(a.give), get: this.#cleanSide(a.get) };
        const problem = Number.isInteger(t.to) ? this.#checkTrade(t) : 'Wähle einen Handelspartner.';
        if (problem) return err(problem);
        s.tradeId = t.id;
        s.trade = t;
        this.#log(`${s.players[seat].name} macht ${s.players[t.to].name} ein Handelsangebot.`);
        return OK;
    }

    #tradeAnswer(seat, accept) {
        const s = this.s;
        const t = s.trade;
        if (!t || t.to !== seat) return err('Dir liegt kein Angebot vor.');
        if (!accept) {
            s.trade = null;
            this.#log(`${s.players[seat].name} lehnt das Angebot ab.`);
            return OK;
        }
        const problem = this.#checkTrade(t);
        if (problem) {
            s.trade = null;
            return err(`Das Angebot ist nicht mehr gültig: ${problem}`);
        }
        const a = s.players[t.from];
        const b = s.players[t.to];
        const move = (side, from, to, toSeat) => {
            from.cash -= side.cash;
            to.cash += side.cash;
            for (const idx of side.props) {
                s.props[idx].owner = toSeat;
                // beliehene Grundstücke: Erwerber zahlt 10 % Zinsen an die Bank
                if (s.props[idx].mortgaged) this.#pay(toSeat, null, Math.ceil(mortgageValue(idx) * 0.1), `Zinsen auf ${SPACES[idx].name}`);
            }
            to.jailCards.push(...from.jailCards.splice(0, side.cards));
        };
        move(t.give, a, b, t.to);
        move(t.get, b, a, t.from);
        s.trade = null;
        this.#log(`${a.name} und ${b.name} sind sich handelseinig.`);
        if (s.queue.length || s.debt) this.#resume();
        return OK;
    }

    #tradeCancel(seat) {
        const s = this.s;
        if (!s.trade || s.trade.from !== seat) return err('Du hast kein offenes Angebot.');
        s.trade = null;
        return OK;
    }

    // ---------- Ansicht ----------

    view(seat) {
        const s = this.s;
        const st = stock(s.props);
        return {
            phase: s.phase,
            seat,
            hostSeat: HOST_SEAT,
            minPlayers: MIN_PLAYERS,
            maxPlayers: MAX_PLAYERS,
            moveNo: s.moveNo,
            round: s.round,
            turn: s.turn,
            turnPhase: s.turnPhase,
            dice: s.dice,
            extra: s.extra,
            players: s.players.map(p => ({
                name: p.name,
                connected: p.connected,
                cash: p.cash,
                pos: p.pos,
                inJail: p.inJail,
                jailTurns: p.jailTurns,
                jailCards: p.jailCards.length,
                bankrupt: p.bankrupt,
            })),
            props: s.props,
            houseStock: st.houses,
            hotelStock: st.hotels,
            debt: s.debt,
            auction: s.auction,
            trade: s.trade,
            events: s.events,
            eventSeq: s.eventSeq,
            log: s.log,
            winner: s.winner,
            worth: s.phase === 'over' ? s.players.map((p, i) => netWorth(s.props, i, p.cash)) : null,
        };
    }
}

export { unmortgageCost };
