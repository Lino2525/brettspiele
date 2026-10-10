// Oberfläche von Sternenjagd: Spielbrett (Wegenetz) mit Würfel und Figuren, Punktetafel, Entscheidungen und Minispiele.
// Alle sehen Würfel, Bewegung und Ereignisse live, die Animationen laufen lokal ab.
import { NODES, SEGMENTS, BOARD_W, BOARD_H, STAR_SPOTS, COIN_GAIN, COIN_LOSS } from './board.js';
import { createMiniGame } from './mini-ui.js';
import { MINIS, MINI_TYPES, DUEL_TYPES } from './minigames.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Neon-Grid: gelb, cyan, pink, violett; ab dem 5. Platz orange und grün
export const PLAYER_COLORS = ['#fcee0a', '#05d9e8', '#ff2a6d', '#b967ff', '#ff9a00', '#39ff14'];
const SPACE_LABEL = { start: '▶', blue: `+${COIN_GAIN}`, red: `−${COIN_LOSS}`, luck: '?', shield: '🛡', duel: 'VS', teleport: 'TP' };
const SPACE_NAME = { start: 'Start', blue: `+${COIN_GAIN} Münzen`, red: `−${COIN_LOSS} Münzen`, luck: 'Glücksfeld', shield: 'Schild', duel: 'Duell', teleport: 'Teleport zum Stern' };
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MINI_TITLES = MINI_TYPES.map(t => MINIS[t].title);
const DUEL_TITLES = DUEL_TYPES.map(t => MINIS[t].title);
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
const PORTRAIT = '(max-width: 640px) and (orientation: portrait)';
// Versatz bei mehreren Figuren auf einem Feld (2 x 2)
const TOKEN_OFFSETS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, -1.6]];

const TEMPLATE = `
<div class="party">
  <div class="ptop"><span class="pround"></span><span class="phint"></span></div>
  <div class="pscore"></div>
  <div class="pstage">
    <div class="pboard-wrap"><div class="pboard"><svg class="plines" aria-hidden="true"></svg></div></div>
    <div class="pmini" hidden></div>
  </div>
  <div class="pcontrol">
    <div class="pdice"><span class="pdie">?</span></div>
    <div class="pmain"><div class="pstatus"></div><div class="pact"></div></div>
    <div class="pfeed"></div>
  </div>
  <div class="plegend">${['blue', 'red', 'luck', 'shield', 'duel', 'teleport'].map(t => `<span><i class="lg t-${t}">${SPACE_LABEL[t]}</i>${SPACE_NAME[t]}</span>`).join('')}<span><i class="lg oneway">➜</i>Einbahnstraße</span><span><i class="lg trap">✖</i>Falle</span></div>
  <div class="pbonus" hidden></div>
  <div class="overlay" hidden><div class="overlay-box"></div></div>
  <div class="toast" hidden></div>
</div>`;

