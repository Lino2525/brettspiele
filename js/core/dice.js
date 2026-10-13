// 3D-Würfel für Sternenjagd und Immobilienspiel. Aussehen: .pdice/.pdie in css/style.css
//   DIE_HTML                 Markup eines Würfels (sechs Seiten mit Augen), in ein .pdice-Element setzen
//   turnDie(die, value, o)   dreht .pdie auf die Zahl; o.roll: mit ganzen Umdrehungen (sichtbarer Wurf),
//                            o.instant: ohne Übergang, o.dir: Drehrichtung (1 oder -1, damit zwei Würfel verschieden rollen)

// Augen je Seite (Zeile, Spalte im 3 x 3 Raster) und die Drehung, die eine Seite nach vorn bringt
const PIPS = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [1, 3], [3, 1], [3, 3]], 5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]], 6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]] };
const FACE_TURN = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };

export const DIE_HTML = `<span class="pdie">${Object.entries(PIPS).map(([n, pips]) => `<span class="face f${n}">${pips.map(([r, c]) => `<i style="grid-area:${r}/${c}"></i>`).join('')}</span>`).join('')}</span>`;

export function turnDie(die, value, { roll = false, instant = false, dir = 1 } = {}) {
    const spins = Number(die.dataset.spins || 0) + (roll ? 1 : 0);
    die.dataset.spins = spins;
    const [x, y] = value ? FACE_TURN[value] : [0, 0];
    const tilt = value ? 'rotateX(-16deg) rotateY(20deg)' : 'rotateX(-28deg) rotateY(38deg)';
    if (instant) die.classList.add('instant');
    die.style.transform = `${tilt} rotateX(${x + dir * spins * 360}deg) rotateY(${y + dir * spins * 720}deg)`;
    if (instant) {
        void die.offsetWidth;
        die.classList.remove('instant');
    }
}
