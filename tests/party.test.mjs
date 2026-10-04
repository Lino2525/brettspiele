import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, FLAGS, WORDS } from '../js/games/party/data.js';
import { RING, SPACE_TYPES, ringCell, GRID_ROWS, GRID_COLS } from '../js/games/party/board.js';
import { MINIS, MINI_TYPES, createMini, tickMini, miniAction, miniView, computeRewards, INTRO_MS, RESULT_MS } from '../js/games/party/minigames.js';
import { PartyGame, MAX_PLAYERS, STAR_PRICE } from '../js/games/party/engine.js';

function seeded(seed = 1) {
    let x = seed;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

// ---------- Inhalte ----------

test('Fragen: vollständig, vier verschiedene Antworten, keine doppelten Fragen', () => {
    assert.ok(QUESTIONS.length >= 100, `nur ${QUESTIONS.length} Fragen`);
    const seen = new Set();
    for (const [q, ...answers] of QUESTIONS) {
        assert.equal(answers.length, 4, q);
        assert.equal(new Set(answers).size, 4, `doppelte Antworten bei: ${q}`);
        assert.ok(q.endsWith('?'), q);
        assert.ok(!seen.has(q), `doppelte Frage: ${q}`);
        seen.add(q);
        for (const a of answers) assert.ok(a.trim().length > 0, q);
    }
});

test('Flaggen: eindeutige Codes und Namen', () => {
    assert.ok(FLAGS.length >= 50);
    assert.equal(new Set(FLAGS.map(f => f[0])).size, FLAGS.length);
    assert.equal(new Set(FLAGS.map(f => f[1])).size, FLAGS.length);
    for (const [code] of FLAGS) assert.match(code, /^[a-z]{2}$/);
});

test('Zeichenbegriffe: eindeutig und nicht leer', () => {
    assert.ok(WORDS.length >= 70);
    assert.equal(new Set(WORDS).size, WORDS.length);
});

test('Spielfeld: 28 Felder, jedes Raster-Feld genau einmal, lückenloser Rundkurs', () => {
    assert.equal(RING, 28);
    assert.equal(SPACE_TYPES.length, 28);
    assert.equal(SPACE_TYPES[0], 'start');
    assert.equal(SPACE_TYPES.filter(t => t === 'start').length, 1);
    assert.ok(SPACE_TYPES.filter(t => t === 'green').length >= 5);
    assert.ok(SPACE_TYPES.filter(t => t === 'red').length >= 5);
    const cells = Array.from({ length: RING }, (_, i) => ringCell(i));
    assert.equal(new Set(cells.map(c => c.join(','))).size, RING);
    for (const [r, c] of cells) assert.ok(r >= 1 && r <= GRID_ROWS && c >= 1 && c <= GRID_COLS);
    for (let i = 0; i < RING; i++) {
        const [r1, c1] = cells[i];
        const [r2, c2] = cells[(i + 1) % RING];
        assert.equal(Math.abs(r1 - r2) + Math.abs(c1 - c2), 1, `Lücke zwischen Feld ${i} und ${i + 1}`);
    }
});

// ---------- Minispiele ----------

const people = (n = 3) => Array.from({ length: n }, (_, i) => ({ coins: 5 + i, stars: 0, connected: true }));

test('Belohnungen: Platz 1/2/3/Rest, Gleichstand teilt den Platz, null Punkte nur 1 Münze, Sternrunde', () => {
    let r = computeRewards({ 0: 300, 1: 200, 2: 100, 3: 50, 4: 0 }, [0, 1, 2, 3, 4], false);
    assert.deepEqual(r.map(x => [x.seat, x.rank, x.coins, x.stars]), [[0, 1, 10, 0], [1, 2, 6, 0], [2, 3, 4, 0], [3, 4, 2, 0], [4, 5, 1, 0]]);
    r = computeRewards({ 0: 200, 1: 200, 2: 100 }, [0, 1, 2], false);
    assert.deepEqual(r.map(x => [x.rank, x.coins]), [[1, 10], [1, 10], [3, 4]]);
    r = computeRewards({ 0: 200, 1: 100, 2: 0 }, [0, 1, 2], true);
    assert.deepEqual(r.map(x => [x.seat, x.stars, x.coins]), [[0, 1, 0], [1, 0, 6], [2, 0, 1]]);
    r = computeRewards({ 0: 0, 1: 0 }, [0, 1], true);
    assert.deepEqual(r.map(x => [x.stars, x.coins]), [[0, 1], [0, 1]], 'keine Punkte: kein Stern');
});

test('Solo-Minispiele: Phasen, Ergebnisse annehmen (einmal, begrenzt), Ende wenn alle fertig', () => {
    for (const type of MINI_TYPES.filter(t => MINIS[t].kind === 'solo')) {
        const players = people(3);
        const m = createMini({ type, id: 1, rng: seeded(2), players, now: 1000, star: false });
        assert.equal(m.phase, 'intro');
        assert.ok(Number.isInteger(m.params.seed));
        assert.ok(miniAction(m, 0, { kind: 'score', score: 5 }, 1500, players).error, 'vor dem Start nichts annehmen');
        assert.ok(tickMini(m, 1000 + INTRO_MS, players));
        assert.equal(m.phase, 'play');
        miniAction(m, 0, { kind: 'score', score: 150 }, 5000, players);
        miniAction(m, 0, { kind: 'score', score: 999999 }, 5000, players);
        miniAction(m, 1, { kind: 'score', score: 999999 }, 5000, players);
        miniAction(m, 2, { kind: 'score', score: -50 }, 5000, players);
        assert.equal(m.subs[0], Math.min(150, MINIS[type].max), 'nur das erste Ergebnis zählt');
        assert.equal(m.subs[1], MINIS[type].max, 'nach oben begrenzt');
        assert.equal(m.subs[2], 0, 'nach unten begrenzt');
        assert.ok(tickMini(m, 6000, players));
        assert.equal(m.phase, 'result');
        assert.equal(m.scores[1], MINIS[type].max);
    }
});

test('Solo: nicht abgegebene Ergebnisse werden nach Ablauf mit 0 gewertet, Offline-Spieler blockieren nicht', () => {
    const players = people(3);
    players[2].connected = false;
    const m = createMini({ type: 'tapping', id: 1, rng: seeded(3), players, now: 0, star: false });
    tickMini(m, INTRO_MS, players);
    miniAction(m, 0, { kind: 'score', score: 40 }, INTRO_MS + 9000, players);
    assert.equal(tickMini(m, INTRO_MS + 9100, players), false, 'Spieler 1 fehlt noch');
    assert.equal(tickMini(m, INTRO_MS + MINIS.tapping.playMs + 2100, players), true);
    assert.deepEqual(m.scores, { 0: 40, 1: 0, 2: 0 });
    const players2 = people(2);
    const m2 = createMini({ type: 'tapping', id: 2, rng: seeded(3), players: players2, now: 0, star: false });
    tickMini(m2, INTRO_MS, players2);
    miniAction(m2, 0, { kind: 'score', score: 10 }, INTRO_MS + 100, players2);
    miniAction(m2, 1, { kind: 'score', score: 20 }, INTRO_MS + 100, players2);
    assert.ok(tickMini(m2, INTRO_MS + 200, players2), 'alle fertig: sofort auswerten');
});

test('Quiz: Antworten, Zeitbonus, Reveal, nächste Frage, Auswertung; Lösung bleibt geheim', () => {
    const players = people(2);
    const m = createMini({ type: 'quiz', id: 1, rng: seeded(4), players, now: 0, star: false });
    assert.equal(m.params.items.length, 4);
    for (const item of m.params.items) assert.equal(item.options.length, 4);
    const v0 = miniView(m, 0, 0, players);
    assert.ok(!('correct' in v0.params) || v0.params.correct === null, 'Lösung nicht in der Ansicht');
    assert.ok(!JSON.stringify(m.params).includes('correct'));
    tickMini(m, INTRO_MS, players);
    const t0 = INTRO_MS;
    const right = m.secret.correct[0];
    const wrong = (right + 1) % 4;
    assert.ok(!miniAction(m, 0, { kind: 'answer', c: right }, t0 + 1000, players).error);
    assert.ok(!miniAction(m, 1, { kind: 'answer', c: wrong }, t0 + 2000, players).error);
    assert.ok(miniAction(m, 0, { kind: 'answer', c: 9 }, t0 + 3000, players).error === undefined, 'zweite Antwort wird ignoriert');
    assert.ok(tickMini(m, t0 + 2100, players), 'alle haben geantwortet: Reveal');
    assert.equal(m.q.phase, 'reveal');
    const rv = miniView(m, 0, t0 + 2200, players).params;
    assert.equal(rv.correct, right);
    assert.deepEqual(rv.picks, { 0: right, 1: wrong });
    assert.ok(miniAction(m, 0, { kind: 'answer', c: 0 }, t0 + 2300, players).error, 'im Reveal keine Antworten');
    const askMs = m.params.askMs;
    assert.ok(tickMini(m, t0 + 2100 + m.params.revealMs + 1, players));
    assert.equal(m.q.i, 1);
    assert.equal(m.q.phase, 'ask');
    // restliche Fragen: keiner antwortet, Zeit läuft ab
    let t = t0 + 2100 + m.params.revealMs + 1;
    for (let i = 1; i < 4; i++) {
        t += askMs + 1;
        tickMini(m, t, players);
        t += m.params.revealMs + 1;
        tickMini(m, t, players);
    }
    assert.equal(m.phase, 'result');
    assert.equal(m.scores[1], 0);
    assert.equal(m.scores[0], 100 + Math.floor(100 * (1 - 1000 / askMs)), 'richtig plus Zeitbonus');
});

test('Flaggen: Bild-Code und vier Länder-Optionen, Lösung steckt in den Optionen', () => {
    const players = people(2);
    const m = createMini({ type: 'flags', id: 1, rng: seeded(5), players, now: 0, star: false });
    assert.equal(m.params.items.length, 5);
    m.params.items.forEach((item, i) => {
        assert.match(item.img, /^[a-z]{2}$/);
        assert.equal(new Set(item.options).size, 4);
        const name = FLAGS.find(f => f[0] === item.img)[1];
        assert.equal(item.options[m.secret.correct[i]], name);
    });
});

test('Zeichnen: Zeichner ist der Ärmste, Strich-Prüfung, Raten mit Tippfehler, Auswertung', () => {
    const players = [{ coins: 20, stars: 1, connected: true }, { coins: 3, stars: 0, connected: true }, { coins: 9, stars: 0, connected: true }];
    const m = createMini({ type: 'draw', id: 1, rng: seeded(6), players, now: 0, star: false });
    assert.equal(m.draw.drawer, 1, 'wer am wenigsten hat, zeichnet');
    tickMini(m, INTRO_MS, players);
    const t0 = INTRO_MS;
    const word = m.secret.word;
    // nur der Zeichner sieht das Wort
    assert.equal(miniView(m, 1, t0, players).params.word, word);
    assert.equal(miniView(m, 0, t0, players).params.word, null);
    assert.ok(!JSON.stringify(miniView(m, 2, t0, players)).includes(`"${word}"`));
    assert.ok(miniAction(m, 0, { kind: 'stroke', p: [1, 2, 3, 4] }, t0, players).error, 'Raten darf nicht zeichnen');
    assert.ok(!miniAction(m, 1, { kind: 'stroke', c: 2, w: 4, p: [10, 10, 50, 60, 90, 20] }, t0, players).error);
    assert.ok(miniAction(m, 1, { kind: 'stroke', p: [10] }, t0, players).error, 'ungerade Zahl');
    assert.ok(miniAction(m, 1, { kind: 'stroke', p: [10, 2000] }, t0, players).error, 'außerhalb der Fläche');
    assert.ok(miniAction(m, 1, { kind: 'stroke', p: Array(700).fill(5) }, t0, players).error, 'zu lang');
    assert.equal(m.draw.strokes.length, 1);
    assert.equal(miniView(m, 0, t0, players).params.strokes.length, 1);
    assert.ok(miniAction(m, 1, { kind: 'guess', text: word }, t0, players).error, 'Zeichner darf nicht raten');
    const wrong = miniAction(m, 0, { kind: 'guess', text: 'xyzzy' }, t0 + 1000, players);
    assert.equal(wrong.notice, 'Leider nicht.');
    const right = miniAction(m, 2, { kind: 'guess', text: word.toUpperCase() }, t0 + 6000, players);
    assert.equal(right.notice, 'Richtig!');
    assert.ok(!tickMini(m, t0 + 7000, players), 'Spieler 0 fehlt noch');
    miniAction(m, 0, { kind: 'guess', text: word }, t0 + 12000, players);
    assert.ok(tickMini(m, t0 + 12100, players), 'alle haben es erraten');
    assert.equal(m.phase, 'result');
    assert.equal(m.scores[1], 120, 'Zeichner: 60 je richtigem Tipp');
    assert.ok(m.scores[2] > m.scores[0], 'schneller geraten gibt mehr Punkte');
    miniAction(m, 1, { kind: 'clear' }, t0, players);
});

// ---------- Spielablauf ----------

function newGame(n = 3, opts = {}) {
    const g = new PartyGame({ rng: seeded(7), ...opts });
    for (let i = 0; i < n; i++) assert.equal(g.join('t' + i, 'Spieler' + i), i);
    return g;
}

test('Lobby: Start nur durch den Gastgeber ab 2 Spielern, höchstens 6, Rundenzahl wählbar', () => {
    const g = new PartyGame({ rng: seeded(1) });
    g.join('a', 'A');
    assert.ok(g.apply(0, { t: 'start' }).error);
    g.join('b', 'B');
    assert.ok(g.apply(1, { t: 'start' }).error);
    for (let i = 2; i < MAX_PLAYERS; i++) assert.equal(g.join('p' + i, 'P' + i), i);
    assert.equal(g.join('x', 'Siebter'), -1);
    assert.equal(MAX_PLAYERS, 6);
    assert.ok(g.apply(1, { t: 'setRounds', n: 5 }).error);
    assert.ok(g.apply(0, { t: 'setRounds', n: 7 }).error, 'ungültige Rundenzahl');
    assert.ok(!g.apply(0, { t: 'setRounds', n: 5 }).error);
    assert.ok(!g.apply(0, { t: 'start' }, 1000).error);
    assert.equal(g.s.rounds, 5);
    assert.equal(g.join('spaet', 'Spät'), -1);
    assert.equal(g.join('b', 'B'), 1);
});

test('Zug: nur wer dran ist würfelt, Figur bewegt sich, Wartezeit, dann der Nächste', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const first = g.s.order[0];
    const second = g.s.order[1];
    assert.ok(g.apply(second, { t: 'roll' }, 100).error, 'nicht dran');
    assert.ok(!g.apply(first, { t: 'roll' }, 100).error);
    const d = g.s.dice;
    assert.ok(d.value >= 1 && d.value <= 6);
    assert.equal(g.s.players[first].pos, d.value % 28);
    assert.ok(g.apply(first, { t: 'roll' }, 200).error, 'nicht doppelt würfeln');
    assert.equal(g.tick(300), false, 'Figur ist noch unterwegs');
    assert.ok(g.tick(100 + 6 * 380 + 2300 + 10));
    assert.equal(g.s.turnIdx, 1);
    assert.equal(g.view(second, 5000).turnSeat, second);
});

