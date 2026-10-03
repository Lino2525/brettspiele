// Hintergrundmusik: ruhige Klaviermusik, die live im Browser erzeugt wird (siehe piano.js).
// Läuft bei jedem Spieler lokal (nicht synchron), mit Stummschalter und Lautstärkeregler.
import { createPianoEngine } from './piano.js';

const store = {
    get: key => {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* ohne Speicher: Einstellung gilt nur bis zum Neuladen */ }
    },
};

const state = {
    ctx: null,
    master: null,
    engine: null,
    timer: null,
    wantPlay: false,
    volume: Number(store.get('bsp.volume') ?? 0.6),
    muted: store.get('bsp.muted') === '1',
};
const controls = new Set();
const updateControls = () => controls.forEach(c => c.update());

// Lautstärke wahrnehmungsgerecht (quadratisch) auf die Verstärkung abbilden
const gainFor = () => (state.muted ? 0 : state.volume ** 2 * 1.6);

function applyGain() {
    if (!state.master) return;
    state.master.gain.setTargetAtTime(gainFor(), state.ctx.currentTime, 0.05);
}

function ensureEngine() {
    if (state.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    state.ctx = new Ctx();
    state.master = state.ctx.createGain();
    state.master.gain.value = gainFor();
    // Begrenzer als Sicherung: auch bei voller Lautstärke kein Übersteuern
    const limiter = state.ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    state.master.connect(limiter).connect(state.ctx.destination);
    state.engine = createPianoEngine(state.ctx, state.master);
    state.timer = setInterval(() => {
        if (state.ctx.state === 'running') state.engine.pump(state.ctx.currentTime + 5);
    }, 500);
}

let waitingForGesture = false;
function resumeContext() {
    if (!state.ctx || !state.wantPlay) return;
    state.ctx.resume().catch(() => {});
    if (state.ctx.state === 'running' || waitingForGesture) return;
    // Der Browser erlaubt Ton erst nach einer Eingabe: beim nächsten Klick oder Tastendruck nachholen.
    waitingForGesture = true;
    const retry = () => {
        waitingForGesture = false;
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
        resumeContext();
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
}

export const music = {
    get context() {
        return state.ctx; // für Tests und Fehlersuche
    },

    // Beim Spielstart aufrufen
    start() {
        state.wantPlay = true;
        ensureEngine();
        resumeContext();
    },

    stop() {
        state.wantPlay = false;
        state.ctx?.suspend();
    },

    setVolume(v) {
        state.volume = Math.min(1, Math.max(0, v));
        if (state.volume > 0 && state.muted) this.setMuted(false);
        store.set('bsp.volume', String(state.volume));
        applyGain();
        updateControls();
    },

    setMuted(m) {
        state.muted = m;
        store.set('bsp.muted', m ? '1' : '0');
        applyGain();
        updateControls();
    },

    toggleMute() {
        this.setMuted(!state.muted);
    },

    // Bedienelemente in einen Container einbauen (mehrfach möglich, z. B. Lobby und Spielleiste)
    mount(container) {
        container.innerHTML = `
            <span class="music">
                <button type="button" class="micon" data-m="mute" title="Ton an/aus"></button>
                <input type="range" min="0" max="100" step="1" data-m="vol" title="Lautstärke" aria-label="Lautstärke">
            </span>`;
        const $ = k => container.querySelector(`[data-m="${k}"]`);
        const control = {
            update() {
                const effective = state.muted ? 0 : state.volume;
                $('mute').textContent = effective === 0 ? '🔇' : effective < 0.4 ? '🔈' : '🔊';
                $('vol').value = Math.round(state.volume * 100);
            },
        };
        $('mute').addEventListener('click', () => this.toggleMute());
        $('vol').addEventListener('input', e => this.setVolume(Number(e.target.value) / 100));
        controls.add(control);
        control.update();
    },
};
