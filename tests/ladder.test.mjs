import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, MAX_LEVEL } from '../js/games/ladder/questions.js';
import { LadderGame, CHOOSE_MS, ANSWER_MS, REVEAL_MS } from '../js/games/ladder/engine.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 3, seed = 3) {
    const g = new LadderGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    return g;
}

test('Fragen: 6 Kategorien mit je 10 Stufen, mindestens 4 Fragen pro Stufe, vollständige Daten', () => {
    assert.equal(MAX_LEVEL, 10);
    assert.equal(CATEGORIES.length, 6);
    let total = 0;
    const questions = new Set();
    for (const cat of CATEGORIES) {
        assert.equal(cat.levels.length, 10, cat.name);
        cat.levels.forEach((qs, li) => {
            assert.ok(qs.length >= 4, `${cat.name} Stufe ${li + 1}: nur ${qs.length} Fragen`);
            for (const [q, ...answers] of qs) {
                total++;
                assert.equal(answers.length, 4, q);
                assert.equal(new Set(answers).size, 4, `doppelte Antworten: ${q}`);
                assert.ok(q.trim().endsWith('?'), q);
                assert.ok(!questions.has(q), `doppelte Frage: ${q}`);
                questions.add(q);
                for (const a of answers) assert.ok(String(a).trim(), q);
            }
        });
    }
    assert.ok(total >= 290, `nur ${total} Fragen`);
});

test('Start: ab 3 Personen, Wahlphase mit Kategorie, Einstellungen nur vom Host', () => {
    const g = room(2);
    g.join('x', 'X');
    assert.ok(g.apply(1, { t: 'setRounds', n: 6 }).error);
    assert.ok(!g.apply(0, { t: 'setRounds', n: 6 }).error);
    assert.ok(g.apply(0, { t: 'setRounds', n: 7 }).error);
    assert.ok(!g.apply(0, { t: 'start' }, 0).error);
    assert.equal(g.s.phase, 'choose');
    assert.ok(g.view(0, 0).category.name);
});

test('Stufenwahl: ungültige Werte werden abgelehnt, Wahl bleibt bis alle gewählt haben änderbar und geheim', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    assert.ok(g.apply(0, { t: 'level', n: 0 }, 0).error);
    assert.ok(g.apply(0, { t: 'level', n: 11 }, 0).error);
    assert.ok(g.apply(0, { t: 'level', n: 2.5 }, 0).error);
    assert.ok(!g.apply(0, { t: 'level', n: 9 }, 0).error);
    assert.ok(!g.apply(0, { t: 'level', n: 4 }, 0).error, 'ändern');
    const v1 = g.view(1, 0);
    assert.equal(v1.myChoice, 0);
    assert.deepEqual(v1.chosen, [true, false, false]);
    assert.ok(!JSON.stringify(v1).includes('"choices"'));
    assert.ok(!g.apply(1, { t: 'level', n: 10 }, 0).error);
    assert.equal(g.s.phase, 'choose');
    assert.ok(!g.apply(2, { t: 'level', n: 1 }, 0).error);
    assert.equal(g.s.phase, 'answer');
    assert.deepEqual(g.s.choices, [4, 10, 1]);
});

test('Antwortphase: jeder bekommt eine Frage seiner Stufe, die richtige Antwort bleibt geheim', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    [3, 7, 10].forEach((n, i) => g.apply(i, { t: 'level', n }, 0));
    assert.equal(g.s.phase, 'answer');
    for (let seat = 0; seat < 3; seat++) {
        const v = g.view(seat, 0);
        assert.equal(v.myQuestion.level, [3, 7, 10][seat]);
        assert.equal(v.myQuestion.opts.length, 4);
        assert.deepEqual(v.levels, [3, 7, 10]);
        const json = JSON.stringify(v);
        assert.ok(!json.includes('"right"'), 'richtige Antwort in der Ansicht');
        // Fragen der anderen sehe ich nicht
        for (let other = 0; other < 3; other++) if (other !== seat) assert.ok(!json.includes(g.s.questions[other].text));
    }
    const ids = g.s.questions.map(q => q.id);
    assert.equal(new Set(ids).size, 3);
});

