'use strict';

const browserAPI = (typeof browser !== 'undefined') ? browser :
                   (typeof chrome !== 'undefined') ? chrome : null;

const $ = function (id) { return document.getElementById(id); };

const filterZone = $('filter-zone');
const filterStateEl = $('filter-state');
const soundZone = $('sound-zone');
const volumeSlider = $('volume-slider');
const volumeValue = $('volume-value');
const notifZone = $('notif-zone');
const permWarn = $('perm-warn');
const dccptLinkBtn = $('dccpt-link-btn');

const DCCPT_URL = 'https://comtradegroup.sharepoint.com/:x:/r/sites/ICT-Delivery657/_layouts/15/Doc2.aspx?action=edit&sourcedoc=%7Bcc7e1ee2-077d-46a2-a126-3afb92384a66%7D&wdOrigin=TEAMS-MAGLEV.undefined_ns.rwc&wdExp=TEAMS-TREATMENT&wdhostclicktime=1762686101302&web=1';

let state = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 0.5,
  notificationsEnabled: true,
  notificationPermission: 'default',
  hiddenCount: 0,
  visibleCount: 0,
  analystName: '',
  isDonDon: false
};

let activeTabId = null;
let isReady = false;
let inFlight = false;

function setZoneState(zone, isOn, isDisabled) {
  if (!zone) return;
  zone.classList.toggle('is-on', !!isOn);
  zone.classList.toggle('is-disabled', !!isDisabled);
}

function updatePermWarn(permission) {
  while (permWarn.firstChild) permWarn.removeChild(permWarn.firstChild);
  if (!isReady || state.isDonDon || !state.notificationsEnabled || permission === 'granted' || permission === 'unsupported') {
    permWarn.classList.add('hidden');
    return;
  }
  permWarn.classList.remove('hidden');
  if (permission === 'denied') {
    permWarn.appendChild(document.createTextNode('Dozvola za notifikacije je odbijena. Otvori podešavanja sajta za Zabbix (ikona pored adrese) i ručno dozvoli notifikacije.'));
  } else {
    permWarn.appendChild(document.createTextNode('Notifikacije još nisu odobrene u browseru.'));
    const btn = document.createElement('button');
    btn.className = 'perm-warn-btn';
    btn.type = 'button';
    btn.textContent = 'Zatraži dozvolu';
    btn.addEventListener('click', requestNotifPermission);
    permWarn.appendChild(document.createElement('br'));
    permWarn.appendChild(btn);
  }
}

async function requestNotifPermission() {
  const resp = await send('requestNotificationPermission');
  if (resp && resp.permission) {
    state.notificationPermission = resp.permission;
    renderUI();
  }
}

function renderUI() {

  setZoneState(filterZone, state.enabled, !isReady);
  filterStateEl.textContent = !isReady ? 'OTVORI ZABBIX' :
                              (state.enabled ? 'UKLJUČEN' : 'ISKLJUČEN');

  setZoneState(soundZone, state.soundEnabled, !isReady);
  const volPct = Math.round((state.soundVolume != null ? state.soundVolume : 0.5) * 100);
  volumeSlider.value = volPct;
  volumeValue.textContent = volPct + '%';
  volumeSlider.disabled = !isReady || !state.soundEnabled;

  setZoneState(notifZone, state.notificationsEnabled, !isReady);
  updatePermWarn(state.notificationPermission);
}

function showInactive() {
  isReady = false;
  state = {
    enabled: false,
    soundEnabled: false,
    soundVolume: 0.5,
    notificationsEnabled: false,
    notificationPermission: 'default',
    hiddenCount: 0,
    visibleCount: 0,
    analystName: '',
    isDonDon: false
  };
  renderUI();
}

async function getActiveTab() {
  if (!browserAPI || !browserAPI.tabs) return null;
  try {
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  } catch (e) {
    return null;
  }
}

