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

// ── Country names (BWF uses IOC codes; the API's own name is preferred) ───────
const COUNTRY_NAMES = {
    DEN: 'Denmark', CHN: 'China', JPN: 'Japan', KOR: 'Korea', INA: 'Indonesia', MAS: 'Malaysia',
    IND: 'India', THA: 'Thailand', ENG: 'England', SCO: 'Scotland', WAL: 'Wales', GER: 'Germany',
    FRA: 'France', TPE: 'Chinese Taipei', HKG: 'Hong Kong China', ESP: 'Spain', AUS: 'Australia',
    CAN: 'Canada', USA: 'USA', SGP: 'Singapore', VIE: 'Vietnam', PHI: 'Philippines',
    NED: 'Netherlands', SWE: 'Sweden', FIN: 'Finland', NOR: 'Norway', POL: 'Poland',
    SUI: 'Switzerland', IRL: 'Ireland', BEL: 'Belgium', ITA: 'Italy', UKR: 'Ukraine',
    BUL: 'Bulgaria', CZE: 'Czechia', AUT: 'Austria', ISL: 'Iceland', EST: 'Estonia',
    NZL: 'New Zealand', BRA: 'Brazil', MEX: 'Mexico', TUR: 'Turkiye', POR: 'Portugal',
    HUN: 'Hungary', SRI: 'Sri Lanka', PAK: 'Pakistan', MAC: 'Macau China',
};
const countryName = code => COUNTRY_NAMES[code] || code || '';
// Flag images are bundled in resources/flags (Windows does not draw flag emoji)
const IOC_FLAG = {
    DEN: 'dk', CHN: 'cn', JPN: 'jp', KOR: 'kr', INA: 'id', MAS: 'my', IND: 'in', THA: 'th',
    ENG: 'gb-eng', SCO: 'gb-sct', WAL: 'gb-wls', GER: 'de', FRA: 'fr', TPE: 'tw', HKG: 'hk',
    ESP: 'es', AUS: 'au', CAN: 'ca', USA: 'us', SGP: 'sg', VIE: 'vn', PHI: 'ph', NED: 'nl',
    SWE: 'se', FIN: 'fi', NOR: 'no', POL: 'pl', SUI: 'ch', IRL: 'ie', BEL: 'be', ITA: 'it',
    UKR: 'ua', BUL: 'bg', CZE: 'cz', AUT: 'at', ISL: 'is', EST: 'ee', NZL: 'nz', BRA: 'br',
    MEX: 'mx', TUR: 'tr', POR: 'pt', HUN: 'hu', SRI: 'lk', PAK: 'pk', MAC: 'mo',
};
const flagImg = code => IOC_FLAG[code]
    ? '<img class="flag" src="resources/flags/' + IOC_FLAG[code] + '.png" alt="">' : '<span class="flag"></span>';  // keeps the names aligned

// ── Parse.bot BWF adapter ─────────────────────────────────────────────────────
// Every successful call costs 1 credit (free tier: 200 credits/month, 5 requests/minute),
// so responses are cached in localStorage and refreshed sparingly.
const API_BASE = 'https://api.parse.bot/scraper/9b6754e3-5d0f-436a-91b8-ec4da53973b7/';
const DAY_MS = 86400000;

