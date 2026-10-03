// Oberfläche für Mini Rummy: Tisch, Ständer, Drag & Drop (Maus und Touch).
import { tileInfo, analyzeSet, evaluateMove, rackPoints } from './rules.js';

const TEMPLATE = `
<div class="rummy">
  <div class="opp-bar">
    <div class="opp"><span class="dot"></span><strong class="opp-name"></strong><span class="opp-count"></span></div>
    <div class="info"><span class="pool"></span><span class="score"></span></div>
  </div>
  <div class="table-wrap">
    <div class="banner" hidden></div>
    <div class="table"></div>
  </div>
  <div class="me-bar">
    <div class="turn"></div>
    <div class="hint"></div>
  </div>
  <div class="rack"></div>
  <div class="actions">
    <button class="btn sort-color" type="button">Nach Farbe</button>
    <button class="btn sort-num" type="button">Nach Zahl</button>
    <span class="spacer"></span>
    <button class="btn reset" type="button">Zurücksetzen</button>
    <button class="btn draw" type="button">Stein ziehen</button>
    <button class="btn primary end" type="button">Zug beenden</button>
  </div>
  <div class="overlay" hidden><div class="overlay-box"></div></div>
  <div class="toast" hidden></div>
</div>`;

const clone = sets => sets.map(s => [...s]);
const sameSets = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function tileHTML(id) {
    const t = tileInfo(id);
    if (t.joker) {
        return `<div class="tile joker" data-id="${id}"><span class="n">JOKER</span><span class="n r">JOKER</span></div>`;
    }
    return `<div class="tile c${t.color}" data-id="${id}"><span class="n">${t.num}</span><span class="n r">${t.num}</span></div>`;
}

const sortKey = {
    color: id => {
        const t = tileInfo(id);
        return t.joker ? 999 : t.color * 20 + t.num;
    },
    num: id => {
        const t = tileInfo(id);
        return t.joker ? 999 : t.num * 10 + t.color;
    },
};

