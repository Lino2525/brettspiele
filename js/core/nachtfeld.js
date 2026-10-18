// Nachtfeld: der bewegte Hintergrund der ganzen Seite (Canvas 2D, keine Abhängigkeiten).
// Im Menü formen die Partikel über Wellenringen das Symbol des gewählten Spiels und wechseln beim Durchgehen
// der Spiele die Form. Ein Teil steigt ständig aus dem Wasser nach oben. Im Spiel treiben sie ruhig als Sternenstaub.
// Bei "weniger Bewegung" wird nur ein Standbild gezeichnet.
//   nachtfeld.start(canvas)      einmal beim Laden
//   nachtfeld.anchor(el)         Element, über dem die Form schwebt (Menü)
//   nachtfeld.show(id)           Form wechseln: 'rummy', 'songquiz', 'party', 'monopoly', 'sketch'
//   nachtfeld.ripple(x, y)       Welle an einer Bildschirmstelle
//   nachtfeld.mode('game')       Übergang ins Spiel (Warp, danach Sternenstaub); 'lobby' zurück
//   nachtfeld.warp(ms)           kurzer Flug durch die Sterne im Spiel (z. B. vor einem Minispiel)

const TAU = Math.PI * 2;
const SAMPLE = 220; // Kantenlänge der Hilfsfläche, auf der die Formen gezeichnet und abgetastet werden

// Farben: Sternweiß, Eisblau, Blau, Signalblau, Iris. Gold nur für Sternenjagd.
const COLORS = ['#eaf2ff', '#8fd8ff', '#5aa2ff', '#2f6bff', '#9d8cff', '#ffcf6b'];
const ALPHA = [0.9, 0.75, 0.7, 0.65, 0.6, 0.9];
const INK = '2, 4, 12';

// ---------- Formen ----------

// Abgerundetes Rechteck als Pfad. Bewusst ohne ctx.roundRect: das fehlt in älteren Browsern (z. B. Safari bis iOS 15)
function roundedRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function star(g, cx, cy, ro, ri) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? ri : ro;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
}

const DRAW = {
    // Drei aufgefächerte Zahlensteine
    rummy(g) {
        g.lineJoin = 'round';
        g.font = '700 46px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        [-1, 0, 1].forEach((i, k) => {
            g.save();
            g.translate(110 + i * 50, 120 + Math.abs(i) * 10);
            g.rotate(i * 0.24);
            g.beginPath();
            roundedRect(g, -34, -48, 68, 96, 12);
            g.globalCompositeOperation = 'destination-out';
            g.fill();
            g.globalCompositeOperation = 'source-over';
            g.lineWidth = 9;
            g.stroke();
            g.fillText(String(7 + k), 0, -6);
            g.fillRect(-14, 28, 28, 5);
            g.restore();
        });
    },
    // Schallwelle aus Balken
    songquiz(g) {
        const h = [16, 34, 58, 40, 86, 124, 76, 168, 104, 140, 70, 98, 46, 30, 16];
        h.forEach((v, i) => {
            g.beginPath();
            roundedRect(g, 14 + i * 13, 110 - v / 2, 8, v, 4);
            g.fill();
        });
    },
    // Großer Stern mit zwei kleinen
    party(g) {
        star(g, 110, 118, 96, 40);
        g.fill();
        star(g, 34, 40, 18, 7);
        g.fill();
        star(g, 192, 196, 13, 5);
        g.fill();
    },
    // Zwei Häuser, das große mit Tür und Fenstern
    monopoly(g) {
        g.beginPath();
        g.moveTo(26, 112);
        g.lineTo(112, 34);
        g.lineTo(198, 112);
        g.closePath();
        g.fill();
        g.fillRect(48, 108, 128, 94);
        g.fillRect(150, 46, 18, 44);
        g.globalCompositeOperation = 'destination-out';
        g.fillRect(100, 146, 26, 56);
        g.fillRect(62, 126, 24, 22);
        g.fillRect(140, 126, 24, 22);
        g.globalCompositeOperation = 'source-over';
    },
    // Schräger Bleistift, der eine Schlangenlinie kritzelt
    sketch(g) {
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(18, 186);
        g.bezierCurveTo(46, 136, 70, 214, 98, 170);
        g.bezierCurveTo(118, 138, 128, 182, 146, 160);
        g.stroke();
        g.save();
        g.translate(150, 150);
        g.rotate(-Math.PI / 4);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(26, -18);
        g.lineTo(130, -18);
        g.lineTo(130, 18);
        g.lineTo(26, 18);
        g.closePath();
        g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.fillRect(104, -22, 6, 44);
        g.beginPath();
        g.moveTo(26, -18);
        g.lineTo(26, 18);
        g.lineTo(32, 18);
        g.lineTo(32, -18);
        g.fill();
        g.globalCompositeOperation = 'source-over';
        g.restore();
    },
};

