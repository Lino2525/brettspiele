// Spielablauf von Wortraten (3 bis 6 Personen, auch in Teams).
// Zu einem gesuchten Begriff werden nach und nach Hinweise aufgedeckt, vom ungenauen bis zum fast eindeutigen.
// Wer früh richtig rät, bekommt mehr Punkte. In Teams reicht ein Treffer: Das ganze Team ist dann fertig und teilt sich den Erfolg.
import { RoomGame, err, OK, shuffled, TEAM_NAMES } from '../common/room.js';
import { normalize, matchesAny } from '../songquiz/answer.js';
import { WORDS, HINTS_PER_WORD } from './words.js';

export const ROUND_OPTIONS = [8, 10, 12, 15];
export const HINT_MS = 7000; // so lange steht jeder Hinweis, bevor der nächste kommt
export const FINAL_MS = 8000; // Zeit nach dem letzten Hinweis
export const REVEAL_MS = 6000;
export const TRIES_PER_HINT = 2; // Rateversuche pro Person und Hinweis
export const FIRST_BONUS = [3, 1]; // Zusatzpunkte für die ersten beiden Treffer

const keysOf = solution => solution.split('|').map(s => normalize(s)).filter(Boolean);

export class WordGuessGame extends RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = true;

    initialState() {
        return { rounds: 10, round: 0, word: null, shown: 1, nextAt: 0, tries: [], solved: [], gain: [], solvedOrder: [], guesses: [], totals: [], used: [], deadline: 0, ready: [] };
    }

    afterRestore() {
        const s = this.s;
        if (s.phase === 'play') {
            s.round--;
            this.#startWord(Date.now());
        } else if (s.phase === 'reveal') {
            s.deadline = Date.now() + REVEAL_MS;
        }
    }

    // ---------- Start ----------

    begin(now) {
        const s = this.s;
        s.round = 0;
        s.totals = s.players.map(() => 0);
        this.#startWord(now);
    }

    #startWord(now) {
        const s = this.s;
        s.round++;
        let pool = WORDS.map((w, i) => i).filter(i => !s.used.includes(i));
        if (!pool.length) {
            s.used = [];
            pool = WORDS.map((w, i) => i);
        }
        const idx = shuffled(pool, this.rng)[0];
        s.used.push(idx);
        const [solution, ...hints] = WORDS[idx];
        s.word = { solution: solution.split('|')[0], keys: keysOf(solution), hints: hints.slice(0, HINTS_PER_WORD) };
        s.shown = 1;
        s.nextAt = now + HINT_MS;
        s.tries = s.players.map(() => 0);
        s.solved = s.players.map(() => false);
        s.gain = s.players.map(() => 0);
        s.solvedOrder = [];
        s.guesses = [];
        s.ready = [];
        s.phase = 'play';
        s.deadline = s.nextAt;
    }

    // ---------- Hilfen ----------

    #unit(seat) {
        // Wer zählt als „fertig“: in Teams das ganze Team, sonst nur die Person selbst
        return this.s.teamMode ? this.s.players.map((p, i) => i).filter(i => this.s.players[i].team === this.s.players[seat].team) : [seat];
    }

    #allDone() {
        const s = this.s;
        return s.players.every((p, i) => !p.connected || s.solved[i]);
    }

    pointsFor(shown, order) {
        const base = (HINTS_PER_WORD - shown + 1) * 2;
        return base + (FIRST_BONUS[order] ?? 0);
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
            case 'guess': return this.#guess(seat, a.text, now);
            case 'ready': {
                if (s.phase !== 'reveal') return err('Gerade nicht möglich.');
                if (!s.ready.includes(seat)) s.ready.push(seat);
                if (!s.players.some((p, i) => p.connected && !s.ready.includes(i))) this.#afterReveal(now);
                return OK;
            }
            default:
                return err('Unbekannte Aktion.');
        }
    }

    #guess(seat, text, now) {
        const s = this.s;
        if (s.phase !== 'play') return err('Gerade wird nicht geraten.');
        if (s.solved[seat]) return err('Du hast das Wort schon.');
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!clean) return err('Bitte etwas eingeben.');
        if (s.tries[seat] >= TRIES_PER_HINT) return err('Alle Versuche für diesen Hinweis sind verbraucht. Warte auf den nächsten Hinweis.');
        s.tries[seat]++;
        if (matchesAny(clean, s.word.keys)) {
            const order = s.solvedOrder.length;
            const points = this.pointsFor(s.shown, order);
            s.gain[seat] = points;
            s.totals[seat] += points;
            for (const mate of this.#unit(seat)) s.solved[mate] = true;
            s.solvedOrder.push(seat);
            this.say(`${s.players[seat].name} hat es erraten!`);
            s.guesses.push({ seat, text: '', ok: true });
            if (this.#allDone()) this.#startReveal(now);
            return { ok: true, notice: `Richtig! +${points} Punkte` };
        }
        s.guesses.push({ seat, text: clean, ok: false });
        if (s.guesses.length > 12) s.guesses.shift();
        return { ok: true, notice: s.tries[seat] >= TRIES_PER_HINT ? 'Leider falsch. Warte auf den nächsten Hinweis.' : 'Leider falsch. Du hast noch einen Versuch.' };
    }

    #startReveal(now) {
        const s = this.s;
        s.phase = 'reveal';
        s.deadline = now + REVEAL_MS;
        s.ready = [];
    }

    #afterReveal(now) {
        const s = this.s;
        if (s.round >= s.rounds) {
            s.phase = 'over';
            const st = this.standings(i => s.totals[i]);
            this.say(s.teamMode ? `${TEAM_NAMES[st.teams[0].team]} gewinnt.` : `${s.players[st.players[0].seat].name} gewinnt.`);
        } else {
            this.#startWord(now);
        }
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        if (s.phase === 'play') {
            if (now >= s.nextAt) {
                if (s.shown < HINTS_PER_WORD) {
                    s.shown++;
                    s.tries = s.players.map(() => 0);
                    s.nextAt = now + (s.shown < HINTS_PER_WORD ? HINT_MS : FINAL_MS);
                    s.deadline = s.nextAt;
                } else {
                    this.#startReveal(now);
                }
                this.bump();
            }
        } else if (s.phase === 'reveal' && now >= s.deadline) {
            this.#afterReveal(now);
            this.bump();
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    gameView(seat, now) {
        const s = this.s;
        const active = s.phase === 'play' || s.phase === 'reveal' || (s.phase === 'over' && s.word);
        const reveal = s.phase === 'reveal' || s.phase === 'over';
        return {
            rounds: s.rounds,
            roundOptions: ROUND_OPTIONS,
            round: s.round,
            hintCount: HINTS_PER_WORD,
            shown: s.shown,
            hints: active && s.word ? s.word.hints.slice(0, reveal ? HINTS_PER_WORD : s.shown) : [],
            solution: reveal && s.word ? s.word.solution : null,
            solved: s.solved,
            gain: s.gain,
            order: s.solvedOrder,
            guesses: s.guesses,
            triesLeft: s.phase === 'play' ? Math.max(0, TRIES_PER_HINT - (s.tries[seat] || 0)) : 0,
            nextPoints: s.phase === 'play' ? this.pointsFor(s.shown, s.solvedOrder.length) : 0,
            ready: s.ready,
            totals: s.totals,
            msLeft: s.phase === 'play' || s.phase === 'reveal' ? Math.max(0, s.deadline - now) : null,
        };
    }
}
