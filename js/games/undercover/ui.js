// Oberfläche von Undercover / Spion: Wort ansehen, Hinweise tippen, abstimmen, Auflösung.
import { mountGame, esc } from '../common/kit.js';

export function mountUndercover(root, session) {
    const wordBox = v => {
        if (v.isSpy) return '<div class="uc-word spy">🕵️ Du bist der <b>Spion</b> – du kennst das Wort nicht!</div>';
        return `<div class="uc-word">Dein Wort: <b>${esc(v.word)}</b></div>`;
    };

    function cluesHTML(v, ctx) {
        if (!v.clues.length) return '';
        const rounds = [...new Set(v.clues.map(c => c.round))];
        return rounds
            .map(r => `<div class="uc-round"><h4>Hinweise, Runde ${r}</h4>${v.clues.filter(c => c.round === r).map(c => `<div class="uc-clue${c.seat === v.seat ? ' me' : ''}">${ctx.avatar(c.seat, 20)}<b>${esc(ctx.name(c.seat))}</b><span>${esc(c.text)}</span></div>`).join('')}</div>`)
            .join('');
    }

    const game = {
        name: 'Undercover / Spion',
        intro: v => v.mode === 'spy'
            ? 'Alle außer einer Person kennen dasselbe geheime Wort. Der Spion kennt es nicht und muss sich durchmogeln. Ihr gebt reihum Hinweise und wählt, wer der Spion ist. Wird er enttarnt, darf er noch das Wort raten.'
            : 'Alle bekommen ein Wort – bis auf eine Person, die ein ähnliches, aber anderes Wort hat. Niemand weiß, ob das eigene Wort das richtige ist! Gebt reihum Hinweise, ohne das Wort zu verraten, und wählt dann, wer das abweichende Wort hat.',
        options: (v, isHost) => `<p class="muted">Variante:</p><div class="row center">${Object.entries(v.modes).map(([k, name]) => `<button class="btn${k === v.mode ? ' primary' : ''}" type="button" data-act="setMode" data-mode="${k}"${isHost ? '' : ' disabled'}>${esc(name)}</button>`).join('')}</div>`,
        top: v => (v.phase === 'clues' ? `Hinweisrunde ${v.clueRound}` : v.phase === 'vote' ? 'Abstimmung' : ''),
        scores: v => (v.phase === 'waiting' ? null : v.wins),
        chip: (v, seat) => ({
            cls: [v.turn === seat ? 'on-turn' : '', v.alive[seat] === false ? 'out' : ''].join(' '),
            note: v.alive[seat] === false ? '✖' : v.phase === 'vote' && v.voted[seat] ? '✓' : (v.phase === 'reveal' || v.phase === 'result') && v.ready.includes(seat) ? '✓' : '',
        }),

        stage(v, ctx) {
            const dead = v.alive[v.seat] === false;
            switch (v.phase) {
                case 'reveal': {
                    const ready = v.ready.includes(v.seat);
                    return `${wordBox(v)}<p class="center">${v.mode === 'spy' ? 'Merke dir das Wort gut. Gleich gibt jeder einen Hinweis, der zeigt, dass er das Wort kennt – aber ohne es zu verraten.' : 'Merke dir dein Wort. Es kann sein, dass nur du ein anderes hast. Gleich gibt jeder einen Hinweis, ohne das Wort selbst zu nennen.'}</p>
                        <p class="center"><button class="btn primary big" type="button" data-act="ready"${ready ? ' disabled' : ''}>${ready ? 'Warte auf die anderen …' : 'Verstanden'}</button></p>`;
                }
                case 'clues': {
                    const mine = v.turn === v.seat;
                    const form = mine
                        ? `<form data-form="clue" class="uc-form"><input name="text" maxlength="30" autocomplete="off" data-keep="clue" placeholder="Dein Hinweis (ein Wort)" autofocus><button class="btn primary" type="submit">Hinweis geben</button></form>`
                        : `<p class="center"><b>${esc(ctx.name(v.turn))}</b> gibt gleich einen Hinweis …</p>`;
                    return `${dead ? '<div class="uc-word">Du bist ausgeschieden und schaust zu.</div>' : wordBox(v)}${form}${cluesHTML(v, ctx)}`;
                }
                case 'vote': {
                    const buttons = v.players
                        .map((p, i) => (v.alive[i] && i !== v.seat ? `<button class="btn uc-vote${v.myVote === i ? ' primary' : ''}" type="button" data-act="vote" data-target="${i}"${dead ? ' disabled' : ''}>${ctx.avatar(i, 22)} ${esc(p.name)}</button>` : ''))
                        .join('');
                    return `${dead ? '' : wordBox(v)}<h3 class="center">Wer hat das ${v.mode === 'spy' ? 'Wort nicht gekannt' : 'abweichende Wort'}?</h3><div class="uc-votes">${buttons}</div>
                        <p class="muted center">${dead ? 'Du darfst nicht mehr abstimmen.' : v.myVote >= 0 ? 'Du kannst deine Wahl noch ändern.' : 'Tippe auf eine Person.'} Die Abstimmung endet, wenn alle gewählt haben.</p>${cluesHTML(v, ctx)}`;
                }
                case 'result': {
                    const e = v.elim;
                    const ready = v.ready.includes(v.seat);
                    return `<div class="uc-out"><h3>${esc(ctx.name(e.seat))} fliegt raus${e.tie ? ' (Gleichstand, das Los hat entschieden)' : ''}.</h3>
                        <p>${esc(ctx.name(e.seat))} war <b>keine gesuchte Person</b>. Es geht weiter!</p>${tallyHTML(v, ctx)}</div>
                        <p class="center"><button class="btn primary" type="button" data-act="ready"${ready ? ' disabled' : ''}>${ready ? 'Warte auf die anderen …' : 'Weiter'}</button></p>${cluesHTML(v, ctx)}`;
                }
                case 'guess':
                    return `<div class="uc-out"><h3>Der Spion ist enttarnt: ${esc(ctx.name(v.elim.seat))}!</h3>${tallyHTML(v, ctx)}</div>${
                        v.isSpy
                            ? '<p class="center">Du darfst noch das geheime Wort raten. Wenn du es triffst, gewinnst du doch!</p><form data-form="guess" class="uc-form"><input name="text" maxlength="30" autocomplete="off" data-keep="guess" placeholder="Das Wort ist …"><button class="btn primary" type="submit">Raten</button></form>'
                            : '<p class="center">Der Spion darf jetzt noch das Wort raten …</p>'}`;
                case 'over':
                    return `${cluesHTML(v, ctx)}`;
                default:
                    return '';
            }
        },

        over(v, ctx) {
            const o = v.outcome;
            const youWon = (o.winner === 'imp') === (v.roles[v.seat] === 'imp');
            const rows = v.players.map((p, i) => `<tr class="${v.roles[i] === 'imp' ? 'win' : ''}"><td>${esc(p.name)}</td><td>${v.roles[i] === 'imp' ? (v.mode === 'spy' ? 'Spion' : 'Undercover') : 'Zivilist'}</td><td>${v.roles[i] === 'imp' ? (v.mode === 'spy' ? '–' : esc(v.words.imp)) : esc(v.words.civ)}</td></tr>`).join('');
            return `<h2>${youWon ? 'Ihr habt gewonnen – ' : 'Verloren – '}${o.winner === 'imp' ? (v.mode === 'spy' ? 'der Spion gewinnt' : 'der Undercover gewinnt') : 'die Gruppe gewinnt'}</h2><p>${esc(o.reason)}${o.guess ? ` (Tipp: „${esc(o.guess)}“)` : ''}</p>
                <table class="ranking"><thead><tr><th></th><th>Rolle</th><th>Wort</th></tr></thead><tbody>${rows}</tbody></table>
                ${v.mode === 'spy' ? `<p>Das Wort war: <b>${esc(v.words.civ)}</b></p>` : ''}`;
        },
    };

    function tallyHTML(v, ctx) {
        const e = v.elim;
        const lines = Object.entries(e.tally)
            .sort((a, b) => b[1] - a[1])
            .map(([seat, n]) => `<span>${esc(ctx.name(Number(seat)))}: ${n} ${n === 1 ? 'Stimme' : 'Stimmen'}</span>`)
            .join('');
        return `<div class="uc-tally">${lines || '<span>Niemand hat gewählt.</span>'}</div>`;
    }

    return mountGame(root, session, game);
}
