const ZSF_TOKENS_URL = 'https://raw.githubusercontent.com/simovicc/zabbix-soc-filter/refs/heads/main/tokens.json';
const ZSF_CONFIG_URL = 'https://raw.githubusercontent.com/simovicc/zabbix-soc-filter/refs/heads/main/config.json';
const ZSF_RELEASES_URL = 'https://github.com/simovicc/zabbix-soc-filter/tree/main/releases';
const ZSF_IP_SERVICES = [
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://ifconfig.me/ip'
];
const ZSF_SALT = 'zsf-2026-salt-v1';
const ZSF_CONTACT = {
  ime: 'Stefan Simović',
  email: 'ssimovic@comtrade.com',
  telefon: '+381 60 320 2273',
  linkedin: 'linkedin.com/in/simovicc'
};
const ZSF_INTERVALS = {
  updateCheckMin: 1,
  authCheckMin: 30,
  manualThrottleMs: 30 * 1000,
  graceUpdateMs: 48 * 60 * 60 * 1000,
  graceAuthMs: 24 * 60 * 60 * 1000,
  fetchTimeoutMs: 10 * 1000,
};

function ipToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const x = parseInt(parts[i], 10);
    if (isNaN(x) || x < 0 || x > 255) return null;
    n = (n * 256) + x;
  }
  return n;
}

function cidr(s, label) {
  const parts = String(s).split('/');
  const base = ipToInt(parts[0]);
  const bits = parseInt(parts[1], 10);
  if (base === null || isNaN(bits)) return null;
  const size = Math.pow(2, 32 - bits);
  return { start: base, end: base + size - 1, label: label || 'office' };
}

const ZSF_RANGES = [
  cidr('217.75.193.12/30'),
  cidr('217.75.193.240/30'),
  cidr('217.75.197.32/28'),
  cidr('217.75.197.96/29'),
  cidr('46.163.60.136/29'),
  cidr('109.94.102.0/23'),
  cidr('193.201.207.0/24'),
  cidr('212.200.67.0/24'),
  cidr('80.93.241.112/28'),
  cidr('178.220.232.71/32'),
  cidr('77.46.150.101/32'),
  cidr('93.87.38.40/32'),
  cidr('93.87.38.96/32'),
  cidr('93.87.9.212/32'),
  cidr('185.56.220.0/23'),
  cidr('185.56.222.0/24'),
  cidr('185.56.223.0/24'),
  cidr('193.169.48.0/23'),
  cidr('89.212.82.128/29')
];

function classifyIp(ip) {
  const n = ipToInt(ip);
  if (n === null) return 'unknown';
  for (let i = 0; i < ZSF_RANGES.length; i++) {
    const r = ZSF_RANGES[i];
    if (n >= r.start && n <= r.end) return r.label;
  }
  return 'home';
}

const K = {
  username: 'zsf.username',
  tokenHash: 'zsf.tokenHash',
  authState: 'zsf.authState',
  authReason: 'zsf.authReason',
  authLastOk: 'zsf.authLastOk',
  authLastManual: 'zsf.authLastManual',
  versionLatest: 'zsf.versionLatest',
  versionMin: 'zsf.versionMin',
  versionLastOk: 'zsf.versionLastOk',
  versionLastManual: 'zsf.versionLastManual',
  locationLabel: 'zsf.locationLabel',
  locationLastOk: 'zsf.locationLastOk',
  locationError: 'zsf.locationError',
  locationLastError: 'zsf.locationLastError',
  lastNotifiedVersion: 'zsf.lastNotifiedVersion',
  versionBehindSince: 'zsf.versionBehindSince'
};

const ALARM_AUTH = 'zsf.auth';
const ALARM_VERSION = 'zsf.version';
const ALARM_LOCATION = 'zsf.location';

function logErr(label, err) {
  try {
    const msg = err && err.message ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
    console.error('[ZSF]', label, msg);
  } catch (_) {}
}

async function sget(keys) {
  try { return await chrome.storage.local.get(keys); }
  catch (e) { logErr('storage.get', e); return {}; }
}

async function sset(obj) {
  try { await chrome.storage.local.set(obj); }
  catch (e) { logErr('storage.set', e); }
}

async function sremove(keys) {
  try { await chrome.storage.local.remove(keys); }
  catch (e) { logErr('storage.remove', e); }
}

