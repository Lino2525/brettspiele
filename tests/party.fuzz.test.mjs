// Zufallstest: spielt komplette Sternenjagd-Spiele mit zufälligem Verhalten und prüft nach jedem Schritt die Grundregeln.
// Ausführen: node --test tests/party.fuzz.test.mjs   (mehr Spiele: FUZZ_GAMES=300 node --test ...)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyGame, STAR_PRICE } from '../js/games/party/engine.js';
import { NODES, STAR_SPOTS, nextOptions } from '../js/games/party/board.js';
import { MINIS } from '../js/games/party/minigames.js';

const GAMES = Number(process.env.FUZZ_GAMES) || 60;

function seeded(seed) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function checkInvariants(g, ctx) {
    const s = g.s;
    const fail = msg => assert.fail(`${msg}\n${ctx}\nLog: ${s.log.slice(-3).join(' | ')}`);
    for (const [i, p] of s.players.entries()) {
        if (!Number.isInteger(p.coins) || p.coins < 0) fail(`Münzen ungültig bei ${i}: ${p.coins}`);
        if (!Number.isInteger(p.stars) || p.stars < 0) fail(`Sterne ungültig bei ${i}: ${p.stars}`);
        if (!Number.isInteger(p.pos) || !NODES[p.pos]) fail(`Position ungültig bei ${i}: ${p.pos}`);
        if (p.prev !== null && !NODES[p.prev]) fail(`Herkunft ungültig bei ${i}: ${p.prev}`);
        if (!Number.isInteger(p.shield) || p.shield < 0 || p.shield > 3) fail(`Schild ungültig bei ${i}: ${p.shield}`);
    }
    if (!STAR_SPOTS.includes(s.star)) fail(`Stern liegt auf ungültigem Feld: ${s.star}`);
    if (s.phase === 'board' && s.turnPhase === 'choose') {
        const p = s.players[s.choice.seat];
        const opts = nextOptions(p.pos, p.prev);
        if (s.choice.options.some(o => !opts.includes(o)) || s.choice.options.length < 2) fail('Abzweigung mit ungültigen Möglichkeiten');
        if (!s.move || s.move.left < 1) fail('Abzweigung ohne verbleibende Schritte');
    }
    if (s.phase === 'board' && ['duel', 'teleport'].includes(s.turnPhase) && !s.choice) fail('Entscheidung ohne Auswahl');
    if (s.phase === 'mini' && s.mini?.duel && (s.mini.duel[0] === s.mini.duel[1] || !s.inDuel)) fail('Duell ungültig');
    if (!['waiting', 'board', 'mini', 'over'].includes(s.phase)) fail(`Phase ungültig: ${s.phase}`);
    if (s.phase === 'board') {
        if (s.turnIdx < 0 || s.turnIdx >= s.order.length) fail('turnIdx außerhalb der Reihenfolge');
        if (new Set(s.order).size !== s.players.length) fail('Reihenfolge enthält nicht alle Spieler genau einmal');
    }
    if (s.phase === 'mini' && s.mini && !MINIS[s.mini.type]) fail(`Unbekanntes Minispiel ${s.mini.type}`);
    // Ansicht muss für jeden Platz ohne Fehler erzeugbar sein und darf keine Geheimnisse enthalten
    for (let seat = 0; seat < s.players.length; seat++) {
        const json = JSON.stringify(g.view(seat, 0));
        if (json.includes('"token"')) fail('Token in der Ansicht');
        if (s.mini && (s.mini.kind === 'quiz' || s.mini.kind === 'estimate') && s.mini.phase === 'play' && s.mini.q.phase === 'ask' && json.includes('"secret"')) fail('Geheimnis in der Ansicht');
    }
}

const WORD = rng => ['Haus', 'Baum', 'Hund', 'xyz', ''][Math.floor(rng() * 5)];
function randomSubAction(type, rng, n) {
    const pick = list => list[Math.floor(rng() * list.length)];
    const seat = () => Math.floor(rng() * n);
    const answers = () => Array.from({ length: 8 }, () => WORD(rng));
    switch (type) {
        case 'slf': return pick([{ t: 'answers', list: answers() }, { t: 'stop', list: answers() }, { t: 'flag', p: seat(), c: Math.floor(rng() * 4) }, { t: 'ready' }, { t: 'start' }, { t: 'rematch' }]);
        case 'undercover': return pick([{ t: 'ready' }, { t: 'clue', text: WORD(rng) }, { t: 'vote', target: seat() }, { t: 'guess', text: WORD(rng) }]);
        case 'ladder': return pick([{ t: 'level', n: 1 + Math.floor(rng() * 10) }, { t: 'answer', c: Math.floor(rng() * 4) }, { t: 'ready' }]);
        default: return pick([{ t: 'guess', text: WORD(rng) }, { t: 'ready' }, { t: 'rematch' }]);
    }
}

