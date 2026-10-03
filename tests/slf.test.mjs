import test from 'node:test';
import assert from 'node:assert/strict';
import { SlfGame, normalizeAnswer, startsWithLetter, WRITE_MS, STOP_MS, GRACE_MS, REVIEW_MS, LETTERS, CATEGORIES } from '../js/games/slf/engine.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 3, seed = 3) {
    const g = new SlfGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    return g;
}

const cats = g => g.s.categories.length;

// Füllt alle Kategorien mit Wörtern, die zum Buchstaben passen
function fill(g, seat, words) {
    const L = g.s.letter;
    const list = g.s.categories.map((_, i) => (words?.[i] ?? `${L}wort${seat}x${i}`));
    return list;
}

test('Normalisieren: Groß/Klein, Umlaute, Akzente und Sonderzeichen', () => {
    assert.equal(normalizeAnswer('  Éclair '), 'eclair');
    assert.equal(normalizeAnswer('Österreich'), 'oesterreich');
    assert.equal(normalizeAnswer('Groß-Gerau'), 'gross gerau');
    assert.ok(startsWithLetter('Berlin', 'B'));
    assert.ok(startsWithLetter('berlin', 'B'));
    assert.ok(!startsWithLetter('Hamburg', 'B'));
    assert.ok(startsWithLetter('Österreich', 'O'));
    assert.ok(!startsWithLetter('', 'B'));
});

test('Buchstaben: keine schwierigen Buchstaben, keine Dopplungen innerhalb einer Runde', () => {
    assert.equal(new Set(LETTERS).size, LETTERS.length);
    for (const bad of 'XYQCJV') assert.ok(!LETTERS.includes(bad));
    assert.ok(CATEGORIES.length >= 10);
});

test('Start: Standardkategorien, Einstellungen nur für den Host und nur im Warteraum', () => {
    const g = room(3);
    assert.equal(cats(g), 6);
    assert.ok(g.apply(1, { t: 'setRounds', n: 4 }).error);
    assert.ok(!g.apply(0, { t: 'setRounds', n: 4 }).error);
    assert.ok(g.apply(0, { t: 'setRounds', n: 3 }).error);
    assert.ok(!g.apply(0, { t: 'toggleCat', i: 6 }).error);
    assert.equal(cats(g), 7);
    for (let i = 0; i < 6; i++) g.apply(0, { t: 'toggleCat', i });
    assert.equal(cats(g), 3, 'mindestens 3');
    assert.ok(!g.apply(0, { t: 'toggleCat', i: 7 }).error);
    assert.equal(cats(g), 4);
    assert.ok(!g.apply(0, { t: 'start' }, 0).error);
    assert.equal(g.s.phase, 'write');
    assert.ok(g.apply(0, { t: 'toggleCat', i: 0 }).error, 'nicht mehr während des Spiels');
});

test('Antworten: werden gespeichert, gekürzt und nach Ablauf nicht mehr angenommen', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const L = g.s.letter;
    assert.ok(!g.apply(1, { t: 'answers', list: [`${L}  a`, 'x'.repeat(100)] }, 1000).error);
    assert.equal(g.s.answers[1][0], `${L} a`);
    assert.equal(g.s.answers[1][1].length, 40);
    assert.equal(g.s.answers[1].length, 6);
    assert.ok(g.apply(1, { t: 'answers', list: 'nope' }, 1000).error);
    assert.ok(g.apply(1, { t: 'answers', list: [] }, WRITE_MS + GRACE_MS + 5).error);
});

test('Stopp: nur mit allen Kategorien, einmal, danach läuft die Restzeit', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    assert.ok(g.apply(0, { t: 'stop', list: ['a'] }, 100).error, 'unvollständig');
    assert.ok(!g.apply(0, { t: 'stop', list: fill(g, 0) }, 100).error);
    assert.equal(g.s.stopper, 0);
    assert.equal(g.s.writeEnd, 100 + STOP_MS);
    assert.ok(g.apply(1, { t: 'stop', list: fill(g, 1) }, 200).error, 'nur einmal');
    assert.equal(g.tick(100 + STOP_MS), false, 'Spielraum für nachlaufende Antworten');
    assert.equal(g.tick(100 + STOP_MS + GRACE_MS), true);
    assert.equal(g.s.phase, 'review');
});

