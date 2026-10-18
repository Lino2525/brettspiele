// Spielablauf von Kritzelrennen (2 bis 6 Personen, ab 4 auch in zwei Teams), frei nach dem Zeichen-Brettspiel-Klassiker.
// Ein Spielbrett mit farbigen Feldern: Die Farbe des Feldes, auf dem die eigene Figur steht, bestimmt die Kategorie
// des nächsten Begriffs. Wer zeichnet, sucht sich einen von zwei Begriffen aus und zeichnet ihn, die anderen raten.
//   Einzeln: Jede Person hat eine eigene Figur und alle anderen raten mit. Klappt es, würfelt die zeichnende Person und
//            zieht vor; wer als Erstes richtig rät, zieht 2 Felder, alle weiteren Treffer 1 Feld. Danach ist die nächste Person dran.
//   Teams:   Jedes Team hat eine Figur, nur das eigene Team rät. Klappt es, würfelt das Team, zieht vor und zeichnet
//            gleich weiter (höchstens MAX_STREAK Begriffe hintereinander). Sonst ist das andere Team dran.
//   Alle-Felder (★): In Teams zeichnen beide Teams gleichzeitig denselben Begriff, das schnellere Team würfelt und ist
//            dran. Einzeln zählt dort jeder Treffer 2 Felder.
// Wer zuerst das Ziel erreicht, gewinnt.
import { RoomGame, err, OK, shuffled, TEAM_NAMES } from '../common/room.js';
import { normalize, matchesAny, maskText } from '../songquiz/answer.js';
import { CATEGORIES, CATEGORY_KEYS, TERMS } from './words.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const LENGTH_OPTIONS = [25, 37, 49]; // Felder inklusive Start und Ziel
export const TIME_OPTIONS = [45, 60, 90]; // Sekunden zum Zeichnen
export const CHOOSE_MS = 15000;
export const ROLL_MS = 10000; // so lange wartet der Würfel, danach würfelt das Spiel selbst
export const MOVE_MS = 4500; // Zeit für das Ziehen der Figuren
export const FAIL_MS = 5000; // Auflösung, wenn niemand den Begriff erraten hat
export const HINT_SHARE = 0.6; // ab diesem Anteil der Zeichenzeit sehen die Ratenden die Anfangsbuchstaben
export const MAX_STREAK = 3;
export const FIRST_STEPS = 2;
export const OTHER_STEPS = 1;
export const ALL_STEPS = 2;
const ALL_EVERY = 6; // jedes 6. Feld ist ein Alle-Feld
const MAX_STROKE_NUMBERS = 600; // Zahlen pro Strichstück (x und y zählen einzeln)
const MAX_DRAW_NUMBERS = 14000; // insgesamt pro Zeichnung
export const PEN_COLORS = 7; // Farbe 6 ist der Radierer (Papierfarbe)
export const PEN_WIDTHS = [3, 6, 14, 30];

// Spielbrett: Start, dann die fünf Kategorien immer im gleichen Wechsel, jedes 6. Feld zusätzlich ein Alle-Feld, am Ende das Ziel
export function makeBoard(length) {
    return Array.from({ length }, (_, i) => {
        if (i === 0) return { cat: 'A', start: true };
        if (i === length - 1) return { cat: 'A', goal: true };
        return { cat: CATEGORY_KEYS[(i - 1) % CATEGORY_KEYS.length], all: i % ALL_EVERY === 0 && i < length - 2 };
    });
}

const keysOf = term => term.split('|').map(k => normalize(k)).filter(Boolean);
const shown = term => term.split('|')[0];

export class SketchGame extends RoomGame {
    static MIN = MIN_PLAYERS;
    static MAX = MAX_PLAYERS;
    static TEAMS = true;

    initialState() {
        return { length: 37, drawSec: 60, board: [], pos: [], turn: null, turnNo: 0, lastSeat: -1, curTeam: 0, streak: 0, rot: [0, 0], used: {}, winners: [], deadline: 0 };
    }

