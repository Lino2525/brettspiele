// Ausführen mit:  node --test tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSet, evaluateMove, rackPoints } from '../js/games/rummy/rules.js';
import { RummyGame } from '../js/games/rummy/engine.js';

// Hilfsfunktion: Stein-ID aus Farbe (0-3) und Zahl (1-13), erster Satz
const T = (color, num) => color * 13 + (num - 1);
const T2 = (color, num) => 52 + T(color, num); // zweiter Satz
const J1 = 104;
const J2 = 105;

test('Reihen', () => {
    assert.equal(analyzeSet([T(0, 3), T(0, 4), T(0, 5)]).valid, true);
    assert.equal(analyzeSet([T(0, 3), T(0, 4), T(0, 5)]).points, 12);
    assert.equal(analyzeSet([T(0, 3), T(0, 4)]).valid, false, 'zu kurz');
    assert.equal(analyzeSet([T(0, 3), T(1, 4), T(0, 5)]).valid, false, 'Farbmix');
    assert.equal(analyzeSet([T(0, 3), T(0, 5), T(0, 6)]).valid, false, 'Lücke');
    assert.equal(analyzeSet([T(0, 3), T2(0, 3), T(0, 4)]).valid, false, 'doppelte Zahl');
    assert.equal(analyzeSet([T(0, 12), T(0, 13), T(0, 1)]).valid, false, 'kein Umlauf 13-1');
    assert.equal(analyzeSet([T(0, 3), J1, T(0, 5)]).points, 12, 'Joker in der Lücke');
});

test('Joker am Rand zählt so hoch wie möglich', () => {
    const a = analyzeSet([T(1, 5), T(1, 6), J1]);
    assert.equal(a.valid, true);
    assert.equal(a.points, 5 + 6 + 7);
    const b = analyzeSet([T(1, 12), T(1, 13), J1]);
    assert.equal(b.points, 11 + 12 + 13, 'oben nicht möglich, also nach unten');
});

test('Sätze', () => {
    assert.equal(analyzeSet([T(0, 7), T(1, 7), T(2, 7)]).points, 21);
    assert.equal(analyzeSet([T(0, 7), T(1, 7), T(2, 7), T(3, 7)]).valid, true);
    assert.equal(analyzeSet([T(0, 7), T(1, 7), T(0, 7) + 52]).valid, false, 'gleiche Farbe doppelt');
    assert.equal(analyzeSet([T(0, 7), T(1, 7), J1, J2, T(2, 7)]).valid, false, 'mehr als 4');
    assert.equal(analyzeSet([T(0, 7), T(1, 7), J1]).points, 21);
});

test('Ständerpunkte', () => {
    assert.equal(rackPoints([T(0, 5), J1, T(1, 13)]), 5 + 30 + 13);
});

const moveArgs = (over = {}) => ({ oldTable: [], oldRack: [], table: [], rack: [], melded: false, ...over });

