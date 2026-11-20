/**
 * Spotify - Spotify Controller for Xeneon Edge
 * 
 * Communicates directly with the Spotify Web API (no companion server needed).
 * Uses PKCE OAuth tokens stored in iCUE settings.
 */

// ── State ─────────────────────────────────────────────────────────
const state = {
  clientId: '',
  refreshToken: '',
  pollingInterval: 1000,
  viewMode: 'nowplaying',
  halfMode: false,
  albumBlur: 0,
  textColor: '#ffffff',
  accentColor: '#1DB954',
  backgroundColor: '#121212',
  bgTransparency: 0,
  songInfoColor: '#ffffff',
  playBtnColor: '#1DB954',
  prevNextColor: '#ffffff',
  activeBtnColor: '#1DB954',
  barFillColor: '#1DB954',
};

let pollTimer = null;
let isSeeking = false;
let isDraggingVolume = false;
let currentPlayback = null;
let lastError = '';
let idleDeviceId = null;
let currentArt = null;
let lastQueueFetch = 0;
let lastQueueTrackId = null;
// Five rows are visible (sized in CSS); the rest is reachable by scrolling
const QUEUE_SIZE = 20;
const QUEUE_REFRESH_MS = 15000;
let rateLimitedUntil = 0;
let rateLimitHits = 0;
let rateLimitInfo = '';
const requestLog = [];
let totalRequests = 0;
let progressBase = null;
let cachedAccessToken = null;
let tokenExpiresAt = 0;

// ── Adaptive Polling ────────────────────────────────────────────────
let currentInterval = 0;          // actual interval used right now (set when polling starts)
let consecutiveErrors = 0;        // 429 or network errors
let isPaused = false;             // whether we know playback is paused
let isSessionAlive = false;       // whether we have a known active device
let pollTimeout = null;           // setTimeout handle for adaptive polling

