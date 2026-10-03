import test from 'node:test';
import assert from 'node:assert/strict';
import { UndercoverGame, REVEAL_MS, CLUE_MS, VOTE_MS, RESULT_MS, GUESS_MS, FIRST_CLUE_ROUNDS } from '../js/games/undercover/engine.js';
import { PAIRS, SPY_WORDS } from '../js/games/undercover/words.js';

function seeded(seed = 1) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function room(n = 4, seed = 5, mode = 'undercover') {
    const g = new UndercoverGame({ rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    if (mode !== 'undercover') assert.ok(!g.apply(0, { t: 'setMode', mode }).error);
    return g;
}

function everyoneReady(g, now = 0) {
    for (let i = 0; i < g.s.players.length; i++) g.apply(i, { t: 'ready' }, now);
}

// Alle geben reihum einen Hinweis ab, bis die Abstimmung beginnt
function giveAllClues(g, now = 0) {
    let guard = 0;
    while (g.s.phase === 'clues' && guard++ < 100) {
        const seat = g.s.order[g.s.turnIdx];
        const r = g.apply(seat, { t: 'clue', text: 'hinweis' + guard }, now);
        assert.ok(!r.error, r.error);
    }
}

test('Wortpaare: keine gleichen Wörter, keine doppelten Paare', () => {
    assert.ok(PAIRS.length >= 120);
    const seen = new Set();
    for (const [a, b] of PAIRS) {
        assert.notEqual(a, b);
        const key = [a, b].sort().join('|');
        assert.ok(!seen.has(key), `doppelt: ${key}`);
        seen.add(key);
    }
    assert.ok(SPY_WORDS.length >= 200);
});

test('Start: ab 3 Personen, genau eine Person bekommt das andere Wort', () => {
    const g = room(2);
    g.join('x', 'X');
    assert.ok(g.apply(0, { t: 'start' }, 0).error === undefined);
    assert.equal(g.s.phase, 'reveal');
    const words = g.s.players.map((p, i) => g.wordOf(i));
    assert.equal(words.filter(w => w === g.s.word2).length, 1);
    assert.equal(words.filter(w => w === g.s.word).length, 2);
    assert.ok(PAIRS.some(([a, b]) => (a === g.s.word && b === g.s.word2) || (b === g.s.word && a === g.s.word2)));
    assert.equal(g.s.players[g.s.imp].alive, true);
});

test('Ansicht Undercover: niemand erfährt seine Rolle vorab, nur das eigene Wort', () => {
    const g = room(4);
    g.apply(0, { t: 'start' }, 0);
    for (let i = 0; i < 4; i++) {
        const v = g.view(i, 0);
        assert.equal(v.word, g.wordOf(i));
        assert.equal(v.isSpy, false);
        assert.equal(v.roles, null);
        const json = JSON.stringify(v);
        const other = i === g.s.imp ? g.s.word : g.s.word2;
        assert.ok(!json.includes(`"${other}"`), 'fremdes Wort in der Ansicht');
    }
});

test('Spion: der Spion hat kein Wort und weiß es, die anderen kennen das Wort', () => {
    const g = room(4, 9, 'spy');
    g.apply(0, { t: 'start' }, 0);
    const spy = g.s.imp;
    assert.equal(g.view(spy, 0).word, null);
    assert.equal(g.view(spy, 0).isSpy, true);
    assert.ok(!JSON.stringify(g.view(spy, 0)).includes(g.s.word), 'Spion kennt das Wort nicht');
    for (let i = 0; i < 4; i++) if (i !== spy) assert.equal(g.view(i, 0).word, g.s.word);
});

test('Ablauf bis zur Abstimmung: Bereit → 2 Hinweisrunden, jeder nur im eigenen Zug', () => {
    const g = room(4);
    g.apply(0, { t: 'start' }, 0);
    assert.ok(g.apply(0, { t: 'clue', text: 'x' }, 0).error, 'noch nicht dran');
    everyoneReady(g);
    assert.equal(g.s.phase, 'clues');
    const first = g.s.order[0];
    const other = g.s.order[1];
    assert.ok(g.apply(other, { t: 'clue', text: 'hallo' }, 0).error);
    assert.ok(g.apply(first, { t: 'clue', text: '' }, 0).error);
    assert.ok(g.apply(first, { t: 'clue', text: 'eins zwei drei vier' }, 0).error);
    assert.ok(g.apply(first, { t: 'clue', text: `ein ${g.wordOf(first).toUpperCase()}` }, 0).error, 'eigenes Wort verboten');
    assert.ok(!g.apply(first, { t: 'clue', text: 'passt' }, 0).error);
    assert.equal(g.s.turnIdx, 1);
    for (let r = 1; r <= FIRST_CLUE_ROUNDS; r++) {
        assert.equal(g.s.clueRound, r);
        while (g.s.phase === 'clues' && g.s.clueRound === r) g.apply(g.s.order[g.s.turnIdx], { t: 'clue', text: 'wort' + g.s.turnIdx }, 0);
        if (r < FIRST_CLUE_ROUNDS) assert.equal(g.s.phase, 'clues');
    }
    assert.equal(g.s.phase, 'vote');
    assert.equal(g.s.clues.length, 4 * FIRST_CLUE_ROUNDS);
});

function toVote(g) {
    g.apply(0, { t: 'start' }, 0);
    everyoneReady(g);
    giveAllClues(g);
    assert.equal(g.s.phase, 'vote');
}

test('Abstimmung: nicht für sich selbst, änderbar, endet wenn alle gewählt haben', () => {
    const g = room(4);
    toVote(g);
    assert.ok(g.apply(0, { t: 'vote', target: 0 }).error);
    assert.ok(g.apply(0, { t: 'vote', target: 9 }).error);
    const imp = g.s.imp;
    const civ = [0, 1, 2, 3].filter(i => i !== imp);
    assert.ok(!g.apply(civ[0], { t: 'vote', target: civ[1] }).error);
    assert.ok(!g.apply(civ[0], { t: 'vote', target: imp }).error, 'Wahl ändern');
    assert.equal(g.s.phase, 'vote');
    for (const i of [0, 1, 2, 3]) if (i !== civ[0]) g.apply(i, { t: 'vote', target: i === imp ? civ[0] : imp });
    assert.equal(g.s.phase, 'over');
});

test('Undercover enttarnt: die Gruppe gewinnt, Siege werden gezählt', () => {
    const g = room(4);
    toVote(g);
    const imp = g.s.imp;
    for (let i = 0; i < 4; i++) if (i !== imp) g.apply(i, { t: 'vote', target: imp });
    g.apply(imp, { t: 'vote', target: (imp + 1) % 4 });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.outcome.winner, 'civ');
    assert.ok(g.s.elim.wasImp);
    assert.deepEqual(g.s.players.map(p => p.wins), g.s.players.map((p, i) => (i === imp ? 0 : 1)));
    const v = g.view(0, 0);
    assert.equal(v.roles[imp], 'imp');
    assert.equal(v.words.imp, g.s.word2);
});

test('Falsche Person gewählt: weiter mit 1 Hinweisrunde; bei nur noch 2 Übrigen gewinnt der Undercover', () => {
    const g = room(4);
    toVote(g);
    const imp = g.s.imp;
    const civ = [0, 1, 2, 3].filter(i => i !== imp);
    const victim = civ[0];
    for (let i = 0; i < 4; i++) if (i !== victim) g.apply(i, { t: 'vote', target: victim });
    g.apply(victim, { t: 'vote', target: imp });
    assert.equal(g.s.phase, 'result');
    assert.equal(g.s.players[victim].alive, false);
    everyoneReady(g);
    assert.equal(g.s.phase, 'clues');
    assert.equal(g.s.order.length, 3);
    assert.ok(!g.s.order.includes(victim), 'Ausgeschiedene geben keine Hinweise');
    giveAllClues(g);
    assert.equal(g.s.phase, 'vote', 'nach dem Fehlversuch nur noch eine Hinweisrunde');
    const victim2 = civ[1];
    for (const i of [imp, civ[2]]) g.apply(i, { t: 'vote', target: victim2 });
    assert.ok(g.apply(victim, { t: 'vote', target: imp }).error, 'Ausgeschiedene stimmen nicht mehr ab');
    g.apply(victim2, { t: 'vote', target: imp });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.outcome.winner, 'imp');
});

