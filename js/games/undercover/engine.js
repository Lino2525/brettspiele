// Spielablauf von Undercover / Spion (3 bis 6 Personen).
// Undercover: Alle bekommen ein Wort, nur eine Person ein ähnliches anderes. Spion: Eine Person bekommt gar kein Wort.
// Reihum gibt jede Person einen Hinweis (getippt), dann wird abgestimmt, wer rausfliegt. Wird die gesuchte Person enttarnt,
// gewinnen die anderen (im Spion-Modus darf der Spion noch das Wort raten). Bleiben nur noch 2 übrig, gewinnt sie.
import { RoomGame, err, OK } from '../common/room.js';
import { PAIRS, SPY_WORDS } from './words.js';
import { normalize, matchesAny } from '../songquiz/answer.js';

export const MODES = { undercover: 'Undercover', spy: 'Spion' };
export const REVEAL_MS = 60000;
export const CLUE_MS = 45000;
export const VOTE_MS = 90000;
export const RESULT_MS = 15000;
export const GUESS_MS = 40000;
export const FIRST_CLUE_ROUNDS = 2;
const AFK_MS = 3000;

export class UndercoverGame extends RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = false;

    initialState() {
        return {
            mode: 'undercover', imp: -1, word: '', word2: '', cluesLeft: 0, clueRound: 0, order: [], turnIdx: 0, clues: [],
            votes: {}, elim: null, outcome: null, deadline: 0, turnStart: 0, ready: [], usedWords: [],
        };
    }

    newPlayer() {
        return { alive: true, wins: 0 };
    }

    afterRestore() {
        const s = this.s;
        if (s.phase !== 'waiting' && s.phase !== 'over') this.#start(Date.now()); // laufende Runde beginnt mit neuen Wörtern von vorn
    }

    // ---------- Start ----------

    begin(now) {
        this.#start(now);
    }

    #start(now) {
        const s = this.s;
        for (const p of s.players) p.alive = true;
        s.imp = Math.floor(this.rng() * s.players.length);
        if (s.mode === 'spy') {
            const pool = SPY_WORDS.filter(w => !s.usedWords.includes(w));
            const list = pool.length ? pool : SPY_WORDS;
            s.word = list[Math.floor(this.rng() * list.length)];
            s.word2 = '';
        } else {
            const pool = PAIRS.filter(p => !s.usedWords.includes(p[0]));
            const list = pool.length ? pool : PAIRS;
            const pair = list[Math.floor(this.rng() * list.length)];
            const flip = this.rng() < 0.5;
            s.word = pair[flip ? 1 : 0];
            s.word2 = pair[flip ? 0 : 1];
        }
        s.usedWords.push(s.word);
        if (s.usedWords.length > 400) s.usedWords.shift();
        s.clues = [];
        s.votes = {};
        s.elim = null;
        s.outcome = null;
        s.cluesLeft = FIRST_CLUE_ROUNDS;
        s.clueRound = 0;
        s.ready = [];
        s.phase = 'reveal';
        s.deadline = now + REVEAL_MS;
        s.log = [];
    }

    // ---------- Hilfen ----------

    #aliveSeats() {
        return this.s.players.map((p, i) => i).filter(i => this.s.players[i].alive);
    }

    wordOf(seat) {
        const s = this.s;
        if (seat === s.imp) return s.mode === 'spy' ? null : s.word2;
        return s.word;
    }

    #startClueRound(now) {
        const s = this.s;
        const alive = this.#aliveSeats();
        const start = Math.floor(this.rng() * alive.length);
        s.order = alive.map((_, k) => alive[(start + k) % alive.length]);
        s.turnIdx = 0;
        s.clueRound++;
        s.cluesLeft--;
        s.phase = 'clues';
        s.turnStart = now;
        s.deadline = now + CLUE_MS;
        s.ready = [];
    }

    #startVote(now) {
        const s = this.s;
        s.phase = 'vote';
        s.votes = {};
        s.deadline = now + VOTE_MS;
    }

    // ---------- Aktionen ----------

    act(seat, a, now) {
        const s = this.s;
        switch (a?.t) {
            case 'setMode':
                if (seat !== 0) return err('Nur wer den Raum erstellt hat, kann das ändern.');
                if (s.phase !== 'waiting' && s.phase !== 'over') return err('Das Spiel läuft schon.');
                if (!MODES[a.mode]) return err('Unbekannte Variante.');
                s.mode = a.mode;
                return OK;
            case 'ready': return this.#ready(seat, now);
            case 'clue': return this.#clue(seat, a.text, now);
            case 'vote': return this.#vote(seat, a.target, now);
            case 'guess': return this.#guess(seat, a.text, now);
            default: return err('Unbekannte Aktion.');
        }
    }

    #ready(seat, now) {
        const s = this.s;
        if (s.phase !== 'reveal' && s.phase !== 'result') return err('Gerade nicht möglich.');
        if (!s.ready.includes(seat)) s.ready.push(seat);
        if (!s.players.some((p, i) => p.connected && !s.ready.includes(i))) this.#afterReadyPhase(now);
        return OK;
    }

    #afterReadyPhase(now) {
        this.#startClueRound(now);
    }

    #clue(seat, text, now) {
        const s = this.s;
        if (s.phase !== 'clues') return err('Gerade werden keine Hinweise gegeben.');
        if (s.order[s.turnIdx] !== seat) return err('Du bist nicht dran.');
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
        if (!clean) return err('Bitte einen Hinweis eingeben.');
        if (clean.split(' ').length > 3) return err('Ein Hinweis besteht aus höchstens drei Wörtern, am besten aus einem.');
        const mine = this.wordOf(seat);
        if (mine && normalize(clean).includes(normalize(mine))) return err('Der Hinweis darf dein Wort nicht enthalten.');
        s.clues.push({ seat, round: s.clueRound, text: clean });
        this.#nextClue(now);
        return OK;
    }

    #nextClue(now) {
        const s = this.s;
        s.turnIdx++;
        s.turnStart = now;
        s.deadline = now + CLUE_MS;
        if (s.turnIdx >= s.order.length) {
            if (s.cluesLeft > 0) this.#startClueRound(now);
            else this.#startVote(now);
        }
    }

    #vote(seat, target, now) {
        const s = this.s;
        if (s.phase !== 'vote') return err('Gerade wird nicht abgestimmt.');
        if (!s.players[seat].alive) return err('Du bist schon ausgeschieden.');
        if (!Number.isInteger(target) || !s.players[target]?.alive) return err('Ungültige Wahl.');
        if (target === seat) return err('Du kannst nicht für dich selbst stimmen.');
        s.votes[seat] = target;
        const voters = this.#aliveSeats().filter(i => s.players[i].connected);
        if (voters.every(i => s.votes[i] !== undefined)) this.#countVotes(now);
        return OK;
    }

    #countVotes(now) {
        const s = this.s;
        const tally = {};
        for (const t of Object.values(s.votes)) tally[t] = (tally[t] || 0) + 1;
        const alive = this.#aliveSeats();
        const max = Math.max(0, ...alive.map(i => tally[i] || 0));
        const top = max === 0 ? alive : alive.filter(i => (tally[i] || 0) === max);
        const out = top[Math.floor(this.rng() * top.length)];
        const tie = top.length > 1;
        s.players[out].alive = false;
        s.elim = { seat: out, wasImp: out === s.imp, tally, tie, votes: { ...s.votes } };
        this.say(`${s.players[out].name} fliegt raus${tie ? ' (Gleichstand, das Los entscheidet)' : ''}.`);
        if (out === s.imp) {
            if (s.mode === 'spy') {
                s.phase = 'guess';
                s.deadline = now + GUESS_MS;
            } else {
                this.#finish('civ', 'Der Undercover wurde enttarnt!');
            }
        } else if (this.#aliveSeats().length <= 2) {
            this.#finish('imp', s.mode === 'spy' ? 'Der Spion ist unentdeckt geblieben!' : 'Der Undercover ist unentdeckt geblieben!');
        } else {
            s.cluesLeft = 1;
            s.phase = 'result';
            s.ready = [];
            s.deadline = now + RESULT_MS;
        }
    }

    #guess(seat, text, now) {
        const s = this.s;
        if (s.phase !== 'guess') return err('Gerade nicht möglich.');
        if (seat !== s.imp) return err('Nur der Spion darf raten.');
        const right = matchesAny(String(text ?? ''), [normalize(s.word)]);
        if (right) this.#finish('imp', 'Der Spion hat das Wort erraten!', String(text).trim().slice(0, 30));
        else this.#finish('civ', 'Der Spion hat falsch geraten.', String(text ?? '').trim().slice(0, 30));
        return OK;
    }

    #finish(winner, reason, guess = '') {
        const s = this.s;
        s.phase = 'over';
        s.outcome = { winner, reason, guess };
        s.players.forEach((p, i) => {
            if ((winner === 'imp') === (i === s.imp)) p.wins++;
        });
        this.say(reason);
    }

    // ---------- Zeitsteuerung ----------

    tick(now = Date.now()) {
        const s = this.s;
        const before = s.moveNo;
        switch (s.phase) {
            case 'reveal':
            case 'result':
                if (now >= s.deadline) {
                    this.#afterReadyPhase(now);
                    this.bump();
                }
                break;
            case 'clues': {
                const seat = s.order[s.turnIdx];
                const afk = !s.players[seat].connected && now >= s.turnStart + AFK_MS;
                if (afk || now >= s.deadline) {
                    s.clues.push({ seat, round: s.clueRound, text: '–' });
                    this.#nextClue(now);
                    this.bump();
                }
                break;
            }
            case 'vote':
                if (now >= s.deadline) {
                    this.#countVotes(now);
                    this.bump();
                }
                break;
            case 'guess':
                if (now >= s.deadline) {
                    this.#finish('civ', 'Der Spion hat nicht mehr geraten.');
                    this.bump();
                }
                break;
        }
        return s.moveNo !== before;
    }

    // ---------- Ansicht ----------

    gameView(seat, now) {
        const s = this.s;
        const over = s.phase === 'over';
        const waiting = s.phase === 'waiting';
        const mine = waiting ? null : this.wordOf(seat);
        return {
            mode: s.mode,
            modes: MODES,
            // Im Undercover-Modus weiß niemand, ob das eigene Wort das abweichende ist; im Spion-Modus kennt der Spion seine Rolle.
            word: mine,
            isSpy: !waiting && s.mode === 'spy' && seat === s.imp,
            alive: s.players.map(p => p.alive),
            wins: s.players.map(p => p.wins),
            order: s.phase === 'clues' ? s.order : [],
            turn: s.phase === 'clues' ? s.order[s.turnIdx] : -1,
            clueRound: s.clueRound,
            clues: s.clues,
            voted: s.phase === 'vote' ? s.players.map((p, i) => s.votes[i] !== undefined) : [],
            myVote: s.phase === 'vote' ? (s.votes[seat] ?? -1) : -1,
            ready: s.ready,
            elim: s.elim,
            outcome: s.outcome,
            roles: over ? s.players.map((p, i) => (i === s.imp ? 'imp' : 'civ')) : null,
            words: over ? { civ: s.word, imp: s.mode === 'spy' ? '' : s.word2 } : null,
            msLeft: s.deadline && !waiting && !over ? Math.max(0, s.deadline - now) : null,
        };
    }
}