    afterRestore() {
        const s = this.s;
        const now = Date.now();
        // Nach einem Neuladen des Hosts: laufender Begriff wird neu ausgesucht, Würfeln und Ziehen laufen weiter
        if (s.phase === 'choose' || s.phase === 'draw') {
            const t = s.turn;
            t.word = null;
            t.keys = [];
            t.correct = {};
            t.order = [];
            t.feed = [];
            t.out = [];
            t.hinted = false;
            for (const d of t.drawers) t.canvases[d] = { strokes: [], numbers: 0, version: 0 };
            s.phase = 'choose';
            s.deadline = now + CHOOSE_MS;
        } else if (s.phase === 'reveal') {
            s.deadline = now + (s.turn?.rollPending ? ROLL_MS : MOVE_MS);
        }
    }

    // ---------- Start ----------

    begin(now) {
        const s = this.s;
        s.board = makeBoard(s.length);
        s.pos = s.teamMode ? [0, 0] : s.players.map(() => 0);
        s.turnNo = 0;
        s.lastSeat = -1;
        s.curTeam = Math.floor(this.rng() * 2);
        s.streak = 1;
        s.rot = [0, 0];
        s.winners = [];
        this.#startTurn(now);
    }

    // ---------- Hilfen ----------

    #connected(seat) {
        return !!this.s.players[seat]?.connected;
    }

    #members(team) {
        return this.s.players.map((p, i) => i).filter(i => this.s.players[i].team === team);
    }

    // Reihum innerhalb des Teams, wer nicht verbunden ist, wird übersprungen
    #nextDrawer(team) {
        const s = this.s;
        const list = this.#members(team);
        for (let k = 0; k < list.length; k++) {
            const seat = list[(s.rot[team] + k) % list.length];
            if (this.#connected(seat)) {
                s.rot[team] = (s.rot[team] + k + 1) % list.length;
                return seat;
            }
        }
        return -1;
    }

    #nextSeat() {
        const s = this.s;
        const n = s.players.length;
        for (let k = 1; k <= n; k++) {
            const seat = (s.lastSeat + k) % n;
            if (this.#connected(seat)) return seat;
        }
        return (s.lastSeat + 1) % n;
    }

    #pickTerms(cat, count) {
        const s = this.s;
        const all = TERMS[cat];
        let used = s.used[cat] || [];
        let pool = all.map((t, i) => i).filter(i => !used.includes(i));
        if (pool.length < count) {
            used = [];
            pool = all.map((t, i) => i);
        }
        const picked = shuffled(pool, this.rng).slice(0, count);
        s.used[cat] = [...used, ...picked];
        return picked.map(i => all[i]);
    }

    // Einheit = wer eine Figur hat: einzeln die Person, in Teams das Team
    unitOf(seat) {
        return this.s.teamMode ? this.s.players[seat].team : seat;
    }

    // ---------- Ablauf eines Begriffs ----------

    #startTurn(now) {
        const s = this.s;
        let unit, drawer;
        if (s.teamMode) {
            let team = s.curTeam;
            if (!this.#members(team).some(i => this.#connected(i))) {
                team = 1 - team;
                s.streak = 1;
            }
            unit = team;
            drawer = this.#nextDrawer(team);
            if (drawer < 0) drawer = this.#members(team)[0];
        } else {
            drawer = this.#nextSeat();
            unit = drawer;
            s.lastSeat = drawer;
        }
        const field = s.board[s.pos[unit]];
        const drawers = [drawer];
        // Alle-Feld in Teams: Das andere Team zeichnet denselben Begriff gleichzeitig
        if (s.teamMode && field.all) {
            const other = this.#nextDrawer(1 - unit);
            if (other >= 0) drawers.push(other);
        }
        s.turnNo++;
        s.turn = {
            no: s.turnNo,
            unit,
            drawer,
            drawers,
            cat: field.cat,
            all: !!field.all,
            options: this.#pickTerms(field.cat, 2),
            word: null,
            keys: [],
            canvases: Object.fromEntries(drawers.map(d => [d, { strokes: [], numbers: 0, version: 0 }])),
            correct: {},
            order: [],
            feed: [],
            out: [], // Teams, deren Zeichner aufgegeben hat (nur Alle-Feld)
            drawStart: 0,
            hinted: false,
            solvedUnit: null,
            result: null,
            rollPending: false,
            roller: null,
            roll: 0,
            moves: [],
        };
        s.phase = 'choose';
        s.deadline = now + CHOOSE_MS;
    }

    #choose(seat, i, now) {
        const s = this.s;
        const t = s.turn;
        if (s.phase !== 'choose') return err('Gerade wird kein Begriff ausgesucht.');
        if (seat !== t.drawer) return err('Den Begriff sucht die zeichnende Person aus.');
        if (i !== 0 && i !== 1) return err('Ungültige Auswahl.');
        this.#beginDraw(i, now);
        return OK;
    }

    #beginDraw(i, now) {
        const s = this.s;
        const t = s.turn;
        t.word = shown(t.options[i]);
        t.keys = keysOf(t.options[i]);
        t.drawStart = now;
        s.phase = 'draw';
        s.deadline = now + s.drawSec * 1000;
    }

    // Wer darf in diesem Zug raten?
    canGuess(seat) {
        const s = this.s;
        const t = s.turn;
        if (!t || s.phase !== 'draw' || t.drawers.includes(seat)) return false;
        if (!s.teamMode) return true;
        const team = s.players[seat].team;
        if (t.out.includes(team)) return false;
        return team === t.unit || t.drawers.some(d => s.players[d].team === team);
    }

    #guess(seat, text, now) {
        const s = this.s;
        const t = s.turn;
        if (s.phase !== 'draw') return err('Gerade wird nicht geraten.');
        if (t.drawers.includes(seat)) return err('Du zeichnest, du darfst nicht raten.');
        if (!this.canGuess(seat)) return err('Jetzt rät das andere Team.');
        if (t.correct[seat] !== undefined) return err('Du hast den Begriff schon.');
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!clean) return err('Bitte etwas eingeben.');
        if (matchesAny(clean, t.keys)) {
            t.correct[seat] = now - t.drawStart;
            t.order.push(seat);
            t.feed.push({ seat, ok: true });
            if (t.feed.length > 14) t.feed.shift();
            if (s.teamMode) {
                this.#endDraw(now, this.unitOf(seat));
            } else if (s.players.every((p, i) => i === t.drawer || !p.connected || t.correct[i] !== undefined)) {
                this.#endDraw(now);
            }
            return { ok: true, notice: 'Richtig!' };
        }
        t.feed.push({ seat, text: clean, ok: false });
        if (t.feed.length > 14) t.feed.shift();
        return OK;
    }

    #giveUp(seat, now) {
        const s = this.s;
        const t = s.turn;
        if (s.phase !== 'draw' || !t.drawers.includes(seat)) return err('Gerade nicht möglich.');
        if (s.teamMode && t.drawers.length > 1) {
            const team = s.players[seat].team;
            if (!t.out.includes(team)) t.out.push(team);
            if (t.drawers.every(d => t.out.includes(s.players[d].team))) this.#endDraw(now);
            return OK;
        }
        this.#endDraw(now);
        return OK;
    }

    // Ende des Zeichnens. Teams: solvedUnit ist das Team, das zuerst richtig geraten hat.
    #endDraw(now, solvedUnit = null) {
        const s = this.s;
        const t = s.turn;
        const solved = s.teamMode ? solvedUnit !== null : t.order.length > 0;
        t.result = solved ? 'solved' : 'failed';
        t.solvedUnit = s.teamMode ? solvedUnit : solved ? t.unit : null;
        s.phase = 'reveal';
        if (solved) {
            t.rollPending = true;
            t.roller = t.solvedUnit;
            s.deadline = now + ROLL_MS;
        } else {
            s.deadline = now + FAIL_MS;
        }
    }

    #rollAction(seat, now) {
        const s = this.s;
        const t = s.turn;
        if (s.phase !== 'reveal' || !t.rollPending) return err('Gerade wird nicht gewürfelt.');
        if (this.unitOf(seat) !== t.roller) return err(s.teamMode ? 'Das andere Team würfelt.' : 'Würfeln darf, wer gezeichnet hat.');
        this.#doRoll(now);
        return OK;
    }

    #doRoll(now) {
        const s = this.s;
        const t = s.turn;
        const last = s.board.length - 1;
        t.roll = 1 + Math.floor(this.rng() * 6);
        t.rollPending = false;
        const gains = new Map([[t.roller, t.roll]]);
        if (!s.teamMode) {
            t.order.forEach((seat, k) => {
                const steps = t.all ? ALL_STEPS : k === 0 ? FIRST_STEPS : OTHER_STEPS;
                gains.set(seat, (gains.get(seat) || 0) + steps);
            });
        }
        t.moves = [...gains].map(([unit, steps]) => {
            const from = s.pos[unit];
            const to = Math.min(last, from + steps);
            s.pos[unit] = to;
            return { unit, from, to, steps };
        });
        s.winners = t.moves.filter(m => m.to === last).map(m => m.unit);
        s.deadline = now + MOVE_MS;
    }

    #afterReveal(now) {
        const s = this.s;
        const t = s.turn;
        if (t.rollPending) {
            this.#doRoll(now);
            return;
        }
        if (s.winners.length) {
            s.phase = 'over';
            s.deadline = 0;
            this.say(`${s.winners.map(u => (s.teamMode ? TEAM_NAMES[u] : s.players[u].name)).join(' und ')} gewinnt.`);
            return;
        }
        if (s.teamMode) {
            if (t.result === 'solved' && t.solvedUnit === t.unit && s.streak < MAX_STREAK) {
                s.streak++;
            } else {
                s.curTeam = t.result === 'solved' && t.solvedUnit !== t.unit ? t.solvedUnit : 1 - t.unit;
                s.streak = 1;
            }
        }
        this.#startTurn(now);
    }

    // ---------- Zeichnen ----------

    #draw(seat, a) {
        const s = this.s;
        const t = s.turn;
        if (s.phase !== 'draw') return err('Gerade wird nicht gezeichnet.');
        const canvas = t.canvases[seat];
        if (!canvas || !t.drawers.includes(seat)) return err('Nur wer zeichnet, darf zeichnen.');
        if (a.t === 'clear') {
            canvas.strokes = [];
            canvas.numbers = 0;
        } else if (a.t === 'undo') {
            const last = canvas.strokes[canvas.strokes.length - 1];
            if (!last) return OK;
            canvas.strokes = canvas.strokes.filter(st => st.sid !== last.sid);
            canvas.numbers = canvas.strokes.reduce((n, st) => n + st.p.length, 0);
        } else {
            const p = Array.isArray(a.p) ? a.p : [];
            if (p.length < 2 || p.length > MAX_STROKE_NUMBERS || p.length % 2 !== 0 || !p.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) return err('Ungültiger Strich.');
            if (canvas.numbers + p.length > MAX_DRAW_NUMBERS) return err('Das Blatt ist voll. Lösche etwas.');
            const c = Number.isInteger(a.c) && a.c >= 0 && a.c < PEN_COLORS ? a.c : 0;
            const w = PEN_WIDTHS.includes(a.w) ? a.w : PEN_WIDTHS[1];
            const sid = Number.isInteger(a.sid) ? a.sid : 0;
            canvas.strokes.push({ sid, c, w, p });
            canvas.numbers += p.length;
        }
        canvas.version++;
        return OK;
    }

    // ---------- Aktionen ----------

    act(seat, a, now) {
        const s = this.s;
        switch (a?.t) {
            case 'setLength':
            case 'setTime': {
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
                const list = a.t === 'setLength' ? LENGTH_OPTIONS : TIME_OPTIONS;
                if (!list.includes(a.n)) return err('Ungültige Einstellung.');
                if (a.t === 'setLength') s.length = a.n;
                else s.drawSec = a.n;
                return OK;
            }
            case 'choose': return this.#choose(seat, a.i, now);
            case 'guess': return this.#guess(seat, a.text, now);
            case 'giveUp': return this.#giveUp(seat, now);
            case 'roll': return this.#rollAction(seat, now);
            case 'stroke':
            case 'undo':
            case 'clear':
                return this.#draw(seat, a);
            default:
                return err('Unbekannte Aktion.');
        }
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        const t = s.turn;
        if (s.phase === 'choose') {
            if (now >= s.deadline) {
                this.#beginDraw(0, now);
                this.bump();
            }
        } else if (s.phase === 'draw') {
            const drawing = t.drawers.filter(d => this.#connected(d) && !t.out.includes(this.unitOf(d)));
            if (now >= s.deadline || !drawing.length) {
                this.#endDraw(now);
                this.bump();
            } else if (!t.hinted && now - t.drawStart >= s.drawSec * 1000 * HINT_SHARE) {
                t.hinted = true; // Anfangsbuchstaben aufdecken
                this.bump();
            }
        } else if (s.phase === 'reveal' && now >= s.deadline) {
            this.#afterReveal(now);
            this.bump();
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    // Welche Zeichnung sieht diese Person? Die eigene, die des eigenen Teams (Alle-Feld) oder die der zeichnenden Person
    canvasFor(seat) {
        const s = this.s;
        const t = s.turn;
        if (t.drawers.includes(seat)) return seat;
        if (s.teamMode) {
            const mate = t.drawers.find(d => s.players[d].team === s.players[seat].team);
            if (mate !== undefined) return mate;
        }
        return t.drawer;
    }

    #turnView(seat, now) {
        const s = this.s;
        const t = s.turn;
        if (!t) return null;
        const drawing = t.drawers.includes(seat);
        const open = s.phase === 'reveal' || s.phase === 'over';
        const role = drawing ? 'draw' : this.canGuess(seat) || (s.phase === 'draw' && t.correct[seat] !== undefined) ? 'guess' : 'watch';
        const canvasSeat = this.canvasFor(seat);
        const canvas = t.canvases[canvasSeat] || { strokes: [], version: 0 };
        // Im Alle-Feld sieht jedes Team nur die eigenen Rateversuche
        const myTeam = s.players[seat]?.team;
        const feed = s.teamMode && t.drawers.length > 1 && !open ? t.feed.filter(f => s.players[f.seat]?.team === myTeam) : t.feed;
        return {
            no: t.no,
            unit: t.unit,
            drawer: t.drawer,
            drawers: t.drawers,
            cat: t.cat,
            all: t.all,
            role,
            options: s.phase === 'choose' && seat === t.drawer ? t.options.map(shown) : null,
            word: t.word && (drawing || open) ? t.word : null,
            mask: t.word ? maskText(t.word, t.hinted ? 2 : 1) : null,
            canvas: { seat: canvasSeat, strokes: canvas.strokes, version: canvas.version },
            correct: t.order,
            feed,
            out: t.out,
            result: t.result,
            solvedUnit: t.solvedUnit,
            rollPending: t.rollPending,
            roller: t.roller,
            roll: t.roll,
            moves: t.moves,
        };
    }

    gameView(seat, now) {
        const s = this.s;
        const running = s.phase === 'choose' || s.phase === 'draw' || s.phase === 'reveal';
        return {
            length: s.length,
            drawSec: s.drawSec,
            lengthOptions: LENGTH_OPTIONS,
            timeOptions: TIME_OPTIONS,
            board: s.board,
            pos: s.pos,
            streak: s.streak,
            maxStreak: MAX_STREAK,
            winners: s.winners,
            turn: s.phase === 'waiting' ? null : this.#turnView(seat, now),
            msLeft: running ? Math.max(0, s.deadline - now) : null,
        };
    }
}

export { CATEGORIES };