function playOne(seed) {
    const rng = seeded(seed);
    const n = 2 + Math.floor(rng() * 5);
    const g = new PartyGame({ rng: seeded(seed * 3 + 1) });
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    assert.ok(!g.apply(0, { t: 'setRounds', n: 5 }).error);
    assert.ok(!g.apply(0, { t: 'start' }, 0).error);
    let t = 0;
    let steps = 0;
    const minisSeen = new Set();
    for (; steps < 20000 && g.s.phase !== 'over'; steps++) {
        t += 300 + Math.floor(rng() * 900);
        const s = g.s;
        // zufällig Verbindung verlieren oder wiederherstellen
        if (rng() < 0.02) {
            const seat = Math.floor(rng() * n);
            g.setConnected(seat, rng() < 0.5);
        }
        if (s.phase === 'board' && s.turnPhase === 'roll' && rng() < 0.6) g.apply(s.order[s.turnIdx], { t: 'roll' }, t);
        if (s.phase === 'board' && s.choice && rng() < 0.6) {
            const c = s.choice;
            const seat = rng() < 0.9 ? c.seat : Math.floor(rng() * n);
            const pick = c.options.length ? c.options[Math.floor(rng() * c.options.length)] : Math.floor(rng() * 70);
            if (s.turnPhase === 'choose') g.apply(seat, { t: 'choose', to: rng() < 0.9 ? pick : Math.floor(rng() * 70) }, t);
            else if (s.turnPhase === 'duel') g.apply(seat, { t: 'duel', target: rng() < 0.9 ? pick : Math.floor(rng() * 7) }, t);
            else g.apply(seat, { t: 'teleport', go: rng() < 0.6 }, t);
        }
        if (s.phase === 'mini' && s.mini && s.mini.phase === 'play') {
            const m = s.mini;
            minisSeen.add(m.type);
            const seat = Math.floor(rng() * n);
            if (m.kind === 'sub') g.apply(seat, { t: 'mini', kind: 'sub', a: randomSubAction(m.type, rng, n) }, t);
            else if (m.kind === 'solo') g.apply(m.duel && rng() < 0.8 ? m.duel[Math.floor(rng() * 2)] : seat, { t: 'mini', kind: rng() < 0.3 ? 'live' : 'score', score: Math.floor(rng() * 4000) - 100 }, t);
            else if (m.kind === 'quiz') g.apply(seat, { t: 'mini', kind: 'answer', c: Math.floor(rng() * 4) }, t);
            else if (m.kind === 'estimate') g.apply(seat, { t: 'mini', kind: 'answer', v: Math.floor(rng() * 5000) - 100 }, t);
            else {
                const choice = rng();
                if (choice < 0.4) g.apply(seat, { t: 'mini', kind: 'guess', text: ['Haus', 'Baum', 'xyz', m.secret.word][Math.floor(rng() * 4)] }, t);
                else if (choice < 0.8) g.apply(m.draw.drawer, { t: 'mini', kind: 'stroke', c: 1, w: 4, p: [Math.floor(rng() * 1000), Math.floor(rng() * 1000), Math.floor(rng() * 1000), Math.floor(rng() * 1000)] }, t);
                else g.apply(m.draw.drawer, { t: 'mini', kind: 'clear' }, t);
            }
        }
        g.tick(t);
        checkInvariants(g, `Seed ${seed}, Schritt ${steps}`);
    }
    assert.equal(g.s.phase, 'over', `Spiel endete nicht (Seed ${seed}, Phase ${g.s.phase}, Runde ${g.s.round})`);
    assert.equal(g.s.round, 5);
    const rank = g.ranking();
    for (const r of rank) assert.equal(r.total, r.stars * 10 + r.coins);
    return { steps, minisSeen };
}

test(`Zufallsspiele (${GAMES} Stück) laufen immer bis zum Ende und halten alle Regeln ein`, () => {
    const seen = new Set();
    for (let seed = 1; seed <= GAMES; seed++) for (const m of playOne(seed).minisSeen) seen.add(m);
    assert.ok(seen.size >= 7, `zu wenige verschiedene Minispiele gesehen: ${[...seen].join(', ')}`);
    assert.ok(STAR_PRICE > 0);
});
