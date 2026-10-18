import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_KEYS, TERMS } from '../js/games/sketch/words.js';
import {
    SketchGame, makeBoard, LENGTH_OPTIONS, CHOOSE_MS, ROLL_MS, MOVE_MS, FAIL_MS, MAX_STREAK, FIRST_STEPS, OTHER_STEPS, ALL_STEPS, HINT_SHARE,
} from '../js/games/sketch/engine.js';
import { normalize } from '../js/games/songquiz/answer.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 3, seed = 3) {
    const g = new SketchGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    return g;
}

const ok = r => assert.ok(!r.error, r.error);

// Startet das Spiel und wählt den ersten Begriff
function started(n = 3, { teams = false, seed = 3 } = {}) {
    const g = room(n, seed);
    if (teams) ok(g.apply(0, { t: 'teamMode', on: true }));
    ok(g.apply(0, { t: 'start' }, 0));
    return g;
}

function choose(g, now = 0) {
    ok(g.apply(g.s.turn.drawer, { t: 'choose', i: 0 }, now));
    return g.s.turn.word;
}

test('Begriffe: fünf Kategorien, genug Begriffe, kein Begriff doppelt', () => {
    assert.deepEqual(CATEGORY_KEYS, ['G', 'L', 'T', 'S', 'A']);
    const seen = new Map();
    for (const cat of CATEGORY_KEYS) {
        assert.ok(CATEGORIES[cat].name && CATEGORIES[cat].color);
        assert.ok(TERMS[cat].length >= 60, `${cat}: nur ${TERMS[cat].length}`);
        for (const term of TERMS[cat]) {
            for (const k of term.split('|')) {
                const key = normalize(k);
                assert.ok(key, term);
                assert.ok(!seen.has(key), `doppelt: ${k} (${seen.get(key)} und ${cat})`);
                seen.set(key, cat);
            }
        }
    }
});

test('Spielbrett: Start, Ziel, Kategorien im Wechsel, Alle-Felder nicht am Rand', () => {
    for (const n of LENGTH_OPTIONS) {
        const b = makeBoard(n);
        assert.equal(b.length, n);
        assert.ok(b[0].start);
        assert.ok(b[n - 1].goal);
        assert.ok(b.some(f => f.all));
        assert.ok(!b[0].all && !b[n - 1].all && !b[n - 2].all);
        for (const cat of CATEGORY_KEYS) assert.ok(b.some(f => f.cat === cat && !f.start && !f.goal), cat);
    }
});

test('Einstellungen nur vom Host und nur im Warteraum', () => {
    const g = room(2);
    assert.ok(g.apply(1, { t: 'setLength', n: 25 }).error);
    ok(g.apply(0, { t: 'setLength', n: 25 }));
    assert.ok(g.apply(0, { t: 'setLength', n: 30 }).error);
    ok(g.apply(0, { t: 'setTime', n: 90 }));
    assert.ok(g.apply(0, { t: 'setTime', n: 10 }).error);
    ok(g.apply(0, { t: 'start' }, 0));
    assert.equal(g.s.board.length, 25);
    assert.equal(g.s.drawSec, 90);
    assert.ok(g.apply(0, { t: 'setLength', n: 49 }).error);
});

test('Zu zweit spielbar; Begriff auswählen, nur die zeichnende Person sieht ihn', () => {
    const g = started(2);
    assert.equal(g.s.phase, 'choose');
    const d = g.s.turn.drawer;
    const other = 1 - d;
    assert.equal(g.view(d, 0).turn.options.length, 2);
    assert.equal(g.view(other, 0).turn.options, null);
    assert.ok(g.apply(other, { t: 'choose', i: 0 }, 0).error);
    assert.ok(g.apply(d, { t: 'choose', i: 2 }, 0).error);
    ok(g.apply(d, { t: 'choose', i: 1 }, 100));
    assert.equal(g.s.phase, 'draw');
    assert.equal(g.view(d, 100).turn.word, g.s.turn.word);
    assert.equal(g.view(other, 100).turn.word, null);
    assert.ok(g.view(other, 100).turn.mask.includes('•'));
    assert.equal(g.view(other, 100).turn.role, 'guess');
    assert.equal(g.view(d, 100).turn.role, 'draw');
});

test('Ohne Auswahl nimmt das Spiel nach Ablauf den ersten Begriff', () => {
    const g = started(3);
    g.tick(CHOOSE_MS - 1);
    assert.equal(g.s.phase, 'choose');
    assert.ok(g.tick(CHOOSE_MS));
    assert.equal(g.s.phase, 'draw');
    assert.ok(g.s.turn.word);
});

