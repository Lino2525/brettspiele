// Oberfläche für Mini Rummy: Tisch, Ständer, Drag & Drop (Maus und Touch).
// Bewegung: Steine gleiten an ihren neuen Platz (FLIP), neu gelegte Steine und veränderte Reihen bleiben bis zum
// nächsten Legen in der Farbe der Person markiert, die sie gelegt hat. Dazu Austeilen, Ziehen, Joker, letzter Stein, Sieg.
import { tileInfo, analyzeSet, evaluateMove, rackPoints } from './rules.js';

const TEMPLATE = `
<div class="rummy">
  <div class="opp-bar">
    <div class="players"></div>
    <div class="info"><span class="pool"></span></div>
  </div>
  <div class="table-wrap">
    <div class="banner" hidden></div>
    <div class="table"></div>
  </div>
  <div class="me-bar">
    <div class="turn"><img class="turn-avatar small" alt="" hidden><span class="turn-text"></span></div>
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
  <img class="turn-avatar big" alt="" hidden>
</div>`;

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = sets => sets.map(s => [...s]);
const sameSets = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Reihe unabhängig von der Reihenfolge erkennen (zum Vergleich mit dem Tisch vor dem Zug)
const setKey = set => [...set].sort((a, b) => a - b).join(',');
const seatColor = seat => `var(--p${seat})`;
// Ab so vielen Steinen auf dem Tisch werden die Steine dort kleiner
const DENSE_AT = 36;

// o.pc: Farbe der Person, die den Stein gelegt hat (Markierung), o.fresh/o.pending: zuletzt gelegt bzw. wird gerade gelegt,
// o.anim: einmalige Animation (land, deal, drawn, joker-in), o.k: Versatz für gestaffelte Animationen, o.jv: Wert des Jokers
function tileHTML(id, o = {}) {
    const t = tileInfo(id);
    const cls = ['tile', t.joker ? 'joker' : `c${t.color}`];
    if (o.fresh) cls.push('fresh');
    if (o.pending) cls.push('pending');
    if (o.last) cls.push('last-one');
    if (o.anim) cls.push(o.anim);
    const style = [o.pc ? `--pc:${o.pc}` : '', o.k !== undefined ? `--k:${o.k}` : ''].filter(Boolean).join(';');
    const inner = t.joker
        ? `<span class="n">JOKER</span>${o.jv ? `<i class="jv" title="Joker als ${o.jv}">${o.jv}</i>` : '<span class="n r">JOKER</span>'}`
        : `<span class="n">${t.num}</span><span class="n r">${t.num}</span>`;
    return `<div class="${cls.join(' ')}" data-id="${id}"${style ? ` style="${style}"` : ''}>${inner}</div>`;
}

