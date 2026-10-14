'use strict';

// ── iCUE property reader ──────────────────────────────────────────────────────
// Reads an iCUE-injected global variable; falls back to `fallback` outside iCUE.
function prop(name, fallback) {
    try {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            const v = window[name];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        const v2 = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
        if (v2 !== undefined && v2 !== null && v2 !== '') return v2;
    } catch (e) { /* ignore */ }
    return fallback;
}

// ── Country metadata ──────────────────────────────────────────────────────────
const COUNTRIES = {
    DK: '🇩🇰', CN: '🇨🇳', JP: '🇯🇵', KR: '🇰🇷',
    ID: '🇮🇩', MY: '🇲🇾', IN: '🇮🇳', TH: '🇹🇭',
    GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', TW: '🇹🇼',
    HK: '🇭🇰', ES: '🇪🇸', AU: '🇦🇺', CA: '🇨🇦',
};
const flag = code => COUNTRIES[code] || '🏳';

// ── Sofascore adapter ─────────────────────────────────────────────────────────
const SOFASCORE_BASE = 'https://api.sofascore.com/api/v1/sport/badminton';

async function sofascoreGet(path) {
    const res = await fetch(SOFASCORE_BASE + path, {
        headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Sofascore ' + res.status);
    return res.json();
}

async function fetchLive() {
    const data = await sofascoreGet('/events/live');
    return (data.events || []).map(normEvent).filter(Boolean);
}

async function fetchUpcoming(days) {
    const results = [];
    const today = new Date();
    const fetches = Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const ds = d.toISOString().slice(0, 10);
        return sofascoreGet('/scheduled-events/' + ds)
            .then(r => (r.events || []).map(normEvent).filter(Boolean))
            .catch(() => []);
    });
    const pages = await Promise.all(fetches);
    for (const page of pages) results.push(...page);
    return results.filter(m => m.status !== 'finished');
}

function normEvent(ev) {
    try {
        const home = ev.homeTeam;
        const away = ev.awayTeam;
        if (!home || !away) return null;

        const statusType = (ev.status && (ev.status.type || String(ev.status.code))) || '';
        const status = normStatus(statusType);

        const hs = ev.homeScore || {};
        const as = ev.awayScore || {};
        const hSets = hs.current ?? 0;
        const aSets = as.current ?? 0;
        const periodKey = 'period' + (hSets + aSets + 1);

        return {
            id: String(ev.id),
            tournament: (ev.tournament && ev.tournament.name) || 'BWF',
            round: ev.roundInfo ? (ev.roundInfo.name || ('Runde ' + ev.roundInfo.round)) : '',
            scheduledTime: new Date((ev.startTimestamp || 0) * 1000),
            status,
            sides: [
                {
                    name: home.name || '?',
                    nat: (home.country && home.country.alpha2) || '??',
                    sets: hSets,
                    cur: status === 'live' ? (hs[periodKey] !== undefined ? hs[periodKey] : (hs.display ?? null)) : null,
                },
                {
                    name: away.name || '?',
                    nat: (away.country && away.country.alpha2) || '??',
                    sets: aSets,
                    cur: status === 'live' ? (as[periodKey] !== undefined ? as[periodKey] : (as.display ?? null)) : null,
                },
            ],
        };
    } catch (e) {
        return null;
    }
}

function normStatus(s) {
    const v = String(s).toLowerCase();
    if (['inprogress', 'in_progress', 'live', 'playing', 'ongoing', '6'].includes(v)) return 'live';
    if (['finished', 'closed', 'completed', 'ended', '100'].includes(v)) return 'finished';
    return 'upcoming';
}

// ── Demo data (gebruikt als reserve) ─────────────────────────────────────────
function demoData() {
    const now = new Date();
    const h = n => new Date(now.getTime() + n * 3600000);
    const d = n => new Date(now.getTime() + n * 86400000);
    return {
        live: [
            makeMatch('Jan Ø. Jørgensen', 'DK', 'Jonatan Christie', 'ID', 'BWF World Tour Finals', 'Kvartfinale', now, 'live', 1, 0, 14, 11),
            makeMatch('Maiken F. Pedersen / Kim Christiansen', 'DK', 'N. Matsuyama / C. Shida', 'JP', 'BWF World Tour Finals', 'Semifinal', now, 'live', 1, 1, 7, 5),
        ],
        upcoming: [
            makeMatch('Viktor Axelsen', 'DK', 'Shi Yuqi', 'CN', 'BWF World Tour Finals', 'Semifinal', h(3)),
            makeMatch('Rasmus Gemke', 'DK', 'Kanta Tsuneyama', 'JP', 'BWF World Tour Finals', 'Kvartfinale', h(6)),
            makeMatch('Kim Astrup / Anders Skaarup', 'DK', 'M. Ahsan / H. Setiawan', 'ID', 'BWF World Tour Finals', 'Semifinal', h(8)),
            makeMatch('Anders Antonsen', 'DK', 'Lee Zii Jia', 'MY', 'Danish Open', 'Runde 2', d(1)),
            makeMatch('An Se-young', 'KR', 'Tai Tzu-ying', 'TW', 'Danish Open', 'Kvartfinale', d(2)),
            makeMatch('Victor Sen', 'DK', 'Lakshya Sen', 'IN', 'French Open', 'Runde 1', d(3)),
        ],
    };
}

function makeMatch(n1, nat1, n2, nat2, tournament, round, time, status = 'upcoming', hs = 0, as_ = 0, hc = null, ac = null) {
    return { id: String(Math.random()), tournament, round, scheduledTime: time, status,
        sides: [{ name: n1, nat: nat1, sets: hs, cur: hc }, { name: n2, nat: nat2, sets: as_, cur: ac }] };
}