test('Mit 3 Personen reicht ein falscher Verdacht und der Undercover gewinnt', () => {
    const g = room(3);
    toVote(g);
    const imp = g.s.imp;
    const civ = [0, 1, 2].filter(i => i !== imp);
    g.apply(civ[0], { t: 'vote', target: civ[1] });
    g.apply(civ[1], { t: 'vote', target: civ[0] });
    g.apply(imp, { t: 'vote', target: civ[0] });
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.outcome.winner, 'imp');
});

test('Gleichstand: das Los entscheidet, niemand bleibt ohne Ergebnis', () => {
    const g = room(4, 3);
    toVote(g);
    g.apply(0, { t: 'vote', target: 1 });
    g.apply(1, { t: 'vote', target: 0 });
    g.apply(2, { t: 'vote', target: 0 });
    g.apply(3, { t: 'vote', target: 1 });
    assert.ok(g.s.elim);
    assert.ok(g.s.elim.tie);
    assert.ok([0, 1].includes(g.s.elim.seat));
});

test('Spion enttarnt: er darf raten; richtiges Wort (tippfehlertolerant) gibt ihm den Sieg, falsches nicht', () => {
    for (const [guessRight, expected] of [[true, 'imp'], [false, 'civ']]) {
        const g = room(4, 11, 'spy');
        toVote(g);
        const spy = g.s.imp;
        for (let i = 0; i < 4; i++) g.apply(i, { t: 'vote', target: i === spy ? (spy + 1) % 4 : spy });
        assert.equal(g.s.phase, 'guess');
        assert.ok(g.apply((spy + 1) % 4, { t: 'guess', text: g.s.word }).error, 'nur der Spion rät');
        const word = g.s.word;
        const text = guessRight ? word.toLowerCase() : 'völlig anderes Wort';
        assert.ok(!g.apply(spy, { t: 'guess', text }).error);
        assert.equal(g.s.phase, 'over');
        assert.equal(g.s.outcome.winner, expected, word);
    }
});

