// Ausführen mit:  node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MonopolyGame } from '../js/games/monopoly/engine.js';
import { SPACES, CHANCE_CARDS, CHEST_CARDS, rentOf, newProps, canBuild } from '../js/games/monopoly/board.js';

const idxOf = name => SPACES.findIndex(s => s.name === name);
const BAD = idxOf('Badstraße');
const TURM = idxOf('Turmstraße');
const SUED = idxOf('Südbahnhof');
const SCHLOSS = idxOf('Schlossallee');
const PARK = idxOf('Parkstraße');
const ELEKT = idxOf('Elektrizitätswerk');
const WASSER = idxOf('Wasserwerk');
const chanceIdx = pred => CHANCE_CARDS.findIndex(pred);
const chestIdx = pred => CHEST_CARDS.findIndex(pred);

function seeded(seed = 1) {
    let x = seed;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

// n Spieler, Spiel gestartet, Spieler 0 beginnt
function newGame(n = 3) {
    const g = new MonopolyGame({ rng: seeded(5) });
    const names = ['Anna', 'Boris', 'Cara', 'Dino'];
    for (let i = 0; i < n; i++) assert.equal(g.join('t' + i, names[i]), i);
    assert.ok(!g.apply(0, { t: 'start' }).error);
    g.s.turn = 0;
    return g;
}

const P = (g, i) => g.s.players[i];
const own = (g, seat, ...idxs) => idxs.forEach(i => (g.s.props[i].owner = seat));
const roll = (g, a, b, seat = g.s.turn) => {
    g.forcedDice.push([a, b]);
    return g.apply(seat, { t: 'roll' });
};
const ok = r => assert.ok(!r.error, r.error);

test('Spielplan: 40 Felder, 28 Grundstücke, Preise stimmen', () => {
    assert.equal(SPACES.length, 40);
    const ownable = SPACES.filter(s => ['street', 'rail', 'util'].includes(s.type));
    assert.equal(ownable.length, 28);
    assert.equal(ownable.filter(s => s.type === 'street').length, 22);
    assert.equal(SPACES[39].name, 'Schlossallee');
    assert.equal(SPACES[39].price, 400);
    assert.equal(SPACES.filter(s => s.type === 'chance').length, 3);
    assert.equal(SPACES.filter(s => s.type === 'chest').length, 3);
    assert.equal(CHANCE_CARDS.length, 16);
    assert.equal(CHEST_CARDS.length, 16);
});

test('Lobby: Start nur durch Gastgeber ab 2 Spielern, höchstens 4, danach nur noch bekannte', () => {
    const g = new MonopolyGame({ rng: seeded(1) });
    g.join('a', 'A');
    assert.ok(g.apply(0, { t: 'start' }).error);
    g.join('b', 'B');
    assert.ok(g.apply(1, { t: 'start' }).error);
    g.join('c', 'C');
    g.join('d', 'D');
    assert.equal(g.join('e', 'E'), -1);
    ok(g.apply(0, { t: 'start' }));
    assert.equal(g.join('x', 'X'), -1);
    assert.equal(g.join('b', 'B'), 1);
    for (const p of g.s.players) assert.equal(p.cash, 1500);
});

test('Würfeln, ziehen, LOS-Gehalt', () => {
    const g = newGame();
    P(g, 0).pos = 38;
    ok(roll(g, 1, 2)); // 38 + 3 = 41 -> Feld 1 (Badstraße)
    assert.equal(P(g, 0).pos, 1);
    assert.equal(P(g, 0).cash, 1700);
    assert.equal(g.s.turnPhase, 'buy');
    assert.ok(g.apply(1, { t: 'roll' }).error, 'nur der Spieler am Zug');
});

test('Kaufen, Zug beenden', () => {
    const g = newGame();
    ok(roll(g, 1, 2)); // Gemeinschaftsfeld (Feld 3? 0+3 = Turmstraße)
    assert.equal(P(g, 0).pos, 3);
    assert.equal(g.s.turnPhase, 'buy');
    ok(g.apply(0, { t: 'buy' }));
    assert.equal(g.s.props[TURM].owner, 0);
    assert.equal(P(g, 0).cash, 1440);
    assert.equal(g.s.turnPhase, 'end');
    ok(g.apply(0, { t: 'endTurn' }));
    assert.equal(g.s.turn, 1);
    assert.equal(g.s.turnPhase, 'roll');
});

test('Pasch: nochmal würfeln, Gefängnisfeld, dreimal Pasch = Gefängnis', () => {
    const h = newGame();
    P(h, 0).pos = 20;
    ok(roll(h, 2, 2)); // 24 Opernplatz
    assert.equal(h.s.turnPhase, 'buy');
    ok(h.apply(0, { t: 'decline' }));
    ok(h.apply(1, { t: 'pass' }));
    ok(h.apply(2, { t: 'pass' }));
    ok(h.apply(0, { t: 'pass' }));
    assert.equal(h.s.turnPhase, 'roll', 'Pasch gibt einen weiteren Wurf');
    ok(roll(h, 3, 3)); // 30 -> Gehe in das Gefängnis
    assert.equal(P(h, 0).inJail, true);
    assert.equal(P(h, 0).pos, 10);
    assert.equal(h.s.turnPhase, 'end', 'nach dem Gefängnis kein weiterer Wurf');

    const k = newGame();
    k.s.doublesCount = 2;
    ok(roll(k, 4, 4));
    assert.equal(P(k, 0).inJail, true, 'dritter Pasch');
    assert.equal(P(k, 0).pos, 10);
    assert.equal(k.s.turnPhase, 'end');
});

test('Versteigerung: Gebote, Aussteigen, Zuschlag', () => {
    const g = newGame();
    ok(roll(g, 1, 2)); // Turmstraße (60)
    ok(g.apply(0, { t: 'decline' }));
    assert.equal(g.s.turnPhase, 'auction');
    assert.equal(g.s.auction.active[g.s.auction.at], 1, 'links vom Spieler am Zug beginnt');
    assert.ok(g.apply(2, { t: 'bid', amount: 10 }).error, 'nicht dran');
    ok(g.apply(1, { t: 'bid', amount: 10 }));
    assert.ok(g.apply(2, { t: 'bid', amount: 10 }).error, 'zu wenig');
    assert.ok(g.apply(2, { t: 'bid', amount: 9999 }).error, 'mehr als Bargeld');
    ok(g.apply(2, { t: 'bid', amount: 30 }));
    ok(g.apply(0, { t: 'pass' }));
    ok(g.apply(1, { t: 'pass' }));
    assert.equal(g.s.auction, null);
    assert.equal(g.s.props[TURM].owner, 2);
    assert.equal(P(g, 2).cash, 1470);
    assert.equal(g.s.turnPhase, 'end');
});

test('Versteigerung ohne Gebot: unverkauft', () => {
    const g = newGame();
    ok(roll(g, 1, 2));
    ok(g.apply(0, { t: 'decline' }));
    ok(g.apply(1, { t: 'pass' }));
    ok(g.apply(2, { t: 'pass' }));
    ok(g.apply(0, { t: 'pass' }));
    assert.equal(g.s.props[TURM].owner, null);
    assert.equal(g.s.turnPhase, 'end');
});

test('Miete: Straße, Farbgruppe doppelt, Häuser, Bahnhöfe, Werke', () => {
    const props = newProps();
    props[BAD].owner = 1;
    assert.equal(rentOf(props, BAD), 2);
    props[TURM].owner = 1;
    assert.equal(rentOf(props, BAD), 4, 'volle Farbgruppe: doppelt');
    props[BAD].houses = 2;
    assert.equal(rentOf(props, BAD), 30);
    props[BAD].houses = 5;
    assert.equal(rentOf(props, BAD), 250, 'Hotel');
    props[BAD].mortgaged = true;
    assert.equal(rentOf(props, BAD), 0, 'beliehen: keine Miete');
    props[SUED].owner = 1;
    assert.equal(rentOf(props, SUED), 25);
    props[idxOf('Westbahnhof')].owner = 1;
    props[idxOf('Nordbahnhof')].owner = 1;
    assert.equal(rentOf(props, SUED), 100);
    props[idxOf('Hauptbahnhof')].owner = 1;
    assert.equal(rentOf(props, SUED), 200);
    props[ELEKT].owner = 1;
    assert.equal(rentOf(props, ELEKT, 7), 28);
    props[WASSER].owner = 1;
    assert.equal(rentOf(props, ELEKT, 7), 70);
});

test('Miete wird beim Landen bezahlt', () => {
    const g = newGame();
    own(g, 1, TURM);
    ok(roll(g, 1, 2));
    assert.equal(P(g, 0).cash, 1500 - 4);
    assert.equal(P(g, 1).cash, 1500 + 4);
    assert.equal(g.s.turnPhase, 'end');
});

test('Einkommensteuer', () => {
    const g = newGame();
    ok(roll(g, 2, 2)); // Feld 4
    assert.equal(P(g, 0).cash, 1300);
});

test('Gefängnis: Geldstrafe, Freikarte, Pasch, dritter Fehlversuch', () => {
    // Geldstrafe
    let g = newGame();
    P(g, 0).inJail = true;
    P(g, 0).pos = 10;
    ok(g.apply(0, { t: 'payJail' }));
    assert.equal(P(g, 0).cash, 1450);
    assert.equal(P(g, 0).inJail, false);
    // Freikarte
    g = newGame();
    P(g, 0).inJail = true;
    P(g, 0).pos = 10;
    P(g, 0).jailCards = ['chance'];
    g.s.decks.chance = g.s.decks.chance.filter(i => CHANCE_CARDS[i].kind !== 'jailFree'); // gehalten, nicht im Stapel
    ok(g.apply(0, { t: 'useJailCard' }));
    assert.equal(P(g, 0).inJail, false);
    assert.equal(P(g, 0).jailCards.length, 0);
    assert.equal(g.s.decks.chance.length, 16, 'Karte liegt wieder im Stapel');
    // Pasch befreit, aber kein weiterer Wurf
    g = newGame();
    P(g, 0).inJail = true;
    P(g, 0).pos = 10;
    ok(roll(g, 3, 3)); // 16 Münchner Straße
    assert.equal(P(g, 0).inJail, false);
    assert.equal(P(g, 0).pos, 16);
    assert.equal(g.s.turnPhase, 'buy');
    ok(g.apply(0, { t: 'decline' }));
    ['1', '2', '0'].forEach(() => {});
    ok(g.apply(1, { t: 'pass' }));
    ok(g.apply(2, { t: 'pass' }));
    ok(g.apply(0, { t: 'pass' }));
    assert.equal(g.s.turnPhase, 'end', 'Pasch aus dem Gefängnis: kein Extra-Wurf');
    // dritter Fehlversuch: zahlen und ziehen
    g = newGame();
    P(g, 0).inJail = true;
    P(g, 0).pos = 10;
    P(g, 0).jailTurns = 2;
    ok(roll(g, 1, 2)); // 13 Hafenstraße
    assert.equal(P(g, 0).cash, 1450);
    assert.equal(P(g, 0).inJail, false);
    assert.equal(P(g, 0).pos, 13);
    // normaler Fehlversuch
    g = newGame();
    P(g, 0).inJail = true;
    P(g, 0).pos = 10;
    ok(roll(g, 1, 2));
    assert.equal(P(g, 0).inJail, true);
    assert.equal(P(g, 0).jailTurns, 1);
    assert.equal(g.s.turnPhase, 'end');
});

test('Karten: Vorrücken, Geburtstag, Reparaturen, Freikarte', () => {
    // Ereignisfeld 7: Schlossallee
    let g = newGame();
    g.s.decks.chance = [chanceIdx(c => c.kind === 'moveTo' && c.to === 39), ...g.s.decks.chance.filter(i => i !== chanceIdx(c => c.kind === 'moveTo' && c.to === 39))];
    ok(roll(g, 3, 4));
    assert.equal(P(g, 0).pos, 39);
    assert.equal(g.s.turnPhase, 'buy');
    // Geburtstag (Gemeinschaftsfeld 2)
    g = newGame();
    const bday = chestIdx(c => c.kind === 'gainEach');
    g.s.decks.chest = [bday, ...g.s.decks.chest.filter(i => i !== bday)];
    ok(roll(g, 1, 1));
    assert.equal(P(g, 0).cash, 1520);
    assert.equal(P(g, 1).cash, 1490);
    assert.equal(P(g, 2).cash, 1490);
    // Reparaturen
    g = newGame();
    own(g, 0, BAD, TURM);
    g.s.props[BAD].houses = 2;
    g.s.props[TURM].houses = 5;
    const rep = chanceIdx(c => c.kind === 'repairs');
    g.s.decks.chance = [rep, ...g.s.decks.chance.filter(i => i !== rep)];
    ok(roll(g, 3, 4));
    assert.equal(P(g, 0).cash, 1500 - (2 * 25 + 100));
    // Freikarte wird behalten und nicht zurück in den Stapel gelegt
    g = newGame();
    const jf = chanceIdx(c => c.kind === 'jailFree');
    g.s.decks.chance = [jf, ...g.s.decks.chance.filter(i => i !== jf)];
    ok(roll(g, 3, 4));
    assert.equal(P(g, 0).jailCards.length, 1);
    assert.equal(g.s.decks.chance.length, 15);
    // Ereigniskarte "nächster Bahnhof" doppelte Miete
    g = newGame();
    const WEST = idxOf('Westbahnhof');
    own(g, 1, WEST);
    const nr = chanceIdx(c => c.kind === 'moveNearest' && c.what === 'rail');
    g.s.decks.chance = [nr, ...g.s.decks.chance.filter(i => i !== nr)];
    ok(roll(g, 3, 4));
    assert.equal(P(g, 0).pos, WEST);
    assert.equal(P(g, 0).cash, 1500 - 50);
    // Versorgungswerk: Zehnfaches eines neuen Wurfs
    g = newGame();
    own(g, 1, ELEKT);
    const nu = chanceIdx(c => c.kind === 'moveNearest' && c.what === 'util');
    g.s.decks.chance = [nu, ...g.s.decks.chance.filter(i => i !== nu)];
    g.forcedDice.push([3, 4]); // der Wurf, der aufs Ereignisfeld führt
    g.forcedDice.push([2, 3]); // der Wurf fürs Werk
    ok(g.apply(0, { t: 'roll' }));
    assert.equal(P(g, 0).pos, ELEKT);
    assert.equal(P(g, 0).cash, 1500 - 50);
    // Zurück: Gehe drei Felder zurück landet auf Einkommensteuer
    g = newGame();
    const back = chanceIdx(c => c.kind === 'back');
    g.s.decks.chance = [back, ...g.s.decks.chance.filter(i => i !== back)];
    ok(roll(g, 3, 4));
    assert.equal(P(g, 0).pos, 4);
    assert.equal(P(g, 0).cash, 1300);
});

test('Bauen: gleichmäßig, Hotels, Vorrat', () => {
    const g = newGame();
    own(g, 0, BAD, TURM);
    assert.ok(g.apply(0, { t: 'build', idx: SCHLOSS }).error, 'gehört nicht');
    ok(g.apply(0, { t: 'build', idx: BAD }));
    assert.ok(g.apply(0, { t: 'build', idx: BAD }).error, 'gleichmäßig bauen');
    ok(g.apply(0, { t: 'build', idx: TURM }));
    for (let i = 0; i < 3; i++) {
        ok(g.apply(0, { t: 'build', idx: BAD }));
        ok(g.apply(0, { t: 'build', idx: TURM }));
    }
    assert.equal(g.s.props[BAD].houses, 4);
    ok(g.apply(0, { t: 'build', idx: BAD })); // Hotel
    assert.equal(g.s.props[BAD].houses, 5);
    assert.ok(g.apply(0, { t: 'build', idx: BAD }).error, 'nicht über Hotel hinaus');
    // verkaufen: gleichmäßig, halber Preis
    assert.ok(g.apply(0, { t: 'sellBuilding', idx: TURM }).error, 'erst das höhere Gebäude');
    const cash = P(g, 0).cash;
    ok(g.apply(0, { t: 'sellBuilding', idx: BAD }));
    assert.equal(P(g, 0).cash, cash + 25);
    assert.equal(g.s.props[BAD].houses, 4);
    // Vorrat
    const h = newGame();
    own(h, 0, BAD, TURM);
    for (const i of h.s.props.keys()) if (h.s.props[i] && i !== BAD && i !== TURM) h.s.props[i].houses = 0;
    h.s.props[idxOf('Seestraße')].houses = 4; // nur zum Verbrauchen des Vorrats
    h.s.props[idxOf('Seestraße')].owner = 1;
    h.s.props[idxOf('Hafenstraße')].houses = 4;
    h.s.props[idxOf('Hafenstraße')].owner = 1;
    h.s.props[idxOf('Neue Straße')].houses = 4;
    h.s.props[idxOf('Neue Straße')].owner = 1;
    h.s.props[idxOf('Münchner Straße')].houses = 4;
    h.s.props[idxOf('Münchner Straße')].owner = 1;
    h.s.props[idxOf('Wiener Straße')].houses = 4;
    h.s.props[idxOf('Wiener Straße')].owner = 1;
    h.s.props[idxOf('Berliner Straße')].houses = 4;
    h.s.props[idxOf('Berliner Straße')].owner = 1;
    h.s.props[idxOf('Theaterstraße')].houses = 4;
    h.s.props[idxOf('Theaterstraße')].owner = 1;
    h.s.props[idxOf('Museumstraße')].houses = 4;
    h.s.props[idxOf('Museumstraße')].owner = 1;
    assert.equal(canBuild(h.s.props, 0, 1500, BAD).ok, false, 'Bank hat keine Häuser mehr (32 verbaut)');
});

test('Hypothek: aufnehmen, ablösen mit 10 % Zinsen, nicht mit Gebäuden', () => {
    const g = newGame();
    own(g, 0, BAD, TURM);
    ok(g.apply(0, { t: 'build', idx: BAD }));
    assert.ok(g.apply(0, { t: 'mortgage', idx: TURM }).error, 'Gebäude in der Farbgruppe');
    ok(g.apply(0, { t: 'sellBuilding', idx: BAD }));
    const c = P(g, 0).cash;
    ok(g.apply(0, { t: 'mortgage', idx: TURM }));
    assert.equal(P(g, 0).cash, c + 30);
    assert.ok(g.apply(0, { t: 'build', idx: BAD }).error, 'beliehen in der Gruppe');
    ok(g.apply(0, { t: 'unmortgage', idx: TURM }));
    assert.equal(P(g, 0).cash, c + 30 - 33);
    assert.equal(g.s.props[TURM].mortgaged, false);
});

test('Schulden: Geld beschaffen, dann wird automatisch gezahlt', () => {
    const g = newGame();
    P(g, 0).cash = 50;
    own(g, 0, BAD, TURM, SUED);
    ok(roll(g, 1, 3)); // Einkommensteuer: 200
    assert.deepEqual(g.s.debt, { seat: 0, amount: 200, to: null });
    assert.ok(g.apply(0, { t: 'endTurn' }).error, 'während Schulden gesperrt');
    assert.ok(g.apply(0, { t: 'roll' }).error);
    assert.ok(g.apply(1, { t: 'mortgage', idx: BAD }).error, 'nur der Schuldner darf verwalten');
    assert.ok(g.apply(0, { t: 'bankrupt' }).error, 'noch nicht pleite: Hypotheken würden reichen');
    ok(g.apply(0, { t: 'mortgage', idx: BAD })); // 80
    ok(g.apply(0, { t: 'mortgage', idx: TURM })); // 110
    assert.ok(g.s.debt, 'noch zu wenig');
    ok(g.apply(0, { t: 'mortgage', idx: SUED })); // 210 -> automatisch bezahlt
    assert.equal(g.s.debt, null);
    assert.equal(P(g, 0).cash, 10);
    assert.equal(g.s.turnPhase, 'end');
});

test('Bankrott an einen Mitspieler: alles geht über, Spiel endet mit einem Überlebenden', () => {
    const g = newGame(2);
    own(g, 1, SCHLOSS, PARK);
    g.s.props[SCHLOSS].houses = 5;
    P(g, 0).cash = 100;
    own(g, 0, BAD);
    g.s.props[BAD].mortgaged = true;
    P(g, 0).jailCards = ['chest'];
    P(g, 0).pos = 31;
    ok(roll(g, 3, 5));
    assert.equal(g.s.debt.amount, 2000);
    assert.equal(g.apply(0, { t: 'bankrupt' }).error, undefined);
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, 1);
    assert.equal(g.s.props[BAD].owner, 1, 'Grundstück geht an den Gläubiger');
    assert.equal(P(g, 1).jailCards.length, 1);
    assert.equal(P(g, 1).cash, 1500 + 100 - 3, 'Bargeld und 10 % Zinsen auf die Hypothek');
});