// ── State ─────────────────────────────────────────────────────────────────────
let liveMatches = [];
let upcomingMatches = [];
let liveTimer = null;
let upcomingTimer = null;
let started = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
function start() {
    if (started) return;
    started = true;

    applyProps();
    fetchAll();
    startTimers();

    document.getElementById('refresh-btn').addEventListener('click', () => {
        clearInterval(liveTimer);
        clearInterval(upcomingTimer);
        fetchAll().then(startTimers);
    });
}

// ── iCUE: re-apply when settings change ──────────────────────────────────────
function applyProps() {
    const accent = prop('accentColor', '#4f8ef7');
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dim', accent + '26');
    render();
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAll() {
    spin(true);
    try {
        const days = Math.max(1, Number(prop('upcomingDays', 7)) || 7);
        [liveMatches, upcomingMatches] = await Promise.all([
            fetchLive().catch(() => null),
            fetchUpcoming(days).catch(() => null),
        ]);
        // Fall back to demo data if API is unreachable (e.g. browser preview)
        if (liveMatches === null && upcomingMatches === null) {
            const demo = demoData();
            liveMatches = demo.live;
            upcomingMatches = demo.upcoming;
        } else {
            liveMatches = liveMatches || [];
            upcomingMatches = upcomingMatches || [];
        }
        render();
        stamp();
    } catch (err) {
        showError(err.message);
    } finally {
        spin(false);
    }
}

function startTimers() {
    clearInterval(liveTimer);
    clearInterval(upcomingTimer);
    liveTimer = setInterval(async () => {
        try {
            liveMatches = await fetchLive();
            renderLive();
            stamp();
        } catch (e) { /* keep last state */ }
    }, 30000);
    upcomingTimer = setInterval(async () => {
        try {
            const days = Math.max(1, Number(prop('upcomingDays', 7)) || 7);
            upcomingMatches = await fetchUpcoming(days);
            renderUpcoming();
            stamp();
        } catch (e) { /* keep last state */ }
    }, 300000);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() { renderLive(); renderUpcoming(); }

function renderLive() {
    const nat = prop('nationality', 'DK');
    const filtered = nat === 'ALL' ? liveMatches : liveMatches.filter(m => m.sides.some(s => s.nat === nat));
    const section = document.getElementById('live-section');
    section.classList.toggle('hidden', filtered.length === 0);
    document.getElementById('live-list').innerHTML = filtered.map(m => cardHTML(m, true, nat)).join('');
}

function renderUpcoming() {
    const nat = prop('nationality', 'DK');
    const src = upcomingMatches.filter(m => m.status !== 'finished');
    const filtered = nat === 'ALL' ? src : src.filter(m => m.sides.some(s => s.nat === nat));
    const list = document.getElementById('upcoming-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="state-msg empty">Ingen kommende kampe' + (nat !== 'ALL' ? ' for ' + nat : '') + '</div>';
    } else {
        list.innerHTML = filtered.map(m => cardHTML(m, false, nat)).join('');
    }
    document.getElementById('filter-badge').textContent = nat === 'ALL' ? 'Alle' : flag(nat) + ' ' + nat;
}

// ── Card HTML ─────────────────────────────────────────────────────────────────
function cardHTML(m, isLive, activeNat) {
    const [s0, s1] = m.sides;
    const hi0 = activeNat !== 'ALL' && s0.nat === activeNat;
    const hi1 = activeNat !== 'ALL' && s1.nat === activeNat;
    return '<div class="card' + (isLive ? ' live' : '') + '">' +
        '<div class="card-meta">' +
        '<span class="tournament" title="' + esc(m.tournament) + '">' + esc(m.tournament) + '</span>' +
        (m.round ? '<span class="round-pill">' + esc(m.round) + '</span>' : '') +
        '<span class="match-time' + (isLive ? ' live' : '') + '">' + (isLive ? '● LIVE' : fmtTime(m.scheduledTime)) + '</span>' +
        '</div>' +
        '<div class="players">' +
        playerHTML(s0, s1, isLive, hi0) +
        '<hr class="divider">' +
        playerHTML(s1, s0, isLive, hi1) +
        '</div>' +
        '</div>';
}

function playerHTML(side, opp, isLive, hi) {
    let scores = '';
    if (isLive) {
        const won = side.sets > opp.sets;
        if (side.sets + opp.sets > 0) {
            scores += '<span class="set' + (won ? ' won' : '') + '">' + side.sets + '</span>';
        }
        if (side.cur !== null && side.cur !== undefined) {
            scores += '<span class="set cur">' + side.cur + '</span>';
        }
    }
    return '<div class="player">' +
        '<span class="flag">' + flag(side.nat) + '</span>' +
        '<span class="name' + (hi ? ' hi' : '') + '" title="' + esc(side.name) + '">' + esc(side.name) + '</span>' +
        (scores ? '<div class="scores">' + scores + '</div>' : '') +
        '</div>';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '—';
    const now = new Date();
    const diffDays = Math.floor((date - now) / 86400000);
    const time = date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return 'I dag ' + time;
    if (diffDays === 1) return 'I morgen ' + time;
    return date.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
}

function stamp() {
    document.getElementById('updated').textContent =
        'Opdateret ' + new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showError(msg) {
    document.getElementById('upcoming-list').innerHTML =
        '<div class="state-msg error">Fejl: ' + esc(msg) + '</div>';
}

function spin(on) {
    document.getElementById('refresh-btn').classList.toggle('spinning', on);
}