test('Wer zu lange wartet oder offline ist, wird automatisch gewürfelt', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    g.tick(24000);
    assert.equal(g.s.dice, null);
    assert.ok(g.tick(25001));
    assert.ok(g.s.dice && g.s.dice.seat === seat);
    const h = newGame(3);
    h.apply(0, { t: 'start' }, 0);
    h.setConnected(h.s.order[0], false);
    assert.ok(h.tick(10));
    assert.ok(h.s.dice);
});

test('Felder: blau +3, rot −3 (nie unter 0), Münzen verändern sich wie vorgesehen', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    g.s.star = 20; // weit weg
    // Vor dem Wurf so setzen, dass ein blaues Feld erreicht wird
    p.pos = 0;
    g.rng = () => 0; // Wurf = 1 -> Feld 1 (blau)
    g.apply(seat, { t: 'roll' }, 0);
    assert.equal(p.pos, 1);
    assert.equal(p.coins, 5 + 3);
    g.s.turnPhase = 'roll';
    p.pos = 4;
    p.coins = 2;
    g.rng = () => 0.17; // Wurf = 2 -> Feld 6? (blau); setze für rot: Feld 5 = rot, Wurf 1
    g.rng = () => 0;
    g.apply(seat, { t: 'roll' }, 100); // 4 -> 5 (rot)
    assert.equal(p.pos, 5);
    assert.equal(p.coins, 0, 'nicht unter 0');
});