test('Einzeln: erster Treffer 2 Felder, weitere 1 Feld, Zeichner würfelt', () => {
    const g = started(3);
    const d = g.s.turn.drawer;
    const [a, b] = [0, 1, 2].filter(i => i !== d);
    const word = choose(g);
    assert.ok(g.apply(d, { t: 'guess', text: word }, 10).error, 'Zeichner rät nicht');
    ok(g.apply(a, { t: 'guess', text: 'ganz falsch xyz' }, 10));
    assert.equal(g.s.phase, 'draw');
    assert.deepEqual(g.view(b, 10).turn.feed.map(f => f.ok), [false]);
    const r = g.apply(a, { t: 'guess', text: word.toUpperCase() }, 20);
    assert.equal(r.notice, 'Richtig!');
    assert.ok(g.apply(a, { t: 'guess', text: word }, 21).error, 'nur einmal');
    assert.equal(g.s.phase, 'draw', 'b rät noch');
    ok(g.apply(b, { t: 'guess', text: word }, 30));
    assert.equal(g.s.phase, 'reveal', 'alle haben es');
    assert.ok(g.s.turn.rollPending);
    assert.equal(g.view(a, 30).turn.word, word, 'Auflösung zeigt den Begriff');
    assert.ok(g.apply(a, { t: 'roll' }, 31).error, 'nur der Zeichner würfelt');
    ok(g.apply(d, { t: 'roll' }, 31));
    const roll = g.s.turn.roll;
    assert.ok(roll >= 1 && roll <= 6);
    assert.equal(g.s.pos[d], roll);
    assert.equal(g.s.pos[a], FIRST_STEPS);
    assert.equal(g.s.pos[b], OTHER_STEPS);
    g.tick(31 + MOVE_MS);
    assert.equal(g.s.phase, 'choose');
    assert.notEqual(g.s.turn.drawer, d, 'nächste Person zeichnet');
});

test('Einzeln: niemand errät es, keiner zieht; Würfeln passiert sonst von selbst', () => {
    const g = started(3);
    const d = g.s.turn.drawer;
    choose(g);
    g.tick(g.s.drawSec * 1000);
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.s.turn.result, 'failed');
    assert.ok(!g.s.turn.rollPending);
    g.tick(g.s.drawSec * 1000 + FAIL_MS);
    assert.deepEqual(g.s.pos, [0, 0, 0]);
    assert.equal(g.s.turn.drawer, (d + 1) % 3);

    const word = choose(g, 100000);
    const guesser = [0, 1, 2].find(i => i !== g.s.turn.drawer);
    ok(g.apply(guesser, { t: 'guess', text: word }, 100010));
    ok(g.apply(g.s.turn.drawer, { t: 'giveUp' }, 100020));
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.s.turn.result, 'solved', 'ein Treffer reicht');
    g.tick(100020 + ROLL_MS);
    assert.ok(g.s.turn.roll > 0, 'automatisch gewürfelt');
});

test('Einzeln: Alle-Feld gibt jedem Treffer 2 Felder', () => {
    const g = started(3);
    const d = g.s.turn.drawer;
    g.s.pos[d] = 6;
    assert.ok(g.s.board[6].all);
    // Begriff neu aufsetzen, damit er vom Alle-Feld kommt
    g.s.turn.all = true;
    const word = choose(g);
    const [a, b] = [0, 1, 2].filter(i => i !== d);
    ok(g.apply(a, { t: 'guess', text: word }, 10));
    ok(g.apply(b, { t: 'guess', text: word }, 11));
    ok(g.apply(d, { t: 'roll' }, 12));
    assert.equal(g.s.pos[a], ALL_STEPS);
    assert.equal(g.s.pos[b], ALL_STEPS);
});

test('Anfangsbuchstaben erscheinen nach einem Teil der Zeit', () => {
    const g = started(2);
    const word = choose(g);
    const guesser = 1 - g.s.turn.drawer;
    const at = g.s.drawSec * 1000 * HINT_SHARE;
    assert.ok(!g.view(guesser, at - 1).turn.mask.includes(word[0]));
    assert.ok(g.tick(at));
    assert.ok(g.view(guesser, at).turn.mask.startsWith(word[0]));
});