// ── DOM References ────────────────────────────────────────────────
const dom = {
  loading: document.getElementById('state-loading'),
  offline: document.getElementById('state-offline'),
  nodevice: document.getElementById('state-nodevice'),
  noauth: document.getElementById('state-noauth'),
  offlineDetail: document.getElementById('offline-detail'),
  player: document.getElementById('player'),
  queue: document.getElementById('queue'),
  queueList: document.getElementById('queue-list'),
  queueEmpty: document.getElementById('queue-empty'),
  trackName: document.getElementById('track-name'),
  trackArtist: document.getElementById('track-artist'),
  progressBar: document.getElementById('progress-bar'),
  progressFill: document.getElementById('progress-fill'),
  progressThumb: document.getElementById('progress-thumb'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  playIcon: document.getElementById('play-icon'),
  pauseIcon: document.getElementById('pause-icon'),
  btnPlay: document.getElementById('btn-play'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnShuffle: document.getElementById('btn-shuffle'),
  btnRepeat: document.getElementById('btn-repeat'),
  repeatIndicator: document.getElementById('repeat-indicator'),
  volumeBar: document.getElementById('volume-bar'),
  volumeFill: document.getElementById('volume-fill'),
  volumeThumb: document.getElementById('volume-thumb'),
};

// ── Settings (from iCUE) ──────────────────────────────────────────
function getIcueProperty(name, defaultValue) {
  try {
    if (typeof window !== 'undefined' && name in window) {
      const val = window[name];
      if (val !== undefined && val !== null && val !== '') return val;
    }
    const val = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
    if (val !== undefined && val !== null && val !== '') return val;
  } catch (e) { /* ignore */ }
  return defaultValue;
}

function applySettings(settings = {}) {
  Object.assign(state, settings);
  state.backgroundColor = getIcueProperty('backgroundColor', state.backgroundColor);
  state.bgTransparency = getIcueProperty('bgTransparency', state.bgTransparency);
  state.clientId = String(getIcueProperty('clientId', state.clientId)).trim();
  state.refreshToken = String(getIcueProperty('refreshToken', state.refreshToken)).trim();
  state.pollingInterval = getIcueProperty('pollingInterval', state.pollingInterval);
  state.viewMode = getIcueProperty('viewMode', state.viewMode) === 'queue' ? 'queue' : 'nowplaying';
  lastQueueFetch = 0;
  state.halfMode = getIcueProperty('halfMode', state.halfMode) === true;
  state.albumBlur = Number(getIcueProperty('albumBlur', state.albumBlur)) || 0;
  document.documentElement.style.setProperty('--album-blur', state.albumBlur + 'px');
  const root = document.documentElement.classList;
  root.toggle('half-top', state.halfMode && state.viewMode !== 'queue');
  root.toggle('half-bottom', state.halfMode && state.viewMode === 'queue');
  state.songInfoColor = getIcueProperty('songInfoColor', state.songInfoColor);
  state.playBtnColor = getIcueProperty('playBtnColor', state.playBtnColor);
  state.prevNextColor = getIcueProperty('prevNextColor', state.prevNextColor);
  state.activeBtnColor = getIcueProperty('activeBtnColor', state.activeBtnColor);
  state.barFillColor = getIcueProperty('barFillColor', state.barFillColor);
  
  // Apply CSS variables
  document.documentElement.style.setProperty('--text-color', state.textColor);
  document.documentElement.style.setProperty('--accent-color', state.accentColor);
  document.documentElement.style.setProperty('--background-color', state.backgroundColor);
  document.documentElement.style.setProperty('--bg-transparency', state.bgTransparency + '%');
  document.documentElement.style.setProperty('--song-info-color', state.songInfoColor);
  document.documentElement.style.setProperty('--play-btn-color', state.playBtnColor);
  document.documentElement.style.setProperty('--prev-next-color', state.prevNextColor);
  document.documentElement.style.setProperty('--active-btn-color', state.activeBtnColor);
  document.documentElement.style.setProperty('--bar-fill-color', state.barFillColor);

  // Dynamic play button icon color (black on bright bg, white on dark bg)
  const hex = state.playBtnColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const iconColor = luminance > 0.5 ? '#000000' : '#ffffff';
  document.documentElement.style.setProperty('--play-btn-icon-color', iconColor);

  // Restart polling with new interval if changed
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  pollTimer = null;
  startPolling();
}

// ── Spotify Token Management ──────────────────────────────────────
// A request that never completes (for example while iCUE waits on a network
// permission) would otherwise stop polling for good, leaving "Connecting..."
const FETCH_TIMEOUT_MS = 15000;
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Concurrent callers share one token request instead of each sending their own
let tokenRequest = null;
function refreshAccessToken() {
  if (!tokenRequest) {
    tokenRequest = requestAccessToken().finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
}

async function requestAccessToken() {
  if (!state.clientId || !state.refreshToken) {
    console.log('[Spotify] No client ID or refresh token configured');
    return null;
  }

  try {
    const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: state.refreshToken,
        client_id: state.clientId,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn('[Spotify] Token refresh failed:', response.status, err);
      lastError = 'Token refresh failed (' + response.status + '): ' + err.slice(0, 120);
      return null;
    }

    const data = await response.json();
    if (!data.access_token) {
      lastError = 'Token response had no access token';
      return null;
    }
    cachedAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return cachedAccessToken;
  } catch (e) {
    console.warn('[Spotify] Token refresh error:', e.message);
    lastError = 'Token request error: ' + e.message;
    return null;
  }
}

async function getValidToken() {
  // If we have a cached token that's still valid, use it
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }
  // Otherwise refresh
  return await refreshAccessToken();
}

// ── Spotify API Calls ─────────────────────────────────────────────
function requestStats() {
  const cutoff = Date.now() - 60000;
  while (requestLog.length && requestLog[0] < cutoff) requestLog.shift();
  return 'This widget sent ' + requestLog.length + ' requests in the last 60s (' + totalRequests + ' since load)';
}

async function spotifyApi(endpoint, method = 'GET', body = null) {
  requestLog.push(Date.now());
  totalRequests++;
  const token = await getValidToken();
  if (!token) {
    return null;
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetchWithTimeout(`https://api.spotify.com/v1${endpoint}`, options);

    if (response.status === 401) {
      // Token expired, try refreshing once
      const newToken = await refreshAccessToken();
      if (newToken) {
        options.headers['Authorization'] = `Bearer ${newToken}`;
        return await fetchWithTimeout(`https://api.spotify.com/v1${endpoint}`, options);
      }
      lastError = 'Spotify rejected the access token (401)';
      return null;
    }

    if (response.status === 429) {
      // Rate limited — apply exponential backoff
      const rawRetry = response.headers.get('Retry-After');
      rateLimitInfo = 'on ' + endpoint.split('?')[0] + ', Retry-After: ' + (rawRetry === null ? 'not readable' : rawRetry + 's');
      lastError = 'Rate limited by Spotify (429) ' + rateLimitInfo + '. ' + requestStats();
      const retryAfter = parseInt(rawRetry || '0', 10);
      handleRateLimit(retryAfter);
      return null;
    }

    return response;
  } catch (e) {
    console.warn('[Spotify] API error:', e.message);
    lastError = 'API request error: ' + e.message;
    consecutiveErrors++;
    return null;
  }
}

async function fetchStatus() {
  const response = await spotifyApi('/me/player');
  // response === null means API unavailable (network error, rate limit, etc.)
  if (!response) return { active: false, auth: null, data: null };
  
  if (response.status === 204) {
    return { active: false, auth: true, data: null };
  }

  try {
    const data = await response.json();
    return {
      active: true,
      auth: true,
      data: {
        is_playing: data.is_playing,
        progress_ms: data.progress_ms,
        item: data.item ? {
          id: data.item.id,
          name: data.item.name,
          artists: data.item.artists.map(a => a.name),
          duration_ms: data.item.duration_ms,
          album_art: data.item.album.images?.[0]?.url || null,
        } : null,
        device: data.device ? {
          volume_percent: data.device.volume_percent,
        } : null,
        shuffle_state: data.shuffle_state,
        repeat_state: data.repeat_state,
      },
    };
  } catch (e) {
    return { active: false, auth: true, data: null };
  }
}

async function fetchQueue() {
  const response = await spotifyApi('/me/player/queue');
  if (!response || !response.ok) return null;
  try {
    const data = await response.json();
    return (data.queue || []).slice(0, QUEUE_SIZE).map(t => ({
      name: t.name,
      art: (t.album?.images || t.images || []).slice(-2)[0]?.url || null,
      artists: t.artists ? t.artists.map(a => a.name) : (t.show?.publisher ? [t.show.publisher] : []),
    }));
  } catch (e) {
    return null;
  }
}

async function sendControl(endpoint, method = 'PUT', body = null) {
  await spotifyApi(endpoint, method, body);
}

// ── Polling ───────────────────────────────────────────────────────
function startPolling() {
  if (pollTimer) return;
  pollTimer = true;
  currentInterval = state.pollingInterval;
  scheduleNextPoll(0);
}

function scheduleNextPoll(delay) {
  if (pollTimeout) clearTimeout(pollTimeout);
  pollTimeout = setTimeout(runPoll, delay);
}

// Compute the current adaptive interval based on state
function getAdaptiveInterval() {
  const base = Math.max(state.pollingInterval, 1000);

  // If we're in error backoff, keep the current (already increased) interval
  if (consecutiveErrors > 0) {
    return currentInterval;
  }

  // No known session → slowest
  if (!isSessionAlive) return Math.min(base * 10, 30000);
  // Paused → medium
  if (isPaused) return Math.min(base * 5, 10000);
  // Playing → base interval
  return base;
}

// Jitter to avoid thundering-herd sync with other clients
function jitter(ms) {
  return ms + Math.floor(Math.random() * 500);
}

async function runPoll() {
  try {
    await runPollInner();
  } catch (e) {
    console.warn('[Spotify] Poll error:', e);
    lastError = 'Unexpected error: ' + e.message;
    dom.offlineDetail.textContent = lastError;
    showState('offline');
    scheduleNextPoll(jitter(Math.max(currentInterval, 5000)));
  }
}

async function runPollInner() {
  const waitLeft = rateLimitedUntil - Date.now();
  if (waitLeft > 0) {
    // Leave the current view in place if there is one; otherwise explain
    if (!currentPlayback) {
      dom.offlineDetail.textContent = 'Rate limited by Spotify ' + rateLimitInfo + '. Next attempt in ' + formatWait(waitLeft) + '. ' + requestStats();
      showState('offline');
    }
    scheduleNextPoll(Math.min(waitLeft + 500, 30000));
    return;
  }

  // Check if credentials are configured
  if (!state.clientId || !state.refreshToken) {
    showState('noauth');
    scheduleNextPoll(jitter(currentInterval));
    return;
  }

  const result = await fetchStatus();

  // result.auth === null means API unavailable (network / rate limit)
  if (result.auth === null) {
    consecutiveErrors++;
    if (consecutiveErrors >= 3) {
      // Back off aggressively
      currentInterval = Math.min(currentInterval * 2, 60000);
    }
    if (!(currentPlayback && Date.now() < rateLimitedUntil)) {
      dom.offlineDetail.textContent = lastError || 'No response from Spotify (no details available)';
      showState('offline');
    }
    scheduleNextPoll(jitter(currentInterval));
    return;
  }

  // Successful request — reset error counters
  consecutiveErrors = 0;
  rateLimitHits = 0;

  if (!result.active || !result.data) {
    // No active playback. Spotify drops the active session after a while
    // even when the app is open, so look for any available device.
    const device = await findDevice();
    if (device) {
      idleDeviceId = device.id;
      isSessionAlive = true;
      isPaused = true;
      showIdle();
    } else {
      idleDeviceId = null;
      isSessionAlive = false;
      isPaused = false;
      showState('nodevice');
    }
    currentInterval = getAdaptiveInterval();
    scheduleNextPoll(jitter(currentInterval));
    return;
  }

  // Active playback
  idleDeviceId = null;
  isSessionAlive = true;
  isPaused = !result.data.is_playing;

  updatePlayback(result.data);
  if (state.viewMode === 'queue') {
    showState('queue');
    await refreshQueue(result.data.item?.id);
  } else {
    showState('player');
  }

  // Use adaptive interval
  currentInterval = getAdaptiveInterval();
  scheduleNextPoll(jitter(currentInterval));
}

// Find a device that can be started, preferring the active one
async function findDevice() {
  try {
    const response = await spotifyApi('/me/player/devices');
    if (response && response.ok) {
      const data = await response.json();
      const devices = data.devices || [];
      return devices.find(d => d.is_active) || devices.find(d => d.type === 'Computer') || devices[0] || null;
    }
  } catch (e) {
    console.warn('[Spotify] Device lookup failed:', e.message);
  }
  return null;
}

// A device exists but nothing is playing: show the last track as paused
function showIdle() {
  if (currentPlayback) {
    updatePlayback({ ...currentPlayback, is_playing: false });
  } else {
    dom.trackName.textContent = 'Nothing playing';
    dom.trackArtist.textContent = '';
    dom.playIcon.classList.remove('state-hidden');
    dom.pauseIcon.classList.add('state-hidden');
  }
  showState(state.viewMode === 'queue' ? 'queue' : 'player');
  if (state.viewMode === 'queue' && !currentPlayback) renderQueue([]);
}

// Handle 429 rate-limit responses with exponential backoff
function handleRateLimit(retryAfterSec) {
  consecutiveErrors++;
  rateLimitHits++;
  // Retry-After may be unreadable from the widget, so escalate when it is missing
  const fallback = Math.min(30 * Math.pow(2, rateLimitHits - 1), 300);
  const waitMs = Math.max(retryAfterSec || 0, fallback) * 1000;
  rateLimitedUntil = Date.now() + waitMs;
  console.warn('[Spotify] Rate limited. Pausing requests for', waitMs, 'ms');
}

// ── UI State Management ───────────────────────────────────────────
function showState(name) {
  const states = ['loading', 'offline', 'nodevice', 'noauth', 'player', 'queue'];
  states.forEach(s => {
    const el = dom[s];
    if (el) {
      if (s === name) {
        el.classList.remove('state-hidden');
        el.removeAttribute('hidden');
      } else {
        el.classList.add('state-hidden');
        el.setAttribute('hidden', '');
      }
    }
  });
}

// ── Playback Update ───────────────────────────────────────────────
function updatePlayback(data) {
  currentPlayback = data;
  
  // Track info
  if (data.item) {
    dom.trackName.textContent = data.item.name || '-';
    dom.trackArtist.textContent = data.item.artists ? data.item.artists.join(', ') : '-';

    if (data.item.album_art && data.item.album_art !== currentArt) {
      currentArt = data.item.album_art;
      document.documentElement.style.setProperty('--album-art', `url("${currentArt}")`);
    }
  }
  
  // Play/Pause button
  if (data.is_playing) {
    dom.playIcon.classList.add('state-hidden');
    dom.pauseIcon.classList.remove('state-hidden');
  } else {
    dom.playIcon.classList.remove('state-hidden');
    dom.pauseIcon.classList.add('state-hidden');
  }
  
  progressBase = data.is_playing && data.progress_ms != null ? { ms: data.progress_ms, at: Date.now() } : null;

  // Progress (only if not seeking)
  if (!isSeeking && data.progress_ms != null && data.item?.duration_ms) {
    const pct = (data.progress_ms / data.item.duration_ms) * 100;
    dom.progressFill.style.width = pct + '%';
    dom.progressThumb.style.left = pct + '%';
    dom.timeCurrent.textContent = formatTime(data.progress_ms);
    dom.timeTotal.textContent = formatTime(data.item.duration_ms);
  }
  
  // Shuffle
  dom.btnShuffle.dataset.active = data.shuffle_state ? 'true' : 'false';
  
  // Repeat
  dom.btnRepeat.dataset.active = data.repeat_state !== 'off' ? 'true' : 'false';
  dom.repeatIndicator.hidden = data.repeat_state !== 'track';
  dom.repeatIndicator.textContent = '1';
  
  // Volume
  if (data.device && data.device.volume_percent != null && !isDraggingVolume) {
    const vol = data.device.volume_percent;
    dom.volumeFill.style.width = vol + '%';
    dom.volumeThumb.style.left = vol + '%';
  }
}

// ── Queue ─────────────────────────────────────────────────────────
async function refreshQueue(trackId) {
  const trackChanged = trackId !== lastQueueTrackId;
  if (!trackChanged && Date.now() - lastQueueFetch < QUEUE_REFRESH_MS) return;
  lastQueueFetch = Date.now();
  const items = await fetchQueue();
  if (!items) return;
  lastQueueTrackId = trackId;
  renderQueue(items, trackChanged);
}

function renderQueue(items, resetScroll = true) {
  const scrollTop = dom.queueList.scrollTop;
  dom.queueList.textContent = '';
  dom.queueEmpty.hidden = items.length > 0;
  items.forEach((t) => {
    const li = document.createElement('li');
    const art = document.createElement('img');
    art.className = 'queue-art';
    art.alt = '';
    if (t.art) art.src = t.art;
    const text = document.createElement('div');
    text.className = 'queue-text';
    const name = document.createElement('div');
    name.className = 'queue-title';
    name.textContent = t.name || '-';
    const artist = document.createElement('div');
    artist.className = 'queue-artist';
    artist.textContent = t.artists.length ? t.artists.join(', ') : '-';
    text.append(name, artist);
    li.append(art, text);
    dom.queueList.appendChild(li);
  });
  // Keep the user's scroll position across the periodic refresh
  dom.queueList.scrollTop = resetScroll ? 0 : scrollTop;
}

// Fill in progress between polls so slower polling still looks smooth
setInterval(() => {
  const item = currentPlayback?.item;
  if (!progressBase || isSeeking || !item?.duration_ms) return;
  const ms = Math.min(progressBase.ms + (Date.now() - progressBase.at), item.duration_ms);
  const pct = (ms / item.duration_ms) * 100;
  dom.progressFill.style.width = pct + '%';
  dom.progressThumb.style.left = pct + '%';
  dom.timeCurrent.textContent = formatTime(ms);
}, 500);

// ── Controls ──────────────────────────────────────────────────────
dom.btnPlay.addEventListener('click', async () => {
  if (currentPlayback?.is_playing) {
    await sendControl('/me/player/pause', 'PUT');
  } else {
    // With no active session the device must be named to wake it
    const q = idleDeviceId ? `?device_id=${encodeURIComponent(idleDeviceId)}` : '';
    await sendControl('/me/player/play' + q, 'PUT');
  }
});

dom.btnNext.addEventListener('click', async () => {
  await sendControl('/me/player/next', 'POST');
});

dom.btnPrev.addEventListener('click', async () => {
  await sendControl('/me/player/previous', 'POST');
});

dom.btnShuffle.addEventListener('click', async () => {
  const newState = dom.btnShuffle.dataset.active !== 'true';
  await sendControl(`/me/player/shuffle?state=${newState}`, 'PUT');
  dom.btnShuffle.dataset.active = newState ? 'true' : 'false';
});

dom.btnRepeat.addEventListener('click', async () => {
  const current = dom.btnRepeat.dataset.active === 'true' 
    ? (dom.repeatIndicator.hidden ? 'context' : 'track') 
    : 'off';
  const next = current === 'off' ? 'context' : current === 'context' ? 'track' : 'off';
  await sendControl(`/me/player/repeat?state=${next}`, 'PUT');
  dom.btnRepeat.dataset.active = next !== 'off' ? 'true' : 'false';
  dom.repeatIndicator.hidden = next !== 'track';
});

// ── Seek ──────────────────────────────────────────────────────────
let seekPending = null;

dom.progressBar.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  isSeeking = true;
  seekMove(e);
  document.addEventListener('pointermove', seekMove);
  document.addEventListener('pointerup', seekEnd);
});

