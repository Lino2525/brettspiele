// Spielplan, Karten und reine Regelfunktionen für Monopoly (deutsche Straßennamen).
// Keine Browser-Abhängigkeiten: wird vom Host-Spiel, von der Oberfläche und von den Tests benutzt.

export const START_CASH = 1500;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const JAIL_POS = 10;
export const HOUSES_TOTAL = 32;
export const HOTELS_TOTAL = 12;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

// Farbgruppen mit Hauskosten
export const GROUPS = {
    brown: { name: 'Braun', color: '#8d5524', house: 50 },
    lightblue: { name: 'Hellblau', color: '#9bd6f2', house: 50 },
    pink: { name: 'Pink', color: '#d6409f', house: 100 },
    orange: { name: 'Orange', color: '#f7941d', house: 100 },
    red: { name: 'Rot', color: '#e0342b', house: 150 },
    yellow: { name: 'Gelb', color: '#f6dc1c', house: 150 },
    green: { name: 'Grün', color: '#1f9d4a', house: 200 },
    darkblue: { name: 'Dunkelblau', color: '#1d4e9e', house: 200 },
};

const street = (name, group, price, rent) => ({ type: 'street', name, group, price, rent });
const rail = name => ({ type: 'rail', name, group: 'rail', price: 200 });
const util = name => ({ type: 'util', name, group: 'util', price: 150 });

