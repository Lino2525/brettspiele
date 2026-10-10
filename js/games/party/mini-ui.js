// Oberflächen der Minispiele von Sternenjagd (bewusst schlicht).
// Jedes Spiel bekommt einen Container, die Spieldaten vom Host (mini) und eine kleine Schnittstelle:
//   api.seat           eigener Platz
//   api.remaining()    verbleibende Millisekunden bis zum Ende der Spielphase
//   api.submit(score)  Ergebnis melden (bei Geschicklichkeitsspielen, nur einmal)
//   api.send(payload)  Aktion an den Host (Quiz, Zeichnen)
// Rückgabe: { update(mini), destroy() }

import { mountGame } from '../common/kit.js';
import { createSlfUI } from '../slf/ui.js';
import { createUndercoverUI } from '../undercover/ui.js';
import { createLadderUI } from '../ladder/ui.js';
import { createWordGuessUI } from '../wordguess/ui.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Zufallszahlen aus einem Startwert: alle Spieler bekommen dieselben Aufgaben
function mulberry32(a) {
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const wait = (box, text) => {
    box.querySelector('.mg-wait')?.remove();
    const d = document.createElement('div');
    d.className = 'mg-wait';
    d.textContent = text;
    box.appendChild(d);
};

// Gemeinsames Gerüst für Geschicklichkeitsspiele: meldet das Ergebnis genau einmal, auch bei Zeitablauf
function solo(box, api, start) {
    let done = false;
    const timers = new Set();
    let raf = 0;
    const later = (fn, ms) => {
        const id = setTimeout(() => {
            timers.delete(id);
            fn();
        }, ms);
        timers.add(id);
    };
    const finish = score => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        api.submit(Math.max(0, Math.round(score)));
        wait(box, `Fertig: ${Math.max(0, Math.round(score))} Punkte. Warte auf die anderen …`);
    };
    const ctl = {
        later,
        finish,
        get done() {
            return done;
        },
        frame(fn) {
            const loop = now => {
                if (done) return;
                fn(now);
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
        },
    };
    const guard = setInterval(() => {
        if (!done && api.remaining() <= 0) ctl.onTimeout?.();
    }, 200);
    const instance = start(ctl) || {};
    return {
        update() {},
        destroy() {
            done = true;
            clearInterval(guard);
            cancelAnimationFrame(raf);
            timers.forEach(clearTimeout);
            instance.destroy?.();
        },
    };
}

// ---------- Volltreffer: im richtigen Moment tippen ----------

function timing(box, mini, api) {
    return solo(box, api, ctl => {
        const rng = mulberry32(mini.params.seed);
        const tries = [0, 1, 2].map(i => ({ speed: 0.85 + i * 0.4 + rng() * 0.15, center: 0.25 + rng() * 0.5, width: 0.16 - i * 0.03 }));
        box.innerHTML = `<div class="tm-info"></div><div class="tm-bar"><i class="tm-zone"></i><i class="tm-mark"></i></div>
            <button class="btn primary big tm-btn" type="button">Jetzt!</button><div class="tm-res"></div>`;
        const info = box.querySelector('.tm-info');
        const zone = box.querySelector('.tm-zone');
        const mark = box.querySelector('.tm-mark');
        const res = box.querySelector('.tm-res');
        let idx = 0;
        let total = 0;
        let t0 = performance.now();
        let locked = false;
        const setup = () => {
            const tr = tries[idx];
            zone.style.left = `${(tr.center - tr.width / 2) * 100}%`;
            zone.style.width = `${tr.width * 100}%`;
            info.textContent = `Versuch ${idx + 1} von 3 · ${total} Punkte`;
            t0 = performance.now();
        };
        const posAt = now => {
            const x = (((now - t0) / 1000) * tries[idx].speed) % 2;
            return x <= 1 ? x : 2 - x;
        };
        const tap = () => {
            if (ctl.done || locked) return;
            const tr = tries[idx];
            const dist = Math.abs(posAt(performance.now()) - tr.center);
            const half = tr.width / 2;
            const pts = dist <= half ? Math.round(70 + 30 * (1 - dist / half)) : Math.max(0, Math.round(70 * (1 - (dist - half) / 0.2)));
            total += pts;
            res.textContent = pts >= 90 ? `Volltreffer! +${pts}` : pts > 0 ? `+${pts}` : 'Daneben!';
            idx++;
            if (idx >= 3) {
                info.textContent = `Gesamt: ${total} Punkte`;
                ctl.finish(total);
            } else {
                locked = true;
                ctl.later(() => {
                    locked = false;
                    res.textContent = '';
                    setup();
                }, 800);
            }
        };
        box.querySelector('.tm-btn').addEventListener('pointerdown', e => {
            e.preventDefault();
            tap();
        });
        setup();
        ctl.frame(now => (mark.style.left = `${posAt(now) * 100}%`));
        ctl.onTimeout = () => ctl.finish(total);
    });
}

// ---------- Korbwurf ----------

function hoops(box, mini, api) {
    return solo(box, api, ctl => {
        box.innerHTML = '<div class="hp-info">Treffer: 0</div><canvas class="hp-canvas" width="300" height="400"></canvas><div class="hp-hint">Tippe zum Werfen</div>';
        const info = box.querySelector('.hp-info');
        const canvas = box.querySelector('canvas');
        const g = canvas.getContext('2d');
        const W = 300;
        const H = 400;
        const FLIGHT = 450;
        let baskets = 0;
        let shots = 0;
        let ball = null; // { t0, hit }
        let flash = 0;
        const t0 = performance.now();
        const speed = () => Math.min(3.4, 1.3 + baskets * 0.2);
        let phase = 0;
        let last = t0;
        const hoopX = now => {
            // Phase so fortschreiben, dass sich ein höheres Tempo nicht sprunghaft auswirkt
            return W / 2 + 105 * Math.sin(phaseAt(now));
        };
        function phaseAt(now) {
            phase += ((now - last) / 1000) * speed();
            last = now;
            return phase;
        }
        let hx = W / 2;
        const shoot = () => {
            if (ctl.done || ball) return;
            const now = performance.now();
            // Wo ist der Korb, wenn der Ball oben ankommt? (gleiches Tempo vorausberechnet)
            const future = phase + ((FLIGHT / 1000) * speed());
            const x = W / 2 + 105 * Math.sin(future);
            ball = { t0: now, hit: Math.abs(x - W / 2) <= 32 };
            shots++;
        };
        canvas.addEventListener('pointerdown', e => {
            e.preventDefault();
            shoot();
        });
        ctl.frame(now => {
            hx = hoopX(now);
            g.clearRect(0, 0, W, H);
            g.fillStyle = '#0a0d14';
            g.fillRect(0, 0, W, H);
            // Korb
            g.strokeStyle = '#ff9a00';
            g.lineWidth = 6;
            g.beginPath();
            g.moveTo(hx - 36, 90);
            g.lineTo(hx + 36, 90);
            g.stroke();
            g.strokeStyle = 'rgba(5,217,232,.7)';
            g.lineWidth = 2;
            for (let k = -3; k <= 3; k++) {
                g.beginPath();
                g.moveTo(hx + k * 12, 90);
                g.lineTo(hx + k * 7, 130);
                g.stroke();
            }
            // Ball
            let by = H - 50;
            if (ball) {
                const p = (now - ball.t0) / FLIGHT;
                if (p >= 1) {
                    if (ball.hit) {
                        baskets++;
                        flash = now;
                    }
                    ball = null;
                    info.textContent = `Treffer: ${baskets}`;
                } else {
                    by = H - 50 - (H - 140) * p;
                }
            }
            g.fillStyle = '#ff2a6d';
            g.beginPath();
            g.arc(W / 2, by, 13, 0, Math.PI * 2);
            g.fill();
            if (now - flash < 400) {
                g.fillStyle = '#39ff14';
                g.font = 'bold 34px system-ui';
                g.textAlign = 'center';
                g.fillText('Treffer!', W / 2, 220);
            }
        });
        ctl.onTimeout = () => ctl.finish(baskets * 100);
        // Zeitablauf auch ohne weiteren Tipp melden
        ctl.later(() => ctl.finish(baskets * 100), Math.max(0, api.remaining() - 500));
        void shots;
    });
}

// ---------- Blitzreaktion ----------

function reaction(box, mini, api) {
    return solo(box, api, ctl => {
        const rng = mulberry32(mini.params.seed);
        box.innerHTML = '<div class="rx-pad" role="button" tabindex="0"><strong class="rx-text">Gleich geht’s los …</strong><small class="rx-sub"></small></div><div class="rx-info"></div>';
        const pad = box.querySelector('.rx-pad');
        const text = box.querySelector('.rx-text');
        const sub = box.querySelector('.rx-sub');
        const info = box.querySelector('.rx-info');
        let tryNo = 0;
        let total = 0;
        let state = 'idle'; // idle | wait | go | pause
        let goAt = 0;
        const delays = [0, 1, 2].map(() => 1200 + rng() * 2400);
        const next = () => {
            if (tryNo >= 3) {
                text.textContent = `Gesamt: ${total} Punkte`;
                ctl.finish(total);
                return;
            }
            state = 'wait';
            pad.className = 'rx-pad wait';
            text.textContent = 'Warten …';
            sub.textContent = 'Nicht zu früh tippen!';
            info.textContent = `Versuch ${tryNo + 1} von 3 · ${total} Punkte`;
            ctl.later(() => {
                if (state !== 'wait') return;
                state = 'go';
                goAt = performance.now();
                pad.className = 'rx-pad go';
                text.textContent = 'JETZT!';
                sub.textContent = '';
            }, delays[tryNo]);
        };
        const tap = () => {
            if (ctl.done) return;
            if (state === 'wait') {
                state = 'pause';
                pad.className = 'rx-pad early';
                text.textContent = 'Zu früh!';
                sub.textContent = '0 Punkte';
                tryNo++;
                ctl.later(next, 1200);
            } else if (state === 'go') {
                const ms = Math.round(performance.now() - goAt);
                const pts = Math.max(0, 600 - ms);
                total += pts;
                state = 'pause';
                pad.className = 'rx-pad done';
                text.textContent = `${ms} ms`;
                sub.textContent = `+${pts}`;
                tryNo++;
                ctl.later(next, 1200);
            }
        };
        pad.addEventListener('pointerdown', e => {
            e.preventDefault();
            tap();
        });
        ctl.later(next, 800);
        ctl.onTimeout = () => ctl.finish(total);
    });
}

// ---------- Tipp-Marathon ----------

function tapping(box, mini, api) {
    return solo(box, api, ctl => {
        box.innerHTML = '<div class="tp-count">0</div><button class="btn primary big tp-btn" type="button">TIPPEN!</button><div class="tp-time">Tippe los, die Zeit startet beim ersten Tipp.</div>';
        const countEl = box.querySelector('.tp-count');
        const btn = box.querySelector('.tp-btn');
        const timeEl = box.querySelector('.tp-time');
        let taps = 0;
        let started = 0;
        let ticker = 0;
        const end = () => {
            clearInterval(ticker);
            btn.disabled = true;
            ctl.finish(taps);
        };
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (ctl.done || btn.disabled) return;
            if (!started) {
                started = performance.now();
                ticker = setInterval(() => {
                    const left = 8000 - (performance.now() - started);
                    timeEl.textContent = `Noch ${Math.max(0, left / 1000).toFixed(1)} s`;
                    if (left <= 0) end();
                }, 100);
            }
            taps++;
            countEl.textContent = taps;
        });
        ctl.onTimeout = end;
        return { destroy: () => clearInterval(ticker) };
    });
}

