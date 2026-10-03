// Oberfläche von Stadt-Land-Fluss: Schreibphase mit Buchstabe, Auswertung mit Anzweifeln, Endwertung.
import { mountGame, esc, scoreOverHTML } from '../common/kit.js';
import { startsWithLetter } from './engine.js';

export function mountSlf(root, session) {
    // Eigene Eingaben bleiben lokal erhalten und werden kurz nach dem Tippen an den Host geschickt.
    const local = { round: -1, vals: [], timer: null, dirty: false };

    function syncVals(v) {
        if (local.round !== v.round) {
            local.round = v.round;
            local.vals = v.categories.map((_, i) => v.myAnswers?.[i] ?? '');
            local.dirty = false;
        }
    }

    function flush(ctx) {
        clearTimeout(local.timer);
        local.timer = null;
        if (!local.dirty) return;
        local.dirty = false;
        ctx.send({ t: 'answers', list: local.vals });
    }

    function writeHTML(v) {
        syncVals(v);
        const inputs = v.categories
            .map((c, i) => `<label class="slf-field"><span>${esc(c)}</span><input data-keep="c${i}" data-slf="${i}" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(local.vals[i])}" placeholder="${esc(c)} mit ${v.letter} …"></label>`)
            .join('');
        const stopInfo = v.stopper >= 0 ? `<p class="slf-alarm">${esc(v.players[v.stopper].name)} hat „Stopp“ gerufen! Schnell fertig schreiben!</p>` : '';
        const allFilled = local.vals.every(x => x.trim());
        return `<div class="slf-letter">${esc(v.letter)}</div>${stopInfo}<div class="slf-form">${inputs}</div>
            <p class="center"><button class="btn primary big" type="button" data-act="stop"${v.stopper >= 0 || !allFilled ? ' disabled' : ''}>Stopp!</button></p>
            <p class="muted center">${v.stopper >= 0 ? '' : 'Wer alles ausgefüllt hat, ruft „Stopp“. Dann haben alle noch kurz Zeit.'}</p>`;
    }

    function reviewHTML(v, ctx) {
        const over = v.phase === 'over';
        const cards = v.categories
            .map((cat, c) => {
                const rows = v.players
                    .map((p, seat) => {
                        const text = v.answers[seat][c];
                        const flags = v.flags[seat][c];
                        const valid = v.valid[seat][c];
                        const pts = v.points[seat][c];
                        const startOk = text && startsWithLetter(text, v.letter);
                        let why = '';
                        if (!text) why = 'keine Antwort';
                        else if (!startOk && !valid) why = `falscher Anfangsbuchstabe`;
                        else if (!valid) why = 'angezweifelt';
                        const mineFlag = flags.includes(v.seat);
                        const canFlag = !over && text && seat !== v.seat;
                        return `<div class="slf-ans${valid ? '' : ' bad'}${seat === v.seat ? ' me' : ''}">${ctx.avatar(seat, 20)}<span class="slf-who">${esc(p.name)}</span><span class="slf-text">${text ? esc(text) : '–'}</span>
                            <span class="slf-pts">${valid ? `+${pts}` : why}</span>
                            ${canFlag ? `<button class="slf-flag${mineFlag ? ' on' : ''}" type="button" title="Antwort anzweifeln" data-act="flag" data-p="${seat}" data-c="${c}">👎${flags.length ? ` ${flags.length}` : ''}</button>` : flags.length ? `<span class="slf-flagn">👎 ${flags.length}</span>` : ''}</div>`;
                    })
                    .join('');
                return `<div class="slf-card"><h3>${esc(cat)} mit ${esc(v.letter)}</h3>${rows}</div>`;
            })
            .join('');
        const sums = v.players.map((p, seat) => `<span class="slf-sum"><b>${esc(p.name)}</b> +${v.roundPoints[seat]}</span>`).join('');
        const ready = v.ready.includes(v.seat);
        const footer = over
            ? ''
            : `<p class="center"><button class="btn primary" type="button" data-act="ready"${ready ? ' disabled' : ''}>${ready ? 'Warte auf die anderen …' : 'Fertig, weiter'}</button><br><span class="muted">${v.ready.length} von ${v.players.length} bereit. Tippt auf 👎, wenn eine Antwort nicht passt: bei Mehrheit zählt sie nicht.</span></p>`;
        return `<div class="slf-top"><span class="slf-letter small">${esc(v.letter)}</span><span>Runde ${v.round}: Punkte dieser Runde</span></div><div class="slf-sums">${sums}</div>${cards}${footer}`;
    }

    const game = {
        name: 'Stadt-Land-Fluss',
        intro: () => 'Ein Buchstabe wird ausgelost, ihr schreibt zu jeder Kategorie ein passendes Wort mit diesem Anfangsbuchstaben. Wer fertig ist, ruft „Stopp“. Einzigartige Antworten zählen 10 Punkte, wer allein eine Antwort hat 20, gleiche Antworten 5. Unpassende Antworten kann die Gruppe anzweifeln.',
        options: (v, isHost) => {
            const rounds = v.roundOptions.map(n => `<button class="btn${n === v.rounds ? ' primary' : ''}" type="button" data-act="setRounds" data-n="${n}"${isHost ? '' : ' disabled'}>${n}</button>`).join('');
            const cats = v.allCategories.map((c, i) => `<button class="btn small${v.categories.includes(c) ? ' primary' : ''}" type="button" data-act="toggleCat" data-i="${i}"${isHost ? '' : ' disabled'}>${esc(c)}</button>`).join('');
            return `<p class="muted">Runden:</p><div class="row center">${rounds}</div><p class="muted">Kategorien (3 bis 8):</p><div class="row center wrap">${cats}</div>`;
        },
        top: v => (v.phase === 'waiting' ? '' : `Runde ${v.round} von ${v.rounds}${v.phase === 'write' ? ` · Buchstabe ${v.letter}` : ''}`),
        scores: v => (v.phase === 'waiting' ? null : v.totals),
        chip: (v, seat) => ({ note: v.phase === 'write' && v.filled[seat] ? '✓' : v.phase === 'review' && v.ready.includes(seat) ? '✓' : '' }),
        stage(v, ctx) {
            if (v.phase === 'write') return writeHTML(v);
            if (v.answers) return reviewHTML(v, ctx);
            return '';
        },
        input(target, ctx) {
            const i = target.dataset.slf;
            if (i === undefined) return;
            local.vals[Number(i)] = target.value;
            local.dirty = true;
            clearTimeout(local.timer);
            local.timer = setTimeout(() => flush(ctx), 300);
            // Stopp-Knopf freigeben, sobald alles ausgefüllt ist
            const stop = root.querySelector('[data-act="stop"]');
            if (stop && ctx.v.stopper < 0) stop.disabled = !local.vals.every(x => x.trim());
        },
        blur: (target, ctx) => flush(ctx),
        click(act, t, ctx) {
            if (act === 'stop') {
                clearTimeout(local.timer);
                local.dirty = false;
                ctx.send({ t: 'stop', list: local.vals });
                return true;
            }
            if (act === 'ready' || act === 'flag') flush(ctx);
            return false;
        },
        over: v => scoreOverHTML(v, v.totals),
        destroy() {
            clearTimeout(local.timer);
        },
    };

    return mountGame(root, session, game);
}
