// Oberfläche von Sternenjagd: Spielbrett mit Würfeln und Figuren, Punktetafel und Minispiele.
// Bewusst schlicht gehalten. Alle sehen Würfel, Bewegung und Ereignisse live, die Animationen laufen lokal ab.
import { RING, SPACE_TYPES, ringCell, GRID_ROWS, GRID_COLS, COIN_GAIN, COIN_LOSS } from './board.js';
import { createMiniGame } from './mini-ui.js';
import { MINIS, MINI_TYPES } from './minigames.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Neon-Grid: gelb, cyan, pink, violett; ab dem 5. Platz orange und grün
export const PLAYER_COLORS = ['#fcee0a', '#05d9e8', '#ff2a6d', '#b967ff', '#ff9a00', '#39ff14'];
const SPACE_LABEL = { start: 'START', blue: `+${COIN_GAIN}`, red: `−${COIN_LOSS}`, green: '?' };
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MINI_TITLES = MINI_TYPES.map(t => MINIS[t].title);
// Versatz bei mehreren Figuren auf einem Feld (2 x 2)
const TOKEN_OFFSETS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, -1.6]];

const TEMPLATE = `
<div class="party">
  <div class="ptop"><span class="pround"></span><span class="phint"></span></div>
  <div class="pscore"></div>
  <div class="pstage">
    <div class="pboard-wrap"><div class="pboard"></div></div>
    <div class="pmini" hidden></div>
  </div>
  <div class="overlay" hidden><div class="overlay-box"></div></div>
  <div class="toast" hidden></div>
</div>`;

