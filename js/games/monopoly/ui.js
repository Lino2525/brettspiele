// Oberfläche für Monopoly: Spielplan, Würfel, Steuerung, Besitzverwaltung, Versteigerung, Handel.
// Alle sehen dieselben Ereignisse (Würfel, Bewegung, Karten) live, die Animationen laufen lokal nacheinander ab.
import {
    SPACES, GROUPS, JAIL_FINE, canBuild, canSellBuilding, canMortgage, canUnmortgage, houseCost, mortgageValue, unmortgageCost,
} from './board.js';
import { createBoard, money, PLAYER_COLORS, PLAYER_TEXT } from './board-view.js';
import { composeHTML, incomingHTML, emptyDraft, readDraftInput } from './trade-ui.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const TEMPLATE = `
<div class="mono">
  <div class="mono-main">
    <div class="board-wrap">
      <div class="board-slot"></div>
      <div class="controls">
        <div class="logo">MONOPOLY</div>
        <div class="dice" aria-label="Würfel"><span class="die">⚀</span><span class="die">⚀</span></div>
        <div class="ctl-body"></div>
      </div>
    </div>
  </div>
  <aside class="mono-side">
    <section class="panel"><h3>Spieler</h3><div class="players-box"></div></section>
    <section class="panel"><h3>Mein Besitz</h3><div class="mine-box"></div></section>
    <section class="panel"><h3>Verlauf</h3><div class="logbox"></div><div class="stock"></div></section>
  </aside>
  <div class="overlay" hidden><div class="overlay-box"></div></div>
  <div class="modal" hidden><div class="modal-box"></div></div>
  <div class="cardpop" hidden></div>
  <div class="toast" hidden></div>
