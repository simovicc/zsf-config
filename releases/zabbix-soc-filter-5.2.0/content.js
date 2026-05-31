(function () {
  'use strict';

  const VERSION = '5.2.0';
  let zsfAuthState = 'pending';

  const browserAPI = (typeof browser !== 'undefined') ? browser :
                     (typeof chrome !== 'undefined') ? chrome : null;

  const WHITELIST = [
    { pattern: /nedostupan/i,        label: 'Nedostupan' },
    { pattern: /ne otvara se sajt/i, label: 'Sajt nedostupan' },
    { pattern: /link down/i,         label: 'Link Down' },
    { pattern: /unreachable/i,       label: 'Unreachable' },
    { pattern: /unavailable/i,       label: 'Unavailable' },
    { pattern: /\bdown\b/i,          label: 'down' },
    { pattern: /is red/i,            label: 'Is red' },
    { pattern: /health is red/i,     label: 'Health is red' },
    { pattern: /not available/i,     label: 'Not available' },
    { pattern: /not running/i,       label: 'Not running' },
    { pattern: /status critical/i,   label: 'Status critical' },
    { pattern: /discharging/i,       label: 'Discharging' },
    { pattern: /health red/i,        label: 'Health red' },
    { pattern: /veeam/i,             label: 'Veeam' },
    { pattern: /failed job/i,        label: 'Failed Job' }
  ];

  const WHITELIST_COMBINED = /nedostupan|ne otvara se sajt|link down|unreachable|unavailable|\bdown\b|is red|not available|not running|status critical|discharging|health red|veeam|failed job/i;

  const BLACKLIST = [
    { pattern: /High memory utilization/i,       label: 'High memory util' },
    { pattern: /High CPU utilization/i,          label: 'High CPU util' },
    { pattern: /Memory Pages\/sec is too high/i, label: 'Memory Pages/sec' },
    { pattern: /CPU queue length is too high/i,  label: 'CPU queue' },
    { pattern: /Disk is overloaded/i,            label: 'Disk overloaded' },
    { pattern: /cbdhsvc_/i,                      label: 'cbdhsvc' },
    { pattern: /Clipboard User Service/i,        label: 'Clipboard' },
    { pattern: /GoogleUpdater/i,                 label: 'Google Updater' },
    { pattern: /Google.*Update.*Service/i,       label: 'Google Update' },
    { pattern: /MicrosoftEdgeUpdate/i,           label: 'MS Edge Update' },
    { pattern: /MS Edge.*Update/i,               label: 'MS Edge Update' },
    { pattern: /CynetLauncher/i,                 label: 'CynetLauncher' },
    { pattern: /Sofastyle-test/i,                label: 'Sofastyle-test' },
    { pattern: /LargoTest_DonDon2/i,             label: 'LargoTest' },
    { pattern: /agri-gb-DRA-sonar/i,             label: 'DRA-sonar' },
    { pattern: /agri-gb-lbextip02te/i,           label: 'lbextip' },
    { pattern: /OFPS_SQL_Core.*\(B:\)/i,         label: 'OFPS B:' },
    { pattern: /health is (yellow|green|gray|grey)/i, label: 'Health non-critical' },
    { pattern: /MSSQL(?!.*unavailable)/i,        label: 'MSSQL non-unavailable' }
  ];

  const BLACKLIST_COMBINED = /High (?:memory|CPU) utilization|Memory Pages\/sec is too high|CPU queue length is too high|Disk is overloaded|cbdhsvc_|Clipboard User Service|GoogleUpdater|Google.*Update.*Service|MicrosoftEdgeUpdate|MS Edge.*Update|CynetLauncher|Sofastyle-test|LargoTest_DonDon2|agri-gb-DRA-sonar|agri-gb-lbextip02te|OFPS_SQL_Core.*\(B:\)|health is (?:yellow|green|gray|grey)|MSSQL(?!.*unavailable)/i;

  const CC_ALWAYS = 'ctsi.cyops@comtrade.com';

  const EMAILS = {
    network:     'networking@comtrade.com',
    networkAgri: 'agrieurope-networking@comtrade.com',
    dccpt:       'dccpt@comtrade.com',
    dccptAgri:   'AgriEurope-DataCenter@comtrade.com',
    devops:      'sre@comtrade.com',
    dondon:      'itsupport@dondon.rs'
  };

  const NETWORK_PATTERNS = [
    /Link Down/i,
    /Interface.*(down|up|unreachable)/i,
    /Unreachable (device|interface)/i,
    /Unavailable by ICMP/i
  ];

  const DEVOPS_HOST_PATTERNS = [
    /BCGroup/i,
    /BC[\s-]?Group/i,
    /Hotel\s*Srbija/i,
    /ne otvara se sajt/i
  ];

  const SEEN_TTL_MS = 30 * 60 * 1000;
  const SCAN_INTERVAL_MS = 7000;
  const POLL_HANDLED_MS = 5000;
  const DEBOUNCE_MS = 200;
  const NOTIFICATION_AUTO_CLOSE_MS = 8000;
  const BUTTON_RESTORE_INTERVAL_MS = 2500;

  let filterEnabled = true;
  let soundEnabled = false;
  let soundVolume = 0.3;
  let notificationsEnabled = true;
  let notificationPermission = 'default';
  let analystName = '';

  const ZSF_ANALYSTS = {
    'stefan': 'Stefan Simović',
    'matija': 'Matija Gogin',
    'glava': 'Nikola Glavonjić',
    'aleksa': 'Aleksa Petrović',
    'resa': 'Nikola Resanović',
    'gulic': 'Miloš Gulić',
    'somi': 'Miloš Niškanović',
    'dinkela': 'Nikola Dinić',
    'daca': 'Danijela Sredojević',
    'vlada': 'Vladimir Nešović',
    'luka': 'Luka Živanović',
    'milance': 'Milan Nikolić',
    'natasa': 'Nataša Ćirović'
  };

  function resolveAnalystName(username) {
    const u = (username || '').trim().toLowerCase();
    if (u && ZSF_ANALYSTS[u]) return ZSF_ANALYSTS[u];
    return u || '';
  }

  let hiddenCount = 0;
  let visibleCount = 0;
  let collapsedGapsCount = 0;

  const seenNotifySignatures = new Map();
  const notifiedSignatures = new Set();
  const notifiedAt = new Map();
  const NOTIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const NOTIFIED_CAP = 5000;
  let notifiedPersistTimer = null;
  let isFirstScan = true;
  let lastProblemRowCount = 0;
  let lastNonEmptyScanAt = 0;
  const TRANSIENT_EMPTY_GUARD_MS = 20000;

  let audioElement = null;
  let audioUrl = null;
  let userInteracted = false;
  let stateLoaded = false;
  let loggedFirstScan = false;
  let refreshSafetyTimer = null;
  let refreshClearTimer = null;

  let cachedIconUrl = null;

  function isAgriHost(host) {
    if (!host) return false;
    return /(?:^|[-_.\s])(agri|aec|agrieu)(?:[-_.\s]|$)/i.test(host);
  }

  function isDonDonInstance() {
    try {
      return window.location.hostname === '172.31.35.31';
    } catch (e) {
      return false;
    }
  }

  function classifyAlert(host, problem) {
    if (isDonDonInstance()) {
      return { team: 'dondon', email: EMAILS.dondon };
    }
    const text = (host || '') + ' ' + (problem || '');
    if (/SSL\s*Certificate/i.test(problem || '')) {
      return { team: 'devops', email: EMAILS.devops };
    }
    for (let i = 0; i < DEVOPS_HOST_PATTERNS.length; i++) {
      if (DEVOPS_HOST_PATTERNS[i].test(text)) {
        return { team: 'devops', email: EMAILS.devops };
      }
    }
    for (let i = 0; i < NETWORK_PATTERNS.length; i++) {
      if (NETWORK_PATTERNS[i].test(problem || '')) {
        const isAgri = isAgriHost(host);
        return {
          team: isAgri ? 'network-agri' : 'network',
          email: isAgri ? EMAILS.networkAgri : EMAILS.network
        };
      }
    }
    const isAgri = isAgriHost(host);
    return {
      team: isAgri ? 'dccpt-agri' : 'dccpt',
      email: isAgri ? EMAILS.dccptAgri : EMAILS.dccpt
    };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripHostFromProblem(problem, host) {
    let p = (problem || '').trim();
    const h = (host || '').trim();
    if (!h) {
      return p.replace(/^Dependent[\s:._\-]*/i, '').trim();
    }

    const lowerP = p.toLowerCase();
    const lowerH = h.toLowerCase();

    let occurrences = 0;
    let lastIdx = -1;
    let scan = lowerP.indexOf(lowerH);
    while (scan !== -1) {
      occurrences++;
      lastIdx = scan;
      scan = lowerP.indexOf(lowerH, scan + lowerH.length);
    }

    if (h.length >= 3 && occurrences >= 2) {
      const rest = p.substring(lastIdx + h.length).replace(/^[\s:._\-]+/, '').trim();
      if (rest.length > 0) p = rest;
    } else if (occurrences === 1 && lastIdx === 0 && p.length > h.length) {
      const rest = p.substring(h.length).replace(/^[\s:._\-]+/, '').trim();
      if (rest.length > 0) p = rest;
    }

    p = p.replace(/^Dependent[\s:._\-]*/i, '').trim();
    return p;
  }

  function pluralAlarm(n) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'alarama';
    if (mod10 === 1) return 'alarm';
    if (mod10 >= 2 && mod10 <= 4) return 'alarma';
    return 'alarama';
  }

  function to24h(timeStr) {
    let t = (timeStr || '').trim();
    if (!t) return t;
    const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?\s*[Mm]\.?$/);
    if (m) {
      let hh = parseInt(m[1], 10);
      const mm = m[2];
      const isPM = /p/i.test(m[3]);
      if (isPM && hh !== 12) hh += 12;
      if (!isPM && hh === 12) hh = 0;
      return (hh < 10 ? '0' : '') + hh + ':' + mm;
    }
    const hm = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (hm) {
      return hm[1].padStart(2, '0') + ':' + hm[2];
    }
    return t;
  }

  function buildEmailContent(rowInfo) {
    const time = to24h((rowInfo.time || '').trim());
    const host = (rowInfo.host || '').trim();
    const problem = stripHostFromProblem(rowInfo.problem, host);

    const plain = [
      'Poštovani,',
      '',
      'Na Zabbix platformi uočen je sledeći alert:',
      '',
      'Vreme: ' + time,
      'Host: ' + host,
      'Problem: ' + problem
    ].join('\r\n');

    const FONT = 'font-family: Aptos, "Segoe UI", Calibri, sans-serif; font-size: 12pt;';
    const html =
      '<div style="' + FONT + '">' +
        '<p style="margin:0 0 12pt 0;' + FONT + '">Poštovani,</p>' +
        '<p style="margin:0 0 12pt 0;' + FONT + '">Na Zabbix platformi uočen je sledeći alert:</p>' +
        '<p style="margin:0;' + FONT + '">Vreme: <strong>' + escapeHtml(time) + '</strong></p>' +
        '<p style="margin:0;' + FONT + '">Host: <strong>' + escapeHtml(host) + '</strong></p>' +
        '<p style="margin:0;' + FONT + '">Problem: <strong>' + escapeHtml(problem) + '</strong></p>' +
      '</div>';

    return { plain: plain, html: html };
  }

  function buildMailto(rowInfo) {
    const route = classifyAlert(rowInfo.host, rowInfo.problem);
    const host = (rowInfo.host || '').trim();
    const subject = 'Zabbix Alert - ' + host;
    const content = buildEmailContent(rowInfo);

    const params =
      'from=' + encodeURIComponent(CC_ALWAYS) +
      '&cc=' + encodeURIComponent(CC_ALWAYS) +
      '&subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(content.plain);

    return {
      url: 'mailto:' + route.email + '?' + params,
      team: route.team,
      email: route.email,
      htmlBody: content.html,
      plainBody: content.plain
    };
  }

  function buildBulkEmailContent(alerts) {
    const count = alerts.length;
    const intro = count > 1
      ? 'Na Zabbix platformi uočeni su sledeći alerti:'
      : 'Na Zabbix platformi uočen je sledeći alert:';

    const plainLines = ['Poštovani,', '', intro, ''];
    for (let i = 0; i < count; i++) {
      const a = alerts[i];
      plainLines.push('Vreme: ' + to24h((a.time || '').trim()));
      plainLines.push('Host: ' + (a.host || '').trim());
      plainLines.push('Problem: ' + stripHostFromProblem(a.problem, a.host));
      if (i < count - 1) plainLines.push('');
    }
    const plain = plainLines.join('\r\n');

    const FONT = 'font-family: Aptos, "Segoe UI", Calibri, sans-serif; font-size: 12pt;';
    let html =
      '<div style="' + FONT + '">' +
        '<p style="margin:0 0 12pt 0;' + FONT + '">Poštovani,</p>' +
        '<p style="margin:0 0 12pt 0;' + FONT + '">' + escapeHtml(intro) + '</p>';
    for (let i = 0; i < count; i++) {
      const a = alerts[i];
      html +=
        '<p style="margin:0;' + FONT + '">Vreme: <strong>' + escapeHtml(to24h((a.time || '').trim())) + '</strong></p>' +
        '<p style="margin:0;' + FONT + '">Host: <strong>' + escapeHtml((a.host || '').trim()) + '</strong></p>' +
        '<p style="margin:0;' + FONT + '">Problem: <strong>' + escapeHtml(stripHostFromProblem(a.problem, a.host)) + '</strong></p>';
      if (i < count - 1) {
        html += '<p style="margin:0;' + FONT + '">&nbsp;</p>';
      }
    }
    html += '</div>';

    return { plain: plain, html: html };
  }

  function buildBulkMailto(group) {
    const hosts = [];
    const seen = {};
    for (let i = 0; i < group.alerts.length; i++) {
      const h = (group.alerts[i].host || '').trim();
      if (h && !seen[h]) {
        seen[h] = true;
        hosts.push(h);
      }
    }
    const subject = hosts.length > 0
      ? 'Zabbix Alert - ' + hosts.join(' & ')
      : 'Zabbix Alert';
    const content = buildBulkEmailContent(group.alerts);

    const params =
      'from=' + encodeURIComponent(CC_ALWAYS) +
      '&cc=' + encodeURIComponent(CC_ALWAYS) +
      '&subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(content.plain);

    return {
      url: 'mailto:' + group.email + '?' + params,
      team: group.team,
      email: group.email,
      htmlBody: content.html,
      plainBody: content.plain
    };
  }

  function collectActiveAlertGroups() {
    const rows = findProblemRows();
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.getAttribute('data-soc-filter') !== 'notify') continue;
      if (isTimeGapRow(row)) continue;
      const info = getRowInfo(row);
      if (!info || !info.problem) continue;
      const route = classifyAlert(info.host, info.problem);
      let g = groups.get(route.email);
      if (!g) {
        g = { email: route.email, team: route.team, alerts: [] };
        groups.set(route.email, g);
      }
      const dup = g.alerts.some(function (a) { return a.signature === info.signature; });
      if (!dup) {
        g.alerts.push({
          signature: info.signature,
          eventid: getEventId(row),
          time: info.time,
          host: info.host,
          problem: info.problem,
          severityKey: info.severityKey || '',
          severityLabel: info.severity || ''
        });
      }
    }
    return Array.from(groups.values());
  }

  function markGroupNotified(group) {
    if (!group || !group.alerts) return;
    const sigs = {};
    for (let i = 0; i < group.alerts.length; i++) {
      const s = group.alerts[i].signature;
      if (s) {
        notifiedSignatures.add(s);
        recordNotified(s);
        sigs[s] = true;
      }
    }
    const rows = findProblemRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.getAttribute('data-soc-filter') !== 'notify') continue;
      const info = getRowInfo(row);
      if (!info || !sigs[info.signature]) continue;
      const btn = row.querySelector('.soc-notify-btn');
      if (btn) setButtonDone(btn, true);
      markRowNotified(row, true);
    }
  }

  function composeAndOpenGroup(group) {
    if (!group || !group.alerts || group.alerts.length === 0) return false;
    const mailData = buildBulkMailto(group);
    const cards = group.alerts.map(function (a) {
      return {
        severityKey: a.severityKey || '',
        severityLabel: a.severityLabel || '',
        time: to24h((a.time || '').trim()),
        host: (a.host || '').trim(),
        problem: stripHostFromProblem(a.problem, a.host)
      };
    });
    copyHtmlToClipboardSync(appendCardImage(mailData.htmlBody, cards));

    let opened = false;
    let anchor = null;
    try {
      anchor = document.createElement('a');
      anchor.href = mailData.url;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      opened = true;
    } catch (err) {
      try {
        window.location.href = mailData.url;
        opened = true;
      } catch (err2) {}
    } finally {
      if (anchor && anchor.parentNode) anchor.parentNode.removeChild(anchor);
    }
    if (opened) {
      markGroupNotified(group);
      for (let i = 0; i < group.alerts.length; i++) {
        const a = group.alerts[i];
        captureDutyLog({ host: a.host || '', problem: a.problem || '', time: a.time || '' }, true);
      }
      maybeRemindCall();
      if (isDonDonInstance()) {
        const donEids = [];
        for (let i = 0; i < group.alerts.length; i++) {
          const e = group.alerts[i].eventid;
          if (e && /^\d+$/.test(e)) donEids.push(e);
        }
        if (donEids.length > 0) shareReportDonDon(donEids);
      }
      const name = (analystName || '').trim();
      if (!isDonDonInstance() && name) {
        const eids = [];
        for (let i = 0; i < group.alerts.length; i++) {
          const e = group.alerts[i].eventid;
          if (e && /^\d+$/.test(e)) eids.push(e);
        }
        if (eids.length > 0) {
          sendAcknowledge(eids, teamAckMessage(group.team)).then(function (r) {
            if (r.ok) {
              showToast('Prosleđeno i acknowledged: ' + r.count + ' (' + teamLabel(group.team) + ')', false);
              setTimeout(function () { triggerZabbixApply(); }, 600);
            } else {
              showToast('Acknowledge nije uspeo: ' + r.error, true);
            }
          });
        }
      }
    }
    return opened;
  }

  function getZabbixUrl() {
    try {
      return window.location.origin + '/zabbix.php';
    } catch (e) {
      return '/zabbix.php';
    }
  }

  function collectDimEventIds() {
    const rows = findProblemRows();
    const ids = [];
    const seen = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.getAttribute('data-soc-filter') !== 'dim') continue;
      if (isTimeGapRow(row)) continue;
      const id = getEventId(row);
      if (id && /^\d+$/.test(id) && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }
    return ids;
  }

  function extractInputValue(html, name) {
    const re = new RegExp('<input[^>]*\\bname=["\\\']' + name + '["\\\'][^>]*>', 'i');
    const tag = html.match(re);
    if (!tag) return null;
    const vm = tag[0].match(/\bvalue=["']([^"']*)["']/i);
    return vm ? vm[1] : null;
  }

  function fetchAckCsrfToken(eventids) {
    const parts = [];
    for (let i = 0; i < eventids.length; i++) {
      parts.push('eventids[]=' + encodeURIComponent(eventids[i]));
    }
    return fetch(getZabbixUrl() + '?action=popup.acknowledge.edit', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: parts.join('&')
    }).then(function (resp) {
      return resp.text();
    }).then(function (text) {
      if (/no permissions to access this page|logged in as/i.test(text)) {
        return { denied: true };
      }
      let body = text;
      try {
        const json = JSON.parse(text);
        if (json && json.error) return { denied: true };
        body = json.body || json.data || text;
      } catch (e) {}
      const m = body.match(/name=["']_csrf_token["']\s+value=["']([^"']+)["']/i) ||
                body.match(/value=["']([^"']+)["']\s+name=["']_csrf_token["']/i) ||
                body.match(/["']_csrf_token["']\s*:\s*["']([a-f0-9]{16,})["']/i);
      const ackValue = extractInputValue(body, 'acknowledge_problem');
      return { token: m ? m[1] : null, ackValue: ackValue };
    }).catch(function () {
      return { token: null };
    });
  }

  function triggerZabbixApply() {
    try {
      const selectors = [
        'button[name="filter_apply"]',
        'form#zbx_filter button[name="filter_apply"]',
        'form#zbx_filter button[type="submit"]',
        '.filter-forms button[name="filter_apply"]',
        '.filter-forms button[type="submit"]',
        'form[name="zbx_filter"] button[type="submit"]'
      ];
      for (let i = 0; i < selectors.length; i++) {
        const btn = document.querySelector(selectors[i]);
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function sendAcknowledge(eventids, message) {
    if (!eventids || eventids.length === 0) {
      return Promise.resolve({ ok: false, error: 'Nema alarma za označavanje.' });
    }
    return fetchAckCsrfToken(eventids).then(function (res) {
      if (res && res.denied) {
        return { ok: false, error: 'Zabbix je odbio pristup. Sesija je možda istekla - uloguj se ponovo i probaj.' };
      }
      const token = res ? res.token : null;
      if (!token) {
        return { ok: false, error: 'Nije pronađen CSRF token. Osveži stranicu (Ctrl+Shift+R) pa probaj ponovo.' };
      }
      const ackValue = (res && res.ackValue) ? res.ackValue : '2';
      const parts = [];
      for (let i = 0; i < eventids.length; i++) {
        parts.push('eventids[]=' + encodeURIComponent(eventids[i]));
      }
      parts.push('message=' + encodeURIComponent(message));
      parts.push('scope=0');
      parts.push('acknowledge_problem=' + encodeURIComponent(ackValue));
      parts.push('_csrf_token=' + encodeURIComponent(token));

      return fetch(getZabbixUrl() + '?action=popup.acknowledge.create&output=ajax', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: parts.join('&')
      }).then(function (resp) {
        return resp.text();
      }).then(function (text) {
        if (/no permissions to access this page|logged in as/i.test(text)) {
          return { ok: false, error: 'Zabbix je odbio operaciju (access denied). Sesija je možda istekla - uloguj se ponovo i probaj.' };
        }
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        if (json && json.error) {
          const msg = (json.error.messages ? json.error.messages.join(' ') : json.error.title) || 'Zabbix greška.';
          return { ok: false, error: msg };
        }
        return { ok: true, count: eventids.length };
      });
    }).catch(function (e) {
      return { ok: false, error: String(e) };
    });
  }

  function teamAckMessage(team) {
    const name = (analystName || '').trim();
    return 'Seen by: ' + name + '\nGenerisani alarm je prosleđen relevantnom timu na rešavanje (' + teamLabel(team) + ')';
  }

  let toastTimer = null;
  function showToast(text, isError) {
    let toast = document.getElementById('soc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'soc-toast';
      toast.className = 'soc-toast';
      if (document.body) document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.toggle('soc-toast--error', !!isError);
    toast.classList.add('soc-toast--show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('soc-toast--show');
    }, 3500);
  }


  function severityStyle(key) {
    switch ((key || '').toLowerCase()) {
      case 'disaster': return { bg: '#F53D3D', fg: '#ffffff', label: 'Disaster' };
      case 'high': return { bg: '#FF6A3D', fg: '#ffffff', label: 'High' };
      case 'average': return { bg: '#FF9F3D', fg: '#1a1207', label: 'Average' };
      case 'warning': return { bg: '#FFC42E', fg: '#1a1207', label: 'Warning' };
      case 'information': return { bg: '#4D8AFF', fg: '#ffffff', label: 'Information' };
      case 'notclassified': case 'na': return { bg: '#A2B3BD', fg: '#10181d', label: 'Not classified' };
      default: return { bg: '#A2B3BD', fg: '#10181d', label: 'Info' };
    }
  }

  function renderAlertCardsPng(alerts) {
    try {
      if (!alerts || alerts.length === 0) return null;
      if (typeof document.createElement('canvas').getContext !== 'function') return null;

      const W = 620;
      const HOST_W = 152;
      const PADX = 11;
      const VPAD = 9;
      const LINE = 16;
      const FONT = '12px "Segoe UI", Tahoma, Arial, sans-serif';
      const HOST_BG = '#191b1f';
      const HOST_FG = '#e3e5e9';

      const hostTextW = HOST_W - PADX * 2;
      const probTextW = W - HOST_W - PADX * 2;

      const meas = document.createElement('canvas').getContext('2d');
      meas.font = FONT;

      function wrapText(text, maxW) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (words.length === 0) return [''];
        const lines = [];
        let cur = '';
        for (let i = 0; i < words.length; i++) {
          const t = cur ? cur + ' ' + words[i] : words[i];
          if (meas.measureText(t).width <= maxW || !cur) {
            cur = t;
          } else {
            lines.push(cur); cur = words[i];
          }
        }
        if (cur) lines.push(cur);
        return lines;
      }

      const rows = [];
      let totalH = 0;
      for (let i = 0; i < alerts.length; i++) {
        const a = alerts[i];
        const hostLines = wrapText(a.host || '', hostTextW);
        const probLines = wrapText(a.problem || '', probTextW);
        const n = Math.max(hostLines.length, probLines.length, 1);
        const h = VPAD * 2 + n * LINE;
        rows.push({ a: a, hostLines: hostLines, probLines: probLines, h: h });
        totalH += h;
      }

      const SCALE = 2;
      const canvas = document.createElement('canvas');
      canvas.width = W * SCALE;
      canvas.height = totalH * SCALE;
      const ctx = canvas.getContext('2d');
      ctx.scale(SCALE, SCALE);
      ctx.textBaseline = 'top';
      ctx.font = FONT;

      let y = 0;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const st = severityStyle(row.a.severityKey);

        ctx.fillStyle = HOST_BG;
        ctx.fillRect(0, y, HOST_W, row.h);

        ctx.fillStyle = st.bg;
        ctx.fillRect(HOST_W, y, W - HOST_W, row.h);

        ctx.fillStyle = HOST_FG;
        const hY = y + (row.h - row.hostLines.length * LINE) / 2;
        for (let i = 0; i < row.hostLines.length; i++) {
          ctx.fillText(row.hostLines[i], PADX, hY + i * LINE);
        }

        ctx.fillStyle = st.fg;
        const pY = y + (row.h - row.probLines.length * LINE) / 2;
        for (let i = 0; i < row.probLines.length; i++) {
          ctx.fillText(row.probLines[i], HOST_W + PADX, pY + i * LINE);
        }

        if (r < rows.length - 1) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y + row.h - 0.5);
          ctx.lineTo(W, y + row.h - 0.5);
          ctx.stroke();
        }

        y += row.h;
      }

      return { url: canvas.toDataURL('image/png'), w: Math.round(W * SCALE * 0.6) };
    } catch (e) {
      return null;
    }
  }

  function alertFromInfo(info) {
    return {
      severityKey: info.severityKey || '',
      severityLabel: info.severity || '',
      host: (info.host || '').trim(),
      problem: stripHostFromProblem(info.problem, info.host)
    };
  }

  function appendCardImage(html, alerts) {
    const img = renderAlertCardsPng(alerts);
    if (!img || !img.url) return html;
    return html + '<div style="margin-top:14pt;"><img src="' + img.url + '" width="' + img.w +
      '" style="display:block;border:0;width:' + img.w + 'px;height:auto;" /></div>';
  }

  function copyHtmlToClipboardSync(html) {
    let tmp = null;
    const sel = window.getSelection();
    const savedRanges = [];
    if (sel) {
      for (let i = 0; i < sel.rangeCount; i++) {
        savedRanges.push(sel.getRangeAt(i).cloneRange());
      }
    }
    try {
      tmp = document.createElement('div');
      tmp.contentEditable = 'true';
      tmp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      tmp.innerHTML = html;
      document.body.appendChild(tmp);
      const range = document.createRange();
      range.selectNodeContents(tmp);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const ok = document.execCommand('copy');
      if (sel) sel.removeAllRanges();
      return ok;
    } catch (e) {
      return false;
    } finally {
      if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
      if (sel && savedRanges.length > 0) {
        try {
          sel.removeAllRanges();
          for (let i = 0; i < savedRanges.length; i++) {
            sel.addRange(savedRanges[i]);
          }
        } catch (restoreErr) {}
      }
    }
  }

  function checkDiskSpace(text) {
    const isDiskAlert = /Disk space.*(low|critical)/i.test(text) ||
                        /Space used/i.test(text);
    if (!isDiskAlert) return null;

    const usedMatch = text.match(/used\s*[>≥]\s*(\d+(?:\.\d+)?)\s*%/i);
    if (usedMatch) {
      const pct = parseFloat(usedMatch[1]);
      return { isDisk: true, percentage: pct, show: pct >= 95 };
    }
    const spaceUsedMatch = text.match(/Space used[:\s]+(\d+(?:\.\d+)?)\s*%/i);
    if (spaceUsedMatch) {
      const pct = parseFloat(spaceUsedMatch[1]);
      return { isDisk: true, percentage: pct, show: pct >= 95 };
    }
    const genericPctMatch = text.match(/>\s*(\d+(?:\.\d+)?)\s*%/);
    if (genericPctMatch) {
      const pct = parseFloat(genericPctMatch[1]);
      return { isDisk: true, percentage: pct, show: pct >= 95 };
    }
    return { isDisk: true, percentage: null, show: true };
  }

  function checkSslExpiry(text) {
    if (!/SSL\s*Certificate/i.test(text) || !/expir/i.test(text)) return null;
    if (/\bexpired\b/i.test(text)) {
      return { isSsl: true, days: 0, show: true };
    }
    const m = text.match(/expir\w*\s+in\s+(\d+)\s*day/i);
    if (m) {
      const days = parseInt(m[1], 10);
      return { isSsl: true, days: days, show: days <= 10 };
    }
    return { isSsl: true, days: null, show: true };
  }

  function evaluateUncached(problemText, hostText) {
    if (!problemText || problemText.length < 3) {
      return { show: false, reason: 'empty' };
    }
    const trimmedProblem = problemText.trim();
    if (trimmedProblem.length <= 40 && /\(\s*\d+\s*\)\s*$/.test(trimmedProblem)) {
      return { show: false, reason: 'subevent' };
    }
    const blacklistText = ((hostText || '') + ' ' + problemText).trim();
    if (BLACKLIST_COMBINED.test(blacklistText)) {
      for (let i = 0; i < BLACKLIST.length; i++) {
        const item = BLACKLIST[i];
        if (item.pattern.test(blacklistText)) {
          return { show: false, reason: 'blacklist:' + item.label };
        }
      }
    }
    const diskCheck = checkDiskSpace(problemText);
    if (diskCheck !== null && diskCheck.isDisk) {
      if (diskCheck.show) {
        const pct = diskCheck.percentage != null ? ' ' + diskCheck.percentage + '%' : '';
        return { show: true, reason: 'whitelist:Disk critical' + pct };
      }
      return {
        show: false,
        reason: 'blacklist:Disk <95% (' + diskCheck.percentage + '%)'
      };
    }
    const sslCheck = checkSslExpiry(problemText);
    if (sslCheck !== null && sslCheck.isSsl) {
      if (sslCheck.show) {
        return { show: true, reason: 'whitelist:SSL expiry' + (sslCheck.days != null ? ' ' + sslCheck.days + 'd' : '') };
      }
      return { show: false, reason: 'no-match:SSL ' + sslCheck.days + 'd (>10)' };
    }
    if (WHITELIST_COMBINED.test(problemText)) {
      for (let i = 0; i < WHITELIST.length; i++) {
        const item = WHITELIST[i];
        if (item.pattern.test(problemText)) {
          return { show: true, reason: 'whitelist:' + item.label };
        }
      }
    }
    return { show: false, reason: 'no-match' };
  }

  const evalCache = new Map();
  function evaluate(problemText, hostText) {
    const key = (hostText || '') + '\u0000' + (problemText || '');
    const cached = evalCache.get(key);
    if (cached !== undefined) return cached;
    const result = evaluateUncached(problemText, hostText);
    if (evalCache.size > 2000) evalCache.clear();
    evalCache.set(key, result);
    return result;
  }

  function pruneSeenSignatures() {
    const now = Date.now();
    for (const entry of seenNotifySignatures.entries()) {
      if (now - entry[1] > SEEN_TTL_MS) {
        seenNotifySignatures.delete(entry[0]);
      }
    }
  }

  function getRuntimeUrl(path) {
    if (!browserAPI || !browserAPI.runtime || !browserAPI.runtime.getURL) return null;
    try {
      return browserAPI.runtime.getURL(path);
    } catch (e) {
      return null;
    }
  }

  function getIconUrl() {
    if (cachedIconUrl !== null) return cachedIconUrl;
    cachedIconUrl = getRuntimeUrl('icons/icon128.png') || '';
    return cachedIconUrl;
  }

  function initAudio() {
    if (audioElement) return audioElement;
    if (!audioUrl) audioUrl = getRuntimeUrl('notify.mp3');
    if (!audioUrl) return null;
    try {
      audioElement = new Audio(audioUrl);
      audioElement.volume = soundVolume;
      audioElement.preload = 'auto';
    } catch (e) {
      audioElement = null;
    }
    return audioElement;
  }

  function playNotifySound() {
    if (!soundEnabled) return;
    if (!userInteracted) {
      console.warn('[SOC Filter] Audio blokiran: još nema korisničke interakcije sa stranicom');
      return;
    }
    const audio = initAudio();
    if (!audio) {
      console.warn('[SOC Filter] Audio nije inicijalizovan');
      return;
    }
    try {
      audio.volume = soundVolume;
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function (err) {
          console.warn('[SOC Filter] Audio play odbijen:', err && err.name);
          if (err && err.name === 'NotAllowedError') {
            userInteracted = false;
            document.addEventListener('click', markUserInteraction, { capture: true, passive: true });
            document.addEventListener('keydown', markUserInteraction, { capture: true, passive: true });
            document.addEventListener('pointerdown', markUserInteraction, { capture: true, passive: true });
            document.addEventListener('touchstart', markUserInteraction, { capture: true, passive: true });
          }
        });
      }
    } catch (e) {
      console.warn('[SOC Filter] Audio play exception:', e);
    }
  }

  function markUserInteraction() {
    if (userInteracted) return;
    userInteracted = true;
    if (soundEnabled) initAudio();
    document.removeEventListener('click', markUserInteraction, true);
    document.removeEventListener('keydown', markUserInteraction, true);
    document.removeEventListener('pointerdown', markUserInteraction, true);
    document.removeEventListener('touchstart', markUserInteraction, true);
  }

  document.addEventListener('click', markUserInteraction, { capture: true, passive: true });
  document.addEventListener('keydown', markUserInteraction, { capture: true, passive: true });
  document.addEventListener('pointerdown', markUserInteraction, { capture: true, passive: true });
  document.addEventListener('touchstart', markUserInteraction, { capture: true, passive: true });

  function checkNotificationPermission() {
    if (typeof Notification !== 'undefined') {
      notificationPermission = Notification.permission;
      return;
    }
    if (browserAPI && browserAPI.notifications && typeof browserAPI.notifications.create === 'function') {
      notificationPermission = 'granted';
      return;
    }
    notificationPermission = 'unsupported';
  }

  function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      if (browserAPI && browserAPI.notifications && typeof browserAPI.notifications.create === 'function') {
        notificationPermission = 'granted';
        return Promise.resolve('granted');
      }
      return Promise.resolve('unsupported');
    }
    if (Notification.permission === 'granted') {
      notificationPermission = 'granted';
      return Promise.resolve('granted');
    }
    if (Notification.permission === 'denied') {
      notificationPermission = 'denied';
      return Promise.resolve('denied');
    }
    try {
      const result = Notification.requestPermission();
      if (result && typeof result.then === 'function') {
        return result.then(function (perm) {
          notificationPermission = perm;
          return perm;
        });
      }
      notificationPermission = result;
      return Promise.resolve(result);
    } catch (e) {
      return Promise.resolve('error');
    }
  }

  function showBrowserNotification(rowInfo) {
    if (!notificationsEnabled) return;

    const iconUrl = getIconUrl() || undefined;
    const title = 'Uočen: ' + (rowInfo.host || 'alert');
    const body = (rowInfo.problem || '').trim() || 'Novi alarm';

    let usedExtAPI = false;

    if (browserAPI && browserAPI.notifications && typeof browserAPI.notifications.create === 'function') {
      try {
        const notifId = 'zabbix-soc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const opts = {
          type: 'basic',
          iconUrl: iconUrl,
          title: title,
          message: body
        };
        browserAPI.notifications.create(notifId, opts, function (createdId) {
          if (browserAPI.runtime && browserAPI.runtime.lastError) {
            console.warn('[SOC Filter] Ext notification greška:', browserAPI.runtime.lastError.message);
            tryWebNotification(title, body, iconUrl, rowInfo.signature);
          } else if (!createdId) {
            console.warn('[SOC Filter] Ext notification nije kreirana, fallback');
            tryWebNotification(title, body, iconUrl, rowInfo.signature);
          }
        });
        setTimeout(function () {
          try { browserAPI.notifications.clear(notifId); } catch (e) {}
        }, NOTIFICATION_AUTO_CLOSE_MS);
        usedExtAPI = true;
      } catch (e) {
        console.warn('[SOC Filter] Ext notification exception:', e);
      }
    }

    if (!usedExtAPI) {
      tryWebNotification(title, body, iconUrl, rowInfo.signature);
    }
  }

  function tryWebNotification(title, body, iconUrl, signature) {
    if (typeof Notification === 'undefined') {
      console.warn('[SOC Filter] Notification API nije dostupan');
      return;
    }
    if (Notification.permission !== 'granted') {
      console.warn('[SOC Filter] Notification permission:', Notification.permission);
      return;
    }
    try {
      const n = new Notification(title, {
        body: body,
        icon: iconUrl,
        tag: 'zabbix-soc-' + (signature || ''),
        requireInteraction: false,
        silent: true
      });
      n.onclick = function () {
        try { window.focus(); } catch (e) {}
        try { n.close(); } catch (e) {}
      };
      setTimeout(function () { try { n.close(); } catch (e) {} }, NOTIFICATION_AUTO_CLOSE_MS);
    } catch (e) {
      console.warn('[SOC Filter] Web notification exception:', e);
    }
  }

  function findProblemCell(row) {
    const resolved = resolveProblemCells(row);
    if (resolved && resolved.problemCell) return resolved.problemCell;

    const contentCells = (resolved && resolved.contentCells) ? resolved.contentCells : [];
    if (contentCells.length === 0) return null;
    if (contentCells[3]) return contentCells[3];
    if (contentCells[1]) return contentCells[1];
    return contentCells[contentCells.length - 1];
  }

  function ensureCellPositioned(cell) {
    if (!cell) return;
    if (cell.style.position === 'relative') return;
    if (getComputedStyle(cell).position === 'static') {
      cell.style.position = 'relative';
    }
  }

  function setButtonDone(btn, done) {
    if (!btn) return;
    if (done) {
      btn.classList.add('soc-notify-btn--done');
      btn.textContent = '';
    } else {
      btn.classList.remove('soc-notify-btn--done');
      btn.textContent = 'Obavesti klijenta';
    }
    try {
      const cell = btn.parentNode;
      const evi = (cell && cell.querySelector) ? cell.querySelector('.soc-evi-btn') : null;
      if (evi && btn.offsetWidth) evi.style.right = (btn.offsetWidth + 18) + 'px';
    } catch (e) {}
  }

  function markRowNotified(row, done) {
    if (!row) return;
    if (done) {
      row.setAttribute('data-soc-notified', '1');
    } else if (row.hasAttribute('data-soc-notified')) {
      row.removeAttribute('data-soc-notified');
    }
  }

  function ensureNotifyButton(row, info) {
    if (!row || !info) return;

    autoCaptureRow(info);

    if (!filterEnabled) {
      removeNotifyButton(row);
      return;
    }

    if (info.acked && info.signature && info.signature.indexOf('eid:') === 0 && !notifiedSignatures.has(info.signature)) {
      notifiedSignatures.add(info.signature);
      recordNotified(info.signature);
    }

    const targetCell = findProblemCell(row);
    if (!targetCell) return;

    const existing = row.querySelector('.soc-notify-btn');

    if (existing && existing.parentNode === targetCell) {
      existing._rowInfo = info;
      if (existing.dataset.signature !== info.signature) {
        existing.dataset.signature = info.signature;
        const mailData = buildMailto(info);
        existing.dataset.mailtoUrl = mailData.url;
        existing.title = 'Pošalji ' + mailData.team.toUpperCase() + ' (' + mailData.email + ')';
      }
      setButtonDone(existing, notifiedSignatures.has(info.signature));
      markRowNotified(row, notifiedSignatures.has(info.signature));
      ensureCellPositioned(targetCell);
      targetCell.classList.add('soc-has-btn');
      return;
    }

    if (existing && existing.parentNode !== targetCell) {
      existing.remove();
    }

    ensureCellPositioned(targetCell);

    const mailData = buildMailto(info);

    const btn = document.createElement('button');
    btn.className = 'soc-notify-btn';
    btn.type = 'button';
    btn.textContent = 'Obavesti klijenta';
    btn.dataset.signature = info.signature;
    btn.dataset.mailtoUrl = mailData.url;
    btn.title = 'Pošalji ' + mailData.team.toUpperCase() + ' (' + mailData.email + ')';
    btn._rowInfo = info;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const url = btn.dataset.mailtoUrl;
      if (!url) return;

      const currentInfo = btn._rowInfo;

      if (currentInfo) {
        const content = buildEmailContent(currentInfo);
        const html = appendCardImage(content.html, [alertFromInfo(currentInfo)]);
        copyHtmlToClipboardSync(html);
      }

      let opened = false;
      let anchor = null;
      try {
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        opened = true;
      } catch (err) {
        try {
          window.location.href = url;
          opened = true;
        } catch (err2) {}
      } finally {
        if (anchor && anchor.parentNode) {
          anchor.parentNode.removeChild(anchor);
        }
      }

      if (opened) {
        const sig = btn.dataset.signature;
        if (sig) { notifiedSignatures.add(sig); recordNotified(sig); }
        setButtonDone(btn, true);
        markRowNotified(row, true);

        if (currentInfo) captureDutyLog(currentInfo, true);
        maybeRemindCall();

        const eidDon = getEventId(row);
        if (isDonDonInstance() && eidDon && /^\d+$/.test(eidDon)) {
          shareReportDonDon([eidDon]);
        }

        const name = (analystName || '').trim();
        const eid = getEventId(row);
        if (!isDonDonInstance() && name && eid && /^\d+$/.test(eid) && currentInfo) {
          const route = classifyAlert(currentInfo.host, currentInfo.problem);
          sendAcknowledge([eid], teamAckMessage(route.team)).then(function (r) {
            if (!r.ok) {
              showToast('Acknowledge nije uspeo: ' + r.error, true);
            } else {
              setTimeout(function () { triggerZabbixApply(); }, 600);
            }
          });
        }
      }
    });

    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    setButtonDone(btn, notifiedSignatures.has(info.signature));
    markRowNotified(row, notifiedSignatures.has(info.signature));

    targetCell.appendChild(btn);

    targetCell.classList.add('soc-has-btn');
  }

  function removeNotifyButton(row) {
    if (!row) return;
    const evi = row.querySelector('.soc-evi-btn');
    if (evi) evi.remove();
    const btn = row.querySelector('.soc-notify-btn');
    if (btn) {
      const cell = btn.parentNode;
      btn.remove();
      if (cell && cell.classList) cell.classList.remove('soc-has-btn');
    }
  }

  function getCellText(cell) {
    if (!cell) return '';
    const clone = cell.cloneNode(true);
    const buttons = clone.querySelectorAll('.soc-notify-btn');
    for (let i = 0; i < buttons.length; i++) buttons[i].remove();
    const acks = clone.querySelectorAll('.action-icon, .icon-action-msgs, .icon-action-ack');
    for (let i = 0; i < acks.length; i++) acks[i].remove();
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isTimelineCell(cell) {
    if (!cell) return false;
    if (cell.classList) {
      const cls = cell.classList;
      if (cls.contains('timeline-axis') ||
          cls.contains('timeline-td') ||
          cls.contains('timeline-dot') ||
          cls.contains('timeline-date')) {
        return true;
      }
    }
    const className = cell.className || '';
    if (typeof className === 'string' && /\btimeline-/i.test(className)) return true;
    if (cell.querySelector && cell.querySelector('.timeline-axis, .timeline-dot')) return true;
    return false;
  }

  function isExpandCell(cell) {
    if (!cell) return false;
    const className = (typeof cell.className === 'string') ? cell.className : '';
    return /expand/i.test(className);
  }

  function isSeverityCell(cell) {
    if (!cell) return false;
    const className = (typeof cell.className === 'string') ? cell.className : '';
    return /\b(disaster|high|average|warning|information|not[-_]?classified|na)-bg\b/i.test(className);
  }

  function isRowAcked(row) {
    try {
      const cells = row.querySelectorAll('td');
      for (let i = 0; i < cells.length; i++) {
        if ((cells[i].textContent || '').trim() === 'Yes') return true;
      }
    } catch (e) {}
    return false;
  }

  function getSeverityInfo(row) {
    try {
      const cells = row.querySelectorAll('td');
      for (let i = 0; i < cells.length; i++) {
        if (!isSeverityCell(cells[i])) continue;
        const cls = (typeof cells[i].className === 'string') ? cells[i].className : '';
        const m = cls.match(/\b(disaster|high|average|warning|information|not[-_]?classified|na)-bg\b/i);
        const key = m ? m[1].toLowerCase().replace(/[-_]/g, '') : '';
        const label = (getCellText(cells[i]) || '').trim();
        return { key: key, label: label };
      }
    } catch (e) {}
    return { key: '', label: '' };
  }

  const tableIndexCache = new WeakMap();
  const headerColsCache = new WeakMap();

  function getTableOf(row) {
    let table = row;
    while (table && table.tagName !== 'TABLE') table = table.parentElement;
    return table || null;
  }

  function getHeaderColumns(row) {
    const table = getTableOf(row);
    if (!table) return null;

    const cached = headerColsCache.get(table);
    if (cached !== undefined) return cached;

    const headerCells = table.querySelectorAll('thead th, thead td');
    if (headerCells.length === 0) {
      headerColsCache.set(table, null);
      return null;
    }

    const cols = [];
    for (let i = 0; i < headerCells.length; i++) {
      cols.push((headerCells[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
    }
    headerColsCache.set(table, cols);
    return cols;
  }

  function getColumnIndexes(row) {
    const table = getTableOf(row);
    if (!table) return null;

    const cached = tableIndexCache.get(table);
    if (cached) return cached;

    const headerCells = table.querySelectorAll('thead th, thead td');
    if (headerCells.length === 0) {
      tableIndexCache.set(table, null);
      return null;
    }

    const idx = { time: -1, host: -1, problem: -1 };
    for (let i = 0; i < headerCells.length; i++) {
      const h = (headerCells[i].textContent || '').trim().toLowerCase();
      if (idx.time === -1 && /\btime\b/.test(h)) idx.time = i;
      if (idx.host === -1 && /\bhost\b/.test(h)) idx.host = i;
      if (idx.problem === -1 && /\bproblem\b/.test(h)) idx.problem = i;
    }
    tableIndexCache.set(table, idx);
    return idx;
  }

  function normalizeTime(raw) {
    if (!raw) return '';
    const m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]?\.?)?/);
    if (m) {
      const hh = m[1].padStart(2, '0');
      const mm = m[2];
      const ss = m[3] ? ':' + m[3] : '';
      const ap = m[4] ? ' ' + m[4].toUpperCase() + 'M' : '';
      return hh + ':' + mm + ss + ap;
    }
    return raw.trim();
  }

  function cleanProblemText(raw) {
    if (!raw) return '';
    return raw.replace(/\s{2,}/g, ' ').trim();
  }

  function cleanHostText(raw) {
    if (!raw) return '';
    let h = raw.replace(/\s{2,}/g, ' ').trim();
    h = h.replace(/\s*[-–—]\s*(CRITICAL|DISASTER|HIGH|AVERAGE|MEDIUM|WARNING|LOW|INFORMATIVE|INFORMATION|INFO|NOT[\s_-]?CLASSIFIED|N\/A)\s*$/i, '').trim();
    return h;
  }

  function getEventId(row) {
    if (!row || !row.querySelector) return null;

    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) {
      const val = cb.value || '';
      if (/^\d{6,}$/.test(val)) return val;
      const nm = cb.getAttribute('name') || '';
      const m = nm.match(/(\d{6,})/);
      if (m) return m[1];
    }

    if (row.getAttribute && row.getAttribute('data-eventid')) {
      return row.getAttribute('data-eventid');
    }
    const dataEl = row.querySelector('[data-eventid]');
    if (dataEl) {
      const id = dataEl.getAttribute('data-eventid');
      if (id) return id;
    }

    const link = row.querySelector('a[href*="eventid"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/eventid[=:](\d{4,})/i);
      if (m) return m[1];
    }

    return null;
  }

  function resolveProblemCells(row) {
    const allCells = row.querySelectorAll('td');
    if (allCells.length < 2) return null;

    const dateCell = row.querySelector('td.timeline-date');

    const contentCells = [];
    for (let i = 0; i < allCells.length; i++) {
      const c = allCells[i];
      if (isTimelineCell(c) || isExpandCell(c)) continue;
      contentCells.push(c);
    }

    const result = { contentCells: contentCells, hostCell: null, problemCell: null, timeCell: dateCell || null };
    if (contentCells.length < 2) return result;

    const cols = getHeaderColumns(row);
    if (!cols || cols.length === 0) return result;

    const findCol = function (needle) {
      for (let i = 0; i < cols.length; i++) {
        if (cols[i].indexOf(needle) !== -1) return i;
      }
      return -1;
    };
    const hSev = findCol('severity');
    const hHost = findCol('host');
    const hProb = findCol('problem');
    const hTime = findCol('time');

    let sContent = -1;
    for (let i = 0; i < contentCells.length; i++) {
      if (isSeverityCell(contentCells[i])) { sContent = i; break; }
    }

    if (sContent !== -1 && hSev !== -1) {
      const offset = hSev - sContent;
      if (hHost !== -1) result.hostCell = contentCells[hHost - offset] || null;
      if (hProb !== -1) result.problemCell = contentCells[hProb - offset] || null;
      if (!result.timeCell && hTime !== -1) result.timeCell = contentCells[hTime - offset] || null;
    }

    if (!result.hostCell || !result.problemCell) {
      const mapCols = cols.slice();
      if (dateCell && hTime !== -1) mapCols.splice(hTime, 1);
      const f2 = function (needle) {
        for (let i = 0; i < mapCols.length; i++) {
          if (mapCols[i].indexOf(needle) !== -1) return i;
        }
        return -1;
      };
      const hi = f2('host');
      const pi = f2('problem');
      if (!result.hostCell && hi !== -1) result.hostCell = contentCells[hi] || null;
      if (!result.problemCell && pi !== -1) result.problemCell = contentCells[pi] || null;
    }

    return result;
  }

  function getRowInfo(row) {
    if (!row || !row.querySelectorAll) return null;
    if (row.querySelector('th') && !row.querySelector('td')) return null;

    const allCells = row.querySelectorAll('td');
    if (allCells.length < 2) return null;

    const cellTexts = new Map();
    function textFor(cell) {
      if (!cell) return '';
      let t = cellTexts.get(cell);
      if (t === undefined) {
        t = getCellText(cell);
        cellTexts.set(cell, t);
      }
      return t;
    }

    let timeRaw = '';
    let hostText = '';
    let problemText = '';

    const resolved = resolveProblemCells(row);
    const contentCells = (resolved && resolved.contentCells) ? resolved.contentCells : [];

    if (resolved) {
      if (resolved.timeCell) timeRaw = textFor(resolved.timeCell);
      if (resolved.hostCell) hostText = textFor(resolved.hostCell);
      if (resolved.problemCell) problemText = textFor(resolved.problemCell);
    }

    if (!timeRaw) {
      for (let i = 0; i < contentCells.length; i++) {
        const t = textFor(contentCells[i]);
        if (/\d{1,2}:\d{2}/.test(t)) { timeRaw = t; break; }
      }
    }

    if (!hostText || !problemText) {
      const candidates = [];
      for (let i = 0; i < contentCells.length; i++) {
        if (isSeverityCell(contentCells[i])) continue;
        const t = textFor(contentCells[i]);
        if (!t) continue;
        if (t === timeRaw) continue;
        if (/^\d{1,2}:\d{2}/.test(t)) continue;
        if (/^(Update|Disaster|High|Average|Warning|Information|Not classified)$/i.test(t)) continue;
        candidates.push(t);
      }
      if (!hostText && candidates.length > 0) hostText = candidates[0];
      if (!problemText && candidates.length > 1) {
        problemText = candidates.find(function (c) { return c !== hostText && c.length > 5; }) || '';
      }
    }

    hostText = cleanHostText(hostText);
    problemText = cleanProblemText(problemText);

    const time = normalizeTime(timeRaw);

    if (!time && !hostText && !problemText) return null;

    const eventId = getEventId(row);
    const sig = eventId
      ? 'eid:' + eventId
      : (timeRaw || '') + '|' + hostText + '|' + problemText.substring(0, 100);
    const sev = getSeverityInfo(row);
    return {
      signature: sig,
      eventId: eventId,
      time: time,
      timeRaw: timeRaw,
      host: hostText,
      problem: problemText,
      severityKey: sev.key,
      severity: sev.label,
      acked: isRowAcked(row),
      fullText: (row.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 200)
    };
  }

  const ZSF_WORK_START = 8 * 60;
  const ZSF_WORK_END = 17 * 60;
  const ZSF_WORKHOURS_NOTE = 'Incident se desio u periodu od 08:00 - 17:00 - nije potrebno obavestiti dežurnog';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function nowHM(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function todayDMY(d) {
    d = d || new Date();
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function hmToMin(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function computeOdziv(alarmHM, mailHM) {
    const a = hmToMin(alarmHM);
    const b = hmToMin(mailHM);
    if (a === null || b === null) return '';
    let diff = b - a;
    if (diff < 0) diff += 24 * 60;
    if (diff > 12 * 60) return '';
    return Math.floor(diff / 60) + ':' + pad2(diff % 60);
  }

  let autoCaptureEnabled = true;
  const autoCapturedKeys = new Set();

  function autoCaptureRow(info) {
    if (!autoCaptureEnabled || !info) return;
    if (!isCtInstance()) return;
    const key = (info.host || '') + '|' + (info.problem || '') + '|' + todayDMY();
    if (autoCapturedKeys.has(key)) return;
    autoCapturedKeys.add(key);
    captureDutyLog(info);
  }

  function captureDutyLog(info, reported) {
    if (!info) return;
    if (!isCtInstance()) return;
    if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const inWorkHours = mins >= ZSF_WORK_START && mins < ZSF_WORK_END;
    const mailHM = nowHM(now);
    const datum = todayDMY(now);
    const host = info.host || '';
    const problem = info.problem || '';
    const vremeAlarm = info.time || '';

    try {
      const getp = browserAPI.storage.local.get(['zsf.dutyLog']);
      Promise.resolve(getp).then(function (res) {
        let log = (res && Array.isArray(res['zsf.dutyLog'])) ? res['zsf.dutyLog'] : [];
        let existing = null;
        for (let i = 0; i < log.length; i++) {
          const e = log[i];
          if (e.host === host && e.problem === problem && e.datum === datum) {
            existing = e; break;
          }
        }
        let changed = false;

        if (existing) {
          if (reported) {
            if (!existing.vremeMail) { existing.vremeMail = mailHM; changed = true; }
            if (!existing.odziv) { existing.odziv = computeOdziv(vremeAlarm, existing.vremeMail || mailHM); changed = true; }
            if (!existing.workHours && !existing.vremePoziva) { existing.vremePoziva = mailHM; changed = true; }
            if (!existing.analiticar && analystName) { existing.analiticar = analystName.trim(); changed = true; }
            if (!existing.reported) { existing.reported = true; changed = true; }
          }
        } else {
          const entry = {
            host: host,
            problem: problem,
            datum: datum,
            vremeAlarm: vremeAlarm,
            vremeMail: reported ? mailHM : '',
            odziv: reported ? computeOdziv(vremeAlarm, mailHM) : '',
            koObavesten: inWorkHours ? ZSF_WORKHOURS_NOTE : '',
            vremePoziva: (reported && !inWorkHours) ? mailHM : '',
            analiticar: (analystName || '').trim(),
            workHours: inWorkHours,
            reported: !!reported,
            ts: now.getTime()
          };
          log.push(entry);
          if (log.length > 400) log = log.slice(log.length - 400);
          changed = true;
        }

        if (changed) {
          const setp = browserAPI.storage.local.set({ 'zsf.dutyLog': log });
          if (setp && typeof setp.catch === 'function') setp.catch(function () {});
        }
      }).catch(function () {});
    } catch (e) {}
  }

  function isCtInstance() {
    try { return window.location.hostname === 'monitor.comtradecloud.com'; } catch (e) { return false; }
  }

  function isAfterHoursNow() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins < ZSF_WORK_START || mins >= ZSF_WORK_END;
  }

  function oncallDayKeyNow() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (mins < ZSF_WORK_START) d.setDate(d.getDate() - 1);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function normName(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function lookupContactPhone(contacts, name) {
    if (!contacts || !name) return '';
    if (contacts[name] && contacts[name].phone) return contacts[name].phone;
    const target = normName(name);
    for (const k in contacts) {
      if (normName(k) === target) return contacts[k].phone || '';
    }
    const surname = target.split(' ').slice(-1)[0];
    if (surname && surname.length > 2) {
      for (const k in contacts) {
        if (normName(k).split(' ').indexOf(surname) !== -1) return contacts[k].phone || '';
      }
    }
    return '';
  }

  function renderCallReminder(key, lines) {
    const old = document.getElementById('soc-call-reminder');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'soc-call-reminder';
    box.className = 'soc-call-reminder';

    const title = document.createElement('div');
    title.className = 'soc-cr-title';
    title.textContent = 'Vanradno vreme - potrebno je pozvati dežurnog';
    box.appendChild(title);

    if (lines && lines.length) {
      lines.forEach(function (l) {
        const row = document.createElement('div');
        row.className = 'soc-cr-row';
        const nm = document.createElement('span');
        nm.className = 'soc-cr-name';
        nm.textContent = l.label + ': ' + l.name;
        row.appendChild(nm);
        const ph = document.createElement('span');
        ph.className = 'soc-cr-phone';
        ph.textContent = l.phone ? l.phone : '(broj nije u rasporedu)';
        row.appendChild(ph);
        box.appendChild(row);
      });
    } else {
      const row = document.createElement('div');
      row.className = 'soc-cr-row';
      row.textContent = 'Raspored dežurnih nije učitan' + (key ? (' za ' + key) : '') + '. Učitaj ga u Evidenciji.';
      box.appendChild(row);
    }

    const close = document.createElement('button');
    close.className = 'soc-cr-close';
    close.textContent = 'U redu';
    close.addEventListener('click', function () { box.remove(); });
    box.appendChild(close);

    document.body.appendChild(box);
    setTimeout(function () { if (box && box.parentNode) box.remove(); }, 90000);
  }

  function showCallReminder() {
    if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) {
      renderCallReminder(null, []);
      return;
    }
    try {
      const getp = browserAPI.storage.local.get(['zsf.dezurniRaspored', 'zsf.dezurniKontakti']);
      Promise.resolve(getp).then(function (res) {
        const sched = (res && res['zsf.dezurniRaspored']) || {};
        const contacts = (res && res['zsf.dezurniKontakti']) || {};
        const key = oncallDayKeyNow();
        const day = sched[key];
        const lines = [];
        if (day && (day.primarni || day.sekundarni)) {
          if (day.primarni) lines.push({ label: 'Primarni', name: day.primarni, phone: lookupContactPhone(contacts, day.primarni) });
          if (day.sekundarni) lines.push({ label: 'Sekundarni', name: day.sekundarni, phone: lookupContactPhone(contacts, day.sekundarni) });
        }
        renderCallReminder(key, lines);
      }).catch(function () { renderCallReminder(null, []); });
    } catch (e) { renderCallReminder(null, []); }
  }

  function maybeRemindCall() {
    if (isCtInstance() && isAfterHoursNow()) showCallReminder();
  }

  function loadStoredState(callback) {
    if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) {
      stateLoaded = true;
      if (callback) callback();
      return;
    }
    const keys = ['filterEnabled', 'soundEnabled', 'soundVolume', 'notificationsEnabled', 'zsf.notifiedIds'];
    const onResult = function (result) {
      if (result && typeof result.filterEnabled === 'boolean') filterEnabled = result.filterEnabled;
      if (result && typeof result.soundEnabled === 'boolean') soundEnabled = result.soundEnabled;
      if (result && typeof result.soundVolume === 'number') {
        soundVolume = Math.max(0, Math.min(1, result.soundVolume));
      }
      if (result && typeof result.notificationsEnabled === 'boolean') {
        notificationsEnabled = result.notificationsEnabled;
      }
      const stored = result && result['zsf.notifiedIds'];
      if (stored && typeof stored === 'object') {
        const now = Date.now();
        for (const id in stored) {
          if (!Object.prototype.hasOwnProperty.call(stored, id)) continue;
          const ts = stored[id];
          if (typeof ts === 'number' && (now - ts) <= NOTIFIED_TTL_MS) {
            const sig = 'eid:' + id;
            notifiedSignatures.add(sig);
            notifiedAt.set(sig, ts);
            seenNotifySignatures.set(sig, now);
          }
        }
      }
      checkNotificationPermission();
      stateLoaded = true;
      if (callback) callback();
    };

    try {
      const result = browserAPI.storage.local.get(keys);
      if (result && typeof result.then === 'function') {
        result.then(onResult).catch(function () {
          stateLoaded = true;
          if (callback) callback();
        });
      } else {
        browserAPI.storage.local.get(keys, onResult);
      }
    } catch (e) {
      try {
        browserAPI.storage.local.get(keys, onResult);
      } catch (e2) {
        stateLoaded = true;
        if (callback) callback();
      }
    }
  }

  function recordNotified(sig) {
    if (!sig || sig.indexOf('eid:') !== 0) return;
    notifiedAt.set(sig, Date.now());
    persistNotifiedIds();
  }

  function persistNotifiedIds() {
    if (notifiedPersistTimer) return;
    notifiedPersistTimer = setTimeout(function () {
      notifiedPersistTimer = null;
      try {
        if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) return;
        const now = Date.now();
        const entries = [];
        for (const e of notifiedAt.entries()) {
          if (now - e[1] <= NOTIFIED_TTL_MS) entries.push(e);
        }
        entries.sort(function (a, b) { return b[1] - a[1]; });
        if (entries.length > NOTIFIED_CAP) entries.length = NOTIFIED_CAP;
        notifiedAt.clear();
        const obj = {};
        for (let i = 0; i < entries.length; i++) {
          const sig = entries[i][0];
          const ts = entries[i][1];
          notifiedAt.set(sig, ts);
          obj[sig.slice(4)] = ts;
        }
        const r = browserAPI.storage.local.set({ 'zsf.notifiedIds': obj });
        if (r && typeof r.catch === 'function') r.catch(function () {});
      } catch (e) {}
    }, 800);
  }

  function saveState() {
    if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) return;
    try {
      const result = browserAPI.storage.local.set({
        filterEnabled: filterEnabled,
        soundEnabled: soundEnabled,
        soundVolume: soundVolume,
        notificationsEnabled: notificationsEnabled
      });
      if (result && typeof result.catch === 'function') {
        result.catch(function () {});
      }
    } catch (e) {}
  }

  function isProblemsTable(table) {
    if (!table) return false;
    const headers = table.querySelectorAll('thead th, thead td');
    if (headers.length < 3) return false;
    let matches = 0;
    const required = ['problem', 'host', 'severity', 'time', 'duration'];
    const headerText = Array.from(headers)
      .map(function (h) { return (h.textContent || '').trim().toLowerCase(); })
      .join('|');
    for (let i = 0; i < required.length; i++) {
      if (headerText.indexOf(required[i]) !== -1) matches++;
    }
    return matches >= 3;
  }

  function isTimeGapRow(row) {
    if (!row || !row.querySelectorAll) return false;
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return true;

    const text = (row.textContent || '').trim();

    if (/^\d{1,2}:\d{2}$/.test(text)) return true;
    if (/^(today|yesterday)$/i.test(text)) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i.test(text)) return true;

    if (cells.length === 1 && text.length < 30) return true;

    return false;
  }

  function markProblemTables() {
    const allTables = document.querySelectorAll('table');
    for (let i = 0; i < allTables.length; i++) {
      const table = allTables[i];
      if (table.getAttribute('data-soc-ptable') === '1') continue;
      if (isProblemsTable(table)) {
        table.setAttribute('data-soc-ptable', '1');
      }
    }
  }

  function findProblemRows() {
    const rows = [];
    const allTables = document.querySelectorAll('table');
    for (let i = 0; i < allTables.length; i++) {
      const table = allTables[i];

      let isP = isProblemsTable(table);
      if (isP) {
        table.setAttribute('data-soc-ptable', '1');
      } else if (table.getAttribute('data-soc-ptable') === '1') {
        if (table.querySelector('thead th, thead td')) {
          isP = true;
        } else {
          table.removeAttribute('data-soc-ptable');
        }
      }
      if (!isP) continue;

      const tableRows = table.querySelectorAll('tbody tr');
      for (let j = 0; j < tableRows.length; j++) {
        const row = tableRows[j];
        const cells = row.querySelectorAll('td');
        if (cells.length < 1) continue;
        if (row.classList && row.classList.contains('nothing-to-show')) continue;
        if (row.querySelector && row.querySelector('.dashboard-widget-empty')) continue;

        rows.push(row);
      }
    }
    return rows;
  }

  function collapseTimeGaps(rows) {
    let collapsed = 0;
    let gapStreakRows = [];

    function flushStreak() {
      if (gapStreakRows.length > 1) {
        for (let i = 1; i < gapStreakRows.length; i++) {
          gapStreakRows[i].setAttribute('data-soc-gap-collapsed', 'true');
          gapStreakRows[i].style.display = 'none';
          collapsed++;
        }
      } else if (gapStreakRows.length === 1) {
        const r = gapStreakRows[0];
        if (r.hasAttribute('data-soc-gap-collapsed')) {
          r.removeAttribute('data-soc-gap-collapsed');
          r.style.display = '';
        }
      }
      gapStreakRows = [];
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isDimmedByFilter = row.getAttribute('data-soc-filter') === 'dim';

      if (isTimeGapRow(row)) {
        if (row.hasAttribute('data-soc-gap-collapsed')) {
          row.removeAttribute('data-soc-gap-collapsed');
          row.style.display = '';
        }
        gapStreakRows.push(row);
      } else if (!isDimmedByFilter) {
        flushStreak();
      }
    }

    flushStreak();
    collapsedGapsCount = collapsed;
  }

  function cleanupStaleAttributes(currentRows) {
    const currentSet = new Set(currentRows);
    const allMarked = document.querySelectorAll(
      'tr[data-soc-gap-collapsed], tr[data-soc-filter]'
    );
    for (let i = 0; i < allMarked.length; i++) {
      const row = allMarked[i];
      if (currentSet.has(row)) continue;

      if (row.hasAttribute('data-soc-gap-collapsed')) {
        row.removeAttribute('data-soc-gap-collapsed');
      }
      if (row.hasAttribute('data-soc-filter')) {
        row.removeAttribute('data-soc-filter');
        row.removeAttribute('data-soc-reason');
      }
      if (row.style && row.style.display === 'none') {
        row.style.display = '';
      }
      untrackRow(row);
    }
  }

  function applyFilter() {
    if (zsfAuthState !== 'active') return;
    if (!stateLoaded) return;
    observerPaused = true;
    try {
      applyFilterInner();
    } finally {
      observerPaused = false;
    }
    reObserveIfNeeded();
  }

  function applyFilterInner() {
    const rows = findProblemRows();

    if (rows.length === 0 && lastProblemRowCount > 0 &&
        (Date.now() - lastNonEmptyScanAt) < TRANSIENT_EMPTY_GUARD_MS) {
      if (document.documentElement) {
        document.documentElement.classList.toggle('soc-focus-mode', filterEnabled);
      }
      updateBulkButton();
      return;
    }

    cleanupStaleAttributes(rows);

    let hidden = 0;
    let visible = 0;
    const reasons = {};

    let newNotifyCount = 0;
    const newNotifyInfos = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (row.hasAttribute('data-soc-gap-collapsed')) {
        row.removeAttribute('data-soc-gap-collapsed');
        row.style.display = '';
      }

      if (isTimeGapRow(row)) {
        if (row.hasAttribute('data-soc-filter')) {
          row.removeAttribute('data-soc-filter');
          row.removeAttribute('data-soc-reason');
        }
        row.style.display = '';
        continue;
      }

      const info = getRowInfo(row);
      if (!info) {
        if (row.hasAttribute('data-soc-filter')) {
          row.removeAttribute('data-soc-filter');
          row.removeAttribute('data-soc-reason');
        }
        row.style.display = '';
        removeNotifyButton(row);
        untrackRow(row);
        continue;
      }

      const evalText = info.problem || '';
      if (!evalText) {
        if (row.hasAttribute('data-soc-filter')) {
          row.removeAttribute('data-soc-filter');
          row.removeAttribute('data-soc-reason');
        }
        row.style.display = '';
        removeNotifyButton(row);
        untrackRow(row);
        continue;
      }

      const result = evaluate(evalText, info.host);

      if (result.show) {
        row.setAttribute('data-soc-filter', 'notify');
        if (row.hasAttribute('data-soc-reason')) {
          row.removeAttribute('data-soc-reason');
        }
        row.style.display = '';
        visible++;

        if (info.eventId && /^\d+$/.test(info.eventId)) {
          const stableKey = 'eid:' + info.eventId;
          const isNew = !seenNotifySignatures.has(stableKey);
          seenNotifySignatures.set(stableKey, Date.now());
          const alreadyNotifiedByUser = notifiedSignatures.has(info.signature);

          if (!isFirstScan && isNew && !alreadyNotifiedByUser) {
            newNotifyCount++;
            newNotifyInfos.push(info);
          }
        }
        ensureNotifyButton(row, info);
        trackRowForButton(row, info);
      } else {
        row.setAttribute('data-soc-filter', 'dim');
        row.setAttribute('data-soc-reason', result.reason);
        reasons[result.reason] = (reasons[result.reason] || 0) + 1;
        row.style.display = '';
        hidden++;
        removeNotifyButton(row);
        untrackRow(row);
      }
    }

    pruneSeenSignatures();

    if (newNotifyCount > 0 && !isFirstScan) {
      playNotifySound();
      for (let i = 0; i < newNotifyInfos.length; i++) {
        showBrowserNotification(newNotifyInfos[i]);
      }
    }

    if (isFirstScan && rows.length > 0) {
      const hasNonGapRow = rows.some(function (r) { return !isTimeGapRow(r); });
      if (hasNonGapRow) {
        isFirstScan = false;
      }
    }

    if (filterEnabled) {
      collapseTimeGaps(rows);
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.hasAttribute('data-soc-gap-collapsed')) {
          row.removeAttribute('data-soc-gap-collapsed');
          row.style.display = '';
        }
      }
      collapsedGapsCount = 0;
    }

    hiddenCount = hidden;
    visibleCount = visible;

    if (!loggedFirstScan) {
      loggedFirstScan = true;
      const ptables = document.querySelectorAll('table[data-soc-ptable]').length;
      console.log('[Zabbix SOC Filter] Prvi scan -> problem tabela: ' + ptables +
                  ', redova: ' + rows.length + ', obavestavamo: ' + visible +
                  ', ne obavestavamo: ' + hidden + ', filter: ' + (filterEnabled ? 'ON' : 'OFF'));
    }

    if (rows.length > 0) {
      lastProblemRowCount = rows.length;
      lastNonEmptyScanAt = Date.now();
    } else {
      lastProblemRowCount = 0;
    }

    if (document.documentElement) {
      document.documentElement.classList.toggle('soc-focus-mode', filterEnabled);
    }

    updateBulkButton();
  }

  let bulkButton = null;
  let bulkMenu = null;
  let bulkMenuOpen = false;
  let bulkLastCount = -1;
  let ackButton = null;
  let actionDock = null;
  let ackBusy = false;
  let ackLastCount = -1;

  function teamLabel(team) {
    switch (team) {
      case 'dccpt': return 'DCCPT';
      case 'dccpt-agri': return 'DCCPT Agri';
      case 'network': return 'Networking';
      case 'network-agri': return 'Networking Agri';
      case 'devops': return 'DevOps';
      case 'dondon': return 'DonDon';
      default: return team || 'Tim';
    }
  }

  function closeBulkMenu() {
    bulkMenuOpen = false;
    if (bulkMenu) bulkMenu.style.display = 'none';
  }

  function renderBulkMenu(groups) {
    if (!bulkMenu) return;
    bulkMenu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'soc-bulk-menu-header';
    header.textContent = 'Grupno obaveštavanje';
    bulkMenu.appendChild(header);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const item = document.createElement('button');
      item.className = 'soc-bulk-menu-item';
      item.type = 'button';

      const label = document.createElement('span');
      label.className = 'soc-bulk-menu-label';
      label.textContent = teamLabel(group.team);

      const count = document.createElement('span');
      count.className = 'soc-bulk-menu-count';
      count.textContent = group.alerts.length + ' ' + pluralAlarm(group.alerts.length);

      item.appendChild(label);
      item.appendChild(count);
      item.title = group.email;

      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        composeAndOpenGroup(group);
        closeBulkMenu();
      });

      bulkMenu.appendChild(item);
    }
  }

  function handleAckClick() {
    if (ackBusy) return;
    const ids = collectDimEventIds();
    if (ids.length === 0) {
      showToast('Nema alarma koji se ne šalju za označavanje.', false);
      return;
    }
    const name = (analystName || '').trim();
    if (!name) {
      showToast('Ime nije prepoznato po username-u. Javi se Stefanu.', true);
      return;
    }
    ackBusy = true;
    if (ackButton) {
      ackButton.classList.add('soc-ack-btn--busy');
      const t = ackButton.querySelector('.soc-ack-btn-text');
      if (t) t.textContent = 'Označavam...';
    }
    sendAcknowledge(ids, 'Seen by: ' + name).then(function (res) {
      ackBusy = false;
      if (ackButton) ackButton.classList.remove('soc-ack-btn--busy');
      if (res.ok) {
        showToast('Označeno kao pregledano: ' + res.count + ' ' + pluralAlarm(res.count), false);
        ackLastCount = -1;
        setTimeout(function () { triggerZabbixApply(); }, 400);
        setTimeout(function () { applyFilter(); }, 1200);
      } else {
        showToast('Greška: ' + res.error, true);
        ackLastCount = -1;
        updateAckButton();
      }
    });
  }

  function ensureBulkElements() {
    if (bulkButton) return;

    actionDock = document.createElement('div');
    actionDock.className = 'soc-action-dock';

    ackButton = document.createElement('button');
    ackButton.className = 'soc-ack-btn soc-hidden';
    ackButton.type = 'button';
    ackButton.title = 'Acknowledge svih alarma koji se ne šalju, sa komentarom Seen by';
    ackButton.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleAckClick();
    });

    bulkButton = document.createElement('button');
    bulkButton.className = 'soc-bulk-btn soc-hidden';
    bulkButton.type = 'button';
    bulkButton.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const groups = collectActiveAlertGroups();
      if (groups.length === 0) return;
      if (groups.length === 1) {
        composeAndOpenGroup(groups[0]);
        return;
      }
      if (bulkMenuOpen) {
        closeBulkMenu();
      } else {
        renderBulkMenu(groups);
        bulkMenu.style.display = 'block';
        if (actionDock) {
          const r = actionDock.getBoundingClientRect();
          bulkMenu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
          bulkMenu.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
        }
        bulkMenuOpen = true;
      }
    });

    bulkMenu = document.createElement('div');
    bulkMenu.className = 'soc-bulk-menu';
    bulkMenu.style.display = 'none';

    document.addEventListener('click', function (e) {
      if (!bulkMenuOpen) return;
      if (bulkMenu.contains(e.target) || bulkButton.contains(e.target)) return;
      closeBulkMenu();
    }, true);

    actionDock.appendChild(ackButton);
    actionDock.appendChild(bulkButton);

    if (document.body) {
      document.body.appendChild(bulkMenu);
      document.body.appendChild(actionDock);
    }
  }

  function updateAckButton() {
    if (!ackButton) return;
    if (!filterEnabled) {
      ackButton.classList.add('soc-hidden');
      ackLastCount = 0;
      return;
    }
    if (isDonDonInstance()) {
      ackButton.classList.add('soc-hidden');
      ackLastCount = 0;
      return;
    }
    const dimRows = document.querySelectorAll('tr[data-soc-filter="dim"]');
    let count = 0;
    for (let i = 0; i < dimRows.length; i++) {
      if (!isTimeGapRow(dimRows[i]) && getEventId(dimRows[i])) count++;
    }

    if (count === 0) {
      ackButton.classList.add('soc-hidden');
      ackLastCount = 0;
      return;
    }

    const wasHidden = ackButton.classList.contains('soc-hidden');
    if (count === ackLastCount && !wasHidden && !ackBusy) return;
    ackLastCount = count;
    ackButton.classList.remove('soc-hidden');
    ackButton.textContent = '';

    const icon = document.createElement('span');
    icon.className = 'soc-ack-btn-icon';
    icon.textContent = '✓';

    const text = document.createElement('span');
    text.className = 'soc-ack-btn-text';
    text.textContent = 'Označi pregledano';

    const badge = document.createElement('span');
    badge.className = 'soc-ack-btn-badge';
    badge.textContent = String(count);

    ackButton.appendChild(icon);
    ackButton.appendChild(text);
    ackButton.appendChild(badge);
  }

  function updateBulkButton() {
    ensureBulkElements();
    updateAckButton();
    if (!bulkButton) return;

    if (!filterEnabled) {
      bulkButton.classList.add('soc-hidden');
      bulkLastCount = -1;
      closeBulkMenu();
      return;
    }

    const notifyRows = document.querySelectorAll('tr[data-soc-filter="notify"]');
    const total = notifyRows.length;

    if (total < 2) {
      bulkButton.classList.add('soc-hidden');
      bulkLastCount = total;
      closeBulkMenu();
      return;
    }

    const wasHidden = bulkButton.classList.contains('soc-hidden');
    if (total === bulkLastCount && !wasHidden) {
      return;
    }
    bulkLastCount = total;
    bulkButton.classList.remove('soc-hidden');
    bulkButton.textContent = '';

    const icon = document.createElement('span');
    icon.className = 'soc-bulk-btn-icon';
    icon.textContent = '✉';

    const text = document.createElement('span');
    text.className = 'soc-bulk-btn-text';
    text.textContent = 'Obavesti za sve';

    const badge = document.createElement('span');
    badge.className = 'soc-bulk-btn-badge';
    badge.textContent = String(total);

    bulkButton.appendChild(icon);
    bulkButton.appendChild(text);
    bulkButton.appendChild(badge);
  }

  let debounceTimer = null;
  let debounceMaxWaitTimer = null;
  function scheduleFilter() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      if (debounceMaxWaitTimer) {
        clearTimeout(debounceMaxWaitTimer);
        debounceMaxWaitTimer = null;
      }
      applyFilter();
    }, DEBOUNCE_MS);
    if (!debounceMaxWaitTimer) {
      debounceMaxWaitTimer = setTimeout(function () {
        debounceMaxWaitTimer = null;
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          applyFilter();
        }
      }, 1500);
    }
  }

  let observer = null;
  let observerPaused = false;
  let observeTarget = null;
  const trackedRows = new WeakMap();

  function getObserveTarget() {
    let t = document.querySelector('table[data-soc-ptable]');
    if (!t) {
      const tables = document.querySelectorAll('table');
      for (let i = 0; i < tables.length; i++) {
        if (isProblemsTable(tables[i])) { t = tables[i]; break; }
      }
    }
    if (t && t.closest) {
      const c = t.closest('.dashboard-grid-widget-content') ||
                t.closest('.dashboard-grid-widget') ||
                t.parentElement;
      if (c) return c;
    }
    return document.body;
  }

  function reObserveIfNeeded() {
    if (!observer) return;
    const t = getObserveTarget();
    if (t && t !== observeTarget) {
      try { observer.disconnect(); } catch (e) {}
      observeTarget = t;
      try { observer.observe(observeTarget, { childList: true, subtree: true }); } catch (e) {}
    }
  }

  function trackRowForButton(row, info) {
    trackedRows.set(row, info);
  }

  function untrackRow(row) {
    trackedRows.delete(row);
  }

  function restoreButtonsForTrackedRows() {
    const rows = findProblemRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!trackedRows.has(row)) continue;
      if (row.getAttribute('data-soc-filter') !== 'notify') continue;
      const info = trackedRows.get(row);
      if (!row.querySelector('.soc-notify-btn')) {
        ensureNotifyButton(row, info);
      }
    }
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      if (observerPaused) return;
      let shouldRun = false;
      let buttonRemoved = false;

      for (let i = 0; i < mutations.length; i++) {
        const mut = mutations[i];
        if (mut.type !== 'childList') continue;

        if (mut.removedNodes && mut.removedNodes.length > 0) {
          for (let k = 0; k < mut.removedNodes.length; k++) {
            const removed = mut.removedNodes[k];
            if (removed.nodeType !== 1) continue;
            if (removed.classList && removed.classList.contains('soc-notify-btn')) {
              buttonRemoved = true;
              continue;
            }
            if (removed.querySelector && removed.querySelector('.soc-notify-btn')) {
              buttonRemoved = true;
            }
          }
        }

        if (!mut.addedNodes || mut.addedNodes.length === 0) continue;

        const target = mut.target;
        if (!target || !target.closest) continue;

        const inScope = target.closest('table') ||
                        target.closest('.dashboard-grid-widget') ||
                        target.closest('.dashboard-grid-widget-content');
        if (!inScope) continue;

        for (let j = 0; j < mut.addedNodes.length; j++) {
          const node = mut.addedNodes[j];
          if (node.nodeType !== 1) continue;
          if (node.classList && node.classList.contains('soc-notify-btn')) continue;
          if (node.classList && node.classList.contains('soc-bulk-btn')) continue;
          if (node.classList && node.classList.contains('soc-bulk-menu')) continue;

          const tag = node.tagName;
          if (tag === 'TR' || tag === 'TBODY' || tag === 'TABLE' || tag === 'TD' ||
              (node.querySelector && node.querySelector('table'))) {
            shouldRun = true;
            break;
          }
        }
      }

      if (buttonRemoved) {
        restoreButtonsForTrackedRows();
      }
      if (shouldRun) {
        markProblemTables();
        scheduleFilter();
      }
    });

    observeTarget = getObserveTarget();
    observer.observe(observeTarget, { childList: true, subtree: true });
  }

  if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
    browserAPI.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.action) return false;

      switch (message.action) {
        case 'getStatus':
          checkNotificationPermission();
          sendResponse({
            ok: true,
            ready: stateLoaded,
            enabled: filterEnabled,
            hiddenCount: hiddenCount,
            visibleCount: visibleCount,
            soundEnabled: soundEnabled,
            soundVolume: soundVolume,
            notificationsEnabled: notificationsEnabled,
            notificationPermission: notificationPermission,
            analystName: analystName,
            isDonDon: isDonDonInstance()
          });
          return false;

        case 'setEnabled':
          filterEnabled = !!message.enabled;
          saveState();
          applyFilter();
          sendResponse({ ok: true, enabled: filterEnabled });
          return false;

        case 'setSoundEnabled':
          soundEnabled = !!message.enabled;
          saveState();
          sendResponse({ ok: true, soundEnabled: soundEnabled });
          return false;

        case 'setSoundVolume': {
          const v = parseFloat(message.volume);
          if (!isNaN(v)) {
            soundVolume = Math.max(0, Math.min(1, v));
            if (audioElement) audioElement.volume = soundVolume;
            saveState();
          }
          sendResponse({ ok: true, soundVolume: soundVolume });
          return false;
        }

        case 'setNotificationsEnabled':
          notificationsEnabled = !!message.enabled;
          saveState();
          sendResponse({ ok: true, notificationsEnabled: notificationsEnabled });
          return false;

        case 'requestNotificationPermission':
          requestNotificationPermission().then(function (perm) {
            sendResponse({ ok: true, permission: perm });
          }).catch(function (e) {
            sendResponse({ ok: false, error: String(e) });
          });
          return true;

        case 'captureAllPresent': {
          let count = 0;
          try {
            const rows = findProblemRows();
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              if (row.getAttribute('data-soc-filter') !== 'notify') continue;
              if (isTimeGapRow(row)) continue;
              const info = getRowInfo(row);
              if (!info || !info.problem) continue;
              captureDutyLog(info, false);
              count++;
            }
          } catch (e) {}
          sendResponse({ ok: true, count: count, isCt: isCtInstance() });
          return false;
        }

        case 'reapply':
          applyFilter();
          sendResponse({ ok: true });
          return false;
      }
      return false;
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || !e.key) return;
    if (e.key.toLowerCase() !== 'z') return;
    if (e.shiftKey || e.altKey || e.metaKey) return;

    const target = e.target;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;
    }

    e.preventDefault();
    filterEnabled = !filterEnabled;
    saveState();
    applyFilter();
  }, true);

  let periodicTimer = null;
  let buttonRestoreTimer = null;
  let handledPollTimer = null;
  let currentScanInterval = SCAN_INTERVAL_MS;
  const SCAN_INTERVAL_HIDDEN_MS = 30000;

  function ensurePeriodicScan() {
    if (!handledPollTimer) {
      handledPollTimer = setInterval(pollHandledByOthers, POLL_HANDLED_MS);
      setTimeout(pollHandledByOthers, 1500);
    }
    const wantInterval = (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      ? SCAN_INTERVAL_HIDDEN_MS
      : SCAN_INTERVAL_MS;
    if (periodicTimer && wantInterval === currentScanInterval) {
      if (!buttonRestoreTimer) {
        buttonRestoreTimer = setInterval(restoreButtonsForTrackedRows, BUTTON_RESTORE_INTERVAL_MS);
      }
      return;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    currentScanInterval = wantInterval;
    periodicTimer = setInterval(applyFilter, currentScanInterval);
    if (!buttonRestoreTimer) {
      buttonRestoreTimer = setInterval(restoreButtonsForTrackedRows, BUTTON_RESTORE_INTERVAL_MS);
    }
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (zsfAuthState === 'active') {
        ensurePeriodicScan();
        if (document.visibilityState === 'visible') {
          applyFilter();
          pollHandledByOthers();
        }
      }
    });
  }

  function injectRefreshHook() {
    const url = getRuntimeUrl('inject.js');
    if (!url) return;
    try {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  function clearRefreshOverlay() {
    if (refreshSafetyTimer) { clearTimeout(refreshSafetyTimer); refreshSafetyTimer = null; }
    if (refreshClearTimer) { clearTimeout(refreshClearTimer); refreshClearTimer = null; }
    if (document.documentElement) {
      document.documentElement.classList.remove('soc-refreshing');
    }
  }

  function startRefreshOverlay() {
    if (!filterEnabled) return;
    if (document.documentElement) {
      document.documentElement.classList.add('soc-refreshing');
    }
    if (refreshSafetyTimer) clearTimeout(refreshSafetyTimer);
    refreshSafetyTimer = setTimeout(clearRefreshOverlay, 2500);
  }

  function endRefreshOverlay() {
    markProblemTables();
    scheduleFilter();
    if (refreshClearTimer) clearTimeout(refreshClearTimer);
    refreshClearTimer = setTimeout(function () {
      refreshClearTimer = null;
      applyFilter();
      clearRefreshOverlay();
    }, 300);
  }

  document.addEventListener('soc-refresh-start', startRefreshOverlay);
  document.addEventListener('soc-refresh-end', endRefreshOverlay);

  function getRefreshReq() {
    try {
      const raw = document.documentElement ? document.documentElement.getAttribute('data-soc-refresh-req') : null;
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.u) return null;
      return o;
    } catch (e) { return null; }
  }

  function collectServerEventIds(rootDoc) {
    const ids = new Set();
    try {
      const cbs = rootDoc.querySelectorAll('input[type="checkbox"]');
      for (let i = 0; i < cbs.length; i++) {
        const v = cbs[i].value || '';
        if (/^\d{6,}$/.test(v)) { ids.add(v); continue; }
        const nm = cbs[i].getAttribute('name') || '';
        const m = nm.match(/(\d{6,})/);
        if (m) ids.add(m[1]);
      }
      const dataEls = rootDoc.querySelectorAll('[data-eventid]');
      for (let i = 0; i < dataEls.length; i++) {
        const id = dataEls[i].getAttribute('data-eventid') || '';
        if (/^\d{4,}$/.test(id)) ids.add(id);
      }
      const links = rootDoc.querySelectorAll('a[href*="eventid"]');
      for (let i = 0; i < links.length; i++) {
        const m = (links[i].getAttribute('href') || '').match(/eventid[=:](\d{4,})/i);
        if (m) ids.add(m[1]);
      }
    } catch (e) {}
    return ids;
  }

  function parseRefreshResponse(text) {
    let html = text;
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') {
        if (j.error) return { valid: false };
        html = j.body || j.data || j.main_block || text;
      }
    } catch (e) {}
    if (typeof html !== 'string' || !html) return { valid: false };
    if (/no permissions to access this page|logged in as|GUI access disabled/i.test(html)) {
      return { valid: false };
    }
    let parsed = null;
    try { parsed = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return { valid: false }; }
    if (!parsed) return { valid: false };
    const hasTable = !!parsed.querySelector('table.list-table, [data-eventid], input[name^="eventids"], input[name*="eventids"]');
    const emptyState = /no data found|nema podataka|nema problema/i.test(html);
    if (!hasTable && !emptyState) return { valid: false };
    return { valid: true, ids: collectServerEventIds(parsed) };
  }

  let handledPollBusy = false;
  function pollHandledByOthers() {
    try {
      if (zsfAuthState !== 'active' || !stateLoaded || !filterEnabled) return;
      if (handledPollBusy) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      if (isDonDonInstance()) { pollDonDonShared(); return; }

      const req = getRefreshReq();
      if (!req) return;

      const rows = findProblemRows();
      const tracked = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.getAttribute('data-soc-filter') !== 'notify') continue;
        const eid = getEventId(row);
        if (!eid || !/^\d+$/.test(eid)) continue;
        const sig = 'eid:' + eid;
        if (notifiedSignatures.has(sig)) continue;
        tracked.push({ row: row, eid: eid, sig: sig });
      }
      if (tracked.length === 0) return;

      handledPollBusy = true;
      const opts = {
        method: req.m || 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      };
      if (req.b != null && opts.method !== 'GET') {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        opts.body = req.b;
      }

      fetch(req.u, opts).then(function (r) {
        return r.text();
      }).then(function (text) {
        handledPollBusy = false;
        const res = parseRefreshResponse(text);
        if (!res.valid) return;
        const serverIds = res.ids;
        let greened = 0;
        for (let i = 0; i < tracked.length; i++) {
          const t = tracked[i];
          if (serverIds.has(t.eid)) continue;
          if (!t.row.isConnected) continue;
          notifiedSignatures.add(t.sig);
          recordNotified(t.sig);
          const btn = t.row.querySelector('.soc-notify-btn');
          if (btn) setButtonDone(btn, true);
          markRowNotified(t.row, true);
          greened++;
        }
        if (greened > 0) { try { updateBulkButton(); } catch (e) {} }
      }).catch(function () { handledPollBusy = false; });
    } catch (e) { handledPollBusy = false; }
  }

  function pollDonDonShared() {
    try {
      const rows = findProblemRows();
      const tracked = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.getAttribute('data-soc-filter') !== 'notify') continue;
        const eid = getEventId(row);
        if (!eid || !/^\d+$/.test(eid)) continue;
        const sig = 'eid:' + eid;
        if (notifiedSignatures.has(sig)) continue;
        tracked.push({ row: row, eid: eid, sig: sig });
      }
      if (tracked.length === 0) return;

      handledPollBusy = true;
      bgSend({ type: 'zsf.shareList' }).then(function (res) {
        handledPollBusy = false;
        if (!res || !res.ok || !Array.isArray(res.ids)) return;
        const set = new Set(res.ids.map(String));
        let greened = 0;
        for (let i = 0; i < tracked.length; i++) {
          const t = tracked[i];
          if (!set.has(t.eid)) continue;
          if (!t.row.isConnected) continue;
          notifiedSignatures.add(t.sig);
          recordNotified(t.sig);
          const btn = t.row.querySelector('.soc-notify-btn');
          if (btn) setButtonDone(btn, true);
          markRowNotified(t.row, true);
          greened++;
        }
        if (greened > 0) { try { updateBulkButton(); } catch (e) {} }
      });
    } catch (e) { handledPollBusy = false; }
  }

  function runScan() {
    try { applyFilter(); } catch (e) {}
  }

  function setupInfra() {
    try { startObserving(); } catch (e) {}
    try { ensurePeriodicScan(); } catch (e) {}
  }

  function cleanupZsfUI() {
    try {
      if (handledPollTimer) { clearInterval(handledPollTimer); handledPollTimer = null; }
      if (bulkButton && bulkButton.parentNode) bulkButton.parentNode.removeChild(bulkButton);
      bulkButton = null;
      if (ackButton && ackButton.parentNode) ackButton.parentNode.removeChild(ackButton);
      ackButton = null;
      if (bulkMenu && bulkMenu.parentNode) bulkMenu.parentNode.removeChild(bulkMenu);
      bulkMenu = null;
      bulkMenuOpen = false;
      const btns = document.querySelectorAll('.soc-notify-btn');
      for (let i = 0; i < btns.length; i++) {
        if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
      }
      const marked = document.querySelectorAll('[data-soc-filter]');
      for (let i = 0; i < marked.length; i++) marked[i].removeAttribute('data-soc-filter');
      const notified = document.querySelectorAll('[data-soc-notified]');
      for (let i = 0; i < notified.length; i++) notified[i].removeAttribute('data-soc-notified');
      const hasBtn = document.querySelectorAll('.soc-has-btn');
      for (let i = 0; i < hasBtn.length; i++) hasBtn[i].classList.remove('soc-has-btn');
      const tbl = document.querySelector('table[data-soc-ptable]');
      if (tbl) tbl.removeAttribute('data-soc-ptable');
      document.documentElement.classList.remove('soc-focus-mode');
    } catch (e) {}
  }

  function describeAuthBannerReason(s) {
    if (s.versionState === 'locked') {
      if (s.versionReason === 'below_min') return 'Verzija ' + s.myVersion + ' je ispod minimalne (' + s.minVersion + ').';
      if (s.versionReason === 'grace_expired_version') return 'Update server nedostupan više od 48h.';
    }
    if (s.authReason === 'revoked') return 'Pristup je opozvan.';
    if (s.authReason === 'not_found') return 'Korisnički nalog nije pronađen.';
    if (s.authReason === 'mismatch') return 'Token se ne poklapa.';
    if (s.authReason === 'grace_expired_auth') return 'Auth server nedostupan više od 24 sata.';
    return '';
  }

  function showAuthBanner(s) {
    let banner = document.getElementById('soc-auth-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'soc-auth-banner';
      banner.className = 'soc-auth-banner';
      if (document.body) document.body.appendChild(banner);
      else return;
    }
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const strong = document.createElement('span');
    strong.className = 'soc-auth-banner-strong';

    if (s.state === 'pending') {
      strong.textContent = 'Zabbix SOC Filter - aktivacija potrebna.';
      banner.appendChild(strong);
      banner.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.textContent = 'Klikni ikonu ekstenzije u toolbar-u i unesi token koji si dobio/la.';
      banner.appendChild(span);
    } else if (s.state === 'locked') {
      strong.textContent = 'Pristup zaključan.';
      banner.appendChild(strong);
      banner.appendChild(document.createTextNode(' '));
      const reason = describeAuthBannerReason(s);
      if (reason) {
        const reasonSpan = document.createElement('span');
        reasonSpan.textContent = reason;
        banner.appendChild(reasonSpan);
        banner.appendChild(document.createTextNode(' '));
      }
      const contact = document.createElement('span');
      contact.className = 'soc-auth-banner-contact';
      contact.textContent = 'Kontakt: ssimovic@comtrade.com · +381 60 320 2273';
      banner.appendChild(contact);
    }
    banner.className = 'soc-auth-banner soc-auth-banner--' + s.state;
  }

  function hideAuthBanner() {
    const banner = document.getElementById('soc-auth-banner');
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  function applyAuthGate(s) {
    if (!s) return;
    const prev = zsfAuthState;
    zsfAuthState = s.state;
    if (s.state === 'active') {
      analystName = resolveAnalystName(s.username);
      hideAuthBanner();
      if (prev !== 'active') {
        setupInfra();
        runScan();
      }
    } else {
      cleanupZsfUI();
      showAuthBanner(s);
    }
  }

  function bgSend(message) {
    return new Promise(function (resolve) {
      try {
        const api = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
                  : (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : null;
        if (!api || !api.sendMessage) { resolve(null); return; }
        const r = api.sendMessage(message, function (resp) { resolve(resp || null); });
        if (r && typeof r.then === 'function') {
          r.then(function (resp) { resolve(resp || null); }).catch(function () { resolve(null); });
        }
      } catch (e) { resolve(null); }
    });
  }

  function shareReportDonDon(eids) {
    if (!isDonDonInstance()) return;
    const list = (eids || []).filter(function (e) { return e && /^\d+$/.test(e); });
    if (list.length === 0) return;
    bgSend({ type: 'zsf.shareAdd', ids: list });
  }

  function queryZsfState() {
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (r) {
        if (settled) return;
        settled = true;
        resolve(r || null);
      };
      setTimeout(function () { finish(null); }, 8000);
      try {
        const api = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
                  : (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : null;
        if (!api || !api.sendMessage) { finish(null); return; }
        const r = api.sendMessage({ type: 'zsf.getState' }, finish);
        if (r && typeof r.then === 'function') {
          r.then(finish).catch(function () { finish(null); });
        }
      } catch (e) { finish(null); }
    });
  }

  try {
    const sapi = (typeof browser !== 'undefined' && browser.storage) ? browser.storage
              : (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
    if (sapi && sapi.onChanged) {
      sapi.onChanged.addListener(function (changes) {
        const keys = Object.keys(changes);
        const zsfChanged = keys.some(function (k) { return k.indexOf('zsf.') === 0; });
        if (zsfChanged) {
          queryZsfState().then(applyAuthGate);
        }
        let needsRescan = false;
        if (changes.filterEnabled && typeof changes.filterEnabled.newValue === 'boolean') {
          filterEnabled = changes.filterEnabled.newValue;
          needsRescan = true;
        }
        if (changes.soundEnabled && typeof changes.soundEnabled.newValue === 'boolean') {
          soundEnabled = changes.soundEnabled.newValue;
        }
        if (changes.soundVolume && typeof changes.soundVolume.newValue === 'number') {
          soundVolume = Math.max(0, Math.min(1, changes.soundVolume.newValue));
          if (audioElement) audioElement.volume = soundVolume;
        }
        if (changes.notificationsEnabled && typeof changes.notificationsEnabled.newValue === 'boolean') {
          notificationsEnabled = changes.notificationsEnabled.newValue;
        }
        if (needsRescan && zsfAuthState === 'active' && stateLoaded) {
          applyFilter();
        }
      });
    }
  } catch (e) {}

  function bootstrap() {
    injectRefreshHook();

    queryZsfState().then(function (s) {
      if (!s) {
        zsfAuthState = 'pending';
        showAuthBanner({ state: 'pending' });
        return;
      }
      applyAuthGate(s);
      if (s.state === 'active') {
        loadStoredState(function () {
          runScan();
          const delays = [150, 400, 800, 1500, 2500, 4000, 6000];
          for (let i = 0; i < delays.length; i++) {
            setTimeout(runScan, delays[i]);
          }
        });
        setTimeout(function () {
          if (!stateLoaded) {
            stateLoaded = true;
            runScan();
          }
        }, 2000);
      }
    });
  }

  window.addEventListener('load', runScan);
  window.addEventListener('pageshow', runScan);
  window.addEventListener('focus', runScan);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  console.log('[Zabbix SOC Filter v' + VERSION + '] Učitan');
})();
