// Die Gesellschaftsspiele als Minispiele von Sternenjagd (Seite des Hosts).
// Jedes Minispiel dieser Art lässt eine eigene kleine Spiel-Engine laufen (aus js/games/<spiel>/engine.js), mit den
// Sternenjagd-Spielern als Mitspielern und kurzen Zeiten. Aus dem Ergebnis wird je Person eine Punktzahl für die Belohnung.
import { shuffled, MIN_TEAM_PLAYERS, TEAM_NAMES } from '../common/room.js';
import { LiarsGame } from '../liars/engine.js';
import { SlfGame } from '../slf/engine.js';
import { UndercoverGame } from '../undercover/engine.js';
import { LadderGame } from '../ladder/engine.js';
import { WordGuessGame } from '../wordguess/engine.js';

const SLF_CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Essen & Trinken', 'Gegenstand'];

export const SUBGAMES = {
    liars: {
        title: 'Lügenwürfel',
        Engine: LiarsGame,
        teams: false,
        capMs: 120000,
        rules: 'Jede Person hat 3 geheime Würfel. Reihum bieten, wie viele Würfel eines Wertes am Tisch liegen (Einser sind Joker), oder „Lüge!“ sagen. Wer falsch liegt, verliert einen Würfel. Wer am Ende die meisten Würfel hat, gewinnt.',
        allowed: ['bid', 'challenge', 'next'],
        setup(eng) {
            eng.s.diceStart = 3;
            eng.s.wild = true;
        },
        scores: eng => eng.s.players.map(p => p.dice * 10),
    },
    slf: {
        title: 'Stadt-Land-Fluss',
        Engine: SlfGame,
        teams: true,
        capMs: 130000,
        rules: 'Ein Buchstabe wird ausgelost. Schreibe zu jeder Kategorie ein passendes Wort damit. Wer fertig ist, ruft „Stopp“. Eigene Antworten zählen 10, wer allein eine hat 20, gleiche 5 Punkte. Unpassende Antworten kann die Gruppe anzweifeln.',
        allowed: ['answers', 'stop', 'flag', 'ready'],
        setup(eng, rng) {
            eng.s.rounds = 1;
            eng.s.categories = shuffled(SLF_CATEGORIES, rng).slice(0, 4);
        },
        scores: eng => eng.s.totals,
    },
    undercover: {
        title: 'Undercover',
        Engine: UndercoverGame,
        teams: false,
        minPlayers: 3, // mit zwei Personen gäbe es nichts zu raten
        capMs: 190000,
        rules: 'Alle bekommen ein geheimes Wort – eine Person ein anderes oder gar keins. Gebt reihum einen getippten Hinweis, ohne das Wort zu verraten, und wählt dann, wer abweicht. Wer auf der richtigen Seite steht, gewinnt.',
        allowed: ['ready', 'clue', 'vote', 'guess'],
        setup(eng, rng) {
            eng.s.quick = true;
            eng.s.mode = rng() < 0.5 ? 'spy' : 'undercover';
        },
        // Gewinner-Seite 10 Punkte, wer die gesuchte Person richtig gewählt hat 5 dazu
        scores(eng) {
            const s = eng.s;
            if (!s.outcome) return s.players.map(() => 0);
            return s.players.map((p, i) => {
                const onWinSide = (s.outcome.winner === 'imp') === (i === s.imp);
                const rightVote = i !== s.imp && s.elim?.votes?.[i] === s.imp;
                return (onWinSide ? 10 : 0) + (rightVote ? 5 : 0);
            });
        },
    },
    ladder: {
        title: 'Stufenquiz',
        Engine: LadderGame,
        teams: true,
        capMs: 90000,
        rules: 'Zwei Fragen aus einer Kategorie. Wähle jedes Mal selbst die Stufe von 1 (ganz leicht) bis 10 (richtig schwer): Richtig gibt so viele Punkte wie die Stufe, falsch gibt nichts.',
        allowed: ['level', 'answer', 'ready'],
        setup(eng) {
            eng.s.rounds = 2;
        },
        scores: eng => eng.s.totals,
    },
    wordguess: {
        title: 'Wortraten',
        Engine: WordGuessGame,
        teams: true,
        capMs: 125000,
        rules: 'Zwei Begriffe werden gesucht. Nach und nach werden Hinweise aufgedeckt, vom ungenauen bis zum fast eindeutigen. Tippe den Begriff so früh wie möglich: Je weniger Hinweise du brauchst, desto mehr Punkte.',
        allowed: ['guess', 'ready'],
        setup(eng) {
            eng.s.rounds = 2;
        },
        scores: eng => eng.s.totals,
    },
};

export const isSub = type => type in SUBGAMES;

// Baut die Engine für ein Minispiel. players: [{ name, connected }]. Teams gibt es nur bei geeigneten Spielen,
// ab 4 Personen und nicht in Sternrunden (dort spielt jede Person für sich).
export function createSub(type, { rng, players, star }) {
    const def = SUBGAMES[type];
    const eng = new def.Engine({ rng });
    players.forEach((p, i) => {
        eng.join(`p${i}`, p.name);
        eng.s.players[i].connected = p.connected;
    });
    def.setup?.(eng, rng);
    let teams = null;
    if (def.teams && !star && players.length >= MIN_TEAM_PLAYERS) {
        const order = shuffled(players.map((p, i) => i), rng);
        const of = players.map(() => 0);
        order.forEach((seat, k) => (of[seat] = k % 2));
        eng.s.teamMode = true;
        eng.s.players.forEach((p, i) => (p.team = of[i]));
        teams = { of, names: TEAM_NAMES };
    }
    return { engine: eng, teams };
}

// Punktzahl je Person. In Teams bekommen alle Mitglieder den Durchschnitt ihres Teams (damit zählt die Teamleistung).
export function subScores(type, engine, teams) {
    const raw = SUBGAMES[type].scores(engine).map(n => Math.max(0, Math.round(n)));
    if (!teams) return raw;
    const avg = [0, 1].map(t => {
        const members = raw.map((v, i) => i).filter(i => teams.of[i] === t);
        return members.length ? Math.round(members.reduce((sum, i) => sum + raw[i], 0) / members.length) : 0;
    });
    return raw.map((v, i) => avg[teams.of[i]]);
}
