// Oberfläche fürs Lieder-Raten: Ausschnitt anhören, Titel/Künstler tippen, Hinweise, Auflösung, Rangliste.
// Der Ton kommt als 30-Sekunden-Vorschau direkt von Apples Servern. Alle laden ihn vor und starten gemeinsam,
// sobald der Host die Runde freigibt. Der Ausschnitt läuft dann ohne Pause durch, bis der nächste Song kommt.
import { music } from '../../core/music.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => (n > 0 ? `+${n}` : String(n));
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const TEMPLATE = `
<div class="quiz">
  <div class="qtop"><span class="qround"></span><span class="qhost"></span></div>
  <div class="qbar"><i></i></div>
  <div class="qstage">
    <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="qstatus"></div>
    <div class="qmask"></div>
    <div class="qreveal" hidden><img class="qcover" alt=""><div class="qsong"></div></div>
  </div>
  <form class="qform" autocomplete="off">
    <input class="qinput" type="text" maxlength="80" placeholder="Titel oder Künstler …" enterkeyhint="send" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button class="btn primary" type="submit">Raten</button>
  </form>
  <div class="qmine"></div>
  <div class="qplayers"></div>
  <div class="overlay" hidden><div class="overlay-box"></div></div>
  <div class="tapfix" hidden><button class="btn primary big" type="button">🔊 Ton aktivieren</button></div>
  <div class="toast" hidden></div>
</div>`;