test('Bankrott an die Bank: Grundstücke werden versteigert', () => {
    const g = newGame(3);
    own(g, 0, BAD, TURM);
    g.s.props[BAD].houses = 1;
    const c = P(g, 0).cash;
    ok(g.apply(0, { t: 'resign' }));
    assert.equal(P(g, 0).bankrupt, true);
    assert.equal(g.s.turnPhase, 'auction', 'erste Versteigerung läuft');
    assert.equal(g.s.auction.idx, BAD);
    assert.equal(g.s.props[BAD].houses, 0);
    assert.ok(c > 0);
    // alle verzichten: beide unverkauft, danach ist der nächste Spieler dran
    for (let k = 0; k < 2; k++) {
        while (g.s.auction) {
            const seat = g.s.auction.active[g.s.auction.at];
            ok(g.apply(seat, { t: 'pass' }));
        }
    }
    assert.equal(g.s.turn, 1);
    assert.equal(g.s.turnPhase, 'roll');
    assert.equal(g.s.props[BAD].owner, null);
});

test('Handeln: Angebot, Prüfung, Annahme, Ablehnung', () => {
    const g = newGame();
    own(g, 0, BAD);
    own(g, 1, SCHLOSS);
    assert.ok(g.apply(0, { t: 'tradeOffer', to: 1, give: { props: [SCHLOSS] }, get: {} }).error, 'fremdes Grundstück');
    assert.ok(g.apply(0, { t: 'tradeOffer', to: 1, give: { cash: 99999 }, get: {} }).error, 'zu viel Geld');
    assert.ok(g.apply(0, { t: 'tradeOffer', to: 1, give: {}, get: {} }).error, 'leer');
    ok(g.apply(0, { t: 'tradeOffer', to: 1, give: { props: [BAD], cash: 100 }, get: { props: [SCHLOSS] } }));
    assert.ok(g.apply(1, { t: 'tradeOffer', to: 2, give: { cash: 1 }, get: {} }).error, 'nur ein Angebot gleichzeitig');
    assert.ok(g.apply(2, { t: 'tradeAccept' }).error, 'nur der Empfänger');
    ok(g.apply(1, { t: 'tradeAccept' }));
    assert.equal(g.s.props[BAD].owner, 1);
    assert.equal(g.s.props[SCHLOSS].owner, 0);
    assert.equal(P(g, 0).cash, 1400);
    assert.equal(P(g, 1).cash, 1600);
    assert.equal(g.s.trade, null);
    // Ablehnen / Zurückziehen
    ok(g.apply(0, { t: 'tradeOffer', to: 2, give: { cash: 10 }, get: {} }));
    ok(g.apply(2, { t: 'tradeDecline' }));
    assert.equal(g.s.trade, null);
    ok(g.apply(0, { t: 'tradeOffer', to: 2, give: { cash: 10 }, get: {} }));
    ok(g.apply(0, { t: 'tradeCancel' }));
    assert.equal(g.s.trade, null);
});