test('Zeichnen: nur Zeichner, Striche werden geprüft, Rückgängig nimmt den ganzen Strich', () => {
    const g = started(2);
    const d = g.s.turn.drawer;
    assert.ok(g.apply(d, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2, 2] }).error, 'erst nach der Auswahl');
    choose(g);
    assert.ok(g.apply(1 - d, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2, 2] }).error);
    assert.ok(g.apply(d, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2] }).error);
    assert.ok(g.apply(d, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2, 1001] }).error);
    ok(g.apply(d, { t: 'stroke', sid: 1, c: 2, w: 14, p: [1, 1, 2, 2] }));
    ok(g.apply(d, { t: 'stroke', sid: 2, c: 99, w: 7, p: [5, 5, 6, 6] }));
    ok(g.apply(d, { t: 'stroke', sid: 2, c: 1, w: 3, p: [6, 6, 7, 7] }));
    const c = g.s.turn.canvases[d];
    assert.deepEqual(c.strokes[1], { sid: 2, c: 0, w: 6, p: [5, 5, 6, 6] }, 'ungültige Farbe/Breite werden ersetzt');
    ok(g.apply(d, { t: 'undo' }));
    assert.equal(c.strokes.length, 1);
    assert.equal(c.numbers, 4);
    const v = g.view(1 - d).turn.canvas;
    assert.equal(v.seat, d);
    assert.equal(v.strokes.length, 1);
    ok(g.apply(d, { t: 'clear' }));
    assert.equal(c.strokes.length, 0);
    assert.ok(c.version >= 5);
});

test('Teams: nur das eigene Team rät, bei Erfolg geht es weiter, höchstens drei Begriffe in Folge', () => {
    const g = started(4, { teams: true });
    for (let k = 0; k < MAX_STREAK; k++) {
        const t = g.s.turn;
        const team = t.unit;
        assert.equal(g.s.players[t.drawer].team, team);
        g.s.board[g.s.pos[team]].all = false;
        const word = choose(g);
        const mate = g.s.players.findIndex((p, i) => p.team === team && i !== t.drawer);
        const enemy = g.s.players.findIndex(p => p.team !== team);
        assert.equal(g.view(enemy).turn.role, 'watch');
        assert.ok(g.apply(enemy, { t: 'guess', text: word }).error, 'anderes Team rät nicht');
        ok(g.apply(mate, { t: 'guess', text: word }, 10));
        assert.equal(g.s.phase, 'reveal');
        assert.ok(g.apply(enemy, { t: 'roll' }, 11).error);
        ok(g.apply(mate, { t: 'roll' }, 11), 'jedes Teammitglied darf würfeln');
        assert.ok(g.s.pos[team] > 0);
        g.tick(11 + MOVE_MS);
        if (g.s.phase === 'over') return;
        if (k < MAX_STREAK - 1) assert.equal(g.s.turn.unit, team, 'gleiches Team zeichnet weiter');
        else assert.equal(g.s.turn.unit, 1 - team, 'nach drei Begriffen ist das andere Team dran');
    }
});

test('Teams: Zeichner wechseln sich ab, Fehlschlag gibt den Zug ab', () => {
    const g = started(4, { teams: true });
    const team = g.s.turn.unit;
    const first = g.s.turn.drawer;
    g.s.board[g.s.pos[team]].all = false;
    choose(g);
    g.tick(g.s.drawSec * 1000);
    g.tick(g.s.drawSec * 1000 + FAIL_MS);
    assert.equal(g.s.turn.unit, 1 - team);
    g.s.board[g.s.pos[1 - team]].all = false;
    choose(g);
    g.tick(500000);
    g.tick(500000 + FAIL_MS);
    assert.equal(g.s.turn.unit, team);
    assert.notEqual(g.s.turn.drawer, first, 'im Team zeichnet jetzt die andere Person');
});

