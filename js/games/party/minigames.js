// Minispiele von Sternenjagd, Seite des Hosts: Aufbau, Zeitablauf, Antworten, Punkte, Belohnungen.
// Es gibt drei Arten:
//   solo  Alle spielen gleichzeitig für sich auf ihrem Gerät und melden am Ende nur ihre Punktzahl (Geschicklichkeit).
//   quiz  Der Host stellt Fragen und wertet Antworten selbst (Wissen, Flaggen), die richtige Lösung bleibt beim Host.
//   draw  Eine Person zeichnet einen Begriff, alle anderen raten ihn.
//   sub   Gesellschaftsspiele (Lügenwürfel, Stadt-Land-Fluss, Undercover, Stufenquiz, Wortraten): laufen als eigene kleine
//         Engine (subgames.js), ab 4 Personen teils in Teams.
import { QUESTIONS, FLAGS, WORDS } from './data.js';
import { checkGuess } from '../songquiz/answer.js';
import { SUBGAMES, isSub, createSub, subScores } from './subgames.js';

export const INTRO_MS = 6000;
export const RESULT_MS = 9000;
const SUB_INTRO_MS = 9000; // Gesellschaftsspiele brauchen mehr Zeit zum Lesen der Regeln (und der Teams)
const GRACE_MS = 2000; // so lange nach Ablauf werden noch Ergebnisse angenommen

const QUIZ = { count: 4, askMs: 10000, revealMs: 2500 };
const FLAG = { count: 5, askMs: 8000, revealMs: 2000 };
const DRAW_MS = 60000;
const MAX_STROKE_NUMBERS = 600; // Zahlen pro Strich (x und y zählen einzeln)
const MAX_DRAW_NUMBERS = 9000; // insgesamt pro Zeichnung

export const MINIS = {
    timing: { title: 'Volltreffer', kind: 'solo', playMs: 26000, max: 300, rules: 'Tippe genau dann, wenn die Marke im grünen Bereich ist. Drei Versuche, näher dran gibt mehr Punkte.' },
    hoops: { title: 'Korbwurf', kind: 'solo', playMs: 22000, max: 3000, rules: 'Tippe zum Werfen und triff den beweglichen Korb. Jeder Treffer zählt. Du hast 20 Sekunden.' },
    reaction: { title: 'Blitzreaktion', kind: 'solo', playMs: 30000, max: 1800, rules: 'Tippe, sobald der Bildschirm grün wird. Zu früh getippt gibt null Punkte. Drei Versuche.' },
    tapping: { title: 'Tipp-Marathon', kind: 'solo', playMs: 11000, max: 300, rules: 'Tippe so schnell du kannst, 8 Sekunden lang!' },
    memory: { title: 'Merkreihe', kind: 'solo', playMs: 42000, max: 1500, rules: 'Merke dir die Reihenfolge der Farben und tippe sie nach. Jede Runde wird sie länger.' },
    math: { title: 'Kopfrechnen', kind: 'solo', playMs: 24000, max: 3000, rules: 'Löse in 20 Sekunden so viele Rechenaufgaben wie möglich. Falsche Antworten kosten Punkte.' },
    quiz: { title: 'Wissen', kind: 'quiz', playMs: QUIZ.count * (QUIZ.askMs + QUIZ.revealMs), rules: `${QUIZ.count} Fragen, je 10 Sekunden. Wer richtig und schnell antwortet, bekommt die meisten Punkte.` },
    flags: { title: 'Flaggen', kind: 'quiz', playMs: FLAG.count * (FLAG.askMs + FLAG.revealMs), rules: `${FLAG.count} Flaggen: Welches Land ist es? Schnell sein lohnt sich.` },
    draw: { title: 'Zeichnen & Raten', kind: 'draw', playMs: DRAW_MS, rules: 'Eine Person zeichnet einen Begriff, alle anderen raten ihn. Richtig raten bringt Punkte, dem Zeichner auch.' },
};
for (const [type, def] of Object.entries(SUBGAMES)) MINIS[type] = { title: def.title, kind: 'sub', playMs: def.capMs, rules: def.rules, teams: def.teams, minPlayers: def.minPlayers };
export const MINI_TYPES = Object.keys(MINIS);
// Minispiele, die mit dieser Personenzahl spielbar sind (Undercover braucht mindestens 3)
export const availableMinis = n => MINI_TYPES.filter(t => (MINIS[t].minPlayers ?? 2) <= n);

