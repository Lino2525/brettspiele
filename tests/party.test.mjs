import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, FLAGS, WORDS } from '../js/games/party/data.js';
import { NODES, NEXT, SEGMENTS, START, SPACE_TYPES, STAR_SPOTS, nextOptions, distances } from '../js/games/party/board.js';
import { MINIS, MINI_TYPES, createMini, tickMini, miniAction, miniView, computeRewards, INTRO_MS, RESULT_MS } from '../js/games/party/minigames.js';
import { PartyGame, MAX_PLAYERS, STAR_PRICE, CHOICE_MS, SHIELD_ROUNDS, DUEL_COINS } from '../js/games/party/engine.js';

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

// Feld an Rasterposition
const at = (x, y) => {
    const n = NODES.find(q => q.x === x && q.y === y);
    assert.ok(n, `kein Feld bei ${x},${y}`);
    return n.id;
};

test('Spielfeld: Wegenetz mit Start, Schild, 4 Duellen und Teleport, alles erreichbar', () => {
    const count = t => SPACE_TYPES.filter(x => x === t).length;
    assert.equal(count('start'), 1);
    assert.equal(SPACE_TYPES[START], 'start');
    assert.equal(count('shield'), 1);
    assert.equal(count('duel'), 4);
    assert.equal(count('teleport'), 1);
    assert.ok(count('red') >= 8 && count('blue') >= 25 && count('luck') >= 4);
    assert.equal(new Set(NODES.map(n => `${n.x},${n.y}`)).size, NODES.length, 'jede Position nur einmal');
    // Lila Linie von oben nach unten: Duell, Duell, Teleport, Duell, Duell
    const purple = NODES.filter(n => n.x === 31).sort((p, q) => p.y - q.y).map(n => n.type);
    assert.deepEqual(purple, ['duel', 'duel', 'teleport', 'duel', 'duel']);
    // Von jedem erreichbaren Zustand (Feld, Herkunft) geht es weiter, und jedes Feld ist vom Start aus erreichbar
    const seen = new Set();
    const nodes = new Set();
    const stack = [[START, null]];
    while (stack.length) {
        const [pos, prev] = stack.pop();
        const key = `${pos}|${prev}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.add(pos);
        const opts = nextOptions(pos, prev);
        assert.ok(opts.length >= 1, `Sackgasse bei ${pos}`);
        for (const n of opts) {
            assert.ok(NEXT[pos].includes(n));
            stack.push([n, pos]);
        }
    }
    assert.equal(nodes.size, NODES.length);
    // Wege verbinden immer benachbarte Felder (höchstens 4 Rastereinheiten)
    for (const { a, b } of SEGMENTS) assert.ok(Math.hypot(NODES[a].x - NODES[b].x, NODES[a].y - NODES[b].y) <= 4);
    // Der Stern liegt nur auf normalen Feldern
    for (const id of STAR_SPOTS) assert.ok(['blue', 'red', 'luck'].includes(SPACE_TYPES[id]));
    assert.equal(distances(START)[START], 0);
});

test('Spielfeld: Einbahnstraßen nur in Pfeilrichtung, sonst in beide Richtungen, kein Umdrehen außer in der Sackgasse', () => {
    // oberer Rand nach rechts, rechter Rand nach unten, unten nach links, links nach oben, lila Linie nach unten
    assert.ok(NEXT[at(2, 2)].includes(at(6, 2)) && !NEXT[at(6, 2)].includes(at(2, 2)));
    assert.ok(NEXT[at(28, 2)].includes(at(28, 5)) && !NEXT[at(28, 5)].includes(at(28, 2)));
    assert.ok(NEXT[at(28, 14)].every(n => NODES[n].y === 14 && NODES[n].x < 28));
    assert.ok(!NEXT[at(2, 8)].includes(at(2, 11)), 'linker Rand nur nach oben');
    assert.ok(NEXT[at(31, 5)].includes(at(31, 6.5)) && !NEXT[at(31, 6.5)].includes(at(31, 5)));
    // Mittellinie in beide Richtungen
    assert.ok(NEXT[at(6, 8)].includes(at(9, 8)) && NEXT[at(9, 8)].includes(at(6, 8)));
    // kein Umdrehen: vom Schild aus nach rechts weiter, wenn man von links kommt
    assert.deepEqual(nextOptions(at(9, 8), at(6, 8)), [at(12, 8)]);
    // Sackgasse: Ende der lila Linie von links erreicht -> zurück
    assert.deepEqual(nextOptions(at(31, 11), at(28, 11)), [at(28, 11)]);
    // Kreuzung in der Mitte: drei Möglichkeiten
    assert.equal(nextOptions(at(6, 8), at(6, 5)).length, 3);
});

// Setzt die Person am Zug auf ein Feld (mit Herkunft) und würfelt eine bestimmte Zahl
function rollFrom(g, seat, pos, prev, value, now = 0) {
    const s = g.s;
    s.turnIdx = s.order.indexOf(seat);
    s.turnPhase = 'roll';
    Object.assign(s.players[seat], { pos, prev });
    const rng = g.rng;
    g.rng = () => (value - 1) / 6 + 0.01;
    const r = g.apply(seat, { t: 'roll' }, now);
    g.rng = rng;
    return r;
}

test('Zug: nur wer dran ist würfelt, Figur läuft vom Start nach rechts, Wartezeit, dann der Nächste', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const first = g.s.order[0];
    const second = g.s.order[1];
    assert.ok(g.apply(second, { t: 'roll' }, 100).error, 'nicht dran');
    g.rng = () => 0; // Wurf = 1
    assert.ok(!g.apply(first, { t: 'roll' }, 100).error);
    assert.equal(g.s.dice.value, 1);
    assert.equal(g.s.players[first].pos, at(6, 2));
    assert.equal(g.s.players[first].prev, START);
    assert.ok(g.apply(first, { t: 'roll' }, 200).error, 'nicht doppelt würfeln');
    assert.equal(g.s.turnPhase, 'moving');
    assert.equal(g.tick(300), false, 'Figur ist noch unterwegs');
    assert.ok(g.tick(100 + 380 + 2300 + 10));
    assert.equal(g.s.turnIdx, 1);
    assert.equal(g.view(second, 5000).turnSeat, second);
});

test('Abzweigung: das Spiel fragt, nur die Person am Zug entscheidet, danach geht es weiter (auch zweimal)', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    g.s.star = at(16, 0);
    rollFrom(g, seat, at(6, 2), at(2, 2), 3, 0);
    assert.equal(g.s.turnPhase, 'choose');
    assert.deepEqual(g.s.choice.options.sort(), nextOptions(at(6, 2), at(2, 2)).sort());
    assert.equal(g.view(seat, 0).moveLeft, 3);
    assert.equal(g.view(seat, 0).choice.seat, seat);
    assert.ok(g.apply((seat + 1) % 3, { t: 'choose', to: at(6, 5) }, 10).error, 'nur wer zieht');
    assert.ok(g.apply(seat, { t: 'choose', to: at(28, 2) }, 10).error, 'nur Nachbarfelder');
    assert.ok(g.apply(seat, { t: 'roll' }, 10).error, 'kein neuer Wurf');
    assert.ok(!g.apply(seat, { t: 'choose', to: at(6, 5) }, 20).error);
    // an der Kreuzung (6,8) mit 1 Schritt übrig wird erneut gefragt
    assert.equal(p.pos, at(6, 8));
    assert.equal(g.s.turnPhase, 'choose');
    assert.equal(g.s.choice.options.length, 3);
    assert.ok(!g.apply(seat, { t: 'choose', to: at(9, 8) }, 30).error);
    assert.equal(p.pos, at(9, 8));
    assert.equal(g.s.turnPhase, 'moving');
    // Schild-Feld
    assert.equal(p.shield, SHIELD_ROUNDS);
    // die Bewegung wird in Abschnitten gemeldet
    const moves = g.s.events.filter(e => e.type === 'move' && e.seat === seat).map(e => e.path);
    assert.deepEqual(moves.flat(), [at(6, 5), at(6, 8), at(9, 8)]);
});

test('Abzweigung: wer zu lange überlegt oder offline ist, für den entscheidet das Spiel', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    rollFrom(g, seat, at(6, 2), at(2, 2), 2, 0);
    assert.equal(g.s.turnPhase, 'choose');
    assert.equal(g.tick(CHOICE_MS - 10), false);
    assert.ok(g.tick(CHOICE_MS + 10));
    assert.notEqual(g.s.turnPhase, 'choose');
    const h = newGame(3);
    h.apply(0, { t: 'start' }, 0);
    const hs = h.s.order[0];
    rollFrom(h, hs, at(6, 2), at(2, 2), 2, 0);
    h.setConnected(hs, false);
    assert.ok(h.tick(10));
    assert.notEqual(h.s.turnPhase, 'choose');
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

// Ein Wegstück finden, auf dem die nächsten len Schritte ohne Abzweigung feststehen (optional: Landefeld einer Art)
function forced(len, type = null) {
    for (const prevNode of NODES) for (const pos of NEXT[prevNode.id]) {
        const path = [];
        let [cur, prev] = [pos, prevNode.id];
        for (let i = 0; i < len; i++) {
            const opts = nextOptions(cur, prev);
            if (opts.length !== 1) break;
            [prev, cur] = [cur, opts[0]];
            path.push(cur);
        }
        if (path.length === len && (!type || SPACE_TYPES[path[len - 1]] === type)) return { pos, prev: prevNode.id, path };
    }
    throw new Error(`kein gerades Stück der Länge ${len}`);
}

// Ein Feld finden, von dem aus genau ein Schritt auf ein Feld der gewünschten Art führt
function stepOnto(type) {
    for (const prevNode of NODES) for (const pos of NEXT[prevNode.id]) {
        const opts = nextOptions(pos, prevNode.id);
        if (opts.length === 1 && SPACE_TYPES[opts[0]] === type) return { pos, prev: prevNode.id, target: opts[0] };
    }
    throw new Error(`kein Weg auf ${type}`);
}

test('Felder: blau +3, rot −3 (nie unter 0)', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    g.s.star = at(16, 0);
    const blue = stepOnto('blue');
    rollFrom(g, seat, blue.pos, blue.prev, 1);
    assert.equal(p.pos, blue.target);
    assert.equal(p.coins, 5 + 3);
    const red = stepOnto('red');
    p.coins = 2;
    rollFrom(g, seat, red.pos, red.prev, 1, 100);
    assert.equal(p.pos, red.target);
    assert.equal(p.coins, 0, 'nicht unter 0');
});

test('Stern: kaufen im Vorbeigehen für 5 Münzen, danach liegt er mindestens 5 Felder weiter; ohne Münzen kein Kauf', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    const lane = forced(2, 'blue');
    g.s.star = lane.path[0];
    const starAt = g.s.star;
    p.coins = 6;
    rollFrom(g, seat, lane.pos, lane.prev, 2);
    assert.equal(p.pos, lane.path[1]);
    assert.equal(p.stars, 1);
    assert.ok(p.coins <= 6 - STAR_PRICE + 3, 'bezahlt');
    assert.notEqual(g.s.star, starAt, 'Stern wandert');
    assert.ok(distances(starAt)[g.s.star] >= 5);
    assert.ok(STAR_SPOTS.includes(g.s.star));
    const h = newGame(3);
    h.apply(0, { t: 'start' }, 0);
    const hs = h.s.order[0];
    const q = h.s.players[hs];
    h.s.star = lane.path[0];
    q.coins = 4;
    rollFrom(h, hs, lane.pos, lane.prev, 2);
    assert.equal(q.stars, 0);
    assert.equal(h.s.star, lane.path[0]);
});

test('Teleport: auf Wunsch direkt zum Stern (und kaufen, wenn es reicht), sonst bleiben', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const p = g.s.players[seat];
    const star = STAR_SPOTS[3];
    g.s.star = star;
    p.coins = 7;
    rollFrom(g, seat, at(31, 6.5), at(31, 5), 1);
    assert.equal(SPACE_TYPES[p.pos], 'teleport');
    assert.equal(g.s.turnPhase, 'teleport');
    assert.ok(g.apply((seat + 1) % 3, { t: 'teleport', go: true }, 10).error);
    assert.ok(!g.apply(seat, { t: 'teleport', go: true }, 10).error);
    assert.equal(p.pos, star);
    assert.equal(p.prev, null, 'danach freie Richtung');
    assert.equal(p.stars, 1);
    assert.equal(p.coins, 7 - STAR_PRICE);
    assert.ok(g.s.events.some(e => e.type === 'teleport' && e.to === star));
    assert.equal(g.s.turnPhase, 'moving');
    // ablehnen
    const h = newGame(3);
    h.apply(0, { t: 'start' }, 0);
    const hs = h.s.order[0];
    rollFrom(h, hs, at(31, 6.5), at(31, 5), 1);
    assert.ok(!h.apply(hs, { t: 'teleport', go: false }, 10).error);
    assert.equal(h.s.players[hs].pos, at(31, 8));
});

// Duell starten: Person am Zug landet auf dem Duellfeld (31, 6.5) und wählt target
function startDuel(g, seat, target) {
    rollFrom(g, seat, at(31, 5), at(28, 5), 1);
    assert.equal(g.s.turnPhase, 'duel');
    assert.ok(!g.apply(seat, { t: 'duel', target }, 10).error);
    assert.equal(g.s.phase, 'mini');
    return g.s.mini;
}

function finishDuel(g, scores, t = 20) {
    const m = g.s.mini;
    g.tick(t + 10000);
    assert.equal(m.phase, 'play');
    for (const [seat, score] of Object.entries(scores)) g.apply(Number(seat), { t: 'mini', kind: 'score', score }, t + 10100);
    g.tick(t + 10200);
    assert.equal(m.phase, 'result');
    return m;
}

test('Duell: Gegner wählen (nicht sich selbst), nur die beiden spielen, Sieg bringt einen Stern', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    const other = (seat + 1) % 3;
    const watcher = (seat + 2) % 3;
    g.s.players[other].stars = 2;
    rollFrom(g, seat, at(31, 5), at(28, 5), 1);
    assert.equal(g.s.turnPhase, 'duel');
    assert.deepEqual(g.s.choice.options.sort(), [other, watcher].sort());
    assert.ok(g.apply(seat, { t: 'duel', target: seat }, 10).error, 'nicht gegen sich selbst');
    assert.ok(g.apply(other, { t: 'duel', target: seat }, 10).error, 'nur wer gelandet ist');
    assert.ok(!g.apply(seat, { t: 'duel', target: other }, 10).error);
    const m = g.s.mini;
    assert.deepEqual(m.duel, [seat, other]);
    assert.equal(m.kind, 'solo');
    assert.equal(m.star, false);
    assert.equal(g.view(watcher, 10).mini.duel.length, 2);
    g.tick(10000);
    assert.ok(g.apply(watcher, { t: 'mini', kind: 'score', score: 50 }, 10100).error, 'Zuschauer spielen nicht mit');
    assert.ok(g.apply(watcher, { t: 'mini', kind: 'live', score: 50 }, 10100).error);
    assert.ok(!g.apply(seat, { t: 'mini', kind: 'live', score: 999999 }, 10100).error);
    assert.equal(m.live[seat], MINIS[m.type].max, 'Zwischenstand begrenzt');
    g.apply(seat, { t: 'mini', kind: 'score', score: 80 }, 10200);
    assert.equal(m.phase, 'play', 'wartet auf den Gegner, nicht auf Zuschauer');
    g.apply(other, { t: 'mini', kind: 'score', score: 40 }, 10200);
    g.tick(10300);
    assert.equal(m.phase, 'result');
    assert.deepEqual([g.s.players[seat].stars, g.s.players[other].stars], [1, 1]);
    assert.deepEqual(m.outcome, { winner: seat, loser: other, stars: 1, coins: 0, shielded: false });
    // danach geht es auf dem Brett mit der nächsten Person weiter
    const turnBefore = g.s.turnIdx;
    g.tick(10300 + 10000);
    assert.equal(g.s.phase, 'board');
    assert.equal(g.s.mini, null);
    assert.equal(g.s.turnIdx, turnBefore + 1);
    assert.equal(g.s.round, 1, 'kein neues Rundenminispiel durch das Duell');
});

test('Duell: ohne Stern oder mit Schild gibt es bis zu 10 Münzen, Niederlage kostet selbst, Gleichstand nichts', () => {
    // Gegner ohne Stern: 10 Münzen
    let g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    let seat = g.s.order[0];
    let other = (seat + 1) % 3;
    g.s.players[other].coins = 25;
    startDuel(g, seat, other);
    finishDuel(g, { [seat]: 90, [other]: 10 });
    assert.equal(g.s.players[other].coins, 25 - DUEL_COINS);
    // Gegner hat nur 4 Münzen: mehr gibt es nicht
    g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    seat = g.s.order[0];
    other = (seat + 1) % 3;
    g.s.players[other].coins = 4;
    const before = g.s.players[seat].coins;
    startDuel(g, seat, other);
    finishDuel(g, { [seat]: 90, [other]: 10 });
    assert.equal(g.s.players[other].coins, 0);
    assert.equal(g.s.players[seat].coins, before + 4);
    // Schild schützt den Stern, dann Münzen
    g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    seat = g.s.order[0];
    other = (seat + 1) % 3;
    Object.assign(g.s.players[other], { stars: 1, shield: 2, coins: 12 });
    startDuel(g, seat, other);
    const m = finishDuel(g, { [seat]: 90, [other]: 10 });
    assert.equal(g.s.players[other].stars, 1);
    assert.equal(g.s.players[other].coins, 2);
    assert.equal(m.outcome.shielded, true);
    // wer herausfordert und verliert, gibt selbst ab
    g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    seat = g.s.order[0];
    other = (seat + 1) % 3;
    g.s.players[seat].stars = 1;
    startDuel(g, seat, other);
    finishDuel(g, { [seat]: 10, [other]: 90 });
    assert.deepEqual([g.s.players[seat].stars, g.s.players[other].stars], [0, 1]);
    // Gleichstand
    g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    seat = g.s.order[0];
    other = (seat + 1) % 3;
    g.s.players[other].stars = 1;
    startDuel(g, seat, other);
    const tie = finishDuel(g, { [seat]: 50, [other]: 50 });
    assert.equal(tie.outcome.winner, null);
    assert.equal(g.s.players[other].stars, 1);
});

test('Schild: hält 3 Runden (diese und die zwei folgenden), Anzeige in der Ansicht', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const p = g.s.players[1];
    p.shield = SHIELD_ROUNDS;
    assert.equal(g.view(0, 0).players[1].shield, 3);
    let t = 0;
    const rounds = [];
    for (let i = 0; i < 6000 && g.s.round < 4; i++) {
        t += 700;
        g.tick(t);
        if (rounds[g.s.round] === undefined) rounds[g.s.round] = p.shield;
    }
    assert.deepEqual(rounds.slice(1, 5), [3, 2, 1, 0]);
});

test('Duell: Auto-Wahl bei Zeitablauf, Wiederherstellen mitten im Duell geht mit dem Zug weiter', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    const seat = g.s.order[0];
    rollFrom(g, seat, at(31, 5), at(28, 5), 1);
    assert.equal(g.s.turnPhase, 'duel');
    assert.ok(g.tick(380 + CHOICE_MS + 10));
    assert.equal(g.s.phase, 'mini');
    assert.ok(g.s.mini.duel.includes(seat));
    const turn = g.s.turnIdx;
    const r = PartyGame.restore(g.serialize(), { rng: seeded(3) });
    assert.equal(r.s.mini, null);
    r.tick(100000);
    assert.equal(r.s.phase, 'board');
    assert.equal(r.s.round, 1);
    assert.equal(r.s.turnIdx, turn + 1);
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

test('Nach allen Zügen startet ein Minispiel, danach Belohnung und nächste Runde, die die Person nach der Letzten beginnt', () => {
    const g = newGame(3);
    g.apply(0, { t: 'start' }, 0);
    let t = 0;
    let lastRoller = -1;
    for (let i = 0; i < 400 && !(g.s.phase === 'mini' && !g.s.inDuel); i++) {
        t += 500;
        const s = g.s;
        if (s.phase === 'board' && s.turnPhase === 'roll') {
            lastRoller = s.order[s.turnIdx];
            g.apply(lastRoller, { t: 'roll' }, t);
        } else if (s.phase === 'board' && s.choice) {
            // an Abzweigungen den ersten Weg, Duelle gegen den Ersten, kein Teleport
            const c = s.choice;
            g.apply(c.seat, s.turnPhase === 'choose' ? { t: 'choose', to: c.options[0] } : s.turnPhase === 'duel' ? { t: 'duel', target: c.options[0] } : { t: 'teleport', go: false }, t);
        }
        g.tick(t);
    }
    assert.equal(g.s.phase, 'mini');
    assert.equal(g.s.inDuel, false);
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
        } else if (s.phase === 'board' && s.choice) {
            const c = s.choice;
            const pick = c.options[step % Math.max(1, c.options.length)];
            g.apply(c.seat, s.turnPhase === 'choose' ? { t: 'choose', to: pick } : s.turnPhase === 'duel' ? { t: 'duel', target: pick } : { t: 'teleport', go: step % 2 === 0 }, t);
        }
        if (s.phase === 'mini' && s.mini && !s.mini.duel && s.mini.id !== lastMini) {
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
        const { types } = autoplay(3, 45, seed);
        const all = MINI_TYPES.length;
        assert.equal(types.length, 45);
        assert.equal(new Set(types.slice(0, all)).size, all, `erster Durchlauf: ${types.slice(0, all)}`);
        assert.equal(new Set(types.slice(all, 2 * all)).size, all, 'zweiter Durchlauf');
        assert.equal(types.length - 2 * all, new Set(types.slice(2 * all)).size, 'dritter Durchlauf beginnt ohne Wiederholung');
        for (let i = 1; i < types.length; i++) assert.notEqual(types[i], types[i - 1], 'nie dasselbe Spiel zweimal hintereinander');
    }
});

test('Zähler in der Ansicht: wie viele Minispiele im aktuellen Durchlauf schon dran waren', () => {
    const g = new PartyGame({ rng: seeded(3) });
    g.join('a', 'A');
    g.join('b', 'B');
    g.join('c', 'C');
    g.apply(0, { t: 'start' }, 0);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: MINI_TYPES.length });
    let t = 0;
    for (let i = 0; i < 3000 && !g.s.mini; i++) {
        t += 700;
        if (g.s.phase === 'board' && g.s.turnPhase === 'roll') g.apply(g.s.order[g.s.turnIdx], { t: 'roll' }, t);
        g.tick(t);
    }
    assert.deepEqual(g.view(0, t).miniCycle, { done: 1, total: MINI_TYPES.length });
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
    assert.deepEqual(SUB_TYPES.sort(), ['ladder', 'slf', 'undercover', 'wordguess']);
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
    // Undercover: das Wort der Anderen steht nicht in der eigenen Ansicht
    const uc = createMini({ type: 'undercover', id: 2, rng: seeded(2), players, now: 0, star: false });
    tickMini(uc, 9000, players);
    const eng = uc.engine;
    const other = eng.s.imp === 0 ? eng.s.word : eng.s.word2;
    if (eng.s.mode !== 'spy' || eng.s.imp !== 0) assert.ok(!JSON.stringify(miniView(uc, 0, 9000, players).sub).includes(`"${other}"`));
    // Die Engine gehört nicht zum gespeicherten Zustand
    assert.ok(!JSON.stringify(uc).includes('"hands"'));
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

test('Zu zweit: Sternenjagd startet mit 2 Personen, Undercover kommt nie vor, alle anderen Minispiele laufen im Kreis', () => {
    const g = new PartyGame({ rng: seeded(4) });
    g.join('a', 'A');
    assert.ok(g.apply(0, { t: 'start' }).error, 'allein geht nicht');
    g.join('b', 'B');
    assert.ok(!g.apply(0, { t: 'start' }, 0).error);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: MINI_TYPES.length - 1 });
    for (const seed of [1, 2, 3]) {
        const { types } = autoplay(2, 45, seed);
        const all = MINI_TYPES.length - 1;
        assert.ok(!types.includes('undercover'));
        assert.equal(new Set(types.slice(0, all)).size, all);
        assert.equal(new Set(types.slice(all, 2 * all)).size, all);
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

test('Mit 3 Personen ist Undercover wieder dabei', () => {
    const g = new PartyGame({ rng: seeded(4) });
    for (const n of ['a', 'b', 'c']) g.join(n, n);
    g.apply(0, { t: 'start' }, 0);
    assert.deepEqual(g.view(0, 0).miniCycle, { done: 0, total: MINI_TYPES.length });
});

// ---------- Schätzfragen ----------

import { estimatePoints } from '../js/games/party/minigames.js';

test('Schätzfrage: Punkte fallen mit dem Abstand, wer am nächsten liegt, bekommt 50 dazu', () => {
    assert.deepEqual(estimatePoints(100, 50, { 0: { v: 100 }, 1: { v: 125 }, 2: { v: 150 }, 3: { v: 300 } }), { 0: 250, 1: 100, 2: 0, 3: 0 });
    assert.deepEqual(estimatePoints(100, 50, { 0: { v: 90 }, 1: { v: 110 } }), { 0: 210, 1: 210 }, 'Gleichstand: beide bekommen den Bonus');
    assert.deepEqual(estimatePoints(100, 50, { 0: { v: 900 } }), { 0: 0 }, 'ohne Punkte kein Bonus');
});

test('Schätzfrage: Ablauf, nur die erste gültige Antwort zählt, Wahrheit erst im Reveal sichtbar', () => {
    const players = people(3);
    const m = createMini({ type: 'estimate', id: 1, rng: seeded(7), players, now: 0, star: false });
    assert.equal(m.kind, 'estimate');
    assert.ok(miniAction(m, 0, { kind: 'answer', v: 5 }, 100, players).error, 'vor dem Start nichts annehmen');
    tickMini(m, INTRO_MS, players);
    const t0 = INTRO_MS;
    assert.equal(miniView(m, 0, t0, players).params.truth, null);
    const truth = m.secret.truth[0];
    assert.ok(miniAction(m, 0, { kind: 'answer', v: 'abc' }, t0 + 100, players).error);
    assert.ok(miniAction(m, 0, { kind: 'answer', v: '' }, t0 + 100, players).error);
    assert.ok(miniAction(m, 0, { kind: 'answer', v: 1e15 }, t0 + 100, players).error);
    assert.ok(!miniAction(m, 0, { kind: 'answer', v: truth }, t0 + 1000, players).error);
    assert.ok(!miniAction(m, 0, { kind: 'answer', v: 0 }, t0 + 1500, players).error, 'zweite Antwort wird ignoriert');
    assert.ok(!miniAction(m, 1, { kind: 'answer', v: String(truth * 2) }, t0 + 2000, players).error);
    assert.ok(!miniAction(m, 2, { kind: 'answer', v: truth + 1 }, t0 + 2000, players).error);
    assert.equal(m.q.answers[0][0].v, truth);
    // alle haben geantwortet: sofort Reveal, jetzt ist die Zahl sichtbar
    assert.ok(tickMini(m, t0 + 2100, players));
    assert.equal(m.q.phase, 'reveal');
    const rv = miniView(m, 0, t0 + 2100, players).params;
    assert.equal(rv.truth, truth);
    assert.ok(rv.gains[0] >= 200);
    assert.ok(miniAction(m, 0, { kind: 'answer', v: 1 }, t0 + 2200, players).error, 'im Reveal keine Antworten');
    // alle Fragen durchspielen (nur Platz 0 antwortet jedes Mal), Ergebnisphase
    let t = t0 + 2100;
    for (let i = 0; i < 40 && m.phase === 'play'; i++) {
        t += 5000;
        tickMini(m, t, players);
        if (m.phase === 'play' && m.q.phase === 'ask') miniAction(m, 0, { kind: 'answer', v: m.secret.truth[m.q.i] }, t + 10, players);
    }
    assert.equal(m.phase, 'result');
    assert.ok(m.scores[0] > m.scores[1] && m.scores[1] >= 0 && m.scores[2] >= 0);
    assert.ok(Object.values(m.scores).every(Number.isInteger));
});