test('Stern: kaufen im Vorbeigehen für 5 Münzen, danach liegt er woanders; ohne Münzen kein Kauf', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    g.s.star = 3;
    p.pos = 1;
    p.coins = 6;
    g.rng = () => 0.99; // Wurf = 6 -> von 1 über Feld 3 bis 7
    g.apply(seat, { t: 'roll' }, 0);
    assert.equal(p.stars, 1);
    assert.ok(p.coins <= 6 - STAR_PRICE + 3, 'bezahlt');
    assert.notEqual(g.s.star, 3, 'Stern wandert');
    assert.ok(g.s.star > 0);
    // arm: kein Kauf
    const h = newGame(3);
    h.apply(0, { t: 'start' }, 0);
    const hs = h.s.order[0];
    const q = h.s.players[hs];
    h.s.star = 3;
    q.pos = 1;
    q.coins = 4;
    h.rng = () => 0;
    h.rng = () => 0.4; // Wurf = 3 -> Feld 4, über den Stern
    h.apply(hs, { t: 'roll' }, 0);
    assert.equal(q.stars, 0);
    assert.equal(h.s.star, 3);
});

test('Nach allen Zügen startet ein Minispiel, danach Belohnung und nächste Runde, die die Person nach der Letzten beginnt', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    let lastRoller = -1;
    for (let k = 0; k < 3; k++) {
        t += 100;
        lastRoller = g.s.order[g.s.turnIdx];
        g.apply(lastRoller, { t: 'roll' }, t);
        t += 6 * 380 + 2400;
        g.tick(t);
    }
    assert.equal(g.s.phase, 'mini');
    assert.equal(g.s.mini.phase, 'intro');
    t += INTRO_MS + 10;
    g.tick(t);
    assert.equal(g.s.mini.phase, 'play');
    // Ergebnis für alle melden (solo) oder Zeit ablaufen lassen
    t += 90000;
    for (let i = 0; i < 40 && g.s.mini.phase !== 'result'; i++) {
        g.tick(t);
        t += 20000;
    }
    assert.equal(g.s.mini.phase, 'result');
    assert.ok(g.s.mini.result.length === 3);
    t += RESULT_MS + 10;
    g.tick(t);
    assert.equal(g.s.phase, 'board');
    assert.equal(g.s.round, 2);
    assert.equal(g.s.order[0], (lastRoller + 1) % 3, 'nach der Letzten kommt die Nächste');
    assert.notEqual(g.s.order[0], lastRoller, 'niemand würfelt direkt zweimal hintereinander');
});

