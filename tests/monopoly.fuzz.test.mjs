// Zufallstest: spielt komplette Monopoly-Spiele mit zufälligen Aktionen und prüft nach jedem Schritt die Grundregeln.
// Ausführen: node --test tests/monopoly.fuzz.test.mjs   (mehr Spiele: FUZZ_GAMES=500 node --test ...)
import test from 'node:test';
import assert from 'node:assert/strict';
import { MonopolyGame } from '../js/games/monopoly/engine.js';
import { SPACES, CHANCE_CARDS, CHEST_CARDS, groupIndices, ownsAll, stock } from '../js/games/monopoly/board.js';

const GAMES = Number(process.env.FUZZ_GAMES) || 40;
const RESIGN = Number(process.env.FUZZ_RESIGN ?? 0.0002); // Aufgeben selten, damit Spiele meist durch Bankrott enden

function seeded(seed) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function checkInvariants(g, ctx) {
    const s = g.s;
    const fail = msg => assert.fail(`${msg}\n${ctx}\nzuletzt: ${s.log.slice(-4).join(' | ')}`);
    for (const [i, p] of s.players.entries()) {
        if (!Number.isInteger(p.cash) || p.cash < 0) fail(`Bargeld ungültig bei ${i}: ${p.cash}`);
        if (p.pos < 0 || p.pos > 39) fail(`Position ungültig bei ${i}`);
        if (p.inJail && p.pos !== 10) fail(`${i} im Gefängnis, aber nicht auf Feld 10`);
        if (p.bankrupt && (p.cash !== 0 || p.jailCards.length)) fail(`Pleitier ${i} hat noch Besitz`);
    }
    s.props.forEach((p, idx) => {
        if (!p) return;
        if (p.owner !== null) {
            if (!s.players[p.owner] || s.players[p.owner].bankrupt) fail(`Besitzer ungültig bei ${SPACES[idx].name}`);
        } else if (p.houses || p.mortgaged) fail(`Freies Grundstück mit Haus/Hypothek: ${SPACES[idx].name}`);
        if (p.houses < 0 || p.houses > 5) fail(`Häuser ungültig bei ${SPACES[idx].name}`);
        if (p.houses > 0) {
            if (SPACES[idx].type !== 'street') fail('Gebäude auf Nicht-Straße');
            if (!ownsAll(s.props, p.owner, idx)) fail(`Gebäude ohne volle Farbgruppe: ${SPACES[idx].name}`);
            const grp = groupIndices(idx);
            if (grp.some(i => s.props[i].mortgaged)) fail(`Gebäude trotz Hypothek in der Gruppe: ${SPACES[idx].name}`);
            const hs = grp.map(i => s.props[i].houses);
            if (Math.max(...hs) - Math.min(...hs) > 1) fail(`Ungleichmäßig gebaut: ${SPACES[idx].name} ${hs}`);
        }
    });
    const st = stock(s.props);
    if (st.houses < 0 || st.hotels < 0) fail(`Vorrat überzogen: ${JSON.stringify(st)}`);
    for (const [deck, cards] of [['chance', CHANCE_CARDS], ['chest', CHEST_CARDS]]) {
        const held = s.players.reduce((n, p) => n + p.jailCards.filter(d => d === deck).length, 0);
        if (s.decks[deck].length + held !== cards.length) fail(`Kartenstapel ${deck} inkonsistent: ${s.decks[deck].length} + ${held}`);
        if (new Set(s.decks[deck]).size !== s.decks[deck].length) fail(`Doppelte Karte im Stapel ${deck}`);
    }
    if (s.phase === 'playing') {
        if (s.players[s.turn].bankrupt) fail('Ein Pleitier ist am Zug');
        if (s.debt && s.players[s.debt.seat].bankrupt) fail('Schuld bei Pleitier');
    }
    const alive = s.players.filter(p => !p.bankrupt).length;
    if (s.phase === 'over' && alive > 1 && s.winner !== null) fail('Sieger trotz mehreren Überlebenden');
    if (s.phase === 'playing' && alive < 2) fail('Spiel läuft mit weniger als 2 Spielern');
}