test('Punkte: richtig = Stufe, falsch oder keine Antwort = 0; nur ein Versuch', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    [3, 7, 10].forEach((n, i) => g.apply(i, { t: 'level', n }, 0));
    const q = g.s.questions;
    assert.ok(g.apply(0, { t: 'answer', c: 5 }, 0).error);
    assert.ok(!g.apply(0, { t: 'answer', c: q[0].right }, 0).error);
    assert.ok(g.apply(0, { t: 'answer', c: q[0].right }, 0).error, 'nur einmal');
    assert.ok(!g.apply(1, { t: 'answer', c: (q[1].right + 1) % 4 }, 0).error);
    assert.equal(g.s.phase, 'answer', 'Person 2 hat nicht geantwortet');
    g.tick(ANSWER_MS);
    assert.equal(g.s.phase, 'reveal');
    assert.deepEqual(g.s.totals, [3, 0, 0]);
    assert.deepEqual(g.s.reveal.map(r => r.gain), [3, 0, 0]);
    assert.equal(g.s.reveal[2].answer, -1);
    const v = g.view(0, 0);
    assert.equal(v.reveal[1].opts[v.reveal[1].right].length > 0, true);
});

test('Ablauf: Wahl-Zeit läuft ab (Standard Stufe 1), Auflösung wartet auf alle oder die Zeit', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    g.apply(0, { t: 'level', n: 8 }, 0);
    assert.equal(g.tick(CHOOSE_MS - 1), false);
    assert.equal(g.tick(CHOOSE_MS), true);
    assert.equal(g.s.phase, 'answer');
    assert.deepEqual(g.s.choices, [8, 1, 1]);
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'answer', c: 0 }, CHOOSE_MS);
    assert.equal(g.s.phase, 'reveal');
    assert.ok(g.apply(5, { t: 'ready' }, 0).error, 'unbekannter Platz');
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'ready' }, CHOOSE_MS + 100);
    assert.equal(g.s.phase, 'choose');
    assert.equal(g.s.round, 2);
    assert.equal(g.tick(CHOOSE_MS + 100 + CHOOSE_MS), true);
});

test('Kategorien wechseln, bevor sich eine wiederholt', () => {
    const g = room(3);
    g.apply(0, { t: 'setRounds', n: 6 });
    g.apply(0, { t: 'start' }, 0);
    const cats = [g.s.cat];
    let t = 0;
    for (let r = 1; r < 6; r++) {
        for (let i = 0; i < 3; i++) g.apply(i, { t: 'level', n: 1 }, t);
        for (let i = 0; i < 3; i++) g.apply(i, { t: 'answer', c: 0 }, t);
        for (let i = 0; i < 3; i++) g.apply(i, { t: 'ready' }, t);
        cats.push(g.s.cat);
    }
    assert.equal(new Set(cats).size, 6, `Kategorien: ${cats}`);
});

test('Fragen wiederholen sich im Spiel nicht, solange es noch frische gibt', () => {
    const g = room(6, 9);
    g.apply(0, { t: 'setRounds', n: 12 });
    g.apply(0, { t: 'start' }, 0);
    const seen = [];
    for (let r = 0; r < 12; r++) {
        for (let i = 0; i < 6; i++) g.apply(i, { t: 'level', n: 5 }, 0); // alle wählen dieselbe Stufe
        seen.push(...g.s.questions.map(q => q.id));
        for (let i = 0; i < 6; i++) g.apply(i, { t: 'answer', c: 1 }, 0);
        for (let i = 0; i < 6; i++) g.apply(i, { t: 'ready' }, 0);
    }
    assert.equal(new Set(seen).size, seen.length, 'Frage doppelt gestellt');
    assert.equal(g.s.phase, 'over');
});