// ---------- Merkreihe ----------

function memory(box, mini, api) {
    return solo(box, api, ctl => {
        const rng = mulberry32(mini.params.seed);
        const seq = Array.from({ length: 30 }, () => Math.floor(rng() * 4));
        const colors = ['#ff2a6d', '#05d9e8', '#fcee0a', '#b967ff'];
        box.innerHTML = '<div class="mem-info">Merke dir die Reihenfolge …</div><div class="mem-pads">' +
            colors.map((c, i) => `<button type="button" class="mem-pad" data-i="${i}" style="--c:${c}" disabled></button>`).join('') + '</div>';
        const info = box.querySelector('.mem-info');
        const pads = [...box.querySelectorAll('.mem-pad')];
        let level = 1;
        let input = 0;
        let score = 0;
        let accepting = false;
        const flash = (i, ms = 380) => {
            pads[i].classList.add('lit');
            ctl.later(() => pads[i].classList.remove('lit'), ms);
        };
        const show = () => {
            accepting = false;
            pads.forEach(p => (p.disabled = true));
            info.textContent = `Runde ${level}: merken …`;
            seq.slice(0, level).forEach((c, k) => ctl.later(() => flash(c), 600 + k * 650));
            ctl.later(() => {
                accepting = true;
                input = 0;
                pads.forEach(p => (p.disabled = false));
                info.textContent = `Du bist dran! (${level} ${level === 1 ? 'Feld' : 'Felder'})`;
            }, 600 + level * 650);
        };
        pads.forEach(p => p.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (!accepting || ctl.done) return;
            const i = Number(p.dataset.i);
            flash(i, 160);
            if (i !== seq[input]) {
                accepting = false;
                info.textContent = 'Falsch!';
                ctl.finish(score);
                return;
            }
            input++;
            if (input >= level) {
                score += 100;
                level++;
                accepting = false;
                if (level > 14) ctl.finish(score);
                else ctl.later(show, 700);
            }
        }));
        ctl.later(show, 600);
        ctl.onTimeout = () => ctl.finish(score);
    });
}

