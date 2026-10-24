// Übergang vom Menü ins Spiel: Die gezogene Dose fliegt aus dem Ausgabefach in die Mitte, die Lasche ploppt ab,
// Kohlensäure sprudelt heraus und die Dosenfarbe flutet den Bildschirm. Unter der Flut wird das Spiel eingehängt,
// dann gibt sie den Blick frei. Die Flut bleibt stehen, solange der Raum noch aufgebaut wird.
//
//   intro.start(dose, fromEl)   sofort beim Klick: dose = { title, img, color }, fromEl = liegende Dose (optional)
//   intro.through(dose, swap)   Spiel ist bereit: wartet bis der Bildschirm bedeckt ist, ruft swap(), gibt frei
//   intro.cancel()              Fehler beim Verbinden: Flut weg, zurück ins Menü
// Bei "weniger Bewegung" wird ohne Animation umgeschaltet.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));

const CAN_W = 126;
const CAN_H = 240;
const FLY_MS = 1000;
const POP_AT = 1300; // Lasche
const FLOOD_AT = 1450;
const FLOOD_MS = 650;
const COVERED_AT = FLOOD_AT + FLOOD_MS; // ab hier ist der Bildschirm bedeckt
const TITLE_MIN_MS = 700; // so lange steht der Titel mindestens
const OUT_MS = 650;

let run = null;

function build(dose) {
    const root = document.createElement('div');
    root.className = 'intro';
    root.setAttribute('aria-hidden', 'true');
    root.style.setProperty('--ic', dose.color);
    root.innerHTML =
        '<div class="intro-dim"></div>' +
        '<div class="intro-can"><div class="intro-wob"><img alt=""><span class="intro-tab"></span></div></div>' +
        '<div class="intro-flood"></div>' +
        '<div class="intro-bubbles"></div>' +
        '<div class="intro-title"><b></b><span>FRISCH GEÖFFNET</span></div>';
    root.querySelector('img').src = dose.img;
    root.querySelector('.intro-title b').textContent = dose.title.toUpperCase();
    document.body.appendChild(root);
    return root;
}

function play(dose, fromEl) {
    const root = build(dose);
    const W = innerWidth;
    const H = innerHeight;
    const s = Math.min(2.1, (H * 0.55) / CAN_H, (W * 0.5) / CAN_W);
    const cx = W / 2;
    const cy = H * 0.52;
    const top = { x: cx, y: cy - (CAN_H / 2) * s }; // Öffnung der Dose

    // Start: die liegende Dose im Ausgabefach, sonst von unten
    let from = { x: cx, y: H + CAN_H, r: -18, s: s * 0.6 };
    const r = fromEl?.getBoundingClientRect();
    if (r && r.width > 4) {
        from = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: 90, s: Math.max(r.width, r.height) / CAN_H };
        fromEl.style.visibility = 'hidden';
    }
    const at = (x, y, rot, sc) => `translate(${x - CAN_W / 2}px, ${y - CAN_H / 2}px) rotate(${rot}deg) scale(${sc})`;

    const can = root.querySelector('.intro-can');
    can.animate([{ transform: at(from.x, from.y, from.r, from.s) }, { transform: at(cx, cy, 0, s) }],
        { duration: FLY_MS, easing: 'cubic-bezier(.3,1.25,.5,1)', fill: 'both' });
    root.querySelector('.intro-dim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'both' });
    root.querySelector('.intro-wob').animate(
        [{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(0)' }],
        { duration: 300, delay: FLY_MS, iterations: 1, easing: 'ease-in-out' });
    root.querySelector('.intro-tab').animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-6px) rotate(-60deg)', opacity: 1, offset: 0.4 }, { transform: 'translate(30px,-60px) rotate(-200deg)', opacity: 0 }],
        { duration: 350, delay: POP_AT, easing: 'ease-out', fill: 'both' });

    // Kohlensäure: Blasen sprühen fächerförmig aus der Öffnung
    const bubbles = root.querySelector('.intro-bubbles');
    for (let i = 0; i < 26; i++) {
        const b = document.createElement('i');
        const size = 10 + ((i * 29) % 6) * 7 * Math.min(1, s / 2);
        const a = -Math.PI / 2 + (((i * 37) % 26) / 25 - 0.5) * 2.2;
        const dist = (160 + ((i * 53) % 7) * 70) * Math.min(1, W / 1200);
        b.style.cssText = `width:${size}px;height:${size}px;left:${top.x - size / 2}px;top:${top.y - size / 2}px`;
        bubbles.appendChild(b);
        b.animate([
            { transform: 'translate(0,0) scale(.2)', opacity: 1 },
            { opacity: 1, offset: 0.7 },
            { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist}px) scale(1)`, opacity: 0 },
        ], { duration: 1000, delay: POP_AT + ((i * 17) % 9) * 45, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
    }

    const R = Math.hypot(Math.max(top.x, W - top.x), Math.max(top.y, H - top.y)) + 40;
    const flood = root.querySelector('.intro-flood');
    flood.animate([{ clipPath: `circle(0px at ${top.x}px ${top.y}px)` }, { clipPath: `circle(${R}px at ${top.x}px ${top.y}px)` }],
        { duration: FLOOD_MS, delay: FLOOD_AT, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'both' });
    const title = root.querySelector('.intro-title');
    title.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1.05)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 450, delay: FLOOD_AT + 350, easing: 'ease-out', fill: 'both' });

    const t0 = performance.now();
    return {
        root,
        fromEl: from.r === 90 ? fromEl : null,
        covered: wait(COVERED_AT + 60),
        titleDone: () => wait(Math.max(0, FLOOD_AT + 350 + TITLE_MIN_MS - (performance.now() - t0))),
    };
}

async function reveal(cur) {
    const { root } = cur;
    root.querySelector('.intro-can').style.visibility = 'hidden';
    root.querySelector('.intro-dim').style.opacity = '0';
    const anims = [
        root.querySelector('.intro-flood').animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, easing: 'ease-in', fill: 'forwards' }),
        root.querySelector('.intro-title').animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.12)' }], { duration: OUT_MS * 0.8, easing: 'ease-in', fill: 'forwards' }),
    ];
    await Promise.all(anims.map(a => a.finished.catch(() => {})));
    root.remove();
}

export const intro = {
    start(dose, fromEl = null) {
        if (reduced() || run) return;
        try {
            run = play(dose, fromEl);
        } catch (e) {
            console.warn('Übergang:', e);
            run = null;
        }
    },

    async through(dose, swap) {
        if (reduced()) return swap();
        if (!run) this.start(dose);
        const cur = run;
        if (!cur) return swap();
        await cur.covered;
        try {
            swap();
        } finally {
            await cur.titleDone();
            run = null;
            await reveal(cur);
        }
    },

    cancel() {
        const cur = run;
        run = null;
        if (!cur) return;
        if (cur.fromEl) cur.fromEl.style.visibility = '';
        cur.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished
            .catch(() => {})
            .then(() => cur.root.remove());
    },
};
