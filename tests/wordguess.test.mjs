import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, HINTS_PER_WORD } from '../js/games/wordguess/words.js';
import { WordGuessGame, HINT_MS, FINAL_MS, REVEAL_MS, TRIES_PER_HINT } from '../js/games/wordguess/engine.js';
import { normalize } from '../js/games/songquiz/answer.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 3, seed = 3) {
    const g = new WordGuessGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    return g;
}

test('Begriffe: genug, eindeutig, je 6 Hinweise, Hinweise verraten die Lösung nicht', () => {
    assert.ok(WORDS.length >= 90, `nur ${WORDS.length}`);
    assert.equal(HINTS_PER_WORD, 6);
    const seen = new Set();
    for (const [solution, ...hints] of WORDS) {
        assert.equal(hints.length, 6, solution);
        const keys = solution.split('|');
        for (const k of keys) {
            assert.ok(!seen.has(normalize(k)), `doppelt: ${k}`);
            seen.add(normalize(k));
        }
        assert.equal(new Set(hints.map(normalize)).size, 6, `doppelte Hinweise bei ${solution}`);
        for (const h of hints) {
            assert.ok(h.trim(), solution);
            for (const k of keys) if (normalize(k).length >= 4) assert.ok(!normalize(h).includes(normalize(k)), `Hinweis „${h}“ verrät „${k}“`);
        }
    }
});

test('Start, Hinweise erscheinen nach und nach, Lösung bleibt verdeckt', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    assert.equal(g.s.phase, 'play');
    assert.equal(g.view(0, 0).hints.length, 1);
    assert.equal(g.tick(HINT_MS - 1), false);
    assert.equal(g.tick(HINT_MS), true);
    assert.equal(g.view(1, HINT_MS).hints.length, 2);
    const json = JSON.stringify(g.view(2, HINT_MS));
    assert.ok(!json.includes(g.s.word.solution) || g.s.word.hints.some(h => h.includes(g.s.word.solution)), 'Lösung in der Ansicht');
    assert.equal(g.view(2, HINT_MS).solution, null);
    let t = HINT_MS;
    for (let k = 3; k <= 6; k++) {
        t += HINT_MS;
        g.tick(t);
        assert.equal(g.s.shown, k);
    }
    assert.equal(g.s.phase, 'play');
    t += FINAL_MS;
    g.tick(t);
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.view(0, t).hints.length, 6);
    assert.ok(g.view(0, t).solution);
});

function solve(g, seat, now, text) {
    return g.apply(seat, { t: 'guess', text: text ?? g.s.word.solution }, now);
}

test('Punkte: früher raten gibt mehr, die ersten beiden bekommen einen Bonus', () => {
    const g = room(4);
    g.apply(0, { t: 'start' }, 0);
    const r1 = solve(g, 0, 100);
    assert.ok(!r1.error);
    assert.match(r1.notice, /Richtig/);
    assert.equal(g.s.gain[0], 12 + 3);
    g.tick(HINT_MS);
    g.tick(HINT_MS * 2);
    assert.equal(g.s.shown, 3);
    solve(g, 1, HINT_MS * 2);
    assert.equal(g.s.gain[1], 8 + 1);
    solve(g, 2, HINT_MS * 2 + 1);
    assert.equal(g.s.gain[2], 8, 'kein Bonus mehr');
    assert.deepEqual(g.s.totals.slice(0, 3), [15, 9, 8]);
    assert.ok(solve(g, 2, HINT_MS * 2 + 2).error, 'schon gelöst');
    assert.equal(g.s.phase, 'play', 'Spieler 4 fehlt noch');
    solve(g, 3, HINT_MS * 2 + 3);
    assert.equal(g.s.phase, 'reveal', 'alle haben es');
});

test('Rateversuche: schreibfehlertolerant, Groß/Klein egal, begrenzt pro Hinweis, werden mit neuem Hinweis zurückgesetzt', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const word = g.s.word.solution;
    const wrong = solve(g, 0, 1, 'völlig falsch');
    assert.ok(!wrong.error);
    assert.match(wrong.notice, /falsch/);
    assert.equal(g.s.gain[0], 0);
    assert.ok(!solve(g, 0, 2, 'noch falsch').error);
    assert.ok(solve(g, 0, 3, word).error, 'keine Versuche mehr');
    assert.equal(g.view(0, 3).triesLeft, 0);
    g.tick(HINT_MS);
    assert.equal(g.view(0, HINT_MS).triesLeft, TRIES_PER_HINT);
    assert.ok(!solve(g, 0, HINT_MS, word.toUpperCase()).error);
    assert.ok(g.s.solved[0]);
    assert.ok(solve(g, 1, HINT_MS, '').error, 'leerer Tipp');
    // falsche Tipps sieht jede Person, richtige Tipps nicht im Wortlaut
    const feed = g.view(2, HINT_MS).guesses;
    assert.ok(feed.some(x => x.text === 'völlig falsch'));
    assert.ok(feed.every(x => !x.ok || x.text === ''));
});

