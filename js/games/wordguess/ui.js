// Oberfläche von Wortraten: Hinweise erscheinen nach und nach, getippt wird der gesuchte Begriff.
import { esc, scoreOverHTML } from '../common/kit.js';

export function createWordGuessUI() {
    const slots = v => Array.from({ length: v.hintCount }, (_, i) => (i < v.hints.length ? `<span class="wg-hint on"><i>${i + 1}</i>${esc(v.hints[i])}</span>` : `<span class="wg-hint"><i>${i + 1}</i>?</span>`)).join('');

    function playHTML(v, ctx) {
        const solved = v.solved[v.seat];
        const form = solved
            ? `<p class="wg-done center">✔ ${v.teamMode && v.gain[v.seat] === 0 ? 'Dein Team hat das Wort erraten!' : `Erraten! +${v.gain[v.seat]} Punkte`}<br><span class="muted">Warte auf die anderen …</span></p>`
            : `<form data-form="guess" class="uc-form"><input name="text" maxlength="40" autocomplete="off" autocapitalize="words" data-keep="guess" placeholder="Was ist gesucht?"${v.triesLeft ? '' : ' disabled'}><button class="btn primary" type="submit"${v.triesLeft ? '' : ' disabled'}>Raten</button></form>
               <p class="muted center">${v.triesLeft ? `Noch ${v.triesLeft} ${v.triesLeft === 1 ? 'Versuch' : 'Versuche'} für diesen Hinweis.` : 'Keine Versuche mehr für diesen Hinweis – gleich kommt der nächste.'} Richtig jetzt: <b>+${v.nextPoints}</b> Punkte.</p>`;
        const feed = v.guesses.length
            ? `<div class="wg-feed">${v.guesses.slice(-8).reverse().map(g => (g.ok ? `<div class="ok">${ctx.avatar(g.seat, 18)} ${esc(ctx.name(g.seat))} hat es erraten!</div>` : `<div>${ctx.avatar(g.seat, 18)} ${esc(ctx.name(g.seat))}: ${esc(g.text)} ✘</div>`)).join('')}</div>`
            : '';
        return `<div class="wg-hints">${slots(v)}</div>${form}${feed}`;
    }

    function revealHTML(v, ctx) {
        const rows = v.players
            .map((p, i) => ({ p, i }))
            .sort((a, b) => v.gain[b.i] - v.gain[a.i])
            .map(({ p, i }) => `<tr class="${v.gain[i] ? 'win' : ''}${i === v.seat ? ' me' : ''}"><td>${esc(p.name)}</td><td>${v.gain[i] ? `+${v.gain[i]}` : v.solved[i] ? '(Team)' : '–'}</td></tr>`)
            .join('');
        const ready = v.ready.includes(v.seat);
        return `<div class="wg-solution">Gesucht war: <b>${esc(v.solution)}</b></div><div class="wg-hints">${slots(v)}</div><table class="ranking"><tbody>${rows}</tbody></table>
            ${v.phase === 'over' ? '' : `<p class="center"><button class="btn primary" type="button" data-act="ready"${ready ? ' disabled' : ''}>${ready ? 'Warte auf die anderen …' : 'Weiter'}</button></p>`}`;
    }

    const game = {
        name: 'Wortraten',
        intro: () => 'Zu einem gesuchten Begriff werden nach und nach Hinweise aufgedeckt – erst ganz ungenau, dann immer deutlicher. Tippe den Begriff so früh wie möglich: Je weniger Hinweise du brauchst, desto mehr Punkte gibt es. Die ersten beiden Treffer bekommen einen Bonus. In Teams reicht ein Treffer für das ganze Team.',
        options: (v, isHost) => `<p class="muted">Begriffe pro Spiel:</p><div class="row center">${v.roundOptions.map(n => `<button class="btn${n === v.rounds ? ' primary' : ''}" type="button" data-act="setRounds" data-n="${n}"${isHost ? '' : ' disabled'}>${n}</button>`).join('')}</div>`,
        top: v => (v.phase === 'waiting' ? '' : `Begriff ${v.round} von ${v.rounds}`),
        scores: v => (v.phase === 'waiting' ? null : v.totals),
        chip: (v, seat) => ({ note: v.phase === 'play' && v.solved[seat] ? '✓' : v.phase === 'reveal' && v.ready.includes(seat) ? '✓' : '' }),
        stage(v, ctx) {
            if (v.phase === 'play') return playHTML(v, ctx);
            if (v.solution) return revealHTML(v, ctx);
            return '';
        },
        over: v => scoreOverHTML(v, v.totals),
    };

    return game;
}
