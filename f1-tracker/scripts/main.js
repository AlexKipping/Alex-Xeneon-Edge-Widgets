const BASE = "https://api.jolpi.ca/ergast/f1/current";
const API_NEXT = BASE + "/next.json";
const API_DRIVERS = BASE + "/driverStandings.json";
const API_TEAMS = BASE + "/constructorStandings.json";

const TRACK_PATHS = {
    "bahrain": "M30,70 L25,65 L25,60 L30,55 L40,55 L45,50 L55,50 L60,55 L65,50 L75,50 L80,55 L80,65 L75,70 L65,70 L60,75 L50,75 L45,80 L30,80 Z",
    "jeddah": "M20,20 Q30,15 40,20 T60,30 T80,40 Q85,50 80,60 T60,80 T40,85 Q20,80 20,70 Z",
    "albert_park": "M30,30 L70,30 L80,40 L70,60 L60,60 L50,70 L40,70 L30,60 Z",
    "suzuka": "M20,60 C20,40 40,40 50,50 C60,60 80,60 80,40 C80,20 60,20 50,30 C40,40 20,40 20,60 Z",
    "miami": "M20,50 L30,40 L50,40 L60,30 L70,30 L80,40 L80,60 L70,70 L60,70 L50,80 L40,80 L30,70 L20,70 Z",
    "monaco": "M40,30 L60,30 L65,40 L60,50 L65,60 L60,70 L50,70 L45,60 L40,60 L35,50 L40,40 Z",
    "villeneuve": "M20,40 L80,40 L85,50 L80,60 L20,60 L15,50 Z",
    "silverstone": "M40,20 L60,20 L70,30 L75,50 L70,70 L60,80 L40,80 L30,70 L25,50 L30,30 Z",
    "red_bull_ring": "M30,60 L40,40 L60,40 L70,50 L60,70 L40,70 Z",
    "spa": "M30,70 L40,60 L50,60 L60,50 L70,50 L80,60 L70,80 L50,80 L30,70 Z",
    "monza": "M20,50 L80,50 L85,60 L80,70 L20,70 L15,60 Z",
    "marina_bay": "M20,30 L80,30 L80,70 L60,70 L60,60 L40,60 L40,70 L20,70 Z",
    "americas": "M20,50 L30,30 L50,30 L60,40 L70,40 L80,50 L70,70 L50,70 L40,60 L30,60 Z",
    "vegas": "M20,20 L80,20 L80,40 L60,40 L60,60 L80,60 L80,80 L20,80 Z",
    "yas_marina": "M20,40 L40,40 L40,30 L60,30 L60,40 L80,40 L80,60 L60,60 L60,70 L40,70 L40,60 L20,60 Z",
    "generic": "M20,50 Q20,20 50,20 T80,50 T50,80 T20,50"
};

// Round the corners of a straight-segment path (M/L/Z only) so it reads as a smooth circuit.
// Paths that already contain curves are returned unchanged.
function smoothPath(d, radius = 7) {
    if (/[^MLZ\d.,\s-]/i.test(d)) return d;
    const pts = (d.match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) || []).map(p => p.split(',').map(Number));
    const n = pts.length;
    if (n < 3) return d;
    const closed = /Z/i.test(d);
    const toward = (a, b, dist) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const t = Math.min(dist, len / 2) / len;
        return [a[0] + dx * t, a[1] + dy * t];
    };
    const f = p => p[0].toFixed(2) + ',' + p[1].toFixed(2);
    let out = '';
    for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
        if (!closed && (i === 0 || i === n - 1)) {
            out += (i === 0 ? 'M' : 'L') + f(cur);
            continue;
        }
        const a = toward(cur, prev, radius), b = toward(cur, next, radius);
        out += (out ? 'L' : 'M') + f(a) + 'Q' + f(cur) + ' ' + f(b);
    }
    return out + (closed ? 'Z' : '');
}

