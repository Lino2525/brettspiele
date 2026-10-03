// Steinmodell und Regeln für Mini Rummy.
// Reine Logik ohne Browser-Abhängigkeiten, damit sie sowohl im Spiel als auch in den Node-Tests läuft.

export const COLOR_NAMES = ['Rot', 'Blau', 'Grün', 'Orange'];
export const TILE_COUNT = 106; // 2 x (4 Farben x 13 Zahlen) + 2 Joker
export const HAND_SIZE = 14;
export const MELD_MIN = 30;
export const JOKER_PENALTY = 30;

// Steine sind nur Zahlen (IDs). 0-51 und 52-103 sind die beiden Sätze, 104/105 die Joker.
export function tileInfo(id) {
    if (id >= 104) return { id, joker: true, color: -1, num: 0 };
    const r = id % 52;
    return { id, joker: false, color: Math.floor(r / 13), num: (r % 13) + 1 };
}

export function rackPoints(ids) {
    return ids.reduce((sum, id) => sum + (id >= 104 ? JOKER_PENALTY : tileInfo(id).num), 0);
}

const fail = (error, points = 0) => ({ ok: false, error, points });

function analyzeRun(fixed, n) {
    if (fixed.length === 0) return { valid: true, points: sumRange(14 - n, n) };
    const color = fixed[0].color;
    if (!fixed.every(t => t.color === color)) return { valid: false };
    const nums = fixed.map(t => t.num);
    if (new Set(nums).size !== nums.length) return { valid: false };
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const sMin = Math.max(1, hi - n + 1);
    const sMax = Math.min(lo, 14 - n);
    if (sMin > sMax) return { valid: false };
    return { valid: true, points: sumRange(sMax, n) }; // Joker zählen so hoch wie möglich
}

function sumRange(start, n) {
    return (n * (2 * start + n - 1)) / 2;
}

function analyzeGroup(fixed, n) {
    if (n > 4 || fixed.length === 0) return { valid: false };
    const num = fixed[0].num;
    if (!fixed.every(t => t.num === num)) return { valid: false };
    const colors = fixed.map(t => t.color);
    if (new Set(colors).size !== colors.length) return { valid: false };
    return { valid: true, points: num * n };
}

// Prüft eine einzelne Kombination auf dem Tisch (Reihe oder Satz, mit Jokern).
export function analyzeSet(ids) {
    const n = ids.length;
    if (n < 3) return { valid: false, kind: null, points: 0 };
    const fixed = ids.map(tileInfo).filter(t => !t.joker);
    const run = analyzeRun(fixed, n);
    const group = analyzeGroup(fixed, n);
    if (run.valid && (!group.valid || run.points >= group.points)) return { valid: true, kind: 'run', points: run.points };
    if (group.valid) return { valid: true, kind: 'group', points: group.points };
    return { valid: false, kind: null, points: 0 };
}

const setKey = ids => [...ids].sort((a, b) => a - b).join(',');

// Prüft einen kompletten Zug. Wird vom Host (verbindlich) und von der Oberfläche (als Hinweis) benutzt.
//   oldTable/oldRack: Zustand zu Beginn des Zugs, table/rack: vorgeschlagener neuer Zustand.
export function evaluateMove({ oldTable, oldRack, table, rack, melded }) {
    const before = new Set([...oldTable.flat(), ...oldRack]);
    const after = [...table.flat(), ...rack];
    if (after.length !== before.size || new Set(after).size !== after.length || !after.every(id => before.has(id))) {
        return fail('Die Steine stimmen nicht überein.');
    }
    const onTable = new Set(table.flat());
    if (!oldTable.flat().every(id => onTable.has(id))) {
        return fail('Steine, die schon auf dem Tisch lagen, dürfen nicht zurück in den Ständer.');
    }
    const oldIds = new Set(oldTable.flat());
    const added = table.flat().filter(id => !oldIds.has(id));
    if (added.length === 0) return fail('Lege mindestens einen Stein oder ziehe einen.');

    let points = 0;
    if (!melded) {
        // Vor dem ersten Auslegen muss der Tisch unverändert bleiben, nur neue Kombinationen zählen.
        const rest = table.map(set => ({ set, key: setKey(set) }));
        for (const old of oldTable) {
            const i = rest.findIndex(r => r.key === setKey(old));
            if (i < 0) return fail('Vor dem ersten Auslegen darfst du den Tisch nicht umbauen.');
            rest.splice(i, 1);
        }
        points = rest.reduce((sum, r) => {
            const a = analyzeSet(r.set);
            return sum + (a.valid ? a.points : 0);
        }, 0);
    }
    if (!table.every(set => analyzeSet(set).valid)) return fail('Nicht alle Reihen und Sätze sind gültig.', points);
    if (!melded && points < MELD_MIN) {
        return fail(`Zum ersten Auslegen brauchst du mindestens ${MELD_MIN} Punkte (bisher ${points}).`, points);
    }
    return { ok: true, added, points };
}