function shuffle(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const sample = (list, n, rng) => shuffle(list, rng).slice(0, n);

// players: [{ coins, stars, connected }]
export function createMini({ type, id, rng, players, now, star }) {
    const def = MINIS[type];
    const mini = {
        id, type, kind: def.kind, title: def.title, rules: def.rules, star: !!star,
        phase: 'intro', introEnd: now + INTRO_MS, playStart: null, playEnd: null, resultEnd: null,
        playMs: def.playMs, params: {}, secret: {}, subs: {}, scores: null, result: null,
    };
    if (def.kind === 'sub') {
        const sub = createSub(type, { rng, players, star });
        // Die Engine ist nicht Teil des gespeicherten Zustands (unterbrochene Minispiele entfallen ohnehin)
        Object.defineProperty(mini, 'engine', { value: sub.engine, enumerable: false });
        mini.teams = sub.teams;
        mini.introEnd = now + SUB_INTRO_MS;
    } else if (def.kind === 'solo') {
        mini.params = { seed: Math.floor(rng() * 2 ** 31) };
    } else if (def.kind === 'quiz') {
        const cfg = type === 'flags' ? FLAG : QUIZ;
        const items = [];
        const correct = [];
        if (type === 'flags') {
            for (const [code, name] of sample(FLAGS, cfg.count, rng)) {
                const wrong = sample(FLAGS.filter(f => f[0] !== code), 3, rng).map(f => f[1]);
                const options = shuffle([name, ...wrong], rng);
                items.push({ q: 'Welches Land ist das?', img: code, options });
                correct.push(options.indexOf(name));
            }
        } else {
            for (const [q, right, ...wrong] of sample(QUESTIONS, cfg.count, rng)) {
                const options = shuffle([right, ...wrong], rng);
                items.push({ q, options });
                correct.push(options.indexOf(right));
            }
        }
        mini.params = { items, askMs: cfg.askMs, revealMs: cfg.revealMs };
        mini.secret = { correct };
        mini.q = { i: 0, phase: 'ask', start: null, revealStart: null, answers: items.map(() => ({})) };
    } else {
        // Wer am wenigsten Punkte hat, darf zeichnen (Aufholhilfe); bei Gleichstand entscheidet der Zufall
        const all = players.map((p, i) => ({ i, v: p.coins + p.stars * 10, c: p.connected }));
        const candidates = all.some(p => p.c) ? all.filter(p => p.c) : all; // notfalls auch Offline-Spieler
        const low = Math.min(...candidates.map(p => p.v));
        const drawers = candidates.filter(p => p.v === low);
        const drawer = drawers[Math.floor(rng() * drawers.length)].i;
        mini.secret = { word: WORDS[Math.floor(rng() * WORDS.length)] };
        mini.draw = { drawer, strokes: [], numbers: 0, version: 0, correct: {} };
    }
    return mini;
}

const activeSeats = players => players.map((p, i) => i).filter(i => players[i].connected);

function startPlay(mini, now) {
    mini.phase = 'play';
    mini.playStart = now;
    mini.playEnd = now + mini.playMs;
    if (mini.q) mini.q.start = now;
    mini.engine?.begin(now);
}

// Wertet das Minispiel aus und geht in die Ergebnisphase.
function finish(mini, now, players) {
    mini.phase = 'result';
    mini.resultEnd = now + RESULT_MS;
    const scores = {};
    players.forEach((p, i) => (scores[i] = 0));
    if (mini.kind === 'sub') {
        subScores(mini.type, mini.engine, mini.teams).forEach((v, i) => (scores[i] = v));
    } else if (mini.kind === 'solo') {
        for (const [seat, v] of Object.entries(mini.subs)) scores[seat] = v;
    } else if (mini.kind === 'quiz') {
        const ask = mini.params.askMs;
        mini.params.items.forEach((item, idx) => {
            for (const [seat, ans] of Object.entries(mini.q.answers[idx])) {
                if (ans.c === mini.secret.correct[idx]) scores[seat] += 100 + Math.max(0, Math.floor(100 * (1 - ans.ms / ask)));
            }
        });
    } else {
        const d = mini.draw;
        let n = 0;
        for (const [seat, ms] of Object.entries(d.correct)) {
            scores[seat] = 100 + Math.max(0, Math.floor(100 * (1 - ms / mini.playMs)));
            n++;
        }
        scores[d.drawer] = n * 60;
    }
    mini.scores = scores;
}

// Zeitsteuerung. Gibt true zurück, wenn sich etwas geändert hat.
export function tickMini(mini, now, players) {
    const seats = activeSeats(players);
    if (mini.phase === 'intro') {
        if (now >= mini.introEnd) {
            startPlay(mini, now);
            return true;
        }
        return false;
    }
    if (mini.phase !== 'play') return false;

    if (mini.kind === 'sub') {
        const changed = mini.engine.tick(now);
        if (mini.engine.s.phase === 'over' || now >= mini.playEnd) {
            finish(mini, now, players);
            return true;
        }
        return changed;
    }
    if (mini.kind === 'solo') {
        const all = seats.length > 0 && seats.every(s => mini.subs[s] !== undefined);
        if (all || now >= mini.playEnd + GRACE_MS) {
            finish(mini, now, players);
            return true;
        }
    } else if (mini.kind === 'quiz') {
        const q = mini.q;
        if (q.phase === 'ask') {
            const all = seats.length > 0 && seats.every(s => q.answers[q.i][s]);
            if (all || now >= q.start + mini.params.askMs) {
                q.phase = 'reveal';
                q.revealStart = now;
                return true;
            }
        } else if (now >= q.revealStart + mini.params.revealMs) {
            if (q.i + 1 >= mini.params.items.length) finish(mini, now, players);
            else {
                q.i++;
                q.phase = 'ask';
                q.start = now;
            }
            return true;
        }
    } else {
        const d = mini.draw;
        const guessers = seats.filter(s => s !== d.drawer);
        const allRight = guessers.length > 0 && guessers.every(s => d.correct[s] !== undefined);
        if (allRight || now >= mini.playEnd || !players[d.drawer].connected) {
            finish(mini, now, players);
            return true;
        }
    }
    return false;
}

const err = error => ({ error });
const OK = { ok: true };
const isNum = n => Number.isFinite(n);

export function miniAction(mini, seat, a, now, players) {
    if (mini.phase !== 'play') return err('Gerade läuft kein Minispiel.');
    if (mini.kind === 'sub') {
        const act = a.kind === 'sub' ? a.a : null;
        if (!act || !SUBGAMES[mini.type].allowed.includes(act.t)) return err('Unbekannte Aktion.');
        return mini.engine.apply(seat, act, now);
    }
    if (mini.kind === 'solo') {
        if (a.kind !== 'score') return err('Unbekannte Aktion.');
        if (mini.subs[seat] !== undefined) return OK; // nur das erste Ergebnis zählt
        const max = MINIS[mini.type].max;
        mini.subs[seat] = Math.min(max, Math.max(0, Math.floor(isNum(a.score) ? a.score : 0)));
        return OK;
    }
    if (mini.kind === 'quiz') {
        if (a.kind !== 'answer') return err('Unbekannte Aktion.');
        const q = mini.q;
        if (q.phase !== 'ask') return err('Die Zeit für diese Frage ist vorbei.');
        if (q.answers[q.i][seat]) return OK;
        const c = Number(a.c);
        if (!Number.isInteger(c) || c < 0 || c > 3) return err('Ungültige Antwort.');
        q.answers[q.i][seat] = { c, ms: Math.min(mini.params.askMs, now - q.start) };
        return OK;
    }
    const d = mini.draw;
    if (a.kind === 'guess') {
        if (seat === d.drawer) return err('Du zeichnest, du darfst nicht raten.');
        if (d.correct[seat] !== undefined) return OK;
        const text = String(a.text ?? '').slice(0, 60);
        if (!text.trim()) return err('Gib einen Begriff ein.');
        if (checkGuess(text, { title: mini.secret.word, artist: '' }).title) {
            d.correct[seat] = now - mini.playStart;
            return { ok: true, notice: 'Richtig!' };
        }
        return { ok: true, notice: 'Leider nicht.' };
    }
    if (seat !== d.drawer) return err('Nur die zeichnende Person darf zeichnen.');
    if (a.kind === 'clear') {
        d.strokes = [];
        d.numbers = 0;
        d.version++;
        return OK;
    }
    if (a.kind === 'stroke') {
        const p = Array.isArray(a.p) ? a.p : [];
        if (p.length < 2 || p.length > MAX_STROKE_NUMBERS || p.length % 2 !== 0 || !p.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) return err('Ungültiger Strich.');
        if (d.numbers + p.length > MAX_DRAW_NUMBERS) return err('Die Zeichnung ist voll.');
        const c = Number.isInteger(a.c) && a.c >= 0 && a.c <= 5 ? a.c : 0;
        const w = a.w === 2 || a.w === 4 || a.w === 8 ? a.w : 4;
        d.strokes.push({ c, w, p });
        d.numbers += p.length;
        d.version++;
        return OK;
    }
    return err('Unbekannte Aktion.');
}

// Hinweis für Ratende: nur die Wortlängen
function wordMask(word) {
    return [...word].map(ch => (/[\p{L}\p{N}]/u.test(ch) ? '•' : ch)).join(' ');
}

export function miniView(mini, seat, now, players) {
    const left = t => Math.max(0, t - now);
    const v = {
        id: mini.id, type: mini.type, kind: mini.kind, title: mini.title, rules: mini.rules, star: mini.star, phase: mini.phase,
        msLeft: mini.phase === 'intro' ? left(mini.introEnd) : mini.phase === 'play' ? left(mini.playEnd) : mini.phase === 'result' ? left(mini.resultEnd) : 0,
        teamCapable: !!MINIS[mini.type].teams, playMs: mini.playMs, params: {}, submitted: Object.keys(mini.subs).map(Number), result: mini.result,
    };
    if (mini.kind === 'sub') {
        v.teams = mini.teams ? { of: mini.teams.of, names: mini.teams.names } : null;
        v.sub = mini.phase === 'play' ? mini.engine.view(seat, now) : null;
        if (mini.teams && mini.scores) v.teamScores = [0, 1].map(t => mini.scores[mini.teams.of.indexOf(t)] ?? 0);
    } else if (mini.kind === 'solo') {
        v.params = mini.params;
    } else if (mini.kind === 'quiz') {
        const q = mini.q;
        const item = mini.params.items[q.i];
        const answered = Object.keys(q.answers[q.i]).map(Number);
        const reveal = mini.phase === 'result' || q.phase === 'reveal';
        v.params = {
            total: mini.params.items.length, i: q.i, item, itemPhase: q.phase,
            itemMsLeft: q.phase === 'ask' && q.start ? left(q.start + mini.params.askMs) : 0,
            askMs: mini.params.askMs, answered,
            mine: q.answers[q.i][seat]?.c ?? null,
            correct: reveal ? mini.secret.correct[q.i] : null,
            picks: reveal ? Object.fromEntries(Object.entries(q.answers[q.i]).map(([s, a]) => [s, a.c])) : null,
        };
    } else {
        const d = mini.draw;
        const isDrawer = seat === d.drawer;
        v.params = {
            drawer: d.drawer, strokes: d.strokes, version: d.version,
            word: isDrawer || mini.phase === 'result' ? mini.secret.word : null,
            mask: wordMask(mini.secret.word),
            correct: Object.keys(d.correct).map(Number),
        };
    }
    return v;
}

// Belohnungen: 1. Platz 10 Münzen (oder ein Stern in Sternrunden), 2. 6, 3. 4, alle anderen 2, ohne Punkte 1.
// dense: für Teams, dort bekommt das bessere Team Platz 1 und das andere Platz 2 (nicht Platz 4 bei drei Gewinnern).
export function computeRewards(scores, seats, star, dense = false) {
    const list = seats.map(s => ({ seat: s, score: scores[s] || 0 })).sort((a, b) => b.score - a.score || a.seat - b.seat);
    let rank = 0;
    let prev = null;
    return list.map((e, i) => {
        if (e.score !== prev) {
            rank = dense ? rank + 1 : i + 1;
            prev = e.score;
        }
        const scored = e.score > 0;
        const coins = scored ? ({ 1: 10, 2: 6, 3: 4 }[rank] ?? 2) : 1;
        const winStar = star && scored && rank === 1;
        return { seat: e.seat, score: e.score, rank, coins: winStar ? 0 : coins, stars: winStar ? 1 : 0 };
    });
}