// Real circuit outlines from https://github.com/bacinger/f1-circuits (Jolpica circuitId -> dataset id).
const CIRCUIT_GEOJSON = "https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson";
const CIRCUIT_IDS = {
    albert_park: "au-1953", bahrain: "bh-2002", shanghai: "cn-2004", catalunya: "es-1991",
    monaco: "mc-1929", villeneuve: "ca-1978", ricard: "fr-1969", red_bull_ring: "at-1969",
    silverstone: "gb-1948", hockenheimring: "de-1932", hungaroring: "hu-1986", spa: "be-1925",
    monza: "it-1922", marina_bay: "sg-2008", sochi: "ru-2014", suzuka: "jp-1962",
    americas: "us-2012", rodriguez: "mx-1962", interlagos: "br-1940", yas_marina: "ae-2009",
    imola: "it-1953", nurburgring: "de-1927", portimao: "pt-2008", mugello: "it-1914",
    sepang: "my-1999", istanbul: "tr-2005", zandvoort: "nl-1948", magny_cours: "fr-1960",
    jeddah: "sa-2021", miami: "us-2022", losail: "qa-2004", madring: "es-2026",
    baku: "az-2016", vegas: "us-2023"
};
let circuitData = null;

// Project lon/lat points into the 100x100 SVG box, preserving aspect ratio.
function projectTrack(coords) {
    const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const k = Math.cos(lat0 * Math.PI / 180);
    const pts = coords.map(c => [c[0] * k, -c[1]]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const size = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = 70 / size;
    const ox = 50 - ((maxX - minX) * scale) / 2, oy = 50 - ((maxY - minY) * scale) / 2;
    const out = pts.map(p => ((p[0] - minX) * scale + ox).toFixed(1) + "," + ((p[1] - minY) * scale + oy).toFixed(1));
    const closed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < size * 0.02;
    return "M" + out.join(" L") + (closed ? " Z" : "");
}

async function realTrackPath(circuitId) {
    const id = CIRCUIT_IDS[circuitId];
    if (!id) return null;
    try {
        const cached = localStorage.getItem('f1trk:' + id);
        if (cached) return cached;
    } catch (e) { /* storage unavailable */ }
    try {
        if (!circuitData) {
            const res = await fetch(CIRCUIT_GEOJSON);
            if (!res.ok) throw new Error(res.status);
            circuitData = await res.json();
        }
        const f = circuitData.features.find(ft => ft.properties.id === id);
        if (!f) return null;
        const d = projectTrack(f.geometry.coordinates);
        try { localStorage.setItem('f1trk:' + id, d); } catch (e) { /* ignore */ }
        return d;
    } catch (e) {
        return null;
    }
}

// Official 2026 team colours (team = accent, badge = darker shade for the logo circle), from mark-boots/f1-2026-assets.
const TEAM_COLORS = {
    "mercedes": "#27f4d2", "ferrari": "#e8002d", "mclaren": "#ff8000", "red_bull": "#3671c6",
    "williams": "#1868db", "aston_martin": "#229971", "alpine": "#00a1e8", "rb": "#6692ff",
    "haas": "#dee1e2", "audi": "#ff2d00", "cadillac": "#aaaaad"
};
const TEAM_BADGE = {
    "mercedes": "#067e6a", "ferrari": "#5c0012", "mclaren": "#804000", "red_bull": "#142948",
    "williams": "#082145", "aston_martin": "#0f4331", "alpine": "#004e70", "rb": "#0038c2",
    "haas": "#667175", "audi": "#751500", "cadillac": "#58585b"
};
const teamColor = id => TEAM_COLORS[id] || "#777777";
const teamBadge = id => TEAM_BADGE[id] || "#444444";

const UI = {
    path: document.getElementById('track-path'),
    svg: document.getElementById('track-svg'),
    loading: document.getElementById('loading'),
    preRace: document.getElementById('pre-race'),
    liveBox: document.getElementById('live-box'),
    name: document.getElementById('race-name'),
    loc: document.getElementById('race-loc'),
    date: document.getElementById('race-date'),
    round: document.getElementById('round'),
    timerRow: document.querySelector('.timer-row'),
    timer: { d: document.getElementById('d'), h: document.getElementById('h'), m: document.getElementById('m') },
    lap: { cur: document.getElementById('cur-lap'), tot: document.getElementById('tot-lap') },
    tabs: Array.from(document.querySelectorAll('.tab')),
    viewRace: document.getElementById('view-race'),
    viewStandings: document.getElementById('view-standings'),
    stTitle: document.getElementById('st-title'),
    stSub: document.getElementById('st-sub'),
    stList: document.getElementById('st-list')
};

// Read an iCUE control value (global variable injected by iCUE), with a fallback for browser previews.
function prop(name, fallback) {
    try {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            const v = window[name];
            if (v !== undefined && v !== null && v !== "") return v;
        }
        const v2 = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
        if (v2 !== undefined && v2 !== null && v2 !== "") return v2;
    } catch (e) { /* ignore */ }
    return fallback;
}

