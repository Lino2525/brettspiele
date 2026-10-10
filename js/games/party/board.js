// Spielfeld von Sternenjagd: ein Wegenetz mit Abzweigungen, Kreuzungen und Einbahnstraßen.
// Reine Daten und Hilfsfunktionen, ohne Browser-Abhängigkeiten.
//
// Aufbau (Rasterkoordinaten, x nach rechts, y nach unten):
//   Der Rand des inneren Rechtecks ist eine Einbahnstraße im Uhrzeigersinn, die lila Linie rechts außen
//   ebenfalls (nach unten). Alle anderen Wege sind in beide Richtungen befahrbar.
//   Felder liegen in etwa 3 Rastereinheiten Abstand, jede Kreuzung ist selbst ein Feld.

// blue = +3 Münzen, red = −3 Münzen, luck = Glücksfeld (zufälliges Ereignis), start = Startfeld,
// shield = Schild (3 Runden kein Sternenklau), duel = Duell gegen eine Person nach Wahl, teleport = direkt zum Stern
export const COIN_GAIN = 3;
export const COIN_LOSS = 3;

const P = {
    A: [2, 2], B: [6, 2], X: [16, 2], C: [28, 2], // oben (Einbahn nach rechts)
    D: [28, 5], E: [28, 11], F: [28, 14], // rechts (Einbahn nach unten)
    G: [20, 14], H: [12, 14], I: [6, 14], J: [2, 14], // unten (Einbahn nach links)
    K: [2, 8], // links (Einbahn nach oben)
    L: [6, 8], N: [9, 8], Q: [12, 8], R: [20, 8], S: [20, 5], // Mittellinie mit Stufe
    U: [31, 5], V: [31, 11], // lila Linie (Einbahn nach unten)
    W: [12, 11], // untere Querlinie trifft die Mitte
    M: [0, 8], O1: [0, 0], O2: [16, 0], O3: [0, 16], O4: [20, 16], // äußerer Bogen
};

// [Punkte, Einbahn?, Art, Schritte je Teilstück (optional)]
const LINES = [
    [['A', 'B', 'X', 'C'], true],
    [['C', 'D', 'E', 'F'], true],
    [['F', 'G', 'H', 'I', 'J'], true],
    [['J', 'K', 'A'], true],
    [['B', 'L', 'I'], false],
    [['M', 'K', 'L', 'N', 'Q', 'R', 'S', 'D', 'U'], false],
    [['U', 'V'], true, 'special', [4]],
    [['V', 'E', 'W'], false],
    [['Q', 'W', 'H'], false],
    [['X', 'O2', 'O1', 'M', 'O3', 'O4', 'G'], false],
];

// Besondere Felder: Start, Schild (grüner Bereich), lila Linie von oben nach unten: Duell, Duell, Teleport, Duell, Duell
const SPECIAL = { A: 'start', N: 'shield' };
const PURPLE = ['duel', 'duel', 'teleport', 'duel', 'duel'];
// Verteilung der übrigen Felder (der Reihe nach)
const PATTERN = ['blue', 'blue', 'red', 'blue', 'luck', 'blue', 'blue', 'red'];

export const BOARD_W = 33; // Rasterbreite inklusive Rand (Koordinaten 0 bis 31 plus je ein halber Rand)
export const BOARD_H = 18;

const nodes = [];
const byKey = new Map();
const next = [];
const segments = [];

function nodeAt(x, y) {
    const key = `${x},${y}`;
    if (!byKey.has(key)) {
        byKey.set(key, nodes.length);
        nodes.push({ id: nodes.length, x, y, type: null });
        next.push([]);
    }
    return byKey.get(key);
}

const link = (a, b) => {
    if (!next[a].includes(b)) next[a].push(b);
};

const named = {};
for (const [name, [x, y]] of Object.entries(P)) named[name] = nodeAt(x, y);

const purpleIds = [];
for (const [points, oneway, kind, steps] of LINES) {
    for (let k = 0; k < points.length - 1; k++) {
        const [x1, y1] = P[points[k]];
        const [x2, y2] = P[points[k + 1]];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const n = steps?.[k] ?? Math.max(1, Math.round(len / 3));
        let prev = named[points[k]];
        if (kind === 'special' && !purpleIds.length) purpleIds.push(prev);
        for (let i = 1; i <= n; i++) {
            const id = i === n ? named[points[k + 1]] : nodeAt(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n);
            if (kind === 'special') purpleIds.push(id);
            link(prev, id);
            if (!oneway) link(id, prev);
            segments.push({ a: prev, b: id, oneway, kind: kind || 'path' });
            prev = id;
        }
    }
}

for (const [name, type] of Object.entries(SPECIAL)) nodes[named[name]].type = type;
purpleIds.forEach((id, k) => (nodes[id].type = PURPLE[k]));
let k = 0;
for (const node of nodes) if (!node.type) node.type = PATTERN[k++ % PATTERN.length];

export const NODES = nodes;
export const NEXT = next;
export const SEGMENTS = segments;
export const START = named.A;
export const SPACE_TYPES = nodes.map(n => n.type);

// Wohin geht es von pos weiter, wenn man von prev kommt? Umdrehen gibt es nur in einer Sackgasse.
export function nextOptions(pos, prev = null) {
    const out = next[pos];
    const forward = out.filter(n => n !== prev);
    return forward.length ? forward : out.slice();
}

// Abstand in Feldern (Wege in beide Richtungen gezählt), z. B. damit der Stern nicht direkt neben dem alten Platz landet
export function distances(from) {
    const dist = new Array(nodes.length).fill(Infinity);
    const undirected = nodes.map(() => new Set());
    next.forEach((list, a) => list.forEach(b => {
        undirected[a].add(b);
        undirected[b].add(a);
    }));
    dist[from] = 0;
    const queue = [from];
    while (queue.length) {
        const a = queue.shift();
        for (const b of undirected[a]) if (dist[b] === Infinity) {
            dist[b] = dist[a] + 1;
            queue.push(b);
        }
    }
    return dist;
}

// Felder, auf denen der Stern liegen darf
export const STAR_SPOTS = nodes.filter(n => ['blue', 'red', 'luck'].includes(n.type)).map(n => n.id);