function send(action, extra) {
  return new Promise(function (resolve) {
    if (activeTabId == null || !browserAPI || !browserAPI.tabs) {
      resolve(null);
      return;
    }
    const msg = Object.assign({}, extra || {}, { action: action });
    let settled = false;
    let timeoutId = null;
    const finish = function (resp) {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve(resp || null);
    };
    timeoutId = setTimeout(function () { finish(null); }, 3000);
    try {
      const result = browserAPI.tabs.sendMessage(activeTabId, msg, finish);
      if (result && typeof result.then === 'function') {
        result.then(finish).catch(function () { finish(null); });
      }
    } catch (e) {
      finish(null);
    }
  });
}

function applyResponseToState(response) {
  if (!response || typeof response !== 'object') return false;
  state.enabled = !!response.enabled;
  state.soundEnabled = !!response.soundEnabled;
  state.soundVolume = response.soundVolume != null ? response.soundVolume : 0.5;
  state.notificationsEnabled = !!response.notificationsEnabled;
  state.notificationPermission = response.notificationPermission || 'default';
  state.hiddenCount = response.hiddenCount || 0;
  state.visibleCount = response.visibleCount || 0;
  state.analystName = typeof response.analystName === 'string' ? response.analystName : '';
  state.isDonDon = !!response.isDonDon;
  return true;
}

async function loadStatus() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    showInactive();
    return;
  }
  activeTabId = tab.id;

  const response = await send('getStatus');
  if (applyResponseToState(response)) {
    isReady = true;
    renderUI();
  } else {
    showInactive();
  }
}

async function toggleAction(stateKey, sendAction) {
  if (!isReady || inFlight) return;
  inFlight = true;
  const oldValue = state[stateKey];
  state[stateKey] = !oldValue;
  renderUI();
  try {
    const resp = await send(sendAction, { enabled: state[stateKey] });
    if (!resp || !resp.ok) {
      state[stateKey] = oldValue;
      renderUI();
    }
  } catch (e) {
    state[stateKey] = oldValue;
    renderUI();
  } finally {
    inFlight = false;
  }
}

filterZone.addEventListener('click', function (e) {
  e.preventDefault();
  toggleAction('enabled', 'setEnabled');
});

soundZone.addEventListener('click', function (e) {
  e.preventDefault();
  toggleAction('soundEnabled', 'setSoundEnabled');
});

notifZone.addEventListener('click', async function (e) {
  e.preventDefault();
  if (!isReady || inFlight) return;
  inFlight = true;

  const oldValue = state.notificationsEnabled;
  const newValue = !oldValue;
  state.notificationsEnabled = newValue;
  renderUI();

  try {
    const resp = await send('setNotificationsEnabled', { enabled: newValue });
    if (!resp || !resp.ok) {
      state.notificationsEnabled = oldValue;
      renderUI();
      return;
    }
    if (newValue) {
      const permResp = await send('requestNotificationPermission');
      if (permResp && permResp.permission) {
        state.notificationPermission = permResp.permission;
        renderUI();
      }
    }
  } catch (e) {
    state.notificationsEnabled = oldValue;
    renderUI();
  } finally {
    inFlight = false;
  }
});

volumeSlider.addEventListener('input', function () {
  const pct = parseInt(volumeSlider.value, 10);
  if (!isNaN(pct)) volumeValue.textContent = pct + '%';
});

volumeSlider.addEventListener('change', async function () {
  if (!isReady) return;
  const pct = parseInt(volumeSlider.value, 10);
  if (isNaN(pct)) return;
  const vol = pct / 100;
  state.soundVolume = vol;
  await send('setSoundVolume', { volume: vol });
});

