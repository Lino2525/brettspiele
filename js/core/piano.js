// Generative Klaviermusik (Web Audio): ruhig, d-Moll, getragen und leicht dramatisch.
// Alles wird live berechnet: eine Klavierstimme (Additivklang mit Filterhüllkurve), Bass und rollende
// Begleitung, eine sich ständig neu entwickelnde Melodie, ein weicher Streicher-Teppich, Hall und leiser Wind.
// Die Musik ist komplett eigenkomponiert (nur die Stimmung orientiert sich an der Serie, es werden keine
// bestehenden Melodien nachgespielt). Es gibt keine Audiodatei, also nichts herunterzuladen oder zu hosten.

const BPM = 60;
const EIGHTH = 60 / BPM / 2;
const BAR = EIGHTH * 8;

const freq = midi => 440 * 2 ** ((midi - 69) / 12);

// Tonleitern als Tonklassen: d-Moll natürlich, und mit Cis über dem A-Dur-Akkord (harmonisch Moll)
const NATURAL = [2, 4, 5, 7, 9, 10, 0];
const HARMONIC = [2, 4, 5, 7, 9, 10, 1];

// bass: Basston, arp: Töne der rollenden Begleitung (MIDI), pcs: Akkordtöne (Tonklassen)
export const CHORDS = {
    Dm: { bass: 38, arp: [50, 53, 57, 62, 65], pcs: [2, 5, 9] },
    'Dm/F': { bass: 41, arp: [50, 53, 57, 62, 65], pcs: [2, 5, 9] },
    Bb: { bass: 34, arp: [53, 58, 62, 65, 70], pcs: [10, 2, 5] },
    F: { bass: 41, arp: [53, 57, 60, 65, 69], pcs: [5, 9, 0] },
    C: { bass: 36, arp: [55, 60, 64, 67, 72], pcs: [0, 4, 7] },
    Gm: { bass: 43, arp: [55, 58, 62, 67, 70], pcs: [7, 10, 2] },
    A: { bass: 33, arp: [57, 61, 64, 69, 73], pcs: [9, 1, 4], harmonic: true },
};

// Zwei achttaktige Abläufe im Wechsel; der zweite endet auf A und führt so zurück nach d-Moll.
export const PROGRESSIONS = [
    ['Dm', 'Bb', 'F', 'C', 'Gm', 'Dm/F', 'A', 'Dm'],
    ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'C', 'A'],
];

const ARP_PATTERNS = [
    [0, 2, 1, 3, 2, 3, 1, 2],
    [0, 1, 2, 3, 4, 3, 2, 1],
    [0, 2, 4, 3, 2, 1, 2, 3],
];

// Melodie-Rhythmen: [Startachtel, Länge in Achteln]
export const RHYTHMS_FIRST = [
    [[0, 3], [3, 1], [4, 4]],
    [[0, 2], [2, 2], [4, 3], [7, 1]],
    [[0, 1], [1, 1], [2, 2], [4, 4]],
    [[2, 2], [4, 2], [6, 2]],
];
export const RHYTHMS_SECOND = [
    [[0, 4], [4, 2], [6, 2]],
    [[0, 3], [3, 1], [4, 4]],
    [[0, 2], [2, 2], [4, 4]],
];

const pick = list => list[Math.floor(Math.random() * list.length)];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function melodyBar(prev, chord, rhythm, phraseEnd) {
    const scale = chord.harmonic ? HARMONIC : NATURAL;
    const cand = [];
    for (let m = 62; m <= 81; m++) if (scale.includes(m % 12)) cand.push(m);
    const tones = cand.filter(m => chord.pcs.includes(m % 12));
    let cur = prev;
    let dir = Math.random() < 0.5 ? -1 : 1;
    const out = [];
    rhythm.forEach(([slot, len], k) => {
        const last = k === rhythm.length - 1;
        if (slot % 4 === 0 || (last && phraseEnd)) {
            // betonte Zeit: Akkordton in der Nähe (höchstens eine Quinte entfernt)
            const near = tones.filter(m => Math.abs(m - cur) <= 7);
            const pool = (near.length ? near : tones).slice().sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
            cur = pool[Math.min(pool.length - 1, Math.floor(Math.random() * Math.random() * 3))];
        } else {
            // unbetonte Zeit: Schritt in der Tonleiter, meist in der bisherigen Richtung
            let i = cand.indexOf(cur);
            if (i < 0) i = cand.reduce((best, m, j) => (Math.abs(m - cur) < Math.abs(cand[best] - cur) ? j : best), 0);
            if (Math.random() < 0.3) dir = -dir;
            i = clamp(i + dir * (Math.random() < 0.75 ? 1 : 2), 0, cand.length - 1);
            if (i === 0 || i === cand.length - 1) dir = -dir;
            cur = cand[i];
        }
        out.push({ slot, len, midi: cur });
    });
    return out;
}