test('Handeln: Gebäude in der Farbgruppe sperren den Tausch, beliehene kosten 10 % Zinsen', () => {
    const g = newGame();
    own(g, 0, BAD, TURM);
    g.s.props[BAD].houses = 1;
    assert.ok(g.apply(0, { t: 'tradeOffer', to: 1, give: { props: [TURM] }, get: {} }).error);
    g.s.props[BAD].houses = 0;
    g.s.props[TURM].mortgaged = true;
    ok(g.apply(0, { t: 'tradeOffer', to: 1, give: { props: [TURM] }, get: {} }));
    ok(g.apply(1, { t: 'tradeAccept' }));
    assert.equal(g.s.props[TURM].owner, 1);
    assert.equal(P(g, 1).cash, 1500 - 3);
});

test('Ansicht: kein Token, Ereignisse mit steigender ID', () => {
    const g = newGame();
    ok(roll(g, 1, 2));
    const v = g.view(1);
    assert.ok(!JSON.stringify(v).includes('"token"'));
    const ids = v.events.map(e => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.ok(v.events.some(e => e.type === 'dice'));
    assert.ok(v.events.some(e => e.type === 'move' && e.to === 3));
});

test('Speichern und Wiederherstellen, Neustart', () => {
    const g = newGame();
    ok(roll(g, 1, 2));
    const copy = MonopolyGame.restore(g.serialize(), { rng: seeded(1) });
    assert.equal(copy.s.players[0].pos, 3);
    assert.equal(copy.join('t1', 'x'), 1);
    // Neustart nach Spielende
    const h = newGame(2);
    ok(h.apply(0, { t: 'resign' }));
    assert.equal(h.s.phase, 'over');
    ok(h.apply(1, { t: 'rematch' }));
    assert.equal(h.s.phase, 'playing');
    assert.equal(h.s.players[0].cash, 1500);
    assert.equal(h.s.players[0].bankrupt, false);
});

test('Geburtstagskarte: Mitspieler ohne Geld muss Schulden klären, danach geht der Zug weiter', () => {
    const g = newGame(3);
    const bday = chestIdx(c => c.kind === 'gainEach');
    g.s.decks.chest = [bday, ...g.s.decks.chest.filter(i => i !== bday)];
    P(g, 1).cash = 5;
    own(g, 1, BAD);
    ok(roll(g, 1, 1)); // Gemeinschaftsfeld auf Feld 2
    assert.deepEqual(g.s.debt, { seat: 1, amount: 10, to: 0 });
    assert.ok(g.apply(0, { t: 'roll' }).error, 'der Zug ruht, bis die Schuld geklärt ist');
    ok(g.apply(1, { t: 'mortgage', idx: BAD })); // +30 -> zahlt automatisch
    assert.equal(g.s.debt, null);
    assert.equal(P(g, 0).cash, 1520, 'beide haben gezahlt');
    assert.equal(P(g, 2).cash, 1490);
    assert.equal(g.s.turn, 0);
    assert.equal(g.s.turnPhase, 'roll', 'Pasch: weiterwürfeln');
});

test('Geburtstagskarte: Mitspieler geht pleite, der Zug läuft trotzdem weiter', () => {
    const g = newGame(3);
    const bday = chestIdx(c => c.kind === 'gainEach');
    g.s.decks.chest = [bday, ...g.s.decks.chest.filter(i => i !== bday)];
    P(g, 1).cash = 5;
    ok(roll(g, 1, 1));
    ok(g.apply(1, { t: 'bankrupt' }));
    assert.equal(P(g, 1).bankrupt, true);
    assert.equal(P(g, 0).cash, 1500 + 5 + 10, 'Restgeld des Pleitiers plus Zahlung von Cara');
    assert.equal(g.s.turn, 0);
    assert.equal(g.s.turnPhase, 'roll');
    // Pleitier wird übersprungen
    P(g, 0).pos = 0;
    ok(roll(g, 1, 2));
    ok(g.apply(0, { t: 'decline' }));
    assert.deepEqual(g.s.auction.active.sort(), [0, 2], 'Pleitier bietet nicht mit');
});

test('Pleite eines Spielers mitten im eigenen Zug: nächster Spieler (nicht der Pleitier) ist dran', () => {
    const g = newGame(3);
    own(g, 1, SCHLOSS);
    g.s.props[SCHLOSS].houses = 5;
    P(g, 0).cash = 10;
    P(g, 0).pos = 31;
    ok(roll(g, 3, 5));
    ok(g.apply(0, { t: 'bankrupt' }));
    assert.equal(g.s.turn, 1);
    assert.equal(g.s.turnPhase, 'roll');
});