function sampleShape(id, count) {
    const c = document.createElement('canvas');
    c.width = c.height = SAMPLE;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = g.strokeStyle = '#fff';
    DRAW[id](g);
    const data = g.getImageData(0, 0, SAMPLE, SAMPLE).data;
    const hits = [];
    for (let y = 0; y < SAMPLE; y += 2) {
        for (let x = 0; x < SAMPLE; x += 2) if (data[(y * SAMPLE + x) * 4 + 3] > 140) hits.push(x, y);
    }
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const j = (Math.random() * (hits.length / 2)) | 0;
        out[i * 3] = ((hits[j * 2] + Math.random() * 2 - 1) / SAMPLE) * 2 - 1;
        out[i * 3 + 1] = ((hits[j * 2 + 1] + Math.random() * 2 - 1) / SAMPLE) * 2 - 1;
        out[i * 3 + 2] = (Math.random() - 0.5) * 0.3; // Tiefe, damit die Form beim Drehen Volumen hat
    }
    return out;
}

// ---------- Zustand ----------

let canvas, ctx;
let W = 0, H = 0, DPR = 1;
let N = 0; // Partikel
let px, py, vx, vy, col, size, phase, spring;
const shapes = {};
let shapeId = 'party';
let target = null;
let anchorEl = null;
let mode = 'lobby';
let warpUntil = 0;
let stars = [];
let ripples = [];
let pointer = { x: -1e4, y: -1e4 };
let parallax = { x: 0, y: 0 };
let running = false;
let raf = 0;
let lastRipple = 0;
let center = { x: 0, y: 0, r: 100, base: 0, spread: 300 };

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reduceQuery.matches;

function particleCount() {
    const area = innerWidth * innerHeight;
    let n = Math.round((area / (1280 * 900)) * 4200);
    if ((navigator.hardwareConcurrency || 8) <= 4) n *= 0.7;
    return Math.max(1800, Math.min(4200, n)) | 0;
}

function alloc(n) {
    N = n;
    px = new Float32Array(n);
    py = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    col = new Uint8Array(n);
    size = new Float32Array(n);
    phase = new Float32Array(n);
    spring = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const r = Math.random();
        col[i] = r < 0.18 ? 0 : r < 0.45 ? 1 : r < 0.7 ? 2 : r < 0.88 ? 3 : 4;
        // wenige große, blasse Punkte geben Tiefe (Bokeh), die meisten sind feiner Staub
        size[i] = Math.random() < 0.06 ? 2.4 + Math.random() * 1.4 : 0.9 + Math.random() * Math.random() * 1.6;
        phase[i] = Math.random() * TAU;
        spring[i] = 0.014 + Math.random() * 0.014;
    }
    for (const k in shapes) delete shapes[k];
}

function shape(id) {
    if (!shapes[id]) shapes[id] = sampleShape(id, N);
    return shapes[id];
}

function measure() {
    if (!anchorEl || anchorEl.offsetParent === null) return;
    const r = anchorEl.getBoundingClientRect();
    const radius = Math.min(r.width * 0.5, r.height * 0.45);
    const y = r.top + radius * 1.02;
    center = {
        x: r.left + r.width / 2,
        y,
        r: radius,
        base: y + radius * 1.08,
        spread: Math.max(r.width * 0.55, radius * 2.4),
    };
}

function resize() {
    DPR = Math.min(devicePixelRatio || 1, innerWidth < 720 ? 1.5 : 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = particleCount();
    if (Math.abs(n - N) > N * 0.25 || !N) {
        alloc(n);
        scatter(true);
    }
    target = shape(shapeId);
    stars = Array.from({ length: Math.round((W * H) / 9000) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random(),
        p: Math.random() * TAU,
    }));
    measure();
    if (!running) frame(performance.now());
}

// Startlage: Partikel liegen im Wasser unter der Form, damit sie beim Laden nach oben aufsteigen.
function scatter(fromWater) {
    measure();
    for (let i = 0; i < N; i++) {
        if (fromWater) {
            const a = Math.random() * TAU;
            const d = Math.sqrt(Math.random());
            px[i] = center.x + Math.cos(a) * d * center.spread;
            py[i] = center.base + Math.sin(a) * d * center.spread * 0.18;
            vx[i] = 0;
            vy[i] = -Math.random() * 4;
        } else {
            px[i] = Math.random() * W;
            py[i] = Math.random() * H;
            vx[i] = vy[i] = 0;
        }
    }
}

// ---------- Zeichnen ----------

function drawStars(t) {
    const sway = mode === 'game' ? 0.6 : 1;
    for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.0012 * (0.4 + s.z) + s.p));
        ctx.globalAlpha = tw * (0.25 + s.z * 0.5);
        ctx.fillStyle = s.z > 0.85 ? '#ffffff' : '#9fc4ff';
        const x = (s.x + parallax.x * s.z * 18 * sway + W) % W;
        const y = (s.y + parallax.y * s.z * 12 * sway + H) % H;
        const sz = s.z > 0.9 ? 1.6 : 1;
        ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;
}