export function mountParty(root, session) {
    root.innerHTML = TEMPLATE;
    const $ = sel => root.querySelector(sel);
    const el = {
        round: $('.pround'), hint: $('.phint'), score: $('.pscore'), boardWrap: $('.pboard-wrap'), board: $('.pboard'),
        mini: $('.pmini'), overlay: $('.overlay'), overlayBox: $('.overlay-box'), toast: $('.toast'),
    };

    const st = {
        view: null, avatars: [], displayPos: [], lastEvent: 0, receivedAt: 0, mini: null, dicePlaying: false, shownDice: null,
        movingSeat: null, laidOut: false, prevScore: [], gainAt: [],
    };
    let toastTimer = null;
    let dead = false;
    let chain = Promise.resolve();
    const enqueue = fn => {
        chain = chain.then(() => (dead ? null : fn())).catch(console.error);
    };

    // ---------- Spielbrett aufbauen ----------

    const cells = [];
    for (let i = 0; i < RING; i++) {
        const [row, col] = ringCell(i);
        const c = document.createElement('div');
        c.className = `pcell t-${SPACE_TYPES[i]}`;
        c.style.gridRow = row;
        c.style.gridColumn = col;
        c.innerHTML = `<span class="pl">${SPACE_LABEL[SPACE_TYPES[i]]}</span><span class="pst" hidden>★</span>`;
        el.board.appendChild(c);
        cells.push(c);
    }
    const center = document.createElement('div');
    center.className = 'pcenter';
    center.style.gridRow = `2 / ${GRID_ROWS}`;
    center.style.gridColumn = `2 / ${GRID_COLS}`;
    center.innerHTML = '<div class="pdice"><span class="pdie">?</span></div><div class="pstatus"></div><div class="pact"></div><div class="pfeed"></div>';
    el.board.appendChild(center);
    const tokEls = [];
    const ui = { dice: center.querySelector('.pdie'), status: center.querySelector('.pstatus'), act: center.querySelector('.pact'), feed: center.querySelector('.pfeed') };

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
        while (ui.feed.children.length > 4) ui.feed.firstChild.remove();
        setTimeout(() => line.remove(), 4200);
    }

    // Zahl und Ring auf einem Feld (nur bei sichtbarem Brett)
    function cellCenter(i) {
        const c = cells[i];
        if (!c || !el.board.offsetWidth) return null;
        return { x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop + c.offsetHeight / 2 };
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
                for (let i = 0; i < 7; i++) {
                    ui.dice.textContent = String(1 + Math.floor(Math.random() * 6));
                    await sleep(80);
                }
                setDice(e.value);
                await sleep(200);
                break;
            }
            case 'move': {
                st.movingSeat = e.seat;
                for (let k = 1; k <= e.steps; k++) {
                    st.displayPos[e.seat] = (e.from + k) % RING;
                    renderTokens();
                    await sleep(300);
                }
                st.movingSeat = null;
                renderTokens();
                break;
            }
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
        el.boardWrap.hidden = !!playing;
        el.mini.hidden = !playing;
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
                    <span class="pname">${esc(p.name)}</span><span class="pst2">★${p.stars}</span><span class="pco">¢${p.coins}</span></div>`;
            })
            .join('');
    }

    function renderTokens() {
        const v = st.view;
        if (!v) return;
        cells.forEach((c, i) => {
            c.querySelector('.pst').hidden = v.starPos !== i;
            c.classList.toggle('has-star', v.starPos === i);
        });
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
    const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layoutTokens(true)) : null;
    resizer?.observe(el.board);

    function renderBoard() {
        const v = st.view;
        renderTokens();
        if (v.phase === 'board') {
            const mine = v.turnSeat === v.seat;
            const cur = name(v.turnSeat);
            if (v.turnPhase === 'roll') {
                ui.status.textContent = mine ? 'Du bist dran!' : `${cur} ist dran`;
                ui.act.innerHTML = mine ? '<button class="btn primary big" type="button" data-act="roll">Würfeln</button>' : '<span class="muted">Warte auf den Wurf …</span>';
            } else {
                ui.status.textContent = `${cur} zieht …`;
                ui.act.innerHTML = '';
            }
        } else {
            ui.status.textContent = '';
            ui.act.innerHTML = '';
        }
        if (v.phase === 'board' && v.dice && st.shownDice === null) setDice(v.dice.value);
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
        const cycle = v.miniCycle ? `<span class="phint">Minispiel ${v.miniCycle.done} von ${v.miniCycle.total}</span>` : '';
        const heading = m.phase === 'intro' && cur.reeling ? 'Minispiel' : m.title;
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
                if (!REDUCED && m.msLeft >= 4500 && MINI_TITLES.includes(m.title)) runReel(cur, body, v, m);
                else body.innerHTML = introHTML(cur, v, m);
            } else if (m.phase === 'play') {
                body.innerHTML = '';
                const api = {
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
        if (m.phase === 'result') body.innerHTML = resultHTML(v);
    }

    function introHTML(cur, v, m) {
        const secs = Math.max(0.5, (cur.deadline - performance.now()) / 1000);
        const title = esc(m.title);
        return `<div class="mintro"><i class="scanbar"></i><h2 class="glitch" data-text="${title}">${title}</h2><p>${esc(m.rules)}</p>${teamIntroHTML(v)}${m.star ? '<p class="mstar">Wer gewinnt, bekommt einen Stern!</p>' : ''}<p class="muted">Gleich geht’s los …</p><div class="mprog"><i style="--ms:${secs.toFixed(2)}s"></i></div></div>`;
    }

    // Minispiel-Zufall: Slot-Walze mit allen Titeln. Das Ziel ist das Spiel, das der Host wirklich gewählt hat.
    // Die Walze bremst von 40 ms auf ca. 370 ms je Zeile ab (kubisch), rastet grün ein und wartet 1,3 s.
    function runReel(cur, body, v, m) {
        const len = MINI_TITLES.length;
        const target = MINI_TITLES.indexOf(m.title);
        const STEPS = 16;
        let idx = (((target - STEPS) % len) + len) % len;
        body.innerHTML = `<div class="reel"><div class="reel-label">Minispiel-Zufall</div><div class="reel-win">${['d2', 'd1', 'c', 'd1', 'd2'].map(c => `<div class="reel-row ${c}"></div>`).join('')}<div class="reel-bracket"></div></div><div class="reel-lock">ZIEL ERFASST</div></div>`;
        cur.reeling = true;
        const heading = el.mini.querySelector('.mhead strong');
        if (heading) heading.textContent = 'Minispiel';
        const reel = body.querySelector('.reel');
        const rows = [...body.querySelectorAll('.reel-row')];
        const paint = () => rows.forEach((row, k) => (row.textContent = MINI_TITLES[(idx + k - 2 + 2 * len) % len]));
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
                    if (head) head.textContent = m.title;
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

    function resultHTML(v) {
        const m = v.mini;
        if (!m.result) return '<div class="mintro"><p>Auswertung …</p></div>';
        const rows = m.result
            .map((r, i) => {
                const prize = r.stars ? `<b class="prize star">+★</b>` : `<b class="prize">+${r.coins} ¢</b>`;
                return `<tr style="--i:${i}" class="${r.rank === 1 && r.score > 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${r.rank}.</td><td>${esc(v.players[r.seat].name)}</td><td>${r.score}</td><td>${prize}</td></tr>`;
            })
            .join('');
        const teams = m.teams && m.teamScores ? `<p class="center">${[0, 1].map(t => `<b style="color:${t ? 'var(--cyan)' : 'var(--pink)'}">${esc(m.teams.names[t])}: Ø ${m.teamScores[t]}</b>`).join(' · ')}</p>` : '';
        return `${teams}<table class="ranking"><thead><tr><th></th><th></th><th>Punkte</th><th>Gewinn</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function updateTimers() {
        const v = st.view;
        if (!v) return;
        const elapsed = performance.now() - st.receivedAt;
        const t = el.mini.querySelector('.mtimer');
        if (t && v.mini) t.textContent = v.mini.phase === 'result' || (v.mini.kind === 'sub' && v.mini.phase === 'play') ? '' : `${Math.max(0, Math.ceil((v.mini.msLeft - elapsed) / 1000))} s`;
        if (v.phase === 'board' && v.turnPhase === 'roll') {
            const left = Math.max(0, Math.ceil((v.turnMsLeft - elapsed) / 1000));
            if (v.turnSeat === v.seat) ui.status.textContent = `Du bist dran! (${left} s)`;
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
                <p>Es können ${v.minPlayers} bis ${v.maxPlayers} Personen mitspielen. Würfelt über den Rundkurs, sammelt Münzen und Sterne und gewinnt die Minispiele! Ein Stern zählt am Ende 10 Münzen.</p>
                <p class="muted">Rundenzahl:</p><div class="row center">${rounds}</div>` +
                (isHost
                    ? `<p><button class="btn primary" type="button" data-act="start"${v.players.length >= v.minPlayers ? '' : ' disabled'}>Spiel starten</button></p>`
                    : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`);
        } else if (v.phase === 'over') {
            const rows = v.ranking
                .map((r, k) => `<tr style="--i:${k}" class="${k === 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${k + 1}.</td><td>${esc(v.players[r.seat].name)}</td><td>★${r.stars}</td><td>¢${r.coins}</td><td><b>${r.total}</b></td></tr>`)
                .join('');
            const title = v.ranking[0].seat === v.seat ? 'Du hast gewonnen!' : `${esc(v.players[v.ranking[0].seat].name)} hat gewonnen`;
            html = `<h2 class="glitch" data-text="${title}">${title}</h2><p>Ein Stern zählt 10 Münzen.</p>
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
            case 'roll': case 'start': case 'rematch':
                session.send({ t: t.dataset.act });
                break;
            case 'setRounds':
                session.send({ t: 'setRounds', n: Number(t.dataset.n) });
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
            root.innerHTML = '';
        },
    };
}
