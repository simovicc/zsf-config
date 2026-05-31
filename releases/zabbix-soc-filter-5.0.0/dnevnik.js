(function () {
  'use strict';

  const browserAPI = (typeof browser !== 'undefined') ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const LOG_KEY = 'zsf.dutyLog';
  const SCHED_KEY = 'zsf.dezurniRaspored';
  const REGISTAR_URL = 'https://comtradegroup.sharepoint.com/:x:/r/sites/40i2nujn-SecurityOperationsCentar/_layouts/15/Doc.aspx?action=edit&sourcedoc=%7Be092e8f0-52e8-4e18-a026-909343c63e92%7D&wdExp=TEAMS-TREATMENT&web=1&TeamsCID=9b69445c-b26f-49f2-b4b7-c8cfbf050bc1';
  const DCCPT_URL = 'https://comtradegroup.sharepoint.com/:x:/r/sites/ICT-Delivery657/_layouts/15/Doc2.aspx?action=edit&sourcedoc=%7Bcc7e1ee2-077d-46a2-a126-3afb92384a66%7D&wdOrigin=TEAMS-MAGLEV.undefined_ns.rwc&wdExp=TEAMS-TREATMENT&wdhostclicktime=1762686101302&web=1';

  const DEZURNI = [
    'Radovan Vidaković', 'Franjo Rački', 'Damir Lukač', 'Zijad Ceković',
    'Mirsad Merdan', 'Branko Ćirović', 'Tomislav Deretić', 'Emir Smajović',
    'Miloš Vasić', 'Anisia Jovanovski', 'Vesna Janičić', 'Vladan Obradović'
  ];

  const COLS = ['host', 'problem', 'datum', 'vremeAlarm', 'vremeMail', 'odziv', 'koObavesten', 'vremePoziva', 'analiticar'];

  const WORK_START = 8 * 60;

  let log = [];
  let schedule = {};
  let contacts = {};
  let saveTimer = null;
  const CONTACTS_KEY = 'zsf.dezurniKontakti';

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayDMY() {
    const d = new Date();
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function parseDate(s) {
    s = (s || '').trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) {
      let y = parseInt(m[3], 10); if (y < 100) y += 2000;
      return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?$/.exec(s);
    if (m) {
      let y = parseInt(m[3], 10); if (y < 100) y += 2000;
      return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    }
    return null;
  }

  function fmtDate(d) {
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function hmToMin(hm) {
    const m = /^(\d{1,2}):(\d{2})/.exec((hm || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function oncallDayKey(datum, vreme) {
    const d = parseDate(datum);
    if (!d) return null;
    const mins = hmToMin(vreme);
    if (mins !== null && mins < WORK_START) {
      d.setDate(d.getDate() - 1);
    }
    return fmtDate(d);
  }

  function loadLog() {
    return new Promise(function (resolve) {
      try {
        const p = browserAPI.storage.local.get([LOG_KEY]);
        Promise.resolve(p).then(function (res) {
          const arr = (res && Array.isArray(res[LOG_KEY])) ? res[LOG_KEY] : [];
          arr.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          resolve(arr);
        }).catch(function () { resolve([]); });
      } catch (e) { resolve([]); }
    });
  }

  function saveLog() {
    try {
      const p = browserAPI.storage.local.set({ [LOG_KEY]: log });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function loadSchedule() {
    return new Promise(function (resolve) {
      try {
        const p = browserAPI.storage.local.get([SCHED_KEY]);
        Promise.resolve(p).then(function (res) {
          resolve((res && res[SCHED_KEY] && typeof res[SCHED_KEY] === 'object') ? res[SCHED_KEY] : {});
        }).catch(function () { resolve({}); });
      } catch (e) { resolve({}); }
    });
  }

  function saveSchedule() {
    try {
      const p = browserAPI.storage.local.set({ [SCHED_KEY]: schedule, [CONTACTS_KEY]: contacts });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function loadContacts() {
    return new Promise(function (resolve) {
      try {
        const p = browserAPI.storage.local.get([CONTACTS_KEY]);
        Promise.resolve(p).then(function (res) {
          resolve((res && res[CONTACTS_KEY] && typeof res[CONTACTS_KEY] === 'object') ? res[CONTACTS_KEY] : {});
        }).catch(function () { resolve({}); });
      } catch (e) { resolve({}); }
    });
  }

  function parseSchedule(text) {
    const days = {};
    const contacts = {};
    const lines = (text || '').split(/\r?\n/);
    const isTimeRange = function (c) { return /^\d{1,2}\s*h?\s*-\s*\d{1,2}\s*h?$/i.test(c); };
    const phoneRe = /^[+]?[\d][\d\s\-\/]{6,}$/;
    const hasLetter = function (c) { return /[a-zA-ZčćžšđČĆŽŠĐ]/.test(c); };
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split('\t').map(function (c) { return c.trim(); });

      let dateIdx = -1;
      for (let j = 0; j < cells.length; j++) {
        if (parseDate(cells[j])) { dateIdx = j; break; }
      }
      if (dateIdx !== -1) {
        const d = parseDate(cells[dateIdx]);
        const rest = cells.slice(dateIdx + 1).filter(function (c) { return c && !isTimeRange(c) && !phoneRe.test(c) && c.indexOf('@') === -1; });
        if (rest.length) {
          days[fmtDate(d)] = { primarni: rest[0] || '', sekundarni: rest[1] || '' };
        }
      }

      for (let p = 0; p < cells.length; p++) {
        if (phoneRe.test(cells[p]) && cells[p].replace(/\D/g, '').length >= 8) {
          let name = '';
          for (let q = p - 1; q >= 0; q--) {
            if (cells[q] && hasLetter(cells[q]) && !isTimeRange(cells[q]) && !parseDate(cells[q]) && cells[q].indexOf('@') === -1) { name = cells[q]; break; }
          }
          let mail = '';
          for (let r = 0; r < cells.length; r++) { if (cells[r].indexOf('@') !== -1) { mail = cells[r]; break; } }
          if (name) contacts[name] = { phone: cells[p].replace(/\s+/g, ' ').trim(), mail: mail };
          break;
        }
      }
    }
    return { days: days, contacts: contacts };
  }

  function applyScheduleAutofill() {
    let changed = false;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (e.workHours) continue;
      if (e.koObavesten && e.koObavesten.trim()) continue;
      const key = oncallDayKey(e.datum, e.vremeAlarm || e.vremeMail);
      if (key && schedule[key] && schedule[key].primarni) {
        e.koObavesten = schedule[key].primarni;
        changed = true;
      }
    }
    if (changed) saveLog();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLog, 300);
  }

  function visibleEntries() {
    let rows = log.slice();
    if ($('only-today').checked) {
      const t = todayDMY();
      rows = rows.filter(function (e) { return e.datum === t; });
    }
    if ($('only-reported') && $('only-reported').checked) {
      rows = rows.filter(function (e) { return e.reported; });
    }
    return rows;
  }

  function fillDatalist() {
    const dl = $('dezurni-list');
    dl.innerHTML = '';
    DEZURNI.forEach(function (name) {
      const o = document.createElement('option');
      o.value = name;
      dl.appendChild(o);
    });
  }

  function makeInput(entry, field, cls) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = entry[field] || '';
    if (cls) inp.className = cls;
    if (field === 'koObavesten') inp.setAttribute('list', 'dezurni-list');
    inp.addEventListener('input', function () {
      entry[field] = inp.value;
      scheduleSave();
    });
    return inp;
  }

  function render() {
    const tbody = $('rows');
    tbody.innerHTML = '';
    const rows = visibleEntries();

    $('empty').style.display = rows.length ? 'none' : '';
    $('count').textContent = rows.length + (rows.length === 1 ? ' upis' : ' upisa');

    rows.forEach(function (entry) {
      const tr = document.createElement('tr');
      if (!entry.workHours) tr.className = 'afterhours';
      if (!entry.reported) tr.classList.add('unreported');

      const cellDefs = [
        ['host', 'host'], ['problem', 'problem'], ['datum', ''],
        ['vremeAlarm', 't'], ['vremeMail', 't'], ['odziv', 't'],
        ['koObavesten', 'ko'], ['vremePoziva', 't'], ['analiticar', '']
      ];

      cellDefs.forEach(function (def) {
        const td = document.createElement('td');
        if (def[1]) td.className = def[1];
        const inp = makeInput(entry, def[0], null);
        if (def[0] === 'koObavesten' && !entry.workHours) {
          const key = oncallDayKey(entry.datum, entry.vremeAlarm || entry.vremeMail);
          if (key && schedule[key]) {
            const s = schedule[key];
            inp.title = 'Dežurni ' + key + '\nPrimarni: ' + (s.primarni || '-') + '\nSekundarni: ' + (s.sekundarni || '-');
          }
        }
        td.appendChild(inp);
        tr.appendChild(td);
      });

      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'row-del';
      del.textContent = 'Obriši';
      del.addEventListener('click', function () {
        const idx = log.indexOf(entry);
        if (idx !== -1) {
          log.splice(idx, 1);
          saveLog();
          render();
        }
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    });
  }

  function buildTSV() {
    const rows = visibleEntries();
    const lines = [];
    if ($('incl-header').checked) {
      lines.push(['Host', 'Problem', 'Datum', 'Vreme', 'Vreme kada je problem prijavljen (slanje maila)', 'Vreme odziva', 'Ko je obavešten (Ime dezurnog)', 'Vreme poziva', 'Analiticar'].join('\t'));
    }
    rows.forEach(function (e) {
      const cells = COLS.map(function (c) {
        return String(e[c] == null ? '' : e[c]).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      });
      lines.push(cells.join('\t'));
    });
    return lines.join('\r\n');
  }

  function copyTSV() {
    const tsv = buildTSV();
    const done = function () {
      const msg = $('copied-msg');
      msg.style.display = '';
      setTimeout(function () { msg.style.display = 'none'; }, 2000);
    };
    try {
      navigator.clipboard.writeText(tsv).then(done).catch(function () { fallbackCopy(tsv, done); });
    } catch (e) {
      fallbackCopy(tsv, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {}
  }

  function clearShown() {
    const rows = visibleEntries();
    if (rows.length === 0) return;
    const label = $('only-today').checked ? 'današnje upise (' + rows.length + ')' : 'sve prikazane upise (' + rows.length + ')';
    if (!window.confirm('Obrisati ' + label + ' iz dnevnika? Ovo se ne moze povratiti.')) return;
    const toRemove = new Set(rows);
    log = log.filter(function (e) { return !toRemove.has(e); });
    saveLog();
    render();
  }

  function refreshScheduleInfo() {
    const nd = Object.keys(schedule).length;
    const nc = Object.keys(contacts).length;
    const el = $('sched-info');
    if (el) el.textContent = (nd || nc) ? (nd + ' datuma, ' + nc + ' kontakata u rasporedu') : 'Raspored nije učitan';
  }

  function importSchedule() {
    const ta = $('sched-text');
    const parsed = parseSchedule(ta.value);
    const nDays = Object.keys(parsed.days).length;
    const nCont = Object.keys(parsed.contacts).length;
    if (nDays === 0 && nCont === 0) {
      $('sched-info').textContent = 'Nije prepoznat nijedan datum ni kontakt. Nalepi Dan + dežurni (+ Ime/telefon) iz DCCPT-a.';
      return;
    }
    Object.keys(parsed.days).forEach(function (k) { schedule[k] = parsed.days[k]; });
    Object.keys(parsed.contacts).forEach(function (k) { contacts[k] = parsed.contacts[k]; });
    saveSchedule();
    applyScheduleAutofill();
    refreshScheduleInfo();
    render();
    ta.value = '';
    $('sched-info').textContent = nDays + ' datuma i ' + nCont + ' kontakata dodato. Vanradni redovi auto-popunjeni.';
  }

  function init() {
    fillDatalist();
    Promise.all([loadLog(), loadSchedule(), loadContacts()]).then(function (vals) {
      log = vals[0];
      schedule = vals[1];
      contacts = vals[2];
      applyScheduleAutofill();
      refreshScheduleInfo();
      render();
    });
    $('copy-tsv').addEventListener('click', copyTSV);
    $('refresh').addEventListener('click', function () {
      Promise.all([loadLog(), loadSchedule(), loadContacts()]).then(function (vals) {
        log = vals[0]; schedule = vals[1]; contacts = vals[2];
        applyScheduleAutofill(); refreshScheduleInfo(); render();
      });
    });
    $('clear-shown').addEventListener('click', clearShown);
    $('only-today').addEventListener('change', render);
    const orr = $('only-reported');
    if (orr) orr.addEventListener('change', render);
    const si = $('sched-import');
    if (si) si.addEventListener('click', importSchedule);
    const reg = $('open-registar');
    if (reg) reg.addEventListener('click', function () {
      try { window.open(REGISTAR_URL, '_blank'); } catch (e) {}
    });
    const spi = $('open-spisak');
    if (spi) spi.addEventListener('click', function () {
      try { window.open(DCCPT_URL, '_blank'); } catch (e) {}
    });
    const st = $('sched-toggle');
    if (st) st.addEventListener('click', function () {
      const p = $('sched-panel');
      p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
