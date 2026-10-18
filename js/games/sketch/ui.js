// Oberfläche von Kritzelrennen: Zeichenblatt mit Werkzeugen, Rateeingabe, Würfel und Spielbrett mit Figuren.
// Rahmen (Punktetafel, Warteraum mit Teams, Ergebnisfenster, Zeitanzeige) kommt aus common/kit.js. Die Spielfläche
// bleibt als festes Gerüst stehen, damit Zeichenblatt, Würfel und Figuren nicht bei jeder Ansicht neu entstehen.
import { mountGame, esc, setHTML, PLAYER_COLORS, TEAM_COLORS } from '../common/kit.js';
import { DIE_HTML, turnDie } from '../../core/dice.js';
import { CATEGORIES, PEN_WIDTHS } from './engine.js';

// Stiftfarben auf hellem Papier; die letzte ist der Radierer (Papierfarbe)
const PAPER = '#f7f3e8';
const PENS = ['#1b2440', '#e8365a', '#2f6bff', '#13a06c', '#f2a516', '#8b5a2b', PAPER];
const PEN_NAMES = ['Schwarz', 'Rot', 'Blau', 'Grün', 'Gelb', 'Braun', 'Radierer'];
const W = 800; // Zeichenfläche in Pixeln, Koordinaten laufen von 0 bis 1000
const H = 600;
const HOP_MS = 230;

const SKELETON = `<div class="sk">
  <section class="sk-turn">
    <div class="sk-head"></div>
    <div class="sk-paper"><canvas width="${W}" height="${H}"></canvas><div class="sk-veil" hidden></div></div>
    <div class="sk-ctl"></div>
    <div class="sk-dice" hidden><div class="pdice">${DIE_HTML}</div></div>
    <div class="sk-feed"></div>
  </section>
  <section class="sk-side">
    <div class="sk-board"><svg class="sk-path" preserveAspectRatio="none"></svg><div class="sk-cells"></div><div class="sk-tokens"></div></div>
    <div class="sk-legend"></div>
  </section>
</div>`;

const catChip = (cat, all) => `<span class="sk-cat" style="--cc:${CATEGORIES[cat].color}">${esc(CATEGORIES[cat].name)}</span>${all ? '<span class="sk-all">★ Alle zeichnen</span>' : ''}`;

// Schlangenlinie über ein quadratisches Raster: 25 Felder 5 x 5, 37 Felder 6 x 7, 49 Felder 7 x 7
function layout(n) {
    const cols = Math.ceil(Math.sqrt(n)) - (n === 37 ? 1 : 0);
    const rows = Math.ceil(n / cols);
    const cells = Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / cols);
        const k = i % cols;
        return { col: row % 2 ? cols - 1 - k : k, row: rows - 1 - row };
    });
    return { cols, rows, cells };
}