let raceTime = null, raceTitle = "", tickTimer = null;
let standings = { drivers: null, teams: null, error: false };
let currentView = 'race';
let lastStartView = null;
let started = false;

/* ---------------- Views ---------------- */

const VIEWS = ['race', 'drivers', 'teams'];

function setView(v) {
    if (!VIEWS.includes(v)) v = 'race';
    currentView = v;
    UI.tabs.forEach(t => t.classList.toggle('active', t.dataset.view === v));
    const isRace = v === 'race';
    UI.viewRace.classList.toggle('active', isRace);
    UI.viewStandings.classList.toggle('active', !isRace);
    document.body.classList.toggle('view-standings', !isRace);
    if (!isRace) renderStandings(); else fitTrack();
}

UI.tabs.forEach(t => t.addEventListener('click', () => {
    setView(t.dataset.view);
    restartRotation();
}));

let rotateTimer = null;
function restartRotation() {
    clearInterval(rotateTimer);
    rotateTimer = null;
    if (!prop('autoRotate', false)) return;
    const secs = Math.max(5, Number(prop('rotateSeconds', 15)) || 15);
    rotateTimer = setInterval(() => {
        setView(VIEWS[(VIEWS.indexOf(currentView) + 1) % VIEWS.length]);
    }, secs * 1000);
}

function applyProps() {
    const root = document.documentElement.style;
    root.setProperty('--text-main', prop('textColor', '#FFFFFF'));
    root.setProperty('--accent', prop('accentColor', '#e10600'));
    UI.stList.classList.toggle('no-pics-opt', prop('showPictures', true) === false);

    const sv = prop('startView', 'race');
    if (sv !== lastStartView) {
        lastStartView = sv;
        setView(sv);
    } else if (currentView !== 'race') {
        renderStandings();
    }
    restartRotation();
}

/* ---------------- Race ---------------- */

async function loadRace() {
    try {
        const res = await fetch(API_NEXT);
        const data = await res.json();
        if (!data.MRData || !data.MRData.RaceTable.Races.length) {
            if (!raceTime) UI.loading.textContent = "Season Finished";
            return;
        }
        setupRace(data.MRData.RaceTable.Races[0]);
    } catch (e) {
        console.warn("Race data unavailable", e);
        if (!raceTime) UI.loading.textContent = "Connection Lost";
    }
}

function setTrack(d) {
    UI.path.setAttribute("d", d);
    fitTrack();
}

// Zoom the SVG to the outline's own bounding box so wide or tall circuits fill the available space.
// Needs the SVG to be rendered, so it is skipped while the race view is hidden and re-run when it is shown.
function fitTrack() {
    try {
        const bb = UI.path.getBBox();
        if (!bb.width && !bb.height) return;
        const pad = Math.max(bb.width, bb.height) * 0.04;
        UI.svg.setAttribute("viewBox", [bb.x - pad, bb.y - pad, bb.width + pad * 2, bb.height + pad * 2].join(" "));
    } catch (e) { /* not rendered yet */ }
}