async function hmacToken(token) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(ZSF_SALT),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function constTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ZSF_INTERVALS.fetchTimeoutMs);
  try {
    const r = await fetch(url + '?t=' + Date.now(), {
      cache: 'no-store',
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

async function checkAuth() {
  const stored = await sget([K.username, K.tokenHash, K.authState, K.authLastOk]);
  const username = stored[K.username];
  const tokenHash = stored[K.tokenHash];

  if (!username || !tokenHash) {
    await sset({ [K.authState]: 'pending', [K.authReason]: null });
    return { state: 'pending' };
  }

  try {
    const data = await fetchJson(ZSF_TOKENS_URL);
    const user = (data.users || []).find(u => u.username === username);

    if (!user) {
      await sset({ [K.authState]: 'locked', [K.authReason]: 'not_found' });
      return { state: 'locked', reason: 'not_found' };
    }
    if (user.revoked) {
      await sset({ [K.authState]: 'locked', [K.authReason]: 'revoked' });
      return { state: 'locked', reason: 'revoked' };
    }
    if (!constTimeEq(user.hash, tokenHash)) {
      await sset({ [K.authState]: 'locked', [K.authReason]: 'mismatch' });
      return { state: 'locked', reason: 'mismatch' };
    }

    await sset({
      [K.authState]: 'active',
      [K.authLastOk]: Date.now(),
      [K.authReason]: null
    });
    return { state: 'active' };
  } catch (err) {
    logErr('checkAuth fetch', err);
    const lastOk = stored[K.authLastOk] || 0;
    if (lastOk === 0 || Date.now() - lastOk > ZSF_INTERVALS.graceAuthMs) {
      await sset({ [K.authState]: 'locked', [K.authReason]: 'grace_expired_auth' });
      return { state: 'locked', reason: 'grace_expired_auth' };
    }
    return { state: 'active', graceActive: true };
  }
}

async function checkVersion() {
  try {
    const data = await fetchJson(ZSF_CONFIG_URL);
    const latest = data.currentVersion || null;
    let myVersion = '0';
    try { myVersion = chrome.runtime.getManifest().version; } catch (e) {}
    const behind = latest && cmpVersion(latest, myVersion) > 0;
    const stored = await sget([K.versionBehindSince]);
    let behindSince = stored[K.versionBehindSince] || 0;
    if (behind) {
      if (!behindSince) behindSince = Date.now();
    } else {
      behindSince = 0;
    }
    await sset({
      [K.versionLatest]: latest,
      [K.versionMin]: data.minSupportedVersion || null,
      [K.versionLastOk]: Date.now(),
      [K.versionBehindSince]: behindSince,
      'zsf.dondonShare': (data.dondonShare && data.dondonShare.url) ? data.dondonShare : null
    });
    await maybeNotifyUpdate(latest);
    return { ok: true };
  } catch (err) {
    logErr('checkVersion fetch', err);
    return { ok: false };
  }
}

async function maybeNotifyUpdate(latest) {
  if (!latest) return;
  let myVersion = '0';
  try { myVersion = chrome.runtime.getManifest().version; } catch (e) {}
  if (cmpVersion(latest, myVersion) <= 0) return;

  try {
    if (chrome.runtime && typeof chrome.runtime.requestUpdateCheck === 'function') {
      chrome.runtime.requestUpdateCheck(function () { void chrome.runtime.lastError; });
    }
  } catch (e) {}

  const stored = await sget([K.lastNotifiedVersion]);
  if (stored[K.lastNotifiedVersion] === latest) return;
  await sset({ [K.lastNotifiedVersion]: latest });

  try {
    if (chrome.notifications && typeof chrome.notifications.create === 'function') {
      let iconUrl = '';
      try { iconUrl = chrome.runtime.getURL('icons/icon128.png'); } catch (e) {}
      chrome.notifications.create('zsf-update-' + latest, {
        type: 'basic',
        iconUrl: iconUrl,
        title: 'Zabbix SOC Filter - nova verzija ' + latest,
        message: 'Klikni za direktan download iz repo-a. Waterfox je povlači i sam; Chrome korisnici skinu ZIP.'
      }, function () { void chrome.runtime.lastError; });
    }
  } catch (e) {}
}

function browserIsFirefox() {
  try {
    return /firefox|waterfox|librewolf/i.test((self.navigator && self.navigator.userAgent) || '');
  } catch (e) {
    return false;
  }
}

async function openLatestDownload() {
  let url = ZSF_RELEASES_URL;
  try {
    const s = await sget([K.versionLatest]);
    const v = s[K.versionLatest];
    if (v) {
      url = 'https://github.com/simovicc/zabbix-soc-filter/raw/main/releases/zabbix-soc-filter-' + v + (browserIsFirefox() ? '.xpi' : '.zip');
    }
  } catch (e) {}
  try {
    if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: url });
  } catch (e) {}
}

try {
  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(function (id) {
      if (id && id.indexOf('zsf-update-') === 0) {
        openLatestDownload();
        try { chrome.notifications.clear(id); } catch (e) {}
      }
    });
  }
} catch (e) {}

