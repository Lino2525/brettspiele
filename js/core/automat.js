// Getränkeautomat im Menü: Hintergrundbild als Bühne, die Spiele als Dosen im untersten Fach.
// Die Bühne hat feste Koordinaten (1440 x 790, wie das Bild) und wird als Ganzes skaliert. Regal und Ausgabefach
// liegen als Ebenen mit einer Perspektiv-Matrix darauf, damit sie den Fluchtlinien des Bildes folgen.
//
//   const vm = automat(document.getElementById('vmScene'), dosen, { onPick, onTake })
//   vm.dispense(id)   Licht flackert, Dose fällt ins Ausgabefach (Promise, wenn sie liegt)
//   vm.reset()        Dose zurück ins Regal
//   vm.layout()       neu ausrichten (macht es bei Größenänderungen selbst)

const STAGE_W = 1440;
const STAGE_H = 790;
const MACHINE_W = 570; // rechte Kante des Automaten im Bild

// Ebenen in Bildkoordinaten (aus den Fluchtlinien des Bildes berechnet)
const SHELF_MATRIX = 'matrix3d(1.24642,0.274325,0,0.000560992,0,1.00561,0,0,0,0,1,0,27.7602,386.428,0,1)';
const TAGS_MATRIX = 'matrix3d(1.24642,0.274325,0,0.000560992,0,1.00561,0,0,0,0,1,0,27.7602,537.269,0,1)';
const BIN_MATRIX = 'matrix3d(1.46341,0.609756,0,0.00121951,0,1,0,0,0,0,1,0,60,640,0,1)';
const SHELF_W = 440; // Breite des Fachs in Ebenen-Pixeln, Dosen sind 63 x 120
const CAN_W = 63;

const FLICKER_MS = 750;
const FALL_MS = 585;
const LAND_MS = 715;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));

export function automat(scene, dosen, { onPick = () => {}, onTake = () => {} } = {}) {
    const stage = scene.querySelector('.vm-stage');
    const shaker = scene.querySelector('.vm-shaker');
    const shelf = scene.querySelector('.vm-shelf');
    const tags = scene.querySelector('.vm-tags');
    const hole = scene.querySelector('.vm-bin-hole');
    shelf.style.transform = SHELF_MATRIX;
    tags.style.transform = TAGS_MATRIX;
    scene.querySelector('.vm-bin').style.transform = BIN_MATRIX;

    // Dosen gleichmäßig im Fach verteilen (gilt für beliebig viele Spiele bis etwa sechs)
    const gap = (SHELF_W - dosen.length * CAN_W) / (dosen.length + 1);
    const slots = new Map();
    dosen.forEach((d, i) => {
        const left = 10 + gap + i * (CAN_W + gap);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vm-can';
        btn.style.left = `${left}px`;
        btn.setAttribute('aria-label', `${d.title} ziehen`);
        btn.appendChild(canImage(d));
        btn.addEventListener('click', () => onPick(d.id));
        shelf.insertBefore(btn, shelf.querySelector('.vm-glare'));

        const tag = document.createElement('span');
        tag.className = 'vm-tagchip';
        tag.style.left = `${left + CAN_W / 2 - 18}px`;
        tag.textContent = d.code;
        tags.appendChild(tag);

        // Im Ausgabefach landet die Dose ungefähr unter ihrem Platz im Regal
        const center = left + CAN_W / 2;
        const binLeft = Math.round(Math.min(224, Math.max(34, 34 + ((center - 62) / 336) * 190)));
        slots.set(d.id, { d, btn, tag, left, binLeft });
    });

    let busy = false;
    let current = null;

    function clearBin() {
        hole.replaceChildren();
        shelf.querySelector('.vm-fall')?.remove();
        scene.classList.remove('vm-out');
    }

    function restock() {
        for (const s of slots.values()) {
            s.btn.hidden = false;
            s.tag.classList.remove('on');
        }
    }

    async function dispense(id) {
        const slot = slots.get(id);
        if (!slot || busy) return false;
        busy = true;
        clearBin();
        restock();
        current = id;
        slot.tag.classList.add('on');
        const still = reduced();

        if (!still) {
            scene.classList.add('vm-flicker');
            await wait(FLICKER_MS);
            scene.classList.remove('vm-flicker');
        }

        slot.btn.hidden = true;
        if (!still) {
            const fall = document.createElement('div');
            fall.className = 'vm-fall';
            fall.style.left = `${slot.left}px`;
            fall.style.animationDuration = `${FALL_MS}ms`;
            fall.appendChild(canImage(slot.d));
            shelf.insertBefore(fall, shelf.querySelector('.vm-glare'));
            await wait(FALL_MS);
            fall.remove();
        }

        const lying = document.createElement('button');
        lying.type = 'button';
        lying.className = still ? 'vm-lying' : 'vm-lying vm-land';
        lying.style.left = `${slot.binLeft}px`;
        lying.style.animationDuration = `${LAND_MS}ms`;
        lying.setAttribute('aria-label', `${slot.d.title} entnehmen`);
        lying.appendChild(canImage(slot.d));
        lying.addEventListener('click', () => onTake(id));
        hole.appendChild(lying);
        if (!still) {
            shaker.style.animationDelay = `${Math.round(LAND_MS * 0.4)}ms`;
            shaker.classList.remove('vm-shake');
            void shaker.offsetWidth; // Animation neu starten
            shaker.classList.add('vm-shake');
            await wait(LAND_MS + 60);
        }
        scene.classList.add('vm-out');
        busy = false;
        return true;
    }

    function reset() {
        if (busy) return;
        current = null;
        clearBin();
        restock();
    }

    // Bühne skalieren. Breit: Bild füllt das Fenster, das Menü liegt rechts darüber. Schmal: Bühne oben, nur der Automat.
    function layout() {
        const W = innerWidth;
        const H = innerHeight;
        const lobby = scene.closest('.vm');
        const panelW = Math.min(560, Math.max(420, W * 0.4)) + 48;
        const cover = Math.max(W / STAGE_W, H / STAGE_H);
        const wide = W >= 900 && W - panelW >= MACHINE_W * cover;
        lobby.classList.toggle('vm-wide', wide);
        lobby.classList.toggle('vm-stacked', !wide);
        let s;
        let ox = 0;
        let oy = 0;
        if (wide) {
            s = cover;
            // Zu breites Fenster: oben abschneiden statt unten, damit das Ausgabefach sichtbar bleibt
            oy = Math.min(0, Math.max(H - STAGE_H * s, H - 765 * s));
            scene.style.height = '';
        } else {
            s = Math.min(W / 720, (0.62 * H) / STAGE_H);
            const h = Math.round(STAGE_H * s);
            scene.style.height = `${h}px`;
            ox = Math.min(0, (W - 720 * s) / 2);
        }
        stage.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    }

    let pending = 0;
    addEventListener('resize', () => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(layout);
    });
    layout();

    return { dispense, reset, layout, get busy() { return busy; }, get current() { return current; } };
}

function canImage(d) {
    const img = document.createElement('img');
    img.src = d.img;
    img.alt = '';
    img.width = 63;
    img.height = 120;
    img.decoding = 'async';
    img.draggable = false;
    return img;
}