function setupRace(race) {
    UI.loading.style.display = 'none';
    raceTitle = race.raceName.replace("Grand Prix", "GP");
    UI.name.textContent = raceTitle;

    const d = new Date(`${race.date}T${race.time || "12:00:00Z"}`);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    UI.loc.textContent = `${race.Circuit.Location.locality} | ${race.Circuit.circuitName}`;
    UI.date.textContent = `${dateStr} ${timeStr}`;
    UI.round.textContent = `RD ${race.round}`;
    const circuitId = race.Circuit.circuitId;
    // Show the hand-drawn fallback straight away, then swap in the real outline once loaded.
    setTrack(smoothPath(TRACK_PATHS[circuitId] || TRACK_PATHS["generic"]));
    realTrackPath(circuitId).then(d => {
        if (d && raceTitle === race.raceName.replace("Grand Prix", "GP")) setTrack(d);
    });

    raceTime = d;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
    tick();
    fitTrack();
}

function tick() {
    if (!raceTime) return;
    const diff = raceTime - new Date();

    UI.preRace.style.display = 'flex';
    UI.preRace.classList.toggle('live', diff <= 0 && diff > -9000000);

    if (diff > 0) {
        UI.liveBox.style.display = 'none';
        UI.timerRow.style.display = 'flex';
        UI.name.textContent = raceTitle;

        UI.timer.d.textContent = Math.floor(diff / 86400000);
        UI.timer.h.textContent = Math.floor((diff % 86400000) / 3600000);
        UI.timer.m.textContent = Math.floor((diff % 3600000) / 60000);
    } else if (diff > -9000000) {
        UI.liveBox.style.display = 'flex';
        const est = Math.ceil(Math.abs(diff) / 95000);
        UI.lap.cur.textContent = Math.min(est, 60);
        UI.lap.tot.textContent = 60;
    } else {
        UI.liveBox.style.display = 'none';
        UI.name.textContent = "FINISHED";
        UI.timerRow.style.display = 'none';
    }
}

/* ---------------- Standings ---------------- */

async function loadStandings() {
    try {
        const [dRes, tRes] = await Promise.all([fetch(API_DRIVERS), fetch(API_TEAMS)]);
        const [dData, tData] = await Promise.all([dRes.json(), tRes.json()]);
        const dList = dData.MRData.StandingsTable.StandingsLists[0];
        const tList = tData.MRData.StandingsTable.StandingsLists[0];
        const [dPrev, tPrev] = await Promise.all([
            dList ? loadPrev(dList.round, 'driverStandings', 'DriverStandings', r => r.Driver.driverId) : null,
            tList ? loadPrev(tList.round, 'constructorStandings', 'ConstructorStandings', r => r.Constructor.constructorId) : null
        ]);
        standings.drivers = dList ? { season: dList.season, round: dList.round, rows: dList.DriverStandings, prev: dPrev } : { rows: [] };
        standings.teams = tList ? { season: tList.season, round: tList.round, rows: tList.ConstructorStandings, prev: tPrev } : { rows: [] };
        standings.error = false;
    } catch (e) {
        console.warn("Standings unavailable", e);
        standings.error = true;   // keep last known data, if any
    }
    if (currentView !== 'race') renderStandings();
}

// Standings after the previous round, keyed by id. Null when unavailable (e.g. round 1).
async function loadPrev(round, endpoint, listKey, idOf) {
    const prevRound = Number(round) - 1;
    if (prevRound < 1) return null;
    try {
        const res = await fetch(`${BASE}/${prevRound}/${endpoint}.json`);
        const data = await res.json();
        const list = data.MRData.StandingsTable.StandingsLists[0];
        if (!list) return null;
        const map = {};
        list[listKey].forEach(r => { map[idOf(r)] = { pos: Number(r.position), pts: Number(r.points) }; });
        return map;
    } catch (e) {
        return null;
    }
}