test('Sternrunde: jede dritte Runde und die letzte', () => {
    const g = newGame(3);
    g.s.rounds = 5;
    g.apply(0, { t: 'start' }, 0);
    const flags = [];
    for (let r = 1; r <= 5; r++) {
        g.s.round = r;
        flags.push(g.s.round % 3 === 0 || g.s.round === g.s.rounds);
    }
    assert.deepEqual(flags, [false, false, true, false, true]);
});

test('Komplettes Spiel: Wertung zählt Stern als 10 Münzen, Sieger, Revanche', () => {
    const g = newGame(3);
    g.apply(0, { t: 'setRounds', n: 5 });
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    for (let i = 0; i < 4000 && g.s.phase !== 'over'; i++) {
        t += 700;
        g.tick(t);
    }
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.round, 5);
    const rank = g.view(0, t).ranking;
    assert.equal(rank.length, 3);
    for (const r of rank) assert.equal(r.total, r.stars * 10 + r.coins);
    assert.ok(rank[0].total >= rank[1].total && rank[1].total >= rank[2].total);
    assert.ok(!g.apply(1, { t: 'rematch' }, t).error);
    assert.equal(g.s.phase, 'board');
    assert.equal(g.s.round, 1);
    for (const p of g.s.players) assert.deepEqual([p.coins, p.stars, p.pos], [5, 0, 0]);
});

