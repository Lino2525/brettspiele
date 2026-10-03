// Hintergrundmusik: läuft lokal bei jedem Spieler (nicht synchron), mit Stummschalter und Lautstärkeregler.
// Quelle ist entweder eine selbst gewählte Datei (bleibt im Browser, wird nie hochgeladen) oder die Standarddatei
// im Ordner Music/, falls sie auf dem Server liegt (z. B. beim lokalen Start mit "node serve.js").

export const DEFAULT_TRACK = 'Music/[1Hr] Attack on Titan _ Relaxing Soft Piano _ Sleep Piano Cover (With Nature Sounds).mp3';

const DB_NAME = 'bsp-music';
const STORE = 'files';

const store = {
    get: key => {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* ohne Speicher: Einstellung gilt nur bis zum Neuladen */ }
    },
};

// ---------- gewählte Datei im Browser merken (IndexedDB) ----------

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbRun(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
    });
}

const saveFile = file => dbRun('readwrite', s => s.put(file, 'current')).catch(() => {});
const loadFile = () => dbRun('readonly', s => s.get('current')).catch(() => undefined);
const clearFile = () => dbRun('readwrite', s => s.delete('current')).catch(() => {});

// ---------- Player ----------

const audio = new Audio();
audio.loop = true;
audio.preload = 'none';

const state = {
    source: 'none', // none | default | custom
    label: '',
    wantPlay: false,
    volume: Number(store.get('bsp.volume') ?? 0.35),
    muted: store.get('bsp.muted') === '1',
};
audio.volume = state.volume;
audio.muted = state.muted;

const controls = new Set();
let objectUrl = null;

function updateControls() {
    for (const c of controls) c.update();
}

function setSource(src, source, label) {
    if (objectUrl && objectUrl !== src) URL.revokeObjectURL(objectUrl);
    objectUrl = source === 'custom' ? src : null;
    state.source = source;
    state.label = label;
    audio.src = src;
    if (state.wantPlay) tryPlay();
    updateControls();
}

let waitingForGesture = false;
function tryPlay() {
    if (state.source === 'none') return;
    audio.play().catch(() => {
        // Der Browser erlaubt Ton erst nach einer Eingabe: beim nächsten Klick oder Tastendruck nachholen.
        if (waitingForGesture) return;
        waitingForGesture = true;
        const resume = () => {
            waitingForGesture = false;
            window.removeEventListener('pointerdown', resume);
            window.removeEventListener('keydown', resume);
            if (state.wantPlay) audio.play().catch(() => {});
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown', resume);
    });
}

export const music = {
    element: audio, // für Tests und Fehlersuche

    // Standarddatei suchen (nur wenn keine eigene Datei gewählt ist)
    async init(defaultUrl = DEFAULT_TRACK) {
        const saved = await loadFile();
        if (saved) {
            setSource(URL.createObjectURL(saved), 'custom', saved.name || 'Eigene Datei');
            return;
        }
        try {
            const res = await fetch(encodeURI(defaultUrl), { method: 'HEAD' });
            if (res.ok) setSource(encodeURI(defaultUrl), 'default', 'Standardmusik');
        } catch { /* keine Standarddatei: Musik muss gewählt werden */ }
        updateControls();
    },

    // Beim Spielstart aufrufen
    start() {
        state.wantPlay = true;
        tryPlay();
    },

    stop() {
        state.wantPlay = false;
        audio.pause();
    },

    async pick(file) {
        if (!file || !file.type.startsWith('audio/')) throw new Error('Das ist keine Audiodatei.');
        await saveFile(file);
        setSource(URL.createObjectURL(file), 'custom', file.name);
    },

    async clearCustom() {
        await clearFile();
        audio.removeAttribute('src');
        audio.load();
        state.source = 'none';
        state.label = '';
        await this.init();
        updateControls();
    },

    setVolume(v) {
        state.volume = Math.min(1, Math.max(0, v));
        audio.volume = state.volume;
        if (state.volume > 0 && state.muted) this.setMuted(false);
        store.set('bsp.volume', String(state.volume));
        updateControls();
    },

    setMuted(m) {
        state.muted = m;
        audio.muted = m;
        store.set('bsp.muted', m ? '1' : '0');
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
                <button type="button" class="micon" data-m="pick" title="Musikdatei wählen">♪</button>
                <button type="button" class="micon small" data-m="clear" title="Eigene Musikdatei entfernen" hidden>✕</button>
                <input type="file" accept="audio/*" data-m="file" hidden>
            </span>`;
        const $ = k => container.querySelector(`[data-m="${k}"]`);
        const control = {
            update() {
                const effective = state.muted ? 0 : state.volume;
                $('mute').textContent = effective === 0 ? '🔇' : effective < 0.4 ? '🔈' : '🔊';
                $('vol').value = Math.round(state.volume * 100);
                $('pick').classList.toggle('need', state.source === 'none');
                $('pick').title = state.source === 'none'
                    ? 'Keine Musik gefunden: Musikdatei wählen'
                    : `Musik: ${state.label} (andere Datei wählen)`;
                $('clear').hidden = state.source !== 'custom';
            },
        };
        $('mute').addEventListener('click', () => this.toggleMute());
        $('vol').addEventListener('input', e => this.setVolume(Number(e.target.value) / 100));
        $('pick').addEventListener('click', () => $('file').click());
        $('clear').addEventListener('click', () => this.clearCustom());
        $('file').addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            try {
                await this.pick(file);
                this.start();
            } catch (err) {
                alert(err.message);
            }
        });
        controls.add(control);
        control.update();
    },
};