test('Zeitlimit ohne Stopp: die Schreibphase endet von selbst', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    assert.equal(g.tick(WRITE_MS), false);
    assert.equal(g.tick(WRITE_MS + GRACE_MS), true);
    assert.equal(g.s.phase, 'review');
});

function toReview(g, answers) {
    g.apply(0, { t: 'start' }, 0);
    answers.forEach((list, seat) => g.apply(seat, { t: 'answers', list }, 10));
    g.tick(WRITE_MS + GRACE_MS);
    assert.equal(g.s.phase, 'review');
}

test('Punkte: 20 allein, 10 einzigartig, 5 gleich, 0 leer oder falscher Buchstabe', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const L = g.s.letter;
    const l = L.toLowerCase();
    const k = cats(g);
    const blank = () => Array(k).fill('');
    const a = blank(), b = blank(), c = blank();
    a[0] = `${L}ax`; b[0] = `${L}bx`; c[0] = `${L}ax`; // a und c gleich, b einzigartig
    a[1] = `${L}solo`; // nur a
    b[2] = `Z${l}falsch`; // falscher Anfangsbuchstabe (L ist nie Z-Wort... außer L='Z')
    c[3] = `${L}ein`; b[3] = `${l}EIN`; // Groß/Kleinschreibung zählt nicht: gleich
    a.forEach((_, i) => {});
    [a, b, c].forEach((list, seat) => g.apply(seat, { t: 'answers', list }, 10));
    g.tick(WRITE_MS + GRACE_MS);
    const p = g.score();
    assert.equal(p[0][0], 5);
    assert.equal(p[2][0], 5);
    assert.equal(p[1][0], 10);
    assert.equal(p[0][1], 20);
    assert.equal(p[0][2], 0);
    if (L !== 'Z') assert.equal(p[1][2], 0);
    assert.equal(p[1][3], 5);
    assert.equal(p[2][3], 5);
    assert.equal(p[0][3], 0);
});

test('Anzweifeln: bei Mehrheit der anderen zählt die Antwort nicht, Umschalten nimmt es zurück', () => {
    const g = room(4);
    g.apply(0, { t: 'start' }, 0);
    const L = g.s.letter;
    const lists = [0, 1, 2, 3].map(seat => g.s.categories.map((_, i) => `${L}x${seat}${i}`));
    lists.forEach((list, seat) => g.apply(seat, { t: 'answers', list }, 5));
    assert.ok(g.apply(1, { t: 'flag', p: 0, c: 0 }).error, 'noch in der Schreibphase');
    g.tick(WRITE_MS + GRACE_MS);
    assert.ok(g.apply(0, { t: 'flag', p: 0, c: 0 }).error, 'nicht die eigene');
    assert.ok(!g.apply(1, { t: 'flag', p: 0, c: 0 }).error);
    assert.ok(g.isValid(0, 0), 'eine von drei Stimmen reicht nicht');
    assert.ok(!g.apply(2, { t: 'flag', p: 0, c: 0 }).error);
    assert.ok(!g.isValid(0, 0), 'zwei von drei sind die Mehrheit');
    assert.equal(g.score()[0][0], 0);
    assert.ok(!g.apply(2, { t: 'flag', p: 0, c: 0 }).error, 'zurücknehmen');
    assert.ok(g.isValid(0, 0));
    assert.ok(g.apply(1, { t: 'flag', p: 9, c: 0 }).error);
});