test('Ansicht: kein Token, Lösung eines Quiz nicht sichtbar, Speichern/Wiederherstellen', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    assert.ok(!JSON.stringify(g.view(0, 0)).includes('"token"'));
    const copy = PartyGame.restore(g.serialize(), { rng: seeded(1) });
    assert.equal(copy.s.players[0].connected, false);
    assert.equal(copy.join('t0', 'x'), 0);
    // Wiederherstellen mitten im Minispiel: das Minispiel entfällt, es geht mit der nächsten Runde weiter
    g.s.phase = 'mini';
    g.s.mini = createMini({ type: 'quiz', id: 1, rng: seeded(2), players: g.s.players, now: 0, star: false });
    const r = PartyGame.restore(g.serialize(), { rng: seeded(1) });
    assert.equal(r.s.mini, null);
    r.tick(1000);
    assert.equal(r.s.phase, 'board');
});

// Spielt ein Spiel mit n Personen automatisch durch und liefert die Minispiel-Folge und die Würfelreihenfolge zurück.
function autoplay(n, rounds, seed) {
    const g = new PartyGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    g.s.rounds = rounds;
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    const types = [];
    const rollers = [];
    let lastMini = 0;
    for (let step = 0; step < 20000 && g.s.phase !== 'over'; step++) {
        t += 700;
        const s = g.s;
        if (s.phase === 'board' && s.turnPhase === 'roll') {
            rollers.push(s.order[s.turnIdx]);
            g.apply(s.order[s.turnIdx], { t: 'roll' }, t);
        }
        if (s.phase === 'mini' && s.mini && s.mini.id !== lastMini) {
            lastMini = s.mini.id;
            types.push(s.mini.type);
            rollers.push('mini');
        }
        g.tick(t);
    }
    assert.equal(g.s.phase, 'over');
    return { types, rollers };
}

