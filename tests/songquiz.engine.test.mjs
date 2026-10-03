import test from 'node:test';
import assert from 'node:assert/strict';
import { SongQuizGame, MAX_PLAYERS, ROUNDS } from '../js/games/songquiz/engine.js';

const fakeCatalog = (n = 80) => Array.from({ length: n }, (_, i) => ({ id: `Song ${i} | Artist ${i % 40}`, title: `Song ${i}`, artist: `Artist ${i % 40}`, decade: 1990, lang: 'en' }));
let urlCounter = 0;
const provider = async c => ({ id: c.id, title: c.title, artist: c.artist, previewUrl: `https://audio.example/u${++urlCounter}.m4a`, art: '' });
const flush = () => new Promise(r => setImmediate(r));

function seeded(seed = 1) {
    let x = seed;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function newGame(n = 3, opts = {}) {
    const g = new SongQuizGame({ rng: seeded(3), catalog: fakeCatalog(), songProvider: provider, ...opts });
    for (let i = 0; i < n; i++) assert.equal(g.join('t' + i, 'Spieler' + i), i);
    return g;
}

// Lässt Zeit vergehen, bis die Bedingung gilt (Songs werden asynchron geladen)
async function until(g, clock, cond, step = 500, max = 400) {
    for (let i = 0; i < max && !cond(); i++) {
        clock.t += step;
        g.tick(clock.t);
        await flush();
    }
    assert.ok(cond(), 'Bedingung nicht erreicht');
}

// Startet und bringt die erste Runde in die Live-Phase
async function startLive(g, clock) {
    assert.ok(!g.apply(0, { t: 'start' }).error);
    await until(g, clock, () => g.s.round?.phase === 'prepare');
    for (let i = 0; i < g.s.players.length; i++) g.apply(i, { t: 'ready', round: g.s.round.id }, clock.t);
    assert.equal(g.s.round.phase, 'live');
}

test('Lobby: Start nur durch den Gastgeber ab 2 Spielern, höchstens 10, danach nur noch bekannte', () => {
    const g = new SongQuizGame({ rng: seeded(1), catalog: fakeCatalog(), songProvider: provider });
    g.join('a', 'A');
    assert.ok(g.apply(0, { t: 'start' }).error);
    g.join('b', 'B');
    assert.ok(g.apply(1, { t: 'start' }).error);
    for (let i = 2; i < MAX_PLAYERS; i++) assert.equal(g.join('p' + i, 'P' + i), i);
    assert.equal(g.join('extra', 'Elf'), -1, 'Raum voll');
    assert.ok(!g.apply(0, { t: 'start' }).error);
    assert.equal(g.join('spaet', 'Spät'), -1);
    assert.equal(g.join('b', 'B'), 1, 'bekannter Spieler darf zurück');
    assert.equal(MAX_PLAYERS, 10);
});

test('Songs werden vorab geladen und die erste Runde startet', async () => {
    const g = newGame();
    const clock = { t: 1_000_000 };
    assert.ok(!g.apply(0, { t: 'start' }).error);
    assert.equal(g.s.phase, 'loading');
    await until(g, clock, () => g.s.phase === 'round');
    assert.equal(g.s.roundNo, 1);
    assert.equal(g.s.round.phase, 'prepare');
    assert.ok(g.s.round.offset >= 0 && g.s.round.offset <= 12);
    assert.ok(g.s.queue.length <= 3);
});

test('Ansicht verrät die Lösung erst beim Auflösen', async () => {
    const g = newGame();
    const clock = { t: 1_000_000 };
    await startLive(g, clock);
    const v = g.view(1, clock.t);
    assert.equal(v.round.song, null);
    assert.ok(!JSON.stringify(v).includes(g.s.round.song.title), 'Titel nicht in der Ansicht');
    assert.ok(!JSON.stringify(v).includes(g.s.round.song.artist), 'Künstler nicht in der Ansicht');
    g.apply(0, { t: 'skip' }, clock.t);
    const r = g.view(1, clock.t).round;
    assert.equal(r.phase, 'reveal');
    assert.equal(r.song.title, g.s.round.song.title);
});

test('Wertung: Titel/Künstler je 1 Punkt, Erste(r) +1, beides = Bonus', async () => {
    const g = newGame();
    const clock = { t: 1_000_000 };
    await startLive(g, clock);
    const { title, artist } = g.s.round.song;
    let r = g.apply(0, { t: 'answer', text: 'keine Ahnung' }, clock.t);
    assert.match(r.notice, /Leider nicht/);
    assert.equal(g.s.players[0].score, 0);
    r = g.apply(0, { t: 'answer', text: title }, clock.t);
    assert.match(r.notice, /Titel \(zuerst!\)/);
    assert.equal(g.s.players[0].score, 2, 'Titel 1 + Erste(r) 1');
    r = g.apply(1, { t: 'answer', text: title }, clock.t);
    assert.equal(g.s.players[1].score, 1, 'zweite Person: nur 1');
    r = g.apply(0, { t: 'answer', text: title }, clock.t);
    assert.match(r.notice, /schon/);
    assert.equal(g.s.players[0].score, 2, 'nicht doppelt');
    r = g.apply(0, { t: 'answer', text: artist }, clock.t);
    assert.equal(g.s.players[0].score, 2 + 2 + 1, 'Künstler 1 + zuerst 1 + Bonus 1');
    assert.deepEqual(g.view(2, clock.t).players.map(p => [p.title, p.artist]), [[true, true], [true, false], [false, false]]);
    // beides in einem Tipp
    const g2 = newGame();
    const c2 = { t: 5_000_000 };
    await startLive(g2, c2);
    const s2 = g2.s.round.song;
    g2.apply(2, { t: 'answer', text: `${s2.title} ${s2.artist}` }, c2.t);
    assert.equal(g2.s.players[2].score, 2 + 2 + 1, 'Titel+Künstler+beide zuerst+Bonus');
});

test('Hinweise nach 10 s und 20 s, Ende nach 30 s, Auflösung dauert 9 s', async () => {
    const g = newGame();
    const clock = { t: 1_000_000 };
    await startLive(g, clock);
    const r = g.s.round;
    const seq0 = r.clipSeq;
    assert.equal(r.len, 5);
    assert.equal(g.view(0, clock.t).round.mask, null);
    clock.t += 10_100;
    assert.ok(g.tick(clock.t));
    assert.equal(r.hint, 1);
    assert.equal(r.len, 8);
    assert.ok(r.clipSeq > seq0, 'Ausschnitt wird erneut abgespielt');
    const m1 = g.view(0, clock.t).round.mask;
    assert.match(m1.title, /^[•\s]+$/, 'Hinweis 1: nur Wortlängen');
    clock.t += 10_000;
    g.tick(clock.t);
    assert.equal(r.hint, 2);
    assert.equal(r.len, 12);
    assert.match(g.view(0, clock.t).round.mask.title, /^S/, 'Hinweis 2: Anfangsbuchstabe');
    clock.t += 10_000;
    g.tick(clock.t);
    assert.equal(g.s.round.phase, 'reveal');
    clock.t += 9_100;
    g.tick(clock.t);
    assert.ok(g.s.round === null || g.s.round.id > r.id, 'nächste Runde');
});

test('Alle richtig: Auflösung sofort; Offline-Spieler blockieren nicht', async () => {
    const g = newGame(3);
    const clock = { t: 1_000_000 };
    await startLive(g, clock);
    g.setConnected(2, false);
    const { title, artist } = g.s.round.song;
    g.apply(0, { t: 'answer', text: `${title} ${artist}` }, clock.t);
    assert.equal(g.s.round.phase, 'live');
    g.apply(1, { t: 'answer', text: `${title} ${artist}` }, clock.t);
    assert.equal(g.s.round.phase, 'reveal');
});

test('Vorbereitung: Start sobald alle bereit sind, sonst nach 6 s', async () => {
    const g = newGame(3);
    const clock = { t: 1_000_000 };
    g.apply(0, { t: 'start' });
    await until(g, clock, () => g.s.round?.phase === 'prepare');
    const id = g.s.round.id;
    g.apply(0, { t: 'ready', round: id }, clock.t);
    g.apply(1, { t: 'ready', round: id + 99 }, clock.t); // falsche Runde zählt nicht
    assert.equal(g.s.round.phase, 'prepare');
    clock.t += 6_100;
    g.tick(clock.t);
    assert.equal(g.s.round.phase, 'live');
});

test('20 Runden, dann Siegerbildschirm; Weitere 20 Runden ohne Wiederholung, Punkte laufen weiter', async () => {
    const g = newGame(2);
    const clock = { t: 1_000_000 };
    const played = [];
    const playBlock = async () => {
        for (let n = 1; n <= ROUNDS; n++) {
            await until(g, clock, () => g.s.round?.phase === 'prepare' && g.s.roundNo === n);
            played.push(g.s.round.song.id);
            g.apply(0, { t: 'ready', round: g.s.round.id }, clock.t);
            g.apply(1, { t: 'ready', round: g.s.round.id }, clock.t);
            if (n % 2 === 0) g.apply(0, { t: 'answer', text: g.s.round.song.title }, clock.t);
            g.apply(0, { t: 'skip' }, clock.t);
            g.apply(0, { t: 'next' }, clock.t);
        }
        await until(g, clock, () => g.s.phase === 'over');
    };
    assert.ok(!g.apply(0, { t: 'start' }).error);
    await playBlock();
    assert.equal(g.s.roundNo, ROUNDS);
    const scoreAfterFirst = g.s.players[0].score;
    assert.equal(scoreAfterFirst, 10 * 2, '10 Treffer als Erste(r) je 2 Punkte');
    assert.ok(g.apply(0, { t: 'continue' }).error === undefined);
    assert.equal(g.s.block, 2);
    await playBlock();
    assert.equal(new Set(played).size, 2 * ROUNDS, 'keine Wiederholungen über beide Durchgänge');
    assert.equal(g.s.players[0].score, 2 * scoreAfterFirst, 'Punkte laufen weiter');
    assert.ok(!g.apply(1, { t: 'newGame' }).error);
    assert.equal(g.s.players[0].score, 0);
    assert.equal(g.s.block, 1);
});

test('Verlauf: bereits gespielte Songs werden gemieden, bei erschöpftem Vorrat wird zurückgesetzt', async () => {
    const catalog = fakeCatalog(30);
    const initial = new Set(catalog.slice(0, 25).map(c => c.id));
    const history = new Set(initial);
    let resets = 0;
    const g = newGame(2, { catalog, history, onHistoryReset: () => resets++ });
    const clock = { t: 1_000_000 };
    g.apply(0, { t: 'start' });
    await until(g, clock, () => g.s.round?.phase === 'prepare');
    const first = [g.s.round.song.id, ...g.s.queue.map(q => q.id)];
    assert.ok(first.every(id => !initial.has(id)), 'zuerst nur Songs außerhalb des Verlaufs');
    // nur noch 5 freie Songs, 20 Runden verlangt: der Verlauf muss irgendwann zurückgesetzt werden
    for (let n = 1; n <= ROUNDS; n++) {
        await until(g, clock, () => g.s.round?.phase === 'prepare' && g.s.roundNo === n);
        g.apply(0, { t: 'ready', round: g.s.round.id }, clock.t);
        g.apply(1, { t: 'ready', round: g.s.round.id }, clock.t);
        g.apply(0, { t: 'skip' }, clock.t);
        g.apply(0, { t: 'next' }, clock.t);
    }
    assert.ok(resets >= 1, 'Verlauf zurückgesetzt');
    assert.equal(new Set(g.s.used).size, g.s.used.length, 'im Raum keine Wiederholung');
});

test('Nicht auffindbare Songs werden übersprungen, Fehler von Apple führen zu Wiederholung', async () => {
    let calls = 0;
    const flaky = async c => {
        calls++;
        if (calls === 1) throw new Error('Apple hat die Abfrage gebremst');
        if (calls % 3 === 0) return null;
        return provider(c);
    };
    const g = newGame(2, { songProvider: flaky });
    const clock = { t: 1_000_000 };
    g.apply(0, { t: 'start' });
    clock.t += 500;
    g.tick(clock.t);
    await flush();
    assert.match(g.s.loadError, /gebremst/);
    assert.equal(g.s.phase, 'loading');
    await until(g, clock, () => g.s.phase === 'round', 1000);
    assert.equal(g.s.loadError, '');
    assert.ok(g.failed.size >= 1);
});

test('Vielfalt: derselbe Künstler kommt nicht in kurzer Folge', async () => {
    const catalog = Array.from({ length: 60 }, (_, i) => ({ id: `S${i}`, title: `S${i}`, artist: `A${i % 12}`, decade: 2000, lang: 'en' }));
    const g = newGame(2, { catalog });
    const clock = { t: 1_000_000 };
    g.apply(0, { t: 'start' });
    const artists = [];
    for (let n = 1; n <= 10; n++) {
        await until(g, clock, () => g.s.round?.phase === 'prepare' && g.s.roundNo === n);
        artists.push(g.s.round.song.artist);
        g.apply(0, { t: 'ready', round: g.s.round.id }, clock.t);
        g.apply(1, { t: 'ready', round: g.s.round.id }, clock.t);
        g.apply(0, { t: 'skip' }, clock.t);
        g.apply(0, { t: 'next' }, clock.t);
    }
    for (let i = 0; i < artists.length; i++) {
        for (let j = i + 1; j < Math.min(i + 6, artists.length); j++) assert.notEqual(artists[i], artists[j], `Künstler wiederholt in Runde ${i + 1} und ${j + 1}`);
    }
});

test('Nur der Gastgeber darf überspringen und weiter; Antworten nur live', async () => {
    const g = newGame(2);
    const clock = { t: 1_000_000 };
    g.apply(0, { t: 'start' });
    await until(g, clock, () => g.s.round?.phase === 'prepare');
    assert.ok(g.apply(0, { t: 'answer', text: 'x' }).error, 'noch nicht live');
    g.apply(0, { t: 'ready', round: g.s.round.id }, clock.t);
    g.apply(1, { t: 'ready', round: g.s.round.id }, clock.t);
    assert.ok(g.apply(1, { t: 'skip' }, clock.t).error);
    assert.ok(g.apply(0, { t: 'answer', text: '   ' }, clock.t).error, 'leere Eingabe');
    assert.ok(!g.apply(0, { t: 'skip' }, clock.t).error);
    assert.ok(g.apply(1, { t: 'next' }, clock.t).error);
    assert.ok(g.apply(0, { t: 'answer', text: 'x' }, clock.t).error, 'nicht mehr live');
});

test('Speichern und Wiederherstellen: laufende Runde wird aufgelöst', async () => {
    const g = newGame(2);
    const clock = { t: 1_000_000 };
    await startLive(g, clock);
    const copy = SongQuizGame.restore(g.serialize(), { rng: seeded(1), catalog: fakeCatalog() });
    assert.equal(copy.s.round.phase, 'reveal');
    assert.equal(copy.s.players[0].connected, false);
    assert.equal(copy.join('t0', 'x'), 0);
});

test('Schwerpunkt: etwa drei von vier Songs kommen aus dem Kern, der Rest aus allen Jahrzehnten', async () => {
    const catalog = Array.from({ length: 400 }, (_, i) => ({ id: `S${i}`, title: `S${i}`, artist: `A${i}`, decade: i % 2 ? 2010 : 1980, lang: 'en', core: i % 2 === 1 }));
    let core = 0;
    // viele Spiele anstoßen und die gezogenen Songs zählen
    for (let k = 0; k < 15; k++) {
        const game = new SongQuizGame({ rng: seeded(100 + k), catalog, songProvider: provider });
        game.join('a', 'A');
        game.join('b', 'B');
        game.apply(0, { t: 'start' });
        const clock = { t: 1_000_000 };
        for (let r = 1; r <= ROUNDS; r++) {
            await until(game, clock, () => game.s.round?.phase === 'prepare' && game.s.roundNo === r);
            if (catalog.find(c => c.id === game.s.round.song.id).core) core++;
            game.apply(0, { t: 'ready', round: game.s.round.id }, clock.t);
            game.apply(1, { t: 'ready', round: game.s.round.id }, clock.t);
            game.apply(0, { t: 'skip' }, clock.t);
            game.apply(0, { t: 'next' }, clock.t);
        }
    }
    const share = core / (15 * ROUNDS);
    assert.ok(share > 0.68 && share < 0.82, `Anteil Schwerpunkt: ${(share * 100).toFixed(0)} %`);
});