test('Erstes Auslegen braucht 30 Punkte, ohne Tisch umzubauen', () => {
    const run = [T(0, 10), T(0, 11), T(0, 12)]; // 33
    const small = [T(0, 1), T(0, 2), T(0, 3)]; // 6
    let r = evaluateMove(moveArgs({ oldRack: [...run, 99], table: [run], rack: [99] }));
    assert.equal(r.ok, true);
    assert.equal(r.points, 33);
    r = evaluateMove(moveArgs({ oldRack: [...small, 99], table: [small], rack: [99] }));
    assert.equal(r.ok, false);
    assert.equal(r.points, 6);
    // Mehrere Kombinationen zählen zusammen
    const group = [T(0, 9), T(1, 9), T(2, 9)]; // 27
    r = evaluateMove(moveArgs({ oldRack: [...small, ...group], table: [small, group], rack: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.points, 33);
    // Vor dem Auslegen keine Steine an liegende Reihen anlegen
    const onTable = [T(2, 1), T(2, 2), T(2, 3)];
    r = evaluateMove(moveArgs({ oldTable: [onTable], oldRack: [T(2, 4), ...run], table: [[...onTable, T(2, 4)], run], rack: [] }));
    assert.equal(r.ok, false);
});

test('Nach dem Auslegen: Anlegen, Umbauen, Joker austauschen', () => {
    const onTable = [T(2, 1), T(2, 2), T(2, 3)];
    // anlegen
    let r = evaluateMove(moveArgs({ melded: true, oldTable: [onTable], oldRack: [T(2, 4), 99], table: [[...onTable, T(2, 4)]], rack: [99] }));
    assert.equal(r.ok, true);
    // Reihe teilen: 1..6 -> 1,2,3 + 4,5,6 (mit eigenem Stein 6)
    const long = [T(1, 1), T(1, 2), T(1, 3), T(1, 4), T(1, 5)];
    r = evaluateMove(moveArgs({ melded: true, oldTable: [long], oldRack: [T(1, 6), 99], table: [long.slice(0, 3), [T(1, 4), T(1, 5), T(1, 6)]], rack: [99] }));
    assert.equal(r.ok, true);
    // Joker nehmen und durch passenden Stein ersetzen, Joker wird in neuer Kombination gelegt
    const withJoker = [T(0, 4), J1, T(0, 6)];
    const newSet = [T(1, 8), T(2, 8), J1];
    r = evaluateMove(moveArgs({ melded: true, oldTable: [withJoker], oldRack: [T(0, 5), T(1, 8), T(2, 8)], table: [[T(0, 4), T(0, 5), T(0, 6)], newSet], rack: [] }));
    assert.equal(r.ok, true);
    // Stein vom Tisch zurück in den Ständer ist verboten
    r = evaluateMove(moveArgs({ melded: true, oldTable: [onTable], oldRack: [99], table: [[T(2, 2), T(2, 3), 99]], rack: [T(2, 1)] }));
    assert.equal(r.ok, false);
    // Stein aus dem Nichts
    r = evaluateMove(moveArgs({ melded: true, oldTable: [onTable], oldRack: [], table: [[...onTable, T(2, 4)]], rack: [] }));
    assert.equal(r.ok, false);
    // Ungültige Kombination übrig
    r = evaluateMove(moveArgs({ melded: true, oldTable: [long], oldRack: [99], table: [long.slice(0, 2), [99, 98, 97]], rack: [] }));
    assert.equal(r.ok, false);
});

// ---- Spielablauf ----

function seeded(seed = 1) {
    let x = seed;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

// Lobby mit n Spielern, danach startet der Gastgeber (Platz 0) das Spiel.
function newGame(n = 2, { start = true } = {}) {
    const g = new RummyGame({ rng: seeded(7) });
    const names = ['Anna', 'Boris', 'Cara', 'Dino'];
    for (let i = 0; i < n; i++) assert.equal(g.join('t' + i, names[i]), i);
    assert.equal(g.s.phase, 'waiting');
    if (start) assert.ok(!g.apply(0, { t: 'start' }).error);
    return g;
}

const others = (g, seat) => g.s.players.map((_, i) => i).filter(i => i !== seat);

test('Lobby: Start nur durch den Gastgeber und erst ab 2 Spielern', () => {
    const g = newGame(1, { start: false });
    assert.ok(g.apply(0, { t: 'start' }).error, 'zu wenige');
    g.join('t1', 'Boris');
    assert.ok(g.apply(1, { t: 'start' }).error, 'nur Gastgeber');
    assert.equal(g.s.phase, 'waiting');
    assert.ok(!g.apply(0, { t: 'start' }).error);
    assert.equal(g.s.phase, 'playing');
    assert.ok(g.apply(0, { t: 'start' }).error, 'läuft schon');
});

test('Austeilen für 2, 3 und 4 Spieler', () => {
    for (const n of [2, 3, 4]) {
        const g = newGame(n);
        assert.equal(g.s.phase, 'playing');
        for (const p of g.s.players) assert.equal(p.rack.length, 14);
        assert.equal(g.s.pool.length, 106 - 14 * n);
        const all = [...g.s.pool, ...g.s.players.flatMap(p => p.rack)];
        assert.equal(new Set(all).size, 106, 'keine Doppelten, keine fehlenden');
    }
});

test('Beitritt: maximal 4, nach dem Start nur noch bekannte Spieler', () => {
    const g = newGame(4, { start: false });
    assert.equal(g.join('t4', 'Fünfte'), -1, 'Raum voll');
    assert.equal(g.join('t2', 'Cara'), 2, 'Wiedereintritt per Token');
    const h = newGame(2, { start: false });
    h.apply(0, { t: 'start' });
    assert.equal(h.join('neu', 'Spät'), -1, 'Spiel läuft schon');
    assert.equal(h.join('t1', 'Boris'), 1, 'bekannter Spieler darf zurück');
});

test('Namen werden eindeutig gemacht', () => {
    const g = new RummyGame({ rng: seeded(1) });
    g.join('a', 'Lino');
    g.join('b', 'Lino');
    g.join('c', 'Lino');
    assert.deepEqual(g.s.players.map(p => p.name), ['Lino', 'Lino 2', 'Lino 3']);
});

test('Ansicht verrät fremde Ständer nicht', () => {
    const g = newGame(3);
    const v = g.view(0);
    assert.deepEqual(v.rack, g.s.players[0].rack);
    assert.equal(v.racks, null);
    assert.equal(v.players[1].rackCount, 14);
    assert.ok(!JSON.stringify(v).includes('token'));
    assert.ok(!('otherRack' in v));
});

test('Reihum ziehen, Zugrecht', () => {
    const g = newGame(3);
    const first = g.s.turn;
    assert.ok(g.apply((first + 1) % 3, { t: 'draw' }).error, 'nicht am Zug');
    const order = [];
    for (let i = 0; i < 6; i++) {
        order.push(g.s.turn);
        assert.ok(!g.apply(g.s.turn, { t: 'draw' }).error);
    }
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5].map(i => (first + i) % 3));
    assert.equal(g.s.players.every(p => p.rack.length === 16), true);
});

test('Sieg: Gewinner bekommt die Restpunkte aller anderen', () => {
    const g = newGame(3);
    const t = g.s.turn;
    const run = [T(3, 10), T(3, 11), T(3, 12)];
    g.s.players[t].rack = [...run];
    for (const o of others(g, t)) g.s.players[o].rack = g.s.players[o].rack.filter(id => !run.includes(id));
    g.s.pool = g.s.pool.filter(id => !run.includes(id));
    const [o1, o2] = others(g, t);
    const sum1 = rackPoints(g.s.players[o1].rack);
    const sum2 = rackPoints(g.s.players[o2].rack);
    const res = g.apply(t, { t: 'move', table: [run], rack: [] });
    assert.ok(!res.error, res.error);
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, t);
    assert.equal(g.s.scores[o1], -sum1);
    assert.equal(g.s.scores[o2], -sum2);
    assert.equal(g.s.scores[t], sum1 + sum2);
    assert.equal(g.s.scores.reduce((a, b) => a + b, 0), 0, 'Nullsumme');
    assert.equal(g.view(o1).racks.length, 3, 'am Ende wird aufgedeckt');
    // neue Runde: der nächste Platz beginnt
    const starter = g.s.starter;
    assert.ok(!g.apply(0, { t: 'newRound' }).error);
    assert.equal(g.s.turn, (starter + 1) % 3);
    assert.equal(g.s.round, 2);
    assert.equal(g.s.phase, 'playing');
});

