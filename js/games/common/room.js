// Gemeinsame Grundlage der Gesellschaftsspiele für 3 bis 6 Personen: Mitspieler, Teams, Start und Neustart.
// Eine Spielklasse erbt davon und ergänzt Zustand (initialState), Start (begin), eigene Aktionen (act) und Ansicht (gameView).
export const HOST_SEAT = 0;
export const TEAM_NAMES = ['Team Rot', 'Team Blau'];
export const MIN_TEAM_PLAYERS = 4; // Teams gibt es erst ab dieser Spielerzahl

export const err = error => ({ error });
export const OK = { ok: true };

export function defaultRng() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export function shuffled(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export class RoomGame {
    static MIN = 3;
    static MAX = 6;
    static TEAMS = false; // Kann das Spiel in Teams gespielt werden?

    constructor({ rng = defaultRng } = {}) {
        this.rng = rng;
        this.s = { phase: 'waiting', players: [], moveNo: 0, teamMode: false, log: [], ...this.initialState() };
    }

    // ---------- Von Spielen zu überschreiben ----------
    initialState() { return {}; }
    newPlayer() { return {}; }
    begin() { throw new Error('begin() fehlt'); } // startet (oder wiederholt) das Spiel
    act() { return err('Unbekannte Aktion.'); }
    gameView() { return {}; }
    afterRestore() {}

    static restore(data, opts) {
        const game = new this(opts);
        game.s = data;
        for (const p of game.s.players) p.connected = false;
        game.afterRestore();
        return game;
    }

    get cls() { return this.constructor; }

    serialize() {
        return JSON.parse(JSON.stringify(this.s));
    }

    hasPlayer(token) {
        return this.s.players.some(p => p.token === token);
    }

    join(token, name) {
        const s = this.s;
        const seat = s.players.findIndex(p => p.token === token);
        if (seat >= 0) {
            s.players[seat].connected = true;
            return seat;
        }
        if (s.phase !== 'waiting' || s.players.length >= this.cls.MAX) return -1;
        const base = String(name ?? '').trim().slice(0, 20) || 'Spieler';
        let clean = base;
        for (let n = 2; s.players.some(p => p.name === clean); n++) clean = `${base} ${n}`;
        const team = s.players.filter(p => p.team === 0).length <= s.players.filter(p => p.team === 1).length ? 0 : 1;
        s.players.push({ name: clean, token, connected: true, team, ...this.newPlayer() });
        s.moveNo++;
        return s.players.length - 1;
    }

    setConnected(seat, connected) {
        if (this.s.players[seat]) this.s.players[seat].connected = connected;
    }

    bump() {
        this.s.moveNo++;
    }

    say(text) {
        this.s.log.push(text);
        if (this.s.log.length > 30) this.s.log.shift();
    }

    // ---------- Aktionen ----------

    apply(seat, a, now = Date.now()) {
        const s = this.s;
        if (!s.players[seat]) return err('Unbekannter Spieler.');
        let result;
        switch (a?.t) {
            case 'start': result = this.#start(seat, now); break;
            case 'rematch': result = this.#rematch(now); break;
            case 'teamMode': result = this.#teamMode(seat, !!a.on); break;
            case 'shuffleTeams': result = this.#shuffleTeams(seat); break;
            case 'team': result = this.#switchTeam(seat, a.team); break;
            default: result = this.act(seat, a, now);
        }
        if (!result.error) s.moveNo++;
        return result;
    }

    #start(seat, now) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das Spiel starten.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (s.players.length < this.cls.MIN) return err(`Es fehlen noch Mitspieler (mindestens ${this.cls.MIN}).`);
        const problem = this.#teamProblem();
        if (problem) return err(problem);
        this.begin(now);
        return OK;
    }

    #rematch(now) {
        const s = this.s;
        if (s.phase !== 'over') return err('Das Spiel läuft noch.');
        if (this.#teamProblem()) s.teamMode = false;
        this.begin(now);
        return OK;
    }

    #teamProblem() {
        const s = this.s;
        if (!s.teamMode) return null;
        if (s.players.length < MIN_TEAM_PLAYERS) return `Teams gibt es erst ab ${MIN_TEAM_PLAYERS} Personen.`;
        const a = s.players.filter(p => p.team === 0).length;
        const b = s.players.length - a;
        if (a < 2 || b < 2) return 'Jedes Team braucht mindestens 2 Personen.';
        return null;
    }

    #teamMode(seat, on) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das ändern.');
        if (s.phase !== 'waiting') return err('Das Spiel läuft schon.');
        if (!this.cls.TEAMS) return err('Dieses Spiel gibt es nur ohne Teams.');
        if (on && s.players.length < MIN_TEAM_PLAYERS) return err(`Teams gibt es erst ab ${MIN_TEAM_PLAYERS} Personen.`);
        s.teamMode = on;
        if (on) this.#assignTeams();
        return OK;
    }

    #shuffleTeams(seat) {
        const s = this.s;
        if (seat !== HOST_SEAT) return err('Nur wer den Raum erstellt hat, kann das ändern.');
        if (s.phase !== 'waiting' || !s.teamMode) return err('Gerade nicht möglich.');
        this.#assignTeams();
        return OK;
    }

    #assignTeams() {
        const order = shuffled(this.s.players.map((p, i) => i), this.rng);
        order.forEach((seat, k) => (this.s.players[seat].team = k % 2));
    }

    #switchTeam(seat, team) {
        const s = this.s;
        if (s.phase !== 'waiting' || !s.teamMode) return err('Gerade nicht möglich.');
        if (team !== 0 && team !== 1) return err('Ungültiges Team.');
        s.players[seat].team = team;
        return OK;
    }

    // ---------- Wertung ----------

    // Platzierung nach Punkten (Gleichstand: gleicher Platz). Mit Teams zusätzlich die Teamwertung.
    standings(scoreOf) {
        const s = this.s;
        const rows = s.players.map((p, seat) => ({ seat, score: scoreOf(seat), team: p.team }));
        const rank = list => {
            const sorted = [...list].sort((a, b) => b.score - a.score || (a.seat ?? a.team) - (b.seat ?? b.team));
            sorted.forEach((r, i) => (r.rank = i > 0 && sorted[i - 1].score === r.score ? sorted[i - 1].rank : i + 1));
            return sorted;
        };
        const players = rank(rows);
        let teams = null;
        if (s.teamMode) {
            teams = rank([0, 1].map(team => ({ team, score: rows.filter(r => r.team === team).reduce((sum, r) => sum + r.score, 0) })));
        }
        return { players, teams };
    }

    // ---------- Ansicht ----------

    view(seat, now = Date.now()) {
        const s = this.s;
        return {
            phase: s.phase,
            seat,
            hostSeat: HOST_SEAT,
            minPlayers: this.cls.MIN,
            maxPlayers: this.cls.MAX,
            canTeam: this.cls.TEAMS,
            minTeamPlayers: MIN_TEAM_PLAYERS,
            teamMode: s.teamMode,
            teamNames: TEAM_NAMES,
            moveNo: s.moveNo,
            players: s.players.map(p => ({ name: p.name, connected: p.connected, team: p.team })),
            log: s.log,
            ...this.gameView(seat, now),
        };
    }
}