export function mountSongQuiz(root, session) {
    root.innerHTML = TEMPLATE;
    const $ = sel => root.querySelector(sel);
    const el = {
        round: $('.qround'), host: $('.qhost'), bar: $('.qbar i'), eq: $('.eq'), status: $('.qstatus'), mask: $('.qmask'),
        reveal: $('.qreveal'), cover: $('.qcover'), song: $('.qsong'), form: $('.qform'), input: $('.qinput'),
        mine: $('.qmine'), players: $('.qplayers'), overlay: $('.overlay'), overlayBox: $('.overlay-box'),
        tapfix: $('.tapfix'), toast: $('.toast'),
    };

    const st = { view: null, receivedAt: 0, avatars: [], loadedId: null, playedFor: null };
    const audio = new Audio();
    audio.preload = 'auto';
    let toastTimer = null;
    let readyTimer = null;

    // ---------- Ton ----------

    const unsubscribe = music.subscribe(({ volume, muted }) => {
        audio.volume = muted ? 0 : Math.min(1, volume ** 2 * 1.2);
    });

    audio.addEventListener('playing', () => el.eq.classList.add('on'));
    for (const ev of ['pause', 'ended', 'emptied']) audio.addEventListener(ev, () => el.eq.classList.remove('on'));

    // Manche Browser (v. a. iPhone) erlauben Ton erst nach einer Berührung: beim ersten Tippen freischalten.
    let unlocked = false;
    root.addEventListener('pointerdown', () => {
        if (unlocked) return;
        unlocked = true;
        if (st.loadedId === null) {
            audio.src = SILENT_WAV;
            audio.play().then(() => audio.pause()).catch(() => {});
        }
    });

    // Position im Ausschnitt, an der der Host gerade ist (läuft lokal zwischen seinen Meldungen weiter)
    function songPosition() {
        const r = st.view?.round;
        if (!r) return 0;
        return r.offset + (r.playMs + performance.now() - st.receivedAt) / 1000;
    }

    function playSong() {
        const go = () => {
            try { audio.currentTime = songPosition(); } catch { /* noch nicht bereit, Position folgt beim Start */ }
            const p = audio.play();
            if (p) p.then(() => (el.tapfix.hidden = true)).catch(() => (el.tapfix.hidden = false));
        };
        if (audio.readyState >= 1) go();
        else audio.addEventListener('loadedmetadata', go, { once: true });
    }

    function stopAudio() {
        audio.pause();
    }

    function loadRound(r) {
        st.loadedId = r.id;
        st.playedFor = null;
        audio.src = r.url;
        audio.load();
        let sent = false;
        const ready = () => {
            if (sent) return;
            sent = true;
            clearTimeout(readyTimer);
            session.send({ t: 'ready', round: r.id });
        };
        audio.addEventListener('canplaythrough', ready, { once: true });
        audio.addEventListener('loadedmetadata', () => setTimeout(ready, 400), { once: true });
        clearTimeout(readyTimer);
        readyTimer = setTimeout(ready, 2500); // Handys laden erst beim Abspielen: nicht ewig warten
    }

    el.tapfix.querySelector('button').addEventListener('click', () => {
        el.tapfix.hidden = true;
        const r = st.view?.round;
        if (r && (r.phase === 'live' || r.phase === 'reveal')) playSong();
    });

    // ---------- Zustand ----------

    function applyView(v) {
        st.view = v;
        st.receivedAt = performance.now();
        const r = v.round;
        if (v.phase === 'round' && r) {
            if (st.loadedId !== r.id) loadRound(r);
            // einmal pro Runde starten, danach läuft der Ausschnitt durch (auch während der Auflösung)
            if ((r.phase === 'live' || r.phase === 'reveal') && st.playedFor !== r.id) {
                st.playedFor = r.id;
                playSong();
            }
        } else if (v.phase !== 'round') {
            stopAudio();
        }
    }

    // ---------- Anzeige ----------

    function render() {
        const v = st.view;
        const r = v.round;
        const isHost = v.seat === v.hostSeat;
        el.round.textContent = v.phase === 'waiting' ? 'Lieder-Raten' : `Runde ${Math.max(1, v.roundNo)} von ${v.rounds}${v.block > 1 ? ` · Durchgang ${v.block}` : ''}`;

        // Host-Knöpfe
        let hostBtn = '';
        if (isHost && r && r.phase === 'live') hostBtn = '<button class="btn small" type="button" data-act="skip">Überspringen</button>';
        if (isHost && r && r.phase === 'reveal') hostBtn = '<button class="btn small" type="button" data-act="next">Weiter</button>';
        if (el.host.dataset.html !== hostBtn) {
            el.host.dataset.html = hostBtn;
            el.host.innerHTML = hostBtn;
        }

        // Bühne
        const live = r && r.phase === 'live';
        const reveal = r && r.phase === 'reveal';
        el.reveal.hidden = !reveal;
        el.mask.innerHTML = '';
        if (v.phase === 'loading') {
            el.status.textContent = v.loadError ? `Verbindungsproblem (${v.loadError}). Es wird erneut versucht …` : `Songs werden geladen … (${v.ready} bereit)`;
        } else if (r && r.phase === 'prepare') {
            el.status.textContent = 'Gleich geht’s los … der Ton wird geladen';
        } else if (live) {
            el.status.textContent = 'Welches Lied ist das?';
            if (r.mask) {
                el.mask.innerHTML = `<div><small>Titel</small> ${esc(r.mask.title)}</div><div><small>Künstler</small> ${esc(r.mask.artist)}</div>`;
            }
        } else if (reveal) {
            el.status.textContent = '';
            el.cover.src = r.song.art || '';
            el.cover.hidden = !r.song.art;
            const me = r.gain && r.gain[v.seat] ? `<div class="qgain">Du: ${fmt(r.gain[v.seat])}</div>` : '<div class="qgain none">Diesmal nichts</div>';
            el.song.innerHTML = `<strong>${esc(r.song.title)}</strong><span>${esc(r.song.artist)}</span>${me}`;
        } else {
            el.status.textContent = '';
        }

        // Eingabe
        el.input.disabled = !live;
        el.form.querySelector('button').disabled = !live;
        el.mine.innerHTML = live || reveal
            ? `<span class="${r.my?.title ? 'got' : ''}">${r.my?.title ? '✓' : '○'} Titel</span><span class="${r.my?.artist ? 'got' : ''}">${r.my?.artist ? '✓' : '○'} Künstler</span>`
            : '';

        renderPlayers(r, reveal);
        renderOverlay();
        updateBar();
    }

    function renderPlayers(r, reveal) {
        const v = st.view;
        const rows = v.players
            .map((p, i) => ({ p, i }))
            .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
            .map(({ p, i }) => {
                const avatar = st.avatars[i];
                const gain = reveal && r.gain && r.gain[i] ? `<b class="gain">${fmt(r.gain[i])}</b>` : '';
                const marks = v.phase === 'round' && r && r.phase !== 'prepare'
                    ? `<span class="marks"><i class="${p.title ? 'on' : ''}" title="Titel gefunden">🎵</i><i class="${p.artist ? 'on' : ''}" title="Künstler gefunden">🎤</i></span>`
                    : '';
                return `<div class="qp${i === v.seat ? ' me' : ''}${p.connected ? '' : ' off'}">
                    <span class="qav" style="${avatar ? `background-image:url('${avatar}')` : ''}">${avatar ? '' : esc(p.name.slice(0, 1).toUpperCase())}</span>
                    <span class="qname">${esc(p.name)}</span>${marks}${gain}<span class="qscore">${p.score}</span></div>`;
            })
            .join('');
        if (el.players.dataset.html !== rows) {
            el.players.dataset.html = rows;
            el.players.innerHTML = rows;
        }
    }

    function renderOverlay() {
        const v = st.view;
        let html = '';
        if (v.phase === 'waiting') {
            const list = v.players.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</li>`).join('');
            const isHost = v.seat === v.hostSeat;
            html = `<h2>Lieder-Raten</h2><ul class="plist">${list}</ul>
                <p>Es können ${v.minPlayers} bis ${v.maxPlayers} Personen mitspielen. Hört 20 Sekunden aus bekannten Hits und tippt Titel oder Künstler.</p>
                <p class="muted">Tippe einmal auf den Bildschirm, damit der Ton läuft.</p>` +
                (isHost
                    ? `<button class="btn primary" data-act="start" type="button"${v.players.length >= v.minPlayers ? '' : ' disabled'}>Spiel starten</button>`
                    : `<p>Warte, bis ${esc(v.players[v.hostSeat].name)} das Spiel startet.</p>`);
        } else if (v.phase === 'over') {
            const ranking = v.players
                .map((p, i) => ({ p, i }))
                .sort((a, b) => b.p.score - a.p.score || a.i - b.i);
            const top = ranking[0].p.score;
            const winners = ranking.filter(x => x.p.score === top).map(x => esc(x.p.name));
            const title = ranking.length && winners.length === 1
                ? (ranking[0].i === v.seat ? 'Du hast gewonnen!' : `${winners[0]} hat gewonnen`)
                : `Gleichstand: ${winners.join(', ')}`;
            const rows = ranking
                .map(({ p, i }, k) => `<tr class="${p.score === top ? 'win' : ''}"><td>${k + 1}.</td><td>${esc(p.name)}${i === v.seat ? ' (Du)' : ''}</td><td>${p.score}</td></tr>`)
                .join('');
            html = `<h2>${title}</h2><p>Durchgang ${v.block} mit ${v.rounds} Runden ist vorbei.</p>
                <table class="ranking"><thead><tr><th></th><th></th><th>Punkte</th></tr></thead><tbody>${rows}</tbody></table>
                <div class="row center">
                    <button class="btn primary" data-act="continue" type="button">Weitere ${v.rounds} Runden</button>
                    <button class="btn" data-act="newGame" type="button">Neues Spiel (Punkte auf 0)</button>
                </div>`;
        }
        el.overlay.hidden = !html;
        if (html && el.overlayBox.innerHTML !== html) el.overlayBox.innerHTML = html;
    }

    // Fortschrittsbalken: läuft lokal zwischen den Meldungen des Hosts
    function updateBar() {
        const v = st.view;
        const r = v?.round;
        if (!r) {
            el.bar.style.width = '0%';
            return;
        }
        const elapsed = performance.now() - st.receivedAt;
        let frac = 0;
        let cls = '';
        if (r.phase === 'live') {
            frac = Math.max(0, r.liveMsLeft - elapsed) / r.liveMsTotal;
        } else if (r.phase === 'reveal') {
            frac = Math.max(0, r.revealMsLeft - elapsed) / r.revealMsTotal;
            cls = 'reveal';
        } else {
            frac = 1;
            cls = 'wait';
        }
        el.bar.style.width = `${(frac * 100).toFixed(1)}%`;
        el.bar.className = cls;
    }
    const barTimer = setInterval(updateBar, 200);

    function toast(text) {
        el.toast.textContent = text;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
    }

    // ---------- Eingaben ----------

    el.form.addEventListener('submit', e => {
        e.preventDefault();
        const text = el.input.value.trim();
        if (!text) return;
        session.send({ t: 'answer', text });
        el.input.value = '';
        el.input.focus();
    });

    root.addEventListener('click', e => {
        const t = e.target.closest('[data-act]');
        if (t && st.view) session.send({ t: t.dataset.act });
    });

    // ---------- Anbindung ----------

    session.onView = v => {
        applyView(v);
        render();
    };
    session.onNotice = text => toast(text);
    session.onAvatars = list => {
        st.avatars = list;
        if (st.view) renderPlayers(st.view.round, st.view.round?.phase === 'reveal');
    };

    return {
        destroy() {
            clearInterval(barTimer);
            clearTimeout(readyTimer);
            audio.pause();
            unsubscribe();
            root.innerHTML = '';
        },
    };
}
