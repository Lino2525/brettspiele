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

function newGame() {
    const g = new RummyGame({ rng: seeded(7) });
    assert.equal(g.join('a', 'Anna'), 0);
    assert.equal(g.s.phase, 'waiting');
    assert.equal(g.join('b', 'Boris'), 1);
    return g;
}

test('Austeilen', () => {
    const g = newGame();
    assert.equal(g.s.phase, 'playing');
    assert.equal(g.s.players[0].rack.length, 14);
    assert.equal(g.s.players[1].rack.length, 14);
    assert.equal(g.s.pool.length, 106 - 28);
    const all = [...g.s.pool, ...g.s.players[0].rack, ...g.s.players[1].rack];
    assert.equal(new Set(all).size, 106);
    assert.equal(g.join('c', 'Dritte'), -1, 'Raum voll');
    assert.equal(g.join('a', 'Anna'), 0, 'Wiedereintritt per Token');
});

test('Ansicht verrät den fremden Ständer nicht', () => {
    const g = newGame();
    const v = g.view(0);
    assert.deepEqual(v.rack, g.s.players[0].rack);
    assert.equal(v.otherRack, null);
    assert.equal(v.players[1].rackCount, 14);
    assert.ok(!JSON.stringify(v).includes('token'));
});

test('Ziehen und Zugrecht', () => {
    const g = newGame();
    const t = g.s.turn;
    assert.ok(g.apply(1 - t, { t: 'draw' }).error, 'nicht am Zug');
    assert.ok(!g.apply(t, { t: 'draw' }).error);
    assert.equal(g.s.players[t].rack.length, 15);
    assert.equal(g.s.turn, 1 - t);
});

test('Zug mit erstem Auslegen und Sieg', () => {
    const g = newGame();
    const t = g.s.turn;
    const run = [T(3, 10), T(3, 11), T(3, 12)];
    g.s.players[t].rack = [...run];
    g.s.pool = g.s.pool.filter(id => !run.includes(id));
    g.s.players[1 - t].rack = g.s.players[1 - t].rack.filter(id => !run.includes(id));
    const res = g.apply(t, { t: 'move', table: [run], rack: [] });
    assert.ok(!res.error, res.error);
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, t);
    const loserSum = rackPoints(g.s.players[1 - t].rack);
    assert.equal(g.s.scores[t], loserSum);
    assert.equal(g.s.scores[1 - t], -loserSum);
    assert.ok(g.view(1 - t).otherRack, 'am Ende wird aufgedeckt');
    // neue Runde, anderer Spieler beginnt
    assert.ok(!g.apply(0, { t: 'newRound' }).error);
    assert.equal(g.s.turn, 1 - t);
    assert.equal(g.s.round, 2);
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

test('Vorschau (Draft) wird nur dem Gegenüber gezeigt und beim Zugwechsel verworfen', () => {
    const g = newGame();
    const t = g.s.turn;
    const mine = g.s.players[t].rack.slice(0, 2);
    g.apply(t, { t: 'draft', table: [mine] });
    assert.deepEqual(g.view(1 - t).liveTable, [mine]);
    assert.equal(g.view(t).liveTable, null);
    g.apply(t, { t: 'draft', table: [[g.s.players[1 - t].rack[0]]] }); // fremder Stein: ignoriert
    assert.deepEqual(g.view(1 - t).liveTable, [mine]);
    g.apply(t, { t: 'draw' });
    assert.equal(g.view(1 - t).liveTable, null);
});

test('Leerer Vorrat: Aussetzen, zweimal in Folge beendet die Runde', () => {
    const g = newGame();
    g.s.pool = [];
    g.s.players[0].rack = [T(0, 1)];
    g.s.players[1].rack = [T(0, 2), T(0, 3)];
    g.apply(g.s.turn, { t: 'draw' });
    assert.equal(g.s.phase, 'playing');
    g.apply(g.s.turn, { t: 'draw' });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, 0, 'weniger Punkte gewinnt');
});

test('Speichern und Wiederherstellen', () => {
    const g = newGame();
    const copy = RummyGame.restore(g.serialize(), { rng: seeded(1) });
    assert.deepEqual(copy.view(0).rack, g.view(0).rack);
    assert.equal(copy.s.players[0].connected, false);
    assert.equal(copy.join('a', 'x'), 0);
});