export function createSketchUI() {
    let el = null; // Teile des Gerüsts
    let g = null;
    let boardSig = '';
    let grid = null;
    const shown = new Map(); // Figur -> angezeigtes Feld (hüpft Feld für Feld zum Ziel)
    let hopTimer = 0;
    let target = [];
    let tokenSig = '';
    let bigTokens = false; // Teamfiguren sind größer und brauchen mehr Abstand
    // Zeichenstand
    let paintKey = '';
    let strokes = []; // eigene Striche (Zeichner) bzw. zuletzt gezeigte (Ratende)
    let drawing = false; // darf diese Person gerade zeichnen?
    let current = null;
    let sid = 0;
    let pen = 0;
    let width = PEN_WIDTHS[1];
    let pending = null;
    let flushTimer = 0;
    let send = () => {};
    let dieKey = '';
    let ctxRef = null;

    // ---------- Zeichenblatt ----------

    function line(s) {
        g.strokeStyle = PENS[s.c] ?? PENS[0];
        g.lineWidth = (s.w * W) / 1000;
        g.beginPath();
        g.moveTo((s.p[0] * W) / 1000, (s.p[1] * H) / 1000);
        if (s.p.length === 2) g.lineTo((s.p[0] * W) / 1000 + 0.1, (s.p[1] * H) / 1000);
        for (let i = 2; i < s.p.length; i += 2) g.lineTo((s.p[i] * W) / 1000, (s.p[i + 1] * H) / 1000);
        g.stroke();
    }

    function paint(list) {
        g.fillStyle = PAPER;
        g.fillRect(0, 0, W, H);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (const s of list) line(s);
    }

    function flush() {
        if (!pending || pending.p.length < 2) return;
        const p = pending.p;
        send({ t: 'stroke', sid: pending.sid, c: pending.c, w: pending.w, p });
        // Das nächste Stück beginnt am letzten Punkt, damit die Linie nicht abreißt
        pending.p = [p[p.length - 2], p[p.length - 1]];
        pending.sent = true;
    }

    function setupCanvas(canvas) {
        g = canvas.getContext('2d');
        paint([]);
        const pos = e => {
            const r = canvas.getBoundingClientRect();
            const clamp = x => Math.round(Math.min(1000, Math.max(0, x * 1000)));
            return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
        };
        canvas.addEventListener('pointerdown', e => {
            if (!drawing) return;
            e.preventDefault();
            canvas.setPointerCapture?.(e.pointerId);
            const [x, y] = pos(e);
            current = { sid: ++sid, c: pen, w: width, p: [x, y] };
            strokes.push(current);
            pending = { sid: current.sid, c: pen, w: width, p: [x, y], sent: false };
            line(current);
            clearInterval(flushTimer);
            flushTimer = setInterval(flush, 250);
        });
        canvas.addEventListener('pointermove', e => {
            if (!current) return;
            const [x, y] = pos(e);
            const n = current.p.length;
            if (Math.hypot(x - current.p[n - 2], y - current.p[n - 1]) < 6) return;
            g.strokeStyle = PENS[current.c];
            g.lineWidth = (current.w * W) / 1000;
            g.beginPath();
            g.moveTo((current.p[n - 2] * W) / 1000, (current.p[n - 1] * H) / 1000);
            g.lineTo((x * W) / 1000, (y * H) / 1000);
            g.stroke();
            current.p.push(x, y);
            pending.p.push(x, y);
            if (pending.p.length >= 400) flush();
        });
        const end = () => {
            if (!current) return;
            clearInterval(flushTimer);
            // Ein einzelner Tupfer wird als kurzer Strich verschickt
            if (pending.p.length === 2 && !pending.sent) pending.p.push(pending.p[0], pending.p[1]);
            flush();
            pending = null;
            current = null;
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    }

    function updatePaper(v) {
        const t = v.turn;
        const mine = t.role === 'draw';
        drawing = mine && v.phase === 'draw';
        el.paper.classList.toggle('live', drawing);
        el.paper.style.setProperty('--pen', PENS[pen]);
        const key = `${t.no}:${t.canvas.seat}`;
        if (key !== paintKey) {
            // Neuer Begriff oder andere Zeichnung: vom Stand des Hosts ausgehen
            paintKey = key;
            strokes = t.canvas.strokes.map(s => ({ ...s, p: [...s.p] }));
            sid = strokes.reduce((m, s) => Math.max(m, s.sid), 0);
            current = null;
            pending = null;
            paint(strokes);
            el.paper.dataset.version = t.canvas.version;
        } else if (!mine && String(t.canvas.version) !== el.paper.dataset.version) {
            strokes = t.canvas.strokes;
            paint(strokes);
            el.paper.dataset.version = t.canvas.version;
        }
        const veil = v.phase === 'choose' ? (mine ? 'Such dir einen Begriff aus' : `${esc(ctxRef.name(t.drawer))} sucht sich einen Begriff aus …`) : '';
        el.veil.hidden = !veil;
        el.veil.innerHTML = veil;
    }

    function undo() {
        const last = strokes[strokes.length - 1];
        if (!last) return;
        strokes = strokes.filter(s => s.sid !== last.sid);
        paint(strokes);
        send({ t: 'undo' });
    }

    function clearPaper() {
        strokes = [];
        paint(strokes);
        send({ t: 'clear' });
    }

    // ---------- Kopf, Steuerung, Rateliste ----------

    const unitName = (v, unit, ctx) => (v.teamMode ? v.teamNames[unit] : unit === v.seat ? 'Du' : ctx.name(unit));
    const isMyUnit = (v, unit) => (v.teamMode ? v.players[v.seat]?.team === unit : unit === v.seat);

    function headHTML(v, ctx) {
        const t = v.turn;
        const cat = catChip(t.cat, t.all);
        if (v.phase === 'choose') {
            return `<div class="sk-line">${ctx.avatar(t.drawer, 26)}<span>${t.drawer === v.seat ? '<b>Du zeichnest!</b>' : `<b>${esc(ctx.name(t.drawer))}</b> zeichnet`}</span>${cat}</div>`;
        }
        if (v.phase === 'draw') {
            if (t.role === 'draw') return `<div class="sk-line"><span>Zeichne:</span><b class="sk-word">${esc(t.word)}</b>${cat}</div>`;
            const who = t.drawers.length > 1 ? 'Beide Teams zeichnen' : `${esc(ctx.name(t.drawer))} zeichnet`;
            return `<div class="sk-line"><span>${who}</span>${cat}</div><div class="sk-mask">${esc(t.mask)}</div>`;
        }
        return `<div class="sk-line"><span>Gesucht war:</span><b class="sk-word">${esc(t.word ?? '')}</b>${cat}</div>`;
    }

    function toolsHTML(v) {
        const t = v.turn;
        const pens = PENS.map((c, i) => `<button type="button" class="sk-pen${i === pen ? ' on' : ''}${i === PENS.length - 1 ? ' eraser' : ''}" data-act="pen" data-c="${i}" style="--c:${c}" title="${PEN_NAMES[i]}" aria-label="${PEN_NAMES[i]}"></button>`).join('');
        const widths = PEN_WIDTHS.map(w => `<button type="button" class="sk-width${w === width ? ' on' : ''}" data-act="width" data-w="${w}" aria-label="Strichstärke ${w}"><i style="--w:${Math.max(3, Math.round(w * 0.75))}px"></i></button>`).join('');
        const out = t.out.includes(v.players[v.seat]?.team) && v.teamMode;
        return `<div class="sk-tools"><div class="sk-pens">${pens}</div><div class="sk-widths">${widths}</div>
            <div class="sk-acts"><button type="button" class="btn small" data-act="undo">↶ Zurück</button><button type="button" class="btn small" data-act="wipe">Blatt leeren</button><button type="button" class="btn small ghost" data-act="giveUp"${out ? ' disabled' : ''}>Aufgeben</button></div></div>
            <p class="muted sk-rule">Keine Buchstaben, keine Zahlen, nicht sprechen. Nur zeichnen!</p>`;
    }

    function ctlHTML(v, ctx) {
        const t = v.turn;
        if (v.phase === 'choose') {
            if (t.options) return `<div class="sk-choose">${t.options.map((w, i) => `<button type="button" class="sk-card" data-act="choose" data-i="${i}" style="--cc:${CATEGORIES[t.cat].color}"><small>${esc(CATEGORIES[t.cat].name)}</small><b>${esc(w)}</b></button>`).join('')}</div>`;
            return `<p class="muted center">${t.all && v.teamMode ? 'Alle-Feld: Gleich zeichnen beide Teams denselben Begriff, das schnellere Team gewinnt den Zug.' : 'Gleich geht es los, haltet die Finger bereit.'}</p>`;
        }
        if (v.phase === 'draw') {
            if (t.role === 'draw') return toolsHTML(v);
            if (t.role === 'guess') {
                if (t.correct.includes(v.seat)) return '<p class="sk-right center">✔ Richtig! Warte auf die anderen …</p>';
                return `<form data-form="guess" class="sk-guess"><input name="text" maxlength="40" autocomplete="off" autocapitalize="off" data-keep="guess" placeholder="Was wird gezeichnet?" enterkeyhint="send"><button class="btn primary" type="submit">Raten</button></form>`;
            }
            return `<p class="muted center">${esc(v.teamNames[t.unit])} ist dran. Ihr schaut zu – nicht vorsagen!</p>`;
        }
        // Auflösung
        const solvers = t.correct.map(seat => `${ctx.avatar(seat, 20)} ${esc(ctx.name(seat))}`).join(', ');
        let html = t.result === 'solved'
            ? `<p class="sk-res ok">${v.teamMode ? `${esc(v.teamNames[t.solvedUnit])} hat es erraten` : 'Erraten von'}: ${solvers}</p>`
            : `<p class="sk-res bad">Niemand hat es erraten.${v.teamMode ? ` Jetzt ist ${esc(v.teamNames[1 - t.unit])} dran.` : ''}</p>`;
        if (t.rollPending) {
            html += isMyUnit(v, t.roller)
                ? '<p class="center"><button type="button" class="btn primary big sk-roll" data-act="roll">Würfeln</button></p>'
                : `<p class="muted center">${esc(unitName(v, t.roller, ctx))} würfelt …</p>`;
        } else if (t.moves.length) {
            html += `<p class="sk-moves">${t.moves.map(m => `<span>${esc(unitName(v, m.unit, ctx))} <b>+${m.steps}</b></span>`).join('')}</p>`;
        }
        return html;
    }

    function feedHTML(v, ctx) {
        const t = v.turn;
        if (!t.feed.length) return '';
        return t.feed.slice(-6).reverse().map(f => (f.ok
            ? `<div class="ok">${ctx.avatar(f.seat, 18)} ${esc(ctx.name(f.seat))} hat es!</div>`
            : `<div>${ctx.avatar(f.seat, 18)} <span class="muted">${esc(ctx.name(f.seat))}:</span> ${esc(f.text)}</div>`)).join('');
    }

    // ---------- Würfel ----------

    function updateDie(v) {
        const t = v.turn;
        const show = v.phase === 'reveal' && t.result === 'solved';
        el.dice.hidden = !show;
        if (!show) return;
        const die = el.dice.querySelector('.pdie');
        const key = `${t.no}:${t.roll}`;
        if (key === dieKey) return;
        // Gerade gewürfelt: sichtbar rollen; wer erst danach dazukommt, sieht nur das Ergebnis
        const rolledNow = dieKey === `${t.no}:0`;
        dieKey = key;
        el.dice.classList.toggle('waiting', !t.roll);
        if (t.roll) turnDie(die, t.roll, rolledNow ? { roll: true } : { instant: true });
        else turnDie(die, 0, { instant: true });
    }

    // ---------- Spielbrett ----------

    function buildBoard(v) {
        const n = v.board.length;
        grid = layout(n);
        const { cols, rows, cells } = grid;
        el.board.style.setProperty('--cols', cols);
        el.board.style.setProperty('--rows', rows);
        el.board.style.aspectRatio = `${cols} / ${rows}`;
        el.svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
        el.svg.innerHTML = `<polyline points="${cells.map(c => `${c.col + 0.5},${c.row + 0.5}`).join(' ')}"/>`;
        el.cells.innerHTML = v.board.map((f, i) => {
            const c = cells[i];
            const label = f.start ? 'Start' : f.goal ? 'Ziel' : f.cat;
            const cls = ['sk-cell', f.start ? 'start' : '', f.goal ? 'goal' : '', f.all ? 'all' : ''].filter(Boolean).join(' ');
            return `<div class="${cls}" style="grid-column:${c.col + 1};grid-row:${c.row + 1};--cc:${CATEGORIES[f.cat].color}" title="Feld ${i}: ${esc(CATEGORIES[f.cat].name)}${f.all ? ', Alle zeichnen' : ''}"><span>${label}</span>${f.all ? '<i>★</i>' : ''}</div>`;
        }).join('');
        el.legend.innerHTML = Object.entries(CATEGORIES).map(([k, c]) => `<span class="sk-leg" style="--cc:${c.color}"><b>${k}</b>${esc(c.name)}</span>`).join('') + '<span class="sk-leg all"><b>★</b>Alle zeichnen</span>';
        shown.clear();
        el.tokens.innerHTML = '';
        tokenSig = '';
    }

    function placeTokens(v, ctx) {
        const units = v.teamMode ? [0, 1] : v.players.map((p, i) => i);
        const sig = `${v.teamMode}:${units.length}:${ctx.avatars().map(a => (a ? a.length : 0)).join(',')}`;
        if (sig !== tokenSig) {
            tokenSig = sig;
            el.tokens.innerHTML = units.map(u => {
                const color = v.teamMode ? TEAM_COLORS[u] : PLAYER_COLORS[u];
                const img = v.teamMode ? null : ctx.avatars()[u];
                const label = v.teamMode ? v.teamNames[u].replace('Team ', '').slice(0, 1) : v.players[u].name.slice(0, 1).toUpperCase();
                return `<i class="sk-token${v.teamMode ? ' team' : ''}" data-u="${u}" style="--tc:${color}${img ? `;background-image:url('${img}')` : ''}">${img ? '' : esc(label)}</i>`;
            }).join('');
        }
        bigTokens = !!v.teamMode;
        target = units.map(u => v.pos[u] ?? 0);
        units.forEach(u => {
            // Figuren laufen nur vorwärts; zurück geht es nur beim Neustart, dann ohne Hüpfen
            if (!shown.has(u) || target[u] < shown.get(u)) shown.set(u, target[u]);
        });
        const turnUnit = v.turn?.unit;
        el.tokens.querySelectorAll('.sk-token').forEach(tok => tok.classList.toggle('turn', Number(tok.dataset.u) === turnUnit && v.phase !== 'over'));
        drawTokens();
        if (!hopTimer && units.some(u => shown.get(u) !== target[u])) hopTimer = setTimeout(hop, HOP_MS);
    }

    function hop() {
        hopTimer = 0;
        let moving = false;
        for (const [u, at] of shown) {
            if (at === target[u]) continue;
            shown.set(u, at + Math.sign(target[u] - at));
            moving = true;
            const tok = el.tokens.querySelector(`[data-u="${u}"]`);
            if (tok) {
                tok.classList.remove('hop');
                void tok.offsetWidth;
                tok.classList.add('hop');
            }
        }
        drawTokens();
        if (moving) hopTimer = setTimeout(hop, HOP_MS);
    }

    function drawTokens() {
        if (!grid) return;
        const at = new Map();
        for (const [u, f] of shown) at.set(f, [...(at.get(f) || []), u]);
        for (const [f, list] of at) {
            const c = grid.cells[Math.min(f, grid.cells.length - 1)];
            list.forEach((u, k) => {
                const tok = el.tokens.querySelector(`[data-u="${u}"]`);
                if (!tok) return;
                const spread = list.length > 1 ? (bigTokens ? 0.26 : 0.22) : 0;
                const a = (k / list.length) * Math.PI * 2 - Math.PI / 2;
                tok.style.left = `${((c.col + 0.5 + Math.cos(a) * spread) / grid.cols) * 100}%`;
                tok.style.top = `${((c.row + 0.5 + Math.sin(a) * spread) / grid.rows) * 100}%`;
            });
        }
        el.cells.querySelectorAll('.sk-cell.lit').forEach(c => c.classList.remove('lit'));
        for (const f of at.keys()) el.cells.children[f]?.classList.add('lit');
    }

    // ---------- Ergebnis ----------

    function overHTML(v, ctx) {
        const last = v.board.length - 1;
        const units = v.teamMode ? [0, 1] : v.players.map((p, i) => i);
        const sorted = units.map(u => ({ u, pos: v.pos[u] })).sort((a, b) => b.pos - a.pos);
        const winners = v.winners;
        const title = winners.length > 1
            ? `${winners.map(u => esc(unitName(v, u, ctx))).join(' und ')} gewinnen!`
            : v.teamMode ? `${esc(v.teamNames[winners[0]])} gewinnt!` : winners[0] === v.seat ? 'Du hast gewonnen!' : `${esc(ctx.name(winners[0]))} hat gewonnen!`;
        const rows = sorted.map(r => `<tr class="${winners.includes(r.u) ? 'win' : ''}${isMyUnit(v, r.u) ? ' me' : ''}"><td>${v.teamMode ? `<span style="color:${TEAM_COLORS[r.u]}">${esc(v.teamNames[r.u])}</span>` : `${ctx.avatar(r.u, 20)} ${esc(ctx.name(r.u))}`}</td><td>${r.pos === last ? 'Ziel' : `Feld ${r.pos}`}</td></tr>`).join('');
        const word = v.turn?.word ? `<p>Letzter Begriff: <b>${esc(v.turn.word)}</b></p>` : '';
        return `<h2>${title}</h2>${word}<table class="ranking"><tbody>${rows}</tbody></table>`;
    }

    // ---------- Anbindung an den Rahmen ----------

    return {
        name: 'Kritzelrennen',
        intro: () => 'Wer zeichnet, sucht sich einen von zwei Begriffen aus und zeichnet ihn, die anderen raten. Die Feldfarbe unter der eigenen Figur bestimmt die Kategorie. Einzeln: Klappt es, würfelt die zeichnende Person und zieht vor, wer zuerst rät, zieht 2 Felder, jeder weitere Treffer 1 Feld. In Teams rät nur das eigene Team, bei Erfolg würfelt es und zeichnet weiter. Auf ★-Feldern zeichnen in Teams beide Teams gleichzeitig. Wer zuerst im Ziel ist, gewinnt.',
        options: (v, isHost) => {
            const names = { 25: 'Kurz', 37: 'Mittel', 49: 'Lang' };
            const btns = (list, cur, act, label) => list.map(n => `<button class="btn${n === cur ? ' primary' : ''}" type="button" data-act="${act}" data-n="${n}"${isHost ? '' : ' disabled'}>${label(n)}</button>`).join('');
            return `<p class="muted">Spielbrett:</p><div class="row center">${btns(v.lengthOptions, v.length, 'setLength', n => `${names[n] ?? ''} (${n})`)}</div>
                <p class="muted">Zeit zum Zeichnen:</p><div class="row center">${btns(v.timeOptions, v.drawSec, 'setTime', n => `${n} s`)}</div>`;
        },
        top: v => {
            if (!v.turn || v.phase === 'over') return '';
            if (v.teamMode) return `${v.teamNames[v.turn.unit]} ist dran${v.streak > 1 ? ` · ${v.streak}. Begriff in Folge` : ''}`;
            return `Ziel: Feld ${v.board.length - 1}`;
        },
        scores: v => (v.phase === 'waiting' || v.teamMode ? null : v.pos),
        chip: (v, seat) => {
            const t = v.turn;
            if (!t || v.phase === 'waiting' || v.phase === 'over') return {};
            if (t.drawers.includes(seat)) return { cls: 'on-turn', note: '✏️' };
            return { note: t.correct.includes(seat) ? '✓' : '' };
        },
        stage: () => SKELETON,
        over: overHTML,
        click(act, target, ctx) {
            send = ctx.send;
            if (act === 'pen') {
                pen = Number(target.dataset.c);
                if (pen === PENS.length - 1 && width < PEN_WIDTHS[2]) width = PEN_WIDTHS[2];
                ctx.rerender();
                return true;
            }
            if (act === 'width') {
                width = Number(target.dataset.w);
                ctx.rerender();
                return true;
            }
            if (act === 'undo') {
                undo();
                return true;
            }
            if (act === 'wipe') {
                clearPaper();
                return true;
            }
            return false;
        },
        update(v, ctx, stage) {
            ctxRef = ctx;
            send = ctx.send;
            const root = stage.querySelector('.sk');
            if (!root) return;
            if (!el || el.root !== root) {
                el = {
                    root,
                    head: root.querySelector('.sk-head'),
                    paper: root.querySelector('.sk-paper'),
                    veil: root.querySelector('.sk-veil'),
                    ctl: root.querySelector('.sk-ctl'),
                    dice: root.querySelector('.sk-dice'),
                    feed: root.querySelector('.sk-feed'),
                    board: root.querySelector('.sk-board'),
                    svg: root.querySelector('.sk-path'),
                    cells: root.querySelector('.sk-cells'),
                    tokens: root.querySelector('.sk-tokens'),
                    legend: root.querySelector('.sk-legend'),
                };
                setupCanvas(root.querySelector('canvas'));
                paintKey = '';
                boardSig = '';
                dieKey = '';
            }
            if (!v.turn || !v.board.length) return;
            const sig = `${v.board.length}`;
            if (sig !== boardSig) {
                boardSig = sig;
                buildBoard(v);
            }
            root.classList.toggle('drawing', v.turn.role === 'draw' && v.phase === 'draw');
            setHTML(el.head, headHTML(v, ctx));
            setHTML(el.ctl, ctlHTML(v, ctx));
            setHTML(el.feed, feedHTML(v, ctx));
            updatePaper(v);
            updateDie(v);
            placeTokens(v, ctx);
        },
        destroy() {
            clearInterval(flushTimer);
            clearTimeout(hopTimer);
        },
    };
}

export function mountSketch(root, session) {
    return mountGame(root, session, createSketchUI());
}
