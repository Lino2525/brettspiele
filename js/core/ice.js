// Wie sich zwei Browser über verschiedene Netze finden (WLAN, Mobilfunk, Ausland).
//   STUN: verrät dem Browser seine öffentliche Adresse; damit klappt die direkte Verbindung in den meisten Heimnetzen.
//   TURN: leitet die Daten weiter (Relais), wenn keine direkte Verbindung möglich ist, z. B. im Mobilfunk mit geteilter
//         IP-Adresse oder hinter strengen Firewalls. Ohne erreichbares Relais klappt es dann nur im selben Netz.
//
//   getIceServers()   Liste für RTCPeerConnection / PeerJS (wird einmal je Seite geladen)
//   probeIce()        prüft, welche Wege dieses Gerät gerade nutzen kann (für "Verbindung prüfen")

// ---------- Eigener Relais-Zugang (empfohlen) ----------
// Der kostenlose Relais-Server von PeerJS hat keine Garantie. Verlässlicher ist ein eigener kostenloser Zugang,
// siehe README "Verbindung über verschiedene Netze". Eines von beiden eintragen:
//   1) Metered (Open Relay): Adresse für die Zugangsdaten inklusive API-Schlüssel, z. B.
//      'https://DEIN-NAME.metered.live/api/v1/turn/credentials?apiKey=DEIN-SCHLÜSSEL'
export const TURN_CREDENTIALS_URL = '';
//   2) Feste Zugangsdaten eines Anbieters (z. B. ExpressTURN), z. B.
//      { urls: ['turn:relay1.expressturn.com:3478', 'turn:relay1.expressturn.com:3478?transport=tcp'], username: '…', credential: '…' }
export const EXTRA_TURN = [];

// Öffentliche STUN-Server (zwei Anbieter, falls einer ausfällt)
const STUN = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];
// Kostenloses Relais von PeerJS (bisher der einzige TURN-Server); auch über TCP, falls UDP gesperrt ist
const PEERJS_TURN = {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478'],
    username: 'peerjs',
    credential: 'peerjsp',
};

const FETCH_TIMEOUT_MS = 4000;
let cached = null;

async function fetchTurn() {
    if (!TURN_CREDENTIALS_URL) return [];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(TURN_CREDENTIALS_URL, { signal: ctl.signal });
        const list = await res.json();
        return Array.isArray(list) ? list.filter(s => s && s.urls) : [];
    } catch {
        return []; // Anbieter nicht erreichbar: dann eben mit den übrigen Servern
    } finally {
        clearTimeout(timer);
    }
}

export const hasOwnTurn = () => !!TURN_CREDENTIALS_URL || EXTRA_TURN.length > 0;

export function getIceServers() {
    if (!cached) {
        cached = fetchTurn().then(own => {
            const turn = [...own, ...EXTRA_TURN];
            // Mit eigenem Relais wird das PeerJS-Relais nur noch als Reserve angehängt
            return [...STUN, ...turn, PEERJS_TURN];
        });
    }
    return cached;
}

// Sammelt die Verbindungswege dieses Geräts: host (nur im eigenen Netz), srflx (direkt über STUN), relay (über TURN).
export async function probeIce(ms = 8000) {
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    const found = { host: 0, srflx: 0, prflx: 0, relay: 0 };
    try {
        pc.createDataChannel('probe');
        const done = new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            pc.addEventListener('icecandidate', e => {
                if (!e.candidate) {
                    clearTimeout(timer);
                    resolve();
                    return;
                }
                const type = e.candidate.type || /typ (\w+)/.exec(e.candidate.candidate)?.[1];
                if (type in found) found[type]++;
            });
        });
        await pc.setLocalDescription(await pc.createOffer());
        await done;
    } finally {
        pc.close();
    }
    return { ...found, ownTurn: hasOwnTurn() };
}