dccptLinkBtn.addEventListener('click', function (e) {
  e.preventDefault();

  const fallbackOpen = function () {
    try {
      const win = window.open(DCCPT_URL, '_blank');
      if (win) {
        try { window.close(); } catch (closeErr) {}
      }
    } catch (openErr) {}
  };

  if (!browserAPI || !browserAPI.tabs || !browserAPI.tabs.create) {
    fallbackOpen();
    return;
  }

  let result;
  try {
    result = browserAPI.tabs.create({ url: DCCPT_URL });
  } catch (createErr) {
    fallbackOpen();
    return;
  }

  if (result && typeof result.then === 'function') {
    result.then(function () {
      try { window.close(); } catch (closeErr) {}
    }).catch(function () {
      fallbackOpen();
    });
  } else {
    setTimeout(function () {
      try { window.close(); } catch (closeErr) {}
    }, 150);
  }
});

const REGISTAR_URL = 'https://comtradegroup.sharepoint.com/:x:/r/sites/40i2nujn-SecurityOperationsCentar/_layouts/15/Doc.aspx?action=edit&sourcedoc=%7Be092e8f0-52e8-4e18-a026-909343c63e92%7D&wdExp=TEAMS-TREATMENT&web=1&TeamsCID=9b69445c-b26f-49f2-b4b7-c8cfbf050bc1';
const registarBtn = $('registar-btn');
if (registarBtn) {
  registarBtn.addEventListener('click', function (e) {
    e.preventDefault();
    openInTab(REGISTAR_URL);
    setTimeout(function () { try { window.close(); } catch (x) {} }, 150);
  });
}

const dnevnikBtn = $('dnevnik-btn');
if (dnevnikBtn) {
  dnevnikBtn.addEventListener('click', function (e) {
    e.preventDefault();
    let url = 'dnevnik.html';
    try {
      if (browserAPI && browserAPI.runtime && browserAPI.runtime.getURL) {
        url = browserAPI.runtime.getURL('dnevnik.html');
      }
    } catch (err) {}
    openInTab(url);
    setTimeout(function () { try { window.close(); } catch (x) {} }, 150);
  });
}

const actUsernameInput = $('act-username');
const actTokenInput = $('act-token');
const actSubmitBtn = $('act-submit');
const actErrorEl = $('act-error');
const lockedReasonEl = $('locked-reason');
const lockedCheckBtn = $('locked-check');
const lockedDeactBtn = $('locked-deact');
const authUserEl = $('auth-user');
const authLogoutLink = $('auth-logout');
const updateBannerEl = $('update-banner');
const activationSection = $('activation-section');
const lockedSection = $('locked-section');
const activeSection = $('active-section');

const RELEASES_URL = 'https://github.com/simovicc/zabbix-soc-filter/tree/main/releases';

function isFirefoxFamily() {
  return /firefox|waterfox|librewolf/i.test(navigator.userAgent || '');
}

function openInTab(url) {
  try {
    if (browserAPI && browserAPI.tabs && browserAPI.tabs.create) {
      browserAPI.tabs.create({ url: url });
    } else {
      window.open(url, '_blank');
    }
  } catch (e) {
    try { window.open(url, '_blank'); } catch (x) {}
  }
}

function directDownloadUrl(version) {
  const base = 'https://github.com/simovicc/zabbix-soc-filter/raw/main/releases/zabbix-soc-filter-';
  return base + version + (isFirefoxFamily() ? '.xpi' : '.zip');
}

function renderUpdateBanner(latestVersion) {
  if (!updateBannerEl) return;
  while (updateBannerEl.firstChild) updateBannerEl.removeChild(updateBannerEl.firstChild);
  updateBannerEl.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'update-banner-title';
  title.textContent = 'Nova verzija ' + latestVersion + ' je dostupna.';
  updateBannerEl.appendChild(title);

  const dlUrl = directDownloadUrl(latestVersion);
  const info = document.createElement('div');
  if (isFirefoxFamily()) {
    info.appendChild(document.createTextNode('Waterfox će je sam povući u roku od 24h. Ako ne, ažuriraj ručno ('));
    const dl = document.createElement('a');
    dl.textContent = 'preuzmi direktno';
    dl.addEventListener('click', function (e) { e.preventDefault(); openInTab(dlUrl); });
    info.appendChild(dl);
    info.appendChild(document.createTextNode(').'));
  } else {
    info.appendChild(document.createTextNode('Chrome ne radi auto-update. '));
    const dl = document.createElement('a');
    dl.textContent = 'Preuzmi direktno';
    dl.addEventListener('click', function (e) { e.preventDefault(); openInTab(dlUrl); });
    info.appendChild(dl);
    info.appendChild(document.createTextNode(', raspakuj pa Refresh na chrome://extensions.'));
  }
  updateBannerEl.appendChild(info);
}