test('Minispiele: erst läuft jedes einmal durch, dann beginnt ein neuer Durchlauf (kein Spiel doppelt hintereinander)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
        const { types } = autoplay(3, 30, seed);
        assert.equal(types.length, 30);
        assert.equal(new Set(types.slice(0, 14)).size, 14, `erster Durchlauf: ${types.slice(0, 14)}`);
        assert.equal(new Set(types.slice(14, 28)).size, 14, 'zweiter Durchlauf');
        assert.equal(types.length - 28, new Set(types.slice(28)).size, 'dritter Durchlauf beginnt ohne Wiederholung');
        for (let i = 1; i < types.length; i++) assert.notEqual(types[i], types[i - 1], 'nie dasselbe Spiel zweimal hintereinander');
    }
});

test('Zähler in der Ansicht: wie viele Minispiele im aktuellen Durchlauf schon dran waren', () => {
    const g = new PartyGame({ rng: seeded(3) });
    g.join('a', 'A');
    g.join('b', 'B');
    g.join('c', 'C');
    g.apply(0, { t: 'start' }, 0);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: 14 });
    let t = 0;
    for (let i = 0; i < 3000 && !g.s.mini; i++) {
        t += 700;
        if (g.s.phase === 'board' && g.s.turnPhase === 'roll') g.apply(g.s.order[g.s.turnIdx], { t: 'roll' }, t);
        g.tick(t);
    }
    assert.deepEqual(g.view(0, t).miniCycle, { done: 1, total: 14 });
});

test('Reihenfolge: mit 3 Personen und mehr würfelt niemand direkt zweimal hintereinander (auch über das Minispiel hinweg)', () => {
    for (const n of [3, 4, 6]) {
        const { rollers } = autoplay(n, 8, n);
        const seats = rollers.filter(r => r !== 'mini');
        for (let i = 1; i < seats.length; i++) assert.notEqual(seats[i], seats[i - 1], `${n} Personen: Wiederholung bei Wurf ${i}`);
        for (let i = 0; i < seats.length; i++) assert.equal(seats[i], i % n, 'immer dieselbe Reihenfolge');
    }
});

// ---------- Gesellschaftsspiele als Minispiele ----------

import { SUBGAMES } from '../js/games/party/subgames.js';

const SUB_TYPES = Object.keys(SUBGAMES);

function subAction(type, rng, n) {
    const pick = list => list[Math.floor(rng() * list.length)];
    const word = () => ['Haus', 'Baum', 'Hund', 'xyz', ''][Math.floor(rng() * 5)];
    const answers = () => Array.from({ length: 8 }, word);
    switch (type) {
        case 'liars': return pick([{ t: 'bid', qty: 1 + Math.floor(rng() * 8), face: 2 + Math.floor(rng() * 5) }, { t: 'challenge' }, { t: 'next' }]);
        case 'slf': return pick([{ t: 'answers', list: answers() }, { t: 'stop', list: answers() }, { t: 'flag', p: Math.floor(rng() * n), c: Math.floor(rng() * 4) }, { t: 'ready' }]);
        case 'undercover': return pick([{ t: 'ready' }, { t: 'clue', text: word() }, { t: 'vote', target: Math.floor(rng() * n) }, { t: 'guess', text: word() }]);
        case 'ladder': return pick([{ t: 'level', n: 1 + Math.floor(rng() * 10) }, { t: 'answer', c: Math.floor(rng() * 4) }, { t: 'ready' }]);
        default: return pick([{ t: 'guess', text: word() }, { t: 'ready' }]);
    }
}