// ---------- Kopfrechnen ----------

function math(box, mini, api) {
    return solo(box, api, ctl => {
        const rng = mulberry32(mini.params.seed);
        const problem = () => {
            const kind = Math.floor(rng() * 3);
            if (kind === 0) {
                const a = 5 + Math.floor(rng() * 56);
                const b = 5 + Math.floor(rng() * 56);
                return { text: `${a} + ${b}`, answer: a + b };
            }
            if (kind === 1) {
                const a = 20 + Math.floor(rng() * 70);
                const b = 3 + Math.floor(rng() * (a - 10));
                return { text: `${a} − ${b}`, answer: a - b };
            }
            const a = 2 + Math.floor(rng() * 11);
            const b = 2 + Math.floor(rng() * 8);
            return { text: `${a} × ${b}`, answer: a * b };
        };
        box.innerHTML = '<div class="mt-info">Punkte: 0</div><div class="mt-q"></div><form class="mt-form"><input class="mt-input" type="number" inputmode="numeric" autocomplete="off"><button class="btn primary" type="submit">OK</button></form><div class="mt-fb"></div>';
        const info = box.querySelector('.mt-info');
        const q = box.querySelector('.mt-q');
        const input = box.querySelector('.mt-input');
        const fb = box.querySelector('.mt-fb');
        let score = 0;
        let cur = problem();
        q.textContent = `${cur.text} = ?`;
        input.focus();
        box.querySelector('.mt-form').addEventListener('submit', e => {
            e.preventDefault();
            if (ctl.done || input.value === '') return;
            if (Number(input.value) === cur.answer) {
                score += 100;
                fb.textContent = 'Richtig! +100';
                fb.className = 'mt-fb ok';
            } else {
                score = Math.max(0, score - 50);
                fb.textContent = `Falsch (${cur.answer}) −50`;
                fb.className = 'mt-fb bad';
            }
            info.textContent = `Punkte: ${score}`;
            cur = problem();
            q.textContent = `${cur.text} = ?`;
            input.value = '';
            input.focus();
        });
        ctl.onTimeout = () => ctl.finish(score);
    });
}

