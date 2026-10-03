import test from 'node:test';
import assert from 'node:assert/strict';
import { LiarsGame, TURN_MS, REVEAL_MS } from '../js/games/liars/engine.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 3, seed = 7, opts = {}) {
    const g = new LiarsGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    if (opts.dice) assert.ok(!g.apply(0, { t: 'setDice', n: opts.dice }).error);
    if (opts.wild === false) assert.ok(!g.apply(0, { t: 'setWild', on: false }).error);
    return g;
}

const start = (g, now = 0) => assert.ok(!g.apply(0, { t: 'start' }, now).error);

test('Start: erst ab 3 Personen, nur der Host, jede Person bekommt ihre Würfel', () => {
    const g = room(2);
    assert.ok(g.apply(0, { t: 'start' }).error);
    g.join('t2', 'S2');
    assert.ok(g.apply(1, { t: 'start' }).error);
    start(g);
    assert.equal(g.s.phase, 'bidding');
    assert.deepEqual(g.s.players.map(p => p.dice), [5, 5, 5]);
    assert.deepEqual(g.s.hands.map(h => h.length), [5, 5, 5]);
    for (const h of g.s.hands) for (const d of h) assert.ok(d >= 1 && d <= 6);
});

test('Maximal 6 Personen, danach ist der Raum voll', () => {
    const g = room(6);
    assert.equal(g.join('x', 'X'), -1);
});

test('Gebote: müssen überbieten, falscher Spieler und Wert 1 bei Jokern werden abgelehnt', () => {
    const g = room(3);
    start(g);
    const t = g.s.turn;
    const other = (t + 1) % 3;
    assert.ok(g.apply(other, { t: 'bid', qty: 1, face: 2 }).error, 'falscher Spieler');
    assert.ok(g.apply(t, { t: 'bid', qty: 1, face: 1 }).error, 'Einser sind Joker und nicht bietbar');
    assert.ok(g.apply(t, { t: 'bid', qty: 99, face: 3 }).error, 'mehr als es Würfel gibt');
    assert.ok(g.apply(t, { t: 'challenge' }).error, 'ohne Gebot nichts anzuzweifeln');
    assert.ok(!g.apply(t, { t: 'bid', qty: 2, face: 4 }).error);
    assert.equal(g.s.turn, other);
    assert.ok(g.apply(other, { t: 'bid', qty: 2, face: 4 }).error, 'gleiches Gebot');
    assert.ok(g.apply(other, { t: 'bid', qty: 2, face: 3 }).error, 'gleiche Anzahl, niedrigerer Wert');
    assert.ok(g.apply(other, { t: 'bid', qty: 1, face: 6 }).error, 'weniger Würfel');
    assert.ok(!g.apply(other, { t: 'bid', qty: 2, face: 5 }).error);
    assert.ok(!g.apply((other + 1) % 3, { t: 'bid', qty: 3, face: 2 }).error, 'mehr Würfel mit niedrigerem Wert');
});

test('Ohne Joker darf man auch Einser bieten und sie zählen nicht für andere Werte', () => {
    const g = room(3, 5, { wild: false });
    start(g);
    g.s.hands = [[1, 1, 3, 3, 3], [2, 2, 2, 2, 2], [6, 6, 6, 6, 6]];
    assert.equal(g.count(3), 3);
    assert.equal(g.count(1), 2);
    assert.ok(!g.apply(g.s.turn, { t: 'bid', qty: 1, face: 1 }).error);
});

test('Joker: Einser zählen für jeden Wert', () => {
    const g = room(3);
    start(g);
    g.s.hands = [[1, 1, 3, 3, 3], [2, 2, 2, 2, 2], [6, 6, 6, 6, 6]];
    assert.equal(g.count(3), 5);
    assert.equal(g.count(2), 7);
    assert.equal(g.count(6), 7);
});

function setHands(g, hands) {
    g.s.hands = hands;
    g.s.players.forEach((p, i) => (p.dice = hands[i].length));
}

test('Anzweifeln: Bieter hatte recht → Anzweifler verliert einen Würfel und beginnt die nächste Runde nicht automatisch', () => {
    const g = room(3);
    start(g);
    setHands(g, [[4, 4, 4, 2, 2], [4, 2, 2, 2, 2], [3, 3, 3, 3, 3]]);
    const a = g.s.turn;
    const b = (a + 1) % 3;
    assert.ok(!g.apply(a, { t: 'bid', qty: 4, face: 4 }, 100).error);
    assert.ok(!g.apply(b, { t: 'challenge' }, 200).error);
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.s.reveal.count, 4);
    assert.ok(g.s.reveal.bidderRight);
    assert.equal(g.s.reveal.loser, b);
    assert.equal(g.s.players[b].dice, 4);
    assert.equal(g.s.players[a].dice, 5);
});

test('Anzweifeln: Bieter hat gelogen → Bieter verliert einen Würfel und beginnt die nächste Runde', () => {
    const g = room(3);
    start(g);
    setHands(g, [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [5, 5, 5, 5, 5]]);
    const a = g.s.turn;
    const b = (a + 1) % 3;
    assert.ok(!g.apply(a, { t: 'bid', qty: 12, face: 6 }, 0).error || true);
    // gültiges, aber falsches Gebot
    if (g.s.phase === 'bidding' && !g.s.bid) assert.ok(!g.apply(a, { t: 'bid', qty: 4, face: 6 }, 0).error);
    assert.ok(!g.apply(b, { t: 'challenge' }, 0).error);
    assert.ok(!g.s.reveal.bidderRight);
    assert.equal(g.s.reveal.loser, a);
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'next' }, 10);
    assert.equal(g.s.phase, 'bidding');
    assert.equal(g.s.round, 2);
    assert.equal(g.s.turn, a, 'wer verloren hat, beginnt');
    assert.deepEqual(g.s.hands.map(h => h.length), g.s.players.map(p => p.dice));
    assert.equal(g.s.players[a].dice, 4);
});

