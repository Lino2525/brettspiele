// Spielablauf des Stufenquiz (3 bis 6 Personen, auch in Teams).
// Jede Runde hat eine Kategorie. Alle wählen geheim eine Stufe von 1 (ganz leicht) bis 10 (richtig schwer) und bekommen dazu
// eine eigene Frage mit vier Antworten. Richtig = so viele Punkte wie die Stufe, falsch = keine Punkte: wer sich zu viel zutraut, geht leer aus.
import { RoomGame, err, OK, shuffled, TEAM_NAMES } from '../common/room.js';
import { CATEGORIES, MAX_LEVEL } from './questions.js';

export const ROUND_OPTIONS = [6, 8, 10, 12];
export const CHOOSE_MS = 12000;
export const ANSWER_MS = 20000;
export const REVEAL_MS = 7000;
const DEFAULT_LEVEL = 1; // wer nicht wählt, bekommt die leichteste Stufe

export { MAX_LEVEL };

export class LadderGame extends RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = true;

    initialState() {
        return { rounds: 8, round: 0, catOrder: [], cat: 0, choices: [], questions: [], answers: [], totals: [], reveal: null, used: [], deadline: 0, ready: [] };
    }

    afterRestore() {
        const s = this.s;
        // Zeiten sind nach einem Neustart des Hosts veraltet: die laufende Runde wird neu begonnen
        if (s.phase === 'choose' || s.phase === 'answer') {
            s.round--;
            this.#startRound(Date.now());
        } else if (s.phase === 'reveal') {
            s.deadline = Date.now() + REVEAL_MS;
        }
    }

    // ---------- Start ----------

    begin(now) {
        const s = this.s;
        s.round = 0;
        s.totals = s.players.map(() => 0);
        s.catOrder = [];
        this.#startRound(now);
    }

    #startRound(now) {
        const s = this.s;
        s.round++;
        if (s.catOrder.length === 0) s.catOrder = shuffled(CATEGORIES.map((c, i) => i), this.rng);
        s.cat = s.catOrder.shift();
        s.choices = s.players.map(() => 0);
        s.questions = [];
        s.answers = s.players.map(() => -1);
        s.reveal = null;
        s.ready = [];
        s.phase = 'choose';
        s.deadline = now + CHOOSE_MS;
    }

    // Wählt eine noch nicht gestellte Frage der Stufe; sind alle verbraucht, die nächstliegende Stufe, zuletzt eine beliebige.
    #pickQuestion(level) {
        const s = this.s;
        const levels = CATEGORIES[s.cat].levels;
        const free = lv => levels[lv - 1].map((q, idx) => ({ q, id: `${s.cat}:${lv}:${idx}` })).filter(x => !s.used.includes(x.id));
        let pool = free(level);
        for (let d = 1; !pool.length && d < MAX_LEVEL; d++) {
            pool = [...(level - d >= 1 ? free(level - d) : []), ...(level + d <= MAX_LEVEL ? free(level + d) : [])];
        }
        if (!pool.length) {
            pool = levels[level - 1].map((q, idx) => ({ q, id: `${s.cat}:${level}:${idx}` }));
            s.used = s.used.filter(id => !id.startsWith(`${s.cat}:`));
        }
        const pick = pool[Math.floor(this.rng() * pool.length)];
        s.used.push(pick.id);
        if (s.used.length > 600) s.used.shift();
        const [text, right, ...wrong] = pick.q;
        const opts = shuffled([right, ...wrong], this.rng);
        return { id: pick.id, text, opts, right: opts.indexOf(right) };
    }

    #startAnswer(now) {
        const s = this.s;
        s.choices = s.choices.map(c => c || DEFAULT_LEVEL);
        s.questions = s.choices.map(level => ({ level, ...this.#pickQuestion(level) }));
        s.phase = 'answer';
        s.deadline = now + ANSWER_MS;
    }

    #startReveal(now) {
        const s = this.s;
        s.reveal = s.questions.map((q, seat) => {
            const answer = s.answers[seat];
            const ok = answer === q.right;
            const gain = ok ? q.level : 0;
            s.totals[seat] += gain;
            return { seat, level: q.level, text: q.text, opts: q.opts, right: q.right, answer, ok, gain };
        });
        s.phase = 'reveal';
        s.ready = [];
        s.deadline = now + REVEAL_MS;
    }

    #afterReveal(now) {
        const s = this.s;
        if (s.round >= s.rounds) {
            s.phase = 'over';
            const st = this.standings(i => s.totals[i]);
            this.say(s.teamMode ? `${TEAM_NAMES[st.teams[0].team]} gewinnt.` : `${s.players[st.players[0].seat].name} gewinnt.`);
        } else {
            this.#startRound(now);
        }
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
            case 'level': {
                if (s.phase !== 'choose') return err('Gerade wird keine Stufe gewählt.');
                if (!Number.isInteger(a.n) || a.n < 1 || a.n > MAX_LEVEL) return err('Ungültige Stufe.');
                s.choices[seat] = a.n;
                if (!s.players.some((p, i) => p.connected && !s.choices[i])) this.#startAnswer(now);
                return OK;
            }
            case 'answer': {
                if (s.phase !== 'answer') return err('Gerade wird nicht geantwortet.');
                if (!Number.isInteger(a.c) || a.c < 0 || a.c > 3) return err('Ungültige Antwort.');
                if (s.answers[seat] >= 0) return err('Du hast schon geantwortet.');
                s.answers[seat] = a.c;
                if (!s.players.some((p, i) => p.connected && s.answers[i] < 0)) this.#startReveal(now);
                return OK;
            }
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

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        if (now >= s.deadline) {
            if (s.phase === 'choose') { this.#startAnswer(now); this.bump(); }
            else if (s.phase === 'answer') { this.#startReveal(now); this.bump(); }
            else if (s.phase === 'reveal') { this.#afterReveal(now); this.bump(); }
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    gameView(seat, now) {
        const s = this.s;
        const inRound = s.phase === 'choose' || s.phase === 'answer' || s.phase === 'reveal';
        const q = s.phase === 'answer' ? s.questions[seat] : null;
        return {
            rounds: s.rounds,
            roundOptions: ROUND_OPTIONS,
            round: s.round,
            maxLevel: MAX_LEVEL,
            category: inRound || s.phase === 'over' ? { name: CATEGORIES[s.cat].name, icon: CATEGORIES[s.cat].icon } : null,
            // Gewählte Stufen sind erst sichtbar, wenn alle gewählt haben
            myChoice: s.phase === 'choose' ? s.choices[seat] : 0,
            chosen: s.phase === 'choose' ? s.choices.map(c => c > 0) : [],
            levels: s.phase === 'answer' || s.phase === 'reveal' ? s.questions.map(x => x.level) : [],
            myQuestion: q ? { text: q.text, opts: q.opts, level: q.level } : null,
            myAnswer: s.phase === 'answer' ? s.answers[seat] : -1,
            answered: s.phase === 'answer' ? s.answers.map(a => a >= 0) : [],
            reveal: s.phase === 'reveal' || (s.phase === 'over' && s.reveal) ? s.reveal : null,
            ready: s.ready,
            totals: s.totals,
            msLeft: inRound ? Math.max(0, s.deadline - now) : null,
        };
    }
}
