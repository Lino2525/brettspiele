// Gemeinsame Oberfläche der Spiele für 3 bis 6 Personen: Kopfzeile, Punktetafel, Warteraum mit Teams,
// Ergebnisfenster, Zeitanzeige und Eingaben. Ein Spiel liefert nur noch den Inhalt der Spielfläche.
export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Neon-Grid: gelb, cyan, pink, violett; ab dem 5. Platz orange und grün. Teams: pink gegen cyan.
export const PLAYER_COLORS = ['#fcee0a', '#05d9e8', '#ff2a6d', '#b967ff', '#ff9a00', '#39ff14'];
export const TEAM_COLORS = ['#ff2a6d', '#05d9e8'];
export const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// Setzt HTML nur bei Änderung und rettet dabei Eingabefelder (data-keep="…"): Wert, Fokus und Cursor bleiben erhalten.
export function setHTML(el, html) {
    if (el.dataset.html === html) return false;
    const saved = new Map();
    let focusKey = null;
    let sel = null;
    for (const input of el.querySelectorAll('[data-keep]')) {
        const key = input.dataset.keep;
        saved.set(key, input.type === 'checkbox' ? input.checked : input.value);
        if (input === document.activeElement) {
            focusKey = key;
            try { sel = [input.selectionStart, input.selectionEnd]; } catch { sel = null; }
        }
    }
    el.dataset.html = html;
    el.innerHTML = html;
    for (const input of el.querySelectorAll('[data-keep]')) {
        const key = input.dataset.keep;
        if (saved.has(key)) {
            if (input.type === 'checkbox') input.checked = saved.get(key);
            else if (input.value !== saved.get(key)) input.value = saved.get(key);
        }
        if (key === focusKey && !input.disabled) {
            input.focus();
            if (sel) try { input.setSelectionRange(sel[0], sel[1]); } catch { /* Feldtyp ohne Cursor */ }
        }
    }
    return true;
}

const TEMPLATE = `
<div class="cg">
  <div class="cg-top"><span class="cg-title"></span><span class="cg-info"></span><span class="cg-timer"></span></div>
  <div class="cg-score"></div>
  <div class="cg-stage"></div>
  <div class="cg-overlay" hidden><div class="cg-box"></div></div>
  <div class="toast" hidden></div>
</div>`;

function dataToAction(target) {
    const action = { t: target.dataset.act };
    for (const [k, v] of Object.entries(target.dataset)) {
        if (k === 'act' || k === 'keep') continue;
        action[k] = /^-?\d+$/.test(v) ? Number(v) : v;
    }
    return action;
}