// ---------- Wissen und Flaggen (Fragen kommen vom Host) ----------

function quiz(box, mini, api) {
    box.innerHTML = '<div class="qz-head"></div><div class="qz-bar"><i></i></div><div class="qz-img"></div><div class="qz-q"></div><div class="qz-opts"></div><div class="qz-note"></div>';
    const head = box.querySelector('.qz-head');
    const bar = box.querySelector('.qz-bar i');
    const imgBox = box.querySelector('.qz-img');
    const qEl = box.querySelector('.qz-q');
    const opts = box.querySelector('.qz-opts');
    const note = box.querySelector('.qz-note');
    let shownKey = '';
    let received = performance.now();
    let last = null;
    const tick = setInterval(() => {
        if (!last || last.itemPhase !== 'ask') return;
        const left = Math.max(0, last.itemMsLeft - (performance.now() - received));
        bar.style.width = `${(left / last.askMs) * 100}%`;
    }, 100);
    const render = p => {
        received = performance.now();
        last = p;
        const key = `${p.i}|${p.itemPhase}|${p.mine}|${p.correct}`;
        head.textContent = `Frage ${p.i + 1} von ${p.total}`;
        if (p.itemPhase !== 'ask') bar.style.width = '0%';
        if (key === shownKey) return;
        shownKey = key;
        imgBox.innerHTML = p.item.img ? `<img alt="Flagge" src="https://flagcdn.com/w320/${esc(p.item.img)}.png">` : '';
        qEl.textContent = p.item.q;
        opts.innerHTML = p.item.options
            .map((o, i) => {
                const cls = p.correct !== null ? (i === p.correct ? 'right' : i === p.mine ? 'wrong' : '') : i === p.mine ? 'mine' : '';
                return `<button type="button" class="qz-opt ${cls}" data-i="${i}"${p.mine !== null || p.itemPhase !== 'ask' ? ' disabled' : ''}>${esc(o)}</button>`;
            })
            .join('');
        note.textContent = p.itemPhase === 'ask'
            ? (p.mine !== null ? 'Antwort abgeschickt. Warte auf die anderen …' : '')
            : (p.mine === p.correct ? 'Richtig!' : p.mine === null ? 'Keine Antwort.' : 'Leider falsch.');
    };
    opts.addEventListener('click', e => {
        const b = e.target.closest('.qz-opt');
        if (b && !b.disabled) api.send({ kind: 'answer', c: Number(b.dataset.i) });
    });
    render(mini.params);
    return { update: m => render(m.params), destroy: () => clearInterval(tick) };
}

