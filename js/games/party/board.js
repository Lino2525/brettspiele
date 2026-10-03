// Spielfeld von Sternenjagd: ein Rundkurs mit 28 Feldern. Reine Daten, ohne Browser-Abhängigkeiten.

export const RING = 28;

// blue = +3 Münzen, red = −3 Münzen, green = Glücksfeld mit zufälligem Ereignis, start = Startfeld
export const SPACE_TYPES = [
    'start', 'blue', 'blue', 'green', 'blue', 'red', 'blue', 'blue', 'green', 'blue', 'red', 'blue', 'blue', 'green',
    'blue', 'red', 'blue', 'blue', 'green', 'blue', 'red', 'blue', 'blue', 'green', 'blue', 'red', 'blue', 'blue',
];

export const COIN_GAIN = 3;
export const COIN_LOSS = 3;

// Feld -> [Zeile, Spalte] auf einem Raster mit 7 Zeilen und 9 Spalten (nur der Rand wird benutzt).
// Reihenfolge im Uhrzeigersinn, Feld 0 oben links.
export function ringCell(i) {
    if (i < 9) return [1, 1 + i]; // oben von links nach rechts
    if (i < 15) return [2 + (i - 9), 9]; // rechts von oben nach unten
    if (i < 23) return [7, 8 - (i - 15)]; // unten von rechts nach links
    return [6 - (i - 23), 1]; // links von unten nach oben
}

export const GRID_ROWS = 7;
export const GRID_COLS = 9;
