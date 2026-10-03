// Spielablauf von Stadt-Land-Fluss (3 bis 6 Personen, auch in Teams).
// Ein Buchstabe wird ausgelost, alle füllen die Kategorien aus. Wer fertig ist, ruft "Stopp"; die anderen haben noch kurz Zeit.
// Danach sieht man alle Antworten und kann unpassende Antworten anderer anzweifeln (Mehrheit entscheidet).
// Punkte: 20 für eine Antwort, die nur man selbst hat und die sonst niemand hat, 10 für eine eigene Antwort, 5 für gleiche Antworten.
import { RoomGame, err, OK, shuffled, TEAM_NAMES } from '../common/room.js';

export const CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Essen & Trinken', 'Pflanze', 'Gegenstand', 'Sportart', 'Marke', 'Film oder Serie'];
export const DEFAULT_CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf'];
export const ROUND_OPTIONS = [4, 6, 8, 10];
export const LETTERS = 'ABDEFGHKLMNOPRSTUWZ'.split('');
export const WRITE_MS = 120000; // höchstens so lange wird geschrieben
export const STOP_MS = 12000; // so lange haben die anderen nach "Stopp" noch Zeit
export const GRACE_MS = 1200; // Spielraum für noch unterwegs befindliche Antworten
export const REVIEW_MS = 75000;
const MAX_LEN = 40;

