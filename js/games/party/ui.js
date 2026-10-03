// Oberfläche von Sternenjagd: Spielbrett mit Würfeln und Figuren, Punktetafel und Minispiele.
// Bewusst schlicht gehalten. Alle sehen Würfel, Bewegung und Ereignisse live, die Animationen laufen lokal ab.
import { RING, SPACE_TYPES, ringCell, GRID_ROWS, GRID_COLS, COIN_GAIN, COIN_LOSS } from './board.js';
import { createMiniGame } from './mini-ui.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export const PLAYER_COLORS = ['#e53935', '#1e88e5', '#2e9e4f', '#f9a825', '#8e44ad', '#ef6c00'];
const SPACE_LABEL = { start: '🏁', blue: `+${COIN_GAIN}`, red: `−${COIN_LOSS}`, green: '?' };

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
        c.innerHTML = `<span class="pl">${SPACE_LABEL[SPACE_TYPES[i]]}</span><span class="pst" hidden>⭐</span><span class="ptoks"></span>`;
        el.board.appendChild(c);
        cells.push(c);
    }
    const center = document.createElement('div');
    center.className = 'pcenter';
    center.style.gridRow = `2 / ${GRID_ROWS}`;
    center.style.gridColumn = `2 / ${GRID_COLS}`;
    center.innerHTML = '<div class="pdice"><span class="pdie">🎲</span></div><div class="pstatus"></div><div class="pact"></div><div class="pfeed"></div>';
    el.board.appendChild(center);
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
        ui.dice.textContent = value ? FACES[value - 1] : '🎲';
        ui.dice.classList.remove('rolling');
    }

    function feed(text) {
        const line = document.createElement('div');
        line.textContent = text;
        ui.feed.appendChild(line);
        while (ui.feed.children.length > 4) ui.feed.firstChild.remove();
        setTimeout(() => line.remove(), 4200);
    }

    async function playEvent(e) {
        switch (e.type) {
            case 'dice': {
                ui.dice.classList.add('rolling');
                for (let i = 0; i < 7; i++) {
                    ui.dice.textContent = FACES[Math.floor(Math.random() * 6)];
                    await sleep(80);
                }
                setDice(e.value);
                await sleep(200);
                break;
            }
            case 'move': {
                for (let k = 1; k <= e.steps; k++) {
                    st.displayPos[e.seat] = (e.from + k) % RING;
                    renderTokens();
                    await sleep(300);
                }
                break;
            }
            case 'star':
                feed(`⭐ ${name(e.seat)} kauft den Stern!`);
                await sleep(500);
                break;
            case 'coins':
                feed(`${name(e.seat)}: ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} 🪙`);
                break;
            case 'info':
                feed(e.text);
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
            el.hint.textContent = star ? '⭐ Sternrunde: Im Minispiel gewinnt man einen Stern' : `Ein Stern kostet ${v.starPrice} Münzen und zählt am Ende 10`;
        }
    }

    function renderScore() {
        const v = st.view;
        el.score.innerHTML = v.players
            .map((p, i) => {
                const turn = v.phase === 'board' && v.turnSeat === i;
                const avatar = st.avatars[i];
                return `<div class="pchip${turn ? ' on-turn' : ''}${i === v.seat ? ' me' : ''}${p.connected ? '' : ' off'}">
                    <span class="ptk" style="background:${PLAYER_COLORS[i]}${avatar ? `;background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</span>
                    <span class="pname">${esc(p.name)}</span><span class="pst2">⭐${p.stars}</span><span class="pco">🪙${p.coins}</span></div>`;
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
        const html = cells.map(() => '');
        v.players.forEach((p, seat) => {
            const pos = st.displayPos[seat] ?? p.pos;
            const avatar = st.avatars[seat];
            html[pos] += `<i class="pt" title="${esc(p.name)}" style="background:${PLAYER_COLORS[seat]}${avatar ? `;background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</i>`;
        });
        cells.forEach((c, i) => {
            const t = c.querySelector('.ptoks');
            if (t.dataset.html !== html[i]) {
                t.dataset.html = html[i];
                t.innerHTML = html[i];
            }
        });
    }

    function renderBoard() {
        const v = st.view;
        renderTokens();
        if (v.phase === 'board') {
            const mine = v.turnSeat === v.seat;
            const cur = name(v.turnSeat);
            if (v.turnPhase === 'roll') {
                ui.status.textContent = mine ? 'Du bist dran!' : `${cur} ist dran`;
                ui.act.innerHTML = mine ? '<button class="btn primary big" type="button" data-act="roll">🎲 Würfeln</button>' : '<span class="muted">Warte auf den Wurf …</span>';
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
            st.mini = { id: m.id, phase: null, instance: null, deadline: 0 };
        }
        const cur = st.mini;
        const head = el.mini.querySelector('.mhead');
        const body = el.mini.querySelector('.mbody');
        head.innerHTML = `<strong>${esc(m.title)}</strong>${m.star ? '<span class="mstar">⭐ Sternrunde</span>' : ''}<span class="mtimer"></span>`;
        if (m.phase !== cur.phase) {
            cur.instance?.destroy();
            cur.instance = null;
            cur.phase = m.phase;
            cur.deadline = performance.now() + m.msLeft;
            if (m.phase === 'intro') {
                body.innerHTML = `<div class="mintro"><h2>${esc(m.title)}</h2><p>${esc(m.rules)}</p>${m.star ? '<p class="mstar">Wer gewinnt, bekommt einen Stern!</p>' : ''}<p class="muted">Gleich geht’s los …</p></div>`;
            } else if (m.phase === 'play') {
                body.innerHTML = '';
                const api = {
                    seat: v.seat,
                    remaining: () => cur.deadline - performance.now(),
                    submit: score => session.send({ t: 'mini', kind: 'score', score }),
                    send: payload => session.send({ t: 'mini', ...payload }),
                };
                cur.instance = createMiniGame(m.type, body, m, api);
            }
        }
        if (m.phase === 'play') cur.instance?.update(m);
        if (m.phase === 'result') body.innerHTML = resultHTML(v);
    }

    function resultHTML(v) {
        const m = v.mini;
        if (!m.result) return '<div class="mintro"><p>Auswertung …</p></div>';
        const rows = m.result
            .map(r => {
                const prize = r.stars ? `<b class="prize star">+⭐</b>` : `<b class="prize">+${r.coins} 🪙</b>`;
                return `<tr class="${r.rank === 1 && r.score > 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${r.rank}.</td><td>${esc(v.players[r.seat].name)}</td><td>${r.score}</td><td>${prize}</td></tr>`;
            })
            .join('');
        return `<table class="ranking"><thead><tr><th></th><th></th><th>Punkte</th><th>Gewinn</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function updateTimers() {
        const v = st.view;
        if (!v) return;
        const elapsed = performance.now() - st.receivedAt;
        const t = el.mini.querySelector('.mtimer');
        if (t && v.mini) t.textContent = v.mini.phase === 'result' ? '' : `${Math.max(0, Math.ceil((v.mini.msLeft - elapsed) / 1000))} s`;
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
            const list = v.players.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span><span class="ptk sm" style="background:${PLAYER_COLORS[i]}"></span>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`).join('');
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
                .map((r, k) => `<tr class="${k === 0 ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${k + 1}.</td><td>${esc(v.players[r.seat].name)}</td><td>⭐${r.stars}</td><td>🪙${r.coins}</td><td><b>${r.total}</b></td></tr>`)
                .join('');
            const title = v.ranking[0].seat === v.seat ? 'Du hast gewonnen!' : `${esc(v.players[v.ranking[0].seat].name)} hat gewonnen`;
            html = `<h2>${title}</h2><p>Ein Stern zählt 10 Münzen.</p>
                <table class="ranking"><thead><tr><th></th><th></th><th>Sterne</th><th>Münzen</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
                <button class="btn primary" type="button" data-act="rematch">Noch einmal spielen</button>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.innerHTML !== html) el.overlayBox.innerHTML = html;
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
            root.innerHTML = '';
        },
    };
}