// game: {
//   name, intro(v) -> HTML, options(v, isHost) -> HTML (optional Einstellungen im Warteraum),
//   top(v) -> Text neben dem Titel, scores(v) -> Zahl je Platz (oder null), chip(v, seat) -> { cls, note } (optional),
//   stage(v, ctx) -> HTML der Spielfläche, over(v, ctx) -> HTML des Ergebnisses,
//   input(target, ctx), click(act, target, ctx) -> true wenn selbst behandelt, update(v, ctx) nach jeder Ansicht,
// }
// opts.embedded: nur die Spielfläche (für Minispiele in Sternenjagd), ohne Punktetafel, Warteraum und Ergebnisfenster.
export function mountGame(root, session, game, opts = {}) {
    const embedded = !!opts.embedded;
    root.innerHTML = TEMPLATE;
    const cg = root.querySelector('.cg');
    if (embedded) cg.classList.add('embedded');
    const $ = sel => root.querySelector(sel);
    const el = { top: $('.cg-info'), title: $('.cg-title'), timer: $('.cg-timer'), score: $('.cg-score'), stage: $('.cg-stage'), overlay: $('.cg-overlay'), box: $('.cg-box'), toast: $('.toast') };
    const st = { view: null, avatars: [], receivedAt: 0, deadline: 0 };
    let toastTimer = null;
    el.title.textContent = game.name;

    const ctx = {
        root: cg,
        get v() { return st.view; },
        avatars: () => st.avatars,
        send: action => session.send(action),
        toast,
        rerender: () => st.view && render(),
        // Restzeit in ms bis zum Ende des aktuellen Abschnitts (aus der Ansicht, mit lokaler Uhr weitergezählt)
        left: () => Math.max(0, st.deadline - performance.now()),
        name: seat => st.view?.players[seat]?.name ?? '?',
        color: seat => (st.view?.teamMode ? TEAM_COLORS[st.view.players[seat]?.team] : PLAYER_COLORS[seat]),
        avatar: (seat, size = 26) => avatarHTML(seat, size),
    };

    function avatarHTML(seat, size) {
        const p = st.view?.players[seat];
        if (!p) return '';
        const img = st.avatars[seat];
        const color = st.view.teamMode ? TEAM_COLORS[p.team] : PLAYER_COLORS[seat];
        return `<i class="cg-av" style="width:${size}px;height:${size}px;background:${color}${img ? `;background-image:url('${img}')` : ''}">${img ? '' : esc(p.name.slice(0, 1).toUpperCase())}</i>`;
    }

    function toast(text) {
        el.toast.textContent = text;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
    }

    function renderScore() {
        const v = st.view;
        const scores = game.scores?.(v);
        let html = '';
        v.players.forEach((p, seat) => {
            const info = game.chip?.(v, seat) || {};
            const cls = ['cg-chip', seat === v.seat ? 'me' : '', p.connected ? '' : 'off', info.cls || '', v.teamMode ? `team${p.team}` : ''].filter(Boolean).join(' ');
            html += `<div class="${cls}" style="--pc:${ctx.color(seat)}">${avatarHTML(seat, 26)}<span class="cg-name">${esc(p.name)}</span>${info.note ? `<span class="cg-note">${info.note}</span>` : ''}${scores ? `<b class="cg-pts">${scores[seat]}</b>` : ''}</div>`;
        });
        if (v.teamMode && scores) {
            const sums = [0, 1].map(t => v.players.reduce((n, p, i) => n + (p.team === t ? scores[i] : 0), 0));
            html = `<div class="cg-teams">${sums.map((n, t) => `<span class="cg-team t${t}">${esc(v.teamNames[t])}: <b>${n}</b></span>`).join('')}</div>` + html;
        }
        setHTML(el.score, html);
    }

    function waitingHTML(v) {
        const isHost = v.seat === v.hostSeat;
        const me = v.players[v.seat];
        const row = (p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${avatarHTML(i, 22)}${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`;
        let list;
        let teamUi = '';
        if (v.canTeam && v.teamMode) {
            const col = t => `<div class="cg-teamcol t${t}"><h3>${esc(v.teamNames[t])}</h3><ul class="plist">${v.players.map((p, i) => (p.team === t ? row(p, i) : '')).join('')}</ul></div>`;
            list = `<div class="cg-teamcols">${col(0)}${col(1)}</div>`;
            teamUi = `<div class="row center"><button class="btn small" type="button" data-act="team" data-team="${me.team === 0 ? 1 : 0}">Ins ${esc(v.teamNames[me.team === 0 ? 1 : 0])} wechseln</button>${isHost ? '<button class="btn small" type="button" data-act="shuffleTeams">Teams neu mischen</button>' : ''}</div>`;
        } else {
            list = `<ul class="plist">${v.players.map(row).join('')}</ul>`;
        }
        if (v.canTeam) {
            if (v.players.length < v.minTeamPlayers) teamUi += `<p class="muted">Ab ${v.minTeamPlayers} Personen kann man in Teams spielen.</p>`;
            else if (isHost) teamUi = `<div class="row center"><button class="btn${v.teamMode ? ' primary' : ''}" type="button" data-act="teamMode" data-on="${v.teamMode ? 0 : 1}">Teams: ${v.teamMode ? 'an' : 'aus'}</button></div>` + teamUi;
            else if (v.teamMode) teamUi = '<p class="muted">Es wird in Teams gespielt: Das Team gewinnt oder verliert gemeinsam.</p>' + teamUi;
        }
        const ready = v.players.length >= v.minPlayers;
        const start = isHost
            ? `<p><button class="btn primary" type="button" data-act="start"${ready ? '' : ' disabled'}>Spiel starten</button>${ready ? '' : `<br><span class="muted">Es braucht mindestens ${v.minPlayers} Personen.</span>`}</p>`
            : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`;
        return `<h2>${esc(game.name)}</h2>${list}<p>${game.intro(v)}</p><p class="muted">${v.minPlayers} bis ${v.maxPlayers} Personen.</p>${game.options?.(v, isHost) || ''}${teamUi}${start}`;
    }

    function render() {
        const v = st.view;
        if (embedded) {
            const mine = v.players[v.seat];
            const team = v.teamMode && mine ? `Du bist im ${v.teamNames[mine.team]} · ` : '';
            el.top.textContent = team + (game.top?.(v) || '');
            el.stage.hidden = false;
            setHTML(el.stage, game.stage(v, ctx) || '');
            game.update?.(v, ctx, el.stage);
            updateTimer();
            return;
        }
        el.top.textContent = game.top?.(v) || '';
        renderScore();
        if (v.phase === 'waiting') {
            el.stage.hidden = true;
            el.overlay.hidden = false;
            setHTML(el.box, waitingHTML(v));
        } else if (v.phase === 'over') {
            el.stage.hidden = false;
            setHTML(el.stage, game.stage?.(v, ctx) || '');
            el.overlay.hidden = false;
            setHTML(el.box, `${game.over(v, ctx)}<p><button class="btn primary" type="button" data-act="rematch">Noch einmal spielen</button></p>`);
        } else {
            el.overlay.hidden = true;
            el.stage.hidden = false;
            setHTML(el.stage, game.stage(v, ctx));
        }
        game.update?.(v, ctx, el.stage);
        updateTimer();
    }

    function updateTimer() {
        const v = st.view;
        if (!v) return;
        const ms = v.msLeft;
        el.timer.textContent = ms == null ? '' : `${Math.ceil(Math.max(0, st.deadline - performance.now()) / 1000)} s`;
    }
    const timer = setInterval(() => {
        updateTimer();
        game.tick?.(st.view, ctx);
    }, 250);

    cg.addEventListener('click', e => {
        const t = e.target.closest('[data-act]');
        if (!t || !st.view || t.disabled) return;
        if (game.click?.(t.dataset.act, t, ctx)) return;
        session.send(dataToAction(t));
    });
    cg.addEventListener('submit', e => {
        const form = e.target.closest('form[data-form]');
        if (!form) return;
        e.preventDefault();
        const action = { t: form.dataset.form };
        let empty = true;
        for (const input of form.querySelectorAll('[name]')) {
            action[input.name] = input.value;
            if (input.value.trim()) empty = false;
        }
        if (empty && !form.hasAttribute('data-allow-empty')) return;
        session.send(action);
        if (!form.hasAttribute('data-keepvalue')) for (const input of form.querySelectorAll('[name]')) input.value = '';
    });
    cg.addEventListener('input', e => game.input?.(e.target, ctx));
    cg.addEventListener('focusout', e => game.blur?.(e.target, ctx));

    session.onView = v => {
        st.view = v;
        st.receivedAt = performance.now();
        st.deadline = st.receivedAt + (v.msLeft ?? 0);
        render();
    };
    session.onNotice = text => toast(text);
    session.onAvatars = list => {
        st.avatars = list;
        if (st.view) render();
    };

    return {
        destroy() {
            clearInterval(timer);
            game.destroy?.();
            root.innerHTML = '';
        },
    };
}

// Ergebnisfenster für Punktespiele: Sieger, bei Teams zusätzlich die Teamwertung.
export function scoreOverHTML(v, totals, unit = 'Punkte') {
    const sorted = v.players.map((p, seat) => ({ p, seat, total: totals[seat] })).sort((a, b) => b.total - a.total);
    let teamBlock = '';
    let title;
    if (v.teamMode) {
        const sums = [0, 1].map(t => ({ t, total: v.players.reduce((n, p, i) => n + (p.team === t ? totals[i] : 0), 0) })).sort((a, b) => b.total - a.total);
        const tie = sums[0].total === sums[1].total;
        title = tie ? 'Unentschieden!' : `${esc(v.teamNames[sums[0].t])} gewinnt!`;
        teamBlock = `<table class="ranking"><tbody>${sums.map((s, k) => `<tr class="${!tie && k === 0 ? 'win' : ''}"><td style="color:${TEAM_COLORS[s.t]}">${esc(v.teamNames[s.t])}</td><td>${s.total}</td></tr>`).join('')}</tbody></table>`;
    } else {
        const tie = sorted.length > 1 && sorted[0].total === sorted[1].total;
        title = tie ? 'Unentschieden an der Spitze!' : sorted[0].seat === v.seat ? 'Du hast gewonnen!' : `${esc(sorted[0].p.name)} hat gewonnen`;
    }
    const rows = sorted
        .map((r, k) => `<tr class="${!v.teamMode && r.total === sorted[0].total ? 'win' : ''}${r.seat === v.seat ? ' me' : ''}"><td>${k + 1}. ${esc(r.p.name)}${v.teamMode ? ` <span class="muted">(${esc(v.teamNames[r.p.team])})</span>` : ''}</td><td>${r.total}</td></tr>`)
        .join('');
    return `<h2>${title}</h2>${teamBlock}<table class="ranking"><thead><tr><th></th><th>${unit}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