export function normalizeAnswer(text) {
    return String(text ?? '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Zählt den Buchstaben mit Umlaut-Auflösung: "Österreich" passt zu "O" (und Ö gibt es nicht als Zielbuchstaben).
export function startsWithLetter(text, letter) {
    return normalizeAnswer(text).startsWith(letter.toLowerCase());
}

export class SlfGame extends RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = true;

    initialState() {
        return {
            categories: [...DEFAULT_CATEGORIES], rounds: 6, round: 0, letter: '', usedLetters: [],
            answers: [], // je Platz: Antworten in der Reihenfolge der Kategorien
            stopper: -1, writeEnd: 0, hardEnd: 0, reviewEnd: 0,
            flags: [], // flags[seat][kategorie] = Plätze, die diese Antwort anzweifeln
            ready: [], // Plätze, die mit der Auswertung fertig sind
            totals: [], history: [], roundPoints: [],
        };
    }

    newPlayer() {
        return {};
    }

    // Nach dem Neustart des Hosts sind die Zeiten veraltet: eine Schreibrunde beginnt neu, die Auswertung bekommt frische Zeit.
    afterRestore() {
        const s = this.s;
        if (s.phase === 'write') {
            s.round--;
            this.#startRound(Date.now());
        } else if (s.phase === 'review') {
            s.reviewEnd = Date.now() + REVIEW_MS;
        }
    }

    // ---------- Start ----------

    begin(now) {
        const s = this.s;
        s.round = 0;
        s.usedLetters = [];
        s.totals = s.players.map(() => 0);
        s.history = [];
        this.#startRound(now);
    }

    #startRound(now) {
        const s = this.s;
        s.round++;
        const pool = LETTERS.filter(l => !s.usedLetters.includes(l));
        s.letter = shuffled(pool.length ? pool : LETTERS, this.rng)[0];
        s.usedLetters.push(s.letter);
        s.answers = s.players.map(() => s.categories.map(() => ''));
        s.flags = s.players.map(() => s.categories.map(() => []));
        s.ready = [];
        s.stopper = -1;
        s.phase = 'write';
        s.writeEnd = now + WRITE_MS;
        s.hardEnd = s.writeEnd;
        s.roundPoints = s.players.map(() => 0);
    }

    // ---------- Aktionen ----------

    act(seat, a, now) {
        const s = this.s;
        switch (a?.t) {
            case 'setRounds':
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
                if (!ROUND_OPTIONS.includes(a.n)) return err('Ungültige Rundenzahl.');
                s.rounds = a.n;
                return OK;
            case 'toggleCat': {
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
                const cat = CATEGORIES[a.i];
                if (!cat) return err('Unbekannte Kategorie.');
                if (s.categories.includes(cat)) {
                    if (s.categories.length <= 3) return err('Mindestens 3 Kategorien.');
                    s.categories = s.categories.filter(c => c !== cat);
                } else {
                    if (s.categories.length >= 8) return err('Höchstens 8 Kategorien.');
                    s.categories = CATEGORIES.filter(c => c === cat || s.categories.includes(c));
                }
                return OK;
            }
            case 'answers': return this.#answers(seat, a.list, now);
            case 'stop': return this.#stop(seat, a.list, now);
            case 'flag': return this.#flag(seat, a.p, a.c);
            case 'ready': return this.#ready(seat, now);
            default: return err('Unbekannte Aktion.');
        }
    }

    #clean(list) {
        if (!Array.isArray(list)) return null;
        return this.s.categories.map((_, i) => String(list[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN));
    }

    #answers(seat, list, now) {
        const s = this.s;
        if (s.phase !== 'write') return err('Gerade wird nicht geschrieben.');
        if (now > s.writeEnd + GRACE_MS) return err('Die Zeit ist um.');
        const clean = this.#clean(list);
        if (!clean) return err('Ungültige Antworten.');
        s.answers[seat] = clean;
        return OK;
    }

    #stop(seat, list, now) {
        const s = this.s;
        if (s.phase !== 'write') return err('Gerade wird nicht geschrieben.');
        if (s.stopper >= 0) return err('Es wurde schon „Stopp“ gerufen.');
        const clean = this.#clean(list) ?? s.answers[seat];
        if (clean.some(x => !x)) return err('Zum Stoppen müssen alle Kategorien ausgefüllt sein.');
        s.answers[seat] = clean;
        s.stopper = seat;
        s.writeEnd = Math.min(s.writeEnd, now + STOP_MS);
        this.say(`${s.players[seat].name} ruft Stopp!`);
        return OK;
    }

    #flag(seat, p, c) {
        const s = this.s;
        if (s.phase !== 'review') return err('Gerade nicht möglich.');
        if (!Number.isInteger(p) || !Number.isInteger(c) || !s.flags[p]?.[c]) return err('Ungültige Antwort.');
        if (p === seat) return err('Die eigenen Antworten kann man nicht anzweifeln.');
        const list = s.flags[p][c];
        const at = list.indexOf(seat);
        if (at >= 0) list.splice(at, 1);
        else list.push(seat);
        return OK;
    }

    #ready(seat, now) {
        const s = this.s;
        if (s.phase !== 'review') return err('Gerade nicht möglich.');
        if (!s.ready.includes(seat)) s.ready.push(seat);
        this.#maybeNext(now);
        return OK;
    }

    // ---------- Wertung ----------

    // Ist die Antwort gültig? Sie muss mit dem Buchstaben beginnen und darf nicht von der Mehrheit der anderen angezweifelt werden.
    isValid(seat, c) {
        const s = this.s;
        const text = s.answers[seat]?.[c];
        if (!text || !startsWithLetter(text, s.letter)) return false;
        const others = s.players.length - 1;
        return s.flags[seat][c].length * 2 <= others;
    }

    // Punkte je Antwort: [seat][kategorie]; bei Teams zählen gleiche Antworten im selben Team als eine
    score() {
        const s = this.s;
        const entity = seat => (s.teamMode ? `t${s.players[seat].team}` : `p${seat}`);
        const points = s.players.map(() => s.categories.map(() => 0));
        s.categories.forEach((_, c) => {
            const valid = s.players.map((p, seat) => seat).filter(seat => this.isValid(seat, c));
            for (const seat of valid) {
                const key = normalizeAnswer(s.answers[seat][c]);
                const same = new Set(valid.filter(o => normalizeAnswer(s.answers[o][c]) === key).map(entity));
                const otherEntities = new Set(valid.filter(o => entity(o) !== entity(seat)).map(entity));
                if (same.size > 1) points[seat][c] = 5;
                else points[seat][c] = otherEntities.size === 0 ? 20 : 10;
            }
        });
        return points;
    }

    #maybeNext(now, force = false) {
        const s = this.s;
        const waiting = s.players.some((p, i) => p.connected && !s.ready.includes(i));
        if (!force && waiting) return;
        const points = this.score();
        s.roundPoints = points.map(row => row.reduce((a, b) => a + b, 0));
        s.roundPoints.forEach((n, i) => (s.totals[i] += n));
        s.history.push({ letter: s.letter, points: [...s.roundPoints] });
        if (s.round >= s.rounds) {
            s.phase = 'over';
            const best = this.standings(i => s.totals[i]);
            const top = s.teamMode ? best.teams[0] : best.players[0];
            this.say(s.teamMode ? `${TEAM_NAMES[top.team]} gewinnt.` : `${s.players[top.seat].name} gewinnt.`);
        } else {
            this.#startRound(now);
        }
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        if (s.phase === 'write') {
            if (now >= s.writeEnd + GRACE_MS) {
                s.phase = 'review';
                s.reviewEnd = now + REVIEW_MS;
                s.ready = [];
                this.bump();
            }
        } else if (s.phase === 'review') {
            if (now >= s.reviewEnd) {
                this.#maybeNext(now, true);
                this.bump();
            }
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    gameView(seat, now) {
        const s = this.s;
        const inGame = s.phase !== 'waiting';
        const review = s.phase === 'review' || s.phase === 'over';
        const points = review && s.answers.length ? this.score() : null;
        const deadline = s.phase === 'write' ? s.writeEnd : s.phase === 'review' ? s.reviewEnd : 0;
        return {
            categories: s.categories,
            allCategories: CATEGORIES,
            roundOptions: ROUND_OPTIONS,
            rounds: s.rounds,
            round: s.round,
            letter: s.letter,
            stopper: s.stopper,
            msLeft: deadline ? Math.max(0, deadline - now) : null,
            // Beim Schreiben sieht man nur die eigenen Antworten; danach alle
            myAnswers: s.phase === 'write' ? s.answers[seat] : null,
            answers: review ? s.answers : null,
            valid: review && s.answers.length ? s.players.map((p, i) => s.categories.map((_, c) => this.isValid(i, c))) : null,
            flags: review ? s.flags : null,
            points,
            // Während der Auswertung live aus den aktuellen Antworten und Zweifeln berechnet
            roundPoints: review ? (points ? points.map(row => row.reduce((a, b) => a + b, 0)) : s.roundPoints) : null,
            filled: inGame ? s.players.map((p, i) => (s.phase === 'write' ? s.answers[i]?.every(x => x) ?? false : false)) : [],
            ready: s.ready,
            totals: s.totals,
            history: s.history,
        };
    }
}