// Points gained and places moved in the most recent round, as HTML for the right-hand column.
function deltaHtml(prev, id, pos, pts) {
    if (!prev) return "";
    const p = prev[id] || { pos: null, pts: 0 };
    const gain = Number(pts) - p.pts;
    const move = p.pos == null ? 0 : p.pos - Number(pos);
    const gainTxt = gain > 0 ? `<span class="gain">+${gain}</span>` : `<span class="gain zero">+0</span>`;
    const mvTxt = move > 0 ? `<span class="mv up">&#9650;${move}</span>`
        : move < 0 ? `<span class="mv down">&#9660;${-move}</span>`
        : `<span class="mv same">&#9644;</span>`;
    return `<div class="delta">${gainTxt}${mvTxt}</div>`;
}

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layoutStandings(n) {
    const list = UI.stList;
    const W = list.clientWidth, H = list.clientHeight;
    if (!W || !H || !n) return;
    const gap = 8, minRow = 60, maxRow = 130, minCol = 300;

    const rowsFit = Math.max(1, Math.floor((H + gap) / (minRow + gap)));
    const maxCols = Math.max(1, Math.floor((W + gap) / (minCol + gap)));
    let cols = Math.ceil(n / rowsFit);
    cols = Math.max(cols, Math.min(maxCols, Math.round(W / 560)));
    cols = Math.max(1, Math.min(cols, maxCols, n));
    const rows = Math.ceil(n / cols);
    const rh = Math.max(minRow, Math.min(maxRow, Math.floor((H - gap * (rows - 1)) / rows)));

    list.style.setProperty('--rh', rh + 'px');
    // Same picture size in every view: sized as if the list had 10 rows (the 20-driver layout), never larger than the row itself.
    const refRh = Math.max(minRow, Math.min(maxRow, Math.floor((H - gap * 9) / 10)));
    list.style.setProperty('--ps', (Math.min(rh, refRh) - 10) + 'px');
    list.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    list.style.gridTemplateRows = `repeat(${rows}, ${rh}px)`;
    list.classList.toggle('compact', rh < 56);
    list.classList.toggle('tight', rh < 44);
    list.classList.toggle('no-pics', rh < 36 || list.classList.contains('no-pics-opt'));
}

function renderStandings() {
    const isDrivers = currentView === 'drivers';
    UI.stTitle.textContent = isDrivers ? "Drivers' Championship" : "Constructors' Championship";
    const data = isDrivers ? standings.drivers : standings.teams;

    if (!data) {
        UI.stSub.textContent = "";
        UI.stList.style.gridTemplateColumns = "1fr";
        UI.stList.style.gridTemplateRows = "auto";
        UI.stList.innerHTML = `<div class="message">${standings.error ? "Connection Lost" : "Loading standings..."}</div>`;
        return;
    }
    if (!data.rows.length) {
        UI.stSub.textContent = "";
        UI.stList.style.gridTemplateColumns = "1fr";
        UI.stList.style.gridTemplateRows = "auto";
        UI.stList.innerHTML = `<div class="message">No standings available yet</div>`;
        return;
    }

    UI.stSub.textContent = `${data.season} season | After round ${data.round}` + (standings.error ? " | offline" : "");

    UI.stList.innerHTML = data.rows.map(r => {
        const pos = r.position || r.positionText || "-";
        const pts = esc(r.points);
        const wins = esc(r.wins);
        if (isDrivers) {
            const team = (r.Constructors && r.Constructors[r.Constructors.length - 1]) || {};
            const init = esc((r.Driver.code || r.Driver.familyName.slice(0, 3)).toUpperCase());
            return `<div class="row ${pos === '1' ? 'p1' : ''}" style="--tc:${teamColor(team.constructorId)}">
                <div class="pos">${esc(pos)}</div>
                <div class="pic" data-photo="resources/drivers/${esc(r.Driver.permanentNumber)}.png" data-wiki="${esc(r.Driver.url)}">${init}</div>
                <div class="who"><span class="nm">${esc(r.Driver.familyName)}</span><span class="tm">${esc(r.Driver.givenName)} | ${esc(team.name)}</span></div>
                <div class="pts"><div>${pts}<small>PTS</small></div>${deltaHtml(data.prev, r.Driver.driverId, pos, r.points)}</div>
            </div>`;
        }
        const c = r.Constructor;
        return `<div class="row ${pos === '1' ? 'p1' : ''}" style="--tc:${teamColor(c.constructorId)}">
            <div class="pos">${esc(pos)}</div>
            <div class="pic logo" style="--tb:${teamBadge(c.constructorId)}" data-logo="resources/teams/${esc(c.constructorId)}.svg" data-wiki="${esc(c.url)}">${esc(c.name.slice(0, 3).toUpperCase())}</div>
            <div class="who"><span class="nm">${esc(c.name)}</span><span class="tm">${wins} ${wins === '1' ? 'win' : 'wins'}</span></div>
            <div class="pts"><div>${pts}<small>PTS</small></div>${deltaHtml(data.prev, c.constructorId, pos, r.points)}</div>
        </div>`;
    }).join("");

    layoutStandings(data.rows.length);
    loadPictures();
}

