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
    const g = newGame(2);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    g.tick(24000);
    assert.equal(g.s.dice, null);
    assert.ok(g.tick(25001));
    assert.ok(g.s.dice && g.s.dice.seat === seat);
    const h = newGame(2);
    h.apply(0, { t: 'start' }, 0);
    h.setConnected(h.s.order[0], false);
    assert.ok(h.tick(10));
    assert.ok(h.s.dice);
});

test('Felder: blau +3, rot −3 (nie unter 0), Münzen verändern sich wie vorgesehen', () => {
    const g = newGame(2);
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
    const g = newGame(2);
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
    const h = newGame(2);
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

test('Nach allen Zügen startet ein Minispiel, danach Belohnung und nächste Runde mit anderer Startperson', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    const firstStarter = g.s.order[0];
    for (let k = 0; k < 3; k++) {
        t += 100;
        g.apply(g.s.order[g.s.turnIdx], { t: 'roll' }, t);
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
    assert.notEqual(g.s.order[0], firstStarter, 'Startperson wechselt');
});

test('Sternrunde: jede dritte Runde und die letzte', () => {
    const g = newGame(2);
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
    const g = newGame(2);
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