// ---------- Zeichnen und Raten ----------

const DRAW_COLORS = ['#e8f9ff', '#ff2a6d', '#05d9e8', '#39ff14', '#fcee0a', '#ff9a00'];

function draw(box, mini, api) {
    const isDrawer = mini.params.drawer === api.seat;
    box.innerHTML = `<div class="dr-top"></div><canvas class="dr-canvas" width="500" height="500"></canvas>
        ${isDrawer ? '<div class="dr-tools"></div>' : '<form class="dr-form"><input class="dr-input" type="text" maxlength="40" placeholder="Was wird gezeichnet?" autocomplete="off" autocapitalize="off"><button class="btn primary" type="submit">Raten</button></form>'}
        <div class="dr-note"></div>`;
    const top = box.querySelector('.dr-top');
    const canvas = box.querySelector('canvas');
    const g = canvas.getContext('2d');
    const note = box.querySelector('.dr-note');
    let version = -1;
    let current = null;
    let color = 0;
    const paint = strokes => {
        g.fillStyle = '#0a0d14';
        g.fillRect(0, 0, 500, 500);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (const s of strokes) {
            g.strokeStyle = DRAW_COLORS[s.c] ?? '#fff';
            g.lineWidth = s.w;
            g.beginPath();
            g.moveTo(s.p[0] / 2, s.p[1] / 2);
            if (s.p.length === 2) g.lineTo(s.p[0] / 2 + 0.1, s.p[1] / 2);
            for (let i = 2; i < s.p.length; i += 2) g.lineTo(s.p[i] / 2, s.p[i + 1] / 2);
            g.stroke();
        }
    };
    paint([]);

    let flushTimer = 0;
    const pending = { pts: [], c: 0 };
    const flush = () => {
        if (pending.pts.length >= 2) {
            const p = pending.pts;
            api.send({ kind: 'stroke', c: pending.c, w: 4, p });
            pending.pts = p.length >= 2 ? [p[p.length - 2], p[p.length - 1]] : [];
            if (pending.pts.length) pending.fresh = false;
        }
    };
    if (isDrawer) {
        const tools = box.querySelector('.dr-tools');
        tools.innerHTML = DRAW_COLORS.map((c, i) => `<button type="button" class="dr-color${i === 0 ? ' on' : ''}" data-i="${i}" style="background:${c}"></button>`).join('') +
            '<button type="button" class="btn small dr-clear">Alles löschen</button>';
        tools.addEventListener('click', e => {
            const b = e.target.closest('.dr-color');
            if (b) {
                color = Number(b.dataset.i);
                tools.querySelectorAll('.dr-color').forEach(x => x.classList.toggle('on', x === b));
            } else if (e.target.closest('.dr-clear')) {
                api.send({ kind: 'clear' });
            }
        });
        const pos = e => {
            const r = canvas.getBoundingClientRect();
            return [Math.round(Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000))), Math.round(Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)))];
        };
        canvas.addEventListener('pointerdown', e => {
            e.preventDefault();
            canvas.setPointerCapture?.(e.pointerId);
            const [x, y] = pos(e);
            current = { c: color, w: 4, p: [x, y] };
            pending.pts = [x, y];
            pending.c = color;
            // sofort lokal zeichnen
            g.fillStyle = DRAW_COLORS[color];
            g.beginPath();
            g.arc(x / 2, y / 2, 2, 0, Math.PI * 2);
            g.fill();
            clearInterval(flushTimer);
            flushTimer = setInterval(flush, 300);
        });
        canvas.addEventListener('pointermove', e => {
            if (!current) return;
            const [x, y] = pos(e);
            const n = current.p.length;
            if (Math.hypot(x - current.p[n - 2], y - current.p[n - 1]) < 8) return;
            g.strokeStyle = DRAW_COLORS[color];
            g.lineWidth = 4;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(current.p[n - 2] / 2, current.p[n - 1] / 2);
            g.lineTo(x / 2, y / 2);
            g.stroke();
            current.p.push(x, y);
            pending.pts.push(x, y);
            if (pending.pts.length > 400) flush();
        });
        const end = () => {
            if (!current) return;
            clearInterval(flushTimer);
            if (pending.pts.length === 2) pending.pts.push(pending.pts[0], pending.pts[1]);
            flush();
            pending.pts = [];
            current = null;
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    } else {
        box.querySelector('.dr-form').addEventListener('submit', e => {
            e.preventDefault();
            const input = box.querySelector('.dr-input');
            const text = input.value.trim();
            if (text) api.send({ kind: 'guess', text });
            input.value = '';
            input.focus();
        });
    }

    const render = p => {
        const done = p.correct.includes(api.seat);
        top.innerHTML = isDrawer
            ? `Zeichne: <strong>${esc(p.word ?? '')}</strong>`
            : `Gesucht: <strong class="dr-mask">${esc(p.mask)}</strong>${done ? ' ✓ gelöst' : ''}`;
        note.textContent = `${p.correct.length} haben es erraten`;
        if (!isDrawer) {
            box.querySelector('.dr-input').disabled = done;
            box.querySelector('.dr-form button').disabled = done;
        }
        // Zeichnung der Zeichnerin/des Zeichners kommt vom Host; die eigene lokal gemalte bleibt, bis der Host nachzieht
        if (!isDrawer && p.version !== version) {
            version = p.version;
            paint(p.strokes);
        } else if (isDrawer && p.strokes.length === 0 && version !== p.version) {
            version = p.version;
            paint([]);
        }
    };
    render(mini.params);
    return {
        update: m => render(m.params),
        destroy: () => clearInterval(flushTimer),
    };
}

// Gesellschaftsspiele: die Oberfläche des eigenen Spiels, eingebettet; Aktionen gehen als { kind: 'sub', a } zum Host.
function subGame(createUI) {
    return (box, mini, api) => {
        const pseudo = { send: a => api.send({ kind: 'sub', a }), onView: null, onNotice: null, onAvatars: null };
        const inst = mountGame(box, pseudo, createUI(), { embedded: true });
        pseudo.onAvatars(api.avatars());
        if (mini.sub) pseudo.onView(mini.sub);
        return { update: m => m.sub && pseudo.onView(m.sub), destroy: () => inst.destroy() };
    };
}

const CREATORS = {
    timing, hoops, reaction, tapping, memory, math, quiz, flags: quiz, draw,
    slf: subGame(createSlfUI), undercover: subGame(createUndercoverUI), ladder: subGame(createLadderUI), wordguess: subGame(createWordGuessUI),
};

export function createMiniGame(type, box, mini, api) {
    return CREATORS[type](box, mini, api);
}