function randomTrade(g, rng, seat) {
    const s = g.s;
    const others = s.players.map((p, i) => i).filter(i => i !== seat && !s.players[i].bankrupt);
    if (!others.length) return null;
    const to = others[Math.floor(rng() * others.length)];
    const pick = who => s.props.map((p, i) => i).filter(i => s.props[i] && s.props[i].owner === who && rng() < 0.3);
    return {
        t: 'tradeOffer', to,
        give: { cash: Math.floor(rng() * 3) * 50, props: pick(seat), cards: rng() < 0.2 ? 1 : 0 },
        get: { cash: Math.floor(rng() * 3) * 50, props: pick(to), cards: rng() < 0.2 ? 1 : 0 },
    };
}

function playOneGame(seed) {
    const rng = seeded(seed);
    const g = new MonopolyGame({ rng: seeded(seed * 7 + 1) });
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) g.join('t' + i, 'S' + i);
    assert.ok(!g.apply(0, { t: 'start' }).error);
    const stats = { steps: 0, over: false };
    const idxs = [...SPACES.keys()];
    for (; stats.steps < 6000 && g.s.phase === 'playing'; stats.steps++) {
        const s = g.s;
        const ctx = `Seed ${seed}, Schritt ${stats.steps}`;
        let seat;
        let acts = [];
        if (s.debt) {
            seat = s.debt.seat;
            for (const i of idxs) acts.push({ t: 'sellBuilding', idx: i }, { t: 'mortgage', idx: i });
            acts.push({ t: 'bankrupt' });
        } else if (s.auction) {
            seat = s.auction.active[s.auction.at];
            acts = [{ t: 'bid', amount: s.auction.high + 10 * (1 + Math.floor(rng() * 5)) }, { t: 'pass' }, { t: 'pass' }];
        } else if (s.trade && rng() < 0.8) {
            seat = s.trade.to;
            acts = [{ t: rng() < 0.5 ? 'tradeAccept' : 'tradeDecline' }];
        } else {
            seat = s.turn;
            const roll = { t: 'roll' };
            const manage = ['build', 'sellBuilding', 'mortgage', 'unmortgage'].map(t => ({ t, idx: idxs[Math.floor(rng() * 40)] }));
            if (s.turnPhase === 'roll') acts = [roll, roll, roll, { t: 'payJail' }, { t: 'useJailCard' }, ...manage];
            else if (s.turnPhase === 'buy') acts = [{ t: 'buy' }, { t: 'buy' }, { t: 'decline' }];
            else acts = [{ t: 'endTurn' }, { t: 'endTurn' }, ...manage, ...manage];
            if (rng() < 0.08) {
                const trade = randomTrade(g, rng, seat);
                if (trade) acts = [trade];
            }
            if (rng() < RESIGN) acts = [{ t: 'resign' }];
        }
        // zufällig probieren, bis eine Aktion erlaubt ist; eine Schuld/Auktion muss sich immer irgendwie lösen lassen
        let progressed = false;
        const order = [...acts].sort(() => rng() - 0.5);
        if (s.debt) order.sort((a, b) => (a.t === 'bankrupt') - (b.t === 'bankrupt')); // Bankrott zuletzt
        for (const a of order) {
            if (!g.apply(seat, a).error) {
                progressed = true;
                break;
            }
        }
        if (!progressed) {
            // Fallback, der immer gehen muss
            const fallback = s.debt ? [{ t: 'bankrupt' }] : s.auction ? [{ t: 'pass' }] : s.trade ? [{ t: 'tradeDecline' }]
                : s.turnPhase === 'roll' ? [{ t: 'roll' }] : s.turnPhase === 'buy' ? [{ t: 'decline' }] : [{ t: 'endTurn' }];
            const who = s.debt ? s.debt.seat : s.auction ? s.auction.active[s.auction.at] : s.trade ? s.trade.to : s.turn;
            const r = g.apply(who, fallback[0]);
            assert.ok(!r.error, `${ctx}: Spiel hängt, Fallback ${fallback[0].t} scheitert (${r.error}); Zustand: turnPhase=${s.turnPhase}, debt=${JSON.stringify(s.debt)}`);
        }
        checkInvariants(g, ctx);
    }
    stats.over = g.s.phase === 'over';
    return stats;
}

test(`Zufallsspiele (${GAMES} Stück) halten alle Regeln ein`, () => {
    let finished = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
        const { over } = playOneGame(seed);
        if (over) finished++;
    }
    console.log(`  ${finished} von ${GAMES} Spielen wurden bis zum Ende gespielt`);
    assert.ok(finished > 0, 'mindestens ein Spiel sollte regulär enden');
});