const contactEmailA = $('ct-email-a');
const contactEmailB = $('ct-email-b');
const contactLiA = $('ct-li-a');
const contactLiB = $('ct-li-b');
if (contactEmailA) contactEmailA.href = 'mailto:ssimovic@comtrade.com';
if (contactEmailB) contactEmailB.href = 'mailto:ssimovic@comtrade.com';
if (contactLiA) contactLiA.href = 'https://linkedin.com/in/simovicc';
if (contactLiB) contactLiB.href = 'https://linkedin.com/in/simovicc';

const locationBadge = $('location-badge');
const locationTextEl = $('location-text');
function setLocationBadge(label, errorState) {
  if (!locationBadge || !locationTextEl) return;
  locationBadge.classList.remove('hidden');
  locationBadge.classList.remove('location-badge--office', 'location-badge--vpn', 'location-badge--home');
  let baseText = '';
  let cls = '';
  if (label === 'office') { baseText = 'Rad iz kancelarije'; cls = 'location-badge--office'; }
  else if (label === 'home') { baseText = 'Rad od kuće'; cls = 'location-badge--home'; }
  else if (label === 'unknown' && errorState === 'all_services_failed') {
    baseText = 'Mreža/firewall blokira IP servis';
  } else { baseText = 'Provera lokacije...'; }
  locationTextEl.textContent = baseText;
  if (cls) locationBadge.classList.add(cls);
}

function showSection(name) {
  if (activationSection) activationSection.hidden = name !== 'activation';
  if (lockedSection) lockedSection.hidden = name !== 'locked';
  if (activeSection) activeSection.hidden = name !== 'active';
}

function bgSend(payload) {
  return new Promise(function (resolve) {
    if (!browserAPI || !browserAPI.runtime) { resolve(null); return; }
    let settled = false;
    const finish = function (r) {
      if (settled) return;
      settled = true;
      resolve(r || null);
    };
    setTimeout(function () { finish(null); }, 12000);
    try {
      const result = browserAPI.runtime.sendMessage(payload, finish);
      if (result && typeof result.then === 'function') {
        result.then(finish).catch(function () { finish(null); });
      }
    } catch (e) { finish(null); }
  });
}

function describeLockReason(zsf) {
  if (zsf.versionState === 'locked') {
    if (zsf.versionReason === 'below_min') {
      return 'Tvoja verzija (' + zsf.myVersion + ') je ispod minimalne podržane (' + zsf.minVersion + '). Waterfox sam povlači update; Chrome korisnici skinu novi ZIP iz repo-a.';
    }
    if (zsf.versionReason === 'update_required') {
      return 'Nova verzija (' + zsf.latestVersion + ') je dostupna više od 48h a nisi ažuriran. Ažuriraj preko about:addons ili preuzmi direktno iz repo-a (Chrome: novi ZIP).';
    }
    if (zsf.versionReason === 'grace_expired_version') {
      return 'Update server nije dostupan više od 48h. Proveri internet pa klikni "Proveri sad".';
    }
  }
  if (zsf.authReason === 'revoked') return 'Pristup je opozvan. Kontaktiraj Stefana ako misliš da je greška.';
  if (zsf.authReason === 'not_found') return 'Korisnički nalog nije pronađen.';
  if (zsf.authReason === 'mismatch') return 'Token se ne poklapa sa serverskim.';
  if (zsf.authReason === 'grace_expired_auth') return 'Auth server nije dostupan više od 24 sata. Proveri internet pa klikni "Proveri sad".';
  return 'Razlog nije poznat.';
}