test('Teams: Wertung nach Teamsumme, Teamwahl wie im Warteraum', () => {
    const g = room(4);
    assert.ok(!g.apply(0, { t: 'teamMode', on: true }).error);
    g.s.players.forEach((p, i) => (p.team = i < 2 ? 0 : 1));
    assert.ok(!g.apply(0, { t: 'setRounds', n: 6 }).error);
    g.apply(0, { t: 'start' }, 0);
    for (let i = 0; i < 4; i++) g.apply(i, { t: 'level', n: 5 }, 0);
    const q = g.s.questions;
    g.apply(0, { t: 'answer', c: q[0].right }, 0);
    g.apply(1, { t: 'answer', c: q[1].right }, 0);
    g.apply(2, { t: 'answer', c: (q[2].right + 1) % 4 }, 0);
    g.apply(3, { t: 'answer', c: q[3].right }, 0);
    const st = g.standings(i => g.s.totals[i]);
    assert.deepEqual(st.teams.map(t => [t.team, t.score]), [[0, 10], [1, 5]]);
});

test('Neustart nach Spielende und Wiederherstellen', () => {
    const g = room(3);
    g.apply(0, { t: 'setRounds', n: 6 });
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    for (let r = 0; r < 6; r++) {
        t += CHOOSE_MS + ANSWER_MS + REVEAL_MS + 10;
        g.tick(CHOOSE_MS);
        g.tick(CHOOSE_MS + ANSWER_MS);
        g.tick(CHOOSE_MS + ANSWER_MS + REVEAL_MS);
        // Die Zeiten werden relativ zur Tick-Zeit gesetzt: deshalb mit wachsender Uhr weitertickern
        let now = (r + 1) * 1000000;
        for (let k = 0; k < 4 && g.s.phase !== 'over'; k++) {
            now += 100000;
            g.tick(now);
        }
        if (g.s.phase === 'over') break;
    }
    assert.equal(g.s.phase, 'over');
    assert.ok(!g.apply(1, { t: 'rematch' }, 0).error);
    assert.equal(g.s.phase, 'choose');
    assert.deepEqual(g.s.totals, [0, 0, 0]);
    const copy = LadderGame.restore(g.serialize());
    assert.equal(copy.s.phase, 'choose');
    assert.ok(copy.s.deadline > Date.now());
});

test('Zufallsspiele laufen immer bis zum Ende', () => {
    for (let seed = 1; seed <= 100; seed++) {
        const rng = seeded(seed * 17);
        const n = 3 + Math.floor(rng() * 4);
        const g = room(n, seed);
        if (n >= 4 && seed % 2) g.apply(0, { t: 'teamMode', on: true });
        g.apply(0, { t: 'setRounds', n: 6 });
        assert.ok(!g.apply(0, { t: 'start' }, 0).error);
        let t = 0;
        for (let step = 0; step < 2000 && g.s.phase !== 'over'; step++) {
            t += 300 + Math.floor(rng() * 12000);
            const s = g.s;
            const seat = Math.floor(rng() * n);
            if (rng() < 0.03) g.setConnected(seat, rng() < 0.5);
            if (s.phase === 'choose') g.apply(seat, { t: 'level', n: 1 + Math.floor(rng() * 10) }, t);
            else if (s.phase === 'answer') g.apply(seat, { t: 'answer', c: Math.floor(rng() * 4) }, t);
            else if (s.phase === 'reveal') g.apply(seat, { t: 'ready' }, t);
            g.tick(t);
            assert.ok(s.totals.every(x => Number.isInteger(x) && x >= 0));
            for (let q = 0; q < n; q++) JSON.stringify(g.view(q, t));
        }
        assert.equal(g.s.phase, 'over', `Seed ${seed}`);
        assert.equal(g.s.round, 6);
    }
});
