// Holt zu einem Song aus der Liste die 30-Sekunden-Vorschau über die kostenlose iTunes-Suche (Apple).
// Es wird nichts gespeichert oder gehostet: der Ton kommt direkt von Apples Servern in den Browser.
// Läuft im Browser und in Node (fetch).
import { normalize, titleKeys } from './answer.js';

const MIN_GAP_MS = 2600; // Apple erlaubt grob 20 Abfragen pro Minute und Adresse
// Ganze Wörter prüfen, sonst trifft "live" auch "Alive"
const UNWANTED = /\b(remix|karaoke|tribute|cover|instrumental|made famous|originally performed|in the style|8-bit|lullaby|piano version|acoustic|live|demo|medley|sped up|slowed|nightcore|stripped|unplugged)\b/i;
const SOFT_UNWANTED = /\b(version|edit|mix|remaster(ed)?|extended|radio)\b/i;

let lastCall = 0;
let chain = Promise.resolve();

// Alle Abfragen laufen nacheinander mit Mindestabstand.
function throttled(fn) {
    const run = chain.then(async () => {
        const wait = lastCall + MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastCall = Date.now();
        return fn();
    });
    chain = run.catch(() => {});
    return run;
}

export class RateLimitError extends Error {}

async function search(term, country) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=20&country=${country}`;
    const res = await throttled(() => fetch(url));
    if (res.status === 403 || res.status === 429) throw new RateLimitError(`Apple hat die Abfrage gebremst (${res.status})`);
    if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`);
    const data = await res.json();
    return data.results || [];
}

// Bewertet einen Treffer: wie gut passt er zum gesuchten Original? Negativ = unbrauchbar.
export function scoreResult(r, song) {
    if (!r.previewUrl) return -100;
    const name = r.trackName || '';
    const keys = titleKeys(song.title);
    const rKeys = titleKeys(name);
    let score = 0;
    if (rKeys.some(k => keys.includes(k))) score += 10;
    else if (rKeys.some(k => keys.some(t => k.startsWith(t) || t.startsWith(k)))) score += 4;
    else return -100;
    // Künstler: der erste Name des gesuchten Künstlers muss vorkommen
    const first = normalize(song.artist).replace(/^the /, '').split(' ')[0];
    const artistN = normalize(r.artistName || '');
    if (!artistN.includes(first)) return -100;
    if (UNWANTED.test(name) || UNWANTED.test(r.collectionName || '')) score -= 8;
    if (SOFT_UNWANTED.test(name)) score -= 1.5;
    if (normalize(r.artistName || '').split(' and ').length > 2) score -= 1;
    if ((r.trackTimeMillis || 0) > 130000) score += 0.5; // volle Songlänge statt Schnipsel
    return score;
}

export function pickBest(results, song) {
    let best = null;
    let bestScore = 3;
    for (const r of results) {
        const s = scoreResult(r, song);
        if (s > bestScore) {
            best = r;
            bestScore = s;
        }
    }
    return best;
}

// Gibt { id, title, artist, previewUrl, art } zurück oder null, wenn nichts Passendes gefunden wurde.
export async function resolveSong(song) {
    for (const country of ['DE', 'US']) {
        const results = await search(`${song.title} ${song.artist}`, country);
        const hit = pickBest(results, song);
        if (hit) {
            return {
                id: song.id,
                title: song.title,
                artist: song.artist,
                previewUrl: hit.previewUrl,
                art: (hit.artworkUrl100 || '').replace('100x100', '300x300'),
            };
        }
    }
    return null;
}
