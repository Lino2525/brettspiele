// Oberfläche des Stufenquiz: Stufe wählen, eigene Frage beantworten, Auflösung mit Punkten.
import { esc, scoreOverHTML } from '../common/kit.js';

const LETTERS = ['A', 'B', 'C', 'D'];
// Farbverlauf der Stufen von grün (leicht) nach rot (schwer)
const levelColor = n => `hsl(${Math.round(125 - (n - 1) * (125 / 9))}, 62%, 38%)`;

export function createLadderUI() {
    function chooseHTML(v) {
        const buttons = Array.from({ length: v.maxLevel }, (_, i) => i + 1)
            .map(n => `<button class="ld-lvl${v.myChoice === n ? ' on' : ''}" type="button" style="--c:${levelColor(n)}" data-act="level" data-n="${n}"><b>${n}</b><small>${n} ${n === 1 ? 'Punkt' : 'Punkte'}</small></button>`)
            .join('');
        const mine = v.myChoice ? `<p class="center">Du hast <b>Stufe ${v.myChoice}</b> gewählt: richtig = <b>${v.myChoice}</b> ${v.myChoice === 1 ? 'Punkt' : 'Punkte'}, falsch = <b>0</b>. Du kannst noch ändern.</p>` : '<p class="center muted">Wähle, wie schwer deine Frage sein soll.</p>';
        return `<div class="ld-cat">${v.category.icon} ${esc(v.category.name)}</div><p class="center">Stufe 1 ist ganz leicht, Stufe 10 richtig schwer. Wer richtig antwortet, bekommt so viele Punkte wie die Stufe – wer falsch liegt, bekommt nichts!</p><div class="ld-levels">${buttons}</div>${mine}`;
    }

    function answerHTML(v, ctx) {
        const q = v.myQuestion;
        const done = v.myAnswer >= 0;
        const opts = q.opts.map((o, i) => `<button class="qz-opt ld-opt${v.myAnswer === i ? ' mine' : ''}" type="button" data-act="answer" data-c="${i}"${done ? ' disabled' : ''}><b>${LETTERS[i]}</b> ${esc(o)}</button>`).join('');
        const others = v.players.map((p, i) => `<span class="ld-chiplvl" style="--c:${levelColor(v.levels[i])}">${esc(p.name)}: Stufe ${v.levels[i]}${v.answered[i] ? ' ✓' : ''}</span>`).join('');
        return `<div class="ld-cat">${v.category.icon} ${esc(v.category.name)} · <span class="ld-badge" style="--c:${levelColor(q.level)}">Stufe ${q.level}</span></div>
            <div class="ld-q">${esc(q.text)}</div><div class="qz-opts">${opts}</div>
            <p class="center muted">${done ? 'Antwort abgeschickt. Warte auf die anderen …' : 'Du hast nur einen Versuch.'}</p><div class="ld-others">${others}</div>`;
    }

    function revealHTML(v, ctx) {
        const rows = v.reveal
            .map(r => `<div class="ld-rrow ${r.ok ? 'ok' : 'bad'}${r.seat === v.seat ? ' me' : ''}">
                <div class="ld-rhead">${ctx.avatar(r.seat, 22)}<b>${esc(v.players[r.seat].name)}</b><span class="ld-badge" style="--c:${levelColor(r.level)}">Stufe ${r.level}</span><span class="ld-gain">${r.ok ? `+${r.gain}` : r.answer < 0 ? 'keine Antwort' : '0'}</span></div>
                <div class="ld-rq">${esc(r.text)}</div>
                <div class="ld-ra">${r.ok ? '✔' : '✘'} Richtig: <b>${esc(r.opts[r.right])}</b>${!r.ok && r.answer >= 0 ? ` · Antwort: ${esc(r.opts[r.answer])}` : ''}</div></div>`)
            .join('');
        const ready = v.ready.includes(v.seat);
        const footer = v.phase === 'over' ? '' : `<p class="center"><button class="btn primary" type="button" data-act="ready"${ready ? ' disabled' : ''}>${ready ? 'Warte auf die anderen …' : 'Weiter'}</button><br><span class="muted">${v.ready.length} von ${v.players.length} bereit</span></p>`;
        return `<div class="ld-cat">${v.category.icon} ${esc(v.category.name)}</div>${rows}${footer}`;
    }

    const game = {
        name: 'Stufenquiz',
        intro: () => 'In jeder Runde gibt es eine Kategorie. Du wählst selbst, wie schwer deine Frage sein soll: Stufe 1 ist ganz leicht, Stufe 10 richtig schwer. Wer richtig antwortet, bekommt so viele Punkte wie die Stufe. Wer falsch antwortet, bekommt nichts – wer sich zu viel zutraut, geht leer aus!',
        options: (v, isHost) => `<p class="muted">Runden:</p><div class="row center">${v.roundOptions.map(n => `<button class="btn${n === v.rounds ? ' primary' : ''}" type="button" data-act="setRounds" data-n="${n}"${isHost ? '' : ' disabled'}>${n}</button>`).join('')}</div>`,
        top: v => (v.phase === 'waiting' ? '' : `Runde ${v.round} von ${v.rounds}`),
        scores: v => (v.phase === 'waiting' ? null : v.totals),
        chip: (v, seat) => ({ note: v.phase === 'choose' && v.chosen[seat] ? '✓' : v.phase === 'answer' && v.answered[seat] ? '✓' : v.phase === 'reveal' && v.ready.includes(seat) ? '✓' : '' }),
        stage(v, ctx) {
            if (v.phase === 'choose') return chooseHTML(v);
            if (v.phase === 'answer') return answerHTML(v, ctx);
            if (v.reveal) return revealHTML(v, ctx);
            return '';
        },
        over: v => scoreOverHTML(v, v.totals),
    };

    return game;
}