export function mountParty(root, session) {
    root.innerHTML = TEMPLATE;
    const $ = sel => root.querySelector(sel);
    const el = {
        round: $('.pround'), hint: $('.phint'), score: $('.pscore'), boardWrap: $('.pboard-wrap'), board: $('.pboard'), lines: $('.plines'),
        mini: $('.pmini'), overlay: $('.overlay'), overlayBox: $('.overlay-box'), toast: $('.toast'), control: $('.pcontrol'), legend: $('.plegend'), bonus: $('.pbonus'),
    };

    const st = {
        view: null, avatars: [], displayPos: [], lastEvent: 0, receivedAt: 0, mini: null, dicePlaying: false, shownDice: null,
        movingSeat: null, laidOut: false, prevScore: [], gainAt: [], pending: 0, portrait: false, statusBase: '', stake: 'star',
    };
    let toastTimer = null;
    let dead = false;
    let chain = Promise.resolve();
    // Animationen laufen nacheinander; solange noch etwas läuft, warten Entscheidungen (Abzweigung, Duell, Teleport)
    const enqueue = fn => {
        st.pending++;
        chain = chain
            .then(() => (dead ? null : fn()))
            .catch(console.error)
            .finally(() => {
                st.pending--;
                if (!st.pending && !dead && st.view) renderBoard();
            });
    };

    // ---------- Spielbrett aufbauen ----------

    const cells = NODES.map(n => {
        const c = document.createElement('div');
        c.className = `pcell t-${n.type}`;
        c.dataset.id = n.id;
        c.title = SPACE_NAME[n.type];
        c.innerHTML = `<span class="pl">${SPACE_LABEL[n.type]}</span>`;
        el.board.appendChild(c);
        return c;
    });
    const tokEls = [];
    const trapEls = [];
    const starEl = document.createElement('span');
    starEl.className = 'pst';
    starEl.textContent = '★';
    starEl.hidden = true;
    el.board.appendChild(starEl);
    const ui = { dice: $('.pdie'), status: $('.pstatus'), act: $('.pact'), feed: $('.pfeed') };

    // Koordinaten in Rastereinheiten; auf dem Handy hochkant wird das Brett um 90° gedreht
    const unit = id => {
        const n = NODES[id];
        return st.portrait ? [BOARD_H - (n.y + 1), n.x + 1] : [n.x + 1, n.y + 1];
    };

    function layoutBoard() {
        st.portrait = typeof matchMedia === 'function' && matchMedia(PORTRAIT).matches;
        const [w, h] = st.portrait ? [BOARD_H, BOARD_W] : [BOARD_W, BOARD_H];
        el.board.style.setProperty('--cols', w);
        el.board.style.setProperty('--rows', h);
        el.board.classList.toggle('portrait', st.portrait);
        cells.forEach((c, id) => {
            const [x, y] = unit(id);
            c.style.left = `${(x / w) * 100}%`;
            c.style.top = `${(y / h) * 100}%`;
        });
        // Wege als Linien, Einbahnstraßen mit Pfeilspitzen in der Mitte
        let svg = '';
        for (const seg of SEGMENTS) {
            const [x1, y1] = unit(seg.a);
            const [x2, y2] = unit(seg.b);
            svg += `<line class="seg ${seg.kind}${seg.oneway ? ' oneway' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
            if (seg.oneway) {
                const len = Math.hypot(x2 - x1, y2 - y1);
                const [dx, dy] = [(x2 - x1) / len, (y2 - y1) / len];
                const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
                const pts = [[mx + dx * 0.32, my + dy * 0.32], [mx - dx * 0.22 - dy * 0.26, my - dy * 0.22 + dx * 0.26], [mx - dx * 0.22 + dy * 0.26, my - dy * 0.22 - dx * 0.26]];
                svg += `<polygon class="arrow ${seg.kind}" points="${pts.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ')}"/>`;
            }
        }
        el.lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
        el.lines.innerHTML = svg;
        renderTokens();
        layoutTokens(true);
    }
    const portraitQuery = typeof matchMedia === 'function' ? matchMedia(PORTRAIT) : null;
    portraitQuery?.addEventListener?.('change', layoutBoard);

    // ---------- Zustand und Animationen ----------

    const name = seat => st.view.players[seat]?.name ?? '?';

    function applyView(v) {
        const first = st.view === null;
        st.view = v;
        st.receivedAt = performance.now();
        v.players.forEach((p, i) => {
            if (st.displayPos[i] === undefined) st.displayPos[i] = p.pos;
        });
        if (first) {
            st.lastEvent = v.eventSeq;
            if (v.dice) setDice(v.dice.value);
        } else {
            const fresh = v.events.filter(e => e.id > st.lastEvent);
            if (fresh.length) {
                st.lastEvent = fresh[fresh.length - 1].id;
                for (const e of fresh) enqueue(() => playEvent(e));
                enqueue(syncTokens);
            }
        }
    }

    function syncTokens() {
        st.displayPos = st.view.players.map(p => p.pos);
        renderTokens();
    }

    function setDice(value) {
        st.shownDice = value;
        ui.dice.textContent = value ? String(value) : '?';
        ui.dice.classList.remove('rolling');
    }

    function feed(text, kind = '') {
        const line = document.createElement('div');
        if (kind) line.className = kind;
        line.textContent = text;
        ui.feed.appendChild(line);
        while (ui.feed.children.length > 3) ui.feed.firstChild.remove();
        setTimeout(() => line.remove(), 4200);
    }

    // Zahl und Ring auf einem Feld (nur bei sichtbarem Brett)
    function cellCenter(i) {
        if (!cells[i] || !el.board.offsetWidth || el.boardWrap.hidden) return null;
        const [x, y] = unit(i);
        const [w, h] = st.portrait ? [BOARD_H, BOARD_W] : [BOARD_W, BOARD_H];
        return { x: (x / w) * el.board.clientWidth, y: (y / h) * el.board.clientHeight };
    }

    function fx(cellIndex, text, kind) {
        const c = cellCenter(cellIndex);
        if (!c || REDUCED) return;
        if (text) {
            const t = document.createElement('span');
            t.className = `pfx ${kind}`;
            t.textContent = text;
            t.style.left = `${c.x}px`;
            t.style.top = `${c.y}px`;
            el.board.appendChild(t);
            setTimeout(() => t.remove(), 1500);
        }
        const r = document.createElement('i');
        r.className = `pring ${kind}`;
        r.style.left = `${c.x}px`;
        r.style.top = `${c.y}px`;
        el.board.appendChild(r);
        setTimeout(() => r.remove(), 1300);
    }

    function flash() {
        if (REDUCED) return;
        const f = document.createElement('div');
        f.className = 'pflash';
        root.querySelector('.party').appendChild(f);
        setTimeout(() => f.remove(), 800);
    }

    async function playEvent(e) {
        switch (e.type) {
            case 'dice': {
                ui.dice.classList.add('rolling');
                ui.dice.classList.toggle('safe', !!e.safe);
                for (let i = 0; i < 7; i++) {
                    ui.dice.textContent = String(e.safe ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 6));
                    await sleep(80);
                }
                setDice(e.value);
                await sleep(200);
                break;
            }
            case 'move': {
                st.movingSeat = e.seat;
                for (const id of e.path) {
                    st.displayPos[e.seat] = id;
                    renderTokens();
                    await sleep(300);
                }
                st.movingSeat = null;
                renderTokens();
                break;
            }
            case 'teleport':
                fx(e.from, '', 'tele');
                st.displayPos[e.seat] = e.to;
                renderTokens();
                feed(`${name(e.seat)} teleportiert sich zum Stern!`, 'tele');
                await sleep(350);
                fx(e.to, 'TELEPORT', 'tele');
                await sleep(500);
                break;
            case 'shield':
                feed(`🛡 ${name(e.seat)} hat ein Schild (3 Runden)`, 'evt');
                fx(e.pos, '🛡 SCHILD', 'evt');
                await sleep(600);
                break;
            case 'trap':
                feed(`${name(e.seat)} legt eine Falle`, 'neg');
                fx(e.pos, '✖ FALLE', 'neg');
                await sleep(400);
                break;
            case 'trapHit':
                feed(`${name(e.seat)} tappt in die Falle von ${name(e.owner)}: −${e.amount} ¢`, 'neg');
                fx(e.pos, `✖ −${e.amount} ¢`, 'neg');
                await sleep(700);
                break;
            case 'duel':
                feed(`Duell um ${e.stake === 'coins' ? 'Münzen' : 'einen Stern'}: ${name(e.a)} gegen ${name(e.b)}!`, 'neg');
                await sleep(300);
                break;
            case 'star':
                feed(`★ ${name(e.seat)} kauft den Stern!`, 'star');
                fx(e.pos, '★ STERN!', 'star');
                flash();
                await sleep(500);
                break;
            case 'coins': {
                const gain = e.delta > 0;
                feed(`${name(e.seat)}: ${gain ? '+' : '−'}${Math.abs(e.delta)} ¢`, gain ? '' : 'neg');
                fx(st.displayPos[e.seat], `${gain ? '+' : '−'}${Math.abs(e.delta)} ¢`, gain ? '' : 'neg');
                break;
            }
            case 'info':
                feed(e.text, 'evt');
                fx(st.displayPos[e.seat], '', 'evt');
                await sleep(700);
                break;
            case 'swap': {
                const t = st.displayPos[e.a];
                st.displayPos[e.a] = st.displayPos[e.b];
                st.displayPos[e.b] = t;
                renderTokens();
                await sleep(400);
                break;
            }
            default:
                break;
        }
    }

    // ---------- Anzeige ----------

    function render() {
        const v = st.view;
        const playing = v.phase === 'mini' && v.mini;
        const wasHidden = el.boardWrap.hidden;
        el.boardWrap.hidden = !!playing;
        el.control.hidden = !!playing;
        el.legend.hidden = !!playing || v.phase === 'waiting';
        el.bonus.hidden = !!playing || v.phase === 'waiting';
        renderBonus();
        el.mini.hidden = !playing;
        if (wasHidden && !playing) st.laidOut = false;
        renderTop();
        renderScore();
        if (playing) renderMini(v);
        else {
            destroyMini();
            renderBoard();
        }
        renderOverlay();
    }

    function renderTop() {
        const v = st.view;
        if (v.phase === 'waiting') {
            el.round.textContent = 'Sternenjagd';
            el.hint.textContent = '';
        } else {
            const star = v.round % 3 === 0 || v.round === v.rounds;
            el.round.textContent = `Runde ${Math.max(1, v.round)} von ${v.rounds}`;
            el.hint.textContent = star ? '★ Sternrunde: Im Minispiel gewinnt man einen Stern' : `Ein Stern kostet ${v.starPrice} Münzen und zählt am Ende 10`;
        }
    }

    function renderScore() {
        const v = st.view;
        const now = performance.now();
        el.score.innerHTML = v.players
            .map((p, i) => {
                const prev = st.prevScore[i];
                if (prev && (prev.stars !== p.stars || prev.coins !== p.coins)) st.gainAt[i] = now;
                st.prevScore[i] = { stars: p.stars, coins: p.coins };
                const turn = v.phase === 'board' && v.turnSeat === i;
                const age = now - (st.gainAt[i] ?? -1e9);
                const gain = age < 900 && !REDUCED;
                // Die Animationen laufen beim Neuaufbau der Chips nahtlos weiter (negative Verzögerung)
                const delay = gain ? age : now % 1800;
                const avatar = st.avatars[i];
                return `<div class="pchip${turn ? ' on-turn' : ''}${gain ? ' gain' : ''}${i === v.seat ? ' me' : ''}${p.connected ? '' : ' off'}" style="--pc:${PLAYER_COLORS[i]};animation-delay:-${Math.round(delay)}ms">
                    <span class="ptk" style="background:${PLAYER_COLORS[i]}${avatar ? `;background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</span>
                    <span class="pname">${esc(p.name)}</span>${p.shield > 0 ? `<span class="pshield" title="Schild: noch ${p.shield} ${p.shield === 1 ? 'Runde' : 'Runden'}">🛡${p.shield}</span>` : ''}<span class="pst2">★${p.stars}</span><span class="pco">¢${p.coins}</span></div>`;
            })
            .join('');
    }

    function renderTokens() {
        const v = st.view;
        if (!v) return;
        cells.forEach((c, i) => c.classList.toggle('has-star', v.starPos === i));
        // Fallen: kleines Kreuz in der Farbe der Person, die sie gelegt hat
        const traps = v.phase === 'waiting' ? [] : v.traps || [];
        traps.forEach((t, k) => {
            let m = trapEls[k];
            if (!m) {
                m = document.createElement('span');
                m.className = 'ptrap';
                m.textContent = '✖';
                el.board.appendChild(m);
                trapEls[k] = m;
            }
            const c = cellCenter(t.pos);
            m.hidden = !c;
            if (c) {
                m.style.left = `${c.x}px`;
                m.style.top = `${c.y}px`;
                m.style.setProperty('--pc', PLAYER_COLORS[t.owner]);
                m.title = `Falle von ${name(t.owner)}`;
            }
        });
        for (let k = traps.length; k < trapEls.length; k++) trapEls[k].hidden = true;
        const star = v.phase === 'waiting' ? null : cellCenter(v.starPos);
        starEl.hidden = !star;
        if (star) {
            starEl.style.left = `${star.x}px`;
            starEl.style.top = `${star.y}px`;
        }
        layoutTokens(false);
    }

    // Figuren liegen auf einer eigenen Ebene über dem Brett; CSS gleitet sie von Feld zu Feld.
    // Beim ersten Platzieren, nach dem Einblenden und bei Größenänderung wird ohne Übergang gesetzt.
    function layoutTokens(instant) {
        const v = st.view;
        if (!v) return;
        if (!el.board.offsetWidth || el.boardWrap.hidden) {
            st.laidOut = false;
            return;
        }
        const snap = instant || !st.laidOut;
        if (snap) el.board.classList.remove('ready');
        const groups = new Map();
        v.players.forEach((p, seat) => {
            const pos = st.displayPos[seat] ?? p.pos;
            if (!groups.has(pos)) groups.set(pos, []);
            groups.get(pos).push(seat);
        });
        v.players.forEach((p, seat) => {
            let t = tokEls[seat];
            if (!t) {
                t = document.createElement('i');
                t.className = 'pt';
                el.board.appendChild(t);
                tokEls[seat] = t;
            }
            const avatar = st.avatars[seat];
            t.title = p.name;
            t.style.setProperty('--pc', PLAYER_COLORS[seat]);
            t.style.background = PLAYER_COLORS[seat];
            t.style.backgroundImage = avatar ? `url('${avatar}')` : '';
            t.textContent = avatar ? '' : p.name.slice(0, 1).toUpperCase();
            t.classList.toggle('turn', v.phase === 'board' && v.turnSeat === seat);
            t.classList.toggle('moving', st.movingSeat === seat);
            const pos = st.displayPos[seat] ?? p.pos;
            const group = groups.get(pos);
            const k = group.indexOf(seat);
            const [ox, oy] = group.length > 1 ? TOKEN_OFFSETS[k % TOKEN_OFFSETS.length] : [0, 0];
            const c = cellCenter(pos);
            const half = t.offsetWidth * 0.5;
            t.style.left = `${c.x + ox * half}px`;
            t.style.top = `${c.y + oy * half}px`;
        });
        if (snap) {
            void el.board.offsetWidth;
            requestAnimationFrame(() => el.board.classList.add('ready'));
            st.laidOut = true;
        }
    }
    const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
        renderTokens();
        layoutTokens(true);
    }) : null;
    resizer?.observe(el.board);
    layoutBoard();

    // Bonus-Rennen: wer gerade bei den Bonus-Sternen vorn liegt
    function renderBonus() {
        const v = st.view;
        if (!v || v.phase === 'waiting' || !v.bonuses) return;
        el.bonus.innerHTML = '<b>Bonus-Sterne am Ende:</b> ' + v.bonuses
            .map(b => {
                const best = Math.max(0, ...v.players.map(p => p[b.key] ?? 0));
                const who = best > 0 ? v.players.map((p, i) => i).filter(i => (v.players[i][b.key] ?? 0) === best) : [];
                return `<span>${esc(b.title)}: ${who.length ? `${who.map(i => `<i style="color:${PLAYER_COLORS[i]}">${esc(v.players[i].name)}</i>`).join(', ')} (${best})` : '–'}</span>`;
            })
            .join('');
    }

    function setStatus(text) {
        st.statusBase = text;
        ui.status.textContent = text;
    }

    // Richtung von einem Feld zum nächsten als Pfeil (so, wie das Brett gerade angezeigt wird)
    function arrow(from, to) {
        const [x1, y1] = unit(from);
        const [x2, y2] = unit(to);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return ARROWS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    }

    function renderBoard() {
        const v = st.view;
        renderTokens();
        cells.forEach(c => {
            c.classList.remove('opt', 'opt-view');
            delete c.dataset.act;
            delete c.dataset.to;
        });
        if (v.phase === 'board' && v.dice && st.shownDice === null) setDice(v.dice.value);
        if (v.phase !== 'board') {
            setStatus('');
            ui.act.innerHTML = '';
            return;
        }
        const seat = v.choice ? v.choice.seat : v.turnSeat;
        const mine = seat === v.seat;
        const cur = name(seat);
        const me = v.players[v.seat];
        // Während die Figur noch läuft, wird nichts gefragt
        if (st.pending && v.turnPhase !== 'roll') {
            setStatus(`${cur} zieht …`);
            ui.act.innerHTML = '';
            return;
        }
        switch (v.turnPhase) {
            case 'roll': {
                setStatus(mine ? 'Du bist dran!' : `${cur} ist dran`);
                if (!mine) {
                    ui.act.innerHTML = '<span class="muted">Warte auf den Wurf …</span>';
                    break;
                }
                const [lo, hi] = v.safeDie;
                const canTrap = STAR_SPOTS.includes(me.pos) && me.coins >= v.trapCost && !v.traps.some(t => t.pos === me.pos);
                const hasTrap = v.traps.some(t => t.owner === v.seat);
                ui.act.innerHTML = `<button class="btn primary big" type="button" data-act="roll" data-die="normal">Würfeln 1–6</button>
                    <button class="btn big" type="button" data-act="roll" data-die="safe">Sicher ${lo}–${hi}</button>
                    <button class="btn danger" type="button" data-act="trap"${canTrap ? '' : ' disabled'} title="Wer hier landet, zahlt dir bis zu ${v.trapCost} Münzen">Falle hier (${v.trapCost} ¢)</button>
                    ${hasTrap ? '<p class="pnote">Eine neue Falle ersetzt deine alte.</p>' : ''}`;
                break;
            }
            case 'buy':
                if (mine) {
                    setStatus(`Der Stern! Kaufen für ${v.starPrice} Münzen? (du hast ${me.coins})`);
                    ui.act.innerHTML = '<button class="btn primary" type="button" data-act="buy" data-go="1">Stern kaufen</button><button class="btn" type="button" data-act="buy" data-go="0">Liegen lassen</button><p class="pnote">Wer spart, hat mehr Münzen für Fallen und Duelle. Nach dem Kauf wandert der Stern weiter.</p>';
                } else {
                    setStatus(`${cur} steht am Stern und überlegt …`);
                    ui.act.innerHTML = '';
                }
                break;
            case 'choose': {
                const from = v.players[seat].pos;
                for (const id of v.choice.options) {
                    cells[id].classList.add(mine ? 'opt' : 'opt-view');
                    if (mine) {
                        cells[id].dataset.act = 'choose';
                        cells[id].dataset.to = id;
                    }
                }
                if (mine) {
                    setStatus(`Abzweigung! Wohin? Noch ${v.moveLeft} ${v.moveLeft === 1 ? 'Feld' : 'Felder'}`);
                    ui.act.innerHTML = v.choice.options
                        .map(id => `<button class="btn primary dir" type="button" data-act="choose" data-to="${id}"><b>${arrow(from, id)}</b> ${SPACE_LABEL[NODES[id].type]}</button>`)
                        .join('');
                } else {
                    setStatus(`${cur} wählt den Weg …`);
                    ui.act.innerHTML = '';
                }
                break;
            }
            case 'duel':
                if (mine) {
                    setStatus('Duell! Worum und gegen wen?');
                    const stake = (k, label) => `<button class="btn small stake${st.stake === k ? ' on' : ''}" type="button" data-act="stake" data-stake="${k}">${label}</button>`;
                    ui.act.innerHTML = `<div class="pstake">Einsatz: ${stake('star', 'Ein Stern')}${stake('coins', 'Bis zu 10 Münzen')}</div>` + v.choice.options
                        .map(i => {
                            const p = v.players[i];
                            return `<button class="btn duel-pick" type="button" data-act="duel" data-target="${i}" data-stake="${st.stake}" style="--pc:${PLAYER_COLORS[i]}">${esc(p.name)} <small>★${p.stars} ¢${p.coins}${p.shield > 0 ? ' 🛡' : ''}</small></button>`;
                        })
                        .join('') + `<p class="pnote">${st.stake === 'star' ? 'Sieg: 1 Stern vom Gegner (bei Schild oder ohne Stern bis zu 10 Münzen).' : 'Sieg: bis zu 10 Münzen vom Gegner, Sterne bleiben, wo sie sind.'} Niederlage: dasselbe andersherum.</p>`;
                } else {
                    setStatus(`${cur} sucht sich einen Gegner für ein Duell …`);
                    ui.act.innerHTML = '';
                }
                break;
            case 'teleport':
                if (mine) {
                    const enough = me.coins >= v.starPrice;
                    setStatus('Teleport! Direkt zum Stern springen?');
                    ui.act.innerHTML = `<button class="btn primary" type="button" data-act="teleport" data-go="1">Teleportieren</button><button class="btn" type="button" data-act="teleport" data-go="0">Hierbleiben</button>
                        <p class="pnote">${enough ? `Der Stern kostet ${v.starPrice} Münzen, du hast ${me.coins}.` : `Du hast nur ${me.coins} Münzen, der Stern kostet ${v.starPrice}. Du stehst dann aber direkt daneben.`}</p>`;
                } else {
                    setStatus(`${cur} überlegt, ob sie oder er sich teleportiert …`);
                    ui.act.innerHTML = '';
                }
                break;
            default:
                setStatus(`${cur} zieht …`);
                ui.act.innerHTML = '';
        }
    }

    // ---------- Minispiele ----------

    function destroyMini() {
        if (st.mini) {
            st.mini.timers?.forEach(clearTimeout);
            st.mini.instance?.destroy();
            st.mini = null;
            el.mini.innerHTML = '';
        }
    }

    function renderMini(v) {
        const m = v.mini;
        if (!st.mini || st.mini.id !== m.id) {
            destroyMini();
            el.mini.innerHTML = '<div class="mhead"></div><div class="mbody"></div>';
            st.mini = { id: m.id, phase: null, instance: null, deadline: 0, timers: new Set() };
        }
        const cur = st.mini;
        const head = el.mini.querySelector('.mhead');
        const body = el.mini.querySelector('.mbody');
        const duel = m.duel;
        const playsHere = !duel || duel.includes(v.seat);
        const cycle = duel ? `<span class="phint">${esc(name(duel[0]))} gegen ${esc(name(duel[1]))}</span>` : v.miniCycle ? `<span class="phint">Minispiel ${v.miniCycle.done} von ${v.miniCycle.total}</span>` : '';
        const heading = m.phase === 'intro' && cur.reeling ? (duel ? 'Duell' : 'Minispiel') : duel ? `Duell · ${m.title}` : m.title;
        head.innerHTML = `<strong>${esc(heading)}</strong>${cycle}${m.star ? '<span class="mstar">★ Sternrunde</span>' : ''}<span class="mtimer"></span>`;
        if (m.phase !== cur.phase) {
            cur.instance?.destroy();
            cur.instance = null;
            cur.timers.forEach(clearTimeout);
            cur.timers.clear();
            cur.reeling = false;
            cur.phase = m.phase;
            cur.deadline = performance.now() + m.msLeft;
            if (m.phase === 'intro') {
                // Zufalls-Walze nur, wenn die Einleitung noch fast die volle Zeit hat (nicht beim späten Beitritt)
                if (!REDUCED && m.msLeft >= 4500 && MINI_TITLES.includes(m.title)) runReel(cur, body, v, m, duel ? DUEL_TITLES : MINI_TITLES);
                else body.innerHTML = introHTML(cur, v, m);
            } else if (m.phase === 'play' && !playsHere) {
                body.innerHTML = '<div class="pduel-watch"></div>';
            } else if (m.phase === 'play') {
                body.innerHTML = '';
                // Im Duell geht der Zwischenstand gebündelt an den Host, damit die anderen zuschauen können
                const live = score => {
                    if (!duel) return;
                    cur.liveScore = score;
                    if (cur.liveTimer) return;
                    cur.liveTimer = setTimeout(() => {
                        cur.timers.delete(cur.liveTimer);
                        cur.liveTimer = null;
                        if (cur.liveScore !== cur.liveSent) {
                            cur.liveSent = cur.liveScore;
                            session.send({ t: 'mini', kind: 'live', score: cur.liveScore });
                        }
                    }, 400);
                    cur.timers.add(cur.liveTimer);
                };
                const api = {
                    progress: live,
                    seat: v.seat,
                    remaining: () => cur.deadline - performance.now(),
                    avatars: () => st.avatars,
                    names: () => st.view.players.map(p => p.name),
                    submit: score => session.send({ t: 'mini', kind: 'score', score }),
                    send: payload => session.send({ t: 'mini', ...payload }),
                };
                cur.instance = createMiniGame(m.type, body, m, api);
            }
        }
        if (m.phase === 'play') cur.instance?.update(m);
        if (m.phase === 'play' && !playsHere) body.querySelector('.pduel-watch').innerHTML = watchHTML(v);
        if (m.phase === 'result') body.innerHTML = resultHTML(v);
    }

    function introHTML(cur, v, m) {
        const secs = Math.max(0.5, (cur.deadline - performance.now()) / 1000);
        const title = esc(m.title);
        const vs = m.duel ? `<div class="pduel-vs">${duelSide(v, m.duel[0])}<b>VS</b>${duelSide(v, m.duel[1])}</div><p class="pduel-stake">Es geht um ${m.stake === 'coins' ? 'bis zu 10 Münzen' : 'einen Stern'}.</p>${m.duel.includes(v.seat) ? '' : '<p class="muted">Du schaust zu.</p>'}` : '';
        return `<div class="mintro"><i class="scanbar"></i>${vs}<h2 class="glitch" data-text="${title}">${title}</h2><p>${esc(m.rules)}</p>${teamIntroHTML(v)}${m.star ? '<p class="mstar">Wer gewinnt, bekommt einen Stern!</p>' : ''}<p class="muted">Gleich geht’s los …</p><div class="mprog"><i style="--ms:${secs.toFixed(2)}s"></i></div></div>`;
    }

    // Minispiel-Zufall: Slot-Walze mit allen Titeln. Das Ziel ist das Spiel, das der Host wirklich gewählt hat.
    // Die Walze bremst von 40 ms auf ca. 370 ms je Zeile ab (kubisch), rastet grün ein und wartet 1,3 s.
    function runReel(cur, body, v, m, titles) {
        const len = titles.length;
        const target = titles.indexOf(m.title);
        const STEPS = 16;
        let idx = (((target - STEPS) % len) + len) % len;
        body.innerHTML = `<div class="reel"><div class="reel-label">${m.duel ? 'Duell-Zufall' : 'Minispiel-Zufall'}</div><div class="reel-win">${['d2', 'd1', 'c', 'd1', 'd2'].map(c => `<div class="reel-row ${c}"></div>`).join('')}<div class="reel-bracket"></div></div><div class="reel-lock">ZIEL ERFASST</div></div>`;
        cur.reeling = true;
        const heading = el.mini.querySelector('.mhead strong');
        if (heading) heading.textContent = m.duel ? 'Duell' : 'Minispiel';
        const reel = body.querySelector('.reel');
        const rows = [...body.querySelectorAll('.reel-row')];
        const paint = () => rows.forEach((row, k) => (row.textContent = titles[(idx + k - 2 + 2 * len) % len]));
        const later = (fn, ms) => {
            const id = setTimeout(() => {
                cur.timers.delete(id);
                fn();
            }, ms);
            cur.timers.add(id);
        };
        let k = 0;
        const step = () => {
            idx = (idx + 1) % len;
            k++;
            paint();
            if (k >= STEPS) {
                reel.classList.add('locked');
                later(() => {
                    cur.reeling = false;
                    body.innerHTML = introHTML(cur, st.view, st.view.mini ?? m);
                    const head = el.mini.querySelector('.mhead strong');
                    if (head) head.textContent = m.duel ? `Duell · ${m.title}` : m.title;
                }, 1300);
                return;
            }
            later(step, 40 + 330 * Math.pow(k / (STEPS - 1), 3));
        };
        paint();
        later(step, 40);
    }

    // Bei Teams: wer gehört wohin. In Sternrunden spielt jede Person für sich.
    function teamIntroHTML(v) {
        const m = v.mini;
        if (m.teams) {
            const cols = [0, 1].map(t => `<div class="cg-teamcol t${t}"><h3>${esc(m.teams.names[t])}</h3>${v.players.map((p, i) => (m.teams.of[i] === t ? `<div>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</div>` : '')).join('')}</div>`).join('');
            return `<div class="cg-teamcols">${cols}</div><p class="muted">Ihr spielt in Teams: gewertet wird der Durchschnitt des Teams, alle im besseren Team bekommen die bessere Belohnung.</p>`;
        }
        if (m.teamCapable && m.star && v.players.length >= 4) return '<p class="muted">Sternrunde: Hier spielt jede Person für sich.</p>';
        return '';
    }

    function duelSide(v, seat) {
        const avatar = st.avatars[seat];
        const p = v.players[seat];
        return `<span class="pduel-side" style="--pc:${PLAYER_COLORS[seat]}"><span class="ptk" style="background:${PLAYER_COLORS[seat]}${avatar ? `;background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</span>${esc(p.name)}</span>`;
    }

    // Zuschauer im Duell: Zwischenstand beider Seiten
    function watchHTML(v) {
        const m = v.mini;
        const live = m.live || {};
        const top = Math.max(1, ...m.duel.map(s => live[s] ?? 0));
        const side = s => `<div class="pduel-row">${duelSide(v, s)}<div class="pduel-bar" style="--pc:${PLAYER_COLORS[s]}"><i style="width:${((live[s] ?? 0) / top) * 100}%"></i></div><b>${live[s] ?? 0}</b>${m.submitted.includes(s) ? '<small>fertig</small>' : ''}</div>`;
        return `<p class="muted">Du schaust zu: ${esc(m.title)}</p>${side(m.duel[0])}<div class="pduel-mid">VS</div>${side(m.duel[1])}`;
    }

    const prizeHTML = r => {
        if (r.stars) return `<b class="prize star${r.stars < 0 ? ' neg' : ''}">${r.stars > 0 ? '+' : '−'}★</b>`;
        return `<b class="prize${r.coins < 0 ? ' neg' : ''}">${r.coins < 0 ? '−' : '+'}${Math.abs(r.coins)} ¢</b>`;
    };

    function resultHTML(v) {
        const m = v.mini;
        if (!m.result) return '<div class="mintro"><p>Auswertung …</p></div>';
        let duelText = '';
        if (m.duel) {
            const o = m.outcome || {};
            duelText = o.winner == null
                ? '<p class="pduel-res">Unentschieden: Niemand bekommt etwas.</p>'
                : `<p class="pduel-res"><b>${esc(name(o.winner))}</b> gewinnt das Duell${o.stars ? ` und schnappt sich einen Stern von ${esc(name(o.loser))}!` : o.coins ? ` und bekommt ${o.coins} Münzen von ${esc(name(o.loser))}.` : `, aber bei ${esc(name(o.loser))} ist nichts zu holen.`}${o.shielded ? ' Das Schild hat den Stern geschützt.' : ''}${o.stake === 'coins' ? ' (Es ging nur um Münzen.)' : ''}</p>`;
        }
        const rows = m.result
            .map((r, i) => {
                const prize = prizeHTML(r);
                return `<tr style="--i:${i}" class="${r.rank === 1 && r.score > 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${r.rank}.</td><td>${esc(v.players[r.seat].name)}</td><td>${r.score}</td><td>${prize}</td></tr>`;
            })
            .join('');
        const teams = m.teams && m.teamScores ? `<p class="center">${[0, 1].map(t => `<b style="color:${t ? 'var(--cyan)' : 'var(--pink)'}">${esc(m.teams.names[t])}: Ø ${m.teamScores[t]}</b>`).join(' · ')}</p>` : '';
        return `${duelText}${teams}<table class="ranking"><thead><tr><th></th><th></th><th>Punkte</th><th>Gewinn</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function updateTimers() {
        const v = st.view;
        if (!v) return;
        const elapsed = performance.now() - st.receivedAt;
        const t = el.mini.querySelector('.mtimer');
        if (t && v.mini) t.textContent = v.mini.phase === 'result' || (v.mini.kind === 'sub' && v.mini.phase === 'play') ? '' : `${Math.max(0, Math.ceil((v.mini.msLeft - elapsed) / 1000))} s`;
        // Restzeit für eigene Entscheidungen (Würfeln, Abzweigung, Duell, Teleport)
        if (v.phase === 'board' && (v.turnPhase === 'roll' || v.choice) && !st.pending) {
            const seat = v.choice ? v.choice.seat : v.turnSeat;
            const left = Math.max(0, Math.ceil((v.turnMsLeft - elapsed) / 1000));
            if (seat === v.seat && st.statusBase) ui.status.textContent = `${st.statusBase} (${left} s)`;
        }
    }
    const timer = setInterval(updateTimers, 250);

    // ---------- Fenster ----------

    function renderOverlay() {
        const v = st.view;
        let html = '';
        if (v.phase === 'waiting') {
            const isHost = v.seat === v.hostSeat;
            const list = v.players.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span><span class="ptk sm" style="background:${PLAYER_COLORS[i]};--pc:${PLAYER_COLORS[i]}"></span>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`).join('');
            const rounds = v.roundOptions
                .map(n => `<button class="btn${n === v.rounds ? ' primary' : ''}" type="button" data-act="setRounds" data-n="${n}"${isHost ? '' : ' disabled'}>${n}</button>`)
                .join('');
            html = `<h2>Sternenjagd</h2><ul class="plist">${list}</ul>
                <p>Es können ${v.minPlayers} bis ${v.maxPlayers} Personen mitspielen. Würfelt über das Spielfeld, entscheidet an Abzweigungen selbst, wohin es geht, sammelt Münzen und Sterne und gewinnt die Minispiele! Ein Stern zählt am Ende 10 Münzen.</p>
                <ul class="prules"><li><b>Einbahnstraßen</b> (Pfeile) darf man nur in Pfeilrichtung laufen.</li><li><b>🛡 Schild:</b> 3 Runden lang kann dir niemand einen Stern abnehmen.</li><li><b>VS Duell:</b> Wähle einen Gegner. Wer das Minispiel gewinnt, bekommt 1 Stern vom anderen (sonst bis zu 10 Münzen).</li><li><b>TP Teleport:</b> Spring direkt zum Stern.</li><li><b>Würfel:</b> normal 1–6 oder sicher 2–4, du entscheidest vor jedem Wurf.</li><li><b>Stern:</b> Am Stern wirst du gefragt, ob du ihn für ${v.starPrice} Münzen kaufst.</li><li><b>✖ Falle:</b> Vor dem Wurf für ${v.trapCost} Münzen auf dein Feld legen. Wer dort landet, zahlt dir bis zu ${v.trapCost}.</li><li><b>Bonus-Sterne am Ende:</b> ${v.bonuses.map(b => `${esc(b.title)} (${esc(b.what)})`).join(', ')}.</li></ul>
                <p class="muted">Rundenzahl:</p><div class="row center">${rounds}</div>` +
                (isHost
                    ? `<p><button class="btn primary" type="button" data-act="start"${v.players.length >= v.minPlayers ? '' : ' disabled'}>Spiel starten</button></p>`
                    : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`);
        } else if (v.phase === 'over') {
            const rows = v.ranking
                .map((r, k) => `<tr style="--i:${k}" class="${k === 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${k + 1}.</td><td>${esc(v.players[r.seat].name)}</td><td>★${r.stars}</td><td>¢${r.coins}</td><td><b>${r.total}</b></td></tr>`)
                .join('');
            const title = v.ranking[0].seat === v.seat ? 'Du hast gewonnen!' : `${esc(v.players[v.ranking[0].seat].name)} hat gewonnen`;
            const bonus = (v.bonus || [])
                .map(b => `<li><b>${esc(b.title)}</b> (${esc(b.what)}${b.value ? `: ${b.value}` : ''}): ${b.seats.length ? b.seats.map(i => esc(v.players[i].name)).join(', ') + ' <span class="prize star">+★</span>' : 'niemand'}</li>`)
                .join('');
            html = `<h2 class="glitch" data-text="${title}">${title}</h2>${bonus ? `<ul class="pbonus-list">${bonus}</ul>` : ''}<p>Ein Stern zählt 10 Münzen (Bonus-Sterne schon mitgezählt).</p>
                <table class="ranking"><thead><tr><th></th><th></th><th>Sterne</th><th>Münzen</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
                <button class="btn primary" type="button" data-act="rematch">Noch einmal spielen</button>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.dataset.html !== html) {
            el.overlayBox.dataset.html = html;
            el.overlayBox.innerHTML = html;
        }
        // Endwertung: fallende Neon-Partikel hinter der Tabelle
        const fall = el.overlay.querySelector('.fall');
        if (v.phase === 'over' && !fall && !REDUCED) {
            const f = document.createElement('div');
            f.className = 'fall';
            f.setAttribute('aria-hidden', 'true');
            f.innerHTML = Array.from({ length: 30 }, (_, n) => `<i style="--n:${n}"></i>`).join('');
            el.overlay.prepend(f);
        } else if (v.phase !== 'over' && fall) fall.remove();
    }

    function toast(text) {
        el.toast.textContent = text;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
    }

    // ---------- Eingaben ----------

    root.addEventListener('click', e => {
        const t = e.target.closest('[data-act]');
        if (!t || !st.view) return;
        switch (t.dataset.act) {
            case 'roll':
                session.send({ t: 'roll', die: t.dataset.die === 'safe' ? 'safe' : 'normal' });
                break;
            case 'start': case 'rematch': case 'trap':
                session.send({ t: t.dataset.act });
                break;
            case 'buy':
                session.send({ t: 'buy', go: t.dataset.go === '1' });
                break;
            case 'stake':
                st.stake = t.dataset.stake === 'coins' ? 'coins' : 'star';
                renderBoard();
                break;
            case 'setRounds':
                session.send({ t: 'setRounds', n: Number(t.dataset.n) });
                break;
            case 'choose':
                session.send({ t: 'choose', to: Number(t.dataset.to) });
                break;
            case 'duel':
                session.send({ t: 'duel', target: Number(t.dataset.target), stake: t.dataset.stake });
                break;
            case 'teleport':
                session.send({ t: 'teleport', go: t.dataset.go === '1' });
                break;
        }
    });

    // ---------- Anbindung ----------

    session.onView = v => {
        applyView(v);
        render();
    };
    session.onNotice = text => toast(text);
    session.onAvatars = list => {
        st.avatars = list;
        if (st.view) {
            renderScore();
            renderTokens();
        }
    };

    return {
        destroy() {
            dead = true;
            clearInterval(timer);
            destroyMini();
            resizer?.disconnect();
            portraitQuery?.removeEventListener?.('change', layoutBoard);
            root.innerHTML = '';
        },
    };
}