test('Auswertung: alle bereit → nächste Runde mit neuem Buchstaben, Punkte werden addiert', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const first = g.s.letter;
    const lists = [0, 1, 2].map(seat => g.s.categories.map((_, i) => `${first}x${seat}${i}`));
    lists.forEach((list, seat) => g.apply(seat, { t: 'answers', list }, 5));
    g.tick(WRITE_MS + GRACE_MS);
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'ready' }, WRITE_MS + 5000);
    assert.equal(g.s.phase, 'write');
    assert.equal(g.s.round, 2);
    assert.notEqual(g.s.letter, first);
    assert.deepEqual(g.s.totals, [60, 60, 60]);
});

test('Auswertung endet auch ohne Bereit-Meldungen nach der Zeit', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    g.tick(WRITE_MS + GRACE_MS);
    const t = WRITE_MS + GRACE_MS;
    assert.equal(g.tick(t + REVIEW_MS - 1), false);
    assert.equal(g.tick(t + REVIEW_MS), true);
    assert.equal(g.s.round, 2);
});

test('Teams: gleiche Antworten im selben Team zählen als eine, Teamsumme in der Wertung', () => {
    const g = room(4);
    assert.ok(g.apply(1, { t: 'teamMode', on: true }).error, 'nur der Host');
    assert.ok(!g.apply(0, { t: 'teamMode', on: true }).error);
    // Team 0 = Plätze 0 und 1, Team 1 = Plätze 2 und 3
    g.s.players.forEach((p, i) => (p.team = i < 2 ? 0 : 1));
    g.apply(0, { t: 'start' }, 0);
    const L = g.s.letter;
    const k = cats(g);
    const mk = (first, second) => Array.from({ length: k }, (_, i) => (i === 0 ? first : i === 1 ? second : ''));
    g.apply(0, { t: 'answers', list: mk(`${L}gleich`, `${L}eins`) }, 5);
    g.apply(1, { t: 'answers', list: mk(`${L}gleich`, '') }, 5);
    g.apply(2, { t: 'answers', list: mk(`${L}anders`, '') }, 5);
    g.apply(3, { t: 'answers', list: mk(`${L}gleich`, '') }, 5);
    g.tick(WRITE_MS + GRACE_MS);
    const p = g.score();
    assert.equal(p[0][0], 5, 'Team 0 und Team 1 haben dieselbe Antwort');
    assert.equal(p[1][0], 5);
    assert.equal(p[3][0], 5);
    assert.equal(p[2][0], 10);
    assert.equal(p[0][1], 20);
    const g2 = room(4);
    g2.apply(0, { t: 'teamMode', on: true });
    g2.s.players.forEach((q, i) => (q.team = i < 2 ? 0 : 1));
    g2.apply(0, { t: 'start' }, 0);
    g2.apply(0, { t: 'answers', list: mk(`${g2.s.letter}x`, '') }, 5);
    g2.apply(1, { t: 'answers', list: mk(`${g2.s.letter}x`, '') }, 5);
    g2.tick(WRITE_MS + GRACE_MS);
    assert.equal(g2.score()[0][0], 20, 'dieselbe Antwort im eigenen Team ist keine Doppelung');
    assert.equal(g2.score()[1][0], 20);
});

test('Teams: erst ab 4 Personen und mit mindestens 2 pro Team', () => {
    const g = room(3);
    assert.ok(g.apply(0, { t: 'teamMode', on: true }).error);
    const h = room(4);
    assert.ok(!h.apply(0, { t: 'teamMode', on: true }).error);
    assert.equal(h.s.players.filter(p => p.team === 0).length, 2);
    h.s.players.forEach((p, i) => (p.team = i === 0 ? 0 : 1));
    assert.ok(h.apply(0, { t: 'start' }).error);
    assert.ok(!h.apply(1, { t: 'team', team: 0 }).error);
    assert.ok(!h.apply(0, { t: 'shuffleTeams' }).error);
    assert.ok(!h.apply(0, { t: 'start' }).error);
});