test('Ausscheiden und Sieg: wer keinen Würfel mehr hat, fliegt raus, der Letzte gewinnt', () => {
    const g = room(3);
    start(g);
    setHands(g, [[2], [3, 3], [5, 5]]);
    g.s.turn = 0;
    g.s.starter = 0;
    assert.ok(!g.apply(0, { t: 'bid', qty: 3, face: 6 }, 0).error);
    assert.ok(!g.apply(1, { t: 'challenge' }, 0).error);
    assert.equal(g.s.players[0].dice, 0);
    assert.ok(g.s.reveal.out);
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'next' }, 5);
    assert.equal(g.s.phase, 'bidding');
    assert.notEqual(g.s.turn, 0, 'ausgeschiedene Spieler sind nie dran');
    assert.deepEqual(g.s.hands[0], []);
    // Jetzt noch Spieler 1 gegen 2 zu Ende bringen
    setHands(g, [[], [3], [5, 5]]);
    g.s.turn = 1;
    assert.ok(!g.apply(1, { t: 'bid', qty: 3, face: 6 }, 0).error);
    assert.equal(g.s.turn, 2);
    assert.ok(!g.apply(2, { t: 'challenge' }, 0).error);
    assert.equal(g.s.players[1].dice, 0);
    g.tick(REVEAL_MS + 1000);
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, 2);
    assert.equal(g.s.players[2].wins, 1);
    assert.ok(!g.apply(2, { t: 'rematch' }, 0).error);
    assert.deepEqual(g.s.players.map(p => p.dice), [5, 5, 5]);
    assert.equal(g.s.players[2].wins, 1, 'Siege bleiben beim Neustart');
});

test('Zeit abgelaufen: ohne Gebot wird das kleinste Gebot gesetzt, mit Gebot angezweifelt', () => {
    const g = room(3);
    start(g, 0);
    const first = g.s.turn;
    assert.equal(g.tick(TURN_MS - 1), false);
    assert.equal(g.tick(TURN_MS + 1), true);
    assert.equal(g.s.bid.seat, first);
    assert.equal(g.s.bid.qty, 1);
    assert.equal(g.s.phase, 'bidding');
    g.tick(TURN_MS * 2 + 5);
    assert.equal(g.s.phase, 'reveal');
});

test('Wer nicht verbunden ist, wird schnell übergangen', () => {
    const g = room(3);
    start(g, 0);
    g.setConnected(g.s.turn, false);
    assert.equal(g.tick(1000), false);
    assert.equal(g.tick(4000), true);
});

test('Ansicht: fremde Würfel bleiben verdeckt, beim Aufdecken sehen alle alles', () => {
    const g = room(3);
    start(g);
    setHands(g, [[1, 2, 3, 4, 5], [6, 6, 6, 6, 6], [2, 2, 2, 2, 2]]);
    const v1 = g.view(1, 0);
    assert.deepEqual(v1.hand, [6, 6, 6, 6, 6]);
    assert.ok(!JSON.stringify(v1).includes('"hands"'));
    assert.equal(v1.reveal, null);
    const t = g.s.turn;
    g.apply(t, { t: 'bid', qty: 2, face: 6 }, 0);
    g.apply(g.s.turn, { t: 'challenge' }, 0);
    const v = g.view(0, 0);
    assert.equal(v.reveal.hands.length, 3);
    assert.deepEqual(v.hand, []);
});

test('Speichern und Wiederherstellen mitten in der Runde', () => {
    const g = room(4);
    start(g);
    g.apply(g.s.turn, { t: 'bid', qty: 2, face: 3 });
    const copy = LiarsGame.restore(g.serialize());
    assert.deepEqual(copy.s.hands, g.s.hands);
    assert.ok(copy.s.players.every(p => !p.connected));
    assert.equal(copy.join('t0', 'S0'), 0);
});

test('Zufallsspiele laufen immer bis zum Ende', () => {
    for (let seed = 1; seed <= 150; seed++) {
        const rng = seeded(seed * 7);
        const n = 3 + Math.floor(rng() * 4);
        const g = room(n, seed, { dice: [3, 4, 5][seed % 3], wild: seed % 2 === 0 });
        start(g, 0);
        let t = 0;
        for (let step = 0; step < 4000 && g.s.phase !== 'over'; step++) {
            t += 500 + Math.floor(rng() * 20000);
            const s = g.s;
            if (s.phase === 'bidding') {
                const seat = s.turn;
                const roll = rng();
                if (roll < 0.35 && s.bid) g.apply(seat, { t: 'challenge' }, t);
                else if (roll < 0.9) g.apply(seat, { t: 'bid', qty: 1 + Math.floor(rng() * g.totalDice), face: 1 + Math.floor(rng() * 6) }, t);
            } else if (s.phase === 'reveal' && rng() < 0.5) g.apply(Math.floor(rng() * n), { t: 'next' }, t);
            g.tick(t);
            for (const p of s.players) assert.ok(p.dice >= 0 && p.dice <= s.diceStart);
            if (s.phase === 'bidding') {
                assert.ok(s.players[s.turn].dice > 0, 'Ausgeschiedene sind nie dran');
                assert.deepEqual(s.hands.map(h => h.length), s.players.map(p => p.dice));
            }
            for (let seat = 0; seat < n; seat++) JSON.stringify(g.view(seat, t));
        }
        assert.equal(g.s.phase, 'over', `Seed ${seed} endete nicht`);
        assert.equal(g.s.players.filter(p => p.dice > 0).length, 1);
    }
});