test('Teams: Alle-Feld – beide Teams zeichnen, das schnellere gewinnt den Zug', () => {
    const g = room(4);
    ok(g.apply(0, { t: 'teamMode', on: true }));
    ok(g.apply(0, { t: 'start' }, 0));
    // Zug neu aufsetzen, mit der Figur auf einem Alle-Feld
    const team = g.s.turn.unit;
    g.s.pos[team] = 6;
    g.s.phase = 'reveal';
    g.s.turn.rollPending = false;
    g.s.turn.result = 'failed';
    g.s.curTeam = team;
    g.s.streak = 0;
    g.s.pos[1 - team] = 1;
    g.s.board[1].all = false;
    // Fehlschlag beim anderen Team bringt den Zug zurück zu "team"
    g.s.turn.unit = 1 - team;
    g.tick(g.s.deadline);
    const t = g.s.turn;
    assert.equal(t.unit, team);
    assert.ok(t.all);
    assert.equal(t.drawers.length, 2);
    assert.notEqual(g.s.players[t.drawers[0]].team, g.s.players[t.drawers[1]].team);
    const word = choose(g, 100);
    const enemyDrawer = t.drawers[1];
    const enemyMate = g.s.players.findIndex((p, i) => p.team === 1 - team && i !== enemyDrawer);
    assert.equal(g.view(enemyDrawer, 100).turn.word, word, 'beide Zeichner sehen den Begriff');
    assert.equal(g.view(enemyMate, 100).turn.canvas.seat, enemyDrawer, 'jedes Team sieht die eigene Zeichnung');
    ok(g.apply(enemyDrawer, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2, 2] }));
    ok(g.apply(enemyMate, { t: 'guess', text: 'falsch' }, 110));
    const mate = g.s.players.findIndex((p, i) => p.team === team && i !== t.drawer);
    assert.equal(g.view(mate, 110).turn.feed.length, 0, 'Rateversuche des anderen Teams bleiben verborgen');
    ok(g.apply(enemyMate, { t: 'guess', text: word }, 120));
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.s.turn.solvedUnit, 1 - team);
    ok(g.apply(enemyMate, { t: 'roll' }, 130));
    g.tick(130 + MOVE_MS);
    if (g.s.phase !== 'over') assert.equal(g.s.turn.unit, 1 - team, 'das schnellere Team ist jetzt dran');
});

test('Ziel erreicht: Spiel ist aus, Neustart setzt alles zurück', () => {
    const g = started(2);
    const d = g.s.turn.drawer;
    g.s.pos[d] = g.s.board.length - 2;
    const word = choose(g);
    ok(g.apply(1 - d, { t: 'guess', text: word }, 10));
    ok(g.apply(d, { t: 'roll' }, 11));
    assert.equal(g.s.pos[d], g.s.board.length - 1, 'nicht über das Ziel hinaus');
    assert.deepEqual(g.s.winners, [d]);
    g.tick(11 + MOVE_MS);
    assert.equal(g.s.phase, 'over');
    assert.equal(g.view(0).msLeft, null);
    ok(g.apply(1, { t: 'rematch' }, 20000));
    assert.equal(g.s.phase, 'choose');
    assert.deepEqual(g.s.pos, [0, 0]);
    assert.deepEqual(g.s.winners, []);
});

test('Abbruch: Zeichner weg beendet den Begriff; nach Neuladen wird neu ausgewählt', () => {
    const g = started(3);
    const d = g.s.turn.drawer;
    choose(g);
    g.setConnected(d, false);
    assert.ok(g.tick(10));
    assert.equal(g.s.phase, 'reveal');

    const h = started(3, { seed: 9 });
    choose(h);
    ok(h.apply(h.s.turn.drawer, { t: 'stroke', sid: 1, c: 0, w: 6, p: [1, 1, 2, 2] }));
    const restored = SketchGame.restore(h.serialize(), { rng: seeded(2) });
    assert.equal(restored.s.phase, 'choose');
    assert.equal(restored.s.turn.word, null);
    assert.equal(restored.s.turn.canvases[restored.s.turn.drawer].strokes.length, 0);
    assert.ok(restored.s.deadline > Date.now());
});

test('Spielverlauf mit Zufall: endet immer mit Sieger, keine Fehler', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const rng = seeded(seed * 7);
        const n = 2 + (seed % 5);
        const teams = n >= 4 && seed % 2 === 0;
        const g = started(n, { teams, seed });
        let now = 0;
        for (let step = 0; step < 4000 && g.s.phase !== 'over'; step++) {
            now += 700;
            const t = g.s.turn;
            if (g.s.phase === 'choose' && rng() < 0.5) g.apply(t.drawer, { t: 'choose', i: rng() < 0.5 ? 0 : 1 }, now);
            else if (g.s.phase === 'draw') {
                const seat = Math.floor(rng() * n);
                const x = rng();
                if (x < 0.3) g.apply(seat, { t: 'guess', text: rng() < 0.4 ? t.word : 'nope' }, now);
                else if (x < 0.4) g.apply(seat, { t: 'stroke', sid: step, c: 1, w: 6, p: [1, 2, 3, 4] }, now);
                else if (x < 0.42) g.apply(seat, { t: 'giveUp' }, now);
            } else if (g.s.phase === 'reveal' && rng() < 0.5) {
                g.apply(Math.floor(rng() * n), { t: 'roll' }, now);
            }
            g.tick(now);
            for (let i = 0; i < n; i++) JSON.stringify(g.view(i, now));
        }
        assert.equal(g.s.phase, 'over', `seed ${seed}`);
        assert.ok(g.s.winners.length >= 1);
        assert.ok(g.s.pos.every(p => p >= 0 && p < g.s.board.length));
    }
});
