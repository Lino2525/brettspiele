// Fenster für Handelsangebote: Angebot zusammenstellen und eingehendes Angebot beantworten.
import { SPACES, GROUPS, groupIndices } from './board.js';
import { PLAYER_COLORS, money } from './board-view.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const swatch = idx => `<span class="swatch" style="background:${GROUPS[SPACES[idx].group]?.color ?? (SPACES[idx].type === 'rail' ? '#333' : '#bbb')}"></span>`;

// Nur Grundstücke ohne Gebäude in der Farbgruppe dürfen getauscht werden.
export function tradableProps(v, seat) {
    return v.props
        .map((p, idx) => idx)
        .filter(idx => v.props[idx] && v.props[idx].owner === seat)
        .filter(idx => SPACES[idx].type !== 'street' || !groupIndices(idx).some(i => v.props[i].houses > 0));
}

export function emptyDraft() {
    return { to: null, give: { cash: 0, props: [], cards: 0 }, get: { cash: 0, props: [], cards: 0 } };
}

function sideColumn(v, seat, side, title, who) {
    const pl = v.players[seat];
    const props = tradableProps(v, seat);
    const rows = props.length
        ? props
              .map(
                  idx => `<label class="trow">
                <input type="checkbox" data-trade="${who}.prop" value="${idx}"${side.props.includes(idx) ? ' checked' : ''}>
                ${swatch(idx)}<span>${esc(SPACES[idx].name)}${v.props[idx].mortgaged ? ' (Hypothek)' : ''}</span></label>`,
              )
              .join('')
        : '<div class="muted">Keine tauschbaren Grundstücke</div>';
    return `<div class="tcol">
        <h4>${title}</h4>
        <label class="tfield">Bargeld (bis ${money(pl.cash)})
            <input type="number" min="0" max="${pl.cash}" step="10" value="${side.cash}" data-trade="${who}.cash"></label>
        ${pl.jailCards ? `<label class="tfield">Freikarten (bis ${pl.jailCards})
            <input type="number" min="0" max="${pl.jailCards}" step="1" value="${side.cards}" data-trade="${who}.cards"></label>` : ''}
        <div class="tprops">${rows}</div>
    </div>`;
}

export function composeHTML(v, draft) {
    const others = v.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== v.seat && !p.bankrupt);
    const partners = others
        .map(({ p, i }) => `<button class="btn${draft.to === i ? ' primary' : ''}" type="button" data-act="tradeTo" data-seat="${i}">${esc(p.name)}</button>`)
        .join('');
    const cols =
        draft.to === null
            ? '<p class="muted">Wähle zuerst, mit wem du handeln möchtest.</p>'
            : `<div class="tcols">${sideColumn(v, v.seat, draft.give, 'Du gibst', 'give')}${sideColumn(v, draft.to, draft.get, `Du bekommst von ${esc(v.players[draft.to].name)}`, 'get')}</div>`;
    return `<h2>Handeln</h2>
        <div class="row">${partners}</div>
        ${cols}
        <div class="row end">
            <button class="btn" type="button" data-act="tradeClose">Abbrechen</button>
            <button class="btn primary" type="button" data-act="tradeSend"${draft.to === null ? ' disabled' : ''}>Angebot machen</button>
        </div>`;
}

function describeSide(side) {
    const parts = [];
    if (side.cash) parts.push(money(side.cash));
    for (const idx of side.props) parts.push(`${swatch(idx)}${esc(SPACES[idx].name)}`);
    if (side.cards) parts.push(`${side.cards}× Freikarte`);
    return parts.length ? parts.join('<br>') : '<span class="muted">nichts</span>';
}

// Angebot, wie es der Empfänger sieht (t.give = was der Anbieter gibt)
export function incomingHTML(v) {
    const t = v.trade;
    const from = v.players[t.from];
    return `<h2>Handelsangebot</h2>
        <p><span class="ptoken sm" style="background:${PLAYER_COLORS[t.from]}"></span> <strong>${esc(from.name)}</strong> bietet dir an:</p>
        <div class="tcols">
            <div class="tcol"><h4>Du bekommst</h4>${describeSide(t.give)}</div>
            <div class="tcol"><h4>Du gibst</h4>${describeSide(t.get)}</div>
        </div>
        <div class="row end">
            <button class="btn" type="button" data-act="tradeDecline">Ablehnen</button>
            <button class="btn primary" type="button" data-act="tradeAccept">Annehmen</button>
        </div>`;
}

export function readDraftInput(draft, input) {
    const [who, field] = input.dataset.trade.split('.');
    const side = draft[who];
    if (field === 'prop') {
        const idx = Number(input.value);
        side.props = input.checked ? [...new Set([...side.props, idx])] : side.props.filter(i => i !== idx);
    } else {
        side[field] = Math.max(0, Math.floor(Number(input.value) || 0));
    }
}