async function detectPublicIpClass() {
  for (let i = 0; i < ZSF_IP_SERVICES.length; i++) {
    const url = ZSF_IP_SERVICES[i];
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, ZSF_INTERVALS.fetchTimeoutMs);
    try {
      const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      const ip = (text || '').trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
        return classifyIp(ip);
      }
    } catch (err) {
      logErr('checkLocation ip ' + url, err);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

async function checkLocation() {
  const ipClass = await detectPublicIpClass();

  let base;
  if (ipClass === 'office') base = 'office';
  else if (ipClass === null) base = 'unknown';
  else base = 'home';

  const patch = {
    [K.locationLabel]: base
  };
  if (ipClass === null) {
    patch[K.locationError] = 'all_services_failed';
    patch[K.locationLastError] = Date.now();
  } else {
    patch[K.locationLastOk] = Date.now();
    patch[K.locationError] = null;
  }
  await sset(patch);
}

async function activate(username, token) {
  try {
    const u = String(username || '').trim().toLowerCase();
    const t = String(token || '').trim();
    if (!u || !t) {
      return { ok: false, error: 'Korisničko ime i token su obavezni.' };
    }
    const tokenHash = await hmacToken(t);

    let data;
    try {
      data = await fetchJson(ZSF_TOKENS_URL);
    } catch (err) {
      logErr('activate fetch', err);
      return { ok: false, error: 'Ne mogu da dohvatim listu tokena. Proveri internet konekciju.' };
    }

    const user = (data.users || []).find(x => x.username === u);
    if (!user) return { ok: false, error: 'Korisničko ime nije pronađeno.' };
    if (user.revoked) return { ok: false, error: 'Pristup je opozvan. Kontaktiraj Stefana.' };
    if (!constTimeEq(user.hash, tokenHash)) return { ok: false, error: 'Token nije ispravan.' };

    await sset({
      [K.username]: u,
      [K.tokenHash]: tokenHash,
      [K.authState]: 'active',
      [K.authLastOk]: Date.now(),
      [K.authReason]: null
    });

    await checkVersion();
    await checkLocation();
    return { ok: true };
  } catch (err) {
    logErr('activate', err);
    return { ok: false, error: 'Greška pri aktivaciji.' };
  }
}

async function deactivate() {
  await sremove([
    K.username, K.tokenHash, K.authLastOk, K.authReason, K.authLastManual
  ]);
  await sset({ [K.authState]: 'pending' });
  return { ok: true };
}

async function getCombinedState() {
  const stored = await sget([
    K.username, K.authState, K.authReason, K.authLastOk, K.authLastManual,
    K.versionLatest, K.versionMin, K.versionLastOk, K.versionLastManual, K.versionBehindSince,
    K.locationLabel, K.locationLastOk, K.locationError, K.locationLastError
  ]);

  const myVersion = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0.0.0';
  let versionState = 'ok';
  let versionReason = null;

  if (stored[K.versionMin] && cmpVersion(myVersion, stored[K.versionMin]) < 0) {
    versionState = 'locked';
    versionReason = 'below_min';
  } else if (stored[K.versionLatest] && cmpVersion(myVersion, stored[K.versionLatest]) < 0) {
    versionState = 'update_available';
    const behindSince = stored[K.versionBehindSince] || 0;
    if (behindSince && Date.now() - behindSince > ZSF_INTERVALS.graceUpdateMs) {
      versionState = 'locked';
      versionReason = 'update_required';
    }
  }

  if (stored[K.versionLastOk] && versionState !== 'locked') {
    const since = Date.now() - stored[K.versionLastOk];
    if (since > ZSF_INTERVALS.graceUpdateMs) {
      versionState = 'locked';
      versionReason = 'grace_expired_version';
    }
  }

  const authState = stored[K.authState] || 'pending';
  const effectiveState = (versionState === 'locked') ? 'locked' : authState;

  return {
    state: effectiveState,
    authState: authState,
    authReason: stored[K.authReason] || null,
    versionState: versionState,
    versionReason: versionReason,
    username: stored[K.username] || null,
    myVersion: myVersion,
    latestVersion: stored[K.versionLatest] || null,
    minVersion: stored[K.versionMin] || null,
    authLastOk: stored[K.authLastOk] || 0,
    versionLastOk: stored[K.versionLastOk] || 0,
    authLastManual: stored[K.authLastManual] || 0,
    versionLastManual: stored[K.versionLastManual] || 0,
    locationLabel: stored[K.locationLabel] || null,
    locationLastOk: stored[K.locationLastOk] || 0,
    locationError: stored[K.locationError] || null,
    locationLastError: stored[K.locationLastError] || 0,
    contact: ZSF_CONTACT,
    intervals: ZSF_INTERVALS
  };
}

async function manualCheck(what) {
  const now = Date.now();
  const s = await sget([K.authLastManual, K.versionLastManual]);

  const wantAuth = (what === 'auth' || what === 'both');
  const wantVersion = (what === 'version' || what === 'both');

  const authThrottled = wantAuth && (s[K.authLastManual] || 0) + ZSF_INTERVALS.manualThrottleMs > now;
  const versionThrottled = wantVersion && (s[K.versionLastManual] || 0) + ZSF_INTERVALS.manualThrottleMs > now;

  if (what !== 'both' && (authThrottled || versionThrottled)) {
    return { ok: false, throttled: true };
  }
  if (what === 'both' && authThrottled && versionThrottled) {
    return { ok: false, throttled: true };
  }

  const tasks = [];
  if (wantAuth && !authThrottled) {
    tasks.push((async () => {
      await sset({ [K.authLastManual]: now });
      await checkAuth();
      await checkLocation();
    })());
  }
  if (wantVersion && !versionThrottled) {
    tasks.push((async () => {
      await sset({ [K.versionLastManual]: now });
      await checkVersion();
    })());
  }
  await Promise.all(tasks);
  return { ok: true };
}

async function ensureAlarms() {
  try {
    const existing = await chrome.alarms.getAll();
    const have = new Set(existing.map(a => a.name));
    if (!have.has(ALARM_AUTH)) {
      chrome.alarms.create(ALARM_AUTH, {
        periodInMinutes: ZSF_INTERVALS.authCheckMin,
        delayInMinutes: 1
      });
    }
    if (!have.has(ALARM_VERSION)) {
      chrome.alarms.create(ALARM_VERSION, {
        periodInMinutes: ZSF_INTERVALS.updateCheckMin,
        delayInMinutes: 0.5
      });
    }
    if (!have.has(ALARM_LOCATION)) {
      chrome.alarms.create(ALARM_LOCATION, {
        periodInMinutes: 1,
        delayInMinutes: 0.25
      });
    }
  } catch (e) {
    logErr('ensureAlarms', e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarms();
  await checkVersion();
  await checkAuth();
  await checkLocation();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    await ensureAlarms();
    await checkAuth();
    await checkVersion();
    await checkLocation();
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARM_AUTH) {
      await checkAuth();
      await checkLocation();
    }
    if (alarm.name === ALARM_VERSION) await checkVersion();
    if (alarm.name === ALARM_LOCATION) await checkLocation();
  } catch (e) {
    logErr('alarm handler', e);
  }
});