// Spielt ein einzelnes Gesellschafts-Minispiel mit zufälligen Eingaben bis zum Ergebnis.
function playSub(type, n, star, seed) {
    const rng = seeded(seed);
    const players = Array.from({ length: n }, (_, i) => ({ name: 'S' + i, coins: 5, stars: 0, connected: true }));
    const m = createMini({ type, id: 1, rng: seeded(seed + 100), players, now: 0, star });
    assert.equal(m.kind, 'sub');
    let t = 0;
    for (let step = 0; step < 4000 && m.phase !== 'result'; step++) {
        t += 300 + Math.floor(rng() * 4000);
        if (rng() < 0.02) players[Math.floor(rng() * n)].connected = rng() < 0.5;
        if (m.phase === 'play') {
            const seat = Math.floor(rng() * n);
            const r = miniAction(m, seat, { kind: 'sub', a: subAction(type, rng, n) }, t, players);
            assert.ok(r.ok || r.error);
        }
        tickMini(m, t, players);
        for (let s = 0; s < n; s++) JSON.stringify(miniView(m, s, t, players));
    }
    assert.equal(m.phase, 'result', `${type} mit ${n} Personen endete nicht`);
    return m;
}

test('Gesellschaftsspiele als Minispiele: alle fünf laufen mit 3 bis 6 Personen immer bis zum Ergebnis', () => {
    assert.deepEqual(SUB_TYPES.sort(), ['ladder', 'liars', 'slf', 'undercover', 'wordguess']);
    for (const type of SUB_TYPES) {
        assert.equal(MINIS[type].kind, 'sub');
        assert.ok(MINI_TYPES.includes(type));
        for (let n = 3; n <= 6; n++) {
            for (let seed = 1; seed <= 6; seed++) {
                const m = playSub(type, n, seed % 2 === 0, seed * 10 + n);
                assert.equal(m.scores.length === undefined ? Object.keys(m.scores).length : m.scores.length, n);
                for (const v of Object.values(m.scores)) assert.ok(Number.isInteger(v) && v >= 0, `${type}: Punktzahl ${v}`);
                const rewards = computeRewards(m.scores, [...Array(n).keys()], m.star);
                assert.equal(rewards.length, n);
            }
        }
    }
});

test('Teams: nur bei geeigneten Spielen, ab 4 Personen, nicht in Sternrunden; Teammitglieder haben dieselbe Punktzahl', () => {
    for (const type of SUB_TYPES) {
        const can = SUBGAMES[type].teams;
        for (const n of [3, 4, 5, 6]) {
            const normal = playSub(type, n, false, 7 + n);
            const starRound = playSub(type, n, true, 9 + n);
            assert.equal(starRound.teams, null, 'Sternrunde: jede Person für sich');
            if (!can || n < 4) {
                assert.equal(normal.teams, null, `${type} mit ${n}: keine Teams`);
                continue;
            }
            const of = normal.teams.of;
            assert.equal(of.length, n);
            assert.ok(of.filter(x => x === 0).length >= 2 && of.filter(x => x === 1).length >= 2, 'jedes Team mindestens 2');
            for (let t = 0; t < 2; t++) {
                const vals = of.map((x, i) => (x === t ? normal.scores[i] : null)).filter(x => x !== null);
                assert.equal(new Set(vals).size, 1, `${type}: Team ${t} hat unterschiedliche Punkte`);
            }
            const v = miniView(normal, 0, 0, []);
            assert.deepEqual(v.teams.of, of);
            assert.equal(v.teamScores.length, 2);
        }
    }
});

test('Gesellschaftsspiel läuft nur mit erlaubten Aktionen; Start- und Neustart-Befehle von Mitspielern wirken nicht', () => {
    const players = Array.from({ length: 4 }, (_, i) => ({ name: 'S' + i, coins: 5, stars: 0, connected: true }));
    const m = createMini({ type: 'slf', id: 1, rng: seeded(5), players, now: 0, star: false });
    tickMini(m, 9000, players);
    assert.equal(m.phase, 'play');
    for (const bad of [{ t: 'start' }, { t: 'rematch' }, { t: 'teamMode', on: false }, { t: 'setRounds', n: 4 }, { t: 'team', team: 1 }]) {
        assert.ok(miniAction(m, 0, { kind: 'sub', a: bad }, 9100, players).error, JSON.stringify(bad));
    }
    assert.ok(miniAction(m, 0, { kind: 'score', score: 5 }, 9100, players).error);
    assert.ok(!miniAction(m, 0, { kind: 'sub', a: { t: 'answers', list: ['A'] } }, 9100, players).error);
});

