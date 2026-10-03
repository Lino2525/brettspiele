// Abgleich getippter Antworten mit Titel und Künstler. Großzügig bei Tippfehlern, Groß-/Kleinschreibung,
// Akzenten, Sonderzeichen, "feat." und Klammern. Reine Logik ohne Browser-Abhängigkeiten.

export function normalize(text) {
    return String(text)
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’`´]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const stripThe = s => s.replace(/^(the|die|der|das) (?=.)/, '');

export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

// Alle akzeptierten Schreibweisen eines Titels: vollständig, ohne Klammern, ohne Zusatz nach " - ", ohne "feat."
export function titleKeys(title) {
    const keys = new Set();
    const add = s => {
        const n = stripThe(normalize(s));
        if (n) keys.add(n);
    };
    const noFeat = String(title).replace(/\b(feat|ft|featuring)\b\.?.*$/i, '');
    add(noFeat);
    add(noFeat.replace(/[(\[][^)\]]*[)\]]/g, '')); // ohne Klammern
    add(noFeat.split(' - ')[0]);
    add(noFeat.split(' - ')[0].replace(/[(\[][^)\]]*[)\]]/g, ''));
    // Titel, der nur aus Klammern besteht (z. B. "(Sittin' On) The Dock of the Bay"): Inhalt ohne Klammerzeichen
    add(noFeat.replace(/[()[\]]/g, ' '));
    return [...keys];
}

// Alle akzeptierten Schreibweisen eines Künstlers: ganzer Name und jeder Einzelname bei mehreren Beteiligten
export function artistKeys(artist) {
    const keys = new Set();
    const add = s => {
        const n = stripThe(normalize(s));
        if (n) keys.add(n);
    };
    add(artist);
    for (const part of String(artist).split(/\s*(?:,|&|\band\b|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b|\bwith\b|\bvs\b\.?|\bx\b)\s*/i)) add(part);
    return [...keys];
}

function tolerance(len) {
    return len <= 4 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : 3;
}

function matches(guess, target) {
    if (!target) return false;
    if (guess === target) return true;
    const tol = tolerance(target.length);
    if (levenshtein(guess, target) <= tol) return true;
    // Das Ziel steht als Wortfolge im Tipp (z. B. wenn Titel und Künstler zusammen eingegeben werden)
    const gw = guess.split(' ');
    const tw = target.split(' ');
    for (let i = 0; i + tw.length <= gw.length; i++) {
        if (tw.length === gw.length) break;
        const win = gw.slice(i, i + tw.length).join(' ');
        if (win === target || (target.length >= 5 && levenshtein(win, target) <= tol)) return true;
    }
    return false;
}

export function matchesAny(guessText, keys) {
    const guess = stripThe(normalize(guessText));
    if (!guess) return false;
    return keys.some(k => matches(guess, k));
}

// Prüft einen Tipp gegen Titel und Künstler eines Songs.
export function checkGuess(guessText, song) {
    return {
        title: matchesAny(guessText, titleKeys(song.title)),
        artist: matchesAny(guessText, artistKeys(song.artist)),
    };
}

// Hinweis-Maske: Wortlängen ("• • •   • • • •"), mit Anfangsbuchstaben bei level >= 2
export function maskText(text, level) {
    return String(text)
        .split(' ')
        .map(word =>
            [...word]
                .map((ch, i) => {
                    if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
                    return level >= 2 && i === 0 ? ch : '•';
                })
                .join(''),
        )
        .join('   ');
}