function drawRipples(t) {
    const { x, base, spread } = center;
    ctx.lineWidth = 1;
    // Gleichmäßige Ringe aus der Mitte
    const period = 7000;
    for (let k = 0; k < 6; k++) {
        const p = ((t / period + k / 6) % 1);
        const rx = 18 + p * spread;
        const a = Math.pow(1 - p, 1.8) * 0.3;
        ctx.strokeStyle = `rgba(110, 170, 255, ${a})`;
        ctx.beginPath();
        ctx.ellipse(x, base, rx, rx * 0.2, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(157, 140, 255, ${a * 0.45})`;
        ctx.beginPath();
        ctx.ellipse(x, base + 3, rx * 0.985, rx * 0.2, 0, 0, TAU);
        ctx.stroke();
    }
    // Wellen, die eine Berührung auslöst
    ripples = ripples.filter(r => t - r.t < 1600);
    for (const r of ripples) {
        const p = (t - r.t) / 1600;
        const rx = 10 + p * 160;
        ctx.strokeStyle = `rgba(143, 216, 255, ${(1 - p) * 0.55})`;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rx, rx * (r.flat ? 0.24 : 1), 0, 0, TAU);
        ctx.stroke();
    }
    // Leuchtende Quelle
    const glow = ctx.createRadialGradient(x, base, 0, x, base, spread * 0.5);
    glow.addColorStop(0, 'rgba(70, 140, 255, 0.16)');
    glow.addColorStop(1, 'rgba(70, 140, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, base, spread * 0.5, spread * 0.11, 0, 0, TAU);
    ctx.fill();
}

function stepLobby(t) {
    const yaw = Math.sin(t * 0.00023) * 0.42;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const { x: cx, y: cy, r: R, base } = center;
    const gold = shapeId === 'party';
    const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    neb.addColorStop(0, 'rgba(47, 107, 255, 0.10)');
    neb.addColorStop(1, 'rgba(47, 107, 255, 0)');
    ctx.fillStyle = neb;
    ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    // Ein paar Partikel springen zurück ins Wasser und steigen neu auf: der leuchtende "Stamm"
    const rise = reduced() ? 0 : Math.max(1, N * 0.0011) | 0;
    for (let k = 0; k < rise; k++) {
        const i = (Math.random() * N) | 0;
        px[i] = cx + (Math.random() - 0.5) * R * 0.25;
        py[i] = base + Math.random() * 6;
        vx[i] = (Math.random() - 0.5) * 1.2;
        vy[i] = -2 - Math.random() * 3;
    }
    for (let i = 0; i < N; i++) {
        const sx = target[i * 3];
        const sy = target[i * 3 + 1];
        const sz = target[i * 3 + 2];
        const X = sx * cos + sz * sin;
        const Z = -sx * sin + sz * cos;
        const f = 1 / (1 + Z * 0.4);
        const tx = cx + X * R * f;
        const ty = cy + sy * R * f;
        let ax = (tx - px[i]) * spring[i];
        let ay = (ty - py[i]) * spring[i];
        const dx = px[i] - pointer.x;
        const dy = py[i] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 8100) {
            const d = Math.sqrt(d2) || 1;
            const push = (1 - d / 90) * 2.4;
            ax += (dx / d) * push;
            ay += (dy / d) * push;
        }
        vx[i] = (vx[i] + ax) * 0.88;
        vy[i] = (vy[i] + ay) * 0.88;
        px[i] += vx[i];
        py[i] += vy[i];
    }
    return gold;
}

function stepGame(t) {
    const warp = t < warpUntil;
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 0; i < N; i++) {
        if (warp) {
            vx[i] += (px[i] - cx) * 0.012;
            vy[i] += (py[i] - cy) * 0.012;
            vx[i] *= 0.96;
            vy[i] *= 0.96;
        } else {
            // Sternenstaub: langsam nach oben treiben, leicht pendeln
            vx[i] = vx[i] * 0.95 + Math.sin(t * 0.0004 + phase[i]) * 0.012;
            vy[i] = vy[i] * 0.95 - 0.012 * size[i];
        }
        px[i] += vx[i];
        py[i] += vy[i];
        if (!warp) {
            if (py[i] < -10) {
                py[i] = H + 10;
                px[i] = Math.random() * W;
            }
            if (px[i] < -10) px[i] = W + 10;
            else if (px[i] > W + 10) px[i] = -10;
        } else if (px[i] < -40 || px[i] > W + 40 || py[i] < -40 || py[i] > H + 40) {
            px[i] = Math.random() * W;
            py[i] = Math.random() * H;
            vx[i] = vy[i] = 0;
        }
    }
}

function drawParticles(t, gold, count, alphaScale) {
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < 5; c++) {
        ctx.fillStyle = COLORS[gold && c === 0 ? 5 : c];
        ctx.globalAlpha = ALPHA[c] * alphaScale;
        for (let i = 0; i < count; i++) {
            if (col[i] !== c) continue;
            const s = size[i] * (0.75 + 0.25 * Math.sin(t * 0.003 + phase[i]));
            ctx.fillRect(px[i], py[i], s, s);
        }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
}

function frame(t) {
    raf = 0;
    if (!ctx) return;
    try {
        draw(t);
    } catch (e) {
        running = false;
        console.warn('Nachtfeld angehalten:', e);
        return;
    }
    if (running) raf = requestAnimationFrame(frame);
}

function draw(t) {
    parallax.x += ((pointer.x > -1e3 ? pointer.x / W - 0.5 : 0) - parallax.x) * 0.04;
    parallax.y += ((pointer.y > -1e3 ? pointer.y / H - 0.5 : 0) - parallax.y) * 0.04;
    // Leichte Nachzieh-Spuren: Grund nur teilweise übermalen
    ctx.fillStyle = `rgba(${INK}, ${reduced() || !running ? 1 : mode === 'game' ? 0.5 : 0.32})`;
    ctx.fillRect(0, 0, W, H);
    drawStars(t);
    if (mode === 'lobby') {
        measure();
        drawRipples(t);
        const gold = stepLobby(t);
        drawParticles(t, gold, N, 1);
    } else {
        stepGame(t);
        // Im Spiel weniger und dunkler, damit nichts vom Brett ablenkt
        drawParticles(t, false, t < warpUntil ? N : Math.round(N * 0.3), t < warpUntil ? 1 : 0.4);
    }
}

// Standbild für "weniger Bewegung": Partikel direkt auf die Form setzen
function still() {
    measure();
    if (mode === 'lobby') {
        for (let i = 0; i < N; i++) {
            px[i] = center.x + target[i * 3] * center.r;
            py[i] = center.y + target[i * 3 + 1] * center.r;
            vx[i] = vy[i] = 0;
        }
    } else scatter(false);
    running = false;
    frame(performance.now());
}

function play() {
    if (reduced()) return still();
    if (running || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(frame);
}

function pause() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
}

// Der Hintergrund ist Dekoration: Ein Fehler darin (etwa in einem älteren Browser) darf nie das Menü oder ein Spiel
// lahmlegen. Deshalb fängt jede öffentliche Funktion Fehler ab und der Hintergrund bleibt dann einfach stehen.
const safe = api => Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => {
    try {
        return fn(...args);
    } catch (e) {
        console.warn(`Nachtfeld (${name}):`, e);
        return undefined;
    }
}]));

export const nachtfeld = safe({
    start(el) {
        canvas = el;
        ctx = canvas.getContext('2d', { alpha: false });
        resize();
        let pending = 0;
        addEventListener('resize', () => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(() => {
                resize();
                if (reduced()) still();
            });
        });
        addEventListener('pointermove', e => {
            if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY };
        }, { passive: true });
        addEventListener('pointerdown', e => {
            pointer = { x: e.clientX, y: e.clientY };
            if (e.pointerType !== 'mouse') setTimeout(() => (pointer = { x: -1e4, y: -1e4 }), 450);
        }, { passive: true });
        document.addEventListener('pointerleave', () => (pointer = { x: -1e4, y: -1e4 }));
        document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
        reduceQuery.addEventListener('change', () => (reduced() ? (pause(), still()) : play()));
        play();
    },
    anchor(el) {
        anchorEl = el;
        scatter(true);
    },
    show(id) {
        if (!DRAW[id] || !ctx || id === shapeId) return;
        shapeId = id;
        target = shape(id);
        // Kleiner Schubs nach außen, damit der Wechsel sichtbar "aufbricht"
        if (!reduced()) {
            for (let i = 0; i < N; i++) {
                vx[i] += (Math.random() - 0.5) * 6;
                vy[i] += (Math.random() - 0.5) * 6;
            }
        } else still();
    },
    ripple(x, y, flat = true) {
        const now = performance.now();
        if (now - lastRipple < 120) return;
        lastRipple = now;
        ripples.push({ x, y, t: now, flat });
    },
    // Kurzer Flug durch die Sterne, z. B. vor einem Minispiel (nur im Spiel)
    warp(ms = 1200) {
        if (mode !== 'game' || reduced() || !ctx) return;
        warpUntil = performance.now() + ms;
    },
    mode(next) {
        if (next === mode || !ctx) return;
        mode = next;
        if (next === 'game') warpUntil = performance.now() + 900;
        else scatter(true);
        if (reduced()) still();
    },
});