// Index 0 = LOS, dann im Uhrzeigersinn (unten rechts nach links, dann hoch, oben nach rechts, dann runter).
export const SPACES = [
    { type: 'go', name: 'LOS' },
    street('Badstraße', 'brown', 60, [2, 10, 30, 90, 160, 250]),
    { type: 'chest', name: 'Gemeinschaftsfeld' },
    street('Turmstraße', 'brown', 60, [4, 20, 60, 180, 320, 450]),
    { type: 'tax', name: 'Einkommensteuer', amount: 200 },
    rail('Südbahnhof'),
    street('Chausseestraße', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
    { type: 'chance', name: 'Ereignisfeld' },
    street('Elisenstraße', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
    street('Poststraße', 'lightblue', 120, [8, 40, 100, 300, 450, 600]),
    { type: 'jail', name: 'Gefängnis' },
    street('Seestraße', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    util('Elektrizitätswerk'),
    street('Hafenstraße', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    street('Neue Straße', 'pink', 160, [12, 60, 180, 500, 700, 900]),
    rail('Westbahnhof'),
    street('Münchner Straße', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    { type: 'chest', name: 'Gemeinschaftsfeld' },
    street('Wiener Straße', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    street('Berliner Straße', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
    { type: 'parking', name: 'Frei Parken' },
    street('Theaterstraße', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    { type: 'chance', name: 'Ereignisfeld' },
    street('Museumstraße', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    street('Opernplatz', 'red', 240, [20, 100, 300, 750, 925, 1100]),
    rail('Nordbahnhof'),
    street('Lessingstraße', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    street('Schillerstraße', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    util('Wasserwerk'),
    street('Goethestraße', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
    { type: 'gotojail', name: 'Gehe in das Gefängnis' },
    street('Rathausplatz', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    street('Hauptstraße', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    { type: 'chest', name: 'Gemeinschaftsfeld' },
    street('Bahnhofstraße', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
    rail('Hauptbahnhof'),
    { type: 'chance', name: 'Ereignisfeld' },
    street('Parkstraße', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500]),
    { type: 'tax', name: 'Zusatzsteuer', amount: 100 },
    street('Schlossallee', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000]),
];

export const isOwnable = idx => ['street', 'rail', 'util'].includes(SPACES[idx].type);

// ---------- Karten ----------
// Wirkungen: moveTo, moveNearest, gain, pay, gainEach, payEach, jailFree, gotoJail, back, repairs

export const CHANCE_CARDS = [
    { text: 'Rücke vor bis auf LOS. Ziehe M 200 ein.', kind: 'moveTo', to: 0 },
    { text: 'Rücke vor bis zur Schlossallee.', kind: 'moveTo', to: 39 },
    { text: 'Rücke vor bis zum Opernplatz. Kommst du über LOS, ziehe M 200 ein.', kind: 'moveTo', to: 24 },
    { text: 'Rücke vor bis zur Seestraße. Kommst du über LOS, ziehe M 200 ein.', kind: 'moveTo', to: 11 },
    { text: 'Rücke vor bis zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm das Doppelte der Miete.', kind: 'moveNearest', what: 'rail' },
    { text: 'Rücke vor bis zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm das Doppelte der Miete.', kind: 'moveNearest', what: 'rail' },
    { text: 'Rücke vor bis zum nächsten Versorgungswerk. Hat es einen Besitzer, würfle neu und zahle das Zehnfache der Augenzahl.', kind: 'moveNearest', what: 'util' },
    { text: 'Die Bank zahlt dir M 50 Dividende.', kind: 'gain', amount: 50 },
    { text: 'Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie brauchst.', kind: 'jailFree' },
    { text: 'Gehe drei Felder zurück.', kind: 'back', n: 3 },
    { text: 'Gehe direkt ins Gefängnis. Gehe nicht über LOS und ziehe keine M 200 ein.', kind: 'gotoJail' },
    { text: 'Allgemeine Reparaturen: Zahle für jedes Haus M 25 und für jedes Hotel M 100.', kind: 'repairs', house: 25, hotel: 100 },
    { text: 'Strafe für zu schnelles Fahren: Zahle M 15.', kind: 'pay', amount: 15 },
    { text: 'Mache eine Reise zum Südbahnhof. Kommst du über LOS, ziehe M 200 ein.', kind: 'moveTo', to: 5 },
    { text: 'Du wurdest zum Vorsitzenden gewählt. Zahle jedem Mitspieler M 50.', kind: 'payEach', amount: 50 },
    { text: 'Dein Bauvorhaben wird fertig. Du erhältst M 150.', kind: 'gain', amount: 150 },
];

export const CHEST_CARDS = [
    { text: 'Rücke vor bis auf LOS. Ziehe M 200 ein.', kind: 'moveTo', to: 0 },
    { text: 'Bankirrtum zu deinen Gunsten: Du erhältst M 200.', kind: 'gain', amount: 200 },
    { text: 'Arztkosten: Zahle M 50.', kind: 'pay', amount: 50 },
    { text: 'Du verkaufst Aktien und erhältst M 50.', kind: 'gain', amount: 50 },
    { text: 'Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie brauchst.', kind: 'jailFree' },
    { text: 'Gehe direkt ins Gefängnis. Gehe nicht über LOS und ziehe keine M 200 ein.', kind: 'gotoJail' },
    { text: 'Das Feriengeld ist fällig: Du erhältst M 100.', kind: 'gain', amount: 100 },
    { text: 'Steuerrückzahlung: Du erhältst M 20.', kind: 'gain', amount: 20 },
    { text: 'Du hast Geburtstag: Jeder Mitspieler schenkt dir M 10.', kind: 'gainEach', amount: 10 },
    { text: 'Deine Lebensversicherung wird fällig: Du erhältst M 100.', kind: 'gain', amount: 100 },
    { text: 'Krankenhausgebühren: Zahle M 100.', kind: 'pay', amount: 100 },
    { text: 'Schulgeld: Zahle M 50.', kind: 'pay', amount: 50 },
    { text: 'Du erhältst M 25 Beratungsgebühr.', kind: 'gain', amount: 25 },
    { text: 'Straßenreparaturen: Zahle für jedes Haus M 40 und für jedes Hotel M 115.', kind: 'repairs', house: 40, hotel: 115 },
    { text: 'Zweiter Preis im Schönheitswettbewerb: Du erhältst M 10.', kind: 'gain', amount: 10 },
    { text: 'Du erbst M 100.', kind: 'gain', amount: 100 },
];

// ---------- Hilfen für Besitz ----------

// Alle Felder derselben Gruppe (Farbe, alle Bahnhöfe bzw. beide Werke).
export const groupIndices = idx => SPACES.map((s, i) => i).filter(i => SPACES[i].group === SPACES[idx].group);

export const newProps = () => SPACES.map(s => (['street', 'rail', 'util'].includes(s.type) ? { owner: null, houses: 0, mortgaged: false } : null));

export const mortgageValue = idx => SPACES[idx].price / 2;
export const unmortgageCost = idx => Math.ceil(mortgageValue(idx) * 1.1);
export const houseCost = idx => GROUPS[SPACES[idx].group].house;

export function ownsAll(props, owner, idx) {
    return groupIndices(idx).every(i => props[i].owner === owner);
}

export function stock(props) {
    let houses = 0;
    let hotels = 0;
    for (const p of props) {
        if (!p) continue;
        if (p.houses === 5) hotels++;
        else houses += p.houses;
    }
    return { houses: HOUSES_TOTAL - houses, hotels: HOTELS_TOTAL - hotels };
}

// Miete für ein Feld. diceTotal nur für Werke, railMult für die Ereigniskarte "nächster Bahnhof".
export function rentOf(props, idx, diceTotal = 0, railMult = 1) {
    const space = SPACES[idx];
    const p = props[idx];
    if (!p || p.owner === null || p.mortgaged) return 0;
    if (space.type === 'street') {
        if (p.houses > 0) return space.rent[p.houses];
        return ownsAll(props, p.owner, idx) ? space.rent[0] * 2 : space.rent[0];
    }
    const owned = groupIndices(idx).filter(i => props[i].owner === p.owner).length;
    if (space.type === 'rail') return 25 * 2 ** (owned - 1) * railMult;
    return diceTotal * (owned >= 2 ? 10 : 4);
}

const fail = error => ({ ok: false, error });

export function canBuild(props, seat, cash, idx) {
    const space = SPACES[idx];
    const p = props[idx];
    if (space?.type !== 'street' || !p) return fail('Hier kann nicht gebaut werden.');
    if (p.owner !== seat) return fail('Das Grundstück gehört dir nicht.');
    if (!ownsAll(props, seat, idx)) return fail('Du brauchst alle Grundstücke der Farbgruppe.');
    const group = groupIndices(idx);
    if (group.some(i => props[i].mortgaged)) return fail('In der Farbgruppe liegt eine Hypothek.');
    if (p.houses >= 5) return fail('Hier steht schon ein Hotel.');
    if (p.houses > Math.min(...group.map(i => props[i].houses))) return fail('Es muss gleichmäßig gebaut werden.');
    const st = stock(props);
    if (p.houses === 4 ? st.hotels < 1 : st.houses < 1) {
        return fail(p.houses === 4 ? 'Die Bank hat keine Hotels mehr.' : 'Die Bank hat keine Häuser mehr.');
    }
    if (cash < houseCost(idx)) return fail('Nicht genug Geld.');
    return { ok: true, cost: houseCost(idx) };
}

export function canSellBuilding(props, seat, idx) {
    const space = SPACES[idx];
    const p = props[idx];
    if (space?.type !== 'street' || !p || p.owner !== seat) return fail('Das geht hier nicht.');
    if (p.houses === 0) return fail('Hier steht nichts zum Verkaufen.');
    const group = groupIndices(idx);
    if (p.houses < Math.max(...group.map(i => props[i].houses))) return fail('Es muss gleichmäßig verkauft werden.');
    if (p.houses === 5 && stock(props).houses < 4) return fail('Die Bank hat nicht genug Häuser für den Rückbau.');
    return { ok: true, refund: houseCost(idx) / 2 };
}

export function canMortgage(props, seat, idx) {
    const p = props[idx];
    if (!p || p.owner !== seat) return fail('Das Grundstück gehört dir nicht.');
    if (p.mortgaged) return fail('Schon beliehen.');
    if (SPACES[idx].type === 'street' && groupIndices(idx).some(i => props[i].houses > 0)) {
        return fail('Zuerst alle Gebäude der Farbgruppe verkaufen.');
    }
    return { ok: true, amount: mortgageValue(idx) };
}

export function canUnmortgage(props, seat, cash, idx) {
    const p = props[idx];
    if (!p || p.owner !== seat) return fail('Das Grundstück gehört dir nicht.');
    if (!p.mortgaged) return fail('Keine Hypothek vorhanden.');
    if (cash < unmortgageCost(idx)) return fail('Nicht genug Geld.');
    return { ok: true, cost: unmortgageCost(idx) };
}

// Was ein Spieler maximal flüssig machen könnte (Bargeld, Hypotheken, Gebäude zum halben Preis).
export function liquidationValue(props, seat, cash) {
    let total = cash;
    props.forEach((p, idx) => {
        if (!p || p.owner !== seat) return;
        if (SPACES[idx].type === 'street') total += (p.houses * houseCost(idx)) / 2;
        if (!p.mortgaged) total += mortgageValue(idx);
    });
    return total;
}

export function netWorth(props, seat, cash) {
    let total = cash;
    props.forEach((p, idx) => {
        if (!p || p.owner !== seat) return;
        total += SPACES[idx].price;
        if (SPACES[idx].type === 'street') total += p.houses * houseCost(idx);
    });
    return total;
}
