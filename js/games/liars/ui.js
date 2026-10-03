// Oberfläche von Lügenwürfel: eigene Würfel, aktuelles Gebot, Bietfeld und Aufdeckung am Rundenende.
import { esc, FACES } from '../common/kit.js';

const die = (value, cls = '') => `<span class="lw-die ${cls}">${FACES[value - 1]}</span>`;
const faceName = n => ['', 'Einser', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'][n];

export function createLiarsUI() {
    // Eigene Auswahl im Bietfeld; bleibt zwischen den Aktualisierungen erhalten, bis sich das Gebot ändert.
    const sel = { key: '', qty: 1, face: 2 };

    function suggest(v) {
        const faces = v.faces;
        if (!v.bid) return { qty: 1, face: faces[0] };
        const higher = faces.find(f => f > v.bid.face);
        return higher ? { qty: v.bid.qty, face: higher } : { qty: v.bid.qty + 1, face: faces[0] };
    }

    function validBid(v, qty, face) {
        if (!v.faces.includes(face) || qty < 1 || qty > v.total) return false;
        return !v.bid || qty > v.bid.qty || (qty === v.bid.qty && face > v.bid.face);
    }

    function syncSel(v) {
        const key = `${v.round}:${v.bid ? `${v.bid.qty}x${v.bid.face}` : '-'}`;
        if (sel.key !== key) Object.assign(sel, suggest(v), { key });
    }

    function bidText(b, v) {
        const wild = v.wild ? ' (Einser zählen mit)' : '';
        return `${b.qty} × ${die(b.face)} ${faceName(b.face)}${wild}`;
    }

    const game = {
        name: 'Lügenwürfel',
        intro: () => 'Alle würfeln geheim. Reihum bietet ihr, wie viele Würfel eines Wertes insgesamt am Tisch liegen, und überbietet das letzte Gebot – oder sagt „Lüge!“. Wer falsch liegt, verliert einen Würfel. Wer zuletzt noch Würfel hat, gewinnt.',
        options: (v, isHost) => {
            const dice = v.diceOptions.map(n => `<button class="btn${n === v.diceStart ? ' primary' : ''}" type="button" data-act="setDice" data-n="${n}"${isHost ? '' : ' disabled'}>${n}</button>`).join('');
            return `<p class="muted">Würfel pro Person:</p><div class="row center">${dice}</div>
                <p><label class="check"><input type="checkbox" ${v.wild ? 'checked' : ''} ${isHost ? '' : 'disabled'} data-act="setWild" data-on="${v.wild ? 0 : 1}" data-keep="wild"> Einser sind Joker (zählen für jeden Wert, bieten kann man 2 bis 6)</label></p>`;
        },
        top: v => (v.phase === 'waiting' ? '' : `Runde ${v.round} · ${v.total} Würfel im Spiel`),
        scores: v => (v.phase === 'waiting' ? null : v.dice),
        chip: (v, seat) => ({ cls: [v.turn === seat ? 'on-turn' : '', v.dice[seat] === 0 ? 'out' : ''].join(' '), note: v.dice[seat] === 0 ? '✖' : '🎲' }),

        stage(v, ctx) {
            if (v.reveal) return revealHTML(v);
            if (v.phase !== 'bidding') return '';
            syncSel(v);
            const mine = v.turn === v.seat;
            const hand = v.hand.length
                ? `<div class="lw-hand">${v.hand.map(d => die(d, d === 1 && v.wild ? 'joker' : '')).join('')}</div><p class="muted center">Deine Würfel – nur du siehst sie.</p>`
                : '<p class="muted center">Du bist ausgeschieden und schaust zu.</p>';
            const bidBox = v.bid
                ? `<div class="lw-bid">Gebot von <b>${esc(ctx.name(v.bid.seat))}</b>:<div class="lw-big">${bidText(v.bid, v)}</div></div>`
                : `<div class="lw-bid"><div class="lw-big">Noch kein Gebot</div></div>`;
            const history = v.bids.length ? `<div class="lw-hist">${v.bids.map(b => `<span>${esc(ctx.name(b.seat))}: ${b.qty} × ${die(b.face)}</span>`).join('')}</div>` : '';
            let controls;
            if (mine) {
                const ok = validBid(v, sel.qty, sel.face);
                controls = `<div class="lw-ctl">
                    <div class="lw-row"><button class="btn" type="button" data-act="qty" data-d="-1">−</button><span class="lw-qty">${sel.qty}</span><button class="btn" type="button" data-act="qty" data-d="1">+</button><span class="muted">Anzahl</span></div>
                    <div class="lw-faces">${v.faces.map(f => `<button class="btn lw-face${f === sel.face ? ' primary' : ''}" type="button" data-act="face" data-face="${f}">${die(f)}</button>`).join('')}</div>
                    <div class="lw-row"><button class="btn primary big" type="button" data-act="bid"${ok ? '' : ' disabled'}>Bieten: ${sel.qty} × ${die(sel.face)}</button>
                    <button class="btn danger big" type="button" data-act="challenge"${v.bid ? '' : ' disabled'}>Lüge!</button></div>
                    ${ok ? '' : '<p class="muted">Das Gebot muss höher sein: mehr Würfel oder gleich viele mit höherem Wert.</p>'}</div>`;
            } else {
                controls = `<p class="center"><b>${esc(ctx.name(v.turn))}</b> überlegt …</p>`;
            }
            return `${bidBox}${history}${hand}${controls}`;
        },

        click(act, t, ctx) {
            const v = ctx.v;
            if (act === 'qty') {
                sel.qty = Math.min(v.total, Math.max(1, sel.qty + Number(t.dataset.d)));
                ctx.rerender();
                return true;
            }
            if (act === 'face') {
                sel.face = Number(t.dataset.face);
                ctx.rerender();
                return true;
            }
            if (act === 'bid') {
                ctx.send({ t: 'bid', qty: sel.qty, face: sel.face });
                return true;
            }
            if (act === 'setWild') {
                ctx.send({ t: 'setWild', on: t.checked });
                return true;
            }
            return false;
        },

        over: (v, ctx) => `<h2>${v.winner === v.seat ? 'Du hast gewonnen!' : `${esc(ctx.name(v.winner))} hat gewonnen`}</h2>
            <table class="ranking"><thead><tr><th></th><th>Siege</th></tr></thead><tbody>${v.players.map((p, i) => ({ p, i })).sort((a, b) => v.wins[b.i] - v.wins[a.i]).map(({ p, i }) => `<tr class="${i === v.winner ? 'win' : ''}"><td>${esc(p.name)}</td><td>${v.wins[i]}</td></tr>`).join('')}</tbody></table>`,
    };

    function revealHTML(v) {
        const r = v.reveal;
        const name = i => esc(v.players[i].name);
        const rows = r.hands.map((hand, i) => `<div class="lw-rrow${i === r.loser ? ' lost' : ''}"><span class="lw-rname">${name(i)}</span><span>${hand.length ? hand.map(d => die(d, d === r.face || (v.wild && d === 1) ? 'hit' : 'dim')).join('') : '<span class="muted">–</span>'}</span></div>`).join('');
        const verdict = r.bidderRight
            ? `<b>${name(r.bidder)}</b> hatte recht: es gibt ${r.count} × ${die(r.face)}. <b>${name(r.challenger)}</b> verliert einen Würfel${r.out ? ' und scheidet aus' : ''}.`
            : `<b>${name(r.bidder)}</b> hat gelogen: es gibt nur ${r.count} × ${die(r.face)}. <b>${name(r.bidder)}</b> verliert einen Würfel${r.out ? ' und scheidet aus' : ''}.`;
        const done = v.phase === 'over';
        return `<div class="lw-bid">${name(r.challenger)} sagt „Lüge!“ zu ${r.qty} × ${die(r.face)}</div><div class="lw-reveal">${rows}</div><p class="center">${verdict}</p>${done ? '' : '<p class="center"><button class="btn primary" type="button" data-act="next">Weiter</button></p>'}`;
    }

    return game;
}