// Für welche Zahl steht ein Joker? Bei einem Satz ist es die Zahl des Satzes; bei einer Reihe die Zahl an seiner
// Position, wenn die Steine aufsteigend liegen. Sonst bleibt der Joker ohne Angabe.
function jokerValues(set) {
    const a = analyzeSet(set);
    const infos = set.map(tileInfo);
    if (!a.valid || !infos.some(t => t.joker)) return [];
    const fixed = infos.filter(t => !t.joker);
    if (!fixed.length) return [];
    if (a.kind === 'group') return infos.map(t => (t.joker ? fixed[0].num : null));
    let start = null;
    for (let k = 0; k < infos.length; k++) {
        if (infos[k].joker) continue;
        const s = infos[k].num - k;
        if (start === null) start = s;
        else if (s !== start) return [];
    }
    if (start < 1 || start + set.length - 1 > 13) return [];
    return infos.map((t, k) => (t.joker ? start + k : null));
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
        players: $('.players'), pool: $('.pool'),
        banner: $('.banner'), table: $('.table'), turn: $('.turn-text'), hint: $('.hint'), rack: $('.rack'),
        avatarBig: $('.turn-avatar.big'), avatarSmall: $('.turn-avatar.small'),
        end: $('.end'), draw: $('.draw'), reset: $('.reset'),
        overlay: $('.overlay'), overlayBox: $('.overlay-box'), toast: $('.toast'),
    };

    const st = {
        view: null, moveNo: -1, tableD: [], rackD: [], avatars: [null, null],
        prevTable: null, prevRack: [],
        fresh: new Map(), touched: new Map(), // Stein bzw. Reihe -> Platz der Person, die zuletzt gelegt hat
        landing: new Set(), shine: new Set(), deal: false, drawn: new Set(), jokerIn: null, dropFrom: null, checkSet: null,
        flashRack: false, burstRound: 0,
    };
    let toastTimer = null;

    const myTurn = () => st.view && st.view.phase === 'playing' && st.view.turn === st.view.seat;
    const me = () => st.view.players[st.view.seat];

    // ---------- Zustand ----------

    // Vergleicht den neuen Stand mit dem alten: Was wurde gelegt, gezogen, ausgeteilt? Wer hat nur noch einen Stein?
    function noticeChanges(prev, v) {
        if (v.round !== prev.round) {
            st.fresh = new Map();
            st.touched = new Map();
            st.deal = v.phase === 'playing';
        } else if (v.lastEvent?.kind === 'move' && !sameSets(v.table, st.prevTable)) {
            const seat = v.lastEvent.seat;
            const old = new Set(st.prevTable.flat());
            const oldKeys = new Set(st.prevTable.map(setKey));
            st.fresh = new Map(v.table.flat().filter(id => !old.has(id)).map(id => [id, seat]));
            st.touched = new Map(v.table.filter(set => !oldKeys.has(setKey(set))).map(set => [setKey(set), seat]));
            st.landing = new Set(st.fresh.keys());
            st.shine = new Set(st.touched.keys());
        } else if (v.lastEvent?.kind === 'draw' && v.lastEvent.seat === v.seat) {
            const had = new Set(st.prevRack);
            st.drawn = new Set(v.rack.filter(id => !had.has(id)));
        }
        if (v.phase === 'playing') {
            v.players.forEach((p, i) => {
                if (p.rackCount === 1 && prev.players[i]?.rackCount > 1) note(i === v.seat ? 'Nur noch ein Stein!' : `${p.name} hat nur noch einen Stein!`);
            });
            if (v.turn === v.seat && (prev.turn !== v.seat || prev.phase !== 'playing')) st.flashRack = true;
        }
    }

    function applyView(v) {
        if (st.view && st.prevTable) noticeChanges(st.view, v);
        st.prevTable = clone(v.table);
        st.prevRack = [...v.rack];
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

    // FLIP: Positionen vor dem Neuzeichnen merken und die Steine danach von dort an ihren neuen Platz gleiten lassen
    const tileEls = () => root.querySelectorAll('.table .tile[data-id], .rack .tile[data-id]');
    function snapshot() {
        const m = new Map();
        tileEls().forEach(t => m.set(t.dataset.id, t.getBoundingClientRect()));
        if (st.dropFrom) m.set(String(st.dropFrom.id), st.dropFrom.rect);
        return m;
    }
    function glide(before) {
        tileEls().forEach(t => {
            const b = before.get(t.dataset.id);
            if (!b) return;
            const r = t.getBoundingClientRect();
            const dx = b.left - r.left;
            const dy = b.top - r.top;
            if (Math.abs(dx) + Math.abs(dy) < 2) return;
            t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
        });
    }

    function render() {
        const before = REDUCED ? null : snapshot();
        paint();
        if (before) glide(before);
        afterDraw();
    }

    // Einmalige Effekte nach dem Zeichnen; die Markierungen für die nächste Darstellung zurücksetzen
    function afterDraw() {
        if (st.checkSet !== null && !REDUCED) {
            const setEl = el.table.querySelector(`.set[data-index="${st.checkSet}"]`);
            if (setEl?.classList.contains('bad') && setEl.children.length >= 3) {
                setEl.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
            }
        }
        if (st.flashRack && !REDUCED) {
            el.rack.animate([{ boxShadow: '0 0 0 0 rgba(255, 207, 107, .75), inset 0 1px 0 rgba(255, 207, 107, .3)' }, { boxShadow: '0 0 0 14px rgba(255, 207, 107, 0), inset 0 1px 0 rgba(255, 207, 107, .3)' }], { duration: 900, easing: 'ease-out' });
        }
        st.checkSet = null;
        st.flashRack = false;
        st.landing = new Set();
        st.shine = new Set();
        st.deal = false;
        st.drawn = new Set();
        st.jokerIn = null;
        st.dropFrom = null;
    }

    function paint() {
        const v = st.view;
        const mine = myTurn();
        el.players.innerHTML = v.players
            .map((p, i) => {
                const onTurn = v.phase === 'playing' && v.turn === i;
                return `<div class="pchip${onTurn ? ' on-turn' : ''}" style="--pc:var(--p${i})"><span class="dot ${p.connected ? 'on' : 'off'}"></span>` +
                    `<strong>${esc(p.name)}</strong>${i === v.seat ? '<span class="me-tag">Du</span>' : ''}` +
                    (v.phase === 'playing' && p.rackCount === 1 ? '<span class="last">letzter Stein</span>' : v.phase !== 'waiting' ? `<span class="pc">${p.rackCount} Steine</span>` : '') +
                    (v.round > 0 ? `<span class="ps">${fmt(v.scores[i])}</span>` : '') + '</div>';
            })
            .join('');
        el.pool.textContent = v.phase === 'waiting' ? '' : `Runde ${v.round}, Vorrat: ${v.poolCount}`;

        // Wer gerade legt: Steine, die noch nicht fest auf dem Tisch liegen, gestrichelt in der Farbe der Person
        const live = !mine && v.phase === 'playing' && v.liveTable;
        const committed = new Set(v.table.flat());
        const committedKeys = new Set(v.table.map(setKey));
        let landK = 0;
        el.table.classList.toggle('dense', st.tableD.flat().length > DENSE_AT);
        el.table.innerHTML =
            st.tableD
                .map((set, i) => {
                    const key = setKey(set);
                    const valid = analyzeSet(set).valid;
                    const changed = !committedKeys.has(key);
                    // Eigener Zug: geänderte Reihen zeigen sofort, ob sie gültig sind (unter drei Steinen: noch unfertig)
                    const state = mine && changed ? (valid ? ' ok' : set.length < 3 ? ' open' : ' bad') : '';
                    const by = !changed ? st.touched.get(key) : undefined;
                    const jv = jokerValues(set);
                    const tiles = set
                        .map((id, k) => {
                            const fresh = st.fresh.get(id);
                            const pending = live && !committed.has(id);
                            const o = { jv: jv[k] };
                            if (pending) Object.assign(o, { pending: true, pc: seatColor(v.turn) });
                            else if (fresh !== undefined) Object.assign(o, { fresh: true, pc: seatColor(fresh) });
                            if (st.landing.has(id)) Object.assign(o, { anim: tileInfo(id).joker ? 'joker-in' : 'land', k: landK++ });
                            if (st.jokerIn === id) o.anim = 'joker-in';
                            return tileHTML(id, o);
                        })
                        .join('');
                    const cls = `set${state}${by !== undefined ? ' touched' : ''}${by !== undefined && st.shine.has(key) ? ' shine' : ''}`;
                    return `<div class="${cls}" data-index="${i}"${by !== undefined ? ` style="--pc:${seatColor(by)}"` : ''}>${tiles}</div>`;
                })
                .join('') +
            (mine ? '<div class="newset">Stein hierher ziehen für eine neue Reihe</div>' : '') +
            (!st.tableD.length && !mine ? '<div class="empty">Noch nichts auf dem Tisch</div>' : '');

        const lastOne = v.phase === 'playing' && st.rackD.length === 1;
        el.rack.innerHTML = st.rackD
            .map((id, k) => tileHTML(id, { anim: st.deal ? 'deal' : st.drawn.has(id) ? 'drawn' : null, k, last: lastOne }))
            .join('');
        el.rack.classList.toggle('active', mine);

        el.banner.hidden = !live;
        if (live) {
            el.banner.textContent = `${v.players[v.turn].name} legt gerade …`;
            el.banner.style.setProperty('--pc', seatColor(v.turn));
        }
        el.table.classList.toggle('live', !!live);

        renderTurnAndHint(mine);
        renderAvatar();
        renderOverlay();
    }

    // Zeigt das Bild der Person am Zug (am Rundenende das der Gewinnerin bzw. des Gewinners).
    function renderAvatar() {
        const v = st.view;
        const seat = !v ? null : v.phase === 'playing' ? v.turn : v.phase === 'over' ? v.winner : null;
        const src = seat === null ? null : st.avatars[seat];
        for (const img of [el.avatarBig, el.avatarSmall]) {
            const changed = (img.getAttribute('src') || null) !== src;
            if (changed) {
                if (src) img.src = src;
                else img.removeAttribute('src');
                // Animation neu starten, damit der Wechsel sichtbar ist
                img.style.animation = 'none';
                void img.offsetWidth;
                img.style.animation = '';
            }
            img.hidden = !src;
        }
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
            const list = v.players.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`).join('');
            const isHost = v.seat === v.hostSeat;
            const enough = v.players.length >= v.minPlayers;
            html = `<h2>Mitspieler</h2><ul class="plist">${list}</ul>
                <p>Es können ${v.minPlayers} bis ${v.maxPlayers} Personen mitspielen. Schick den Einladungslink oder den Raumcode.</p>` +
                (isHost
                    ? `<button class="btn primary" data-act="start" type="button"${enough ? '' : ' disabled'}>Spiel starten</button>`
                    : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`);
        } else if (v.phase === 'over') {
            const title = v.winner === null ? 'Unentschieden' : v.winner === v.seat ? 'Du hast gewonnen!' : `${esc(v.players[v.winner].name)} hat gewonnen`;
            if (v.winner !== null && st.burstRound !== v.round) {
                st.burstRound = v.round;
                burst(v.winner);
            }
            const rows = v.players
                .map((p, i) => ({ p, i, left: v.racks[i], points: rackPoints(v.racks[i]) }))
                .sort((x, y) => x.points - y.points)
                .map(({ p, i, left, points }) =>
                    `<tr class="${i === v.winner ? 'win' : ''}"><td>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</td><td>${left.length}</td><td>${points}</td><td>${fmt(v.scores[i])}</td></tr>`)
                .join('');
            html = `<h2${v.winner === null ? '' : ' class="glitch"'}>${title}</h2><p>${esc(v.overReason)}</p>
                <table class="ranking"><thead><tr><th></th><th>Steine übrig</th><th>Wert</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
                <button class="btn primary" data-act="newRound" type="button">Neue Runde</button>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.innerHTML !== html) el.overlayBox.innerHTML = html;
        if (v.phase !== 'over') el.overlay.querySelector('.rburst')?.remove();
    }

    // Sieg: Steine fliegen aus der Mitte, zuerst in der Farbe der Gewinnerin bzw. des Gewinners
    function burst(winner) {
        if (REDUCED) return;
        el.overlay.querySelector('.rburst')?.remove();
        const box = document.createElement('div');
        box.className = 'rburst';
        box.setAttribute('aria-hidden', 'true');
        box.innerHTML = Array.from({ length: 26 }, (_, k) => {
            const a = (k / 26) * Math.PI * 2 + Math.random() * 0.3;
            const d = 160 + Math.random() * 220;
            const c = k % 3 === 0 ? `var(--p${winner})` : `var(--c${k % 4})`;
            return `<i style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d * 0.7 - 60)}px;--r:${Math.round(Math.random() * 540 - 270)}deg;--d:${(k % 6) * 40}ms;--tc:${c}">${1 + ((k * 7) % 13)}</i>`;
        }).join('');
        el.overlay.prepend(box);
        setTimeout(() => box.remove(), 2600);
    }

    // Kurzer Hinweis oben über dem Tisch (z. B. "Ben hat nur noch einen Stein!")
    function note(text) {
        const n = document.createElement('div');
        n.className = 'rnote';
        n.textContent = text;
        root.querySelector('.rummy').appendChild(n);
        setTimeout(() => n.remove(), 3800);
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
        const act = e.target.dataset.act;
        if (act === 'newRound') session.send({ t: 'newRound' });
        if (act === 'start') session.send({ t: 'start' });
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
        const from = d.ghost?.getBoundingClientRect();
        cleanupDrag();
        if (d.active && target) drop(d, target, from);
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

    function drop(d, t, from) {
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

        // Der Stein gleitet von dort, wo er losgelassen wurde; ein Joker in einer Reihe bekommt seinen eigenen Effekt
        if (from) st.dropFrom = { id: d.id, rect: from };
        if (t.kind !== 'rack' && tileInfo(d.id).joker) st.jokerIn = d.id;
        const target = t.kind === 'set' ? st.tableD[t.setIndex] : t.kind === 'newset' ? st.tableD[st.tableD.length - 1] : null;
        st.tableD = st.tableD.filter(s => s.length);
        st.checkSet = target ? st.tableD.indexOf(target) : null;
        render();
        pushDraft();
    }

    // ---------- Anbindung ----------

    session.onView = v => {
        applyView(v);
        render();
    };
    session.onNotice = text => toast(text);
    session.onAvatars = list => {
        st.avatars = list;
        if (st.view) renderAvatar();
    };

    return {
        destroy() {
            cleanupDrag();
            root.innerHTML = '';
        },
    };
}