test('Ansicht: während des Schreibens sieht man nur die eigenen Antworten', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const L = g.s.letter;
    g.apply(1, { t: 'answers', list: [`${L}geheim`] }, 5);
    const v0 = g.view(0, 10);
    assert.ok(!JSON.stringify(v0).includes('geheim'));
    assert.equal(v0.answers, null);
    const v1 = g.view(1, 10);
    assert.equal(v1.myAnswers[0], `${L}geheim`);
    g.tick(WRITE_MS + GRACE_MS);
    assert.ok(JSON.stringify(g.view(0, 10)).includes('geheim'));
});

test('Ganzes Spiel: nach der letzten Runde ist Schluss, Neustart setzt zurück', () => {
    const g = room(3);
    g.apply(0, { t: 'setRounds', n: 4 });
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    for (let r = 1; r <= 4; r++) {
        assert.equal(g.s.round, r);
        g.apply(0, { t: 'answers', list: fill(g, 0) }, t + 10);
        t += WRITE_MS + GRACE_MS;
        g.tick(t);
        for (let i = 0; i < 3; i++) g.apply(i, { t: 'ready' }, t);
    }
    assert.equal(g.s.phase, 'over');
    assert.ok(g.s.totals[0] > 0);
    assert.equal(new Set(g.s.usedLetters).size, 4);
    assert.ok(!g.apply(1, { t: 'rematch' }, t).error);
    assert.equal(g.s.phase, 'write');
    assert.deepEqual(g.s.totals, [0, 0, 0]);
});

test('Wiederherstellen: laufende Runde beginnt neu, Auswertung bekommt frische Zeit', () => {
    const g = room(3);
    g.apply(0, { t: 'start' }, 0);
    const copy = SlfGame.restore(g.serialize());
    assert.equal(copy.s.phase, 'write');
    assert.equal(copy.s.round, 1);
    assert.ok(copy.s.writeEnd > Date.now());
    g.tick(WRITE_MS + GRACE_MS);
    const copy2 = SlfGame.restore(g.serialize());
    assert.equal(copy2.s.phase, 'review');
    assert.ok(copy2.s.reviewEnd > Date.now());
});

test('Zufallsspiele laufen immer bis zum Ende', () => {
    for (let seed = 1; seed <= 80; seed++) {
        const rng = seeded(seed * 11);
        const n = 3 + Math.floor(rng() * 4);
        const g = room(n, seed);
        if (n >= 4 && seed % 2) g.apply(0, { t: 'teamMode', on: true });
        g.apply(0, { t: 'setRounds', n: 4 });
        assert.ok(!g.apply(0, { t: 'start' }, 0).error);
        let t = 0;
        for (let step = 0; step < 600 && g.s.phase !== 'over'; step++) {
            t += 500 + Math.floor(rng() * 30000);
            const s = g.s;
            const seat = Math.floor(rng() * n);
            if (rng() < 0.03) g.setConnected(seat, rng() < 0.5);
            if (s.phase === 'write') {
                const L = s.letter;
                const list = s.categories.map(() => (rng() < 0.2 ? '' : `${rng() < 0.9 ? L : 'Q'}${['a', 'b', 'c'][Math.floor(rng() * 3)]}`));
                g.apply(seat, { t: 'answers', list }, t);
                if (rng() < 0.3) g.apply(seat, { t: 'stop', list: list.map(x => x || `${L}z`) }, t);
            } else if (s.phase === 'review') {
                g.apply(seat, { t: 'flag', p: Math.floor(rng() * n), c: Math.floor(rng() * s.categories.length) }, t);
                if (rng() < 0.4) g.apply(seat, { t: 'ready' }, t);
            }
            g.tick(t);
            for (let q = 0; q < n; q++) JSON.stringify(g.view(q, t));
            assert.ok(s.totals.every(x => Number.isInteger(x) && x >= 0));
        }
        assert.equal(g.s.phase, 'over', `Seed ${seed}`);
    }
});
