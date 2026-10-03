// Spielablauf von Lügenwürfel (3 bis 6 Personen), ein Bluffspiel mit verdeckten Würfeln.
// Jede Runde würfelt jeder geheim. Reihum bietet man, wie viele Würfel eines Wertes insgesamt am Tisch liegen,
// und muss das Gebot der Vorrunde überbieten oder es mit "Lüge!" anzweifeln. Wer falsch liegt, verliert einen Würfel.
// Wer keinen Würfel mehr hat, scheidet aus; wer als Letzter übrig bleibt, gewinnt.
import { RoomGame, err, OK } from '../common/room.js';

export const DICE_OPTIONS = [3, 4, 5];
export const TURN_MS = 25000; // so lange darf man überlegen, danach entscheidet das Spiel
const AFK_MS = 3000; // wer nicht verbunden ist, wird nach dieser Zeit übersprungen
export const REVEAL_MS = 8000;

export class LiarsGame extends RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = false;

    initialState() {
        return { diceStart: 5, wild: true, round: 0, hands: [], turn: -1, bid: null, bids: [], starter: 0, reveal: null, turnStart: 0, deadline: 0, winner: -1 };
    }

    newPlayer() {
        return { dice: 0, wins: 0 };
    }

    // ---------- Hilfen ----------

    #alive(seat) {
        return this.s.players[seat].dice > 0;
    }

    #nextAlive(seat) {
        const n = this.s.players.length;
        for (let k = 1; k <= n; k++) {
            const i = (seat + k) % n;
            if (this.#alive(i)) return i;
        }
        return seat;
    }

    get totalDice() {
        return this.s.players.reduce((sum, p) => sum + p.dice, 0);
    }

    // Anzahl der Würfel, die zu einem Gebot zählen (mit Joker zählen Einser für jeden Wert)
    count(face) {
        const { hands, wild } = this.s;
        let n = 0;
        for (const hand of hands) for (const d of hand) if (d === face || (wild && d === 1)) n++;
        return n;
    }

    faces() {
        return this.s.wild ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];
    }

    // Ist (qty, face) ein gültiges Gebot nach dem aktuellen?
    validBid(qty, face) {
        const s = this.s;
        if (!Number.isInteger(qty) || !Number.isInteger(face)) return false;
        if (!this.faces().includes(face) || qty < 1 || qty > this.totalDice) return false;
        if (!s.bid) return true;
        return qty > s.bid.qty || (qty === s.bid.qty && face > s.bid.face);
    }

    // ---------- Start ----------

    begin(now) {
        const s = this.s;
        for (const p of s.players) p.dice = s.diceStart;
        s.round = 0;
        s.winner = -1;
        s.reveal = null;
        s.log = [];
        s.starter = Math.floor(this.rng() * s.players.length);
        this.#startRound(now);
    }

    #startRound(now) {
        const s = this.s;
        s.round++;
        s.phase = 'bidding';
        s.hands = s.players.map(p => Array.from({ length: p.dice }, () => 1 + Math.floor(this.rng() * 6)));
        s.bid = null;
        s.bids = [];
        s.reveal = null;
        s.turn = this.#alive(s.starter) ? s.starter : this.#nextAlive(s.starter);
        s.turnStart = now;
        s.deadline = now + TURN_MS;
    }

    // ---------- Aktionen ----------

    act(seat, a, now) {
        const s = this.s;
        switch (a?.t) {
            case 'setDice':
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
                if (!DICE_OPTIONS.includes(a.n)) return err('Ungültige Anzahl.');
                s.diceStart = a.n;
                return OK;
            case 'setWild':
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
                s.wild = !!a.on;
                return OK;
            case 'bid':
                return this.#bid(seat, a.qty, a.face, now);
            case 'challenge':
                return this.#challenge(seat, now);
            case 'next':
                return this.#ready(seat, now);
            default:
                return err('Unbekannte Aktion.');
        }
    }

    #bid(seat, qty, face, now) {
        const s = this.s;
        if (s.phase !== 'bidding') return err('Gerade wird nicht geboten.');
        if (seat !== s.turn) return err('Du bist nicht dran.');
        if (!this.validBid(qty, face)) return err('Das Gebot muss höher sein als das letzte.');
        this.#placeBid(seat, qty, face, now);
        return OK;
    }

    #placeBid(seat, qty, face, now) {
        const s = this.s;
        s.bid = { seat, qty, face };
        s.bids.push({ seat, qty, face });
        s.turn = this.#nextAlive(seat);
        s.turnStart = now;
        s.deadline = now + TURN_MS;
    }

    #challenge(seat, now) {
        const s = this.s;
        if (s.phase !== 'bidding') return err('Gerade wird nicht geboten.');
        if (seat !== s.turn) return err('Du bist nicht dran.');
        if (!s.bid) return err('Es gibt noch kein Gebot, das man anzweifeln könnte.');
        this.#resolve(seat, now);
        return OK;
    }

    #resolve(challenger, now) {
        const s = this.s;
        const { seat: bidder, qty, face } = s.bid;
        const count = this.count(face);
        const bidderRight = count >= qty;
        const loser = bidderRight ? challenger : bidder;
        s.players[loser].dice--;
        const out = s.players[loser].dice === 0;
        s.reveal = { challenger, bidder, qty, face, count, bidderRight, loser, out, hands: s.hands.map(h => [...h]), ready: [], end: now + REVEAL_MS };
        s.phase = 'reveal';
        const name = i => s.players[i].name;
        this.say(`${name(challenger)} zweifelt ${name(bidder)} an: ${count} statt ${qty} → ${name(loser)} verliert einen Würfel${out ? ' und scheidet aus' : ''}.`);
    }

    #ready(seat, now) {
        const s = this.s;
        if (s.phase !== 'reveal') return err('Gerade nicht möglich.');
        if (!s.reveal.ready.includes(seat)) s.reveal.ready.push(seat);
        this.#maybeAdvance(now);
        return OK;
    }

    #maybeAdvance(now, force = false) {
        const s = this.s;
        const r = s.reveal;
        const waiting = s.players.some((p, i) => p.connected && !r.ready.includes(i));
        if (!force && waiting) return false;
        const alive = s.players.map((p, i) => i).filter(i => this.#alive(i));
        if (alive.length <= 1) {
            s.phase = 'over';
            s.winner = alive[0] ?? r.loser;
            s.players[s.winner].wins++;
            this.say(`${s.players[s.winner].name} gewinnt!`);
        } else {
            s.starter = r.loser;
            this.#startRound(now);
        }
        return true;
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        if (s.phase === 'bidding') {
            const afk = !s.players[s.turn].connected && now >= s.turnStart + AFK_MS;
            if (afk || now >= s.deadline) {
                // Wer zu lange braucht, zweifelt an (oder macht das kleinstmögliche Gebot, wenn es noch keins gibt)
                if (s.bid) this.#resolve(s.turn, now);
                else this.#placeBid(s.turn, 1, this.faces()[0], now);
                s.moveNo++;
            }
        } else if (s.phase === 'reveal' && now >= s.reveal.end) {
            this.#maybeAdvance(now, true);
            s.moveNo++;
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    gameView(seat, now) {
        const s = this.s;
        const reveal = s.phase === 'reveal' || (s.phase === 'over' && s.reveal) ? s.reveal : null;
        const deadline = s.phase === 'bidding' ? s.deadline : reveal ? reveal.end : 0;
        return {
            diceStart: s.diceStart,
            wild: s.wild,
            diceOptions: DICE_OPTIONS,
            round: s.round,
            dice: s.players.map(p => p.dice),
            wins: s.players.map(p => p.wins),
            turn: s.phase === 'bidding' ? s.turn : -1,
            bid: s.bid,
            bids: s.bids.slice(-8),
            total: this.totalDice,
            faces: this.faces(),
            hand: s.phase === 'bidding' && s.hands[seat] ? s.hands[seat] : [],
            reveal,
            winner: s.winner,
            msLeft: deadline ? Math.max(0, deadline - now) : null,
        };
    }
}
