import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult, pickBest } from '../js/games/songquiz/itunes.js';

const r = (trackName, artistName, extra = {}) => ({ trackName, artistName, previewUrl: 'https://x/p.m4a', trackTimeMillis: 200000, ...extra });

test('Original schlägt Remix, Live-Version, Karaoke und Cover', () => {
    const song = { title: 'Blinding Lights', artist: 'The Weeknd' };
    const results = [
        r('Blinding Lights (Remix)', 'The Weeknd & ROSALÍA'),
        r('Blinding Lights (Live)', 'The Weeknd'),
        r('Blinding Lights (Karaoke Version)', 'Karaoke Stars'),
        r('Blinding Lights', 'The Weeknd'),
    ];
    assert.equal(pickBest(results, song).trackName, 'Blinding Lights');
    assert.equal(pickBest(results.slice(0, 3), song), null, 'nur Remix/Live/Karaoke: lieber nichts');
});

test('Wörter wie "Alive" werden nicht als "live" abgewertet', () => {
    const song = { title: "Stayin' Alive", artist: 'Bee Gees' };
    assert.ok(scoreResult(r("Stayin' Alive", 'Bee Gees'), song) >= 10);
    assert.equal(pickBest([r("Stayin' Alive", 'Bee Gees')], song).trackName, "Stayin' Alive");
    assert.ok(scoreResult(r("Stayin' Alive (Live)", 'Bee Gees'), song) < 3);
});

test('Falscher Künstler, fehlende Vorschau oder anderer Titel werden verworfen', () => {
    const song = { title: 'Africa', artist: 'Toto' };
    assert.ok(scoreResult(r('Africa', 'Weezer'), song) < 0, 'anderer Künstler');
    assert.ok(scoreResult({ ...r('Africa', 'Toto'), previewUrl: undefined }, song) < 0, 'keine Vorschau');
    assert.ok(scoreResult(r('Rosanna', 'Toto'), song) < 0, 'anderer Titel');
    assert.equal(pickBest([r('Africa', 'Toto')], song).artistName, 'Toto');
});

test('Titel mit Zusätzen und feat. werden dem Original zugeordnet', () => {
    assert.ok(scoreResult(r('Uptown Funk (feat. Bruno Mars)', 'Mark Ronson'), { title: 'Uptown Funk', artist: 'Mark Ronson' }) >= 8);
    assert.ok(scoreResult(r("Billie Jean (Single Version)", 'Michael Jackson'), { title: 'Billie Jean', artist: 'Michael Jackson' }) >= 8);
    assert.ok(scoreResult(r('Rolling In the Deep', 'Adele'), { title: 'Rolling in the Deep', artist: 'Adele' }) >= 10);
});