function cacheGet(key, maxAgeMs) {
    try {
        const raw = localStorage.getItem('bt:' + key);
        if (!raw) return null;
        const e = JSON.parse(raw);
        if (Date.now() - e.ts > maxAgeMs) return null;
        return e;
    } catch (e) { return null; }
}
function cacheSet(key, data) {
    try { localStorage.setItem('bt:' + key, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* ignore */ }
}

function countCall() {
    const k = 'bt:calls-' + new Date().toISOString().slice(0, 7);
    try { localStorage.setItem(k, String((Number(localStorage.getItem(k)) || 0) + 1)); } catch (e) { /* ignore */ }
}
function callsThisMonth() {
    try { return Number(localStorage.getItem('bt:calls-' + new Date().toISOString().slice(0, 7))) || 0; } catch (e) { return 0; }
}

async function apiGet(endpoint, params) {
    const key = String(prop('apiKey', '')).trim();
    if (!key) throw new Error('Enter your Parse.bot API key in the widget settings');
    const url = API_BASE + endpoint + '?' + new URLSearchParams(params);
    const res = await fetch(url, { headers: { 'X-API-Key': key, 'Accept': 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key (' + res.status + ')');
    if (res.status === 429) throw new Error('Too many requests to Parse.bot (429), try again shortly');
    if (!res.ok) throw new Error('Parse.bot ' + res.status);
    const json = await res.json();
    if (json.status !== 'success') throw new Error('Parse.bot: ' + (json.error || json.status));
    countCall();
    return json.data;
}

// Local date as YYYY-MM-DD
function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function getTournaments() {
    const year = new Date().getFullYear();
    const hit = cacheGet('tours-' + year, 30 * DAY_MS);   // calendar rarely changes: only fetched when missing
    if (hit) return hit.data;
    const data = await apiGet('list_tournaments', { year });
    const list = data.tournaments || [];
    cacheSet('tours-' + year, list);
    return list;
}

// One call covers the whole date range (1 credit per call, not per day)
// Concurrent callers (e.g. a refresh click during a timer load) share one request
const inflight = {};
async function getMatches(code, dateStart, dateEnd, maxAgeMs, force) {
    const key = 'm-' + code + '-' + dateStart + '-' + dateEnd;
    if (!force) {
        const hit = cacheGet(key, maxAgeMs);
        if (hit) return hit.data;
    }
    if (inflight[key]) return inflight[key];
    inflight[key] = (async () => {
        try {
            console.debug('[badminton] get_tournament_matches', code, dateStart, dateEnd);
            const data = await apiGet('get_tournament_matches', { tournament_code: code, date_start: dateStart, date_end: dateEnd });
            const list = data.matches || [];
            cacheSet(key, list);
            return list;
        } finally {
            delete inflight[key];
        }
    })();
    return inflight[key];
}

function gameParts(s) {
    if (!s) return null;
    const m = /^(\d+)-(\d+)$/.exec(s);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

function normMatch(m, tournamentName) {
    const status = m.match_status === 'Finished' ? 'finished'
        : m.match_status === 'In Progress' ? 'live' : 'upcoming';
    const games = [m.game_1_score, m.game_2_score, m.game_3_score].map(gameParts).filter(Boolean);
    const side = n => {
        const players = m['player_' + n + '_players'] || [];
        const nats = players.map(p => p.country_code).filter(Boolean);
        if (nats.length === 0 && m['player_' + n + '_country']) nats.push(m['player_' + n + '_country']);
        const country = m['player_' + n + '_nationality'] || (players.find(p => p.nationality) || {}).nationality || countryName(nats[0]);
        return { name: m['player_' + n + '_name'] || '?', nats, country, seed: m['player_' + n + '_seed'] };
    };
    return {
        id: String(m.match_id),
        tournament: tournamentName || m.tournament_name || 'BWF',
        round: [m.discipline, m.round].filter(Boolean).join(' '),
        court: m.court_name || '',
        time: m.match_time || '',
        status,
        winner: m.winner || 0,
        retired: m.score_status === 'Retired',
        games,
        sides: [side(1), side(2)],
    };
}

// ── State ─────────────────────────────────────────────────────────────────────
let tournaments = [];
let matches = [];
let timer = null;
let tickTimer = null;
let started = false;
let lastFetch = null;
let view = 'matches';        // matches | tournaments
let lastStartView = null;
let loadError = null;
let paused = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
function start() {
    if (started) return;
    started = true;

    applyProps();
    loadAll(false);
    startTimer();

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        setView(t.dataset.view);
    }));

    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadAll(true);
        startTimer();
    });
}