if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
        if (currentView === 'race') return;
        const data = currentView === 'drivers' ? standings.drivers : standings.teams;
        if (data && data.rows.length) layoutStandings(data.rows.length);
    }).observe(UI.stList);
}

/* ---------------- Pictures (Wikipedia thumbnails) ---------------- */

const PIC_TTL = 7 * 24 * 3600 * 1000;
const picMem = {};

function wikiTitle(url) {
    try { return new URL(url).pathname.split('/').pop(); } catch (e) { return null; }
}

function picCacheGet(title) {
    if (picMem[title] !== undefined) return picMem[title];
    try {
        const raw = localStorage.getItem('f1pic:' + title);
        if (raw) {
            const o = JSON.parse(raw);
            if (Date.now() - o.t < PIC_TTL) return (picMem[title] = o.u);
        }
    } catch (e) { /* storage unavailable */ }
    return undefined;
}

function picCacheSet(title, url) {
    picMem[title] = url;
    try { localStorage.setItem('f1pic:' + title, JSON.stringify({ u: url, t: Date.now() })); } catch (e) { /* ignore */ }
}

async function fetchPic(title) {
    const cached = picCacheGet(title);
    if (cached !== undefined) return cached;
    try {
        const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + title);
        if (!res.ok) throw new Error(res.status);
        const j = await res.json();
        const u = (j.thumbnail && j.thumbnail.source) || null;
        picCacheSet(title, u);
        return u;
    } catch (e) {
        return null;
    }
}

function loadPictures() {
    UI.stList.querySelectorAll('.pic[data-wiki]').forEach(async el => {
        const bundled = el.dataset.logo || el.dataset.photo;
        if (bundled) {
            // Bundled team logo / driver portrait; fall back to the Wikipedia image if the file is missing.
            const local = new Image();
            local.alt = "";
            local.onload = () => { if (el.isConnected) { el.textContent = ""; el.appendChild(local); } };
            local.onerror = () => loadWikiPic(el, !!el.dataset.logo);
            local.src = bundled;
            return;
        }
        loadWikiPic(el, false);
    });
}

async function loadWikiPic(el, mono) {
    const title = wikiTitle(el.dataset.wiki);
    if (!title) return;
    const src = await fetchPic(title);
    if (!src || !el.isConnected) return;
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    if (mono) img.className = "mono";   // Wikipedia logos are dark artwork, so flatten them to white
    img.onload = () => { if (el.isConnected) { el.textContent = ""; el.appendChild(img); } };
    img.src = src;
}

/* ---------------- Boot ---------------- */

function start() {
    if (started) return;
    started = true;
    applyProps();
    loadRace();
    loadStandings();
    setInterval(loadStandings, 10 * 60 * 1000);
    setInterval(loadRace, 30 * 60 * 1000);
}