async function getShareCfg() {
  try {
    const s = await sget(['zsf.dondonShare']);
    const c = s['zsf.dondonShare'];
    if (c && c.url) return c;
  } catch (e) {}
  return null;
}

async function shareAdd(ids) {
  const cfg = await getShareCfg();
  if (!cfg) return { ok: false, error: 'not configured' };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;
    const r = await fetch(cfg.url.replace(/\/+$/, '') + '/add', {
      method: 'POST', headers: headers, body: JSON.stringify({ ids: ids })
    });
    return { ok: r.ok };
  } catch (e) { return { ok: false, error: 'fetch' }; }
}

async function shareList() {
  const cfg = await getShareCfg();
  if (!cfg) return { ok: false, error: 'not configured' };
  try {
    const headers = {};
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;
    const r = await fetch(cfg.url.replace(/\/+$/, '') + '/list', { headers: headers });
    if (!r.ok) return { ok: false };
    const data = await r.json();
    return { ok: true, ids: Array.isArray(data.ids) ? data.ids : [] };
  } catch (e) { return { ok: false }; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: 'no type' });
        return;
      }
      if (msg.type === 'zsf.getState') {
        sendResponse(await getCombinedState());
      } else if (msg.type === 'zsf.activate') {
        sendResponse(await activate(msg.username, msg.token));
      } else if (msg.type === 'zsf.deactivate') {
        sendResponse(await deactivate());
      } else if (msg.type === 'zsf.checkNow') {
        sendResponse(await manualCheck(msg.what || 'both'));
      } else if (msg.type === 'zsf.refreshLocation') {
        await checkLocation();
        const st = await getCombinedState();
        sendResponse({ ok: true, locationLabel: st.locationLabel, locationError: st.locationError });
      } else if (msg.type === 'zsf.shareAdd') {
        sendResponse(await shareAdd(msg.ids));
      } else if (msg.type === 'zsf.shareList') {
        sendResponse(await shareList());
      } else {
        sendResponse({ ok: false, error: 'unknown type' });
      }
    } catch (e) {
      logErr('onMessage', e);
      try { sendResponse({ ok: false, error: 'internal' }); } catch (_) {}
    }
  })();
  return true;
});

ensureAlarms();