// ── iCUE: re-apply when settings change ──────────────────────────────────────
function applyProps() {
    const accent = prop('accentColor', '#4f8ef7');
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dim', accent + '26');
    document.documentElement.style.setProperty('--line', prop('lineColor', '#4f8ef7'));
    // The start view from the iCUE settings only applies when it is changed there
    let sv = prop('startView', 'matches');
    if (sv !== lastStartView) {
        if (sv !== 'tournaments') sv = 'matches';   // legacy values (today, tomorrow, all)
        lastStartView = sv;
        view = sv;
    }
    updateTabs();
    render();
    if (started && tickTimer) scheduleNext();   // settings may have changed the refresh schedule
}

function setView(v) {
    view = v;
    updateTabs();
    render();
}

function updateTabs() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
}

function refreshMs() {
    return Math.max(15, Number(prop('refreshMinutes', 180)) || 180) * 60000;
}

function startTimer() {
    // Re-render every minute so the green header turns on when a match starts (no API calls)
    clearInterval(tickTimer);
    tickTimer = setInterval(render, 60000);
    scheduleNext();
}

const matchStart = m => new Date(m.time.replace(' ', 'T'));

// Schedules the next automatic load. Normally every refreshMs. With "Refresh optimise" on and a
// country selected: no refresh while none of that country's matches are active, a refresh at
// each match's start time, and the normal interval while one is active.
function scheduleNext() {
    clearTimeout(timer);
    let delay = refreshMs();
    let fresh = false;
    const nat = prop('nationality', 'ALL');
    if (prop('smartRefresh', false) === true && nat !== 'ALL') {
        fresh = true;   // wake-ups are timed on purpose, so bypass the cache
        const now = Date.now();
        const open = matches
            .filter(m => m.status !== 'finished' && m.sides.some(s => s.nats.includes(nat)))
            .map(m => ({ m, t: matchStart(m).getTime() }))
            .filter(x => !isNaN(x.t));
        const active = open.some(x => x.m.status === 'live' || x.t <= now);
        if (!active) {
            const next = open.filter(x => x.t > now).map(x => x.t).sort((a, b) => a - b)[0];
            if (next !== undefined) {
                delay = next - now;
            } else {
                // Nothing known: look again after midnight, when a new day's schedule is out
                const midnight = new Date(); midnight.setHours(24, 0, 30, 0);
                delay = midnight - now;
            }
        } else {
            const next = open.filter(x => x.t > now).map(x => x.t).sort((a, b) => a - b)[0];
            if (next !== undefined) delay = Math.min(delay, next - now);
        }
    }
    // setTimeout overflows above ~24.8 days; delays here are far below that
    timer = setTimeout(() => loadAll(false, fresh), Math.max(delay, 1000));
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
// force: ignore the "no active tournament" pause and the cache; fresh: ignore the cache only
async function loadAll(force, fresh) {
    spin(true);
    try {
        loadError = null;
        tournaments = await getTournaments();
        const todayStr = ymd(new Date());
        // Active from the day before the start (the schedule is published then) until the last day
        const tomorrowStr = ymd(new Date(Date.now() + DAY_MS));
        paused = !tournaments.some(t => t.date_start <= tomorrowStr && todayStr <= t.date_end);
        if (paused && !force) {
            // No active tournament: no match calls (the refresh button still forces one)
            matches = [];
            lastFetch = new Date();
            render();
            stamp();
            return;
        }
        const days = 2;  // today + tomorrow
        const today = new Date();
        const end = new Date(today);
        end.setDate(today.getDate() + days - 1);
        const from = ymd(today), to = ymd(end);
        // Tournaments overlapping [from, to]; the range is clipped to each tournament's dates
        const jobs = tournaments
            .filter(t => t.date_start <= to && t.date_end >= from)
            .map(t => ({ t, start: t.date_start > from ? t.date_start : from, end: t.date_end < to ? t.date_end : to }));
        // A tournament that has not started yet only needs its schedule once or twice a day
        const maxAge = j => j.t.date_start > todayStr ? Math.max(refreshMs(), 12 * 3600000) : refreshMs();
        const results = await Promise.allSettled(
            jobs.map(j => getMatches(j.t.tournament_code, j.start, j.end, maxAge(j), force || fresh)
                .then(list => list.map(m => normMatch(m, j.t.tournament_name))))
        );
        const ok = results.filter(r => r.status === 'fulfilled');
        if (jobs.length > 0 && ok.length === 0) throw results[0].reason;
        matches = ok.flatMap(r => r.value);
        lastFetch = new Date();
        render();
        stamp();
    } catch (err) {
        loadError = err.message;
        render();
    } finally {
        spin(false);
        scheduleNext();
    }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
    if (view === 'tournaments') { renderTournaments(); return; }
    if (loadError) { showError(loadError); return; }
    const nat = prop('nationality', 'ALL');
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const todayStr = ymd(today), tomorrowStr = ymd(tomorrow);
    const filterName = nat === 'ALL' ? 'All' : countryName(nat);

    const mine = matches.filter(m => nat === 'ALL' || m.sides.some(s => s.nats.includes(nat)));
    const byTime = (a, b) => a.time.localeCompare(b.time);
    const onDay = d => m => m.time.slice(0, 10) === d;

    // Matches in progress stay in the main list (no live scores are shown)
    const todayList = mine.filter(onDay(todayStr)).filter(m => m.status !== 'finished').sort(byTime);
    const results = mine.filter(onDay(todayStr)).filter(m => m.status === 'finished').sort((a, b) => b.time.localeCompare(a.time));
    const tomorrowList = mine.filter(onDay(tomorrowStr)).sort(byTime);

    document.getElementById('list-label').textContent = 'Active / Upcoming - ' + filterName;
    document.getElementById('tomorrow-label').textContent = 'Tomorrow - ' + filterName;
    document.getElementById('results-label').textContent = 'Results - ' + filterName;
    // The "today" section is always shown (with an explanation when it is empty)
    document.getElementById('upcoming-section').classList.remove('hidden');
    document.getElementById('upcoming-list').innerHTML = todayList.length
        ? todayList.map(m => rowHTML(m, nat)).join('') : emptyMsg(nat);
    fillSection('results', results, nat);
    fillSection('tomorrow', tomorrowList, nat);
}

function fillSection(name, list, nat) {
    const section = document.getElementById(name + '-section');
    const el = document.getElementById(name + '-list');
    section.classList.toggle('hidden', list.length === 0);
    el.innerHTML = list.map(m => rowHTML(m, nat)).join('');
}

function emptyMsg(nat) {
    const today = ymd(new Date());
    const next = tournaments.filter(t => t.date_end >= today).sort((a, b) => a.date_start.localeCompare(b.date_start))[0];
    let msg = 'No upcoming matches' + (nat === 'ALL' ? '' : ' for ' + countryName(nat)) + ' today';
    if (paused && next) msg += '. Next tournament: ' + esc(next.tournament_name) + ', ' + esc(next.location) + ', ' + fmtDate(next.date_start) + ' - ' + fmtDate(next.date_end);
    return '<div class="state-msg empty">' + msg + '</div>';
}

// ── Tournaments tab (uses the cached calendar, no extra API calls) ───────────
function renderTournaments() {
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('tomorrow-section').classList.add('hidden');
    document.getElementById('upcoming-section').classList.remove('hidden');
    document.getElementById('list-label').textContent = 'Tournaments';
    const el = document.getElementById('upcoming-list');
    if (loadError && tournaments.length === 0) { showError(loadError); return; }
    const today = ymd(new Date());
    const list = tournaments
        .filter(t => t.date_end >= today)
        .sort((a, b) => a.date_start.localeCompare(b.date_start));
    if (list.length === 0) {
        el.innerHTML = '<div class="state-msg empty">No ongoing or upcoming tournaments</div>';
        return;
    }
    el.innerHTML = list.map(t => {
        const ongoing = t.date_start <= today;
        const category = String(t.tournament_category || '').replace(/^HSBC BWF World Tour\s*/i, '');
        const prize = t.prize_money ? ' \u00B7 Prize money $' + t.prize_money : '';
        return '<div class="row' + (ongoing ? ' active' : '') + '">' +
            '<div class="meta">' +
            '<span class="time">' + esc(fmtDate(t.date_start) + ' - ' + fmtDate(t.date_end)) + '</span>' +
            '<span class="event" title="' + esc(t.tournament_category) + '">' + esc((ongoing ? 'Ongoing \u00B7 ' : '') + category) + '</span>' +
            '</div>' +
            '<div class="side"><span class="name strong" title="' + esc(t.tournament_name) + '">' + esc(t.tournament_name) + '</span></div>' +
            '<div class="side"><span class="name sub">' + esc(t.location + prize) + '</span></div>' +
            '</div>';
    }).join('');
}

// ── Match card: header line (time + event), then one line per side ───────────
function rowHTML(m, activeNat) {
    const finished = m.status === 'finished';
    const event = [m.tournament, m.round, m.court].filter(Boolean).join(' \u00B7 ');
    // Not finished and the start time has passed: presumed active, green header
    const start = new Date(m.time.replace(' ', 'T'));
    const active = !finished && !isNaN(start) && start <= new Date();
    const state = finished ? ' done' : active ? ' active' : ' upcoming';
    return '<div class="row' + state + '">' +
        '<div class="meta">' +
        '<span class="time">' + esc(finished ? 'Done ' + fmtClock(m.time) : fmtTime(m.time)) + '</span>' +
        '<span class="event" title="' + esc(event) + '">' + esc(event) + '</span>' +
        '</div>' +
        sideHTML(m, 0, activeNat) +
        sideHTML(m, 1, activeNat) +
        '</div>';
}

function sideHTML(m, i, activeNat) {
    const side = m.sides[i];
    const won = m.status === 'finished' && m.winner === i + 1;
    let scores = '';
    if (m.status === 'finished') {
        scores = m.games.map(g => '<span class="set' + (won ? ' won' : '') + '">' + g[i] + '</span>').join('');
    }
    return '<div class="side">' +
        '<span class="cc' + (won ? ' win' : '') + '">' + flagImg(side.nats[0]) + '<span class="cctext">' + esc(side.country) + '</span></span>' +
        (side.seed ? '<span class="seed">[' + esc(side.seed) + ']</span>' : '') +
        '<span class="name' + (won ? ' win' : '') + '" title="' + esc(side.name) + '">' + esc(side.name) + '</span>' +
        (scores ? '<span class="scores">' + scores + '</span>' : '') +
        '</div>';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "YYYY-MM-DD HH:MM:SS" (tournament local time) -> "HH:MM"
function fmtClock(s) {
    return s && s.length >= 16 ? s.slice(11, 16) : '';
}

function fmtDate(ds) {
    const d = new Date(ds + 'T00:00:00');
    return isNaN(d) ? ds : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtTime(s) {
    if (!s) return '—';
    const date = s.slice(0, 10);
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const clock = fmtClock(s);
    if (date === ymd(today)) return 'Today ' + clock;
    if (date === ymd(tomorrow)) return 'Tomorrow ' + clock;
    return fmtDate(date) + ' ' + clock;
}

function stamp() {
    const t = lastFetch || new Date();
    document.getElementById('updated').textContent =
        'Updated ' + t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
        ' · ' + callsThisMonth() + ' API calls this month (free tier: 200)' +
        (paused ? ' · auto refresh paused (no active tournament)' : '');
}

function showError(msg) {
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('tomorrow-section').classList.add('hidden');
    document.getElementById('upcoming-section').classList.remove('hidden');
    document.getElementById('upcoming-list').innerHTML =
        '<div class="state-msg error">Error: ' + esc(msg) + '</div>';
}

function spin(on) {
    document.querySelector('#refresh-btn span').classList.toggle('spinning', on);
}