test('Tippfehler: ein Buchstabe daneben wird akzeptiert', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    g.s.word = { solution: 'Schmetterling', keys: ['schmetterling', 'falter'], hints: g.s.word.hints };
    assert.ok(!solve(g, 0, 1, 'Schmeterling').error);
    assert.ok(g.s.solved[0]);
    g.s.word.keys = ['uhr'];
    assert.ok(!solve(g, 1, 1, 'uhh').error);
    assert.ok(!g.s.solved[1], 'bei kurzen Wörtern keine Toleranz');
});

test('Ablauf: Reveal wartet auf Bereit oder Zeit, danach nächster Begriff ohne Wiederholung', () => {
    const g = room(3);
    g.apply(0, { t: 'setRounds', n: 8 });
    g.apply(0, { t: 'start' }, 0);
    const first = g.s.word.solution;
    for (let i = 0; i < 3; i++) solve(g, i, 10);
    assert.equal(g.s.phase, 'reveal');
    for (let i = 0; i < 2; i++) g.apply(i, { t: 'ready' }, 20);
    assert.equal(g.s.phase, 'reveal');
    g.tick(10 + REVEAL_MS);
    assert.equal(g.s.phase, 'play');
    assert.equal(g.s.round, 2);
    assert.notEqual(g.s.word.solution, first);
});

test('Ganzes Spiel mit 8 Begriffen: Ende, Wertung, Neustart behält keine Punkte', () => {
    const g = room(3);
    g.apply(0, { t: 'setRounds', n: 8 });
    g.apply(0, { t: 'start' }, 0);
    const solutions = [];
    for (let r = 1; r <= 8; r++) {
        assert.equal(g.s.round, r);
        solutions.push(g.s.word.solution);
        solve(g, 0, 10);
        solve(g, 1, 10);
        solve(g, 2, 10);
        for (let i = 0; i < 3; i++) g.apply(i, { t: 'ready' }, 20);
    }
    assert.equal(g.s.phase, 'over');
    assert.equal(new Set(solutions).size, 8);
    assert.ok(g.s.totals[0] > g.s.totals[2]);
    assert.ok(!g.apply(0, { t: 'rematch' }, 0).error);
    assert.deepEqual(g.s.totals, [0, 0, 0]);
});

test('Teams: ein Treffer macht das ganze Team fertig, Punkte zählen für das Team', () => {
    const g = room(4);
    g.apply(0, { t: 'teamMode', on: true });
    g.s.players.forEach((p, i) => (p.team = i < 2 ? 0 : 1));
    g.apply(0, { t: 'start' }, 0);
    solve(g, 0, 5);
    assert.ok(g.s.solved[0] && g.s.solved[1], 'Teampartner ist mit fertig');
    assert.ok(!g.s.solved[2]);
    assert.equal(g.s.gain[1], 0);
    assert.ok(solve(g, 1, 6).error, 'Partner muss nicht mehr raten');
    solve(g, 3, 7);
    assert.equal(g.s.phase, 'reveal');
    const st = g.standings(i => g.s.totals[i]);
    assert.deepEqual(st.teams.map(t => [t.team, t.score]), [[0, 15], [1, 13]]);
    assert.equal(g.s.gain[3], 12 + 1, 'zweites Team bekommt den zweiten Bonus');
});

test('Wiederherstellen: laufender Begriff beginnt neu', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const copy = WordGuessGame.restore(g.serialize());
    assert.equal(copy.s.phase, 'play');
    assert.equal(copy.s.round, 1);
    assert.ok(copy.s.nextAt > Date.now());
});

test('Zufallsspiele laufen immer bis zum Ende', () => {
    for (let seed = 1; seed <= 100; seed++) {
        const rng = seeded(seed * 19);
        const n = 3 + Math.floor(rng() * 4);
        const g = room(n, seed);
        if (n >= 4 && seed % 2) g.apply(0, { t: 'teamMode', on: true });
        g.apply(0, { t: 'setRounds', n: 8 });
        assert.ok(!g.apply(0, { t: 'start' }, 0).error);
        let t = 0;
        for (let step = 0; step < 4000 && g.s.phase !== 'over'; step++) {
            t += 300 + Math.floor(rng() * 9000);
            const s = g.s;
            const seat = Math.floor(rng() * n);
            if (rng() < 0.03) g.setConnected(seat, rng() < 0.5);
            if (s.phase === 'play') g.apply(seat, { t: 'guess', text: rng() < 0.15 ? s.word.solution : ['x', 'Haus', ''][Math.floor(rng() * 3)] }, t);
            else if (s.phase === 'reveal') g.apply(seat, { t: 'ready' }, t);
            g.tick(t);
            assert.ok(s.totals.every(x => Number.isInteger(x) && x >= 0));
            for (let q = 0; q < n; q++) JSON.stringify(g.view(q, t));
        }
        assert.equal(g.s.phase, 'over', `Seed ${seed}`);
    }
});