</div>`;

export function mountMonopoly(root, session) {
    root.innerHTML = TEMPLATE;
    const $ = sel => root.querySelector(sel);
    const el = {
        slot: $('.board-slot'), dice: $('.dice'), body: $('.ctl-body'), players: $('.players-box'), mine: $('.mine-box'),
        log: $('.logbox'), stock: $('.stock'), overlay: $('.overlay'), overlayBox: $('.overlay-box'),
        modal: $('.modal'), modalBox: $('.modal-box'), cardpop: $('.cardpop'), toast: $('.toast'),
    };

    const st = {
        view: null, avatars: [null, null, null, null], displayPos: [], lastEvent: 0,
        modal: null, shown: null, draft: emptyDraft(), bid: '', bidFocus: false,
    };
    let toastTimer = null;
    let dead = false;
    let chain = Promise.resolve();
    const enqueue = fn => {
        chain = chain.then(() => (dead ? null : fn())).catch(console.error);
    };

    const board = createBoard(el.slot, { onCellClick: idx => openProp(idx) });

    const myTurn = () => st.view.phase === 'playing' && st.view.turn === st.view.seat;
    const canManageNow = () => {
        const v = st.view;
        if (v.phase !== 'playing' || v.auction) return false;
        return v.debt ? v.debt.seat === v.seat : v.turn === v.seat;
    };

    // ---------- Zustand und Animationen ----------

    function applyView(v) {
        const first = st.view === null;
        st.view = v;
        v.players.forEach((p, i) => {
            if (st.displayPos[i] === undefined) st.displayPos[i] = p.pos;
        });
        if (first) {
            st.lastEvent = v.eventSeq;
            if (v.dice) showDice(v.dice);
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
        board.placeTokens(st.displayPos, st.view.players);
    }

    function showDice(d) {
        const dice = el.dice.querySelectorAll('.die');
        dice[0].textContent = FACES[d[0] - 1];
        dice[1].textContent = FACES[d[1] - 1];
        el.dice.classList.remove('rolling');
    }

    async function playEvent(e) {
        const players = st.view.players;
        switch (e.type) {
            case 'dice': {
                el.dice.classList.add('rolling');
                const dice = el.dice.querySelectorAll('.die');
                for (let i = 0; i < 8; i++) {
                    dice[0].textContent = FACES[Math.floor(Math.random() * 6)];
                    dice[1].textContent = FACES[Math.floor(Math.random() * 6)];
                    await sleep(80);
                }
                showDice(e.d);
                await sleep(250);
                break;
            }
            case 'move':
                if (e.mode === 'walk') {
                    let p = e.from;
                    while (p !== e.to) {
                        p = (p + 1) % 40;
                        st.displayPos[e.seat] = p;
                        board.placeTokens(st.displayPos, players);
                        await sleep(120);
                    }
                } else {
                    st.displayPos[e.seat] = e.to;
                    board.placeTokens(st.displayPos, players);
                    await sleep(450);
                }
                break;
            case 'card':
                el.cardpop.innerHTML = `<div class="cardpop-box ${e.deck}">
                    <h3>${e.deck === 'chance' ? 'Ereigniskarte' : 'Gemeinschaftskarte'}</h3>
                    <p>${esc(e.text)}</p><small>${esc(players[e.seat].name)}</small></div>`;
                el.cardpop.hidden = false;
                await sleep(2800);
                el.cardpop.hidden = true;
                break;
            default:
                break;
        }
    }

    // ---------- Anzeige ----------

    function render() {
        const v = st.view;
        board.updateCells(v.props, v.players);
        board.placeTokens(st.displayPos, v.players);
        renderPlayers();
        renderMine();
        renderLog();
        renderControls();
        renderOverlay();
        renderModal();
    }

    function renderPlayers() {
        const v = st.view;
        el.players.innerHTML = v.players
            .map((p, i) => {
                const props = v.props
                    .map((pr, idx) => idx)
                    .filter(idx => v.props[idx] && v.props[idx].owner === i)
                    .map(idx => {
                        const sp = SPACES[idx];
                        const color = GROUPS[sp.group]?.color ?? (sp.type === 'rail' ? '#333' : '#aaa');
                        const pr = v.props[idx];
                        return `<i class="pp${pr.mortgaged ? ' mort' : ''}" style="background:${color}" title="${esc(sp.name)}${pr.houses ? ` (${pr.houses === 5 ? 'Hotel' : pr.houses + ' Häuser'})` : ''}${pr.mortgaged ? ' – Hypothek' : ''}"></i>`;
                    })
                    .join('');
                const notes = [];
                if (p.bankrupt) notes.push('pleite');
                if (p.inJail) notes.push('im Gefängnis');
                if (p.jailCards) notes.push(`${p.jailCards}× Freikarte`);
                if (!p.connected) notes.push('offline');
                const avatar = st.avatars[i];
                return `<div class="pl${v.phase === 'playing' && v.turn === i ? ' on-turn' : ''}${p.bankrupt ? ' out' : ''}">
                    <span class="ptoken" style="background:${PLAYER_COLORS[i]};color:${PLAYER_TEXT[i]}${avatar ? `;background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</span>
                    <div class="pinfo">
                        <div><strong>${esc(p.name)}</strong>${i === v.seat ? ' <span class="me-tag">Du</span>' : ''}<span class="cash">${money(p.cash)}</span></div>
                        ${notes.length ? `<div class="muted">${notes.join(' · ')}</div>` : ''}
                        <div class="pprops">${props}</div>
                    </div></div>`;
            })
            .join('');
    }

    function renderMine() {
        const v = st.view;
        const me = v.players[v.seat];
        if (!me || me.bankrupt) {
            el.mine.innerHTML = '<div class="muted">Du bist ausgeschieden.</div>';
            return;
        }
        const manage = canManageNow();
        const mine = v.props.map((p, idx) => idx).filter(idx => v.props[idx] && v.props[idx].owner === v.seat);
        if (!mine.length) {
            el.mine.innerHTML = '<div class="muted">Du besitzt noch keine Grundstücke.</div>';
            return;
        }
        const rows = mine
            .map(idx => {
                const p = v.props[idx];
                const sp = SPACES[idx];
                const btns = [];
                if (manage) {
                    if (sp.type === 'street') {
                        const b = canBuild(v.props, v.seat, me.cash, idx);
                        if (b.ok) btns.push(`<button class="mbtn" data-act="build" data-idx="${idx}" title="${p.houses === 4 ? 'Hotel' : 'Haus'} bauen">＋ ${p.houses === 4 ? 'Hotel' : 'Haus'} ${money(b.cost)}</button>`);
                        const s = canSellBuilding(v.props, v.seat, idx);
                        if (s.ok) btns.push(`<button class="mbtn" data-act="sellBuilding" data-idx="${idx}" title="Gebäude zum halben Preis verkaufen">− verkaufen ${money(s.refund)}</button>`);
                    }
                    if (canMortgage(v.props, v.seat, idx).ok) btns.push(`<button class="mbtn" data-act="mortgage" data-idx="${idx}" title="Hypothek aufnehmen">Hypothek +${mortgageValue(idx)}</button>`);
                    if (canUnmortgage(v.props, v.seat, me.cash, idx).ok) btns.push(`<button class="mbtn" data-act="unmortgage" data-idx="${idx}" title="Hypothek ablösen (mit 10 % Zinsen)">Ablösen ${money(unmortgageCost(idx))}</button>`);
                }
                const color = GROUPS[sp.group]?.color ?? (sp.type === 'rail' ? '#333' : '#aaa');
                const state = p.mortgaged ? ' · Hypothek' : p.houses === 5 ? ' · Hotel' : p.houses ? ` · ${p.houses} ${p.houses === 1 ? 'Haus' : 'Häuser'}` : '';
                return `<div class="prow${p.mortgaged ? ' mort' : ''}">
                    <span class="swatch" style="background:${color}"></span>
                    <span class="pn" data-act="showProp" data-idx="${idx}">${esc(sp.name)}<small>${state}</small></span>
                    <span class="pbtns">${btns.join('')}</span></div>`;
            })
            .join('');
        el.mine.innerHTML = rows + (manage ? '' : '<div class="muted">Bauen und Hypotheken gehen in deinem Zug.</div>');
    }

    function renderLog() {
        const v = st.view;
        const lines = v.log.slice(-40).map(l => `<div>${esc(l)}</div>`).join('');
        if (el.log.dataset.sig !== String(v.log.length) + (v.log.at(-1) ?? '')) {
            el.log.innerHTML = lines;
            el.log.scrollTop = el.log.scrollHeight;
            el.log.dataset.sig = String(v.log.length) + (v.log.at(-1) ?? '');
        }
        el.stock.textContent = `Bank: ${v.houseStock} Häuser, ${v.hotelStock} Hotels`;
    }

    // compact: zweispaltig, passt in die Mitte des Spielplans
    function propCard(idx, v, compact = false) {
        const sp = SPACES[idx];
        const pr = v.props[idx];
        const owner = pr && pr.owner !== null ? v.players[pr.owner].name : null;
        const row = (label, value) => `<div class="dr"><span>${label}</span><b>${value}</b></div>`;
        let head;
        let rows = '';
        if (sp.type === 'street') {
            head = `<div class="deedhead" style="background:${GROUPS[sp.group].color};color:${['yellow', 'lightblue'].includes(sp.group) ? '#222' : '#fff'}">${esc(sp.name)}</div>`;
            const r = sp.rent;
            rows = row('Miete', money(r[0])) + row('Ganze Farbe', money(r[0] * 2)) + row('1 Haus', money(r[1])) + row('2 Häuser', money(r[2])) +
                row('3 Häuser', money(r[3])) + row('4 Häuser', money(r[4])) + row('Hotel', money(r[5])) +
                row('Haus / Hotel kostet', money(houseCost(idx))) + row('Hypothek', money(mortgageValue(idx)));
        } else if (sp.type === 'rail') {
            head = `<div class="deedhead dark">🚂 ${esc(sp.name)}</div>`;
            rows = row('1 Bahnhof', money(25)) + row('2 Bahnhöfe', money(50)) + row('3 Bahnhöfe', money(100)) + row('4 Bahnhöfe', money(200)) + row('Hypothek', money(mortgageValue(idx)));
        } else if (sp.type === 'util') {
            head = `<div class="deedhead dark">${esc(sp.name)}</div>`;
            rows = row('1 Werk', '4 × Augenzahl') + row('2 Werke', '10 × Augenzahl') + row('Hypothek', money(mortgageValue(idx)));
        } else {
            return `<div class="deedhead dark">${esc(sp.name)}</div>`;
        }
        const status = pr ? (owner ? `Besitzer: ${esc(owner)}${pr.mortgaged ? ' (Hypothek)' : ''}` : 'Noch frei') : '';
        return `${head}<div class="deedprice">Preis ${money(sp.price)}</div><div class="deed${compact ? ' compact' : ''}">${rows}</div><div class="muted">${status}</div>`;
    }

    // ---------- Steuerung in der Mitte ----------

    function controlsHTML(v) {
        if (v.phase !== 'playing') return '';
        const me = v.players[v.seat];
        const cur = v.players[v.turn];
        const mine = v.turn === v.seat;
        const turnLine = `<div class="turnline"><span class="ptoken sm" style="background:${PLAYER_COLORS[v.turn]}"></span>${mine ? '<strong>Du bist am Zug</strong>' : `<strong>${esc(cur.name)}</strong> ist am Zug`}</div>`;
        let main = '';
        if (v.debt) {
            const d = v.debt;
            const debtor = v.players[d.seat];
            const to = d.to === null ? 'die Bank' : v.players[d.to].name;
            main = d.seat === v.seat
                ? `<div class="alert">Du musst ${money(d.amount)} an ${esc(to)} zahlen, hast aber nur ${money(debtor.cash)}.
                    Beschaffe Geld unter „Mein Besitz“: Gebäude verkaufen oder Hypotheken aufnehmen. Die Zahlung erfolgt dann automatisch.</div>
                    <button class="btn danger" type="button" data-act="bankrupt">Bankrott erklären</button>`
                : `<div class="alert">${esc(debtor.name)} muss ${money(d.amount)} an ${esc(to)} zahlen und beschafft gerade Geld.</div>`;
        } else if (v.auction) {
            main = auctionHTML(v);
        } else if (mine && v.turnPhase === 'buy') {
            const idx = me.pos;
            const price = SPACES[idx].price;
            main = `<div class="buybox">${propCard(idx, v, true)}</div>
                <div class="row center">
                    <button class="btn primary" type="button" data-act="buy"${me.cash < price ? ' disabled' : ''}>Kaufen (${money(price)})</button>
                    <button class="btn" type="button" data-act="decline">Versteigern</button>
                </div>${me.cash < price ? '<div class="muted">Dir fehlt das Geld zum Kaufen, du kannst nur versteigern.</div>' : ''}`;
        } else if (mine && v.turnPhase === 'roll') {
            if (me.inJail) {
                main = `<div class="alert">Du sitzt im Gefängnis (Versuch ${me.jailTurns + 1} von 3). Mit einem Pasch kommst du frei.</div>
                    <div class="row center">
                        <button class="btn primary" type="button" data-act="roll">Würfeln</button>
                        <button class="btn" type="button" data-act="payJail"${me.cash < JAIL_FINE ? ' disabled' : ''}>${money(JAIL_FINE)} zahlen</button>
                        ${me.jailCards ? '<button class="btn" type="button" data-act="useJailCard">Freikarte benutzen</button>' : ''}
                    </div>`;
            } else {
                main = `<div class="row center"><button class="btn primary big" type="button" data-act="roll">${v.extra ? 'Noch einmal würfeln (Pasch)' : 'Würfeln'}</button></div>`;
            }
        } else if (mine && v.turnPhase === 'end') {
            main = '<div class="row center"><button class="btn primary big" type="button" data-act="endTurn">Zug beenden</button></div>';
        } else {
            main = `<div class="muted center">Warte auf ${esc(cur.name)} …</div>`;
        }
        let extras = '';
        if (v.trade && v.trade.from === v.seat) {
            extras += `<div class="alert">Dein Angebot an ${esc(v.players[v.trade.to].name)} wartet auf Antwort.
                <button class="btn small" type="button" data-act="tradeCancel">Zurückziehen</button></div>`;
        } else if (v.trade && v.trade.to !== v.seat) {
            extras += `<div class="muted center">${esc(v.players[v.trade.from].name)} macht ${esc(v.players[v.trade.to].name)} ein Angebot.</div>`;
        }
        const tools = !v.auction
            ? `<div class="row center tools">
                <button class="btn small" type="button" data-act="trade"${v.trade ? ' disabled' : ''}>Handeln</button>
                ${mine ? '<button class="btn small" type="button" data-act="resign">Aufgeben</button>' : ''}
            </div>`
            : '';
        return turnLine + main + extras + tools;
    }

    function auctionHTML(v) {
        const au = v.auction;
        const bidder = au.active[au.at];
        const high = au.highBy === null ? 'Noch kein Gebot' : `Höchstgebot: <strong>${money(au.high)}</strong> von ${esc(v.players[au.highBy].name)}`;
        const mine = bidder === v.seat;
        const cash = v.players[v.seat].cash;
        const inc = [10, 50, 100]
            .map(n => `<button class="btn small" type="button" data-act="bid" data-amount="${au.high + n}"${au.high + n > cash ? ' disabled' : ''}>+${n}</button>`)
            .join('');
        const controls = mine
            ? `<div class="row center">${inc}</div>
               <div class="row center"><input id="bidInput" type="number" min="${au.high + 1}" step="10" placeholder="Eigenes Gebot" value="${esc(st.bid)}">
               <button class="btn" type="button" data-act="bidCustom">Bieten</button>
               <button class="btn" type="button" data-act="pass">Aussteigen</button></div>`
            : `<div class="muted center">${esc(v.players[bidder].name)} ist mit Bieten dran …</div>`;
        const stillIn = au.active.map(s => esc(v.players[s].name)).join(', ');
        return `<div class="buybox">${propCard(au.idx, v, true)}</div><div class="center">${high}</div>${controls}<div class="muted center">Noch dabei: ${stillIn}</div>`;
    }

    function renderControls() {
        const v = st.view;
        $('.controls').classList.toggle('busy', v.phase === 'playing' && (!!v.auction || (v.turnPhase === 'buy' && v.turn === v.seat)));
        const html = controlsHTML(v);
        if (el.body.dataset.html === html) return;
        el.body.dataset.html = html;
        el.body.innerHTML = html;
        const input = el.body.querySelector('#bidInput');
        if (input && st.bidFocus) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }

    function renderOverlay() {
        const v = st.view;
        let html = '';
        if (v.phase === 'waiting') {
            const list = v.players.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`).join('');
            const isHost = v.seat === v.hostSeat;
            html = `<h2>Monopoly</h2><ul class="plist">${list}</ul>
                <p>Es können ${v.minPlayers} bis ${v.maxPlayers} Personen mitspielen. Schick den Einladungslink oder den Raumcode.</p>` +
                (isHost
                    ? `<button class="btn primary" data-act="start" type="button"${v.players.length >= v.minPlayers ? '' : ' disabled'}>Spiel starten</button>`
                    : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`);
        } else if (v.phase === 'over') {
            const rows = v.players
                .map((p, i) => ({ p, i, worth: v.worth[i] }))
                .sort((a, b) => (a.i === v.winner ? -1 : b.i === v.winner ? 1 : b.worth - a.worth))
                .map(({ p, i, worth }) => `<tr class="${i === v.winner ? 'win' : ''}"><td>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</td><td>${p.bankrupt ? 'pleite' : money(p.cash)}</td><td>${p.bankrupt ? '–' : money(worth)}</td></tr>`)
                .join('');
            const title = v.winner === null ? 'Das Spiel ist beendet' : v.winner === v.seat ? 'Du hast gewonnen!' : `${esc(v.players[v.winner].name)} hat gewonnen`;
            html = `<h2>${title}</h2>
                <table class="ranking"><thead><tr><th></th><th>Bargeld</th><th>Vermögen</th></tr></thead><tbody>${rows}</tbody></table>
                <button class="btn primary" data-act="rematch" type="button">Noch einmal spielen</button>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.innerHTML !== html) el.overlayBox.innerHTML = html;
    }

    // ---------- Fenster (Grundstück, Handel) ----------

    function openProp(idx) {
        if (!st.view || !st.view.props[idx]) return;
        st.modal = { kind: 'prop', idx };
        renderModal(true);
    }

    function closeModal() {
        st.modal = null;
        renderModal(true);
    }

    function renderModal(force = false) {
        const v = st.view;
        let kind = null;
        let html = '';
        if (v.phase === 'playing' && v.trade && v.trade.to === v.seat) {
            kind = 'incoming';
            html = incomingHTML(v);
        } else if (st.modal?.kind === 'trade' && v.phase === 'playing') {
            kind = 'compose';
            if (force || st.shown !== 'compose') html = composeHTML(v, st.draft);
        } else if (st.modal?.kind === 'prop') {
            kind = 'prop';
            html = `<div class="deedwrap">${propCard(st.modal.idx, v)}</div><div class="row end"><button class="btn" type="button" data-act="closeModal">Schließen</button></div>`;
        }
        const changed = kind !== st.shown || force || kind === 'incoming';
        st.shown = kind;
        el.modal.hidden = !kind;
        if (kind && html && changed && el.modalBox.dataset.html !== html) {
            el.modalBox.dataset.html = html;
            el.modalBox.innerHTML = html;
        }
        if (!kind) el.modalBox.dataset.html = '';
    }

    function toast(text) {
        el.toast.textContent = text;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
    }

    // ---------- Eingaben ----------

    root.addEventListener('click', e => {
        if (e.target === el.modal && st.modal?.kind === 'prop') return closeModal();
        const t = e.target.closest('[data-act]');
        if (!t || !st.view) return;
        const send = a => session.send(a);
        const idx = Number(t.dataset.idx);
        switch (t.dataset.act) {
            case 'start': case 'rematch': case 'roll': case 'buy': case 'decline': case 'endTurn': case 'payJail':
            case 'useJailCard': case 'pass': case 'bankrupt': case 'tradeAccept': case 'tradeDecline': case 'tradeCancel':
                send({ t: t.dataset.act });
                break;
            case 'build': case 'sellBuilding': case 'mortgage': case 'unmortgage':
                send({ t: t.dataset.act, idx });
                break;
            case 'showProp':
                openProp(idx);
                break;
            case 'bid':
                send({ t: 'bid', amount: Number(t.dataset.amount) });
                break;
            case 'bidCustom': {
                const input = el.body.querySelector('#bidInput');
                send({ t: 'bid', amount: Math.floor(Number(input.value)) });
                st.bid = '';
                break;
            }
            case 'resign':
                if (confirm('Wirklich aufgeben? Dein Besitz geht zurück an die Bank und wird versteigert.')) send({ t: 'resign' });
                break;
            case 'trade':
                st.draft = emptyDraft();
                st.modal = { kind: 'trade' };
                renderModal(true);
                break;
            case 'tradeTo':
                st.draft = { ...emptyDraft(), to: Number(t.dataset.seat) };
                renderModal(true);
                break;
            case 'tradeSend':
                send({ t: 'tradeOffer', to: st.draft.to, give: st.draft.give, get: st.draft.get });
                closeModal();
                break;
            case 'tradeClose': case 'closeModal':
                closeModal();
                break;
        }
    });

    root.addEventListener('input', e => {
        if (e.target.id === 'bidInput') st.bid = e.target.value;
        if (e.target.dataset.trade && st.draft) readDraftInput(st.draft, e.target);
    });
    root.addEventListener('change', e => {
        if (e.target.dataset.trade && st.draft) readDraftInput(st.draft, e.target);
    });
    root.addEventListener('focusin', e => {
        if (e.target.id === 'bidInput') st.bidFocus = true;
    });
    root.addEventListener('focusout', e => {
        if (e.target.id === 'bidInput') st.bidFocus = false;
    });

    // ---------- Anbindung ----------

    session.onView = v => {
        applyView(v);
        render();
    };
    session.onNotice = text => toast(text);
    session.onAvatars = list => {
        st.avatars = list;
        board.setAvatars(list);
        if (st.view) renderPlayers();
    };

    return {
        destroy() {
            dead = true;
            root.innerHTML = '';
        },
    };
}