export function createPianoEngine(ctx, destination) {
    // ---------- Klangerzeugung ----------
    const harmonics = [0, 1, 0.62, 0.45, 0.32, 0.22, 0.15, 0.1, 0.07, 0.045, 0.03];
    const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Hall: erzeugte Impulsantwort, abklingendes und leicht abgedunkeltes Rauschen
    const irLen = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        let y = 0;
        for (let i = 0; i < irLen; i++) {
            y += ((Math.random() * 2 - 1) - y) * 0.3;
            d[i] = y * (1 - i / irLen) ** 2.4 * 1.8;
        }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.35;
    const bus = ctx.createGain();
    bus.connect(dry).connect(comp);
    bus.connect(reverb).connect(wet).connect(comp);
    comp.connect(destination);

    function pianoNote(t, midi, vel, pan = 0) {
        const f = freq(midi);
        const decay = clamp(4.6 - (midi - 36) * 0.055, 1.4, 4.4); // tiefe Töne klingen länger
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.Q.value = 0.4;
        filt.frequency.setValueAtTime(Math.min(f * (7 + vel * 16), 14000), t);
        filt.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 700), t + 1.8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vel * 0.2, t + 0.006);
        g.gain.setTargetAtTime(0, t + 0.012, decay / 6.5);
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan + (midi - 60) / 70, -0.7, 0.7);
        filt.connect(g).connect(p).connect(bus);
        for (const cents of [-3, 4]) {
            const o = ctx.createOscillator();
            o.setPeriodicWave(wave);
            o.frequency.value = f;
            o.detune.value = cents;
            o.connect(filt);
            o.start(t);
            o.stop(t + decay + 0.4);
        }
        // Hammer: kurzes, gefiltertes Rauschen beim Anschlag
        const n = ctx.createBufferSource();
        n.buffer = noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = Math.min(f * 3, 5000);
        bp.Q.value = 0.8;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vel * 0.05, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        n.connect(bp).connect(ng).connect(p);
        n.start(t, Math.random() * 1.5, 0.08);
    }

    // weicher Streicher-Teppich: langsam ein- und ausblendende Sinustöne
    function padChord(t, midis, dur) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1100;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.03, t + 1.6);
        g.gain.setValueAtTime(0.03, t + dur - 0.2);
        g.gain.linearRampToValueAtTime(0, t + dur + 1.8);
        lp.connect(g).connect(bus);
        for (const m of midis) {
            for (const cents of [-7, 6]) {
                const o = ctx.createOscillator();
                o.type = 'triangle';
                o.frequency.value = freq(m);
                o.detune.value = cents;
                o.connect(lp);
                o.start(t);
                o.stop(t + dur + 2);
            }
        }
    }

    // leiser Wind (Naturgeräusch), läuft dauerhaft
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    const windBand = ctx.createBiquadFilter();
    windBand.type = 'bandpass';
    windBand.frequency.value = 520;
    windBand.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.012;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.007;
    lfo.connect(lfoDepth).connect(windGain.gain);
    windSrc.connect(windBand).connect(windGain).connect(destination);
    windSrc.start();
    lfo.start();

    // ---------- Komposition ----------
    let nextBar = ctx.currentTime + 0.3;
    let bar = 0;
    let prevMelody = 69;
    let arpPattern = pick(ARP_PATTERNS);

    function scheduleBar(t) {
        const cycle = Math.floor(bar / 8);
        const pos = bar % 8;
        const chord = CHORDS[PROGRESSIONS[cycle % 2][pos]];
        if (pos === 0) arpPattern = pick(ARP_PATTERNS);

        // Bass und rollende Begleitung
        const jitter = () => (Math.random() - 0.5) * 0.012;
        pianoNote(t + jitter(), chord.bass, 0.5, -0.25);
        if (pos % 2 === 0) pianoNote(t + 0.02, chord.bass + 12, 0.2, -0.2);
        for (let slot = 1; slot < 8; slot++) {
            const accent = slot % 2 === 0 ? 0.3 : 0.22;
            const vel = accent * (0.9 + Math.random() * 0.2);
            pianoNote(t + slot * EIGHTH + jitter(), chord.arp[arpPattern[slot]], vel, 0.05);
        }
        padChord(t, [chord.arp[1], chord.arp[2], chord.arp[3]], BAR);

        // Melodie: im ersten Durchgang erst ab dem dritten Takt, an manchen Stellen Pausen zum Atmen
        const silent = (cycle === 0 && pos < 2) || (pos === 3 && Math.random() < 0.5) || (pos === 7 && Math.random() < 0.35);
        if (!silent) {
            const phraseEnd = pos % 2 === 1;
            const rhythm = pick(pos % 2 === 0 ? RHYTHMS_FIRST : RHYTHMS_SECOND);
            for (const n of melodyBar(prevMelody, chord, rhythm, phraseEnd)) {
                prevMelody = n.midi;
                const vel = (n.len >= 3 ? 0.7 : 0.58) * (0.92 + Math.random() * 0.16);
                pianoNote(t + n.slot * EIGHTH + jitter(), n.midi, vel, 0.15);
            }
        }
        bar++;
    }

    return {
        // Plant alle Takte, die vor "until" (Sekunden der Audio-Uhr) beginnen
        pump(until) {
            while (nextBar < until) {
                scheduleBar(nextBar);
                nextBar += BAR;
            }
        },
        stop() {
            try { windSrc.stop(); lfo.stop(); } catch { /* schon gestoppt */ }
        },
    };
}