function seekMove(e) {
  const rect = dom.progressBar.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  x = Math.max(0, Math.min(1, x));
  dom.progressFill.style.width = (x * 100) + '%';
  dom.progressThumb.style.left = (x * 100) + '%';
  
  if (currentPlayback?.item?.duration_ms) {
    dom.timeCurrent.textContent = formatTime(x * currentPlayback.item.duration_ms);
  }
  
  seekPending = x;
}

function seekEnd() {
  document.removeEventListener('pointermove', seekMove);
  document.removeEventListener('pointerup', seekEnd);
  isSeeking = false;
  
  if (seekPending != null && currentPlayback?.item?.duration_ms) {
    const pos = Math.round(seekPending * currentPlayback.item.duration_ms);
    sendControl(`/me/player/seek?position_ms=${pos}`, 'PUT');
    seekPending = null;
  }
}

// ── Volume ────────────────────────────────────────────────────────
let volumePending = null;

dom.volumeBar.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  isDraggingVolume = true;
  volumeMove(e);
  document.addEventListener('pointermove', volumeMove);
  document.addEventListener('pointerup', volumeEnd);
});

function volumeMove(e) {
  const rect = dom.volumeBar.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  x = Math.max(0, Math.min(1, x));
  dom.volumeFill.style.width = (x * 100) + '%';
  dom.volumeThumb.style.left = (x * 100) + '%';
  volumePending = Math.round(x * 100);
}

function volumeEnd() {
  document.removeEventListener('pointermove', volumeMove);
  document.removeEventListener('pointerup', volumeEnd);
  isDraggingVolume = false;
  
  if (volumePending != null) {
    sendControl(`/me/player/volume?volume_percent=${volumePending}`, 'PUT');
    volumePending = null;
  }
}

function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return s + 's';
}

// ── Helpers ───────────────────────────────────────────────────────
function formatTime(ms) {
  if (!ms && ms !== 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ── Init ──────────────────────────────────────────────────────────
// Show loading immediately
showState('loading');

// Start after a short delay to let iCUE settings apply
setTimeout(() => {
  startPolling();
}, 300);

// Poll again right away when the page comes back into view (page switch on the
// display), instead of waiting out a long idle interval or a stalled timer
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pollTimer) scheduleNextPoll(0);
});