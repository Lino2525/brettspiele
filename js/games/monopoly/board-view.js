// Darstellung des Spielplans: Felder im 11x11-Raster, Besitzer, Häuser und die Spielfiguren.
import { SPACES, GROUPS } from './board.js';

// Neon-Grid: gelb, cyan, pink, violett (Schrift immer dunkel)
export const PLAYER_COLORS = ['#fcee0a', '#05d9e8', '#ff2a6d', '#b967ff'];
export const PLAYER_TEXT = ['#08080d', '#08080d', '#08080d', '#08080d'];

export const money = n => `M ${Number(n).toLocaleString('de-DE')}`;

// [Zeile, Spalte] im Raster. LOS unten rechts, im Uhrzeigersinn: unten nach links, links nach oben, oben nach rechts, rechts nach unten.
function gridPos(i) {
    if (i === 0) return [11, 11];
    if (i < 10) return [11, 11 - i];
    if (i === 10) return [11, 1];
    if (i < 20) return [21 - i, 1];
    if (i === 20) return [1, 1];
    if (i < 30) return [1, 1 + (i - 20)];
    if (i === 30) return [1, 11];
    return [1 + (i - 30), 11];
}

const sideOf = i => (i % 10 === 0 ? 'corner' : i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right');

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cellInner(i) {
    const s = SPACES[i];
    switch (s.type) {
        case 'street':
            return `<div class="band" style="background:${GROUPS[s.group].color}"><span class="houses"></span></div>
                <div class="cbody"><div class="cname">${esc(s.name)}</div><div class="cprice">${money(s.price)}</div></div>`;
        case 'rail':
            return `<div class="cbody"><div class="cicon">🚂</div><div class="cname">${esc(s.name)}</div><div class="cprice">${money(s.price)}</div></div>`;
        case 'util':
            return `<div class="cbody"><div class="cicon">${s.name.startsWith('Wasser') ? '🚰' : '💡'}</div><div class="cname">${esc(s.name)}</div><div class="cprice">${money(s.price)}</div></div>`;
        case 'chance':
            return '<div class="cbody"><div class="cicon big chance">?</div><div class="cname">Ereignis</div></div>';
        case 'chest':
            return '<div class="cbody"><div class="cicon big">🎁</div><div class="cname">Gemeinschaft</div></div>';
        case 'tax':
            return `<div class="cbody"><div class="cicon">💰</div><div class="cname">${esc(s.name)}</div><div class="cprice">${money(s.amount)}</div></div>`;
        case 'go':
            return '<div class="cbody"><div class="cname big">LOS</div><div class="cicon">➜</div><div class="cprice">+ M 200</div></div>';
        case 'jail':
            return '<div class="cbody"><div class="cicon">🔒</div><div class="cname">Gefängnis</div><div class="cprice">nur zu Besuch</div></div>';
        case 'parking':
            return '<div class="cbody"><div class="cicon big">🅿️</div><div class="cname">Frei Parken</div></div>';
        case 'gotojail':
            return '<div class="cbody"><div class="cicon">👮</div><div class="cname">Gehe ins Gefängnis</div></div>';
        default:
            return '';
    }
}

export function createBoard(container, { onCellClick }) {
    const board = document.createElement('div');
    board.className = 'board';
    const cells = [];
    for (let i = 0; i < 40; i++) {
        const [row, col] = gridPos(i);
        const cell = document.createElement('div');
        cell.className = `cell side-${sideOf(i)} type-${SPACES[i].type}`;
        cell.dataset.idx = i;
        cell.style.gridColumn = col;
        cell.style.gridRow = row;
        cell.innerHTML = cellInner(i) + '<div class="owner"></div>';
        cell.addEventListener('click', () => onCellClick(i));
        board.appendChild(cell);
        cells.push(cell);
    }
    const tokens = document.createElement('div');
    tokens.className = 'tokens';
    board.appendChild(tokens);
    container.appendChild(board);

    const tokenEls = new Map();
    let lastPositions = [];
    let lastPlayers = [];
    let avatars = [];

    const resize = () => {
        board.style.setProperty('--u', `${board.clientWidth / 100}px`);
        placeTokens(lastPositions, lastPlayers, false);
    };
    new ResizeObserver(resize).observe(board);

    function tokenEl(seat) {
        let el = tokenEls.get(seat);
        if (!el) {
            el = document.createElement('div');
            el.className = 'token';
            tokens.appendChild(el);
            tokenEls.set(seat, el);
        }
        return el;
    }

    // positions: angezeigte Felder je Spieler (kann der Animation hinterherlaufen)
    function placeTokens(positions, players, animate = true) {
        lastPositions = positions;
        lastPlayers = players;
        const bySlot = new Map();
        const size = board.clientWidth * 0.034;
        players.forEach((p, seat) => {
            const el = tokenEl(seat);
            el.hidden = p.bankrupt;
            el.style.background = PLAYER_COLORS[seat];
            el.style.color = PLAYER_TEXT[seat];
            const img = avatars[seat];
            el.style.backgroundImage = img ? `url("${img}")` : 'none';
            el.textContent = img ? '' : p.name.slice(0, 1).toUpperCase();
            el.title = p.name;
            el.classList.toggle('jailed', p.inJail);
            if (p.bankrupt) return;
            const pos = positions[seat] ?? p.pos;
            const k = bySlot.get(pos) ?? 0;
            bySlot.set(pos, k + 1);
            const cell = cells[pos];
            const cx = cell.offsetLeft + cell.offsetWidth / 2;
            const cy = cell.offsetTop + cell.offsetHeight / 2;
            const dx = (k % 2 ? 0.55 : -0.55) * size;
            const dy = (k < 2 ? -0.55 : 0.55) * size * (p.inJail && pos === 10 ? 0.4 : 1);
            el.style.width = el.style.height = `${size}px`;
            el.style.transition = animate ? '' : 'none';
            el.style.transform = `translate(${cx + dx - size / 2}px, ${cy + dy - size / 2}px)`;
        });
    }

    function setAvatars(list) {
        avatars = list;
        placeTokens(lastPositions, lastPlayers, false);
    }

    // Besitzer, Häuser und Hypotheken der Felder aktualisieren
    function updateCells(props, players) {
        cells.forEach((cell, i) => {
            const p = props[i];
            if (!p) return;
            const owner = cell.querySelector('.owner');
            owner.style.background = p.owner === null ? 'transparent' : PLAYER_COLORS[p.owner];
            owner.title = p.owner === null ? '' : players[p.owner].name;
            cell.classList.toggle('owned', p.owner !== null);
            cell.classList.toggle('mortgaged', p.mortgaged);
            const houses = cell.querySelector('.houses');
            if (houses) houses.innerHTML = p.houses === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(p.houses);
        });
    }

    return { el: board, placeTokens, setAvatars, updateCells, cells };
}