export function mountRummy(root, session) {
    root.innerHTML = TEMPLATE;
    const $ = sel => root.querySelector(sel);
    const el = {
        dot: $('.dot'), oppName: $('.opp-name'), oppCount: $('.opp-count'), pool: $('.pool'), score: $('.score'),
        banner: $('.banner'), table: $('.table'), turn: $('.turn'), hint: $('.hint'), rack: $('.rack'),
        end: $('.end'), draw: $('.draw'), reset: $('.reset'),
        overlay: $('.overlay'), overlayBox: $('.overlay-box'), toast: $('.toast'),
    };

    const st = { view: null, moveNo: -1, tableD: [], rackD: [] };
    let toastTimer = null;

    const myTurn = () => st.view && st.view.phase === 'playing' && st.view.turn === st.view.seat;
    const me = () => st.view.players[st.view.seat];

    // ---------- Zustand ----------

    function applyView(v) {
        st.view = v;
        const keepDraft = v.phase === 'playing' && v.turn === v.seat && v.moveNo === st.moveNo;
        if (!keepDraft) st.tableD = clone(v.turn !== v.seat && v.liveTable ? v.liveTable : v.table);
        st.moveNo = v.moveNo;
        reconcileRack();
    }

    // Eigene Sortierung behalten, neue Steine hinten anhängen, gelegte Steine herausnehmen.
    function reconcileRack() {
        const placed = new Set(st.tableD.flat());
        const mine = st.view.rack;
        const keep = st.rackD.filter(id => mine.includes(id) && !placed.has(id));
        const have = new Set(keep);
        for (const id of mine) if (!have.has(id) && !placed.has(id)) keep.push(id);
        st.rackD = keep;
    }

    function resetDraft() {
        st.tableD = clone(st.view.table);
        reconcileRack();
        session.send({ t: 'draft', table: null });
    }

    function pushDraft() {
        if (myTurn()) session.send({ t: 'draft', table: st.tableD });
    }

    function checkDraft() {
        const v = st.view;
        return evaluateMove({
            oldTable: v.table,
            oldRack: v.rack,
            table: st.tableD,
            rack: st.rackD,
            melded: me().melded,
        });
    }

    // ---------- Anzeige ----------

    function render() {
        const v = st.view;
        const mine = myTurn();
        const opp = v.players[1 - v.seat];

        el.oppName.textContent = opp ? opp.name : 'Warte auf Mitspieler…';
        el.oppCount.textContent = opp && v.phase !== 'waiting' ? `${opp.rackCount} Steine` : '';
        el.dot.className = 'dot ' + (opp && opp.connected ? 'on' : 'off');
        el.pool.textContent = v.phase === 'waiting' ? '' : `Vorrat: ${v.poolCount}`;
        el.score.textContent = v.round > 0 ? `Runde ${v.round} · ${v.players[v.seat].name} ${fmt(v.scores[v.seat])} : ${fmt(v.scores[1 - v.seat])} ${opp ? opp.name : ''}` : '';

        el.table.innerHTML =
            st.tableD
                .map((set, i) => {
                    const bad = mine && !analyzeSet(set).valid;
                    return `<div class="set${bad ? ' bad' : ''}" data-index="${i}">${set.map(tileHTML).join('')}</div>`;
                })
                .join('') +
            (mine ? '<div class="newset">Stein hierher ziehen für eine neue Reihe</div>' : '') +
            (!st.tableD.length && !mine ? '<div class="empty">Noch nichts auf dem Tisch</div>' : '');

        el.rack.innerHTML = st.rackD.map(tileHTML).join('');

        const showLive = !mine && v.phase === 'playing' && v.liveTable;
        el.banner.hidden = !showLive;
        if (showLive) el.banner.textContent = `${opp.name} legt gerade…`;
        el.table.classList.toggle('live', !!showLive);

        renderTurnAndHint(mine);
        renderOverlay();
    }

    function renderTurnAndHint(mine) {
        const v = st.view;
        el.hint.className = 'hint';
        if (v.phase !== 'playing') {
            el.turn.textContent = '';
            el.hint.textContent = '';
        } else if (!mine) {
            el.turn.textContent = `${v.players[v.turn].name} ist am Zug`;
            el.hint.textContent = lastEventText() || '';
        } else {
            el.turn.textContent = 'Du bist am Zug';
            const changed = !sameSets(st.tableD, v.table);
            if (!changed) {
                el.hint.textContent = me().melded
                    ? 'Lege Steine oder ziehe einen.'
                    : `Zum ersten Auslegen brauchst du mindestens ${v.meldMin} Punkte.`;
            } else {
                const r = checkDraft();
                if (r.ok) {
                    el.hint.textContent = me().melded ? 'Passt. Zug beenden?' : `Passt (${r.points} Punkte). Zug beenden?`;
                    el.hint.classList.add('ok');
                } else {
                    el.hint.textContent = r.error;
                    el.hint.classList.add('warn');
                }
            }
        }
        const changed = mine && !sameSets(st.tableD, st.view.table);
        el.end.disabled = !(mine && changed && checkDraft().ok);
        el.reset.disabled = !(mine && changed);
        el.draw.disabled = !mine;
        el.draw.textContent = v.poolCount > 0 ? 'Stein ziehen' : 'Aussetzen';
    }

    function lastEventText() {
        const e = st.view.lastEvent;
        if (!e) return '';
        const name = e.seat === st.view.seat ? 'Du' : st.view.players[e.seat].name;
        if (e.kind === 'draw') return `${name} ${e.seat === st.view.seat ? 'hast' : 'hat'} einen Stein gezogen.`;
        if (e.kind === 'pass') return `${name} ${e.seat === st.view.seat ? 'hast' : 'hat'} ausgesetzt.`;
        return `${name} ${e.seat === st.view.seat ? 'hast' : 'hat'} ${e.count} ${e.count === 1 ? 'Stein' : 'Steine'} gelegt.`;
    }

    function renderOverlay() {
        const v = st.view;
        let html = '';
        if (v.phase === 'waiting') {
            html = `<h2>Warte auf Mitspieler</h2><p>Schick den Einladungslink oder den Raumcode. Sobald beide da sind, geht es los.</p>`;
        } else if (v.phase === 'over') {
            const other = v.players[1 - v.seat];
            const title = v.winner === null ? 'Unentschieden' : v.winner === v.seat ? 'Du hast gewonnen!' : `${other.name} hat gewonnen`;
            const left = v.otherRack ? `<p>Übrig bei ${other.name}: ${v.otherRack.length} Steine, ${rackPoints(v.otherRack)} Punkte.</p>` : '';
            const mineLeft = v.rack.length ? `<p>Übrig bei dir: ${v.rack.length} Steine, ${rackPoints(v.rack)} Punkte.</p>` : '';
            html = `<h2>${title}</h2><p>${v.overReason}</p>${mineLeft}${left}
                <p>Gesamtstand: ${v.players[v.seat].name} ${fmt(v.scores[v.seat])} : ${fmt(v.scores[1 - v.seat])} ${other.name}</p>
                <button class="btn primary" data-act="newRound" type="button">Neue Runde</button>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.innerHTML !== html) el.overlayBox.innerHTML = html;
    }

    const fmt = n => (n > 0 ? `+${n}` : String(n));

    function toast(text) {
        el.toast.textContent = text;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
    }

    // ---------- Buttons ----------

    el.end.addEventListener('click', () => {
        if (myTurn()) session.send({ t: 'move', table: st.tableD, rack: st.rackD });
    });
    el.reset.addEventListener('click', () => {
        resetDraft();
        render();
    });
    el.draw.addEventListener('click', () => {
        if (!myTurn()) return;
        resetDraft();
        session.send({ t: 'draw' });
    });
    root.querySelector('.sort-color').addEventListener('click', () => sortRack('color'));
    root.querySelector('.sort-num').addEventListener('click', () => sortRack('num'));
    el.overlayBox.addEventListener('click', e => {
        if (e.target.dataset.act === 'newRound') session.send({ t: 'newRound' });
    });

    function sortRack(mode) {
        st.rackD.sort((a, b) => sortKey[mode](a) - sortKey[mode](b));
        render();
    }

    // ---------- Drag & Drop ----------

    let drag = null;

    root.addEventListener('pointerdown', e => {
        const tileEl = e.target.closest('.tile[data-id]');
        if (!tileEl || e.button !== 0 || !st.view) return;
        const id = Number(tileEl.dataset.id);
        const fromRack = !!tileEl.closest('.rack');
        if (!fromRack) {
            if (!myTurn()) return;
            if (!me().melded && !st.view.rack.includes(id)) {
                toast('Vor dem ersten Auslegen darfst du den Tisch nicht umbauen.');
                return;
            }
        }
        drag = { id, fromRack, tileEl, x: e.clientX, y: e.clientY, active: false, ghost: null };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });

    function onMove(e) {
        if (!drag) return;
        if (!drag.active) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
            drag.active = true;
            drag.ghost = drag.tileEl.cloneNode(true);
            drag.ghost.classList.add('ghost');
            document.body.appendChild(drag.ghost);
            drag.tileEl.classList.add('dragging');
        }
        const w = drag.ghost.offsetWidth;
        const h = drag.ghost.offsetHeight;
        drag.ghost.style.transform = `translate(${e.clientX - w / 2}px, ${e.clientY - h / 2}px)`;
        highlight(findTarget(e.clientX, e.clientY));
    }

    function onUp(e) {
        if (!drag) return;
        const d = drag;
        const target = d.active ? findTarget(e.clientX, e.clientY) : null;
        cleanupDrag();
        if (d.active && target) drop(d, target);
    }

    function onCancel() {
        cleanupDrag();
    }

    function cleanupDrag() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (drag) {
            drag.ghost?.remove();
            drag.tileEl.classList.remove('dragging');
        }
        highlight(null);
        drag = null;
    }

    function insertIndex(container, x, y) {
        const tiles = [...container.querySelectorAll('.tile:not(.dragging)')];
        for (let i = 0; i < tiles.length; i++) {
            const r = tiles[i].getBoundingClientRect();
            if (y < r.top || (y < r.bottom && x < r.left + r.width / 2)) return i;
        }
        return tiles.length;
    }

    function findTarget(x, y) {
        const under = document.elementFromPoint(x, y);
        if (!under || !root.contains(under)) return null;
        const setEl = under.closest('.set');
        if (setEl) return { kind: 'set', setIndex: Number(setEl.dataset.index), index: insertIndex(setEl, x, y), el: setEl };
        if (under.closest('.table')) return { kind: 'newset', el: el.table };
        if (under.closest('.rack')) return { kind: 'rack', index: insertIndex(el.rack, x, y), el: el.rack };
        return null;
    }

    let lit = null;
    function highlight(target) {
        const next = target ? target.el : null;
        if (lit === next) return;
        lit?.classList.remove('drop');
        next?.classList.add('drop');
        lit = next;
    }

    function drop(d, t) {
        if (t.kind === 'rack') {
            if (!d.fromRack && !st.view.rack.includes(d.id)) {
                toast('Steine, die schon auf dem Tisch lagen, dürfen nicht zurück in den Ständer.');
                return;
            }
        } else if (!myTurn()) {
            toast('Du bist nicht am Zug.');
            return;
        }

        // Quelle entfernen (leere Reihen erst nach dem Einfügen aufräumen, damit die Indizes stimmen)
        const ri = st.rackD.indexOf(d.id);
        if (ri >= 0) st.rackD.splice(ri, 1);
        for (const set of st.tableD) {
            const i = set.indexOf(d.id);
            if (i >= 0) set.splice(i, 1);
        }

        if (t.kind === 'rack') st.rackD.splice(Math.min(t.index, st.rackD.length), 0, d.id);
        else if (t.kind === 'set') st.tableD[t.setIndex].splice(t.index, 0, d.id);
        else st.tableD.push([d.id]);

        st.tableD = st.tableD.filter(s => s.length);
        render();
        pushDraft();
    }

    // ---------- Anbindung ----------

    session.onView = v => {
        applyView(v);
        render();
    };
    session.onNotice = text => toast(text);

    return {
        destroy() {
            cleanupDrag();
            root.innerHTML = '';
        },
    };
}