async function refreshLocationNow() {
  try {
    const r = await bgSend({ type: 'zsf.refreshLocation' });
    if (r && r.ok) {
      setLocationBadge(r.locationLabel, r.locationError);
    }
  } catch (e) {}
}

async function refreshAuthAndRender() {
  const zsf = await bgSend({ type: 'zsf.getState' });
  if (!zsf) {
    setLocationBadge(null, null);
    showSection('active');
    await loadStatus();
    return;
  }
  setLocationBadge(zsf.locationLabel, zsf.locationError);
  refreshLocationNow();
  if (zsf.state === 'pending') {
    showSection('activation');
  } else if (zsf.state === 'locked') {
    showSection('locked');
    if (lockedReasonEl) lockedReasonEl.textContent = describeLockReason(zsf);
  } else {
    showSection('active');
    if (authUserEl) authUserEl.textContent = zsf.username || '-';
    if (updateBannerEl) {
      if (zsf.versionState === 'update_available' && zsf.latestVersion) {
        renderUpdateBanner(zsf.latestVersion);
      } else {
        updateBannerEl.classList.add('hidden');
      }
    }
    await loadStatus();
  }
}

const actForm = $('act-form');

async function performActivation() {
  if (actErrorEl) actErrorEl.classList.add('hidden');
  if (actSubmitBtn) actSubmitBtn.disabled = true;
  const origText = actSubmitBtn ? actSubmitBtn.textContent : '';
  if (actSubmitBtn) actSubmitBtn.textContent = 'Proveravam...';
  const u = actUsernameInput ? actUsernameInput.value : '';
  const t = actTokenInput ? actTokenInput.value : '';
  const r = await bgSend({ type: 'zsf.activate', username: u, token: t });
  if (actSubmitBtn) {
    actSubmitBtn.disabled = false;
    actSubmitBtn.textContent = origText;
  }
  if (r && r.ok) {
    if (actUsernameInput) actUsernameInput.value = '';
    if (actTokenInput) actTokenInput.value = '';
    await refreshAuthAndRender();
  } else {
    if (actErrorEl) {
      actErrorEl.textContent = (r && r.error) || 'Greška pri aktivaciji.';
      actErrorEl.classList.remove('hidden');
    }
  }
}

if (actForm) {
  actForm.addEventListener('submit', function (e) {
    e.preventDefault();
    performActivation();
  });
}

if (actUsernameInput) {
  actUsernameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && actTokenInput) {
      e.preventDefault();
      actTokenInput.focus();
    }
  });
}

let lockedCheckBusy = false;
if (lockedCheckBtn) {
  lockedCheckBtn.addEventListener('click', async function () {
    if (lockedCheckBusy) return;
    lockedCheckBusy = true;
    lockedCheckBtn.disabled = true;
    const orig = lockedCheckBtn.textContent;
    lockedCheckBtn.textContent = 'Proveravam...';
    await bgSend({ type: 'zsf.checkNow', what: 'both' });
    setTimeout(function () {
      lockedCheckBtn.disabled = false;
      lockedCheckBtn.textContent = orig;
      lockedCheckBusy = false;
      refreshAuthAndRender();
    }, 1200);
  });
}

if (lockedDeactBtn) {
  lockedDeactBtn.addEventListener('click', async function () {
    await bgSend({ type: 'zsf.deactivate' });
    await refreshAuthAndRender();
  });
}

if (authLogoutLink) {
  authLogoutLink.addEventListener('click', async function (e) {
    e.preventDefault();
    await bgSend({ type: 'zsf.deactivate' });
    await refreshAuthAndRender();
  });
}

if (browserAPI && browserAPI.storage && browserAPI.storage.onChanged) {
  browserAPI.storage.onChanged.addListener(function (changes) {
    const keys = Object.keys(changes);
    if (keys.some(function (k) { return k.indexOf('zsf.') === 0; })) {
      refreshAuthAndRender();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', refreshAuthAndRender);
} else {
  refreshAuthAndRender();
}