test('Ungültige Züge werden abgelehnt und ändern nichts', () => {
    const g = newGame();
    const t = g.s.turn;
    g.s.players[t].rack = [T(0, 1), T(1, 5), T(2, 9), 99];
    const before = JSON.stringify(g.s);
    assert.ok(g.apply(t, { t: 'move', table: [[T(0, 1), T(1, 5), T(2, 9)]], rack: [99] }).error, 'keine gültige Kombination');
    assert.ok(g.apply(t, { t: 'move', table: [[999]], rack: [] }).error, 'unbekannter Stein');
    assert.ok(g.apply(t, { t: 'move', table: 'x', rack: [] }).error, 'kaputte Daten');
    assert.ok(g.apply(t, { t: 'move', table: [], rack: [T(0, 1), T(1, 5), T(2, 9), 99] }).error, 'nichts gelegt');
    assert.ok(g.apply(1 - t, { t: 'move', table: [], rack: [] }).error, 'nicht am Zug');
    assert.equal(JSON.stringify(g.s), before);
});

test('Vorschau (Draft) sehen alle anderen, nicht man selbst; beim Zugwechsel weg', () => {
    const g = newGame(3);
    const t = g.s.turn;
    const mine = g.s.players[t].rack.slice(0, 2);
    g.apply(t, { t: 'draft', table: [mine] });
    for (const o of others(g, t)) assert.deepEqual(g.view(o).liveTable, [mine]);
    assert.equal(g.view(t).liveTable, null);
    const o = others(g, t)[0];
    g.apply(t, { t: 'draft', table: [[g.s.players[o].rack[0]]] }); // fremder Stein: ignoriert
    assert.deepEqual(g.view(o).liveTable, [mine]);
    g.apply(t, { t: 'draw' });
    assert.equal(g.view(o).liveTable, null);
});

test('Leerer Vorrat: erst wenn alle nacheinander aussetzen, endet die Runde', () => {
    const g = newGame(3);
    g.s.pool = [];
    g.s.players[0].rack = [T(0, 1)];
    g.s.players[1].rack = [T(0, 2), T(0, 3)];
    g.s.players[2].rack = [T(0, 4), T(0, 5), T(0, 6)];
    g.apply(g.s.turn, { t: 'draw' });
    g.apply(g.s.turn, { t: 'draw' });
    assert.equal(g.s.phase, 'playing', 'nach zweimal noch nicht zu Ende');
    g.apply(g.s.turn, { t: 'draw' });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, 0, 'wenigste Punkte gewinnt');
    assert.equal(g.s.scores[1], -(5 - 1));
    assert.equal(g.s.scores[2], -(15 - 1));
    assert.equal(g.s.scores[0], 4 + 14);
});

test('Gleichstand an der Spitze: unentschieden, keine Punkte', () => {
    const g = newGame(2);
    g.s.pool = [];
    g.s.players[0].rack = [T(0, 4)];
    g.s.players[1].rack = [T(1, 4)];
    g.apply(g.s.turn, { t: 'draw' });
    g.apply(g.s.turn, { t: 'draw' });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, null);
    assert.deepEqual(g.s.scores, [0, 0]);
});

test('Speichern und Wiederherstellen', () => {
    const g = newGame(3);
    const copy = RummyGame.restore(g.serialize(), { rng: seeded(1) });
    assert.deepEqual(copy.view(1).rack, g.view(1).rack);
    assert.equal(copy.s.players[0].connected, false);
    assert.equal(copy.join('t0', 'x'), 0);
    assert.equal(copy.s.scores.length, 3);
});