test('Zeitüberschreitungen: Hinweis wird übersprungen, Abstimmung gezählt, Raten endet', () => {
    const g = room(4, 2, 'spy');
    g.apply(0, { t: 'start' }, 0);
    assert.equal(g.tick(REVEAL_MS - 1), false);
    assert.equal(g.tick(REVEAL_MS), true);
    assert.equal(g.s.phase, 'clues');
    assert.equal(g.tick(REVEAL_MS + CLUE_MS - 1), false);
    let t = REVEAL_MS;
    for (let i = 0; i < 4 * FIRST_CLUE_ROUNDS; i++) {
        t += CLUE_MS;
        assert.equal(g.tick(t), true);
    }
    assert.equal(g.s.phase, 'vote');
    assert.ok(g.s.clues.every(c => c.text === '–'));
    t += VOTE_MS;
    g.tick(t);
    assert.ok(['result', 'guess', 'over'].includes(g.s.phase));
    if (g.s.phase === 'guess') {
        t += GUESS_MS;
        g.tick(t);
        assert.equal(g.s.phase, 'over');
    }
});

test('Nicht verbundene Person wird beim Hinweis rasch übersprungen', () => {
    const g = room(4);
    g.apply(0, { t: 'start' }, 0);
    everyoneReady(g, 0);
    g.setConnected(g.s.order[0], false);
    assert.equal(g.tick(1000), false);
    assert.equal(g.tick(4000), true);
    assert.equal(g.s.turnIdx, 1);
});

test('Neustart: neue Wörter, alle wieder dabei, Siege bleiben; Variante wechselbar', () => {
    const g = room(3);
    toVote(g);
    const first = g.s.word;
    const imp = g.s.imp;
    for (let i = 0; i < 3; i++) g.apply(i, { t: 'vote', target: i === imp ? (imp + 1) % 3 : imp });
    assert.equal(g.s.phase, 'over');
    assert.ok(!g.apply(0, { t: 'setMode', mode: 'spy' }).error);
    assert.ok(!g.apply(1, { t: 'rematch' }, 0).error);
    assert.equal(g.s.phase, 'reveal');
    assert.equal(g.s.mode, 'spy');
    assert.ok(g.s.players.every(p => p.alive));
    assert.ok(g.s.usedWords.includes(first));
    assert.equal(g.s.players.reduce((n, p) => n + p.wins, 0), 2);
});

test('Zufallsspiele laufen immer bis zum Ende', () => {
    for (let seed = 1; seed <= 150; seed++) {
        const rng = seeded(seed * 13);
        const n = 3 + Math.floor(rng() * 4);
        const g = room(n, seed, seed % 2 ? 'spy' : 'undercover');
        g.apply(0, { t: 'start' }, 0);
        let t = 0;
        for (let step = 0; step < 800 && g.s.phase !== 'over'; step++) {
            t += 400 + Math.floor(rng() * 20000);
            const s = g.s;
            const seat = Math.floor(rng() * n);
            if (rng() < 0.03) g.setConnected(seat, rng() < 0.5);
            if (s.phase === 'reveal' || s.phase === 'result') g.apply(seat, { t: 'ready' }, t);
            else if (s.phase === 'clues') g.apply(s.order[s.turnIdx], { t: 'clue', text: ['Apfel', 'grün', 'sehr weit weg', ''][Math.floor(rng() * 4)] }, t);
            else if (s.phase === 'vote') g.apply(seat, { t: 'vote', target: Math.floor(rng() * n) }, t);
            else if (s.phase === 'guess') g.apply(seat, { t: 'guess', text: ['x', s.word][Math.floor(rng() * 2)] }, t);
            g.tick(t);
            if (s.phase === 'clues') assert.ok(s.players[s.order[s.turnIdx]].alive);
            assert.ok(s.players.filter(p => p.alive).length >= 2 || s.phase === 'over');
            for (let q = 0; q < n; q++) JSON.stringify(g.view(q, t));
        }
        assert.equal(g.s.phase, 'over', `Seed ${seed}`);
        assert.ok(g.s.outcome);
    }
});