test('Ansicht der Gesellschaftsspiele: fremde Geheimnisse bleiben verdeckt', () => {
    const players = Array.from({ length: 4 }, (_, i) => ({ name: 'S' + i, coins: 5, stars: 0, connected: true }));
    // Lügenwürfel: fremde Würfel nicht sichtbar
    const liars = createMini({ type: 'liars', id: 1, rng: seeded(1), players, now: 0, star: false });
    tickMini(liars, 9000, players);
    const lv = miniView(liars, 0, 9000, players).sub;
    assert.equal(lv.hand.length, 3);
    assert.ok(!JSON.stringify(lv).includes('"hands"'));
    // Undercover: das Wort der Anderen steht nicht in der eigenen Ansicht
    const uc = createMini({ type: 'undercover', id: 2, rng: seeded(2), players, now: 0, star: false });
    tickMini(uc, 9000, players);
    const eng = uc.engine;
    const other = eng.s.imp === 0 ? eng.s.word : eng.s.word2;
    if (eng.s.mode !== 'spy' || eng.s.imp !== 0) assert.ok(!JSON.stringify(miniView(uc, 0, 9000, players).sub).includes(`"${other}"`));
    // Die Engine gehört nicht zum gespeicherten Zustand
    assert.ok(!JSON.stringify(uc).includes('"hands"') && !JSON.stringify(liars).includes('"hands"'));
    // Vor dem Start der Spielphase gibt es keine Unter-Ansicht
    const early = createMini({ type: 'ladder', id: 3, rng: seeded(3), players, now: 0, star: false });
    assert.equal(miniView(early, 0, 0, players).sub, null);
});

test('Belohnung bei Teams: das bessere Team bekommt Platz 1 (10), das andere Platz 2 (6)', () => {
    const scores = { 0: 27, 1: 15, 2: 15, 3: 27, 4: 27 };
    const r = computeRewards(scores, [0, 1, 2, 3, 4], false, true);
    assert.deepEqual(r.filter(x => x.score === 27).map(x => [x.rank, x.coins]), [[1, 10], [1, 10], [1, 10]]);
    assert.deepEqual(r.filter(x => x.score === 15).map(x => [x.rank, x.coins]), [[2, 6], [2, 6]]);
    // ohne Teams bleibt es bei der normalen Platzierung
    assert.deepEqual(computeRewards(scores, [0, 1, 2, 3, 4], false).filter(x => x.score === 15).map(x => x.rank), [4, 4]);
});

// ---------- Zu zweit ----------

test('Zu zweit: Sternenjagd startet mit 2 Personen, Undercover kommt nie vor, die anderen 13 Minispiele laufen im Kreis', () => {
    const g = new PartyGame({ rng: seeded(4) });
    g.join('a', 'A');
    assert.ok(g.apply(0, { t: 'start' }).error, 'allein geht nicht');
    g.join('b', 'B');
    assert.ok(!g.apply(0, { t: 'start' }, 0).error);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: 13 });
    for (const seed of [1, 2, 3]) {
        const { types } = autoplay(2, 27, seed);
        assert.ok(!types.includes('undercover'));
        assert.equal(new Set(types.slice(0, 13)).size, 13);
        assert.equal(new Set(types.slice(13, 26)).size, 13);
        for (let i = 1; i < types.length; i++) assert.notEqual(types[i], types[i - 1]);
    }
});

test('Zu zweit: alle Gesellschafts-Minispiele außer Undercover laufen mit 2 Personen bis zum Ergebnis, ohne Teams', () => {
    assert.equal(MINIS.undercover.minPlayers, 3);
    for (const type of SUB_TYPES.filter(t => t !== 'undercover')) {
        for (const seed of [1, 2, 3, 4]) {
            const m = playSub(type, 2, seed % 2 === 0, seed);
            assert.equal(m.teams, null);
            for (const v of Object.values(m.scores)) assert.ok(Number.isInteger(v) && v >= 0);
        }
    }
});

test('Mit 3 Personen ist Undercover wieder dabei (14 Minispiele)', () => {
    const g = new PartyGame({ rng: seeded(4) });
    for (const n of ['a', 'b', 'c']) g.join(n, n);
    g.apply(0, { t: 'start' }, 0);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: 14 });
});
