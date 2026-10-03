import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, levenshtein, titleKeys, artistKeys, checkGuess, maskText } from '../js/games/songquiz/answer.js';

const song = (title, artist) => ({ title, artist });
const t = (guess, title, artist = 'Egal') => checkGuess(guess, song(title, artist)).title;
const a = (guess, artist, title = 'Egal') => checkGuess(guess, song(title, artist)).artist;

test('Normalisieren: Akzente, Umlaute, Sonderzeichen, Apostrophe', () => {
    assert.equal(normalize("Don't Stop Believin'"), 'dont stop believin');
    assert.equal(normalize('Rosalía'), 'rosalia');
    assert.equal(normalize('Über sieben Brücken'), 'ueber sieben bruecken');
    assert.equal(normalize('Guns N\' Roses'), 'guns n roses');
    assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel');
});

test('Levenshtein', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('gleich', 'gleich'), 0);
});

test('Titel: exakt, Groß-/Kleinschreibung, Satzzeichen, Tippfehler', () => {
    assert.ok(t('Mr. Brightside', 'Mr. Brightside'));
    assert.ok(t('mr brightside', 'Mr. Brightside'));
    assert.ok(t('MR BRIGHTSIDE', 'Mr. Brightside'));
    assert.ok(t('mr brigthside', 'Mr. Brightside'), 'ein Buchstabendreher');
    assert.ok(t('dont stop believing', "Don't Stop Believin'"));
    assert.ok(t('Dancing Queen', 'Dancing Queen'));
    assert.ok(t('dancing quen', 'Dancing Queen'));
    assert.ok(!t('dancing king', 'Dancing Queen'));
    assert.ok(!t('', 'Dancing Queen'));
    assert.ok(!t('   ', 'Dancing Queen'));
});

test('Titel: Klammern, Zusätze und feat. sind optional', () => {
    assert.ok(t('billie jean', 'Billie Jean (Single Version)'));
    assert.ok(t('uptown funk', 'Uptown Funk (feat. Bruno Mars)'));
    assert.ok(t('uptown funk', 'Uptown Funk feat. Bruno Mars'));
    assert.ok(t('i do it for you', '(Everything I Do) I Do It for You'));
    assert.ok(t('everything i do i do it for you', '(Everything I Do) I Do It for You'));
    assert.ok(t('despacito', 'Despacito - Remix'));
    assert.ok(t('rolling in the deep', 'Rolling in the Deep'));
});

test('Titel: kurze Titel verlangen genaue Treffer, keine Zufallstreffer', () => {
    assert.ok(t('africa', 'Africa'));
    assert.ok(!t('america', 'Africa'));
    assert.ok(t('hero', 'Hero'));
    assert.ok(!t('here', 'Hero'));
    assert.ok(t('sos', 'SOS'));
    assert.ok(!t('so', 'SOS'));
});

test('Titel und Künstler in einem Tipp', () => {
    const s = song('Mr. Brightside', 'The Killers');
    assert.deepEqual(checkGuess('mr brightside the killers', s), { title: true, artist: true });
    assert.deepEqual(checkGuess('killers mr brightside', s), { title: true, artist: true });
    assert.deepEqual(checkGuess('mr brightside', s), { title: true, artist: false });
    assert.deepEqual(checkGuess('the killers', s), { title: false, artist: true });
    assert.deepEqual(checkGuess('killers', s), { title: false, artist: true }, 'ohne "The"');
    assert.deepEqual(checkGuess('keine ahnung', s), { title: false, artist: false });
});

test('Künstler: mehrere Beteiligte, Akzente, ohne The', () => {
    assert.ok(a('bruno mars', 'Mark Ronson feat. Bruno Mars'));
    assert.ok(a('mark ronson', 'Mark Ronson feat. Bruno Mars'));
    assert.ok(a('simon', 'Simon & Garfunkel'), 'bei mehreren Beteiligten genügt einer');
    assert.ok(a('garfunkel', 'Simon & Garfunkel'));
    assert.ok(a('simon and garfunkel', 'Simon & Garfunkel'));
    assert.ok(a('rosalia', 'Rosalía'));
    assert.ok(a('beatles', 'The Beatles'));
    assert.ok(a('abba', 'ABBA'));
    assert.ok(a('ed sheran', 'Ed Sheeran'));
        assert.ok(a('guns n roses', "Guns N' Roses"));
    assert.ok(a('helene fischer', 'Helene Fischer'));
    assert.ok(a('die toten hosen', 'Die Toten Hosen'));
    assert.ok(a('toten hosen', 'Die Toten Hosen'));
});

test('Deutsche Titel mit Umlauten: ue/ü und u sind austauschbar', () => {
    assert.ok(t('ueber sieben bruecken musst du gehn', 'Über sieben Brücken musst du gehn'));
    assert.ok(t('uber sieben brucken musst du gehn', 'Über sieben Brücken musst du gehn'));
    assert.ok(t('99 luftballons', '99 Luftballons'));
    assert.ok(t('neunundneunzig luftballons', '99 Luftballons') === false);
    assert.ok(t('atemlos durch die nacht', 'Atemlos durch die Nacht'));
});

test('Zu laxe Treffer werden verhindert', () => {
    assert.ok(!t('the', 'The Final Countdown'));
    assert.ok(!t('final', 'The Final Countdown'));
    assert.ok(t('final countdown', 'The Final Countdown'));
        assert.ok(!t('you', 'Billie Jean'));
});

test('Schlüssel', () => {
    assert.ok(titleKeys('Billie Jean (Single Version)').includes('billie jean'));
    assert.ok(artistKeys('The Beatles').includes('beatles'));
    assert.ok(artistKeys('Mark Ronson feat. Bruno Mars').includes('bruno mars'));
});

test('Hinweis-Maske', () => {
    assert.equal(maskText('Mr. Brightside', 1), '••.   ••••••••••');
    assert.equal(maskText('Dancing Queen', 2), 'D••••••   Q••••');
    assert.equal(maskText('ABBA', 2), 'A•••');
});
