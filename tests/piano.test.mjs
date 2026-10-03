// Prüft die Komposition der Hintergrundmusik (die Klangerzeugung selbst braucht einen Browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { melodyBar, CHORDS, PROGRESSIONS, RHYTHMS_FIRST, RHYTHMS_SECOND } from '../js/core/piano.js';

const D_MINOR = [2, 4, 5, 7, 9, 10, 0];
const D_HARMONIC = [2, 4, 5, 7, 9, 10, 1];

test('Alle Akkorde der Abläufe sind definiert, der Ablauf hat acht Takte', () => {
    for (const prog of PROGRESSIONS) {
        assert.equal(prog.length, 8);
        for (const name of prog) assert.ok(CHORDS[name], name);
    }
});

test('Melodie bleibt in Tonart und Tonumfang, betonte Zeiten sind Akkordtöne', () => {
    for (let n = 0; n < 3000; n++) {
        const name = Object.keys(CHORDS)[n % Object.keys(CHORDS).length];
        const chord = CHORDS[name];
        const scale = chord.harmonic ? D_HARMONIC : D_MINOR;
        const rhythm = (n % 2 ? RHYTHMS_FIRST : RHYTHMS_SECOND)[n % 3];
        const prev = 62 + (n % 20);
        const notes = melodyBar(prev, chord, rhythm, n % 3 === 0);
        assert.equal(notes.length, rhythm.length);
        for (const note of notes) {
            assert.ok(note.midi >= 62 && note.midi <= 81, `außerhalb des Tonumfangs: ${note.midi}`);
            assert.ok(scale.includes(note.midi % 12), `${name}: Ton ${note.midi} gehört nicht zur Tonleiter`);
            if (note.slot % 4 === 0) assert.ok(chord.pcs.includes(note.midi % 12), `${name}: betonter Ton ${note.midi} ist kein Akkordton`);
        }
    }
});

test('Über dem A-Dur-Akkord wird Cis statt C gespielt', () => {
    for (let n = 0; n < 500; n++) {
        for (const note of melodyBar(69, CHORDS.A, RHYTHMS_FIRST[n % 4], false)) assert.notEqual(note.midi % 12, 0);
    }
});

test('Melodie bewegt sich überwiegend in Schritten (singbar, nicht sprunghaft)', () => {
    let steps = 0;
    let big = 0;
    let prev = 69;
    for (let n = 0; n < 2000; n++) {
        const chord = CHORDS[PROGRESSIONS[0][n % 8]];
        for (const note of melodyBar(prev, chord, RHYTHMS_FIRST[n % 4], n % 2 === 1)) {
            const jump = Math.abs(note.midi - prev);
            if (jump > 7) big++;
            steps++;
            prev = note.midi;
        }
    }
    assert.ok(big / steps < 0.02, `zu viele große Sprünge: ${((100 * big) / steps).toFixed(1)} %`);
});
